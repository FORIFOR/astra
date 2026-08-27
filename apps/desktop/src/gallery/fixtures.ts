/**
 * 見た目の確認用の作り物。**開発ビルドの gallery だけが使う。**
 * 値は UI/UX 仕様の例（A社 商談準備 / 12 sources / 田中・伊藤）に揃えてある。
 */
import type {
  ContextSource,
  EvidenceLedger,
  MeetingBundle,
  MeetingSegment,
  ActionReceiptView,
  PluginCatalogEntry,
  DailyBrief,
} from '@astra/contracts';
import type { WorkView } from '../work/workView.js';
import type { TaskView } from '@astra/api-client';
import type { Artifact } from '@astra/contracts';
import type { TranscriptLine } from '../meeting/meetingView.js';

const now = Date.now();
const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();

export const workActive: WorkView = {
  title: 'A社 商談準備',
  status: 'RUNNING',
  steps: [
    {
      index: 0,
      state: 'done',
      label: '過去の商談とメールを確認',
      detail: null,
      startedAt: iso(-300_000),
      endedAt: iso(-240_000),
    },
    {
      index: 1,
      state: 'done',
      label: '案件状況を整理',
      detail: null,
      startedAt: iso(-240_000),
      endedAt: iso(-180_000),
    },
    {
      index: 2,
      state: 'active',
      label: '最新競合情報を調査中',
      detail: '12 sources',
      startedAt: iso(-180_000),
      endedAt: null,
    },
    {
      index: 3,
      state: 'todo',
      label: '提案資料を更新',
      detail: null,
      startedAt: null,
      endedAt: null,
    },
    {
      index: 4,
      state: 'todo',
      label: '商談ブリーフを作成',
      detail: null,
      startedAt: null,
      endedAt: null,
    },
  ],
  percent: null,
  attention: null,
  resultArtifactId: null,
  error: null,
  elapsedMs: 300_000,
  pausedReason: null,
  startedAt: iso(-300_000),
  endedAt: null,
  lastSequence: 5,
};

export const workWaiting: WorkView = {
  ...workActive,
  status: 'WAITING_APPROVAL',
  attention: {
    kind: 'approval',
    approvalId: 'apr-1',
    risk: 'EXTERNAL_COMMIT',
    summary:
      '3人にメールを送信します（山田 / 田中 / 鈴木）。件名: A社商談の事前確認。外部送信 · 3 通',
    primaryActionLabel: '3件送信する',
    expiresAt: iso(3_600_000),
  },
};

export const workDone: WorkView = {
  ...workActive,
  status: 'COMPLETED',
  steps: workActive.steps.map((s) => ({
    ...s,
    state: 'done' as const,
    endedAt: s.endedAt ?? iso(-10_000),
  })),
  resultArtifactId: 'art-brief',
  endedAt: iso(-10_000),
};

export const workRetrying: WorkView = {
  ...workActive,
  steps: workActive.steps.map((s, i) =>
    i === 2 ? { ...s, state: 'retrying' as const, detail: 'Gmail の応答が遅れています' } : s,
  ),
};

export const workFailed: WorkView = {
  ...workActive,
  status: 'FAILED',
  steps: workActive.steps.map((s, i) => (i === 2 ? { ...s, state: 'failed' as const } : s)),
  error: {
    code: 'PROVIDER_UNAVAILABLE',
    recovery: 'retry',
    explanation: '検索の提供元に 3 回繋ぎ直しましたが応答がありませんでした',
  },
  endedAt: iso(-5_000),
};

