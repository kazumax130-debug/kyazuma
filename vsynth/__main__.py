"""Command line: `python -m vsynth live` / `python -m vsynth render`."""

import argparse
import sys

from .media import CODECS
from .params import NAMES
from .shaders import SCENE_NAMES


def size(text):
    try:
        w, h = text.lower().split("x")
        return int(w), int(h)
    except ValueError:
        raise argparse.ArgumentTypeError("サイズは 1920x1080 の形式で指定してください") from None


def param_assign(text):
    k, sep, v = text.partition("=")
    if not sep or k not in NAMES:
        raise argparse.ArgumentTypeError(f"'{text}': 名前=値 の形式で。名前は {', '.join(NAMES)}")
    float(v)
    return text


def main(argv=None):
    ap = argparse.ArgumentParser(prog="vsynth", description="Python ヴィジュアルシンセサイザー")
    sub = ap.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--scene", choices=SCENE_NAMES, default="plasma", help="最初のシーン")
    common.add_argument("--fps", type=int, default=60)
    common.add_argument("--codec", choices=CODECS, default="h264",
                        help="h264=mp4 / prores=mov (編集向け高画質)")
    common.add_argument("--outdir", default="recordings", help="保存先フォルダ")
    common.add_argument("--presets", default="presets.json", help="プリセットファイル")
    common.add_argument("--preset", type=int, help="起動時に読み込むプリセット番号")
    common.add_argument("--glide", type=float, default=4.0,
                        help="パラメータ変化のなめらかさ (大きいほど速い, 0で即時)")
    common.add_argument("--auto-interval", type=float, default=8.0,
                        help="オートモードでシーンを切り替える間隔(秒)")

    lv = sub.add_parser("live", parents=[common], help="ウィンドウでリアルタイム演奏・録画")
    lv.add_argument("--size", type=size, help="描画/録画解像度 (例 1920x1080)。省略時はウィンドウと同じ")
    lv.add_argument("--window", type=size, help="ウィンドウサイズ (既定 1280x720)")
    lv.add_argument("--fullscreen", action="store_true", help="全画面 (プロジェクター/モニター撮影用)")
    lv.add_argument("--display", type=int, default=0, help="全画面にするモニター番号 (0,1,...)")
    lv.add_argument("--audio", action="store_true", help="マイク入力で音に反応 (要 sounddevice)")
    lv.add_argument("--audio-device", default=None, help="オーディオ入力デバイス名/番号")
    lv.add_argument("--camera", type=int, help="Webカメラ番号を合成 (要 opencv-python)")
    lv.add_argument("--fixed-step", action="store_true",
                    help="録画中は1フレーム=1/fps秒で進める (重い設定でもカクつかない動画に)")

    rd = sub.add_parser("render", parents=[common], help="高解像度で動画ファイルに書き出し")
    rd.add_argument("--size", type=size, default=(1920, 1080), help="解像度 (例 3840x2160)")
    rd.add_argument("--duration", type=float, help="秒数 (省略時は音楽の長さ or 10秒)")
    rd.add_argument("--out", help="出力ファイル名")
    rd.add_argument("--music", help="音楽ファイル: 映像が音に反応し、音声も動画に入ります")
    rd.add_argument("--scenes", help="シーン進行 例: plasma:8,tunnel:4,kaleido:8 (シーン:秒)")
    rd.add_argument("--auto", action="store_true", help="シーンを自動で切り替える")
    rd.add_argument("--seed", type=int, default=1, help="オートモードの乱数シード")
    rd.add_argument("--set", action="append", type=param_assign, metavar="名前=値",
                    help="パラメータ指定 (複数可) 例: --set warp=1.5 --set feedback=0.8")
    rd.add_argument("--input-video", help="撮影した動画をシンセに通す (カメラ入力の代わり)")
    rd.add_argument("--cam-mode", type=int, choices=[1, 2, 3], default=2,
                    help="入力動画の合成: 1=スクリーン 2=ルマキー 3=ディスプレイス")
    rd.add_argument("--invert", action="store_true")
    rd.add_argument("--mirror", type=int, choices=[0, 1, 2], default=0)

    args = ap.parse_args(argv)
    if args.cmd == "live":
        if not args.size and not args.window:
            args.window = (1280, 720)
        from . import live
        return live.run(args)
    from . import render
    return render.run(args)


if __name__ == "__main__":
    sys.exit(main())
