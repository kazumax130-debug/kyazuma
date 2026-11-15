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

    def features(self, fps, sensitivity=0.0):
        """Analyse the whole song once at the video frame rate (see `analyze`)."""
        return analyze(self.samples, self.sr, fps, sensitivity)

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


def _rolling(x, fps, seconds, fn):
    """fn over a centred window of `seconds` for every frame."""
    w = max(1, int(fps * seconds)) | 1
    pad = np.pad(x, (w // 2, w // 2), mode="edge")
    return fn(np.lib.stride_tricks.sliding_window_view(pad, w), axis=1)


def _local_scale(flux, fps):
    """Typical size of a strong attack *around this point of the song* (~8 s window).

    Normalising locally means a soft e-piano intro gets its own note pulses
    instead of being dwarfed by the drums that come in later.
    """
    local = _rolling(flux, fps, 8.0, lambda a, axis: np.percentile(a, 97, axis=axis))
    return np.maximum(local, np.percentile(flux, 99) * 0.15) + 1e-9


def _pulses(hits, fps, decay):
    """Each hit becomes an exponentially decaying pulse."""
    k = np.exp(-1.0 / (fps * max(decay, 1e-3)))
    env = np.empty_like(hits)
    y = 0.0
    for i, h in enumerate(hits):
        y = max(y * k, h)
        env[i] = y
    return env


def _peaks(strength, fps, thr, min_gap):
    hits = np.zeros_like(strength)
    gap = max(1, int(min_gap * fps))
    last = -gap
    for i in range(1, len(strength) - 1):
        v = strength[i]
        if v > thr and v >= strength[i - 1] and v >= strength[i + 1] and i - last >= gap:
            hits[i], last = v, i
    return hits


def _onsets(energy, fps, decay, sensitivity, min_gap):
    """Transient detector: positive jumps in log energy -> decaying pulses (0..1)."""
    loge = np.log10(energy + 1e-6)
    flux = np.maximum(np.diff(loge, prepend=loge[:1]), 0.0)
    # Adaptive threshold: median of the last ~0.5s plus a margin.
    w = max(1, int(fps * 0.5))
    pad = np.concatenate([np.full(w, flux[0]), flux])
    med = np.array([np.median(pad[i:i + w]) for i in range(len(flux))])
    scale = _local_scale(flux, fps)
    strength = np.clip((flux - med) / scale * (1.0 + np.asarray(sensitivity)), 0.0, 1.0)
    # Ignore only near-silence (not merely quiet parts: a soft intro must still react).
    strength[energy < np.percentile(energy, 98) * 1e-3] = 0.0
    hits = _peaks(strength, fps, 0.25, min_gap)
    return _pulses(hits, fps, decay), hits > 0


def _chroma(samples, sr, fps, n_all, size=8192, lo=110.0, hi=2000.0):
    """12-bin pitch-class profile per frame (which notes are sounding)."""
    hop = sr / fps
    win = np.hanning(size)
    freqs = np.fft.rfftfreq(size, 1.0 / sr)
    sel = (freqs >= lo) & (freqs < hi)
    pc = (np.round(12 * np.log2(freqs[sel] / 440.0)).astype(int) + 9) % 12  # 0 = C
    onehot = np.zeros((sel.sum(), 12))
    onehot[np.arange(sel.sum()), pc] = 1.0
    padded = np.concatenate([np.zeros(size, np.float32), samples, np.zeros(size, np.float32)])
    out = np.zeros((n_all, 12))
    for i in range(n_all):
        c = int(i * hop) + size
        spec = np.abs(np.fft.rfft(padded[c - size:c] * win))[sel]
        out[i] = (spec ** 2) @ onehot
    return out


def _rolling_rows(m, fps, seconds):
    w = max(1, int(fps * seconds)) | 1
    pad = np.pad(m, ((w // 2, w // 2), (0, 0)), mode="edge")
    return np.median(np.lib.stride_tricks.sliding_window_view(pad, w, axis=0), axis=2)


def _chord_changes(chroma, energy, fps, sensitivity, min_gap=0.4):
    """Harmonic novelty: how different the notes are now vs. ~0.3 s ago -> hits (0..1)."""
    # Median over ~0.3 s keeps sustained notes and drops drum hits.
    chroma = _rolling_rows(chroma, fps, 0.3)
    norm = chroma / (np.linalg.norm(chroma, axis=1, keepdims=True) + 1e-12)
    k = max(1, int(0.3 * fps))
    prev = np.vstack([np.repeat(norm[:1], k, axis=0), norm[:-k]])
    nov = 1.0 - np.sum(norm * prev, axis=1)
    nov[energy < np.percentile(energy, 98) * 1e-3] = 0.0
    scale = np.percentile(nov, 99) + 1e-9
    strength = np.clip(nov / scale * (1.0 + np.asarray(sensitivity)), 0.0, 1.0)
    # The novelty curve is a plateau ~k frames wide; peak-pick its rising edge.
    rise = np.maximum(np.diff(strength, prepend=0.0), 0.0)
    rise = np.convolve(rise, np.ones(max(1, k // 2)), mode="full")[: len(rise)]
    return _peaks(np.minimum(rise, 1.0), fps, 0.35, min_gap)


class Features:
    """Per-frame audio features of a whole song (index = song frame).

    bass/mid/high: smoothed band levels (0..1), normalised over the *whole* song.
    kick:          decaying pulse on low-end transients (kick drum, bass attacks).
    hat:           decaying pulse on high-end transients (hi-hats, ghost notes, clicks).
    note:          decaying pulse on mid-range attacks (e-piano / keys notes and chord stabs).
    chord:         chord-change hits (0 or strength), from the pitch-class profile.
    """

    KEYS = ("bass", "mid", "high", "kick", "hat", "note", "chord")

    def __init__(self, fps, **arrays):
        self.fps = fps
        for k in self.KEYS + ("kick_hits",):
            setattr(self, k, arrays[k])
        self.n = len(self.bass)

    def frame(self, t):
        return min(max(round(t * self.fps), 0), self.n - 1)

    def at(self, i, gain=1.0):
        i = min(max(int(i), 0), self.n - 1)
        return {k: min(float(getattr(self, k)[i]) * gain, 1.0) for k in self.KEYS}

    def bands(self, i, gain=1.0):
        f = self.at(i, gain)
        return (f["bass"], f["mid"], f["high"])


def analyze(samples, sr, fps, sensitivity=0.0):
    """Analyse a whole song frame by frame at the video frame rate.

    `sensitivity` is a number, or a function of song time (seconds, array) -> number,
    so quiet sections can be made more sensitive than loud ones.
    """
    total = len(samples) / sr
    n_all = int(np.ceil(total * fps)) + 1
    times = np.arange(n_all) / fps
    sens = sensitivity(times) if callable(sensitivity) else np.full(n_all, float(sensitivity))

    hop = sr / fps
    win = np.hanning(WINDOW)
    freqs = np.fft.rfftfreq(WINDOW, 1.0 / sr)
    masks = [(freqs >= lo) & (freqs < hi) for lo, hi in BANDS]
    padded = np.concatenate([np.zeros(WINDOW, np.float32), samples, np.zeros(WINDOW, np.float32)])
    energy = np.zeros((n_all, 3))
    for i in range(n_all):
        c = int(i * hop) + WINDOW  # window ends at the frame time
        spec = np.abs(np.fft.rfft(padded[c - WINDOW:c] * win))
        energy[i] = [np.sqrt(np.mean(spec[m] ** 2)) if m.any() else 0.0 for m in masks]

    levels = []
    for b in range(3):
        ref = np.percentile(energy[:, b], 98) + 1e-9
        lv = np.clip(energy[:, b] / ref, 0.0, 1.0) ** 1.5
        levels.append(_smooth(lv, fps, attack=0.03, release=0.25))
    kick, kick_hits = _onsets(energy[:, 0], fps, decay=0.18, sensitivity=sens, min_gap=0.12)
    hat, _ = _onsets(energy[:, 2], fps, decay=0.08, sensitivity=sens, min_gap=0.06)
    note, _ = _onsets(energy[:, 1], fps, decay=0.35, sensitivity=sens, min_gap=0.1)
    chord = _chord_changes(_chroma(samples, sr, fps, n_all), energy[:, 1], fps, sens)

    return Features(fps, bass=levels[0], mid=levels[1], high=levels[2], kick=kick, hat=hat,
                    note=note, chord=chord, kick_hits=kick_hits)
