# Astra — Phase 2 実装仕様書

| 項目       | 内容                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- |
| 正本       | `docs/spec/new_ai_platform_design_spec_v0.1.md` §8・§28 Phase 2                                |
| UI/UX 正本 | `docs/spec/astra_ui_ux_detailed_spec_v0.1.docx` §10・§13・§15                                  |
| 前提       | Phase 0 完了（`phase-0-implementation-spec.md`）。契約・DB・Task Runtime・Library はそこにある |
| 版         | 0.1（2026-08-26）                                                                              |

Phase 0 の規約（テーブル所有権 §5.1、スコープ §5.4、冪等性、append-only、逸脱表）は
そのまま適用する。ここでは Phase 2 で足すものだけを書く。

---

## 0. Exit

正本 §28 Phase 2:

> 「調査して報告」→ Library → secure share

`pnpm test:acceptance` に Phase 2 のスイートを足し、次を通す。

```text
AC2-1  Research タスクを作ると、計画 → 検索 → 照合 → 統合 → レポートまで進む
AC2-2  進捗に source 数が出る（段数が決まらないので % は出ない）
AC2-3  レポートが Library の artifact として残り、source_task_id から辿れる
AC2-4  Evidence Ledger に根拠が残り、結論から source を引ける
AC2-5  矛盾する source があれば contradiction として記録される
AC2-6  artifact に共有リンクを発行できる（既定は非公開）
AC2-7  パスワード付きリンクは、正しいパスワードでのみ開ける
AC2-8  期限切れ・失効済み・一回限りの使用済みリンクは開けない
AC2-9  パスワードの総当たりはレート制限で止まる
AC2-10 共有経由のアクセスが audit に残る
AC2-11 raw なストレージ URL が外部へ出ない
AC2-12 別テナントの artifact は共有できない
```

---

## 1. 決めておくこと

### 1.1 LLM プロバイダ（OQ-3）は未決のまま進める

Research の統合（claim 抽出・要約）には言語モデルが要るが、
**プロバイダは未決**（Phase 0 §18 OQ-3）。決まるまで待つと Phase 2 が丸ごと止まるので、
Phase 0 の `TokenVerifier` と同じ手を使う。

- `LanguageModel` / `SearchProvider` を interface として定義する
- 決定的な実装（`ScriptedLanguageModel` / `StaticSearchProvider`）をテスト用に持つ
- 実プロバイダは差し替えるだけにする

**モデルに依存しない部分は本物を作る。** source の品質評価、重複排除、
矛盾検出、Evidence Ledger、レポートの組み立ては、モデルが無くても成立する。

### 1.2 共有はまず Library 側から作る

Exit の後半（Library → secure share）は Phase 0 の資産だけで完結する。
先にここを通し、Research をその上に載せる。

---

## 2. 共有リンク（正本 §2.3）

### 2.1 トークンとパスワード

| 対象        | 扱い                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| share token | 256bit 乱数。**保存はハッシュのみ**。sha256（D-15 と同じ理由：高エントロピー）   |
| password    | 利用者が選ぶ低エントロピーの秘密。**Argon2id**。ここが Argon2id の本来の置き場所 |

リンクの形:

```text
https://<share-host>/s/<tokenId>.<secret>
```

`tokenId` を分けているのは、ハッシュが salt 付きで引けないため（Phase 0 §4.2 と同じ理由）。

### 2.2 既定は非公開

正本 §2.3「すべての Artifact に Share を提供。ただし“公開状態”はデフォルト OFF」。

作成時に指定できるもの: 有効期限（1h / 1d / 7d / 30d / custom）、パスワード、
ダウンロード可否、一回限り、メール/ドメイン allowlist、透かし。

### 2.3 守ること

1. **raw なストレージ URL を外部へ出さない。**公開 viewer は都度、署名済み短期 URL を発行する。
2. **総当たりを止める。**パスワード試行はトークン単位でレート制限する。
   利用者ごとではない（未認証の相手に利用者は無い）。
3. **失敗の理由を細かく教えない。**「期限切れ」「パスワード違い」「失効済み」を
   区別して返すと、有効なトークンの存在を教えることになる。
4. **アクセスは必ず記録する。**`share_access_logs` は append-only。
5. 失効は即時。取り消したリンクは以後どのパスワードでも開かない。

---

## 3. Research Engine（正本 §8）

### 3.1 流れ

```text
Intent → Plan → Query decomposition → Parallel search → Fetch/Parse
      → Deduplicate → Source quality → Claim extraction → Contradiction detection
      → Additional search → Synthesis → Report → Library Artifact
```

Task Runtime の上に載せる（`kind: 'research'`）。窓を閉じても継続する（正本 §8.4）。

### 3.2 Evidence Ledger（正本 §8.2）

結論から根拠を辿れるようにする。**後から「この結論の根拠は？」に答えられること**が目的で、
画面を引用で埋めることではない（UI/UX §15 の Progressive Disclosure）。

### 3.3 進捗の見せ方

段数が事前に決まらないので `step_count` は null にし、
source 数と経過時間で表す（Phase 0 §19.7 / UI/UX §6.2）。

---

## 4. チケット

