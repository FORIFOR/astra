# Astra — Phase 3 実装仕様書

| 項目       | 内容                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| 正本       | `docs/spec/new_ai_platform_design_spec_v0.1.md` §11・§12・§13・§28 Phase 3  |
| UI/UX 正本 | `docs/spec/astra_ui_ux_detailed_spec_v0.1.docx` §12・§15（UI-4 / UI-5）     |
| 前提       | Phase 0 / Phase 2 完了。契約・DB・Task Runtime・Library・Share はそこにある |
| 版         | 0.1（2026-08-26）                                                           |

Phase 0 の規約（テーブル所有権 §5.1、スコープ §5.4、冪等性、append-only、逸脱表）は
そのまま適用する。ここでは Phase 3 で足すものだけを書く。

---

## 0. Exit

正本 §28 Phase 3:

> multi-speaker meeting E2E

`pnpm test:acceptance` に Phase 3 のスイートを足し、次を通す。

```text
AC3-1  会議を開始でき、録音対象（マイク / システム音声）と言語が記録される
AC3-2  音声を流すと、話者タグ付きの interim transcript が流れる
AC3-3  interim は確定で置き換わり、確定した segment だけが保存される
AC3-4  話者に名前を付けると、その会議の中で固定される
AC3-5  翻訳は確定 segment 単位で出る（interim を毎回訳して画面を揺らさない）
AC3-6  会議を終了すると finalize が durable task として走り、閉じても続く
AC3-7  最終パスの transcript は live のものを書き換えず、別の pass として残る
AC3-8  finalize が summary / decisions / action items を作る
AC3-9  summary の各項目から、根拠になった segment と timestamp へ辿れる
AC3-10 録音と transcript が Library の Meeting bundle として残る
AC3-11 STT が落ちても録音は続き、degraded として記録される
AC3-12 別テナントの会議は見えない（404、403 ではない）
```

---

## 1. 決めておくこと

### 1.1 provider は差し替え口にする（OQ-11）

正本 §11.2 の dual path は Google に依存するが、**どの GCP プロジェクトの
どの認証情報を使うかは未決**（OQ-11）。Phase 2 の research と同じ扱いにする。

```ts
interface StreamingTranscriber {
  // V1 Streaming + diarization
  start(config): StreamingSession;
}
interface BatchTranscriber {
  // V2 Chirp 3 BatchRecognize
  transcribe(audio, config): Promise<BatchResult>;
}
interface TranslationProvider {
  translate(text, from, to, glossary?): Promise<string>;
}
```

- 決定的な代役（`ScriptedStreamingTranscriber` ほか）を同梱し、テストはこれで回す
- **本番で代役のまま起動したら拒否する**。`assertNoStandIns` が
  「何が代役なのか」を名指しで言う。埋める先が分からない拒否は役に立たない
- Google 実装（V1 streaming / Chirp 3 batch / Translation）は**実装済み**。
  `meetingProvidersFromEnv` が設定されたものだけ本物にする。
  残るのは GCP プロジェクトと認証情報だけ（OQ-11）
- 会議のまとめは Claude（`AnthropicSummarizer`）。**引用はモデルに任せない**:
  番号だけを選ばせ、範囲外は捨てる（AC3-9 の担保）

### 1.2 live と final は競合させない

正本 §11.2 は「live は速さ、final は精度」の二重経路。ここで一番壊れやすいのは
**final が live を上書きして、画面に出ていたものが後から消える**こと。

決定: `meeting_segments` に `pass`（`'live' | 'final'`）を持たせ、
final パスは live 行を**書き換えず別の行として積む**。live 行は append-only のまま。

- 「その場で何が見えていたか」と「最終的にどう結論したか」が両方残る
- Evidence Ledger と同じ考え方（根拠は後から書き換えない）
- 画面は既定で final を見せ、無ければ live へ落ちる

### 1.3 interim は保存しない

