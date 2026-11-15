import numpy as np
import pytest

from vsynth.__main__ import main
from vsynth.audio import Features, analyze
from vsynth.params import Params
from vsynth.render import bar_seconds, parse_timeline, scene_at
from vsynth.sync import Modulator, Plan, Reactivity, parse_section

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
    assert f.n >= 8 * FPS
    hits = np.nonzero(f.kick_hits)[0] / FPS
    beats = np.arange(2.0, 8.0, 0.5)
    assert len(hits[hits > 1.0]) == len(beats)
    assert np.allclose(hits[hits > 1.0], beats, atol=1.5 / FPS)
    assert f.bass[: FPS].max() < 0.05 < f.bass[3 * FPS:].mean()


def soft_keys(chords, bar=2.0, amp=0.01):
    """Quiet e-piano-like chords, one per bar (no drums)."""
    t = np.arange(int(SR * bar * len(chords))) / SR
    y = np.zeros_like(t)
    n = int(bar * SR)
    tt = t[:n]
    for b, chord in enumerate(chords):
        for m in chord:
            hz = 440 * 2 ** ((m - 69) / 12)
            y[b * n:(b + 1) * n] += amp * np.sin(2 * np.pi * hz * tt) * np.exp(-tt * 2)
    return y.astype(np.float32)


def test_soft_intro_reacts_to_notes_and_chord_changes():
    # Fmaj7, Em7, A7, Dm7 quietly, then loud drums: the intro must still be detected.
    keys = soft_keys([[53, 57, 60, 64], [52, 55, 59, 62], [57, 61, 64, 67], [50, 53, 57, 60]])
    y = np.concatenate([keys, drum_loop(4.0, quiet_intro=0.0)])
    f = analyze(y, SR, FPS)
    changes = np.nonzero(f.chord)[0] / FPS
    for bar_start in (2.0, 4.0, 6.0):
        assert np.any(np.abs(changes - bar_start) < 0.3), (bar_start, changes)
    notes = np.nonzero(np.diff((f.note > 0.5).astype(int)) == 1)[0] / FPS
    assert np.sum(notes < 8.0) >= 3


def test_plan_sections_override_by_bar():
    plan = Plan(Reactivity(bass_zoom=0.2), [parse_section("1-40:gain=2.5,note_pulse=0.6", bar=2.0)])
    r, gain, _ = plan.at(79.9)
    assert (r.bass_zoom, r.note_pulse, gain) == (0.2, 0.6, 2.5)
    r, gain, _ = plan.at(80.0)
    assert (r.note_pulse, gain) == (0.0, 1.0)
    assert parse_section("0s-10s:sensitivity=1").end == 10.0
    with pytest.raises(ValueError):
        parse_section("1-4:nope=1", bar=2.0)


def test_modulator_offsets_and_restores():
    p = Params(glide=0)
    one, zero = np.ones(4), np.zeros(4)
    feats = Features(FPS, bass=one, mid=zero, high=zero, kick=one, hat=one * 0.8,
                     note=zero, chord=zero, kick_hits=zero > 0)
    mod = Modulator(Plan(Reactivity(bass_zoom=0.5, high_glitch=1.0, kick_flash=0.2)), feats)
    before = dict(p.value)
    with mod.apply(p, 2):
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


def test_sync_cli_writes_mp4_with_sections(tmp_path):
    import wave

    from vsynth.engine import create_headless_context
    try:
        create_headless_context().release()
    except RuntimeError as e:
        pytest.skip(f"no OpenGL: {e}")
    wav = tmp_path / "song.wav"
    y = np.concatenate([soft_keys([[53, 57, 60, 64], [52, 55, 59, 62]]), drum_loop(2.0, 0.0)])
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((y * 32767).astype(np.int16).tobytes())
    out = tmp_path / "mv.mp4"
    main(["sync", str(wav), "--size", "64x36", "--fps", "15", "--bpm", "120",
          "--section", "1-2:gain=3,note_pulse=0.8", "--start-bar", "2", "--bars", "2",
          "--out", str(out)])
    assert out.stat().st_size > 1000
