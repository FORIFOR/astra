# Astra — Phase 0 実装仕様書

| 項目           | 内容                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 正本           | `docs/spec/new_ai_platform_design_spec_v0.1.md`（sha256 `8324a139…52eb516d`, 読み取り専用で凍結）                      |
| UI/UX 正本     | `docs/spec/astra_ui_ux_detailed_spec_v0.1.docx`（sha256 `caeb149f…a1a51a1a`, 凍結）。**UI に関しては製品仕様より優先** |
| 本書の位置づけ | 正本 §28 Phase 0 を「コードが書ける粒度」まで確定した従属文書                                                          |
| 版             | 0.2（2026-08-26。UI/UX 詳細仕様 v0.1 との突合を反映）                                                                  |
| 対象読者       | Phase 0 を実装する担当（人 / エージェント）                                                                            |

本書に書かれていないことは実装しない。正本と本書が矛盾した場合は **正本が優先**し、
本書側を修正する（逸脱は §17 に登録してから採用する）。

---

## 0. Phase 0 の目的と境界

### 0.1 目的

正本 §28 Phase 0 の Exit を満たす **1本の縦串**を通す。

> **create task → progress → result artifact**

つまり「認証されたクライアントがタスクを作り、耐久ワークフローが走り、
途中経過が順序保証付きで流れ、成果物が Library に残る」までを、
本番と同じ骨格（Temporal / PostgreSQL / イベント契約 / audit）で通す。

### 0.2 Phase 0 のスコープ（正本 §28 より）

| #   | 項目              | 本書の該当章 |
| --- | ----------------- | ------------ |
| 1   | monorepo          | §2           |
| 2   | auth / tenant     | §4           |
| 3   | event contract    | §3.2, §7     |
| 4   | task runtime      | §6           |
| 5   | library           | §8           |
| 6   | plugin manifest   | §9           |
| 7   | local host bridge | §10          |

### 0.3 Phase 0 で **やらない**こと

意図的に外す。着手したくなったら §17 に逸脱として登録すること。

- Conversation Engine / LLM 呼び出し（Phase 1）
- Context Engine / Context Capsule の実装（Phase 1。型だけ Phase 1 で定義）
- STT / 音声 / TTS（Phase 1・Phase 3）
- Research Engine / Evidence Ledger（Phase 2）
- Share link・公開 viewer（Phase 2）
- 4タブ UI・Task Dock v2（Phase 1）
- プラグインの**実行**（Phase 4。Phase 0 は manifest の解析と install 記録まで）
- World Model（Phase 6）
- 課金・マルチリージョン・SOC2 対応

### 0.4 Exit 判定

§16 の受け入れテストが CI で green になること。それ以外を Exit 条件にしない。

---

## 1. 命名・ID・時刻の規約

### 1.1 名前空間

| 対象                | 規約                                                                                  | 例                    |
| ------------------- | ------------------------------------------------------------------------------------- | --------------------- |
| npm package         | `@astra/<name>`、service は `@astra/service-<name>`、worker は `@astra/worker-<name>` | `@astra/service-task` |
| Tauri bundle id     | `com.astra.desktop`                                                                   |                       |
| plugin id           | 逆ドメイン                                                                            | `com.astra.gmail`     |
| Temporal namespace  | `astra-<env>`                                                                         | `astra-dev`           |
| Temporal task queue | `astra.<domain>.v<major>`                                                             | `astra.task.v1`       |
| DB                  | snake_case、テーブルは複数形                                                          | `task_events`         |
| API path            | `/v1/<resource>`、資源は複数形                                                        | `/v1/tasks/{taskId}`  |
| JSON body           | snake_case（TS 側は camelCase、境界で変換）                                           | `result_artifact_id`  |

> JSON を snake_case にするのは、正本 §20 のイベント封筒がすでに snake_case で書かれているため。
> 封筒だけ snake、他は camel という二重規約を作らない。変換は `packages/contracts` の
> codec が一手に引き受ける（§3.8）。

**不透明領域（逸脱 D-13）**: `task.input` / `event.payload` / `approval.details` /
`approval.edits` / `host.call.args` / `host.result.value` / `plugin_versions.manifest` /
`metadata` はユーザー由来または署名対象の任意 JSON であり、**キー変換をしてはならない**。
codec はこれらのキー配下を原文のまま複製する（`OPAQUE_KEYS`）。この集合は契約の一部であり、
勝手に増減させない。

### 1.2 ID

- すべての主キーは **UUIDv7**。PostgreSQL 側の型は `uuid`、生成は**アプリ側**（PG16 に `uuidv7()` は無い）。
- UUIDv7 を選ぶ理由: 時系列ソート可能でカーソルページングに使え、分散生成でき、prefix 付き文字列 ID のようなマッピング層が要らない。
- TypeScript では branded type にして取り違えを型で防ぐ（§3.1）。
- 外部公開 ID に prefix は付けない（逸脱 D-05）。

### 1.3 時刻

- 保存は `timestamptz`、値は常に UTC。
- API 表現は RFC3339 ミリ秒付き（`2026-08-26T02:44:10.123Z`）。
- 「アプリ時計」を信用する箇所を作らない。順序が意味を持つのは `sequence` だけ（§7.2）。

### 1.4 エラー

すべての API エラーは単一形式（§3.7）。HTTP ステータスとアプリ内 `code` を両方返す。

---

## 2. Monorepo と開発環境

### 2.1 確定した構成

正本 §26 の推奨構成をそのまま採用。追加は `packages/db` と `docs/` のみ（逸脱 D-02）。

```text
apps/{desktop,share-web}
services/{api-gateway,conversation,context,task,research,meeting,library,share,
          plugin-registry,agent-runtime,world-model,notification}
workers/{research-worker,document-worker,media-worker,domain-worker}
packages/{contracts,db,ui-kit,agent-sdk,plugin-sdk,policy,telemetry}
plugins/builtin/{gmail,calendar,finder,meeting,research}
infra/{terraform,cloudrun,db}
evals/{conversation,stt,meeting,research,actions,plugins}
docs/{spec,adr}
```

### 2.2 ツールチェーン（確定）

| 項目                | 採用                                                                                             | 理由                                         |
| ------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Node                | >= 22（開発機は 25.2.1）                                                                         | ESM / `node:test` / fetch が安定             |
| package manager     | pnpm 10.12.2（`packageManager` で固定）                                                          | workspace protocol とディスク効率            |
| TypeScript          | 5.9 系、`module: NodeNext`、`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | 契約コードの安全側に倒す                     |
| ビルド              | TypeScript project references（`tsc -b tsconfig.build.json`）                                    | 追加ツール無しで依存順ビルドが得られる       |
| テスト              | Vitest 3                                                                                         | 単体・結合・受け入れを1本で回す              |
| 整形                | Prettier 3（lint は Phase 1 で ESLint 導入、§18 OQ-7）                                           | Phase 0 で設定沼に入らない                   |
| スキーマ検証        | Zod（`packages/contracts`）                                                                      | 実行時検証と型を1ソースにする                |
| DB マイグレーション | dbmate（素の SQL）                                                                               | SQL を正本に保つ。ORM にスキーマを握らせない |
| DB クエリ           | Kysely                                                                                           | 型は付くがスキーマ所有権は SQL 側のまま      |
| 耐久ワークフロー    | Temporal TypeScript SDK                                                                          | 正本 §16.3                                   |
| ローカル依存        | `infra/docker-compose.dev.yml`（postgres+pgvector / redis / temporal / temporal-ui）             |                                              |

### 2.3 Phase 0 のデプロイ形態（重要な決定）

**サービス境界はコードで守り、デプロイは 1 プロセスに畳む**（逸脱 D-01）。

- `services/*` はそれぞれ独立した package として実装し、他サービスの内部モジュールを
  直接 import しない。相互通信は `packages/contracts` に定義した interface 経由のみ。
- ただし Phase 0〜3 は `services/api-gateway` が各サービスを **in-process で composition** して
  1 つの Node プロセスとして起動する。Cloud Run 上のサービス分割は Phase 4 で行う。
- 理由: Phase 0 の価値は「縦串が通ること」であり、12 個の Cloud Run サービスと
  サービス間認証を先に作ると、検証したい 1 本の線が見えなくなる。
- 分割コストを後払いにしないための強制ルール:
  - サービス間呼び出しは必ず `async` な interface（同期呼び出しの形にしない）
  - 他サービスのテーブルに直接 SQL を投げない（所有テーブルは §5.1 の表で固定）
  - トランザクションをサービス境界をまたいで張らない

### 2.4 ローカル起動手順（Phase 0 完了時点で成立すべき手順）

```sh
pnpm install
cp .env.example .env
pnpm dev:infra                 # postgres / redis / temporal
pnpm db:migrate                # スキーマ適用
pnpm --filter @astra/service-api-gateway dev    # 制御プレーン（in-process composition）
pnpm --filter @astra/worker-document dev        # Temporal worker
pnpm test:acceptance           # §16 の受け入れテスト
```

---

## 3. `packages/contracts` — 契約の一次ソース

### 3.1 原則

- **Zod スキーマが一次ソース**。TypeScript の型は `z.infer` で導出する。手書きの `interface` を並置しない。
- 契約は「境界を越えるもの」だけを置く。サービス内部の型は各サービスに置く。
- 破壊的変更はメジャー版を切る（§3.8）。

```ts
// packages/contracts/src/ids.ts
import { z } from 'zod';

const id = <B extends string>(brand: B) => z.uuid().brand<B>();

export const TenantId = id('TenantId');
export const UserId = id('UserId');
export const TaskId = id('TaskId');
export const ArtifactId = id('ArtifactId');
// … ConversationId / ApprovalId / ReceiptId / DeviceId / SessionId / EventId / InstallId
export type TaskId = z.infer<typeof TaskId>; // string & brand<'TaskId'>

// plugin id は逆ドメイン。UUID ではない
export const PluginId = z
  .string()
  .regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/)
  .brand<'PluginId'>();
```

```ts
// packages/contracts/src/uuid.ts
/**
 * 単調増加の状態を持つ生成器。既定インスタンスが `uuidv7`。
 * `now` を明示しても、既に発行済みの論理時刻より前には戻らない（単調性が優先される）。
 * 決定的な時刻が必要なテストは独立した生成器を作る。
 */