export const contextSources: readonly ContextSource[] = [
  {
    id: 'cur',
    category: 'current',
    label: 'Q4提案.pptx',
    reason: 'いま前面で開いているため',
    sensitivity: 'PRIVATE',
    removable: true,
    used: true,
  },
  {
    id: 'ent',
    category: 'entity',
    label: 'A社',
    reason: '依頼文に出てくる会社のため',
    sensitivity: 'PRIVATE',
    removable: true,
    used: true,
  },
  {
    id: 'sch',
    category: 'schedule',
    label: '明日 10:00 商談',
    reason: '予定表に A社 の商談があるため',
    sensitivity: 'PRIVATE',
    removable: true,
    used: true,
  },
  {
    id: 'int',
    category: 'internal',
    label: '関連メール 8 件',
    reason: 'A社 の名前を含む最近のメール',
    sensitivity: 'CONFIDENTIAL',
    removable: true,
    used: false,
  },
  {
    id: 'drv',
    category: 'internal',
    label: '資料 4 件',
    reason: 'A社 に共有した資料',
    sensitivity: 'PRIVATE',
    removable: true,
    used: false,
  },
  {
    id: 'web',
    category: 'external',
    label: 'Web 検索',
    reason: '競合の最新情報を調べるため',
    sensitivity: 'PRIVATE',
    removable: true,
    used: true,
  },
  {
    id: 'pol',
    category: 'policy',
    label: 'Local-only',
    reason: '社外秘の資料が含まれるため端末の外へ出さない',
    sensitivity: 'CONFIDENTIAL',
    removable: false,
    used: true,
  },
] as unknown as readonly ContextSource[];

export const receipts: readonly ActionReceiptView[] = [
  {
    id: 'r1',
    task_id: 't1',
    summary: '3人にメールを送信しました（山田 / 田中 / 鈴木）',
    risk: 'EXTERNAL_COMMIT',
    actor: 'user',
    approved_by_name: '山田 太郎',
    executed_at: iso(-600_000),
    reversible_until: null,
    result_ref: 'gmail:thread/abc',
    tool_id: 'gmail.send',
  },
  {
    id: 'r2',
    task_id: 't1',
    summary: '商談ブリーフの下書きを作りました',
    risk: 'REVERSIBLE_WRITE',
    actor: 'agent',
    approved_by_name: null,
    executed_at: iso(-900_000),
    reversible_until: iso(3_600_000),
    result_ref: 'art-brief',
    tool_id: 'artifacts.write',
  },
  {
    id: 'r3',
    task_id: 't1',
    summary: null,
    risk: 'READ',
    actor: 'agent',
    approved_by_name: null,
    executed_at: iso(-1_200_000),
    reversible_until: null,
    result_ref: null,
    tool_id: 'gmail.search',
  },
] as unknown as readonly ActionReceiptView[];

export const ledger: EvidenceLedger = {
  task_id: 't1',
  question: '主要競合の価格改定の動き',
  source_count: 12,
  confidence: 'high',
  contradiction_count: 1,
  groups: [
    { source_type: 'official', count: 4 },
    { source_type: 'filing', count: 3 },
    { source_type: 'news', count: 4 },
    { source_type: 'internal', count: 1 },
  ],
  key_claims: [
    'B社は 10 月に法人向け価格を平均 8% 引き上げた',
    'C社は年内の価格据え置きを公表している',
  ],
  items: [
    {
      id: '4c1d2b1e-8b7f-4b1a-9c1e-1a2b3c4d5e01',
      claim: 'B社は 10 月に法人向け価格を平均 8% 引き上げた',
      source_url: 'https://example.com/b/pricing',
      source_type: 'official',
      publisher: 'B社',
      title: '法人向け価格改定のお知らせ',
      snippet: '2026年10月1日より…平均 8% の改定',
      published_at: iso(-86_400_000 * 20),
      retrieved_at: iso(-3_600_000),
      provider: 'brave',
      quality_score: 0.9,
      freshness_score: 0.8,
      supports: [],
      contradicts: ['4c1d2b1e-8b7f-4b1a-9c1e-1a2b3c4d5e02'],
    },
    {
      id: '4c1d2b1e-8b7f-4b1a-9c1e-1a2b3c4d5e02',
      claim: 'B社の法人向け値上げは平均 5% にとどまる',
      source_url: 'https://example.com/news/b',
      source_type: 'news',
      publisher: '日刊テック',
      title: 'B社、値上げは 5% にとどまる見通し',
      snippet: '関係者によると 5% 程度…',
      published_at: iso(-86_400_000 * 25),
      retrieved_at: iso(-3_600_000),
      provider: 'brave',
      quality_score: 0.6,
      freshness_score: 0.7,
      supports: [],
      contradicts: ['4c1d2b1e-8b7f-4b1a-9c1e-1a2b3c4d5e01'],
    },
  ],
} as unknown as EvidenceLedger;

