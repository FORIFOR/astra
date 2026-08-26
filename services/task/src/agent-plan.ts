/**
 * install した plugin の agent を、実行できる計画に落とす。
 * Phase 5 実装仕様 §2（AC5-1 / AC5-2）。
 *
 * `plan.ts` は**純粋関数だけ**（workflow のサンドボックスに入る）なので、
 * DB を要るこちらは別ファイルにしてある。計画は task を作る時点で確定させ、
 * workflow へ持ち込む（D-40）。
 */
import type { StepComplianceProfile, TaskPlan, TaskStep } from './plan.js';

/** `plugin:<pluginId>:<agentId>` の形。ここ以外で組み立てない。 */
export const AGENT_KIND_PREFIX = 'plugin:';

export function agentKindFor(pluginId: string, agentId: string): string {
  return `${AGENT_KIND_PREFIX}${pluginId}:${agentId}`;
}

export function parseAgentKind(kind: string): { pluginId: string; agentId: string } | null {
  if (!kind.startsWith(AGENT_KIND_PREFIX)) return null;
  const rest = kind.slice(AGENT_KIND_PREFIX.length);
  // plugin id は `com.acme.thing` のようにドットを含むので、**最後の `:` で割る**
  const at = rest.lastIndexOf(':');
  if (at <= 0 || at === rest.length - 1) return null;
  return { pluginId: rest.slice(0, at), agentId: rest.slice(at + 1) };
}

/** 計画を組み立てるのに要る、plugin 側の事実。 */
export interface InstalledAgent {
  readonly pluginId: string;
  readonly agentId: string;
  readonly agentName: string;
  /** その agent が使ってよい tool。**宣言に無いものは載せない**（D-42）。 */
  readonly tools: readonly {
    readonly id: string;
    readonly risk: TaskStep['risk'];
    readonly surface: 'local' | 'cloud';
    readonly requiresConfirmation: boolean;
  }[];
  /** その plugin の規制区分。**運ばないと規制の意味が無くなる**（正本 §22）。 */
  readonly complianceProfile: StepComplianceProfile;
  /**
   * 宣言された仕事の流れ（正本 §14）。
   *
   * 無ければ「宣言された tool を宣言順に」という近似に落ちる。
   * **近似であることを、無いことと区別できるようにしてある。**
   */
  readonly workflow?: {
    readonly steps: readonly {
      readonly tool: string;
      readonly message: string;
      readonly risk?: TaskStep['risk'];
      readonly applies: boolean;
    }[];
  };
  /** 実体ファイルから読んだ skill。無ければ null。 */
  readonly skill: string | null;
  /** 同意済みの scope。 */
  readonly grantedScopes: readonly string[];
  /** manifest が要求する scope。 */
  readonly requiredScopes: readonly string[];
  /** 持ち込まれた規則（正本 §22）。step へそのまま載せる。 */
  readonly policies?: readonly unknown[];
}

export class AgentNotRunnableError extends Error {
  readonly reason: 'not_installed' | 'no_such_agent' | 'missing_scopes';
  readonly missing: readonly string[];

  constructor(
    reason: 'not_installed' | 'no_such_agent' | 'missing_scopes',
    message: string,
    missing: readonly string[] = [],
  ) {
    super(message);
    this.name = 'AgentNotRunnableError';
    this.reason = reason;
    this.missing = missing;
  }
}

/**
 * agent の計画を組み立てる。
 *
 * step は宣言された tool の順。**中身は tool 側が知っている**ので、
 * ここは「何をどの順で」だけを決める（research / meeting と同じ）。
 */
export function planInstalledAgent(
  agent: InstalledAgent,
  input: Record<string, unknown>,
): TaskPlan {
  // 同意していない scope が要る agent は、走らせる前に止める（AC5-3）。
  // 走らせてから step ごとに落とすと、途中まで実行した副作用が残る。
  const missing = agent.requiredScopes.filter((s) => !agent.grantedScopes.includes(s));
  if (missing.length > 0) {
    throw new AgentNotRunnableError(
      'missing_scopes',
      `${agent.pluginId} needs permission it was not granted: ${missing.join(', ')}`,
      missing,
    );
  }

  const request =
    typeof input['message'] === 'string'
      ? input['message'].trim()
      : typeof input['question'] === 'string'
        ? input['question'].trim()
        : '';

  const byId = new Map(agent.tools.map((t) => [t.id, t]));
  const args = { request, ...(agent.skill === null ? {} : { skill: agent.skill }) };

  /*
   * workflow があればそれに従う。無ければ「宣言された tool を宣言順に」。
   * 後者は近似なので、workflow を書いた plugin では使わない。
   */
  type PlannedStep = {
    readonly tool: InstalledAgent['tools'][number];
    readonly message: string;
    readonly risk?: TaskStep['risk'] | undefined;
  };

  const source: PlannedStep[] = agent.workflow
    ? agent.workflow.steps
        // 条件に合わない step は載せない。載せてから飛ばすと、進捗が嘘になる。
        .filter((s) => s.applies)
        .flatMap((s) => {
          const tool = byId.get(s.tool);
          // 宣言に無い tool は使わせない（D-42）
          return tool ? [{ tool, message: s.message, risk: s.risk }] : [];
        })
    : agent.tools.map((tool) => ({
        tool,
        message: `${agent.agentName} が作業しています`,
      }));

  const steps: TaskStep[] = source.map((entry, index) => ({
    index,
    toolId: entry.tool.id,
    // workflow は risk を**上げられるが下げられない**。軽く見せない。
    risk: entry.risk && riskAbove(entry.risk, entry.tool.risk) ? entry.risk : entry.tool.risk,
    surface: entry.tool.surface,
    // tool 名を利用者に見せない（正本 §7.2 / §9.3）。何をしているかを言う。
    message: entry.message,
    args,
    // 作者が確認を求めた tool は、低リスクでも確認する（正本 §9.2）
    requiresConfirmation: entry.tool.requiresConfirmation,
    complianceProfile: agent.complianceProfile,
    ...(agent.policies && agent.policies.length > 0 ? { policies: agent.policies } : {}),
  }));

  return {
    steps,
    artifact: {
      type: 'DOCUMENT',
      title: request || agent.agentName,
      mimeType: 'text/markdown',
    },
  };
}

/** risk の重さ。`plan.ts` は contracts を import できないので、ここに並べる。 */
const RISK_ORDER: readonly TaskStep['risk'][] = [
  'READ',
  'REVERSIBLE_WRITE',
  'EXTERNAL_COMMIT',
  'DESTRUCTIVE',
  'REGULATED',
  'FINANCIAL',
];

/** workflow の指定が、tool の宣言より重いか。**軽い指定は無視する。** */
function riskAbove(a: TaskStep['risk'], b: TaskStep['risk']): boolean {
  return RISK_ORDER.indexOf(a) > RISK_ORDER.indexOf(b);
}
