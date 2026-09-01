# Competitive UX Benchmark

**Astra 自身との比較をやめ、VoiceOS / SuperIntern と同じ課題で競わせる。**

これまでの視覚ゲート（2pt / golden / density）は捨てない。ただし**意味を変える**。

```
これまで:  2pt 以内 → 良い UI
これから:  2pt 以内 → 基本造形が崩れていないことの保証だけ（Visual Geometry Gate）
           優劣は Journey の実測で決める
```

同じ Panel で、上辺 0px ずれで、±2pt に収まっていても、**使いにくい製品は作れる**。

---

## 1. いまの状態（正直に）

| | 状態 |
| --- | --- |
| Astra 側の計測 | ✅ 自動（`scripts/ux-benchmark.sh`） |
| VoiceOS の取得 | ❌ **未取得** |
| SuperIntern の取得 | ❌ **未取得** |
| 優劣の判定 | ❌ **出せない**（競合が無いため） |

アシスタントはこの 2 製品を入手できない。競合側は人が撮る。
**取得できていない項目を「勝ち」として数えない** —— `ux-benchmark-report.sh` は
競合データが無い Journey を `未取得` として扱い、SUPERIOR_GATE を通さない。

---

## 2. 置き場所

```
docs/ux-benchmark/
├── voiceos/       V01…  + metadata.yaml   ← 人が撮る
├── superintern/   S01…  + metadata.yaml   ← 人が撮る
├── astra/         A01…  + metadata.yaml   ← scripts/ux-benchmark.sh が撮る
├── journeys/      J01…J10 の課題定義
└── results/       実行結果（JSON）とレポート
```

静止画だけでは足りない。**Morph の良し悪しは動画でしか見えない**ので、
状態が変わる Journey は `.mp4` も撮る。

### metadata.yaml

どの版のどの状態かが分からない比較は、比較ではない。

```yaml
product: VoiceOS
version: 0.1.25          # 「どこかで見た VoiceOS」ではなく、この版
captured_at: 2026-09-01
os: macOS 26.0
resolution: 1920x1080
scale: 2x
source: official | public | live   # 公式素材か、自分で動かしたか
scenario: J01-pointer-context
notes: |
  取得時の条件。ネットワーク、サインイン状態、初回かどうか。
```

---

## 3. 測るもの

Journey ごとに、3 製品へ**同じ課題**を与えて測る。

| 指標 | 取り方 |
| --- | --- |
| task success | 完遂したか（0/1） |
| completion time | 開始から完遂まで（ms） |
| interaction count | クリック・キー入力の回数 |
| window count | 増えた窓の数（0 が正） |
| focus theft | 前面アプリを奪った回数（0 が正） |
| state transition latency | 状態が変わるまで（ms） |
| errors | 失敗・やり直しの回数 |
| screenshots | 各段階 |
| screen recording | 状態が変わる Journey |

主観（SEQ 1–7 / Trust / A-B Preference）は人が答える。
成功率・所要時間・誤りと主観を**組み合わせる**のが要点で、満足度だけでは足りない。

---

## 4. SUPERIOR_GATE

「Astra のほうが優れている」を感想ではなく条件にする。

| 指標 | 条件 |
| --- | --- |
| task success | ≥ 95% |
| focus theft | 0 |
| 不要な窓 | 0 |
| Golden Journey 勝利 | 8 個中 6 以上 |
| time-on-task | 最良競合より平均 10% 以上速い |
| 操作数 | 最良競合以下 |
| first-run success | ≥ 90% |
| SEQ | ≥ 6.0 / 7 |
| Trust | ≥ 6.0 / 7 |
| A/B preference | Astra ≥ 60% |
| critical regression | 0 |

社内なら 12 人で方向は見える。**強く主張するなら 20 人以上**にして、
3 製品を触る順序を参加者ごとに入れ替える（順序の効果を消すため）。

---

## 5. 進め方

```
競合を撮る → Journey を定義 → Astra を走らせる
   → 差分・操作ログ・時間・窓/焦点ログ・録画
   → Benchmark Score
   → **負けている項目を 1 つだけ**直す
   → 再実行
```

一度に全部直さない。J04 で負けているなら J04 だけ直し、勝ってから J05 へ進む。
