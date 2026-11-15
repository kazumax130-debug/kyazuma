"""Audio-reactive modulation for music-video renders.

Maps per-frame audio features (see `audio.Features`) onto synth parameters:
low end pushes the zoom (and feedback tunnel), high-end transients trigger
glitches and RGB split, kicks flash the brightness, e-piano / keys notes make
the picture breathe and chord changes shift the colour.

Everything can be set per section of the song (`--section 1-40:gain=2,...`),
so a soft intro can react as clearly as a full chorus.
"""

from dataclasses import dataclass, fields, replace

import numpy as np

from .params import SPEC


@dataclass
class Reactivity:
    bass_zoom: float = 0.0    # zoom punch on bass / kicks (0.3 = up to +30%)
    bass_fb: float = 0.0      # feedback tunnel pull on bass (0..1)
    bass_warp: float = 0.0    # extra warp on bass
    high_glitch: float = 0.0  # glitch bursts on hi-hats / high transients (0..1)
    high_rgb: float = 0.0     # RGB split following the high band (0..1)
    kick_flash: float = 0.0   # brightness flash on kicks (0.2 = +20%)
    mid_hue: float = 0.0      # hue drift following the mids (0..1)
    note_pulse: float = 0.0   # picture "breathes" on e-piano / keys notes (0..1)
    chord_hue: float = 0.0    # colour step on every chord change (0..1)

    def active(self):
        return any(v for v in vars(self).values())


REACT_KEYS = tuple(f.name for f in fields(Reactivity))
SECTION_KEYS = REACT_KEYS + ("gain", "sensitivity")


@dataclass
class Section:
    start: float              # seconds
    end: float                # seconds
    values: dict              # Reactivity overrides + gain / sensitivity


def parse_section(text, bar=None):
    """'1-40:gain=2,note_pulse=0.5'  (bars, needs --bpm)  or  '0s-80s:...' (seconds)."""
    rng, sep, body = text.partition(":")
    a, dash, b = rng.partition("-")
    if not sep or not dash:
        raise ValueError(f"'{text}': 範囲:名前=値,... の形式で (例 1-40:gain=2)")

    def pos(x, is_end):
        x = x.strip()
        if x.endswith("s"):
            return float(x[:-1])
        if bar is None:
            raise ValueError("小節で指定するには --bpm が必要です (秒なら 0s-80s のように s を付ける)")
        n = float(x)
        return (n if is_end else n - 1) * bar  # bars are 1-based and inclusive

    values = {}
    for kv in body.split(","):
        k, eq, v = kv.strip().partition("=")
        k = k.replace("-", "_")
        if not eq or k not in SECTION_KEYS:
            raise ValueError(f"'{kv}': 使える名前は {', '.join(SECTION_KEYS)}")
        values[k] = float(v)
    return Section(pos(a, False), pos(b, True), values)


class Plan:
    """Base reactivity plus per-section overrides, looked up by song time."""

    def __init__(self, base: Reactivity, sections=(), gain=1.0, sensitivity=0.0):
        self.base, self.sections = base, list(sections)
        self.gain, self.sens = gain, sensitivity

    def at(self, t):
        r, gain, sens = self.base, self.gain, self.sens
        for s in self.sections:  # later sections win
            if s.start <= t < s.end:
                v = dict(s.values)
                gain, sens = v.pop("gain", gain), v.pop("sensitivity", sens)
                r = replace(r, **v)
        return r, gain, sens

    def sensitivity(self, times):
        return np.array([self.at(t)[2] for t in times])

    def active(self):
        return self.base.active() or any(
            any(v for k, v in s.values.items() if k in REACT_KEYS) for s in self.sections)


def _clamp(name, v):
    lo, hi = SPEC[name][1], SPEC[name][2]
    return min(max(v, lo), hi)


class Modulator:
    """Temporarily offsets the *current* (already glided) parameter values.

    Usage per frame: `with mod.apply(params, song_frame): engine.render(...)`.
    Offsets are applied on top of the base look, so presets / --set still work,
    and they never accumulate (values are restored after the frame).
    Colour drift is precomputed over the whole song, so rendering a section
    gives exactly the same frames as rendering the whole song.
    """

    def __init__(self, plan: Plan, feats):
        self.plan, self.f = plan, feats
        fps = feats.fps
        drift, steps = np.zeros(feats.n), np.zeros(feats.n)
        d = s = 0.0
        for i in range(feats.n):
            r, gain, _ = plan.at(i / fps)
            d += r.mid_hue * min(feats.mid[i] * gain, 1.0) * 0.2 / fps
            if feats.chord[i] > 0:
                s += r.chord_hue * 0.12
            drift[i], steps[i] = d, s
        # Glide to each new colour over ~0.6 s instead of jumping.
        k = 1.0 - np.exp(-1.0 / (fps * 0.6))
        glided = np.empty_like(steps)
        y = 0.0
        for i, v in enumerate(steps):
            y += (v - y) * k
            glided[i] = y
        self.hue = drift + glided

    def offsets(self, i):
        r, gain, _ = self.plan.at(i / self.f.fps)
        f = self.f.at(i, gain)
        punch = 0.6 * f["kick"] + 0.4 * f["bass"] ** 2
        note = r.note_pulse * f["note"]
        return {
            "zoom": ("mul", 1.0 + r.bass_zoom * punch + 0.08 * note),
            "fb_zoom": ("add", 0.04 * r.bass_fb * punch + 0.02 * note),
            "warp": ("add", r.bass_warp * f["bass"] + 0.3 * note),
            "glitch": ("add", r.high_glitch * f["hat"]),
            "rgb": ("add", r.high_rgb * (0.5 * f["high"] + 0.5 * f["hat"])),
            "bright": ("mul", (1.0 + r.kick_flash * f["kick"]) * (1.0 + 0.5 * note)),
            "hue": ("add", float(self.hue[min(i, self.f.n - 1)]) % 1.0),
        }

    def apply(self, params, i):
        return _Applied(params, self.offsets(i))


class _Applied:
    def __init__(self, params, offs):
        self.params, self.offs, self.saved = params, offs, {}

    def __enter__(self):
        v = self.params.value
        for name, (op, amt) in self.offs.items():
            self.saved[name] = v[name]
            x = v[name] * amt if op == "mul" else v[name] + amt
            v[name] = x % 1.0 if SPEC[name][4] else _clamp(name, x)
        return self.params

    def __exit__(self, *exc):
        self.params.value.update(self.saved)
        return False
