"""Offline rendering: frame-perfect video at any resolution (4K etc.), synced to music."""

import os
import random
import subprocess
import tempfile
import time

from . import media
from .engine import Engine, State, create_headless_context
from .params import Params, PresetBank
from .shaders import SCENE_NAMES
from .sync import Modulator, Reactivity

REACT_KEYS = tuple(Reactivity.__dataclass_fields__)


def reactivity_from_args(args):
    return Reactivity(**{k: getattr(args, k, None) or 0.0 for k in REACT_KEYS})


def bar_seconds(args):
    """Seconds per bar from --bpm / --beats-per-bar (None when no tempo was given)."""
    bpm = getattr(args, "bpm", None)
    return 60.0 / bpm * getattr(args, "beats_per_bar", 4) if bpm else None


def trim_audio(path, start, duration):
    """Cut [start, start+duration] out of `path` into a temporary wav (for the video's sound)."""
    import imageio_ffmpeg

    fd, out = tempfile.mkstemp(suffix=".wav", prefix="vsynth_")
    os.close(fd)
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-ss", f"{start:.3f}",
           "-t", f"{duration:.3f}", "-i", str(path), "-c:a", "pcm_s16le", out]
    subprocess.run(cmd, check=True)
    return out


def parse_timeline(text, unit=1.0):
    """'plasma:8,tunnel:4' -> [('plasma', 8.0), ('tunnel', 4.0)]

    `unit` scales the numbers (e.g. seconds per bar when --bpm is given).
    """
    out = []
    for item in text.split(","):
        name, _, secs = item.strip().partition(":")
        if name not in SCENE_NAMES:
            raise SystemExit(f"不明なシーン '{name}'。使えるシーン: {', '.join(SCENE_NAMES)}")
        out.append((name, float(secs or 8) * unit))
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

    track = feats = None
    bar = bar_seconds(args)
    start = getattr(args, "start", 0.0) or 0.0
    if getattr(args, "start_bar", None):
        if not bar:
            raise SystemExit("--start-bar には --bpm が必要です")
        start = (args.start_bar - 1) * bar
    if getattr(args, "bars", None):
        if not bar:
            raise SystemExit("--bars には --bpm が必要です")
        args.duration = args.bars * bar
    if args.music:
        from .audio import AudioTrack
        track = AudioTrack(args.music)
        if start >= track.duration:
            raise SystemExit(f"--start {start}s が曲の長さ ({track.duration:.1f}s) を超えています")
    duration = args.duration or (track.duration - start if track else 10.0)
    if track:
        duration = min(duration, track.duration - start)
        print("音を解析中...", flush=True)
        feats = track.features(args.fps, start, duration, getattr(args, "sensitivity", 0.0) or 0.0)
    react = reactivity_from_args(args)
    mod = Modulator(react) if feats and react.active() else None

    movie = None
    if args.input_video:
        movie = media.MovieInput(args.input_video, fps=args.fps)
        state.cam_mode = args.cam_mode

    timeline = parse_timeline(args.scenes, bar or 1.0) if args.scenes else None
    if timeline:
        state.scene = state.prev_scene = timeline[0][0]

    out = args.out or media.timestamped(args.outdir, ext=media.CODECS[args.codec][1])
    audio_path, tmp_audio = args.music, None
    if track and (start > 0 or duration < track.duration - 1e-3):
        audio_path = tmp_audio = trim_audio(args.music, start, duration)
    writer = media.VideoWriter(out, engine.size, args.fps, codec=args.codec,
                               audio_path=audio_path, threaded=False)

    n = int(round(duration * args.fps))
    dt = 1.0 / args.fps
    auto_last = 0.0
    t0 = time.perf_counter()
    if mod:
        on = ", ".join(f"{k}={v:g}" for k, v in vars(react).items() if v)
        print(f"音への反応: {on}")
    print(f"レンダリング {engine.size[0]}x{engine.size[1]} {args.fps}fps {duration:.1f}s "
          f"({n} フレーム) -> {out}")
    try:
        for i in range(n):
            t = start + i * dt  # song time, so --scenes lines up with the song
            audio = feats.bands(i) if feats else (0.0, 0.0, 0.0)
            if timeline:
                state.set_scene(scene_at(timeline, t))
            elif args.auto:
                hit = feats is not None and feats.kick[i] > 0.9 and t - auto_last > 2.0
                if hit or t - auto_last > args.auto_interval:
                    state.set_scene(rng.choice([s for s in SCENE_NAMES if s != state.scene]))
                    params.set("hue", rng.random())
                    auto_last = t
            if movie:
                engine.set_camera_frame(movie.read())

            params.update(dt)
            state.advance(dt, params)
            if mod:
                with mod.apply(params, feats.at(i), dt):
                    engine.render(params, state, audio)
                    frame = engine.read_frame(params)
            else:
                engine.render(params, state, audio)
                frame = engine.read_frame(params)
            writer.write(frame)

            if i % max(1, args.fps) == 0 or i == n - 1:
                el = time.perf_counter() - t0
                eta = el / (i + 1) * (n - i - 1)
                print(f"\r  {i + 1}/{n}  {100 * (i + 1) / n:5.1f}%  残り {eta:5.0f}s", end="", flush=True)
    finally:
        writer.close()
        if movie:
            movie.close()
        if tmp_audio:
            os.remove(tmp_audio)
    print(f"\n完了: {out}")
    return 0
