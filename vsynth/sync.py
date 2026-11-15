"""Audio-reactive modulation for music-video renders.

Maps per-frame audio features (see `audio.Features`) onto synth parameters:
low end pushes the zoom (and feedback tunnel), high-end transients trigger
glitches and RGB split, kicks flash the brightness.
"""

from dataclasses import dataclass

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

    def active(self):
        return any(v for v in vars(self).values())


def _clamp(name, v):
    lo, hi = SPEC[name][1], SPEC[name][2]
    return min(max(v, lo), hi)


class Modulator:
    """Temporarily offsets the *current* (already glided) parameter values.

    Usage per frame: `with mod.apply(params, features.at(i)): engine.render(...)`.
    Offsets are applied on top of the base look, so presets / --set still work,
    and they never accumulate (values are restored after the frame).
    """

    def __init__(self, react: Reactivity):
        self.r = react
        self.hue_drift = 0.0

    def offsets(self, f, dt=0.0):
        r = self.r
        punch = 0.6 * f["kick"] + 0.4 * f["bass"] ** 2
        self.hue_drift = (self.hue_drift + dt * r.mid_hue * f["mid"] * 0.2) % 1.0
        return {
            "zoom": ("mul", 1.0 + r.bass_zoom * punch),
            "fb_zoom": ("add", 0.04 * r.bass_fb * punch),
            "warp": ("add", r.bass_warp * f["bass"]),
            "glitch": ("add", r.high_glitch * f["hat"]),
            "rgb": ("add", r.high_rgb * (0.5 * f["high"] + 0.5 * f["hat"])),
            "bright": ("mul", 1.0 + r.kick_flash * f["kick"]),
            "hue": ("add", self.hue_drift),
        }

    def apply(self, params, f, dt=0.0):
        return _Applied(params, self.offsets(f, dt))


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