export function createUuidv7Generator(): (now?: number) => string;
export const uuidv7: (now?: number) => string;
export function uuidv7Timestamp(uuid: string): number | null;
export function isUuidV7(value: string): boolean;
```

### 3.2 Realtime Event Envelope（正本 §20 の確定版）

正本の封筒に `stream_kind` / `stream_id` / `tenant_id` を追加する（逸脱 D-03）。
理由: 再接続時の再送（正本 §20「sequence で reconnect 後の再送を可能にする」）には
「どの列の何番以降か」が必要で、`task_id` の有無から列を推測する実装は将来 meeting /
conversation が増えた時点で破綻するため。

```ts
export const StreamKind = z.enum(['task', 'conversation', 'meeting']);

export const EventEnvelope = z.object({
  event_id: z.string().uuid(),
  type: EventType,
  timestamp: z.string().datetime({ offset: false }), // RFC3339 UTC
  tenant_id: z.string().uuid(),
  stream_kind: StreamKind,
  stream_id: z.string().uuid(),
  sequence: z.number().int().positive(), // stream 内で 1 始まり・欠番なし
  conversation_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  payload: z.unknown(), // type ごとに discriminated union で絞る
});
```

イベント型（正本 §20 の一覧を Phase 別に分類。Phase 0 で**発火する**のは ★ のみ）:

```text
★ task.started            ★ task.progress          ★ task.waiting_approval
★ task.completed          ★ task.failed            ★ task.cancelled
★ tool.started            ★ tool.completed         ★ artifact.created
  conversation.delta        conversation.completed                    … Phase 1
  research.source_found     research.evidence_added                   … Phase 2
  meeting.transcript.partial / .final / meeting.translation.final     … Phase 3
```

Phase 0 では上記すべての型を **Zod union として定義**する（受信側を先に完成させる）。
未実装の型は発火側が無いだけで、契約としては存在する。

`task.cancelled` は正本 §20 の列挙には無いが、正本 §24 が cancellation を必須としているため追加する（逸脱 D-03b）。

### 3.3 Task

```ts
export const TaskStatus = z.enum([
  'PENDING', // 受理済み・ワークフロー未開始
  'RUNNING', // 実行中
  'WAITING_APPROVAL', // 承認待ち（正本 §4.2 WAITING_APPROVAL）
  'CANCELLING', // 取消要求受理・後処理中
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const CreateTaskRequest = z.object({
  kind: z.string().min(1), // Phase 0 は 'echo' のみ登録
  title: z.string().max(200).optional(),
  input: z.record(z.unknown()).default({}),
  conversation_id: z.string().uuid().optional(),
  idempotency_key: z.string().min(8).max(128),
});

export const Task = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_by: z.string().uuid(),
  conversation_id: z.string().uuid().nullable(),
  kind: z.string(),
  title: z.string().nullable(),
  status: TaskStatus,
  input: z.record(z.unknown()),
  result_artifact_id: z.string().uuid().nullable(),
  error: TaskError.nullable(),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
});
```

Task Dock の UI ステート（正本 §4.2）との対応。UI ステートは**クライアント側の表現**であり、
サーバの `TaskStatus` と 1:1 にしない。

| Task Dock state                            | 由来                                             |
| ------------------------------------------ | ------------------------------------------------ |
| HIDDEN / READY / LISTENING / UNDERSTANDING | クライアントのみ（サーバ状態なし）               |
| THINKING / RESEARCHING / ACTING            | `RUNNING` + 直近の `task.progress.payload.phase` |
| WAITING_APPROVAL                           | `WAITING_APPROVAL`                               |
| RESULT                                     | `COMPLETED`                                      |
| MINIMIZED TASK                             | クライアントのみ                                 |

### 3.4 Approval と ActionReceipt

正本 §9.2 のリスク区分と §9.4 の receipt をそのまま型にする。

```ts
export const ActionRisk = z.enum([
  'READ',
  'REVERSIBLE_WRITE',
  'EXTERNAL_COMMIT',
  'DESTRUCTIVE',
  'REGULATED',
  'FINANCIAL',
]);

export const Approval = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  risk: ActionRisk,
  // 正本 §9.3「内部tool名やJSONを見せない」: UI に出すのはこの3つだけ
  summary: z.string(), // 「送信します」
  details: z.array(z.object({ label: z.string(), value: z.string() })), // To / Subject …
  editable_fields: z.array(z.string()).default([]),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']),
  expires_at: z.string().datetime(),
  decided_by: z.string().uuid().nullable(),
  decided_at: z.string().datetime().nullable(),
});

export const ActionReceipt = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  tool_id: z.string(),
  actor: z.enum(['user', 'agent', 'system']),
  inputs_hash: z.string().length(64), // sha256 hex
  result_ref: z.string().nullable(),
  executed_at: z.string().datetime(),
  risk: ActionRisk,
  approved_by: z.string().uuid().nullable(),
  reversible_until: z.string().datetime().nullable(),
});
```

Phase 0 では承認 UI は無いが、**承認待ち・承認・失効の状態機械と receipt 書き込みは実装する**。
理由: 正本 §9 の「勝手に成功扱いしない」「全 write action は receipt」は後付けが極めて困難な性質で、
Phase 4 以降に追加すると既存タスク全部の再監査が要る。

#### 承認判定（`packages/policy`）

「この操作に承認が要るか」を決める場所を 1 つに固定する。Agent や tool が個別に
判断すると必ずどこかが緩くなる。

| リスク             | 承認 | receipt | 外部副作用 | 読み返し | 正本の例     |
| ------------------ | ---- | ------- | ---------- | -------- | ------------ |
| `READ`             | 不要 | 不要    | なし       | 不要     | email search |
| `REVERSIBLE_WRITE` | 不要 | 必要    | なし       | 不要     | draft create |
| `EXTERNAL_COMMIT`  | 必要 | 必要    | あり       | 不要     | send email   |
| `DESTRUCTIVE`      | 必要 | 必要    | あり       | 不要     | delete files |
| `REGULATED`        | 必要 | 必要    | あり       | 不要     | modify EHR   |
| `FINANCIAL`        | 必要 | 必要    | あり       | **必要** | place trade  |

上乗せ規則:

1. manifest の `requires_confirmation: true` は、低リスクでも承認を要求できる（§3.6 不変条件 1）。
2. `REGULATED_HEALTH` / `CARE` / `FINANCIAL` profile では、**あらゆる write が承認必須**になる。
   「取り消せるから聞かない」という一般則を規制領域へ持ち込まない（正本 §15.5・§15.6・§22）。
3. 同 profile では **参照も監査対象**。アクセスログ自体が要件になるため。
4. `FINANCIAL` は金額・価格・注文種別の読み返しを必須にする（正本 §15.7・§22）。

承認の有効期限:

| 対象        | TTL     | 根拠                                                             |
| ----------- | ------- | ---------------------------------------------------------------- |
| 既定        | 24 時間 | §6.5 の承認待ち上限と一致させる                                  |
| `FINANCIAL` | 5 分    | 価格が動く。古い承認で発注させない（正本 §25「stale approval」） |

期限切れの承認は実行に使わない（`isApprovalUsable`）。

### 3.5 Artifact

正本 §2.3 の情報モデルを Phase 0 で必要な範囲に絞る。`entities[]` / `lineage[]` は World Model
（Phase 6）依存のため列だけ用意し、Phase 0 では常に空。

```ts
export const ArtifactType = z.enum([
  'REPORT',
  'DOCUMENT',
  'TRANSCRIPT',
  'MEETING_BUNDLE',
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'CODE',
  'DATASET',
  'OTHER',
]);
export const Sensitivity = z.enum(['PUBLIC', 'PRIVATE', 'CONFIDENTIAL', 'REGULATED']);

export const Artifact = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  type: ArtifactType,
  title: z.string(),
  mime_type: z.string(),
  source_agent_id: z.string().nullable(),
  source_task_id: z.string().uuid().nullable(),
  source_meeting_id: z.string().uuid().nullable(),
  parent_artifact_id: z.string().uuid().nullable(),
  version: z.number().int().positive(),
  object_key: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  tags: z.array(z.string()).default([]),
  sensitivity: Sensitivity.default('PRIVATE'),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

### 3.6 Plugin manifest

正本 §2.4 の YAML を Zod で受ける。Phase 0 の完成条件は
**`plugins/builtin/*/plugin.yaml` 5 本すべてが検証を通ること**。

```ts
export const ComplianceProfile = z.enum([
  'GENERAL',
  'ENTERPRISE',
  'REGULATED_HEALTH',
  'CARE',
  'FINANCIAL', // 正本 §22
]);

export const PluginManifest = z.object({
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), // semver（正本 §2.4 更新）
  publisher: z.string(),
  verified: z.boolean().default(false),
  min_core_version: z.string(),
  category: z.enum([
    'connector',
    'capability',
    'domain-agent',
    'skill-pack',
    'dashboard-extension',
  ]),
  builtin: z.boolean().default(false),
  removable: z.boolean().default(true),
  compliance_profile: ComplianceProfile, // 正本 §22「manifest で profile mandatory」
  execution_surfaces: z.array(z.enum(['local', 'cloud'])).nonempty(),
  permissions: z.array(z.string()).default([]),
  data_accessed: z.array(z.string()).default([]), // 正本 §2.4「data accessed」を人間可読で必須化
  connectors: z.array(ConnectorDecl).default([]),
  tools: z.array(ToolDecl).default([]),
  agents: z.array(AgentDecl).default([]),
  dashboards: z.array(DashboardDecl).default([]),
  policies: z.array(z.string()).default([]),
  data_extensions: z.array(z.string()).default([]),
  signature: z.string().optional(), // builtin は省略可
});

export const ToolDecl = z.object({
  id: z.string(),
  risk: ActionRisk,
  surface: z.enum(['local', 'cloud']).default('cloud'),
  requires_confirmation: z.boolean().default(false),
});
```

スキーマと不変条件は **`packages/contracts` に置く**（逸脱 D-12）。
`@astra/plugin-sdk` は本スキーマを再利用して YAML 読み込みと署名検証を実装する。

