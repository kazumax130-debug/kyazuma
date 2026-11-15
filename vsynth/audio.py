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

    def features(self, fps, start=0.0, duration=None, sensitivity=0.0):
        """Analyse the whole song once at the video frame rate (see `analyze`)."""
        return analyze(self.samples, self.sr, fps, start, duration, sensitivity)

    def bands_at(self, t):
        end = int(t * self.sr)
        start = max(0, end - WINDOW)
        return self.analyzer.process(self.samples[start:end])


# ---------------------------------------------------------------------------
# Whole-song analysis for offline renders (music video sync)
# ---------------------------------------------------------------------------

def _smooth(x, fps, attack, release):
    """Attack/release envelope follower with time constants in seconds (fps independent)."""
    ka = 1.0 - np.exp(-1.0 / (fps * max(attack, 1e-4)))
    kr = 1.0 - np.exp(-1.0 / (fps * max(release, 1e-4)))
    out = np.empty_like(x)
    y = 0.0
    for i, v in enumerate(x):
        y += (v - y) * (ka if v > y else kr)
        out[i] = y
    return out


def _onsets(energy, fps, decay, sensitivity, min_gap):
    """Transient detector: positive jumps in log energy -> decaying pulses (0..1)."""
    loge = np.log10(energy + 1e-6)
    flux = np.maximum(np.diff(loge, prepend=loge[:1]), 0.0)
    # Adaptive threshold: median of the last ~0.5s plus a margin.
    w = max(1, int(fps * 0.5))
    pad = np.concatenate([np.full(w, flux[0]), flux])
    med = np.array([np.median(pad[i:i + w]) for i in range(len(flux))])
    scale = np.percentile(flux, 99) + 1e-9
    strength = np.clip((flux - med) / scale * (1.0 + sensitivity), 0.0, 1.0)
    # Ignore very quiet passages (noise floor of the song).
    strength[energy < np.percentile(energy, 20)] = 0.0
    hits = np.zeros_like(flux)
    gap = max(1, int(min_gap * fps))
    last = -gap
    thr = 0.25
    for i in range(1, len(flux) - 1):
        s = strength[i]
        if s > thr and s >= strength[i - 1] and s >= strength[i + 1] and i - last >= gap:
            hits[i], last = s, i
    # Each hit becomes an exponentially decaying pulse.
    k = np.exp(-1.0 / (fps * max(decay, 1e-3)))
    env = np.empty_like(hits)
    y = 0.0
    for i, h in enumerate(hits):
        y = max(y * k, h)
        env[i] = y
    return env, hits > 0


class Features:
    """Per-frame audio features of a whole song.

    bass/mid/high: smoothed band levels (0..1), normalised over the *whole* song,
                   so quiet intros stay quiet and the chorus hits harder.
    kick:          decaying pulse on low-end transients (kick drum, bass attacks).
    hat:           decaying pulse on high-end transients (hi-hats, ghost notes, clicks).
    """

    def __init__(self, bass, mid, high, kick, hat, kick_hits, fps):
        self.bass, self.mid, self.high = bass, mid, high
        self.kick, self.hat = kick, hat
        self.kick_hits = kick_hits
        self.fps = fps
        self.n = len(bass)

    def at(self, i):
        i = min(max(int(i), 0), self.n - 1)
        return {"bass": float(self.bass[i]), "mid": float(self.mid[i]),
                "high": float(self.high[i]), "kick": float(self.kick[i]),
                "hat": float(self.hat[i])}

    def bands(self, i):
        f = self.at(i)
        return (f["bass"], f["mid"], f["high"])


def analyze(samples, sr, fps, start=0.0, duration=None, sensitivity=0.0):
    """Analyse `samples` frame by frame at the video frame rate."""
    total = len(samples) / sr
    if duration is None:
        duration = max(0.0, total - start)
    n = max(1, round(duration * fps))
    hop = sr / fps
    win = np.hanning(WINDOW)
    freqs = np.fft.rfftfreq(WINDOW, 1.0 / sr)
    masks = [(freqs >= lo) & (freqs < hi) for lo, hi in BANDS]

    # Analyse the whole song (not just the rendered range) so normalisation
    # and onset thresholds are the same whichever section you render.
    n_all = int(np.ceil(total * fps)) + 1
    padded = np.concatenate([np.zeros(WINDOW, np.float32), samples, np.zeros(WINDOW, np.float32)])
    energy = np.zeros((n_all, 3))
    for i in range(n_all):
        c = int(i * hop) + WINDOW  # window ends at the frame time
        frame = padded[c - WINDOW:c]
        if len(frame) < WINDOW:
            frame = np.pad(frame, (0, WINDOW - len(frame)))
        spec = np.abs(np.fft.rfft(frame * win))
        energy[i] = [np.sqrt(np.mean(spec[m] ** 2)) if m.any() else 0.0 for m in masks]

    levels = []
    for b in range(3):
        ref = np.percentile(energy[:, b], 98) + 1e-9
        lv = np.clip(energy[:, b] / ref, 0.0, 1.0) ** 1.5
        levels.append(_smooth(lv, fps, attack=0.03, release=0.25))
    kick, kick_hits = _onsets(energy[:, 0], fps, decay=0.18, sensitivity=sensitivity, min_gap=0.12)
    hat, _ = _onsets(energy[:, 2], fps, decay=0.08, sensitivity=sensitivity, min_gap=0.06)

    s = round(start * fps)
    idx = np.clip(np.arange(s, s + n), 0, n_all - 1)
    return Features(*(levels[b][idx] for b in range(3)), kick[idx], hat[idx], kick_hits[idx], fps)
