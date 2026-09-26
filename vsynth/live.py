"""Live performance window: play the synth with the keyboard and record it."""

import random
import sys
import time
import warnings

import moderngl
import pygame

from . import media
from .engine import Engine, State
from .params import NAMES, Params, PresetBank
from .shaders import SCENE_NAMES

# Direct keys: (increase, decrease) -> parameter
PAIRS = {
    (pygame.K_q, pygame.K_a): "speed",
    (pygame.K_w, pygame.K_s): "hue",
    (pygame.K_e, pygame.K_d): "zoom",
    (pygame.K_r, pygame.K_f): "warp",
    (pygame.K_t, pygame.K_g): "complexity",
    (pygame.K_y, pygame.K_h): "feedback",
    (pygame.K_u, pygame.K_j): "fb_zoom",
    (pygame.K_i, pygame.K_k): "glitch",
    (pygame.K_o, pygame.K_l): "rgb",
}
KEYMAP = {}
for (up, down), name in PAIRS.items():
    KEYMAP[up] = (name, +1)
    KEYMAP[down] = (name, -1)

FKEYS = [pygame.K_F1, pygame.K_F2, pygame.K_F3, pygame.K_F4,
         pygame.K_F5, pygame.K_F6, pygame.K_F7, pygame.K_F8]

HELP = """
==================== vsynth キー操作 ====================
 1-6        シーン切替 (クロスフェード)  {scenes}
 Q/A 速さ   W/S 色相   E/D ズーム   R/F ワープ   T/G 複雑さ
 Y/H フィードバック量  U/J フィードバックのズーム
 I/K グリッチ   O/L RGBずれ
 ↑/↓        パラメータ選択   ←/→ 選択中のパラメータを調整
 Shift+キー 微調整
 SPACE(押す間) ストロボ    V 反転   B ミラー(切/左右/4分割)
 C カメラ合成モード (切/スクリーン/ルマキー/ディスプレイス)
 N ランダム   0 リセット   X 一時停止   Z オート(自動シーン切替)
 F1-F8 プリセット呼出   Shift+F1-F8 プリセット保存
 ENTER 録画 開始/停止   P スクリーンショット(PNG)
 ESC 終了
=========================================================
"""