export const transcript: readonly TranscriptLine[] = [
  {
    id: 'l1',
    speakerTag: 1,
    text: '初期費用が少し気になっています。',
    startMs: 14 * 60_000 + 18_000,
    endMs: 14 * 60_000 + 24_000,
    interim: false,
    translation: 'We are concerned about the upfront cost.',
  },
  {
    id: 'l2',
    speakerTag: 2,
    text: '分割については調整できます。',
    startMs: 14 * 60_000 + 37_000,
    endMs: 14 * 60_000 + 42_000,
    interim: false,
    translation: 'We can discuss installments.',
  },
  {
    id: 'l3',
    speakerTag: 1,
    text: '導入時期は 10 月を',
    startMs: 14 * 60_000 + 50_000,
    endMs: 14 * 60_000 + 52_000,
    interim: true,
    translation: null,
  },
];

export const speakerNames: ReadonlyMap<number, string> = new Map([
  [1, '田中'],
  [2, '伊藤'],
]);

export const meetingSegments: readonly MeetingSegment[] = [
  {
    id: 'seg-1',
    meeting_id: 'm1',
    pass: 'final',
    source: 'system',
    speaker_tag: 1,
    text: '初期費用が少し気になっています。',
    start_ms: 858_000,
    end_ms: 864_000,
    language: 'ja',
    confidence: 0.92,
    supersedes: [],
    created_at: iso(-3_000_000),
  },
  {
    id: 'seg-2',
    meeting_id: 'm1',
    pass: 'final',
    source: 'microphone',
    speaker_tag: 2,
    text: '分割については調整できます。',
    start_ms: 877_000,
    end_ms: 882_000,
    language: 'ja',
    confidence: 0.95,
    supersedes: [],
    created_at: iso(-3_000_000),
  },
  {
    id: 'seg-3',
    meeting_id: 'm1',
    pass: 'final',
    source: 'system',
    speaker_tag: 1,
    text: '導入は 10 月で考えています。',
    start_ms: 900_000,
    end_ms: 905_000,
    language: 'ja',
    confidence: 0.9,
    supersedes: [],
    created_at: iso(-3_000_000),
  },
] as unknown as readonly MeetingSegment[];

export const meetingBundle: MeetingBundle = {
  meeting_id: 'm1',
  title: 'A社 新規提案',
  duration_ms: 42 * 60_000 + 18_000,
  speaker_count: 3,
  summary: [
    {
      text: '先方は 10 月導入を希望。最大の懸念は初期費用。',
      citations: [
        { segment_id: 'seg-3', start_ms: 900_000 },
        { segment_id: 'seg-1', start_ms: 858_000 },
      ],
    },
  ],
  decisions: [
    { text: '導入時期を 10 月で検討', citations: [{ segment_id: 'seg-3', start_ms: 900_000 }] },
  ],
  action_items: [
    {
      text: '修正版見積を送付',
      citations: [{ segment_id: 'seg-2', start_ms: 877_000 }],
      owner: '伊藤',
      due: '明日',
    },
  ],
  open_questions: [],
} as unknown as MeetingBundle;

export const pack: PluginCatalogEntry = {
  id: 'com.astra.sales',
  name: 'Sales Pack',
  publisher: 'astra',
  verified: true,
  category: 'domain-agent',
  latest_version: '0.1.0',
  compliance_profile: 'standard',
  builtin: false,
  removable: true,
  permissions: ['email.read', 'email.send', 'calendar.read', 'crm.write'],
  data_accessed: ['メール（読み取り）', 'CRM の商談（読み書き）'],
  tool_count: 5,
  execution_surfaces: ['local', 'cloud'],
  signature_state: 'VERIFIED',
  installed: false,
  installed_version: null,
  updated_at: '2026-08-20T00:00:00.000Z',
  jobs: ['商談準備', '会議記録', 'Follow-up', 'CRM 更新', 'Pipeline 分析'],
  dashboards: ['pipeline'],
  connectors: ['google', 'salesforce'],
  pricing: null,
  changelog: null,
} as unknown as PluginCatalogEntry;

