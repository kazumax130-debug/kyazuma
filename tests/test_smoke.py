import numpy as np
import pytest

from vsynth.engine import Engine, State, create_headless_context
from vsynth.params import SPEC, Params
from vsynth.render import parse_timeline, scene_at
from vsynth.shaders import SCENE_NAMES


@pytest.fixture(scope="module")
def engine():
    try:
        ctx = create_headless_context()
    except RuntimeError as e:
        pytest.skip(f"no OpenGL: {e}")
    return Engine(ctx, (160, 90))


@pytest.mark.parametrize("scene", SCENE_NAMES)
def test_every_scene_draws_something(engine, scene):
    params, state = Params(glide=0), State(scene)
    for _ in range(5):
        params.update(1 / 30)
        state.advance(1 / 30, params)
        engine.render(params, state, (0.5, 0.5, 0.5))
    img = engine.read_frame(params)
    assert img.shape == (90, 160, 3)
    assert img.std() > 5  # not a flat colour


def test_crossfade_and_effects(engine):
    params, state = Params(glide=0), State("plasma")
    for k in ("feedback", "rgb", "glitch", "scan"):
        params.set(k, 0.8, instant=True)
    state.mirror, state.invert = 2, True
    state.set_scene("tunnel")
    engine.set_camera_frame(np.full((48, 64, 3), 200, np.uint8))
    for mode in range(4):
        state.cam_mode = mode
        engine.render(params, state)
    assert state.mix == 0  # still crossfading: both scenes were drawn
    assert engine.read_frame(params).std() > 1


def test_params_clamp_wrap_and_glide():
    p = Params(glide=10)
    p.set("warp", 99)
    assert p.target["warp"] == SPEC["warp"][2]
    p.set("hue", 1.25)
    assert p.target["hue"] == pytest.approx(0.25)
    p.update(0.05)
    assert 0 < p["warp"] < SPEC["warp"][2]


def test_timeline():
    tl = parse_timeline("plasma:2,tunnel:1")
    assert scene_at(tl, 0.5) == "plasma"
    assert scene_at(tl, 2.5) == "tunnel"
    assert scene_at(tl, 3.5) == "plasma"  # loops
