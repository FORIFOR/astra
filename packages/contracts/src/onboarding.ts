/**
 * 初期セットアップ。正本 §3。
 *
 * 設計の要:
 *   - **選んでも機能制限はしない**（§3 Step 2）。初期 UX だけ変える
 *   - **一度に全 permission を要求しない**（§3 Step 5）。使う直前に頼む
 *   - 最後は動画ではなく **1 回の成功体験**（§3 Step 7）
 */
import { z } from 'zod';
import { TenantId, UserId } from './ids.js';
import { Timestamp } from './primitives.js';

/** §3 Step 2。**機能は変えない。**出だしの見せ方だけ変える。 */
export const InputPreference = z.enum(['voice', 'text', 'both']);
export type InputPreference = z.infer<typeof InputPreference>;

/** §3 Step 3「何を任せたい？」。複数選択。 */
export const INTEREST_AREAS = [
  'meeting',
  'research',
  'mail_calendar',
  'files',
  'sales',
  'development',
  'media',
  'care',
  'health',
  'architecture',
  'investment',
  'other',
] as const;
export const InterestArea = z.enum(INTEREST_AREAS);
export type InterestArea = z.infer<typeof InterestArea>;

/** §3 Step 5 の OS permission。**まとめて求めない。** */
export const OS_PERMISSIONS = [
  'microphone',
  'accessibility',
  'screen_recording',
  'notifications',
  'files',
  'calendar_contacts',
] as const;
export const OsPermission = z.enum(OS_PERMISSIONS);
export type OsPermission = z.infer<typeof OsPermission>;

/**
 * 許可の呼び名と、**何のために要るか**。UI/UX §22
 * 「permission request は利用直前に purpose-first で出す」。
 *
 * 初回設定と、使う直前の要求とで、文言を別々に持たない。
 * 別々にすると、片方だけ直って「設定で見た説明と違う」が起きる。
 */
export const PERMISSION_LABEL: Readonly<Record<OsPermission, string>> = {
  microphone: 'マイク',
  accessibility: 'アクセシビリティ',
  screen_recording: '画面収録',
  notifications: '通知',
  files: 'ファイル',
  calendar_contacts: 'カレンダー・連絡先',
};

/** 目的を先に言う。**「許可が必要です」だけで求めない。** */
export const PERMISSION_PURPOSE: Readonly<Record<OsPermission, string>> = {
  microphone: '会議を録音し、話者ごとに文字起こしするため',
  accessibility: '選択したテキストを読み取るため',
  screen_recording: 'システム音声を会議に取り込むため',
  notifications: '長い仕事が終わったときに知らせるため',
  files: '手元のファイルを整理・検索するため',
  calendar_contacts: '次の会議と参加者を把握するため',
};

/** 許さなかったときに、何ができなくなるか。**できなくなることを黙らない。** */
export const PERMISSION_WITHOUT: Readonly<Record<OsPermission, string>> = {
  microphone: '会議の記録はできません。',
  accessibility: '画面で選んだ文章は、貼り付けて渡してください。',
  screen_recording: '相手の声は入らず、こちらの声だけが記録されます。',
  notifications: '終わったかどうかは、自分で見に来る必要があります。',
  files: 'ファイルは、その都度選んで渡してください。',
  calendar_contacts: '予定と参加者は、自分で伝える必要があります。',
};

export function isOsPermission(value: unknown): value is OsPermission {
  return typeof value === 'string' && (OS_PERMISSIONS as readonly string[]).includes(value);
}

export const OnboardingStep = z.enum([
  'promise',
  'input_preference',
  'interests',
  'packs',
  'permissions',
  'shortcut',
  'first_task',
  'done',
]);
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export const OnboardingState = z.object({
  tenant_id: TenantId,
  user_id: UserId,
  step: OnboardingStep,
  input_preference: InputPreference.nullable(),
  interests: z.array(InterestArea),
  /** 推薦のうち、実際に入れたもの。 */
  installed_plugins: z.array(z.string()),
  /**
   * 実際に許可した OS permission。
   * **求めていないものは残らない**（求めた記録ではなく、許可の記録）。
   */
  granted_permissions: z.array(OsPermission),
  /** §3 Step 7 で実際に完了させた task。**やっていなければ null。** */
  first_task_id: z.string().nullable(),
  completed_at: Timestamp.nullable(),
  updated_at: Timestamp,
});
export type OnboardingState = z.infer<typeof OnboardingState>;