**不変条件（パーサが強制する）**

1. `risk` が `EXTERNAL_COMMIT` / `DESTRUCTIVE` / `REGULATED` / `FINANCIAL` の tool は
   `requires_confirmation: true` でなければならない（正本 §9.2・§22）。
2. `tools[].surface` は `execution_surfaces` に含まれていなければならない。
3. `builtin: true` なら `verified: true`。
4. `compliance_profile` が `REGULATED_HEALTH` / `CARE` / `FINANCIAL` の場合、
   `policies` が空であってはならない（正本 §22 の個別 compliance gate）。
5. `permissions` は既知スコープ集合 `PERMISSION_SCOPES` に含まれること。未知スコープは拒否。
   スコープの追加は契約の変更にあたる（§3.8）。
6. `agents[].tools` が参照する tool id は、同一 manifest 内で宣言済みであること。

### 3.7 エラー契約

```ts
export const ApiError = z.object({
  error: z.object({
    code: z.string(), // 'task.not_found' / 'auth.invalid_token' / 'plugin.manifest_invalid'
    message: z.string(), // 開発者向け英語
    // ユーザー向け表示文は付けない。表示文言はクライアントが code から引く（i18n をサーバに持たせない）
    details: z.unknown().optional(),
    request_id: z.string(),
  }),
});
```

HTTP マッピング: `400` 検証失敗 / `401` 未認証 / `403` 権限・テナント不一致 /
`404` 不在 / `409` idempotency 衝突・状態不整合 / `429` レート制限 / `5xx` 内部。

### 3.8 契約のバージョニング

- `packages/contracts` は API のメジャー版 (`/v1`) と対応する。
- 後方互換な追加（optional フィールド追加・enum 値追加）はマイナー。
- enum 値の追加は**クライアントが未知値で落ちない**ことを前提にする。受信側は
  未知の `type` を持つイベントを捨てるのではなく **`sequence` だけ進めて無視**する（欠番検知を壊さないため）。
- snake_case ⇄ camelCase 変換は `packages/contracts/src/codec.ts` に集約し、他所で変換しない。

---

## 4. 認証 / テナント

### 4.1 モデル

```text
tenant 1 ── * membership * ── 1 user
user   1 ── * device
device 1 ── * session
```

- Phase 0 は「サインアップ時に個人テナントを自動作成」する 1 ユーザー 1 テナント運用。
  法人テナント・招待は Phase 4 以降（§18 OQ-2）。
- **すべての業務テーブルに `tenant_id`**（正本 §18）。

### 4.2 トークン

| 種別          | 形式                          | 寿命                        | 保管                            |
| ------------- | ----------------------------- | --------------------------- | ------------------------------- |
| access token  | JWT (EdDSA / Ed25519)         | 15 分                       | メモリのみ                      |
| refresh token | opaque 256bit ランダム        | 30 日・使用時ローテーション | Desktop は Keychain（正本 §21） |
| device token  | JWT、`aud: astra-host-bridge` | 24 時間                     | Keychain                        |

access token のクレーム:

```json
{
  "iss": "https://auth.astra.local",
  "aud": "astra-api",
  "sub": "<user uuid>",
  "tid": "<tenant uuid>",
  "did": "<device uuid>",
  "scp": ["tasks:write", "artifacts:read"],
  "jti": "<uuid>",
  "iat": 0,
  "exp": 0
}
```

#### refresh token の形式

```text
v1.<tenantId>.<sessionId>.<secret>
```

`secret` は 256bit の乱数（base64url）。テナント ID を載せるのは、`sessions` が RLS 配下に
あるためで、これが無いと「セッションを読むにはテナントが要る / テナントを知るには
セッションを読む必要がある」という循環になり、認証のたびに identity スコープ（§5.4）へ
落ちることになる。偽のテナント ID を入れても、そのテナントに当該セッションが無いので
単に見つからない。

**保存はハッシュのみ。**平文の refresh token を DB に置かない（正本 §21）。

**逸脱 D-15: ハッシュに Argon2id を使わない。** 対象は利用者が選んだパスワードではなく
256bit の乱数なので、辞書攻撃も総当たりも成立しない。refresh のたびに数十ミリ秒を払う
意味がない。`sha256(context | sessionId | secret)` を使い、比較は定時間で行う。
Argon2id は利用者が選ぶ低エントロピーの秘密（正本 §2.3 の共有リンクのパスワード、Phase 2）
に取っておく。

#### ローテーションと再利用検知

- ローテーション時に旧セッションを即時失効させ、新セッションの `rotated_from` に繋ぐ。
- **失効済みのトークンが再提示されたら漏洩とみなす。**秘密値が一致するかは問わない
  （一致しないなら総当たりであり、いずれにせよそのデバイスは信用できない）。
  該当 device の**全セッションを失効**させ、`session.reuse_detected` を監査に残す。
- 「存在しないセッション」と「秘密値の不一致」を区別して返さない（列挙の手掛かりになる）。

> **実装上の必須事項**: 再利用検知のように**状態を変えてから拒否する**処理は、
> 失効と監査記録をコミットしてから例外を投げること。トランザクションの中で投げると
> 巻き戻り、「検知したのに何も起きていない」状態になる（実装時に踏んだ）。
> 判定結果はトランザクションの戻り値で返し、例外はその外で投げる。

### 4.3 Phase 0 の ID プロバイダ

外部 IdP の選定は未決（§18 OQ-1）。Phase 0 は **開発用発行エンドポイント**のみ実装する。

- `POST /v1/auth/dev/token` … `ASTRA_ENV=development` のときだけ有効。
  存在しないメールなら user + 個人 tenant + device を自動作成して token を返す。
- 本番ビルドではルート自体を登録しない（フラグ分岐ではなく**登録しない**）。
- Phase 1 で実 IdP に差し替える前提で、検証ロジックは `TokenVerifier` interface に隔離する。

### 4.4 テナント隔離（二重防御）

1. **アプリ層**: すべての DB アクセスは `packages/db` の `withTenant(tenantId, fn)` を経由する。
   生の `pool.query` を service コードから呼ぶことを禁止（§14.3 の lint で機械検査）。
2. **DB 層**: 全テナントテーブルで Row Level Security を有効化。接続チェックアウト時に
   `SET LOCAL app.tenant_id = $1` を設定し、ポリシーは `tenant_id = current_setting('app.tenant_id')::uuid`。

