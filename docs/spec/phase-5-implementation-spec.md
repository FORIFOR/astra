# Astra — Phase 5 実装仕様書

| 項目       | 内容                                                                  |
| ---------- | --------------------------------------------------------------------- |
| 正本       | `docs/spec/new_ai_platform_design_spec_v0.1.md` §14・§15・§28 Phase 5 |
| UI/UX 正本 | `docs/spec/astra_ui_ux_detailed_spec_v0.1.docx` §9・§11               |
| 前提       | Phase 0 / 2 / 3 / 4 完了                                              |
| 版         | 0.1（2026-08-26）                                                     |

---

## 0. なぜ最初に Agent Package の実行を作るか

Phase 4 の Exit は「plugin install だけで **Agent + Dashboard** が増える」だった。
**Dashboard は本当に増えるようになったが、Agent は増えていない。**

`services/task/src/plan.ts` の `KNOWN_TASK_KINDS` は
`['echo', 'research', 'meeting.finalize']` の固定リストで、
install した plugin の agent はここに入らないので**実行できない**。
Phase 4 の AC4-2 は `installed: true` を見ただけで、
「agent が使えるようになった」ことを確かめていなかった。これは検査の不備。

Phase 5 は専業 Agent を足す前に、まずここを閉じる。

---

## 1. Exit

正本 §28 Phase 5 の優先順は Image → Sales CRM → Video。
ただし Image / Video は生成プロバイダが未決（OQ-19）なので、
**採用先の判断が要らない部分から**進める。

```text
AC5-1  install した plugin の agent を、コード変更なしに task として実行できる
AC5-2  agent が使えるのは、その plugin が宣言した tool だけ
AC5-3  同意していない権限を要する step は、実行前に止まる
AC5-4  確認が要る step は承認を待つ（既存の Approval 経路に乗る）
AC5-5  agent の skill は plugin の実体ファイルから読まれる
AC5-6  uninstall すると、その agent は実行できなくなる
AC5-7  domain schema（data_extensions）が entity として登録される
AC5-8  Sales CRM の entity を作り、pipeline を集計できる
AC5-9  next best action が、根拠になった activity から辿れる
AC5-10 別テナントの entity は見えない
```

Image / Video は provider の差し替え口だけを置き、代役で配線する（§5）。

---

## 2. Agent Package の実行

### 2.1 kind は固定リストではなくなる

`planTask` は 2 段になる。

1. 組み込みの kind（`echo` / `research` / `meeting.finalize`）
2. **install 済み plugin の agent**（`plugin:<pluginId>:<agentId>`）

2 の計画は DB を読まないと作れないが、**workflow のコードは決定的でなければならない**
（`plan.ts` は `@astra/contracts` すら import できない）。
なので次のようにする。

- 計画そのものは **task を作る時点で確定させ、`tasks.plan` に保存する**
- workflow は保存された計画をそのまま実行する

これで決定性を壊さずに、動的な agent を実行できる。

### 2.2 agent は宣言した tool しか使えない

`AgentDecl.tools` に無い tool は、計画に載せない。
載っていても、実行前に次を確かめる:

- その scope が **同意済み**か（`plugin_permissions`）
- 確認が要る risk なら、**Approval を待つ**

外から来た宣言を特別扱いしないのは MCP と同じ（Phase 4 §7）。

---

## 3. Domain Schema（data_extensions）

正本 §14 の Agent Package は `data_extensions` を持つ。
plugin が持ち込む entity の定義で、**任意のテーブルを作らせない**。

```jsonc
{
  "id": "opportunity",
  "title": "商談",
  "fields": [
    { "id": "name", "type": "text", "required": true },
    { "id": "amount", "type": "number" },
    { "id": "stage", "type": "enum", "values": ["lead", "qualified", "won", "lost"] },
    { "id": "close_date", "type": "date" },
  ],
}
```

- 実体は**単一の `domain_entities` 表**に jsonb で入る。
  plugin ごとに DDL を走らせない（migration をユーザ入力にしない）
- 型と必須は登録時に検査する。壊れた値を入れさせない
- RLS は表そのものに掛かるので、plugin の実装に依存しない

---

## 4. Sales CRM（最初の専業 Agent）

正本 §15.3。**外部 CRM に繋がなくても成立する部分**から作る。

entity: `account` / `contact` / `opportunity` / `activity` / `next_action`

機能のうち、この Phase で作るのは:

- pipeline analysis（stage ごとの件数と金額）
- next best action（**根拠になった activity を必ず持つ**）

`meeting prep` / `call notes to CRM` / `follow-up drafts` は
Gmail / Calendar / Salesforce の connector が要るので、
接続先が決まってから（OQ-20）。

---

## 5. Image / Video

生成プロバイダは未決（OQ-19）。research / STT と同じ扱いにする。

```ts
interface ImageGenerator {
  generate(prompt, options): Promise<GeneratedImage>;
  readonly isStandIn: boolean;
}
```

- 決定的な代役を同梱し、テストはそれで回す
- **本番で代役のまま起動したら拒否する**（`assertNoStandIns` と同じ規則）
- 生成物は Library の artifact として残し、prompt と lineage を持つ（正本 §15.1）

---

## 6. チケット

| ID    | 内容                                               | 完了条件                      |
| ----- | -------------------------------------------------- | ----------------------------- |
| P5-01 | 計画を作成時に確定し `tasks.plan` へ保存する       | 既存 task が壊れない **完了** |
| P5-02 | install 済み agent を kind として実行できる        | AC5-1 / AC5-2 **完了**        |
| P5-05 | 権限ゲートと承認を agent step に効かせる           | AC5-3 / AC5-4 **完了**        |
| P5-03 | skill を実体ファイルから読む                       | AC5-5 **完了**                |
| P5-04 | domain schema（data_extensions）の登録と検証       | AC5-7 **完了**                |
| P5-06 | Sales CRM の entity と pipeline / next best action | AC5-8 / AC5-9 **完了**        |
| P5-07 | Image provider の差し替え口と代役                  | 代役で E2E が通る             |
| P5-08 | HTTP 経路（entity CRUD / pipeline）                | 結合 test **完了**            |
| P5-09 | 受け入れテスト AC5-1〜AC5-10                       | CI の blocking gate **完了**  |

---

## 7. 逸脱

| ID   | 決定                                  | 理由                                                     |
| ---- | ------------------------------------- | -------------------------------------------------------- |
| D-40 | 計画は task 作成時に確定し保存する    | workflow は決定的でなければならない。DB を読ませない     |
| D-41 | domain entity は単一表に jsonb で持つ | plugin ごとに DDL を走らせない。migration を入力にしない |
| D-42 | agent は宣言した tool しか使えない    | 宣言と実行がずれると、権限の意味が無くなる               |

---

## 8. 積み残し

| ID    | 内容                                                  |
| ----- | ----------------------------------------------------- |
| OQ-19 | 画像 / 動画の生成プロバイダ                           |
| OQ-20 | CRM / メール / カレンダーの接続先                     |
| OQ-21 | Video Agent（render queue が要るので Phase 5 の後段） |
