/**
 * UX Performance SLO。正本 §23。
 *
 * **数字を 1 箇所に置く。**各所に散らすと、どれが正で、
 * いま守れているのかが誰にも分からなくなる。
 *
 * ここにあるのは目標であって、達成の証明ではない。
 * **測れるものは測り、測れていないものは測れていないと言う**（`MEASURED` を見る）。
 */

export interface SloTarget {
  /** 何の時間か。 */
  readonly id: string;
  /** 目標値（ミリ秒）。 */
  readonly budgetMs: number;
  /** p95 か、上限か。 */
  readonly kind: 'p95' | 'max';
  readonly description: string;
}

export const SLO_TARGETS = {
  dockShow: {
    id: 'dock_show',
    budgetMs: 120,
    kind: 'p95',
    description: 'Task Dock が出るまで',
  },
  micCaptureStart: {
    id: 'mic_capture_start',
    budgetMs: 150,
    kind: 'p95',
    description: 'マイクが拾い始めるまで',
  },
  localSttFirstPartial: {
    id: 'local_stt_first_partial',
    budgetMs: 350,
    kind: 'p95',
    description: '手元の文字起こしが最初の途中経過を出すまで',
  },
  textFirstToken: {
    id: 'text_first_token',
    budgetMs: 800,
    kind: 'p95',
    description: '短い返事の最初の一文字まで',
  },
  simpleReadTool: {
    id: 'simple_read_tool',
    budgetMs: 2_000,
    kind: 'p95',
    description: '単純な参照 tool の結果まで',
  },
  researchAcknowledgement: {
    id: 'research_acknowledgement',
    budgetMs: 1_000,
    kind: 'max',
    description: '長い調査を受け付けたと伝えるまで',
  },
  firstResearchEvidence: {
    id: 'first_research_evidence',
    budgetMs: 4_000,
    kind: 'p95',
    description: '最初の根拠が出るまで',
  },
  meetingLiveTranscript: {
    id: 'meeting_live_transcript',
    budgetMs: 900,
    kind: 'p95',
    description: '会議の文字起こしが見えるまで（体感）',
  },
  translationAfterSegment: {
    id: 'translation_after_segment',
    budgetMs: 2_000,
    kind: 'p95',
    description: '確定した発言の訳が出るまで',
  },
  homeCachedLoad: {
    id: 'home_cached_load',
    budgetMs: 300,
    kind: 'max',
    description: 'Home が手元の内容で出るまで',
  },
} as const satisfies Record<string, SloTarget>;

export type SloName = keyof typeof SLO_TARGETS;

/**
 * いま実際に検査しているもの。
 *
 * **測っていないものを「守っている」と言わない。**
 * ここに無いものは、目標はあるが確かめていない。
 */
export const MEASURED: readonly SloName[] = [
  // Phase 0 の受け入れ（AC-6）が、進捗の間隔をこの予算で見ている
  'simpleReadTool',
  // evals/actions/slo が、実プロセスを通して受付までの時間を見ている
  'researchAcknowledgement',
];

/**
 * なぜ測っていないか。**「まだ」と書くだけにしない。**
 *
 * 測れない理由は 2 種類しかない:
 *   - 代役を挟むと数字の意味が変わる（実モデル・実音声・実描画が要る）
 *   - 測る場所がまだ無い
 * どちらなのかを書いておかないと、「そのうち測る」が永久に続く。
 *
 * MEASURED と合わせて `SloName` を過不足なく覆う（slo.test.ts で機械的に見る）。
 */
export const WHY_NOT_MEASURED: Readonly<Partial<Record<SloName, string>>> = {
  dockShow:
    'window が出て入力できるまでの実測が要る。jsdom は実際の描画より速いので、' +
    'ここで通しても守れている証拠にならない。',
  micCaptureStart: '実際の入力装置が要る。代役では OS の取り込み時間が入らない。',
  localSttFirstPartial:
    '実測した結果、**届かなかった**。ReazonSpeech は offline（非ストリーミング）で、' +
    '窓が埋まるまで 1 文字も出ない。窓 1500ms で最初の途中経過まで 1543ms、' +
    '700ms まで縮めても音の待ちだけで予算の 2 倍になり、しかも文が崩れる。' +
    '届かせるには streaming の日本語モデルが要る（docs/deepnote-audio-stt-migration.md §4）。',
  textFirstToken: '実際の言語モデルが要る。決定的な代役では最初の 1 文字が即座に出る。',
  firstResearchEvidence:
    '検索の外部提供者が要る。代役の corpus では往復が入らず、' + '自前の処理時間しか測れない。',
  meetingLiveTranscript: '実音声と認識モデルが要る。台本の代役では体感時間にならない。',
  translationAfterSegment: '実際の翻訳提供者が要る。',
  homeCachedLoad:
    'これは「手元の内容が画面に出るまで」なので、実際の描画が要る。' +
    'サーバの応答時間だけを測って守れているとは言えない。',
};

/** 2 秒を超える処理には進捗を出す（正本 §4.3・§23）。 */
export const PROGRESS_REQUIRED_AFTER_MS = 2_000;

export interface SloObservation {
  readonly name: SloName;
  readonly elapsedMs: number;
}

/** 予算内か。**超えたことを黙らせないために、判定を関数にしてある。** */
export function withinBudget(observation: SloObservation): boolean {
  return observation.elapsedMs <= SLO_TARGETS[observation.name].budgetMs;
}

/** p95 を出す。標本が無ければ null（0 と言わない）。 */
export function p95(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  // 小さい標本で端に寄り過ぎないよう、素直に位置で取る
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, index)]!;
}