```sql
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tasks_tenant_isolation ON tasks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

接続ロールは 3 つに分ける（`infra/db/bootstrap.sql`）。ロールはデータベースを跨ぐため
マイグレーションではなく運用手順に置く。

| ロール           | 権限                                           | 用途                         |
| ---------------- | ---------------------------------------------- | ---------------------------- |
| `astra_app`      | 非 superuser・非 BYPASSRLS。全テーブルに GRANT | アプリの通常動作             |
| `astra_identity` | BYPASSRLS。**identity 5 テーブルにのみ GRANT** | 認証（テナント確定前）。§5.4 |
| `astra_migrate`  | BYPASSRLS                                      | マイグレーションと横断保守   |

`astra_app` に `BYPASSRLS` を与えない。superuser も同様で、
superuser は `FORCE ROW LEVEL SECURITY` すら無視するため隔離が消える。

### 4.5 レート制限

api-gateway で Redis のスライディングウィンドウ。Phase 0 の既定値:

| 対象              | 制限                |
| ----------------- | ------------------- |
| `POST /v1/auth/*` | 10 req / 分 / IP    |
| 認証済み一般 API  | 300 req / 分 / user |
| `POST /v1/tasks`  | 60 req / 分 / user  |
| SSE 同時接続      | 8 / device          |

---

## 5. データベース

### 5.1 テーブル所有権

正本 §18 のテーブル一覧を、サービス境界に割り当てて固定する。**所有サービス以外は
そのテーブルに直接 SQL を投げない**（§2.3）。

| 所有サービス           | テーブル                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------- |
| api-gateway (identity) | `tenants` `users` `memberships` `devices` `sessions`（`withIdentity` の対象。§5.4）    |
| conversation           | `conversations` `turns`                                                                |
| task                   | `tasks` `task_events` `event_streams` `approvals` `action_receipts`                    |
| library                | `artifacts` `artifact_versions`                                                        |
| share                  | `shares` `share_access_logs`                                                           |
| meeting                | `meetings` `meeting_segments` `meeting_speakers` `translations`                        |
| research               | `research_runs` `evidence`                                                             |
| world-model            | `world_entities` `world_edges` `world_facts` `world_embeddings` `world_events`         |
| plugin-registry        | `plugins` `plugin_versions` `plugin_installs` `plugin_permissions` `plugin_publishers` |
| agent-runtime          | `agent_profiles` `agent_runs`                                                          |
| （横断・追記のみ）     | `audit_events` `connector_accounts`                                                    |

### 5.2 Phase 0 で作成するテーブル

Phase 0 で **DDL を作る**のは以下。空でも作るものは「先に作らないと後で全行バックフィルが要る」もの。

`tenants` `users` `memberships` `devices` `sessions`
`conversations` `turns`（列のみ。書き込みは Phase 1）
`tasks` `task_events` `event_streams` `approvals` `action_receipts`
`artifacts` `artifact_versions`
`plugins` `plugin_versions` `plugin_installs` `plugin_permissions` `plugin_publishers`
`audit_events`

Phase 2 以降のテーブル（`shares` `meetings` `evidence` `world_*` …）は作らない。

### 5.3 マイグレーション

**実 DDL の正本は `infra/db/migrations/*.sql`**（ADR 0002）。本節は SQL を読むだけでは
分からない設計判断だけを記す。

| ファイル                           | 内容                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `20260826010001_extensions.sql`    | `citext`、append-only 強制関数 `astra_deny_mutation()`                                 |
| `20260826010002_identity.sql`      | `tenants` `users` `memberships` `devices` `sessions`                                   |
| `20260826010003_conversations.sql` | `conversations` `turns`（逸脱 D-06。書き込みは Phase 1）                               |
| `20260826010004_tasks.sql`         | `tasks` `event_streams` `task_events` `approvals` `action_receipts`                    |
| `20260826010005_library.sql`       | `artifacts` `artifact_versions`、`tasks.result_artifact_id` の FK 付与                 |
| `20260826010006_plugins.sql`       | `plugin_publishers` `plugins` `plugin_versions` `plugin_installs` `plugin_permissions` |
| `20260826010007_audit.sql`         | `audit_sequences` `audit_events`                                                       |
| `20260826010008_rls.sql`           | 全テナントテーブルの RLS 有効化・FORCE・ポリシー                                       |

すべてのマイグレーションは `up` / `down` 双方向が通ること（CI で往復を検査する）。

#### 設計上の要点

**冪等性と重複防止**（正本 §24）

| 制約                                                         | 何を防ぐか                                            |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `tasks_idempotency (tenant_id, created_by, idempotency_key)` | API 層でのタスク二重作成                              |
| `tasks_workflow_id (workflow_id)`                            | Temporal workflow とタスク行の 1:1 崩れ               |
| `task_events_stream_seq (stream_kind, stream_id, sequence)`  | sequence の重複                                       |
| `task_events_idem (stream_kind, stream_id, idempotency_key)` | activity 再実行によるイベント二重挿入                 |
| `approvals_task_step (task_id, step_index)`                  | `requestApproval` 再実行による承認の重複生成          |
| `action_receipts_idem (task_id, tool_id, inputs_hash)`       | 同一入力の receipt 二重記録                           |
| `sessions_rotation_chain (rotated_from)`                     | refresh token の再利用（同じ親から 2 本目が生えない） |

**append-only**（正本 §9.4 / §21、受け入れテスト AC-16）

`task_events` `action_receipts` `audit_events` は `astra_deny_mutation()` トリガで
UPDATE / DELETE / TRUNCATE を DB 側から拒否する。アプリの規律に依存させない。

トリガは **文レベル (`FOR EACH STATEMENT`)** で張ること。行レベルにすると
0 行に一致する UPDATE / DELETE がそのまま成功し、TRUNCATE は素通しになるため、
append-only の保証にならない（実装中に検出。`infra/db/verify.sh` が回帰を検査する）。

**採番**

`event_streams.next_seq` と `audit_sequences.next_seq` は、`UPDATE ... RETURNING` で
採番と挿入を同一トランザクションに閉じる（§7.2）。連番が意味を持つ列は必ずこの形にする。

**索引の方針**

- カーソルページングは UUIDv7 の時系列性を使うので `tasks_recent (tenant_id, id DESC)` で足りる。
- Library の既定表示は「最近使ったもの」なので `artifacts_recent (tenant_id, updated_at DESC, id DESC)`。
  `id` を tiebreak に入れてカーソルを安定させる。
- `task_events` のリプレイは `task_events_stream_seq` の範囲スキャンだけで賄う。
  **`payload` を `INCLUDE` しない** — jsonb は TOAST され得るため索引が肥大する。

**チェック制約で表現した不変条件**

- `plugin_versions_signed`: `signature_state = 'UNSIGNED'` の行は存在できない（§9.2）
- `approvals_decision_complete`: `APPROVED` / `REJECTED` なら `decided_by` と `decided_at` が必ず揃う
- `audit_events_chain_root`: ハッシュ連鎖の先頭 (`seq = 1`) だけ `prev_hash` が NULL
- `inputs_hash` / `sha256` / `manifest_sha256` は小文字 16 進 64 桁

#### RLS（実装仕様 §4.4 の DB 層）

`20260826010008_rls.sql` が `tenant_id` 列を持つ全 16 テーブル + `tenants` + `users` に
ポリシーを張る。`plugin_publishers` / `plugins` / `plugin_versions` はテナント横断の
カタログなので対象外。

```sql
CREATE FUNCTION astra_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
```

**実測で確認した落とし穴（実装時に必ず守ること）**

1. **`SET LOCAL` はトランザクション内でしか効かない。** 外で実行すると `WARNING` が出るだけで
   設定は入らず、`astra_current_tenant()` が NULL になって全行が見えなくなる。
   fail-closed ではあるが、`withTenant` は**必ずトランザクションを開く**こと。
2. **superuser と `BYPASSRLS` ロールは `FORCE ROW LEVEL SECURITY` すら無視する。**
   アプリが superuser で接続した瞬間にテナント隔離が消える。接続ロールは
   `infra/db/bootstrap.sql` の `astra_app`（非 superuser・非 BYPASSRLS）を使う。
   ロールはデータベースを跨ぐためマイグレーションではなく運用手順に置いた。
3. 他テナント行への `UPDATE` はエラーにならず **0 行更新**になる。
   「更新できた」ことを行数で確認しないコードはバグを見逃す。

### 5.4 `packages/db`

DB へのアクセスは**必ず**この 3 つのスコープを通す。生の `pool.query` を service から
直接呼ばない（実装仕様 §14.3-1 で CI が機械検査する）。

```ts
export function createDb(config: DbConfig): DbHandle;

/** テナントに属する全処理。既定。 */
export function withTenant<T>(
  h: DbHandle,
  tenantId: string,
  fn: (tx: ScopedDb) => Promise<T>,
): Promise<T>;

/** テナントを持たない処理（プラグインカタログ）。RLS 対象は 1 行も見えない。 */
export function withSystem<T>(h: DbHandle, fn: (tx: ScopedDb) => Promise<T>): Promise<T>;

/** 認証だけ。テナント確定前に users を引く必要がある（逸脱 D-14）。 */
export function withIdentity<T>(h: DbHandle, fn: (tx: ScopedDb) => Promise<T>): Promise<T>;

export function currentTenantId(): string | null;
export function currentScopeKind(): 'tenant' | 'system' | 'identity' | null;
```

#### スコープと接続ロールの対応

| スコープ       | 接続ロール       | RLS                             | 触れるテーブル                                                            |
| -------------- | ---------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `withTenant`   | `astra_app`      | 効く（`app.tenant_id` を設定）  | 全テーブル。ただし自テナント行のみ                                        |
| `withSystem`   | `astra_app`      | 効く（GUC 未設定 → 全行不可視） | 実質カタログのみ（`plugins` 系）                                          |
| `withIdentity` | `astra_identity` | BYPASSRLS                       | `tenants` `users` `memberships` `devices` `sessions` のみ（GRANT で限定） |

#### なぜ identity スコープが要るか（逸脱 D-14）

**認証はテナントが決まる前に走る。**

- ログイン: メールアドレスから `users` を引く時点では、どのテナントかまだ分からない。
  `users` の RLS ポリシーは membership 依存なので、テナント未設定では 0 行しか見えない。
- サインアップ: `users` を作る時点では membership がまだ無いので、
  `WITH CHECK` を満たせず INSERT 自体が弾かれる（鶏と卵）。

これを RLS ポリシーの緩和（`users` の INSERT を permissive にする等）で解こうとすると、
アプリのバグが即座に他テナントへ波及する経路を作ることになる。
そこで **BYPASSRLS だが identity テーブルにしか GRANT されていない専用ロール**を分ける。
BYPASSRLS の影響範囲を GRANT で物理的に閉じ込めるのが要点で、
`withIdentity` から `tasks` を触ると DB が `permission denied` を返す（結合テストで検査済み）。

`ASTRA_DB_IDENTITY_URL` が未設定なら `withIdentity` は**明示的に失敗する**。
黙ってアプリロールへフォールバックしない（気づかないまま認証が壊れるより落ちる方がよい）。

#### ネスト規則

in-process composition（ADR 0001）でサービス同士が呼び合うため、スコープのネストは起きる。

- `withTenant` の中の同一テナント `withTenant` → **既存トランザクションに相乗り**。
  トランザクションが分裂しないので、外側の rollback で内側の書き込みも消える。
- `withTenant` の中の**別テナント** `withTenant` → 例外。
  テナントをまたぐ書き込みを 1 つの論理処理にさせない。
- スコープ種別をまたぐネスト（tenant の中で system / identity 等）→ すべて例外。

#### 型生成

`Database` 型は `infra/db/schema.sql` から `kysely-codegen` で生成し、
`packages/db/src/generated/schema.ts` としてコミットする（`pnpm db:codegen`）。
CI で「生成物が最新か」を検査する（§14.3-3）。

## 6. Task Runtime（Temporal）

### 6.1 なぜワークフローが要るか（正本 §16.3 の再確認）

Phase 0 で扱うタスクは echo だが、**最初から本番の耐久性**で作る。
plan → execute → retry → waiting approval → resume → artifact を後から差し込むのは
状態管理の作り直しになるため。

### 6.2 識別子とキュー

| 項目                     | 値                              |
| ------------------------ | ------------------------------- |
| namespace                | `astra-<env>`                   |
| 制御用 task queue        | `astra.task.v1`                 |
| worker 用 task queue     | `astra.worker.document.v1` ほか |
| workflow id              | `task/<tenantId>/<taskId>`      |
| workflow id reuse policy | `REJECT_DUPLICATE`              |

重複実行の防止は二段:

1. `tasks` の `(tenant_id, created_by, idempotency_key)` 一意制約で API 層が弾く
2. Temporal の workflow id 一意性で実行層が弾く

### 6.3 `TaskWorkflow`

```ts
export interface TaskWorkflowInput {
  taskId: TaskId;
  tenantId: TenantId;
  userId: UserId;
  kind: string;
  input: Record<string, unknown>;
}

export const approveSignal = defineSignal<[ApprovalDecision]>('approve');
export const cancelSignal = defineSignal<[{ reason: string }]>('cancel');
export const getStateQuery = defineQuery<TaskStateSnapshot>('getState');

export async function TaskWorkflow(input: TaskWorkflowInput): Promise<TaskResult>;
```

制御フロー:

```text
emit task.started / status=RUNNING
  ↓
handler = registry.resolve(kind)          ← 未登録 kind は非再試行エラーで即 FAILED
  ↓
for each step in handler.plan(input):
    emit tool.started
    if policy.requiresApproval(step.risk):        ← packages/policy
        approvalId = requestApproval(step)
        emit task.waiting_approval / status=WAITING_APPROVAL
        await condition(() => decided(approvalId), '24h')
        timeout      → FAILED   code='approval.timeout'
        REJECTED     → CANCELLED code='approval.rejected'
        APPROVED     → 続行（承認時の編集値を step に反映）
    result = await executeStep(step)               ← activity
    writeActionReceipt(step, result)               ← write 系のみ。activity
    emit tool.completed / task.progress
  ↓
