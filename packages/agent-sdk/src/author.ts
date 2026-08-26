/**
 * Agent Package を書くための道具。正本 §14。
 *
 * plugin の作者が manifest / workflow / policy / evaluation を
 * **手で JSON と YAML を書かずに**組み立てられるようにする。
 *
 * ここが解くのは 1 つだけ:
 *
 *   **宣言どうしの食い違いを、publish まで持っていかない。**
 *
 * 宣言していない tool を workflow が使う、規制 profile なのに規則が無い、
 * agent が知らない tool を持つ——これらは publish で落ちるが、
 * 落ちるのは書き終えたあとになる。ここで書きながら落とす。
 */
import {
  ACTION_RISKS,
  PluginManifest,
  PolicyDocument,
  WorkflowFile,
  EvalFile,
  type ActionRisk,
  type ComplianceProfile,
  type ExecutionSurface,
  type PermissionScope,
  type PolicyRule,
} from '@astra/contracts';

export interface ToolSpec {
  readonly id: string;
  readonly risk: ActionRisk;
  readonly surface?: ExecutionSurface;
  /** 低リスクでも確認を求める。作者の判断（正本 §9.2）。 */
  readonly requiresConfirmation?: boolean;
  /** 落ちたときに代わりに試す tool（正本 §24）。 */
  readonly fallbacks?: readonly string[];
}

export interface WorkflowStepSpec {
  readonly tool: string;
  /** 利用者に見せる言葉。**tool 名を書かない。** */
  readonly message: string;
  readonly when?:
    | { readonly when: 'always' }
    | { readonly when: 'input_present'; readonly key: string }
    | { readonly when: 'input_absent'; readonly key: string }
    | { readonly when: 'previous_produced'; readonly key: string };
}

export interface AgentSpec {
  readonly id: string;
  readonly skill: string;
  readonly tools: readonly string[];
}

export interface PackageDraft {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly minCoreVersion?: string;
  readonly category: string;
  readonly complianceProfile: ComplianceProfile;
  readonly executionSurfaces: readonly ExecutionSurface[];
  readonly permissions?: readonly PermissionScope[];
  /** 何に触るか。**人が読める文で書く**（正本 §2.4）。 */
  readonly dataAccessed: readonly string[];
  readonly tools?: readonly ToolSpec[];
  readonly agents?: readonly AgentSpec[];
  readonly workflows?: readonly {
    readonly id: string;
    readonly title: string;
    readonly agent: string;
    readonly steps: readonly WorkflowStepSpec[];
  }[];
  readonly rules?: readonly PolicyRule[];
}

export interface Problem {
  readonly where: string;
  readonly message: string;
}

/**
 * 書きながら食い違いを見つける。
 *
 * **publish と同じ判断をここでも行う。**片方だけ緩いと、
 * 手元で通ったものが publish で落ちることになる。
 */
export function review(draft: PackageDraft): Problem[] {
  const problems: Problem[] = [];
  const toolIds = new Set((draft.tools ?? []).map((t) => t.id));

  for (const tool of draft.tools ?? []) {
    const needsConfirmation = ['EXTERNAL_COMMIT', 'DESTRUCTIVE', 'REGULATED', 'FINANCIAL'];
    if (needsConfirmation.includes(tool.risk) && tool.requiresConfirmation !== true) {
      problems.push({
        where: `tools.${tool.id}`,
        message: `${tool.risk} の tool は確認を求める必要があります`,
      });
    }
    if (!draft.executionSurfaces.includes(tool.surface ?? 'cloud')) {
      problems.push({
        where: `tools.${tool.id}`,
        message: `"${tool.surface ?? 'cloud'}" は execution_surfaces に含まれていません`,
      });
    }
    for (const fallback of tool.fallbacks ?? []) {
      if (!toolIds.has(fallback)) {
        problems.push({
          where: `tools.${tool.id}.fallbacks`,
          message: `"${fallback}" は宣言されていません`,
        });
        continue;
      }
      const target = (draft.tools ?? []).find((t) => t.id === fallback)!;
      if (ACTION_RISKS.indexOf(target.risk) > ACTION_RISKS.indexOf(tool.risk)) {
        problems.push({
          where: `tools.${tool.id}.fallbacks`,
          message: `"${fallback}" は元より重いので、代わりになりません`,
        });
      }
    }
  }

  for (const agent of draft.agents ?? []) {
    for (const tool of agent.tools) {
      if (!toolIds.has(tool)) {
        problems.push({
          where: `agents.${agent.id}`,
          message: `"${tool}" は宣言されていません`,
        });
      }
    }
  }

  const agentIds = new Set((draft.agents ?? []).map((a) => a.id));
  for (const workflow of draft.workflows ?? []) {
    if (!agentIds.has(workflow.agent)) {
      problems.push({
        where: `workflows.${workflow.id}`,
        message: `agent "${workflow.agent}" は宣言されていません`,
      });
    }
    for (const step of workflow.steps) {
      if (!toolIds.has(step.tool)) {
        problems.push({
          where: `workflows.${workflow.id}`,
          message: `"${step.tool}" は宣言されていません`,
        });
      }
      if (step.message.includes(`${step.tool}`)) {
        // tool 名を利用者に見せない（正本 §7.2 / §9.3）
        problems.push({
          where: `workflows.${workflow.id}`,
          message: `見せる文に tool 名が入っています: "${step.message}"`,
        });
      }
    }
  }

  const strict: readonly ComplianceProfile[] = ['REGULATED_HEALTH', 'CARE', 'FINANCIAL'];
  if (strict.includes(draft.complianceProfile) && (draft.rules ?? []).length === 0) {
    problems.push({
      where: 'rules',
      message: `${draft.complianceProfile} は、自分が何をしないかを規則で書く必要があります`,
    });
  }

  return problems;
}

