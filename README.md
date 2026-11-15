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

### 3. 曲に同期した MV 素材を書き出す (`sync`)

DAW から書き出した曲 (WAV / AIFF / mp3 / m4a) を指定すると、音に合わせて動く映像を音声付きの MP4 で書き出します。

```bash
# いちばん簡単な使い方: recordings/<曲名>_vsynth.mp4 ができる (1080p 30fps)
python -m vsynth sync song.wav

# まず軽い解像度でプレビュー → OK なら 4K で本番
python -m vsynth sync song.wav --size 960x540
python -m vsynth sync song.wav --size 3840x2160 --codec prores

# テンポを指定すると小節で指定できる (例: 120 BPM の 41 小節目から 8 小節だけ)
python -m vsynth sync song.wav --bpm 120 --start-bar 41 --bars 8

# 小節単位でシーンを進める (イントロ 40 小節は flow、次の 16 小節は kaleido ...)
python -m vsynth sync song.wav --bpm 120 --scenes flow:40,kaleido:16,tunnel:16,flow:24

# 反応の強さを調整 (0 にするとその反応は無効)
python -m vsynth sync song.wav --bass-zoom 0.4 --high-glitch 0.2 --high-rgb 0 --kick-flash 0.1
```

**音と映像の対応**

| オプション | 既定値 | 反応する音 | 映像の変化 |
|---|---|---|---|
| `--bass-zoom` | 0.25 | 低音・キック | ズームイン (0.3 で最大 +30%) |
| `--bass-fb` | 0.3 | 低音・キック | フィードバックがトンネル状に吸い込まれる |
| `--bass-warp` | 0 | 低音 | 歪みが強くなる |
| `--high-glitch` | 0.45 | ハイハット・ゴーストノートなど高音のアタック | 横ずれのグリッチ |
| `--high-rgb` | 0.3 | 高音 | RGB ずれ |
| `--kick-flash` | 0.15 | キック | 明るさのフラッシュ |
| `--mid-hue` | 0 | 中音 (エレピ・パッドなど) | 色相がゆっくり回る |
| `--sensitivity` | 0 | — | アタック検出の感度。ドラムが控えめな曲は 0.5〜1 に上げる |

- 曲は書き出し前に **全体を一度解析** します。音量は曲全体を基準にそろえるので、静かなイントロでは控えめに、サビでは大きく動きます。途中の小節だけを書き出しても、通しで書き出したときと同じ動きになります (編集でつないでもずれません)。
- `render --music song.wav` でも同じ `--bass-zoom` などのオプションが使えます (`render` の既定値はすべて 0)。
- `--preset` `--set` で決めた見た目に、音の反応が上乗せされます。ライブモードで見た目を作り (`Shift+F1`)、`sync song.wav --preset 1` で書き出す流れがおすすめです。
- `--start-bar` / `--scenes` を小節で合わせるには、DAW で **1 小節目の頭から** 書き出してください (前に無音があるとずれます)。

**アンビエント寄りの曲の例** (ドラム控えめ、エレピとパッドが主役):

```bash
python -m vsynth sync song.wav --bpm 120 --scene flow \
  --set speed=0.5 --set feedback=0.85 --set sat=0.7 \
  --bass-zoom 0.15 --high-glitch 0.15 --high-rgb 0.1 --mid-hue 0.4 --sensitivity 0.8
```

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