def letterbox(win, size):
    ww, wh = win
    s = min(ww / size[0], wh / size[1])
    w, h = int(size[0] * s), int(size[1] * s)
    return ((ww - w) // 2, (wh - h) // 2, w, h)


def run(args):
    pygame.display.init()  # not pygame.init(): we don't need pygame's audio mixer
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_MAJOR_VERSION, 3)
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_MINOR_VERSION, 3)
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_PROFILE_MASK,
                                    pygame.GL_CONTEXT_PROFILE_CORE)
    flags = pygame.OPENGL | pygame.DOUBLEBUF
    if args.fullscreen:
        flags |= pygame.FULLSCREEN
        win_size = (0, 0)
    else:
        win_size = args.window or args.size
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # "vsync not available" on some drivers
        pygame.display.set_mode(win_size, flags, display=args.display, vsync=1)
    win_size = pygame.display.get_window_size()
    pygame.mouse.set_visible(not args.fullscreen)
    pygame.key.set_repeat(250, 30)

    ctx = moderngl.create_context()
    render_size = args.size or win_size
    engine = Engine(ctx, render_size)
    params = Params(glide=args.glide)
    state = State(args.scene)
    bank = PresetBank(args.presets)
    if args.preset:
        _recall(bank, args.preset, params, state)

    mic = None
    if args.audio:
        try:
            from .audio import MicInput
            mic = MicInput(device=args.audio_device)
            print("🎤 マイク入力: ON")
        except Exception as e:  # noqa: BLE001
            print(f"マイク入力を開始できませんでした: {e}")
    cam = None
    if args.camera is not None:
        try:
            cam = media.Camera(args.camera)
            state.cam_mode = 2
            print(f"📷 カメラ {args.camera}: ON (C キーで合成モード切替)")
        except Exception as e:  # noqa: BLE001
            print(f"カメラを開けませんでした: {e}")

    print(HELP.format(scenes=" ".join(f"{i + 1}:{n}" for i, n in enumerate(SCENE_NAMES))))
    print(f"描画解像度 {render_size[0]}x{render_size[1]} / ウィンドウ {win_size[0]}x{win_size[1]}")

    selected = NAMES.index("warp")
    writer = None
    rec_start = 0.0
    auto = False
    auto_last = 0.0
    audio_on = True
    clock = pygame.time.Clock()
    last = time.perf_counter()
    title_t = 0.0

    def stop_recording():
        nonlocal writer
        if writer:
            n = writer.frames
            writer.close()
            print(f"⏹  録画停止: {writer.path} ({n} フレーム)")
            writer = None

    running = True
    while running:
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                running = False
            elif ev.type == pygame.KEYDOWN:
                mods = pygame.key.get_mods()
                shift = bool(mods & pygame.KMOD_SHIFT)
                k = ev.key
                if k == pygame.K_ESCAPE:
                    running = False
                elif k in KEYMAP:
                    name, d = KEYMAP[k]
                    params.nudge(name, d, fine=shift)
                    selected = NAMES.index(name)
                elif pygame.K_1 <= k <= pygame.K_9 and k - pygame.K_1 < len(SCENE_NAMES):
                    state.set_scene(SCENE_NAMES[k - pygame.K_1])
                elif k == pygame.K_UP:
                    selected = (selected - 1) % len(NAMES)
                elif k == pygame.K_DOWN:
                    selected = (selected + 1) % len(NAMES)
                elif k in (pygame.K_LEFT, pygame.K_RIGHT):
                    params.nudge(NAMES[selected], 1 if k == pygame.K_RIGHT else -1, fine=shift)
                elif k == pygame.K_v:
                    state.invert = not state.invert
                elif k == pygame.K_b:
                    state.mirror = (state.mirror + 1) % 3
                elif k == pygame.K_c:
                    state.cam_mode = (state.cam_mode + 1) % 4
                    print("カメラ合成:", ["OFF", "スクリーン", "ルマキー", "ディスプレイス"][state.cam_mode])
                elif k == pygame.K_n:
                    params.randomize()
                elif k == pygame.K_0:
                    params.reset()
                elif k == pygame.K_x:
                    state.frozen = not state.frozen
                elif k == pygame.K_z:
                    auto = not auto
                    print("オートモード:", "ON" if auto else "OFF")
                elif k == pygame.K_m:
                    audio_on = not audio_on
                elif k in FKEYS:
                    slot = FKEYS.index(k) + 1
                    if shift:
                        bank.store(slot, state.scene, params)
                        print(f"💾 プリセット {slot} に保存")
                    elif not _recall(bank, slot, params, state):
                        print(f"プリセット {slot} は空です (Shift+F{slot} で保存)")
                elif k in (pygame.K_RETURN, pygame.K_KP_ENTER):
                    if writer:
                        stop_recording()
                    else:
                        ext = media.CODECS[args.codec][1]
                        path = media.timestamped(args.outdir, ext=ext)
                        writer = media.VideoWriter(path, engine.size, args.fps, codec=args.codec)
                        rec_start = state.clock
                        print(f"⏺  録画開始: {path}")
                elif k == pygame.K_p:
                    path = media.timestamped(args.outdir, prefix="still", ext=".png")
                    media.save_png(path, engine.read_frame(params))
                    print(f"📸 {path}")

        # --- timing ---------------------------------------------------
        now = time.perf_counter()
        dt = min(now - last, 0.1)
        last = now
        if writer and args.fixed_step:
            dt = 1.0 / args.fps  # every recorded frame advances exactly one frame

        keys = pygame.key.get_pressed()
        state.strobe = 1.0 if keys[pygame.K_SPACE] else max(0.0, state.strobe - dt * 8)

        audio = (0.0, 0.0, 0.0)
        if mic and audio_on:
            audio = mic.bands()
        if cam:
            frame = cam.read()
            if frame is not None:
                engine.set_camera_frame(frame)

        if auto:
            hit = audio[0] > 0.92 and state.clock - auto_last > 2.0
            if hit or state.clock - auto_last > args.auto_interval:
                choices = [s for s in SCENE_NAMES if s != state.scene]
                state.set_scene(random.choice(choices))
                params.set("hue", random.random())
                auto_last = state.clock

        params.update(dt)
        state.advance(dt, params)

        # --- draw -----------------------------------------------------
        engine.render(params, state, audio)
        if writer:
            writer.write(engine.read_frame(params))
        ctx.screen.use()
        ctx.viewport = (0, 0, *win_size)
        ctx.clear(0, 0, 0)
        engine.display(ctx.screen, params, viewport=letterbox(win_size, engine.size))
        pygame.display.flip()
        clock.tick(args.fps if not (writer and args.fixed_step) else 0)

        if now - title_t > 0.25:
            title_t = now
            sel = NAMES[selected]
            rec = f" ●REC {state.clock - rec_start:5.1f}s" if writer else ""
            flags_s = "".join([" AUTO" if auto else "", " FREEZE" if state.frozen else ""])
            pygame.display.set_caption(
                f"vsynth | {state.scene}{rec}{flags_s} | [{sel} {params.target[sel]:.3f}] "
                f"| {clock.get_fps():.0f}fps")

    stop_recording()
    if mic:
        mic.close()
    if cam:
        cam.close()
    pygame.quit()
    return 0


def _recall(bank, slot, params, state):
    p = bank.get(slot)
    if not p:
        return False
    params.load_dict(p["params"])
    if p.get("scene") in SCENE_NAMES:
        state.set_scene(p["scene"])
    print(f"🎛  プリセット {slot} を呼び出し ({p.get('scene')})")
    return True


if __name__ == "__main__":
    sys.exit("python -m vsynth live を使ってください")
