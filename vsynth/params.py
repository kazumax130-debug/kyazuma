"""Synth parameters with smooth (glide) transitions and preset storage."""

import json
import random
from pathlib import Path

# name: (default, min, max, step, wrap)
SPEC = {
    "speed":      (1.0,  0.0,  5.0,  0.1,   False),
    "hue":        (0.0,  0.0,  1.0,  0.02,  True),
    "sat":        (1.0,  0.0,  1.5,  0.05,  False),
    "zoom":       (1.0,  0.2,  5.0,  0.05,  False),
    "warp":       (0.5,  0.0,  3.0,  0.1,   False),
    "complexity": (1.0,  0.2,  3.0,  0.1,   False),
    "feedback":   (0.0,  0.0,  0.98, 0.05,  False),
    "fb_zoom":    (1.01, 0.9,  1.2,  0.005, False),
    "fb_rot":     (0.0, -0.2,  0.2,  0.005, False),
    "rgb":        (0.0,  0.0,  1.0,  0.05,  False),
    "glitch":     (0.0,  0.0,  1.0,  0.05,  False),
    "scan":       (0.0,  0.0,  1.0,  0.1,   False),
    "bright":     (1.0,  0.0,  2.0,  0.05,  False),
    "audio_gain": (1.0,  0.0,  5.0,  0.1,   False),
    "cam_amt":    (1.0,  0.0,  1.0,  0.05,  False),
    "cam_key":    (0.35, 0.0,  1.0,  0.02,  False),
}
NAMES = list(SPEC.keys())

# Parameters that are *not* randomized (they'd make the picture unusable).
_NO_RANDOM = {"speed", "bright", "audio_gain", "cam_amt", "cam_key", "scan"}


class Params:
    def __init__(self, glide=4.0):
        self.target = {k: v[0] for k, v in SPEC.items()}
        self.value = dict(self.target)
        self.glide = glide  # higher = snappier; 0 = instant

    def __getitem__(self, name):
        return self.value[name]

    def set(self, name, v, instant=False):
        _, lo, hi, _, wrap = SPEC[name]
        v = v % 1.0 if wrap else min(max(v, lo), hi)
        self.target[name] = v
        if instant:
            self.value[name] = v

    def nudge(self, name, direction, fine=False):
        step = SPEC[name][3] * (0.2 if fine else 1.0)
        self.set(name, self.target[name] + direction * step)

    def reset(self):
        for k, v in SPEC.items():
            self.set(k, v[0])

    def randomize(self, rng=random):
        for k, (d, lo, hi, _, _) in SPEC.items():
            if k in _NO_RANDOM:
                continue
            self.set(k, rng.uniform(lo, hi))
        # keep feedback in a usable range
        self.set("feedback", rng.uniform(0.0, 0.85))
        self.set("fb_zoom", rng.uniform(0.98, 1.05))

    def update(self, dt):
        if self.glide <= 0:
            self.value = dict(self.target)
            return
        a = min(1.0, dt * self.glide)
        for k, t in self.target.items():
            v = self.value[k]
            if SPEC[k][4]:  # wrap-around: move the short way
                d = (t - v + 0.5) % 1.0 - 0.5
                self.value[k] = (v + d * a) % 1.0
            else:
                self.value[k] = v + (t - v) * a

    def to_dict(self):
        return {k: round(v, 4) for k, v in self.target.items()}

    def load_dict(self, d, instant=False):
        for k, v in d.items():
            if k in SPEC:
                self.set(k, float(v), instant=instant)


class PresetBank:
    """Presets are saved as JSON so looks can be recalled per shot."""

    def __init__(self, path="presets.json"):
        self.path = Path(path)
        self.data = {}
        if self.path.exists():
            self.data = json.loads(self.path.read_text(encoding="utf-8"))

    def store(self, slot, scene, params, extra=None):
        self.data[str(slot)] = {"scene": scene, "params": params.to_dict(), **(extra or {})}
        self.path.write_text(json.dumps(self.data, indent=2, ensure_ascii=False), encoding="utf-8")

    def get(self, slot):
        return self.data.get(str(slot))
