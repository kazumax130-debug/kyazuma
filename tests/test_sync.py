import numpy as np
import pytest

from vsynth.__main__ import main  # noqa: F401  (import check)
from vsynth.audio import analyze
from vsynth.params import Params
from vsynth.render import bar_seconds, parse_timeline, scene_at
from vsynth.sync import Modulator, Reactivity

SR, FPS = 22050, 30


def drum_loop(seconds=8.0, quiet_intro=2.0):
    """Sine pad + kicks on every beat (120 BPM) after a quiet intro."""
    t = np.arange(int(SR * seconds)) / SR
    y = 0.1 * np.sin(2 * np.pi * 440 * t)
    for k in np.arange(quiet_intro, seconds, 0.5):
        i, n = int(k * SR), int(0.2 * SR)
        tt = np.arange(n) / SR
        y[i:i + n] += 0.8 * np.sin(2 * np.pi * 55 * tt) * np.exp(-tt * 15)
    return y.astype(np.float32)


def test_kicks_are_found_on_the_beat():
    f = analyze(drum_loop(), SR, FPS)
    assert f.n == 8 * FPS
    hits = np.nonzero(f.kick_hits)[0] / FPS
    beats = np.arange(2.0, 8.0, 0.5)
    assert len(hits[hits > 1.0]) == len(beats)
    assert np.allclose(hits[hits > 1.0], beats, atol=1.5 / FPS)
    assert f.bass[: FPS].max() < 0.05 < f.bass[3 * FPS:].mean()


def test_section_matches_whole_song_analysis():
    y = drum_loop()
    whole = analyze(y, SR, FPS)
    part = analyze(y, SR, FPS, start=4.0, duration=2.0)
    assert part.n == 2 * FPS
    assert np.allclose(part.kick, whole.kick[4 * FPS:6 * FPS])


def test_modulator_offsets_and_restores():
    p = Params(glide=0)
    mod = Modulator(Reactivity(bass_zoom=0.5, high_glitch=1.0, kick_flash=0.2))
    feat = {"bass": 1.0, "mid": 0.0, "high": 0.0, "kick": 1.0, "hat": 0.8}
    before = dict(p.value)
    with mod.apply(p, feat):
        assert p["zoom"] == pytest.approx(1.5)
        assert p["glitch"] == pytest.approx(0.8)
        assert p["bright"] == pytest.approx(1.2)
    assert p.value == before


def test_bars_as_scene_units():
    class A:
        bpm, beats_per_bar = 120, 4
    bar = bar_seconds(A)
    assert bar == 2.0
    tl = parse_timeline("plasma:4,tunnel:2", bar)
    assert scene_at(tl, 7.9) == "plasma" and scene_at(tl, 8.1) == "tunnel"