export const brief: DailyBrief = {
  attention: [
    {
      id: 'b1',
      severity: 'attention',
      title: '10:00 A社 商談',
      detail: '前回から価格条件が変更',
      action_label: '準備する',
      target: { kind: 'task', task_id: 't1' },
      score: 0.9,
    },
    {
      id: 'b2',
      severity: 'info',
      title: '半導体市場調査',
      detail: '調べ終わりました',
      action_label: '見る',
      target: { kind: 'artifact', artifact_id: 'art-1' },
      score: 0.6,
    },
    {
      id: 'b3',
      severity: 'action-required',
      title: '3件のメール送信',
      detail: 'あなたの確認待ち',
      action_label: '確認する',
      target: { kind: 'task', task_id: 't2' },
      score: 0.95,
    },
  ],
  more: [],
  generated_at: iso(0),
} as unknown as DailyBrief;

export const tasks: readonly TaskView[] = [
  {
    id: 't1',
    title: 'A社 商談準備',
    kind: 'research',
    status: 'COMPLETED',
    updated_at: iso(-3_600_000),
    created_at: iso(-7_200_000),
    started_at: iso(-7_000_000),
    completed_at: iso(-3_600_000),
    error: null,
    result_artifact_id: 'art-v5',
    dockState: 'result',
  },
  {
    id: 't2',
    title: 'A社 新規提案（会議）',
    kind: 'meeting',
    status: 'COMPLETED',
    updated_at: iso(-86_400_000),
    created_at: iso(-90_000_000),
    started_at: iso(-90_000_000),
    completed_at: iso(-86_400_000),
    error: null,
    result_artifact_id: 'art-meeting',
    dockState: 'result',
  },
] as unknown as readonly TaskView[];

const artifactBase = {
  tenant_id: 'tn',
  owner_id: 'u1',
  mime_type: 'application/pdf',
  source_agent_id: 'com.astra.research',
  source_meeting_id: null,
  object_key: 'k',
  size: 1200,
  sha256: 'a'.repeat(64),
  entities: [],
  lineage: [],
  searchable_text_ref: null,
  sensitivity: 'PRIVATE',
};
export const artifacts: readonly Artifact[] = [
  {
    ...artifactBase,
    id: 'art-v5',
    type: 'DOCUMENT',
    title: 'A社 提案書',
    version: 5,
    source_task_id: 't1',
    parent_artifact_id: 'art-v4',
    tags: ['project:A社', 'person:田中'],
    created_at: iso(-3_600_000),
    updated_at: iso(-3_600_000),
  },
  {
    ...artifactBase,
    id: 'art-v4',
    type: 'DOCUMENT',
    title: 'A社 提案書',
    version: 4,
    source_task_id: 't1',
    parent_artifact_id: 'art-meeting',
    tags: ['project:A社'],
    created_at: iso(-80_000_000),
    updated_at: iso(-80_000_000),
  },
  {
    ...artifactBase,
    id: 'art-meeting',
    type: 'MEETING_BUNDLE',
    title: 'A社 新規提案 議事録',
    version: 1,
    source_task_id: 't2',
    source_agent_id: 'com.astra.meeting',
    source_meeting_id: 'm1',
    parent_artifact_id: null,
    tags: ['project:A社', 'person:伊藤'],
    created_at: iso(-86_400_000),
    updated_at: iso(-86_400_000),
    sensitivity: 'CONFIDENTIAL',
  },
  {
    ...artifactBase,
    id: 'art-report',
    type: 'REPORT',
    title: '半導体市場調査',
    version: 1,
    source_task_id: null,
    parent_artifact_id: null,
    tags: [],
    created_at: iso(-86_400_000 * 12),
    updated_at: iso(-86_400_000 * 12),
  },
  {
    ...artifactBase,
    id: 'art-manual',
    type: 'IMAGE',
    title: '価格表（手動）',
    version: 1,
    source_task_id: null,
    source_agent_id: null,
    parent_artifact_id: null,
    tags: ['project:B社'],
    created_at: iso(-86_400_000 * 40),
    updated_at: iso(-86_400_000 * 40),
  },
] as unknown as readonly Artifact[];
