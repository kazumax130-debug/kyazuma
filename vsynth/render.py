"""Offline rendering: frame-perfect video at any resolution (4K etc.), synced to music."""

import random
import time

from . import media
from .engine import Engine, State, create_headless_context
from .params import Params, PresetBank
from .shaders import SCENE_NAMES


def parse_timeline(text):
    """'plasma:8,tunnel:4' -> [('plasma', 8.0), ('tunnel', 4.0)]"""
    out = []
    for item in text.split(","):
        name, _, secs = item.strip().partition(":")
        if name not in SCENE_NAMES:
            raise SystemExit(f"不明なシーン '{name}'。使えるシーン: {', '.join(SCENE_NAMES)}")
        out.append((name, float(secs or 8)))
    return out


def scene_at(timeline, t):
    total = sum(d for _, d in timeline)
    t %= total
    for name, d in timeline:
        if t < d:
            return name
        t -= d
    return timeline[-1][0]


def run(args):
    ctx = create_headless_context()
    engine = Engine(ctx, args.size)
    params = Params(glide=args.glide)
    state = State(args.scene)
    rng = random.Random(args.seed)

    if args.preset:
        p = PresetBank(args.presets).get(args.preset)
        if not p:
            raise SystemExit(f"プリセット {args.preset} が {args.presets} にありません")
        params.load_dict(p["params"], instant=True)
        state.scene = state.prev_scene = p.get("scene", state.scene)
    for kv in args.set or []:
        k, _, v = kv.partition("=")
        params.set(k, float(v), instant=True)
    state.invert = args.invert
    state.mirror = args.mirror

    track = None
    if args.music:
        from .audio import AudioTrack
        track = AudioTrack(args.music)
    duration = args.duration or (track.duration if track else 10.0)

    movie = None
    if args.input_video:
        movie = media.MovieInput(args.input_video, fps=args.fps)
        state.cam_mode = args.cam_mode

    timeline = parse_timeline(args.scenes) if args.scenes else None
    if timeline:
        state.scene = state.prev_scene = timeline[0][0]

    out = args.out or media.timestamped(args.outdir, ext=media.CODECS[args.codec][1])
    writer = media.VideoWriter(out, engine.size, args.fps, codec=args.codec,
                               audio_path=args.music, threaded=False)

    n = int(round(duration * args.fps))
    dt = 1.0 / args.fps
    auto_last = 0.0
    t0 = time.perf_counter()
    print(f"レンダリング {engine.size[0]}x{engine.size[1]} {args.fps}fps {duration:.1f}s "
          f"({n} フレーム) -> {out}")
    try:
        for i in range(n):
            t = i * dt
            audio = track.bands_at(t) if track else (0.0, 0.0, 0.0)
            if timeline:
                state.set_scene(scene_at(timeline, t))
            elif args.auto:
                hit = audio[0] > 0.92 and t - auto_last > 2.0
                if hit or t - auto_last > args.auto_interval:
                    state.set_scene(rng.choice([s for s in SCENE_NAMES if s != state.scene]))
                    params.set("hue", rng.random())
                    auto_last = t
            if movie:
                engine.set_camera_frame(movie.read())

            params.update(dt)
            state.advance(dt, params)
            engine.render(params, state, audio)
            writer.write(engine.read_frame(params))

            if i % max(1, args.fps) == 0 or i == n - 1:
                el = time.perf_counter() - t0
                eta = el / (i + 1) * (n - i - 1)
                print(f"\r  {i + 1}/{n}  {100 * (i + 1) / n:5.1f}%  残り {eta:5.0f}s", end="", flush=True)
    finally:
        writer.close()
        if movie:
            movie.close()
    print(f"\n完了: {out}")
    return 0