export interface BuiltPackage {
  readonly manifest: Record<string, unknown>;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * 下書きから、publish できる形を作る。
 *
 * **食い違いがあるなら作らない。**作ってから落ちるより、
 * 作る前に断るほうが直しやすい。
 */
export function build(draft: PackageDraft): BuiltPackage {
  const problems = review(draft);
  if (problems.length > 0) {
    throw new Error(
      `この package には食い違いがあります:\n${problems
        .map((p) => `  ${p.where}: ${p.message}`)
        .join('\n')}`,
    );
  }

  const files: Record<string, string> = {};
  const workflows = draft.workflows ?? [];
  const rules = draft.rules ?? [];

  if (workflows.length > 0) {
    files['workflows/main.json'] = `${JSON.stringify(
      WorkflowFile.parse({
        workflows: workflows.map((w) => ({
          id: w.id,
          title: w.title,
          agent: w.agent,
          steps: w.steps.map((s) => ({
            tool: s.tool,
            message: s.message,
            condition: s.when ?? { when: 'always' },
          })),
        })),
      }),
      null,
      2,
    )}\n`;
  }

  if (rules.length > 0) {
    files['policies/main.yaml'] = toYaml(
      PolicyDocument.parse({ id: `${draft.id.split('.').pop()}`, profiles: [], rules }),
    );
  }

  const manifest = {
    id: draft.id,
    name: draft.name,
    version: draft.version,
    publisher: draft.publisher,
    verified: false,
    min_core_version: draft.minCoreVersion ?? '0.1.0',
    category: draft.category,
    compliance_profile: draft.complianceProfile,
    execution_surfaces: [...draft.executionSurfaces],
    permissions: [...(draft.permissions ?? [])],
    data_accessed: [...draft.dataAccessed],
    tools: (draft.tools ?? []).map((t) => ({
      id: t.id,
      risk: t.risk,
      surface: t.surface ?? 'cloud',
      requires_confirmation: t.requiresConfirmation ?? false,
      fallbacks: [...(t.fallbacks ?? [])],
    })),
    agents: (draft.agents ?? []).map((a) => ({
      id: a.id,
      skill: a.skill,
      tools: [...a.tools],
    })),
    ...(workflows.length > 0 ? { workflows: ['workflows/main.json'] } : {}),
    ...(rules.length > 0 ? { policies: ['policies/main.yaml'] } : {}),
  };

  // 契約そのものに通す。ここで落ちるなら、publish でも落ちる。
  PluginManifest.parse(manifest);
  return { manifest, files };
}

/** 評価を組み立てる。**「合格した」とは書けない**（判定は harness）。 */
export function buildEvaluations(
  cases: readonly {
    id: string;
    description: string;
    workflow: string;
    input: Record<string, unknown>;
    expectSteps?: readonly string[];
    expectContains?: readonly string[];
    expectFails?: boolean;
  }[],
): string {
  return `${JSON.stringify(
    EvalFile.parse({
      cases: cases.map((c) => ({
        id: c.id,
        description: c.description,
        workflow: c.workflow,
        input: c.input,
        expect: {
          steps_ran: [...(c.expectSteps ?? [])],
          artifact_contains: [...(c.expectContains ?? [])],
          fails: c.expectFails ?? false,
        },
      })),
    }),
    null,
    2,
  )}\n`;
}

/**
 * policy を YAML に落とす。
 *
 * 必要なのは「この形だけ」なので、YAML ライブラリを持ち込まない。
 * 一般の YAML を書ける必要は無い。
 */
function toYaml(document: PolicyDocument): string {
  const lines = [`id: ${document.id}`, 'profiles: []', 'rules:'];
  for (const rule of document.rules) {
    lines.push(`  - id: ${rule.id}`);
    lines.push(`    description: ${rule.description}`);
    lines.push(`    when: ${JSON.stringify(rule.when)}`);
    lines.push(`    require: ${rule.require}`);
    lines.push(`    severity: ${rule.severity}`);
  }
  return `${lines.join('\n')}\n`;
}
