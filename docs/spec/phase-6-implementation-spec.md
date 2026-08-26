# Astra — Phase 6 実装仕様書

| 項目       | 内容                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| 正本       | `docs/spec/new_ai_platform_design_spec_v0.1.md` §2.1・§10・§28 Phase 6 |
| UI/UX 正本 | `docs/spec/astra_ui_ux_detailed_spec_v0.1.docx` §8                     |
| 前提       | Phase 0 / 2 / 3 / 4 / 5 完了                                           |
| 版         | 0.1（2026-08-26）                                                      |

---

## 0. Exit

正本 §28 Phase 6:

> 「今日気にすべきこと」が精度高く出る

```text
AC6-1  会話や会議から commitment が拾われ、**どこから来たか**が残る
AC6-2  出所を示せない commitment は作られない
AC6-3  済んだ commitment は出てこない
AC6-4  期限のあるものが、期限の近さに応じて上に来る
AC6-5  Attention は 3 件を超えて出ない
AC6-6  黙っていたほうがよいものは出ない（InterruptionCost）
AC6-7  記憶するのは方針に合うものだけ（全会話は残さない）
AC6-8  entity は重複せず、同じ人物・案件がひとつに寄る
AC6-9  daily brief が、根拠のある項目だけで組まれる
AC6-10 別テナントの世界は見えない
```

---

## 1. 決めておくこと

### 1.1 全部は覚えない

正本 §10.3 が「全会話を"記憶"にしない」と決めている。
保存してよいのは次だけ:

```text
explicit preferences / commitments / decisions /
recurring people・projects / artifact lineage / task status / approved corrections
```

**それ以外は書かない。**「後で役に立つかもしれない」で溜めると、
検索の精度が落ち、消す責任だけが残る。

### 1.2 出所の無い記憶は作らない

commitment も decision も、**どこで生まれたか**を持つ
（会議の segment、task、artifact）。出所を示せないものは作らない。

会議の引用（Phase 3 §5）と同じ考え方。**モデルの言い分ではなく、
辿れることで信用を作る。**

### 1.3 黙っている価値を式に入れる

正本 §2.1:

```text
ProactiveScore = Importance × Urgency × Confidence × UserRelevance - InterruptionCost
```

`InterruptionCost` を引くのは、**話しかけない選択に価値がある**から。
これが無いと、スコアは「出せるものは全部出す」に退化する。

UI/UX §8.1: Attention は最大 3 件。4 件目以降は「すべて見る」。

### 1.4 同じ人を二度作らない

`world_entities` は名前で寄せる。正規化した名前 + 種別で一意にし、
出てくるたびに `mention_count` を増やす。
**別人だった場合に分ける手段は要る**が、初期版は寄せる側に倒す
（正本 §10.1 は "recurring people/projects" を記憶対象にしている）。

---

## 2. データモデル

正本 §10.2 の表をそのまま作る。Graph DB は入れない。

```text
world_entities    人・組織・案件・会議・タスク…の現在状態
world_edges       entity どうしの関係（正本 §10.1 の 8 種）
world_facts       commitment / decision / preference。**出所を必ず持つ**
world_events      いつ何が起きたか（append-only）
```

`world_embeddings` は検索を実装する段で足す（OQ-22）。
**要るまで作らない。**空の表は「実装済み」に見えて誤解を生む。

---

## 3. Commitment

```text
what        何をするか
who         誰が（entity への参照。分からなければ null。埋めない）
due         いつまでに（無いこともある）
status      OPEN | DONE | DROPPED
source      どこで生まれたか（meeting_segment / task / artifact）
```

- **済んだものは出さない**（AC6-3）
- 期限が無いものは、期限があるものより後ろ（AC6-4）
- `DROPPED` は消さずに残す。「やらないことにした」も記録

---

## 4. Daily brief

「今日気にすべきこと」を組む。**根拠のある項目だけ**で作る。

```text
1. 今日締め切りの commitment
2. 期限を過ぎた commitment
3. 直近で終わった長時間 task
4. 確認待ちの approval
5. 次の会議
```

各項目は `AttentionItem` と同じ形にして、Home がそのまま出せるようにする。
**Home に KPI を置かない**（UI/UX §8.1）。

---

## 5. チケット

| ID    | 内容                                           | 完了条件                               |
| ----- | ---------------------------------------------- | -------------------------------------- |
| P6-01 | 契約: entity / edge / fact / commitment        | contracts の test **完了**             |
| P6-02 | DB: world_* 4 表 + RLS + append-only           | `db:verify` **完了**                   |
| P6-03 | world-model service: entity 寄せと edge        | AC6-8 **完了**                         |
| P6-04 | memory write policy（何を書くか / 書かないか） | AC6-7 **完了**                         |
| P6-05 | commitment の抽出と状態遷移                    | AC6-1 / AC6-2 / AC6-3 **完了**         |
| P6-06 | ProactiveScore と daily brief                  | AC6-4 / AC6-5 / AC6-6 / AC6-9 **完了** |
| P6-07 | HTTP 経路                                      | 結合 test **完了**                     |
| P6-08 | Home を server 側の brief に繋ぐ               | UI test **完了**                       |
| P6-09 | 受け入れテスト AC6-1〜AC6-10                   | CI の blocking gate **完了**           |

---

## 6. 逸脱

| ID   | 決定                                  | 理由                                                   |
| ---- | ------------------------------------- | ------------------------------------------------------ |
| D-43 | 出所の無い fact は作らせない          | 辿れないものは信用の根拠にならない（会議の引用と同じ） |
| D-44 | `world_embeddings` は要るまで作らない | 空の表は「実装済み」に見えて誤解を生む                 |
| D-45 | entity は正規化名で寄せる             | 同じ人が何人もできると、世界の"現在状態"にならない     |

---

## 7. 積み残し

| ID    | 内容                                               |
| ----- | -------------------------------------------------- |
| OQ-22 | 記憶の意味検索（pgvector + embedding プロバイダ）  |
| OQ-23 | 寄せてしまった entity を後から分ける手段           |
| OQ-24 | proactive heartbeat の配信（notification-service） |
