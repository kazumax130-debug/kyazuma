"""Audio analysis: turns sound into (bass, mid, high) levels for the shaders."""

import threading

import numpy as np

BANDS = ((20, 150), (150, 2000), (2000, 10000))
WINDOW = 2048


class BandAnalyzer:
    """FFT band energies with auto-gain and attack/release smoothing."""

    def __init__(self, samplerate, attack=0.6, release=0.15):
        self.sr = samplerate
        self.attack, self.release = attack, release
        self.peak = np.full(3, 1e-3)
        self.level = np.zeros(3)
        freqs = np.fft.rfftfreq(WINDOW, 1.0 / samplerate)
        self.masks = [(freqs >= lo) & (freqs < hi) for lo, hi in BANDS]
        self.win = np.hanning(WINDOW)

    def process(self, samples):
        if len(samples) < WINDOW:
            samples = np.pad(samples, (WINDOW - len(samples), 0))
        spec = np.abs(np.fft.rfft(samples[-WINDOW:] * self.win))
        e = np.array([np.sqrt(np.mean(spec[m] ** 2)) if m.any() else 0.0 for m in self.masks])
        # Auto gain: slowly decaying peak per band.
        self.peak = np.maximum(self.peak * 0.995, e)
        norm = np.clip(e / (self.peak + 1e-9), 0, 1) ** 1.5
        k = np.where(norm > self.level, self.attack, self.release)
        self.level += (norm - self.level) * k
        return tuple(float(x) for x in self.level)


class MicInput:
    """Live input from the default microphone / audio interface (needs `sounddevice`)."""

    def __init__(self, device=None, samplerate=44100):
        import sounddevice as sd  # optional dependency

        self.buf = np.zeros(WINDOW, dtype=np.float32)
        self.lock = threading.Lock()
        self.analyzer = BandAnalyzer(samplerate)
        self.stream = sd.InputStream(device=device, channels=1, samplerate=samplerate,
                                     blocksize=512, callback=self._cb)
        self.stream.start()

    def _cb(self, indata, frames, time, status):  # noqa: ARG002
        with self.lock:
            self.buf = np.roll(self.buf, -frames)
            self.buf[-frames:] = indata[:, 0]

    def bands(self):
        with self.lock:
            s = self.buf.copy()
        return self.analyzer.process(s)

    def close(self):
        self.stream.stop()
        self.stream.close()


class AudioTrack:
    """Audio file for offline rendering: gives the bands at any time position.

    Any format ffmpeg can read (wav, mp3, m4a, ...) is supported.
    """

    def __init__(self, path, samplerate=44100):
        import subprocess

        import imageio_ffmpeg

        cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(path),
               "-f", "s16le", "-ac", "1", "-ar", str(samplerate), "-"]
        raw = subprocess.run(cmd, check=True, capture_output=True).stdout
        self.sr = samplerate
        self.samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        self.duration = len(self.samples) / self.sr
        self.analyzer = BandAnalyzer(self.sr)

    def bands_at(self, t):
        end = int(t * self.sr)
        start = max(0, end - WINDOW)
        return self.analyzer.process(self.samples[start:end])