/** 推薦の 1 件。**なぜ薦めるかを必ず持つ。** */
export const PackRecommendation = z.object({
  plugin_id: z.string(),
  name: z.string(),
  /** これを選んだから薦めている、という説明。 */
  because: z.string().min(1),
  /** 入れると要求される権限。**入れる前に見せる。** */
  permissions: z.array(z.string()),
});
export type PackRecommendation = z.infer<typeof PackRecommendation>;

/**
 * 関心 → 薦める plugin。正本 §3 Step 4 の例をそのまま写す。
 *
 * **推薦は規則で決める。**「たぶん要る」で足すと、
 * なぜ薦められたか説明できなくなる。
 */
export const PACKS_FOR_INTEREST: Readonly<Record<InterestArea, readonly string[]>> = {
  meeting: ['com.astra.meeting', 'com.astra.google-calendar'],
  research: ['com.astra.research'],
  mail_calendar: ['com.astra.gmail', 'com.astra.google-calendar'],
  files: ['com.astra.finder'],
  sales: [
    'com.astra.gmail',
    'com.astra.google-calendar',
    'com.astra.sales-crm',
    'com.astra.meeting',
  ],
  development: ['com.astra.finder'],
  media: [],
  care: [],
  health: [],
  architecture: ['com.astra.finder'],
  investment: ['com.astra.research'],
  other: [],
};

/** 何を選んだから薦めているかを、そのまま言えるようにする。 */
export const INTEREST_LABELS: Readonly<Record<InterestArea, string>> = {
  meeting: '会議',
  research: '検索・調査',
  mail_calendar: 'メール・予定',
  files: 'ファイル整理',
  sales: '営業',
  development: '開発',
  media: '画像・動画',
  care: '介護',
  health: '医療',
  architecture: '建築',
  investment: '投資・市場調査',
  other: 'その他',
};

/**
 * 選んだ関心から推薦を作る。
 *
 * 同じ plugin が複数の関心から来ることがある。**まとめて 1 件にし、
 * 理由は全部並べる。**片方だけ見せると、外したときに残る理由が分からない。
 */
export function recommendationsFor(
  interests: readonly InterestArea[],
  catalog: readonly { id: string; name: string; permissions: readonly string[] }[],
): PackRecommendation[] {
  const reasons = new Map<string, string[]>();
  for (const interest of interests) {
    for (const pluginId of PACKS_FOR_INTEREST[interest]) {
      const list = reasons.get(pluginId) ?? [];
      list.push(INTEREST_LABELS[interest]);
      reasons.set(pluginId, list);
    }
  }

  return [...reasons.entries()]
    .map(([pluginId, why]) => {
      const entry = catalog.find((c) => c.id === pluginId);
      if (!entry) return null;
      return {
        plugin_id: pluginId,
        name: entry.name,
        because: `${why.join('・')}を選んだため`,
        permissions: [...entry.permissions],
      } satisfies PackRecommendation;
    })
    .filter((r): r is PackRecommendation => r !== null);
}

/**
 * その step で要る permission。
 *
 * **利用目的の直前に説明して求める**（§3 Step 5）。
 * まとめて求めると、何のために許すのか分からないまま許すことになる。
 */
export const PERMISSION_FOR_INTEREST: Readonly<Record<InterestArea, readonly OsPermission[]>> = {
  meeting: ['microphone', 'notifications'],
  research: [],
  mail_calendar: ['calendar_contacts', 'notifications'],
  files: ['files'],
  sales: ['calendar_contacts', 'notifications'],
  development: ['files'],
  media: ['files'],
  care: ['notifications'],
  health: ['notifications'],
  architecture: ['files'],
  investment: [],
  other: [],
};

export function permissionsFor(interests: readonly InterestArea[]): OsPermission[] {
  const needed = new Set<OsPermission>();
  for (const interest of interests) {
    for (const permission of PERMISSION_FOR_INTEREST[interest]) needed.add(permission);
  }
  return [...needed];
}

export const UpdateOnboardingRequest = z.object({
  step: OnboardingStep.optional(),
  input_preference: InputPreference.optional(),
  interests: z.array(InterestArea).optional(),
  installed_plugins: z.array(z.string()).optional(),
  granted_permissions: z.array(OsPermission).optional(),
  first_task_id: z.string().optional(),
});
export type UpdateOnboardingRequest = z.infer<typeof UpdateOnboardingRequest>;