interim は 1 秒間に何度も差し替わる。保存しても後から価値が無く、
append-only を成立させられない。**interim はイベントとしてだけ流す**
（`meeting.transcript.partial`）。DB へ入るのは確定 segment だけ。

### 1.4 話者は名前だけ。声では identify しない

正本 §11.3 の通り、音声 embedding による人物特定は biometric 扱いになり得る。
初期版では採用しない。`meeting_speakers` は
「この会議の speaker_tag 3 は田中」という**会議内だけの対応表**。

### 1.5 finalize は durable task にする

UI/UX §12.5「Finalize 中に window を閉じても継続」。これは Task Runtime が
既に持っている性質なので、新しい仕組みを作らず `kind: 'meeting.finalize'` の
task として流す。Home / Work の progress card もそのまま乗る。

---

## 2. データモデル

正本 §21 の表に合わせて 4 つ足す。所有は `services/meeting`（§5.1 の所有権表に追記）。

```text
meetings           会議そのもの。状態・言語・音声ソース・録音 artifact
meeting_segments   確定 transcript。pass('live'|'final') 付きで append-only
meeting_speakers   speaker_tag → 表示名。会議内だけの対応
translations       segment の翻訳。target_language ごとに 1 行
```

要点だけ:

- `meetings.status`: `RECORDING | PAUSED | FINALIZING | COMPLETE | FAILED`
- `meetings.degraded_at`: STT が落ちた時刻。録音は続く（AC3-11）
- `meeting_segments` は append-only トリガ。`(meeting_id, pass, start_ms)` に索引
- `translations` は `(segment_id, target_language)` で一意。訳し直しは冪等
- 全テーブル RLS + `FORCE ROW LEVEL SECURITY`

---

## 3. Live path

```text
WS /v1/meetings/{id}/audio
→ 音声フレーム（binary）
→ 録音バッファ（object store へ追記）
→ StreamingTranscriber
→ interim → meeting.transcript.partial（保存しない）
→ final   → Segment Stabilizer → meeting_segments(pass='live') → meeting.transcript.final
                                → TranslationProvider → translations → meeting.translation.final
```

- WS のフレーム: **binary = 音声、text(JSON) = 制御**（pause / resume / marker）
- 認証は upgrade 前の `preValidation` で済ませる（Phase 0 の host bridge と同じ規則）
- STT が落ちたら `degraded_at` を立て、**録音は続ける**。final パスで拾い直す

### 3.1 Segment Stabilizer

V1 streaming は結果更新で speaker tag が変わる。UI が跳ねないよう、
確定として扱う条件を決める:

1. provider が `isFinal` を立てた
2. かつ、直前の segment と speaker_tag が同じなら**連結**する（細切れを出さない）
3. 連結は `MAX_SEGMENT_MS`（20 秒）で打ち切る

決定的な関数として書き、provider 抜きで test できるようにする。

---

## 4. 翻訳

正本 §12.1 の二段階。**interim を毎回訳さない**（画面が揺れる）。

- provisional: 出さない。初期版は committed のみ（正本の目標 p95 < 2s は満たせる）
- committed: 確定 segment ごとに 1 回だけ訳す。`translations` が冪等の担保

---

## 5. Finalize

`POST /v1/meetings/{id}/finish` → `meeting.finalize` task を作る。

```text
1. seal        録音を閉じ、artifact として Library へ
2. transcribe  BatchTranscriber（Chirp 3 相当）で録音全体を diarization 付きで
3. reconcile   live segment と突き合わせ、pass='final' として積む
4. summarize   summary / decisions / action items。各項目に根拠 segment を付ける
5. bundle      Meeting bundle artifact（source_meeting_id 付き）を Library へ
```

- 各段は既存の `StepExecutor` に載せる。task 側は中身を知らない
- 4 の各項目は `{ text, citations: [{ segment_id, start_ms }] }`。AC3-9 はこれ
- 5 は `type: 'MEETING'` の artifact。Phase 2 の share がそのまま使える

### 5.1 reconciliation

live と final を時刻で突き合わせる。**live を消さない**（§1.2）。

