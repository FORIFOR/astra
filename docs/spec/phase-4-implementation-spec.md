# Astra — Phase 4 実装仕様書

| 項目       | 内容                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| 正本       | `docs/spec/new_ai_platform_design_spec_v0.1.md` §2.4・§14・§28 Phase 4 |
| UI/UX 正本 | `docs/spec/astra_ui_ux_detailed_spec_v0.1.docx` §11                    |
| 前提       | Phase 0 / 2 / 3 完了。manifest・registry・install は Phase 0 にある    |
| 版         | 0.1（2026-08-26）                                                      |

Phase 0 の規約（テーブル所有権 §5.1、スコープ §5.4、冪等性、append-only、逸脱表）は
そのまま適用する。ここでは Phase 4 で足すものだけを書く。

---

## 0. Exit

正本 §28 Phase 4:

> plugin install だけで Agent + Dashboard が増える

`pnpm test:acceptance` に Phase 4 のスイートを足し、次を通す。

```text
AC4-1  manifest が宣言した skill / dashboard / policy の**実体が無ければ publish が失敗する**
AC4-2  install すると、その plugin の agent が使えるようになる（コード変更なし）
       ※ Phase 4 時点の検査は `installed: true` を見ただけで**不十分だった**。
         実際に走ることは Phase 5（AC5-1）で確かめている
AC4-3  install すると、その plugin の dashboard が出る（コード変更なし）
AC4-4  dashboard は任意の HTML/JS を実行しない。既定の component だけを描く
AC4-5  dashboard の bind が、存在しないデータを指していたら描かずに理由を出す
AC4-6  install の前に、権限・触るデータ・確認が要る操作が提示される
AC4-7  同意していない権限は tool 実行時に拒否される
AC4-8  min_core_version を満たさない plugin は install できない
AC4-9  update は semver で進み、非互換なら止まる
AC4-10 update は前の版へ戻せる（rollback）
AC4-11 uninstall すると agent も dashboard も消える
AC4-12 別テナントの install 状態は見えない
AC4-13 MCP の tool は、サーバの自己申告ではなく host が risk を決める
AC4-14 宣言の無い MCP tool は READ ではなく確認必須として扱われる
```

---

## 1. 決めておくこと

### 1.1 宣言と実体を一致させる

いまの `plugins/builtin/*/plugin.yaml` は `skills/research.md` や
`dashboards/research-runs.json` を宣言しているが、**実体が無く、誰も検査していない**。
この状態では「install だけで増える」は成立しない。

決定: publish のときに**宣言されたファイルをすべて読み、検証する**。
1 つでも欠けていたら publish を失敗させる。壊れた plugin を catalog に載せない。

### 1.2 Dashboard は宣言だけ。コードは持たせない

正本 §14.1 は「初期版は任意 HTML/JS を直接読み込ませない」と決めている。
Core UI Kit の component を JSON で指定するだけにする。

component は**固定の集合**（正本 §14.1）:

```text
metric / text / table / chart / timeline / kanban /
entity-list / entity-detail / action-button / approval-card / file-preview
```

未知の type は描かない。**黙って飛ばさず、何が描けなかったかを出す**。

### 1.3 bind は解決できなければ描かない

`{"type":"metric","bind":"pipeline.total"}` の `bind` は、
plugin が宣言した**データソース**を指す。解決できない bind を
0 や空表で描くと、「データが無い」と「壊れている」が区別できなくなる。

決定: 解決できない bind は、その item だけを**理由付きの穴**として描く。

### 1.4 権限は install 時の同意で決まり、実行時に効く

install 画面で権限を見せるだけでは足りない。**同意していない権限で
tool を呼べてはならない**。`plugin_permissions` は Phase 0 で作ってある。
ここに「実行時に照会する」経路を足す。

### 1.5 update は semver で、戻せる

- `min_core_version` を満たさない版は install も update もしない
- major が上がる更新は、同意し直しを求める（権限が変わり得るため）
- 直前の版を残し、`POST /v1/plugins/{id}/rollback` で戻せる

---

## 2. データモデル

Phase 0 の 5 表（`plugin_publishers` / `plugins` / `plugin_versions` /
`plugin_installs` / `plugin_permissions`）をそのまま使う。足すのは 1 つだけ。

```text
plugin_assets   manifest が宣言したファイルの実体と、その sha256
```

- `(plugin_id, version, path)` で一意
- 内容は `bytea`。dashboard の JSON も skill の markdown もここに入る
- **append-only**。版が違えば別の行。publish 済みの版の中身は変わらない

---

## 3. Dashboard Schema

```jsonc
{
  "id": "research-runs",
  "title": "調査",
  "layout": "grid", // grid | stack
  "items": [
    { "type": "metric", "title": "調査した数", "bind": "research.total" },
    { "type": "table", "title": "最近の調査", "bind": "research.recent" },
  ],
}
```

- `bind` は `<namespace>.<name>`。namespace は plugin が宣言する
- item ごとに `span`（grid の占有幅、1〜12）を任意で持てる

### 3.1 データソース

