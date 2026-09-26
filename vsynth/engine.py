"""GPU rendering engine (moderngl). Shared by the live app and offline renderer."""

import moderngl
import numpy as np

from . import shaders
from .params import Params


def create_headless_context():
    """Create an OpenGL context without a window (for offline rendering)."""
    errors = []
    for kwargs in ({}, {"backend": "egl"}):
        try:
            return moderngl.create_standalone_context(require=330, **kwargs)
        except Exception as e:  # noqa: BLE001 - try the next backend
            errors.append(f"{kwargs or 'default'}: {e}")
    raise RuntimeError("OpenGL context could not be created:\n  " + "\n  ".join(errors))


class State:
    """Everything that is not a continuous parameter."""

    def __init__(self, scene="plasma"):
        self.scene = scene
        self.prev_scene = scene
        self.mix = 1.0          # crossfade progress 0..1
        self.xfade_time = 1.0   # seconds
        self.phase = 0.0        # animation time (speed-scaled)
        self.clock = 0.0        # real time
        self.frozen = False
        self.invert = False
        self.mirror = 0         # 0 off, 1 horizontal, 2 quad
        self.cam_mode = 0       # 0 off, 1 screen, 2 luma key, 3 displace
        self.strobe = 0.0

    def set_scene(self, name):
        if name == self.scene:
            return
        self.prev_scene = self.scene
        self.scene = name
        self.mix = 0.0

    def advance(self, dt, params: Params):
        self.clock += dt
        if not self.frozen:
            self.phase += dt * params["speed"]
        if self.mix < 1.0:
            self.mix = min(1.0, self.mix + dt / max(self.xfade_time, 1e-3))


class Engine:
    def __init__(self, ctx: moderngl.Context, size):
        self.ctx = ctx
        self.vao_cache = {}
        self.scene_progs = {
            name: ctx.program(vertex_shader=shaders.VERTEX,
                              fragment_shader=shaders.SCENE_HEADER + src)
            for name, src in shaders.SCENES.items()
        }
        self.post_prog = ctx.program(vertex_shader=shaders.VERTEX, fragment_shader=shaders.POST)
        self.display_prog = ctx.program(vertex_shader=shaders.VERTEX, fragment_shader=shaders.DISPLAY)
        self.cam_tex = ctx.texture((2, 2), 3, bytes(12))
        self.cam_tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.size = None
        self.resize(size)

    # -- resources -------------------------------------------------------
    def _target(self, components=4, dtype="f2"):
        tex = self.ctx.texture(self.size, components, dtype=dtype)
        tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        tex.repeat_x = tex.repeat_y = False
        return tex, self.ctx.framebuffer(color_attachments=[tex])

    def resize(self, size):
        size = (int(size[0]), int(size[1]))
        if size == self.size:
            return
        self.size = size
        self.scene_a = self._target()
        self.scene_b = self._target()
        self.out = [self._target(), self._target()]  # ping-pong for feedback
        for _, fbo in self.out:
            fbo.clear(0, 0, 0, 1)
        self.cur = 0
        self.readback = self._target(components=3, dtype="f1")

    def _vao(self, prog):
        if prog not in self.vao_cache:
            self.vao_cache[prog] = self.ctx.vertex_array(prog, [])
        return self.vao_cache[prog]

    @staticmethod
    def _uniforms(prog, **values):
        for k, v in values.items():
            if k in prog:
                prog[k].value = v

    def set_camera_frame(self, rgb):
        """Upload an HxWx3 uint8 RGB frame as the camera/input texture."""
        h, w = rgb.shape[:2]
        if self.cam_tex.size != (w, h):
            self.cam_tex.release()
            self.cam_tex = self.ctx.texture((w, h), 3)
            self.cam_tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.cam_tex.write(np.ascontiguousarray(rgb, dtype=np.uint8).tobytes())

    # -- rendering -------------------------------------------------------
    def _draw_scene(self, name, fbo, params, state, audio):
        prog = self.scene_progs[name]
        self._uniforms(prog,
                       u_time=state.phase, u_res=self.size,
                       u_hue=params["hue"], u_sat=params["sat"], u_zoom=params["zoom"],
                       u_warp=params["warp"], u_complexity=params["complexity"],
                       u_audio=tuple(float(a) for a in audio))
        fbo.use()
        self._vao(prog).render(moderngl.TRIANGLES, vertices=3)

    def render(self, params: Params, state: State, audio=(0.0, 0.0, 0.0)):
        """Render one frame into the internal output texture."""
        gain = params["audio_gain"]
        audio = tuple(min(a * gain, 2.0) for a in audio)

        self._draw_scene(state.scene, self.scene_a[1], params, state, audio)
        if state.mix < 1.0:
            self._draw_scene(state.prev_scene, self.scene_b[1], params, state, audio)

        prev_tex, _ = self.out[self.cur]
        self.cur ^= 1
        _, out_fbo = self.out[self.cur]

        self.scene_a[0].use(0)
        self.scene_b[0].use(1)
        prev_tex.use(2)
        self.cam_tex.use(3)
        mix = state.mix * state.mix * (3 - 2 * state.mix)  # smoothstep
        self._uniforms(self.post_prog,
                       u_scene_a=0, u_scene_b=1, u_prev=2, u_cam=3,
                       u_mix=mix,
                       u_feedback=params["feedback"], u_fb_zoom=params["fb_zoom"],
                       u_fb_rot=params["fb_rot"], u_rgb=params["rgb"],
                       u_glitch=params["glitch"], u_bright=params["bright"],
                       u_strobe=state.strobe, u_invert=int(state.invert),
                       u_mirror=state.mirror, u_cam_mode=state.cam_mode,
                       u_cam_amt=params["cam_amt"], u_cam_key=params["cam_key"],
                       u_clock=state.clock)
        out_fbo.use()
        self._vao(self.post_prog).render(moderngl.TRIANGLES, vertices=3)

    def display(self, fbo, params, viewport=None):
        """Draw the current output (with scanlines/vignette) into `fbo`."""
        tex, _ = self.out[self.cur]
        tex.use(0)
        self._uniforms(self.display_prog, u_tex=0, u_scan=params["scan"], u_res=self.size)
        fbo.use()
        if viewport:
            self.ctx.viewport = viewport
        self._vao(self.display_prog).render(moderngl.TRIANGLES, vertices=3)

    def read_frame(self, params):
        """Return the final picture as an HxWx3 uint8 array (top row first)."""
        tex, fbo = self.readback
        self.display(fbo, params, viewport=(0, 0, *self.size))
        data = fbo.read(components=3, alignment=1)
        img = np.frombuffer(data, dtype=np.uint8).reshape(self.size[1], self.size[0], 3)
        return np.flipud(img)
