# vsynth — Python ヴィジュアルシンセサイザー

Python + GPU シェーダー (GLSL) で動くビデオシンセです。撮影で使う前提で作っています。

- **ライブモード**: ウィンドウやプロジェクターに映して、キーボードで演奏します。そのまま録画もできます
- **レンダーモード**: 4K などの高解像度で、フレーム落ちのない動画を書き出します。音楽に同期させられます
- **カメラ/動画入力**: 撮った映像をシンセに通して合成・変形できます

## セットアップ

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 任意
pip install sounddevice            # マイクの音に反応させる場合
pip install opencv-python          # Webカメラを合成する場合
```

OpenGL 3.3 が動く PC なら動きます (Mac / Windows / Linux)。

## 使い方

### 1. ライブで演奏・録画

```bash
python -m vsynth live                                  # 1280x720 のウィンドウで起動
python -m vsynth live --size 1920x1080                 # 1080p で描画・録画 (ウィンドウには縮小表示)
python -m vsynth live --fullscreen --display 1         # 2台目のモニター/プロジェクターに全画面表示
python -m vsynth live --audio                          # マイクの音に反応
python -m vsynth live --camera 0                       # Webカメラを合成
python -m vsynth live --size 1920x1080 --fixed-step    # 録画をカクつかせない (下の説明を参照)
```

| キー | 操作 |
|---|---|
| `1`〜`6` | シーン切替 (クロスフェード) : plasma / tunnel / kaleido / lines / rings / flow |
| `Q`/`A` | 速さ |
| `W`/`S` | 色相 |
| `E`/`D` | ズーム |
| `R`/`F` | ワープ (歪み) |
| `T`/`G` | 複雑さ |
| `Y`/`H` | フィードバック (残像・トレイル) |
| `U`/`J` | フィードバックのズーム (トンネル状に吸い込まれる/広がる) |
| `I`/`K` | グリッチ |
| `O`/`L` | RGB ずれ |
| `↑`/`↓` → `←`/`→` | すべてのパラメータを選んで調整 (彩度・明るさ・走査線・回転など) |
| `Shift` + 上記 | 微調整 |
| `SPACE` (押している間) | ストロボ |
| `V` / `B` | 反転 / ミラー (切 → 左右 → 4分割) |
| `C` | カメラ合成モード (切 → スクリーン → ルマキー → ディスプレイス) |
| `N` / `0` | ランダム / リセット |
| `X` | 一時停止 |
| `Z` | オートモード (一定間隔と低音のキックで自動的にシーンを切り替える) |
| `F1`〜`F8` | プリセット呼び出し。`Shift`+`F1`〜`F8` で今の状態を保存 |
| `ENTER` | 録画の開始/停止 (`recordings/` に保存) |
| `P` | スクリーンショット (PNG) |
| `ESC` | 終了 |

パラメータを変えると値がなめらかに変わるので、カメラで撮っても段差が出ません (`--glide` で速さを変えられます)。
選択中のパラメータと値はウィンドウのタイトルバーに表示されます。画面には文字を一切出さないので、そのまま撮影できます。

### 2. 高画質な動画を書き出す

```bash
# 4K 60fps で 30 秒
python -m vsynth render --size 3840x2160 --duration 30 --scene flow

# 曲に合わせてシーンを自動で切り替え、音も動画に入れる (mp3/wav/m4a など)
python -m vsynth render --music song.mp3 --auto --set feedback=0.7

# シーンの順番と秒数を指定
python -m vsynth render --scenes plasma:8,tunnel:4,kaleido:8,flow:10 --duration 30

# 編集用の ProRes 422 HQ (.mov)
python -m vsynth render --codec prores --duration 20

# ライブで作ったプリセット 3 の見た目で書き出す
python -m vsynth render --preset 3 --duration 20

# 撮影した動画をシンセに通す (1=スクリーン 2=ルマキー 3=ディスプレイス)
python -m vsynth render --input-video dance.mp4 --cam-mode 2 --scene kaleido
```

`--set 名前=値` で指定できるパラメータ:
`speed hue sat zoom warp complexity feedback fb_zoom fb_rot rgb glitch scan bright audio_gain cam_amt cam_key`

1 フレームずつ計算するので、PC が遅くても書き出した動画はなめらかです。

## 撮影のコツ

**画面をカメラで撮る場合 (モニター、プロジェクター、LED)**
- フリッカーや横縞が出るときは、シャッタースピードをリフレッシュレートに合わせます (60Hz の画面なら 1/60 か 1/30)。
- モアレが出るときは、ピントを少し画面から外すか、`rings` や `lines` のような細かい模様を避けます。`complexity` を下げても効きます。
- 人物に映像を投影するときは `--fullscreen --display 1` でプロジェクターに出します。`feedback` を上げると光が流れるように見えます。

**カメラ映像を合成する場合 (`--camera 0` / `--input-video`)**
- **ルマキー**: カメラ映像の明るい部分をそのまま残し、暗い部分をシンセに置き換えます。黒い背景の前に人物を明るく照らすと、シンセの背景の前に人物が立っている映像になります。境目は `cam_key` で調整します。
- **ディスプレイス**: カメラ映像の明るさでシンセを歪ませます。人の動きで模様が波打ちます。
- **スクリーン**: 単純に光として重ねます。

**ライブ録画の注意**
- 描画が重くて 60fps に届かないと、録画した動画が速回しになります。そのときは `--fixed-step` を付けてください。録画中は画面が少しゆっくり動く代わりに、動画は正しい速さでなめらかになります。
- 本番用の素材は `render` モードで書き出すのが一番きれいです。ライブでプリセットを作り (`Shift+F1`)、`render --preset 1` で書き出す流れがおすすめです。

## シーンを自作する

`vsynth/shaders.py` の `SCENES` に GLSL を 1 つ足すと、新しいシーンになります。
`u_time` `u_hue` `u_warp` `u_complexity` `u_audio`(低/中/高音) などのユニフォームと、`palette()` `fbm()` `centered()` といった関数が使えます。

```glsl
void main() {
    vec2 p = centered();
    float v = sin(length(p) * 20.0 * u_complexity - u_time * 3.0);
    f_color = vec4(palette(v * 0.2 + u_audio.x), 1.0);
}
```

## テスト

```bash
pip install pytest
python -m pytest
```