artifactId = createArtifact(handler.compose(results))
emit artifact.created
status=COMPLETED / emit task.completed → return { artifactId }
```

cancel シグナルは各 `await` 境界でチェックし、`CANCELLING` → 後処理 → `CANCELLED`。
実行中の外部書き込みを中断しない（中途半端な外部副作用を作らない）。

### 6.4 Activity 一覧（Phase 0）

すべて冪等。冪等キーは `<taskId>:<stepIndex>:<activityName>`。

| activity             | 役割                                                      | 冪等化                                               |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `appendEvent`        | `event_streams` 採番 + `task_events` 挿入 + Redis publish | `task_events_idem` 一意制約で二重挿入を無視          |
| `updateTaskStatus`   | `tasks.status` 遷移                                       | 遷移表で許可された遷移のみ。同一状態への遷移は no-op |
| `requestApproval`    | `approvals` 挿入                                          | `(task_id, step_index)` 一意                         |
| `executeStep`        | ツール実行。Phase 0 は `echo` のみ                        | ハンドラが冪等キーを受け取る                         |
| `writeActionReceipt` | `action_receipts` 挿入                                    | `(task_id, tool_id, inputs_hash)` 一意               |
| `createArtifact`     | object store put + `artifacts`/`artifact_versions` 挿入   | `sha256` + `source_task_id` で既存を再利用           |
| `writeAuditEvent`    | `audit_events` にハッシュ連鎖で追記                       | `(tenant_id, seq)`                                   |

### 6.5 再試行とタイムアウト（正本 §24）

```ts
const toolActivityOptions = {
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 5,
    nonRetryableErrorTypes: [
      'ValidationError', // 入力が不正 → 何度やっても同じ
      'PermissionDenied', // 権限が無い
      'ApprovalRejected',
      'UnknownTaskKind',
      'TenantMismatch',
    ],
  },
};
const persistenceActivityOptions = {
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 10 }, // DB は粘る
};
```

- workflow 実行時間の上限は `workflowExecutionTimeout: '7 days'`（承認待ちを許容）。
- 承認待ちの上限は 24 時間（`approvals.expires_at` と一致させる）。

#### 実装で確定した順序（守らないと壊れる）

1. **ワークフローの起動は DB のコミット後。** 逆順にすると、タスク行が見える前に
   activity が走り「知らないタスク」を更新しに行く。
2. **計画（`planTask`）は純粋関数。** ワークフローのコードはサンドボックスで動くため、
   乱数・時刻・I/O・Node の API に触れない。`@astra/contracts` も import しない
   （`uuidv7` が Web Crypto を触る）。ID 採番と時刻取得はすべて activity 側。
3. **冪等キーは `<taskId>:<stepIndex>:<activityName>`。** Temporal は activity を
   再実行し得るので、二重発火は DB の一意制約で吸収する。
4. **取消は実行中の外部書き込みを中断しない。**中途半端な副作用を作らない（正本 §24）。

- 失敗は握りつぶさない。正本 §24「勝手に成功扱いしない」に従い、
  代替経路が無い場合は必ず `task.failed` を発火して停止する。

### 6.6 Phase 0 のタスク種別

`kind = 'echo'` のみ登録する。

```text
input:  { "message": "hello", "steps": 3 }
挙動:   steps 回 task.progress を発火し、最後に text/markdown の Artifact を作る
目的:   API → workflow → event stream → object store → artifact の全経路を通す
```

承認経路の検証用に `kind = 'echo'`, `input.require_approval = true` を用意し、
`WAITING_APPROVAL` → `POST /v1/tasks/{id}/approve` → 続行 を受け入れテストで確認する（§16）。

---

## 7. リアルタイム配信

### 7.1 トランスポートの決定

| 用途                                                                                | 方式          | 理由                                                                |
| ----------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| サーバ → クライアントの一方向ストリーム（task / conversation / meeting transcript） | **SSE**       | `Last-Event-ID` による再開が仕様として存在し、HTTP/2 でそのまま通る |
| 双方向（Local Host Bridge、会議音声アップロード）                                   | **WebSocket** | クライアント→サーバのフレームが要る                                 |

正本 §19 が `GET /v1/conversations/{id}/stream` と `WS /v1/meetings/{id}/audio` を
書き分けているのと一致する（逸脱 D-04 として明示登録）。

### 7.2 sequence の保証

```sql
-- appendEvent activity の中身（単一トランザクション）
UPDATE event_streams SET next_seq = next_seq + 1
 WHERE stream_kind = $1 AND stream_id = $2
 RETURNING next_seq - 1 AS sequence;

INSERT INTO task_events (event_id, tenant_id, stream_kind, stream_id, sequence, type,
                         task_id, payload, idempotency_key)