| ID    | 内容                                                                                          | DoD                                                   |
| ----- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| P2-01 | contracts: Share / SharePolicy / ShareAccess / ResearchRun / Evidence                         | スキーマの正常系・異常系 test                         |
| P2-02 | マイグレーション: `shares` `share_access_logs` `research_runs` `evidence` + RLS + append-only | `pnpm db:verify` が通る                               |
| P2-03 | share-service: 発行 / 検証 / 失効 / 一回限り / allowlist / アクセス記録                       | 期限切れ・失効・誤パスワード・使い切りの 4 経路 test  |
| P2-04 | api-gateway: 共有 API と**未認証の公開 viewer 経路**                                          | 総当たりがレート制限で止まる。理由を区別して返さない  |
| P2-05 | apps/share-web: 公開 viewer                                                                   | パスワード入力 → 表示 → ダウンロード可否              |
| P2-06 | research: `SearchProvider` / `LanguageModel` interface と決定的な実装                         | 差し替えだけで実プロバイダへ移れる **完了**           |
| P2-07 | research: 品質評価 / 重複排除 / 矛盾検出 / Evidence Ledger                                    | モデル無しで成立する部分の test **完了**              |
| P2-08 | research: Temporal workflow（`kind: 'research'`）とレポート生成                               | Library に artifact が残る **完了**                   |
| P2-09 | 受け入れテスト AC2-1〜AC2-12                                                                  | CI の blocking gate（`evals/actions/phase2`）**完了** |

---

## 4.1 実装で確定したこと（共有）

### 秘密は URL のフラグメントに置く

```text
https://share.example.com/s#v1.<shareId>.<secret>
```

パスに置くと、アクセスログ・Referer・プロキシのどこかで必ず漏れる。
フラグメントはサーバへ送られない。viewer が読んで**本文として** POST し、
unlock を通った相手にだけ 5 分の閲覧トークンを渡す。
以降の本文取得ではそれを使い、共有の秘密を再送させない。

### 失敗の見せ方

サーバは理由を区別して返さない。viewer も区別して表示しない
（「パスワードが違います」と書くと、リンク自体は有効だと教えることになる）。

ただし**打ち間違いで行き止まりにしない**。入力に戻して再試行させ、
行き止まりにするのは試行が絞られたときだけ。守りはレート制限が担う。

### 逸脱 D-22（Phase 0 逸脱表にも記載）

公開 viewer 用の DB スコープ `withShare`。共有リンクの解決はテナントが分からない
状態で始まるので、認証（D-14）と同じ循環が起きる。共有テーブルにしか GRANT されて
いない BYPASSRLS ロール `astra_share` を使い、artifact は解決後に `withTenant` で読む。

## 4.2 実装で確定したこと（Research）

### 工程は 4 つで固定

正本 §8.1 の流れを、UI/UX §13.1 が見せる 4 工程にまとめた
（調べることを整理 → 照合 → 食い違いを確認 → レポート作成）。

工程数が決まっているので**進捗率は本物**になる。
各工程の中身（検索件数）は事前に決まらないので、それは `detail` 側で示す（§6.2）。

### 手順の間で状態を持ち回さない

activity は何度でも再実行され得る。途中経過をメモリに置くと壊れるので、
**Evidence Ledger と `research_runs` が状態そのもの**。
各工程は DB から必要なものを読み直す。同じ URL の同じ主張は積み直さない。

### 決定的にできることだけを規則でやる

| 判定           | 実装                                                                 |
| -------------- | -------------------------------------------------------------------- |
| source の質    | 種別の重み（一次情報 > 二次情報）。規則                              |
| 新しさ         | 半減期 180 日。日付不明は 0.5（良くも悪くも扱わない）                |
| 重複           | URL の正規化（追跡パラメータ・`www.`・末尾スラッシュ）+ 主張の正規化 |
| **数値の矛盾** | 同じ話題（数字を除いた骨組み）で違う数字。規則                       |
| **意味の矛盾** | `LanguageModel.detectContradictions`。**規則では確実に拾えない**     |
| 確信度         | 矛盾があれば上げない。独立した強い source が 3 つ以上で `high`       |

否定や言い換えを跨ぐ矛盾は正規表現では拾えない。
**拾えない仕組みを置いて「検出できている」と思わせる方が、拾えないと分かっている状態より危ない。**
最初は正規表現で否定を見ようとしたが、日本語では確実に効かないので落とした。

### 本番で決定的実装のまま動かさない

worker は `ASTRA_ENV=production` で決定的プロバイダを使おうとしたら起動を拒む。
「動いているが中身が偽物」を本番へ持ち込まないため。

### 逸脱 D-23

`workers/task-worker` を新設した。`services/task` が research を直接持つと循環になる。
サービス同士を組み立てるのは worker / gateway の役目（ADR 0001）。
規約検査に**依存の循環**の検出を足し、意図的に循環を作って発火することを確かめた。

## 5. 参照

- Phase 0 実装仕様: `docs/spec/phase-0-implementation-spec.md`
- 正本 §8（Research）・§2.3（Library / Share）・§28（Phase 2）
- UI/UX §10（Library）・§13（Research）・§15（Evidence）
