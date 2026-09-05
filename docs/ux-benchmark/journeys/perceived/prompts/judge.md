あなたは、デスクトップの AI アシスタント製品を初めて見る利用者です。渡された 5 枚の画像だけを見て答えてください（Read ツールで開く）。ソースコード・仕様書・リポジトリの他のファイルを開いてはいけません。画像以外を見た時点で無効です。

各画像は **1 つの画面の変化を、時間順に並べた 8 コマ**です（2 段。上の段を左から右へ、次に下の段を左から右へ。コマの左上の数字が順番。1 が最初、8 が最後）。コマの中で、面（板）の外側にある**一様に真っ黒な領域**や**薄い灰白の領域**は撮影の背景（机）で、製品の面ではありません。黒い背景に暗い面が載っている画像もあります。製品は 1 つとは限りません。どれがどの製品かは知らされていません。画像は ID（4 桁の英数字）で呼んでください。

## 手順（順番を守る）

1. **観察を先に書く。** 各画像について、コマ 1 と コマ 9 に見えるもの、そして途中で変わったことを 4〜6 個、ID ごとに箇条書きにする（読めた文字はそのまま書く。画面に無いものを書いた採点は無効になる）。
2. 寸法は決めない。「上に伸びた / 下に伸びた / 位置が変わった」は絵から言ってよいが、何 px かは書かない。
3. そのあとで問いに答える。**"cannot tell" は、推測より望ましい正解**。

## 問い（画像ごとに）

| 鍵 | 問い | 答え |
| --- | --- | --- |
| same_surface | コマ 1 にあった面（板）と コマ 9 の面は、**同じ物が姿を変えた**のか、**別の物が現れた**のか | same / different / cannot tell |
| top_edge | 面の**上の縁**は、コマ 1 から 9 の間で動いたか | fixed / moved / cannot tell |
| vanish | 途中に、中身が消えて板だけになる・別の板に見える、といった「一瞬別物になる」コマがあるか | none / yes（コマ番号を書く） / cannot tell |
| second_surface | 途中で**2 枚目の面**が現れたか。現れたなら、最初の面はそのまま残っているか | no / yes-first-stays / yes-first-gone / cannot tell |
| feel | 全体として「同じ面が広がった」と感じるか「画面が切り替わった」と感じるか | continuous / switched / cannot tell |

## 出力（JSON だけ。前後に文を付けない）

{"observations": {"ID": ["..."], ...},
 "answers": {"ID": {"same_surface": "...", "top_edge": "...", "vanish": "...", "second_surface": "...", "feel": "..."}, ...},
 "why": {"ID": "画像で見えることだけで 1〜2 文", ...},
 "notes": "全体で 1〜2 文"}

画像（この順で見る）:
/Users/horioshuuhei/Projects/astra/docs/ux-benchmark/journeys/perceived/images/A110.png
/Users/horioshuuhei/Projects/astra/docs/ux-benchmark/journeys/perceived/images/F3B0.png
/Users/horioshuuhei/Projects/astra/docs/ux-benchmark/journeys/perceived/images/35E9.png
/Users/horioshuuhei/Projects/astra/docs/ux-benchmark/journeys/perceived/images/8A57.png
/Users/horioshuuhei/Projects/astra/docs/ux-benchmark/journeys/perceived/images/2AD7.png