- final の segment を正とし、live のうち重なるものへ `superseded_by` を付ける…
  **のではなく**、live 行は触らない。対応関係は final 側の `supersedes` に持つ
- 話者の対応（live の tag 2 = final の tag 1）は、重なり時間の最大一致で決める

---

## 6. API

```text
POST   /v1/meetings                  会議を始める（consent 済みの記録込み）
GET    /v1/meetings                  一覧
GET    /v1/meetings/{id}             1 件（segments は別）
GET    /v1/meetings/{id}/segments    transcript（pass 指定、既定 final→live）
WS     /v1/meetings/{id}/audio       音声投入
GET    /v1/meetings/{id}/stream      SSE（partial / final / translation）
POST   /v1/meetings/{id}/speakers    speaker_tag へ名前を付ける
POST   /v1/meetings/{id}/finish      finalize task を作る
```

`GET /v1/meetings/{id}/stream` は Phase 0 の SSE をそのまま使う
（`event_streams` は既に `stream_kind='meeting'` を許している）。

---

## 7. UI（UI-4 / UI-5）

UI/UX §12 に従う。**製品仕様より UI/UX 仕様を優先**（Phase 0 §19 の規則）。

- UI-4: start confirmation（consent 明示）/ minimal recording indicator /
  notes-first surface / transcript は既定で閉じる
- UI-5: finalize の進捗表示 / Meeting artifact / 引用から transcript へ jump

Notes は**ユーザーのもの**。AI は自動で上書きしない（UI/UX §12.3）。

---

## 8. チケット

| ID    | 内容                                                                | 完了条件                                           |
| ----- | ------------------------------------------------------------------- | -------------------------------------------------- |
| P3-01 | 契約: meeting / segment / speaker / translation と API 型           | contracts の test **完了**                         |
| P3-02 | DB: 4 テーブル + RLS + append-only + 所有権表                       | `db:verify` / `check:generated` **完了**           |
| P3-03 | provider 差し替え口と決定的な代役                                   | provider 抜きで stabilizer が test できる **完了** |
| P3-04 | meeting-service: 開始 / segment 確定 / 話者命名 / 翻訳              | 単体 test **完了**                                 |
| P3-05 | 音声 WS と録音の保存                                                | 落ちても録音が残る **完了**                        |
| P3-06 | finalize task（seal → transcribe → reconcile → summarize → bundle） | E2E で bundle が Library に残る **完了**           |
| P3-07 | HTTP 経路と SSE                                                     | 結合 test **完了**                                 |
| P3-08 | UI-4: start / indicator / notes / transcript                        | live meeting E2E **完了**                          |
| P3-09 | UI-5: finalize / citation jump                                      | meeting artifact E2E **完了**                      |
| P3-10 | 受け入れテスト AC3-1〜AC3-12                                        | CI の blocking gate **完了**                       |

---

## 9. 逸脱

| ID   | 決定                                           | 理由                                                  |
| ---- | ---------------------------------------------- | ----------------------------------------------------- |
| D-24 | interim は保存せずイベントだけ                 | 後から価値が無く、append-only を壊す                  |
| D-25 | final は live を上書きせず別 pass として積む   | 見えていたものが後から消えない。根拠は書き換えない    |
| D-26 | provisional 翻訳は出さない                     | 画面が揺れる。committed だけで目標 latency を満たせる |
| D-27 | 声による人物特定はしない                       | biometric 扱いになり得る（正本 §11.3）                |
| D-28 | finalize は `kind: 'meeting.finalize'` の task | 「閉じても続く」は Task Runtime が既に持っている      |

---

## 10. 積み残し

| ID    | 内容                                                     |
| ----- | -------------------------------------------------------- |
| OQ-11 | Google STT の GCP プロジェクトと認証情報。決まるまで代役 |
| OQ-12 | システム音声の取り込み（macOS の画面収録権限まわり）     |
| OQ-13 | 会議の保持期間と自動削除（規制テナント向け）             |