VALUES (...)
ON CONFLICT (stream_kind, stream_id, idempotency_key) DO NOTHING;
```

- `sequence` は stream 内で **1 始まり・欠番なし・単調増加**。
- 採番と挿入を同一トランザクションにするため、`ON CONFLICT DO NOTHING` が発火した場合は
  採番した番号を捨てる（欠番になる）。これを避けるため、**冪等キーによる既存行の確認を先に行い、
  存在すればトランザクションを開始せず既存イベントを返す**。
- 「欠番なし」はクライアントの取りこぼし検知に使う契約なので、緩めない。

### 7.3 購読と再開

```text
GET /v1/tasks/{taskId}/stream
Accept: text/event-stream
Last-Event-ID: 42            （任意。無ければ 0 扱い）
```

サーバ側の手順:

1. Redis チャネル `astra:stream:task:{taskId}` を先に購読し、受信分をバッファへ退避
2. DB から `sequence > lastEventId` を昇順で読み、そのまま送出
3. バッファのうち「DB 読み出しの最大 sequence 以下」を捨て、残りを送出
4. 以降はライブ配信

購読を先に張ってから DB を読むことで、リプレイとライブの隙間で落ちるイベントを無くす。
クライアントは `sequence` の欠番を検知したら再接続する。

SSE フレーム:

```text
id: 42
event: task.progress
data: {"event_id":"…","type":"task.progress","sequence":42,…}
```

- ハートビート: 15 秒ごとに `: ping` を送る（LB のアイドル切断対策）。
- 終端: `task.completed` / `task.failed` / `task.cancelled` を送出後にサーバから close。
- `task_events` の保持期間は 90 日（Phase 0 は削除ジョブを作らない。§18 OQ-6）。

---

## 8. Library と Object Storage

### 8.1 ObjectStore 抽象

```ts
export interface ObjectStore {
  put(
    key: string,
    body: Readable | Buffer,
    opts: { contentType: string },
  ): Promise<{ size: number; sha256: string }>;
  get(key: string): Promise<Readable>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  signedReadUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
```

- Phase 0 の既定は `fs` アダプタ（`ASTRA_OBJECT_STORE_ROOT` 配下）。`gcs` アダプタは
  interface だけ用意し実装は Phase 2。
- `signedReadUrl` を interface に入れておくのは、正本 §2.3 の
  「raw storage URL を外部へ出さない / 署名済み短期 URL を都度発行」を後で満たすため。

### 8.2 object key 規約

```text
t/{tenantId}/a/{artifactId}/v/{version}/{safeFileName}
```

- テナント ID を先頭に置き、バケットレベルの誤設定でも越境しにくくする。
- `safeFileName` は ASCII 化 + 長さ 128 まで。元題名は `artifacts.title` に保持。

### 8.3 Phase 0 のアップロード経路

- サービス経由の直接アップロード（`POST /v1/artifacts`、multipart、上限 25MB）。
- 署名付き URL による直接アップロード / レジューム / 大容量（録音・動画）は Phase 2〜3。
- 保存時に必ず sha256 を計算して `artifact_versions.sha256` に記録する。
- 同一テナント内で `sha256` が一致する既存バージョンがある場合、object の再アップロードを省略し
  同じ `object_key` を参照する（Phase 0 では新規 artifact 行は作る）。

### 8.4 Phase 0 の API 範囲

作る: `POST /v1/artifacts`, `GET /v1/artifacts`, `GET /v1/artifacts/{id}`,
`GET /v1/artifacts/{id}/content`
作らない: 共有（Phase 2）、セマンティック検索（Phase 2、`searchable_text_ref` 列だけ用意）、
バージョン作成 API（Phase 1）。

---

## 9. Plugin Registry（Phase 0 範囲）

### 9.1 やること

1. `packages/plugin-sdk` に YAML 読み込み・正規化・署名検証・publisher 鍵管理を実装
   （manifest スキーマと不変条件は `packages/contracts` 側。§3.6）
2. `plugins/builtin/*/plugin.yaml` 5 本を検証して registry テーブルへ **seed** する
3. カタログ参照と install 記録の API（実行は無し）

### 9.2 署名

- 署名対象は manifest の **正規化 JSON**（キー昇順・空白なし・`signature` フィールド除外）。
- アルゴリズム Ed25519、公開鍵は `plugin_publishers.public_key`。
- `signature_state`:
  - `VERIFIED` … 署名検証成功
  - `BUILTIN_TRUSTED` … `builtin: true` かつアプリバンドル同梱（Phase 0 の 5 本はこれ）
  - `UNSIGNED` … 受け入れない（Phase 0 では登録を拒否）
- 実署名フローは Phase 4。Phase 0 は検証コードと状態列を用意するところまで。

### 9.3 install

```text
POST /v1/plugins/{pluginId}/install
{ "version": "0.1.0", "granted_scopes": ["email.read", "email.draft"] }
```

- `min_core_version` とアプリ版の互換チェック（不適合は `409 plugin.incompatible`）。
- 要求スコープのうち **未許可のものがあれば install は成立させるが、そのスコープは `granted=false`**
  で記録する（正本 §3 Step 5「一度に全 permission を要求しない」に対応）。
- install / スコープ付与は `audit_events` に必ず記録（`action='plugin.install'` / `'plugin.permission.grant'`）。
- `builtin: true` かつ `removable: false` のプラグインは uninstall を `403` で拒否。

---

## 10. Local Host Bridge

正本 §16.1 の Desktop/Local Control Plane と Cloud Control Plane を繋ぐ唯一の経路。

### 10.1 接続

```text
WS /v1/host/bridge
  Sec-WebSocket-Protocol: astra.host.v1, bearer.<device token>
```

- device token は §4.2 の `aud: astra-host-bridge`。access token は使わない
  （ブラウザに漏れたトークンでホスト実行を呼べないようにする）。
- 1 device 1 接続。重複接続は古い方を切る。
- ハートビート 20 秒、無応答 60 秒で切断。

### 10.2 メッセージ

```jsonc
// cloud → host
{ "type": "host.call", "call_id": "<uuid>", "capability": "host.ping",
  "args": {}, "task_id": "<uuid>", "risk": "READ", "deadline_ms": 10000 }

// host → cloud
{ "type": "host.result", "call_id": "<uuid>", "ok": true, "value": { "pong": true } }
{ "type": "host.result", "call_id": "<uuid>", "ok": false,
  "error": { "code": "host.capability_denied", "message": "…" } }

// host → cloud（自発）
{ "type": "host.hello", "device_id": "…", "app_version": "…",
  "capabilities": ["host.ping", "host.system.info"] }
```

### 10.3 能力ゲート（ホスト側で必ず実行）

`host.call` を受け取ったホストは、実行前に順に検査する。1 つでも落ちたら `capability_denied`。

1. `capability` が **ホストが hello で申告した集合**に含まれるか
2. その capability を要求できるプラグインが当該テナントに install 済みで、対応スコープが `granted=true` か
3. `risk` が `READ` 以外なら、ユーザー承認済み（`approvals` の承認済み ID が同伴）か
4. OS 権限（マイク・アクセシビリティ・画面収録・ファイル）が許諾済みか

**クラウド側の指示を信用しない**。正本 §21「local-first boundaries」を成立させるには、
最終判断がローカルに無ければ意味がない。

### 10.4 実行セマンティクス

- `call_id` で at-most-once。ホストは処理済み `call_id` を 10 分間保持し、重複は前回結果を返す。
- `deadline_ms` 超過はホスト側で中断し `host.timeout` を返す。クラウド側は再試行しない
  （副作用の二重実行を避ける。再試行は上位の workflow が明示的に行う）。
- Phase 0 の capability は `host.ping` と `host.system.info` の 2 つだけ。
  ファイル・画面・音声は Phase 1 以降。

---

## 11. Phase 0 の API 一覧

正本 §19 のうち Phase 0 で実装するもの。ここに無いものは実装しない。

```text
POST   /v1/auth/dev/token                 開発専用。本番ビルドでは未登録
POST   /v1/auth/refresh                   refresh token ローテーション
POST   /v1/auth/logout
GET    /v1/me                             user / tenant / device

POST   /v1/tasks                          Idempotency-Key ヘッダ必須
GET    /v1/tasks                          カーソルページング（UUIDv7 の時系列性を利用）
GET    /v1/tasks/{taskId}
POST   /v1/tasks/{taskId}/cancel
POST   /v1/tasks/{taskId}/approve         { approval_id, decision, edits? }
GET    /v1/tasks/{taskId}/stream          SSE。Last-Event-ID 対応

POST   /v1/artifacts                      multipart。<= 25MB
GET    /v1/artifacts
GET    /v1/artifacts/{artifactId}
GET    /v1/artifacts/{artifactId}/content

GET    /v1/plugins/catalog
GET    /v1/plugins/{pluginId}
POST   /v1/plugins/{pluginId}/install
DELETE /v1/plugins/{pluginId}             builtin かつ removable=false は 403

WS     /v1/host/bridge

GET    /healthz                           liveness
GET    /readyz                            DB / Redis / Temporal 接続確認
```

### 11.1 HTTP 基盤

フレームワークは Fastify 5（ADR 0004）。フックの順序が挙動を決めるので固定する。

```text
genReqId          request id を 1 回だけ確定させる（採番はここだけ）
  ↓
onRequest         request id をレスポンスヘッダとログの相関 ID に載せる
  ↓
preHandler(auth)  トークン検証 → RequestContext に user / tenant / device を入れる … P0-09
  ↓
preHandler(rate)  レート制限。user 単位で数えるので認証より後
  ↓
handler
  ↓
errorHandler      AstraError / ZodError / それ以外 を §3.7 の形へ写す
```

**request id を信用しない**: 受け取った `X-Request-Id` はログの相関キーになるので、
`^[A-Za-z0-9._:-]{8,128}$` に合わないものはサーバ側で採番し直す。

**内部例外を外へ出さない**: 未知の例外は `common.internal` / `internal error` に潰す。
接続文字列や秘密が例外メッセージに載ることがあるため、文面をそのまま返さない。
詳細はログと trace にだけ残す。

**liveness と readiness を分ける**:

| 経路       | 見るもの                             | 落ちたとき                 |
| ---------- | ------------------------------------ | -------------------------- |
| `/healthz` | プロセスが生きているか。依存を見ない | 再起動される               |
| `/readyz`  | DB / Redis（後に Temporal）に届くか  | トラフィックから外れるだけ |

混ぜると DB の一時的な不調でプロセスが再起動され続ける。
依存確認には 2 秒のタイムアウトを掛ける（probe が固まるとローリング更新が止まる）。

### 11.2 レート制限

`RateLimiter` インターフェースの背後に 2 実装:

| 実装                | 用途                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `MemoryRateLimiter` | 開発とテスト。**本番では使わない**（水平スケールすると実質無制限） |
| `RedisRateLimiter`  | 本番。sorted set のスライディングウィンドウ                        |

Redis 実装は判定・掃除・追加を 1 本の Lua スクリプトにまとめる。
分割して発行すると、読み取りと書き込みの間に別プロセスが割り込んで上限を超えて通る。

守る性質:

1. **拒否は窓を埋めない。** 拒否がさらに窓を延ばすと、叩き続ける限り永久に開かなくなる。
2. **固定境界でリセットしない。** スライディングウィンドウにして境界直後のバースト（実質 2 倍）を防ぐ。
3. **同一ミリ秒の複数リクエストを 1 件に潰さない。** member にプロセス内カウンタを混ぜる。
4. ヘルスプローブは対象外（`config.rateLimit: false`）。

制限単位はルートが `config.rateLimit` で宣言する。未認証で `by: 'user'` の場合は IP へ落ちる。

共通ヘッダ:

| ヘッダ                                 | 用途                                             |
| -------------------------------------- | ------------------------------------------------ |
| `Authorization: Bearer <access token>` | 認証                                             |
| `Idempotency-Key`                      | `POST /v1/tasks` で必須。24 時間保持             |
| `X-Request-Id`                         | 無ければサーバが採番し、レスポンスとログに載せる |
| `X-Astra-Client`                       | `desktop/0.1.0 (macos)` 形式。互換判定に使う     |

---

## 12. DeepNote 資産の再利用マッピング

`/Users/horioshuuhei/Projects/deepnote-desktop` を実際に確認した結果に基づく
（正本 §27 の「再利用候補」を実ファイルへ落としたもの）。**Phase 0 では 1 つも移植しない**。
移植先と担当 Phase を先に決めておくための表。

| 旧 (`deepnote-desktop/src-tauri/src/`)                                                             | 内容                                       | 移植先                                                                         | Phase |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ | ----- |
| `stt/sherpa.rs`, `sherpa_ffi.rs`, `vad.rs`, `lid.rs`                                               | ローカル日本語 STT + VAD + 言語判定        | `apps/desktop/src-tauri/src/stt/` の `StreamingSTTProvider` 実装（正本 §11.1） | 1     |
| `stt/cloud_stream.rs`, `translation_recognizer.rs`                                                 | クラウド STT ストリーム、翻訳認識          | meeting-service の Live Path（正本 §11.2）                                     | 3     |
| `audio/capture.rs`, `system_capture.rs`, `mixer.rs`, `resampler.rs`, `recorder.rs`                 | マイク + システム音声の取り込みと混合      | 会議音声パイプライン                                                           | 3     |
| `task_dock/geometry.rs`, `hover_controller.rs`, `host_resolver.rs`, `glance_trigger.rs`, `jump.rs` | ウィンドウ配置・フォーカス・呼び出しの挙動 | Task Dock v2（正本 §4）                                                        | 1     |
| `task_runtime/engine.rs`, `repository.rs`, `migrations.rs`                                         | ローカル SQLite のタスク永続化             | Desktop 側のローカルキャッシュ / オフライン継続                                | 1     |
| `local_artifacts/`                                                                                 | ローカル成果物とリビジョン管理             | Library のローカルキャッシュ                                                   | 2     |
| `auth/keychain.rs`                                                                                 | Keychain 保管                              | refresh / device token 保管（§4.2）                                            | 1     |
| `auth/{apple,google,firebase,line}.rs`                                                             | 各種 IdP                                   | IdP 選定後に再検討（§18 OQ-1）                                                 | 1     |
| `models/sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01`                                          | 日本語 ASR モデル                          | 同梱方式ごと再利用                                                             | 1     |

**引き継がないもの**（正本 §27）: 旧情報設計、旧バックエンドの密結合、機能別画面遷移、
Agent ごとの個別実装、ハードコードされた provider ルーティング。

---

## 13. 観測性と監査

### 13.1 `packages/telemetry`

```ts
export const logger: Logger; // pino, JSON, request_id/task_id を必ず載せる
export function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>;
export function auditEvent(e: AuditEventInput): Promise<void>;
```

- トレースは `@opentelemetry/api` だけに依存する。SDK の初期化は各サービスの起動側で行う。
  SDK 未設定なら API 側が no-op になるので、呼び出しコードは変えなくてよい。
- ログに **PII とプロンプト本文を出さない**。出すのは ID と種別と件数。
  伏せるキーは `REDACTED_KEYS` に列挙し、1 階層目から 3 階層目まで pino の redact で潰す。
  機密フィールドを増やしたらこの配列にも足す。
- 相関 ID: `request_id`（HTTP 単位） / `task_id` / `trace_id` の 3 本を全ログに載せる。
- trace context は Temporal のヘッダで workflow / activity へ伝播させる（P0-11）。

### 13.2 監査必須イベント（Phase 0）

ハッシュ連鎖の性質:

```text
hash(n) = sha256(canonicalJson({ ...row(n), prev_hash: hash(n-1) }))
```

- 連鎖リンクは**保存済みの hash** を辿る。1 行だけ書き換えられた場合、壊れるのは
  その行の `hash_mismatch` だけになり、**どの行が改変されたか一意に分かる**。
- 改竄者が hash も付け替えたなら、後続の `prev_hash` が合わなくなって `broken_link` が出る。
- `audit_sequences` の行を `UPDATE ... RETURNING` で更新することで、同一テナントの追記が
  トランザクション単位で直列化される。この行ロックが連鎖の前提になっている。
- **限界**: 連鎖全体を整合的に作り直されると、この仕組みだけでは検出できない。
  定期的に最新 hash を外部へ固定する運用が要る（§18 OQ-10）。

監査必須イベント:

`session.created` `session.rotated` `session.reuse_detected` `session.revoked`
`plugin.install` `plugin.uninstall` `plugin.permission.grant` `plugin.permission.revoke`
`approval.requested` `approval.decided` `approval.expired`
`task.created` `task.cancelled`
`artifact.created` `artifact.downloaded`
`host.capability_denied`

### 13.3 SLO 計測の下地

正本 §23 の SLO は Phase 0 では測れない（UI と STT が無い）。ただし
`task.progress` の発火間隔と `POST /v1/tasks` のレイテンシは Phase 0 から計測する。
正本 §4.3「2 秒を超える処理は progress event を出す」を守れているかを、
**受け入れテストで機械的に検査する**（§16 の AC-6）。

---

## 14. テストと検証

### 14.1 レイヤ

| 種別        | 対象                                                        | 場所                             |
| ----------- | ----------------------------------------------------------- | -------------------------------- |
| unit        | Zod スキーマ、policy 判定、manifest 不変条件、sequence 採番 | 各 package の `src/**/*.test.ts` |
| integration | DB + Temporal test environment を使ったワークフロー         | `services/task/test/`            |
| acceptance  | §16。HTTP を実際に叩く                                      | `evals/actions/phase0/`          |
| contract    | builtin manifest 5 本の検証                                 | `packages/plugin-sdk/test/`      |

### 14.2 eval harness の契約（Phase 0 で決めるだけ）

正本 §25 の各スイートは Phase 1 以降で埋める。Phase 0 では置き場所と形式だけ決める。

```text
evals/<domain>/<case-id>/
  input.json        入力
  expected.json     期待（完全一致 or 判定基準）
  meta.yaml         { phase, tags, blocking: true|false }
```

`blocking: true` のケースは CI で落とす。Phase 0 では `evals/actions/phase0/` のみ blocking。

### 14.3 機械的に守らせる規約

CI で検査する（実装は Phase 0 の P0-16）:

1. service コードからの生 `pool.query` 直呼び禁止（`withTenant` / `withSystem` 経由のみ）
2. `services/*` が他 `services/*` の内部パスを import していないこと
3. `infra/db/schema.sql` と `packages/db` の生成型が最新であること
4. `packages/contracts` に破壊的変更が入った場合、`CONTRACTS_VERSION` が上がっていること

---

## 15. Phase 0 チケット分解

依存順。カッコ内は前提チケット。

| ID    | 内容                                                                                      | DoD                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| P0-01 | monorepo scaffold（本コミットで完了）                                                     | `pnpm install` / `pnpm build` が通る                                                                  |
| P0-02 | `packages/contracts`: ID / エラー / codec / EventEnvelope / EventType union               | unit test green、snake⇄camel 往復が同型                                                               |
| P0-03 | `packages/contracts`: Task / Approval / ActionReceipt / Artifact / PluginManifest (P0-02) | 全スキーマの正常系・異常系 test                                                                       |
| P0-04 | `infra/db` マイグレーション 0001〜0005 + RLS + append-only トリガ (P0-03)                 | `pnpm db:migrate` 成功、`schema.sql` 生成物をコミット                                                 |
| P0-05 | `packages/db`: pool / `withTenant` / `withSystem` / `withIdentity` / 生成型 (P0-04)       | 別テナントの行が見えないことの結合テスト。ネスト規則と identity ロールの権限境界も検査                |
| P0-06 | `packages/telemetry`: logger / span / auditEvent + ハッシュ連鎖 (P0-05)                   | 連鎖の検証・改竄検出・並行追記の直列化を実 DB で検査                                                  |
| P0-07 | `packages/policy`: ActionRisk → 承認要否の判定表 (P0-03)                                  | 正本 §9.2 の全リスク区分 × compliance profile を網羅する test                                         |
| P0-08 | api-gateway: HTTP 基盤 / エラー / request_id / rate limit / healthz / readyz (P0-05,06)   | `/readyz` が依存断で 503。内部例外の文面が外へ出ない。拒否が窓を延ばさない                            |
| P0-09 | 認証: dev token 発行 / refresh ローテーション / 再利用検知 / `GET /v1/me` (P0-08)         | 再利用検知でデバイスの全 session 失効 + audit（コミットされること）。device token で REST を叩けない  |
| P0-10 | task-service: `POST /v1/tasks` の受理と冪等化、Temporal 起動 (P0-09)                      | 同一 Idempotency-Key の二重 POST が同一 task を返し、workflow は 1 本だけ                             |
| P0-11 | Task Runtime: `TaskWorkflow` + activity 群 + `echo` handler (P0-10)                       | Temporal の test environment で green（`@temporalio/testing` はローカルサーバ内蔵なので Docker 不要） |
| P0-12 | イベント: `event_streams` 採番 / `appendEvent` / Redis publish (P0-11)                    | 縦串で欠番・重複なし。冪等キー付き再送で採番を消費しない                                              |
| P0-13 | SSE: `GET /v1/tasks/{id}/stream` + `Last-Event-ID` 再開 (P0-12)                           | 途中切断→再接続で全イベントが1回ずつ届く                                                              |
| P0-14 | 承認: `requestApproval` / `POST /approve` / 失効 (P0-11)                                  | 承認・却下・失効の3経路 test                                                                          |
| P0-15 | library-service: ObjectStore(fs) / artifact 作成 / 取得 / content (P0-05)                 | sha256 一致、越境アクセスが 404                                                                       |
| P0-16 | plugin-registry: manifest 検証 / builtin seed / catalog / install (P0-05)                 | builtin 5 本が検証を通り、不変条件違反を全部検出                                                      |
| P0-17 | Local Host Bridge: WS / device token / capability gate / `host.ping` (P0-09)              | 未申告 capability が denied、重複 call_id が再実行されない                                            |
| P0-18 | CI: build / typecheck / test / §14.3 の規約検査 / 受け入れテスト (全部)                   | main への push で全 gate green                                                                        |

`packages/{ui-kit,agent-sdk,plugin-sdk除く}` と `services/{conversation,context,research,meeting,share,agent-runtime,world-model,notification}`、
`workers/{research,media,domain}` は Phase 0 では **placeholder のまま**。

---

## 16. Exit 判定 — 受け入れテスト

`evals/actions/phase0/` に置き、CI の blocking gate にする。

```text
AC-1  POST /v1/auth/dev/token → access/refresh 取得。tenant が自動作成される
AC-2  POST /v1/tasks {kind:'echo', input:{message:'hi', steps:3}} → 202 + task_id
AC-3  同じ Idempotency-Key で再 POST → 同一 task_id、workflow は 1 本だけ
AC-4  GET /v1/tasks/{id}/stream で
        task.started → tool.started → task.progress×3 → tool.completed
        → artifact.created → task.completed
      が sequence 1..N の欠番なしで届く
AC-5  ストリームを sequence 3 で切断 → Last-Event-ID: 3 で再接続
      → 4 以降が過不足なく届く（重複ゼロ・欠落ゼロ）
AC-6  各 task.progress の間隔が 2 秒を超えない（正本 §4.3）
AC-7  GET /v1/artifacts/{result_artifact_id}/content が input.message を含み、
      sha256 が artifact_versions の値と一致する
AC-8  別テナントのトークンで同じ task/artifact を GET → 404（403 ではなく 404）
AC-9  input.require_approval=true → WAITING_APPROVAL で停止
      → POST /approve {decision:'APPROVED'} → COMPLETED
      → action_receipts に approved_by 付きの行が 1 件
AC-10 同上で decision:'REJECTED' → CANCELLED、外部副作用ゼロ、receipt なし
AC-11 POST /v1/tasks/{id}/cancel → CANCELLING → CANCELLED、task.cancelled 発火
AC-12 builtin manifest 5 本すべてが検証を通り、catalog に出る
AC-13 requires_confirmation を外した不正 manifest が拒否される（§3.6 不変条件1）
AC-14 host bridge に接続し host.ping が成功、未申告 capability が denied
AC-15 audit_events のハッシュ連鎖が全行で検証できる
AC-16 action_receipts / audit_events への UPDATE / DELETE が DB で拒否される
```

AC-1〜AC-7 が正本 §28 Phase 0 Exit の
「create task → progress → result artifact」の直接的な検証にあたる。
AC-8〜AC-16 は「後から入れられない性質」を Phase 0 で固定するための検証。

---

## 17. 正本 v0.1 からの逸脱・確定事項

いずれも正本の記述を否定するものではなく、実装可能な粒度へ落とす際の決定。
新たな逸脱を作る場合は本表に追記してから実装する。

| ID    | 逸脱・確定                                                                                                                       | 根拠                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01  | Phase 0〜3 はサービス境界を保ったまま **1 プロセスにデプロイ**する                                                               | §2.3。Phase 0 の検証対象を絞るため。境界維持ルールを §14.3 で機械検査                                                                                                      |
| D-02  | `packages/db` を §26 の構成に追加                                                                                                | SQL 正本 + 型付きアクセスの置き場所が §26 に無い                                                                                                                           |
| D-03  | Event envelope に `stream_kind` / `stream_id` / `tenant_id` を追加                                                               | 正本 §20 の「sequence で再送」を実装するには列の識別子が必要                                                                                                               |
| D-03b | イベント型に `task.cancelled` を追加                                                                                             | 正本 §24 が cancellation を必須にしているため                                                                                                                              |
| D-04  | サーバ→クライアントは SSE、双方向のみ WS                                                                                         | 正本 §19 の `GET …/stream` と `WS …/audio` の書き分けに一致                                                                                                                |
| D-05  | ID は UUIDv7、prefix 無し                                                                                                        | §1.2                                                                                                                                                                       |
| D-06  | `conversations` / `turns` の DDL を Phase 0 で作る（書き込みは Phase 1）                                                         | `tasks.conversation_id` の FK 先が必要                                                                                                                                     |
| D-07  | ORM を使わず dbmate(SQL) + Kysely                                                                                                | 正本 §18 が SQL 前提。スキーマ所有権を SQL に残す                                                                                                                          |
| D-08  | JSON は snake_case で統一                                                                                                        | 正本 §20 の封筒が snake_case。二重規約を作らない                                                                                                                           |
| D-09  | Phase 0 で承認状態機械と action receipt を実装する                                                                               | 後付け困難。正本 §9 の「勝手に成功扱いしない」は骨格側の性質                                                                                                               |
| D-10  | manifest に `data_accessed` / `compliance_profile` / `builtin` / `removable` を必須追加                                          | 正本 §2.4 の Plugin detail page 必須表示項目と §22 の profile mandatory を manifest 側で強制するため                                                                       |
| D-11  | 越境アクセスは 403 ではなく 404 を返す                                                                                           | 資源の存在自体を漏らさない                                                                                                                                                 |
| D-12  | plugin manifest のスキーマと不変条件を `packages/plugin-sdk` ではなく `packages/contracts` に置く                                | manifest は catalog 応答としても境界を越えるため。plugin-sdk は YAML 読み込みと署名検証を担当                                                                              |
| D-13  | codec に不透明キー集合（`OPAQUE_KEYS`）を設ける                                                                                  | `task.input` などユーザー由来 JSON のキーを変換すると値が壊れる。§1.1                                                                                                      |
| D-14  | 認証専用の DB スコープ `withIdentity` と最小権限 BYPASSRLS ロール `astra_identity` を追加                                        | 認証はテナント確定前に走るため RLS 下では users を引けず、サインアップは membership 不在で INSERT が弾かれる。RLS 緩和ではなく GRANT で BYPASSRLS の範囲を閉じ込める。§5.4 |
| D-15  | refresh token のハッシュに Argon2id ではなく sha256 を使う                                                                       | 対象が 256bit の乱数で辞書攻撃が成立しないため。Argon2id は利用者が選ぶ低エントロピーの秘密（共有リンクのパスワード）に限定する。§4.2                                      |
| D-16  | トップ Navigation の表示名を Home / Work / Library / Apps にする（正本 §2 は ホーム / AIエージェント / ライブラリ / プラグイン） | UI/UX §2.1 の名称方針。内部実装は Agent Runtime / Plugin Registry の名前を保持し、一般ユーザー向け表示だけ変える。タブが 4 つである点は変わらない                          |
| D-17  | `TaskDockState` を UI/UX §3 の状態機械に合わせる                                                                                 | THINKING/RESEARCHING/ACTING を `WORKING` へ畳み、`TYPING` を追加、`ERROR` を `FAILED_RECOVERABLE` / `FAILED_BLOCKED` に分割。§20                                           |
| D-18  | `Approval` に `impact`（主ボタン文言・対象件数・外部/内部・取り消し可否）を必須で持たせる                                        | UI/UX §14.1「Primary button は『承認』ではなく結果を書く」。サーバが影響範囲を持たないとクライアントが文言を組み立てられない。§20                                          |
| D-19  | `task.progress` に `detail` / `elapsed_ms` / `retrying` を追加                                                                   | UI/UX §6.1「12 sources」/ §6.2「段数が決まらない処理は % を出さない」「retry 中は『再試行中』に置き換える」。§20                                                           |

---

## 18. 未決事項（Phase 1 着手前に決める）

| ID    | 論点                                                                                                                                   | 影響範囲                         | 期限           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------- |
| OQ-1  | ID プロバイダ（自前 OIDC / Firebase Auth 継続 / WorkOS 等）。旧 DeepNote は apple/google/firebase/line を実装済み                      | §4.3, P0-09, 移植計画            | Phase 1 開始前 |
| OQ-2  | テナントモデル。個人利用が主か、法人テナント + 招待 + ロールを最初から持つか                                                           | §4.1, DDL, 課金                  | Phase 1 開始前 |
| OQ-3  | LLM プロバイダとルーティング方針。正本はモデル提供者を一切指定していない                                                               | Conversation/Research/Agent 全体 | Phase 1 開始前 |
| OQ-4  | Temporal Cloud か自前運用か（正本 §16.2 は "Temporal Cloud initially"）                                                                | 運用コスト、namespace 設計       | Phase 1        |
| OQ-5  | データリージョン。REGULATED（介護・医療）を国内リージョン必須とするか                                                                  | §22, インフラ設計                | Phase 4        |
| OQ-6  | `task_events` の保持期間と削除ジョブ、コールドストレージ移送                                                                           | ストレージコスト                 | Phase 2        |
| OQ-7  | ESLint 導入時期と規約（Phase 0 は Prettier のみ）                                                                                      | 開発体験                         | Phase 1        |
| OQ-8  | 課金・利用量計測。正本に記述が無い                                                                                                     | Plugin 課金表示（§2.4）に必要    | Phase 4        |
| OQ-9  | サービス名 "Astra" の商標・ドメイン確認                                                                                                | ブランド全体                     | Phase 1        |
| OQ-10 | 監査ハッシュ連鎖の外部アンカリング（最新 hash を WORM ストレージや別システムへ定期固定）。連鎖全体の作り直しはアプリ内では検出できない | §13.2, 規制対応                  | Phase 4        |

---

## 20. UI/UX 仕様との突合

`docs/spec/astra_ui_ux_detailed_spec_v0.1.docx` を読み込み、Phase 0 の契約と突き合わせた結果。
**UI に関しては UI/UX 仕様が製品仕様より優先**する（`docs/README.md`）。

### 20.1 契約へ反映した差分

| #   | UI/UX 仕様                                                                   | Phase 0 での対応                                                                                      |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | §2.1 トップ Navigation は Home / Work / Library / Apps                       | 表示名のみ変更（逸脱 D-16）。タブ数 4 固定は不変。API・DB の名前は変えない                            |
| 2   | §3 状態機械に `TYPING` / `WORKING` / `FAILED_RECOVERABLE` / `FAILED_BLOCKED` | `TaskDockState` を差し替え（D-17）。`dockStateFor` はエラーコードから 2 種の失敗を判別する            |
| 3   | §14.1 主ボタンは結果を書く。対象件数・外部/内部・取り消し可否を表示          | `Approval.impact` を必須化（D-18）。`task.waiting_approval` にも `primary_action_label` を載せる      |
| 4   | §6.1「12 sources」/ §6.2 進捗率は算出できるときだけ                          | `task.progress` に `detail` / `elapsed_ms` / `retrying` を追加（D-19）。段数不明は `step_count: null` |
| 5   | §21 エラーは次の行動を説明する                                               | `TaskError.recovery`（retry / reconnect / grant_permission / reauthenticate / handoff / none）を追加  |

契約のメジャー版を `0.2.0` へ上げた（§3.8）。

### 20.2 すでに一致していたもの

- §2.2 の 4 段階 Surface と正本 §4.4 の Progressive Surface
- §4.4「Dismiss と Cancel を同一操作にしない」→ `task.cancelled` は明示的な取消のみ（D-03b）
- §14 の Risk 表 → `packages/policy` の判定表（§3.4）と同一
- §23 の Telemetry 目標値 → 正本 §23 の SLO と同一
- §22「permission は利用直前に purpose-first」→ §9.3 の install 時スコープ部分許可

### 20.3 Phase 0 では扱わないが、後続で必要になるもの

| UI/UX §  | 内容                                                                | 対応 Phase                                  |
| -------- | ------------------------------------------------------------------- | ------------------------------------------- |
| §4.1     | Task Dock の geometry（Ready 560×56 など）                          | UI-1 / Phase 1                              |
| §5       | Context Lens。context を remove でき、remove 後は plan を再評価する | UI-1 / Phase 1。Context Engine の設計に効く |
| §7.1–7.2 | Workspace の 3-column とブレークポイント                            | UI-0 / Phase 1                              |
| §17      | Design tokens（色・タイポ・spacing・radius）                        | UI-0 / Phase 1。`packages/ui-kit` に置く    |
| §18–19   | Motion と Accessibility                                             | UI-0 / Phase 1                              |
| §20      | ショートカット（Option+Space 等、OS/IME 競合の検出）                | UI-1 / Phase 1                              |
| §12      | Meeting UX（Notes first、minimal indicator、citation jump）         | Phase 3                                     |
| §13・§15 | Research / Evidence の Progressive Disclosure（L0〜L3）             | Phase 2                                     |
| §16      | Notifications の Severity 4 段階                                    | Phase 6                                     |

### 20.4 UI 実装順（UI/UX §24）

Phase 0 の完了後、Phase 1 は UI-0 から始める。

```text
UI-0  Design tokens + shell + shared state      Light/Dark + 4-tab shell
UI-1  Task Dock + Context Lens                  OS 上で intent → context 確認
UI-2  Work Surface + progress + result          durable task の状態が見える
UI-3  Home / Work / Library                     task → artifact continuity
UI-4  Meeting start / indicator / notes / transcript
UI-5  Meeting finalize / citation jump
UI-6  Approval / receipts
UI-7  Apps / Pack install
```

UI/UX 仕様 §25 の AC-01〜AC-15 は Phase 1 以降の受け入れ条件であり、
Phase 0 の Exit（§16 の AC-1〜AC-16）とは別物。混同しない。

---

## 19. 参照

- 正本: `docs/spec/new_ai_platform_design_spec_v0.1.md`
- UI/UX 正本: `docs/spec/astra_ui_ux_detailed_spec_v0.1.docx`（閲覧用抽出: 同名 `.md`）
- 仕様書の階層と優先順位: `docs/README.md`
- ADR: `docs/adr/`
- 旧資産: `/Users/horioshuuhei/Projects/deepnote-desktop`（§12）