plugin は manifest で宣言し、host が解決する。

```yaml
data_sources:
  - id: research.total
    kind: count # count | rows | series
    query: research_runs # 所有サービスが解釈する名前
```

**任意の SQL を書かせない。**plugin に SQL を渡させると、
テーブル所有権（§5.1）も RLS も意味を失う。
`kind` と `query` の組を host 側が持つ**許可表**で引く。

---

## 4. 権限

- install 時、manifest の `permissions` を提示して同意を取る
- 同意した scope だけを `plugin_permissions` に記録する
- tool 実行時に `PermissionGate` が照会する。無ければ `plugin.permission_denied`
- major 更新で `permissions` が増えたら、増えた分の同意を取り直す

---

## 5. API

```text
GET    /v1/plugins/catalog              一覧（Phase 0 にある）
GET    /v1/plugins/{id}                 詳細（§11.1 の必須項目を全部返す）
POST   /v1/plugins/{id}/install         同意した scope 付き
POST   /v1/plugins/{id}/update          版を上げる
POST   /v1/plugins/{id}/rollback        前の版へ戻す
DELETE /v1/plugins/{id}                 uninstall
GET    /v1/plugins/{id}/dashboards/{dashboardId}   schema + 解決済みデータ
```

---

## 6. UI（Apps タブ）

UI/UX §11 に従う。**製品仕様より UI/UX 仕様を優先**。

- Connector 単体より Pack を優先して見せる
- 「できる仕事」を先に、tool 数は secondary
- detail は §11.1 の必須項目を全部出す:
  publisher / verified / version / updated / できる仕事 / 触るデータ /
  権限 / local か cloud か / 確認が要る操作 / 増える Agent と Dashboard /
  changelog / uninstall の影響
- install は同意を取ってから。**押しただけで権限が付かない**

---

## 7. MCP

MCP サーバを tool の供給源として扱う。初期版は `initialize` / `tools/list` /
`tools/call` の部分集合に限る。**全部を実装しない**（要らない面は攻撃面になる）。

MCP の tool も、manifest の tool と**同じ risk 判定と同じ確認**を通す。
外から来た宣言を特別扱いしない。ここで一番効くのは次の 3 つ:

- **risk は host が決める**（D-37）。サーバは tool の名前と説明は返すが、
  それが何をするかは自己申告に過ぎない
- **宣言の無い tool は READ ではなく確認必須**（D-38）。「安全かもしれない」で
  素通しすると、書き込みや送信が確認なしで通る
- **stdio の MCP へ `process.env` を渡さない**（D-39）。素通しすると、
  plugin が持ち込んだ実行ファイルにこちらの資格情報が全部渡る

失敗は `isError` で返ってくるので、成功として扱わない（正本 §9）。

---

## 8. チケット

| ID    | 内容                                                   | 完了条件                                 |
| ----- | ------------------------------------------------------ | ---------------------------------------- |
| P4-01 | 契約: dashboard schema / data source / install consent | contracts の test **完了**               |
| P4-02 | DB: `plugin_assets` と所有権表                         | `db:verify` / `check:generated` **完了** |
| P4-03 | publish 時に宣言ファイルを読み、無ければ失敗させる     | AC4-1 **完了**                           |
| P4-04 | dashboard の bind 解決（許可表方式）                   | AC4-5 **完了**                           |
| P4-05 | 権限の同意と実行時ゲート                               | AC4-6 / AC4-7 **完了**                   |
| P4-06 | update / rollback / 互換判定                           | AC4-8 / AC4-9 / AC4-10 **完了**          |
| P4-07 | HTTP 経路                                              | 結合 test **完了**                       |
| P4-08 | ui-kit: dashboard renderer（固定 component）           | AC4-4 **完了**                           |
| P4-09 | Apps タブ（store / detail / install 同意）             | UI test **完了**                         |
| P4-10 | MCP tool source                                        | 単体 test                                |
| P4-11 | 受け入れテスト AC4-1〜AC4-12                           | CI の blocking gate **完了**             |

---

## 9. 逸脱

| ID   | 決定                                            | 理由                                                   |
| ---- | ----------------------------------------------- | ------------------------------------------------------ |
| D-31 | 宣言したファイルが無ければ publish を失敗させる | 宣言と実体がずれた plugin は「install で増える」を壊す |
| D-32 | dashboard に任意 HTML/JS を持たせない           | 正本 §14.1。Core UI が plugin に壊されない             |
| D-33 | plugin に SQL を書かせず、許可表で引く          | SQL を渡すとテーブル所有権も RLS も意味を失う          |
| D-34 | 解決できない bind は理由付きの穴にする          | 0 で描くと「無い」と「壊れている」が区別できない       |

---

## 10. 積み残し

| ID    | 内容                                                    |
| ----- | ------------------------------------------------------- |
| OQ-15 | 第三者 plugin の配布と署名鍵の管理（正本 §29 の後段）   |
| OQ-16 | staged rollout の配信基盤                               |
| OQ-17 | verified plugin の sandboxed webview（正本 §14.1 後段） |
