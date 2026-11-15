"""Video output (recording) and video input (webcam / movie file)."""

import queue
import threading
import time
from pathlib import Path

import numpy as np

# codec name -> (ffmpeg codec, extension, pixel format, extra ffmpeg args)
CODECS = {
    "h264":   ("libx264",   ".mp4", "yuv420p",     ["-crf", "14", "-preset", "medium"]),
    "prores": ("prores_ks", ".mov", "yuv422p10le", ["-profile:v", "3"]),  # ProRes 422 HQ
}


def timestamped(folder="recordings", prefix="vsynth", ext=".mp4"):
    Path(folder).mkdir(parents=True, exist_ok=True)
    return str(Path(folder) / f"{prefix}_{time.strftime('%Y%m%d_%H%M%S')}{ext}")


class VideoWriter:
    """Writes RGB frames to a file via ffmpeg, on a background thread.

    Frames are queued so a slow encoder doesn't stall the live picture.
    """

    def __init__(self, path, size, fps, codec="h264", audio_path=None, threaded=True):
        import imageio_ffmpeg

        ff_codec, _, pix_fmt, extra = CODECS[codec]
        if audio_path:
            extra = extra + ["-shortest"]  # never let the sound run past the last frame
        self.path = path
        self.gen = imageio_ffmpeg.write_frames(
            path, size, fps=fps, codec=ff_codec, pix_fmt_in="rgb24", pix_fmt_out=pix_fmt,
            quality=None, bitrate=None, macro_block_size=1, output_params=extra,
            audio_path=audio_path, audio_codec="aac" if audio_path else None,
            ffmpeg_log_level="error")
        self.gen.send(None)
        self.frames = 0
        self.q = queue.Queue(maxsize=240) if threaded else None
        self.thread = None
        if threaded:
            self.thread = threading.Thread(target=self._run, daemon=True)
            self.thread.start()

    def _run(self):
        while True:
            frame = self.q.get()
            if frame is None:
                break
            self.gen.send(frame)

    def write(self, frame):
        frame = np.ascontiguousarray(frame)
        self.frames += 1
        if self.q is not None:
            self.q.put(frame)
        else:
            self.gen.send(frame)

    def close(self):
        if self.q is not None:
            self.q.put(None)
            self.thread.join()
        self.gen.close()


def save_png(path, frame):
    import pygame

    surf = pygame.image.frombuffer(np.ascontiguousarray(frame).tobytes(),
                                   (frame.shape[1], frame.shape[0]), "RGB")
    pygame.image.save(surf, path)


class Camera:
    """Webcam capture on a background thread (needs `opencv-python`)."""

    def __init__(self, index=0, width=1280, height=720):
        import cv2  # optional dependency

        self.cv2 = cv2
        self.cap = cv2.VideoCapture(index)
        if not self.cap.isOpened():
            raise RuntimeError(f"camera {index} could not be opened")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.frame = None
        self.fresh = False
        self.running = True
        self.lock = threading.Lock()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while self.running:
            ok, bgr = self.cap.read()
            if not ok:
                time.sleep(0.01)
                continue
            rgb = self.cv2.cvtColor(bgr, self.cv2.COLOR_BGR2RGB)
            with self.lock:
                self.frame, self.fresh = rgb, True

    def read(self):
        """Return the newest frame, or None if nothing new since the last call."""
        with self.lock:
            if not self.fresh:
                return None
            self.fresh = False
            return self.frame

    def close(self):
        self.running = False
        self.cap.release()


class MovieInput:
    """Reads a movie file frame by frame (used as the 'camera' in offline renders)."""

    def __init__(self, path, fps=None):
        import imageio_ffmpeg

        # Resample to the render frame rate so the footage plays at real speed.
        out = ["-r", str(fps)] if fps else None
        self.gen = imageio_ffmpeg.read_frames(str(path), output_params=out)
        meta = self.gen.__next__()
        self.w, self.h = meta["size"]
        self.last = np.zeros((self.h, self.w, 3), np.uint8)

    def read(self):
        try:
            data = next(self.gen)
            self.last = np.frombuffer(data, np.uint8).reshape(self.h, self.w, 3)
        except StopIteration:
            pass  # hold the last frame when the movie ends
        return self.last

    def close(self):
        self.gen.close()
