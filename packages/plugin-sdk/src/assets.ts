/**
 * manifest が宣言したファイルの読み込みと検証。Phase 4 実装仕様 §1.1（D-31）。
 *
 * **宣言と実体を一致させる。**`dashboards/pipeline.json` と書いてあるのに
 * その中身が無い plugin を catalog に載せると、install しても何も増えない。
 * publish の時点で落とす。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  AstraError,
  DashboardSchema,
  EvalFile,
  PolicyDocument,
  WorkflowFile,
  sha256Hex,
  type PluginManifest,
} from '@astra/contracts';

export type AssetKind =
  'skill' | 'dashboard' | 'policy' | 'data_extension' | 'workflow' | 'evaluation';

export interface PluginAsset {
  readonly path: string;
  readonly kind: AssetKind;
  readonly content: Uint8Array;
  readonly sha256: string;
}

/** 1 つのファイルの上限。plugin に巨大な塊を持ち込ませない。 */
export const MAX_ASSET_BYTES = 512 * 1024;

/** manifest が宣言しているファイルを、種別付きで列挙する。 */
export function declaredAssets(manifest: PluginManifest): { path: string; kind: AssetKind }[] {
  return [
    ...manifest.agents.map((a) => ({ path: a.skill, kind: 'skill' as const })),
    ...manifest.dashboards.map((d) => ({ path: d.schema, kind: 'dashboard' as const })),
    ...manifest.policies.map((p) => ({ path: p, kind: 'policy' as const })),
    ...manifest.data_extensions.map((p) => ({ path: p, kind: 'data_extension' as const })),
    ...manifest.workflows.map((p) => ({ path: p, kind: 'workflow' as const })),
    ...manifest.evaluations.map((p) => ({ path: p, kind: 'evaluation' as const })),
  ];
}

/**
 * 宣言されたファイルを全部読む。**1 つでも欠けたら失敗させる。**
 *
 * `root` の外へ出るパスは拒否する。plugin の宣言でファイルシステムを
 * 歩かせない。
 */
export async function loadAssets(manifest: PluginManifest, root: string): Promise<PluginAsset[]> {
  const declared = declaredAssets(manifest);
  const assets: PluginAsset[] = [];
  const resolvedRoot = path.resolve(root);

  for (const entry of declared) {
    const full = path.resolve(resolvedRoot, entry.path);
    // `..` で外へ出させない。plugin の宣言は信用しない。
    if (full !== resolvedRoot && !full.startsWith(resolvedRoot + path.sep)) {
      throw new AstraError(
        'plugin.manifest_invalid',
        `asset "${entry.path}" escapes the plugin directory`,
      );
    }

    let content: Buffer;
    try {
      content = await readFile(full);
    } catch {
      throw new AstraError(
        'plugin.manifest_invalid',
        `${manifest.id} declares "${entry.path}" but the file is not there`,
      );
    }
    if (content.byteLength > MAX_ASSET_BYTES) {
      throw new AstraError(
        'plugin.manifest_invalid',
        `asset "${entry.path}" is larger than ${MAX_ASSET_BYTES} bytes`,
      );
    }

    assets.push({
      path: entry.path,
      kind: entry.kind,
      content,
      sha256: await sha256Hex(content),
    });
  }

  validateDashboards(manifest, assets);
  validateWorkflows(manifest, assets);
  validatePolicies(assets);
  return assets;
}

/**
 * policy の中身まで検証する。
 *
 * **散文では機械検査できない。**host が実装した語彙で書けているかを
 * ここで確かめる。書けていない policy は、あっても効かない。
 */
export function validatePolicies(assets: readonly PluginAsset[]): void {
  for (const asset of assets.filter((a) => a.kind === 'policy')) {
    let document: unknown;
    try {
      document = parseYaml(Buffer.from(asset.content).toString('utf8'));
    } catch {
      throw new AstraError('plugin.manifest_invalid', `policy "${asset.path}" is not YAML`);
    }

    const parsed = PolicyDocument.safeParse(document);
    if (!parsed.success) {
      throw new AstraError(
        'plugin.manifest_invalid',
        `policy "${asset.path}" does not use the vocabulary the host can check`,
        {
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      );
    }
  }
}

/**
 * workflow と evaluation の中身まで検証する。
 *
 * **宣言に無い tool を使う workflow を publish させない。**
 * install 後に「そんな tool は無い」で落ちるより、ここで止めるほうがよい。
 */
export function validateWorkflows(manifest: PluginManifest, assets: readonly PluginAsset[]): void {
  const declaredTools = new Set(manifest.tools.map((t) => t.id));
  const declaredAgents = new Set(manifest.agents.map((a) => a.id));
  const workflowIds = new Set<string>();

  for (const asset of assets.filter((a) => a.kind === 'workflow')) {
    const parsed = WorkflowFile.safeParse(parseJson(asset));
    if (!parsed.success) {
      throw new AstraError(
        'plugin.manifest_invalid',
        `workflow "${asset.path}" is not a valid workflow file`,
        {
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      );
    }

    for (const workflow of parsed.data.workflows) {
      if (workflowIds.has(workflow.id)) {
        throw new AstraError('plugin.manifest_invalid', `duplicate workflow id "${workflow.id}"`);
      }
      workflowIds.add(workflow.id);

      if (!declaredAgents.has(workflow.agent)) {
        throw new AstraError(
          'plugin.manifest_invalid',
          `workflow "${workflow.id}" belongs to agent "${workflow.agent}", which is not declared`,
        );
      }
      for (const step of workflow.steps) {
        if (!declaredTools.has(step.tool)) {
          throw new AstraError(
            'plugin.manifest_invalid',
            `workflow "${workflow.id}" uses tool "${step.tool}", which is not declared`,
          );
        }
      }
    }
  }

  for (const asset of assets.filter((a) => a.kind === 'evaluation')) {
    const parsed = EvalFile.safeParse(parseJson(asset));
    if (!parsed.success) {
      throw new AstraError(
        'plugin.manifest_invalid',
        `evaluation "${asset.path}" is not a valid evaluation file`,
      );
    }
    for (const testCase of parsed.data.cases) {
      // 存在しない workflow を試す評価は、何も確かめていない
      if (!workflowIds.has(testCase.workflow)) {
        throw new AstraError(
          'plugin.manifest_invalid',
          `evaluation "${testCase.id}" targets workflow "${testCase.workflow}", which does not exist`,
        );
      }
    }
  }
}

function parseJson(asset: PluginAsset): unknown {
  try {
    return JSON.parse(Buffer.from(asset.content).toString('utf8'));
  } catch {
    throw new AstraError('plugin.manifest_invalid', `${asset.path} is not JSON`);
  }
}

/**
 * dashboard の中身まで検証する。
 *
 * ファイルがあるだけでは足りない。**壊れた schema や、宣言していない
 * data source を指す bind は、install 後に必ず穴になる。**publish で止める。
 */
export function validateDashboards(manifest: PluginManifest, assets: readonly PluginAsset[]): void {
  const declaredSources = new Set(manifest.data_sources.map((s) => s.id));

  for (const decl of manifest.dashboards) {
    const asset = assets.find((a) => a.path === decl.schema && a.kind === 'dashboard');
    if (!asset) continue; // loadAssets が既に落としている

    let document: unknown;
    try {
      document = JSON.parse(Buffer.from(asset.content).toString('utf8'));
    } catch {
      throw new AstraError('plugin.manifest_invalid', `dashboard "${decl.schema}" is not JSON`);
    }

    const parsed = DashboardSchema.safeParse(document);
    if (!parsed.success) {
      throw new AstraError(
        'plugin.manifest_invalid',
        `dashboard "${decl.schema}" is not a valid dashboard`,
        {
          details: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
      );
    }

    // manifest の宣言と中身の id がずれていると、どちらで引くのか決まらない
    if (parsed.data.id !== decl.id) {
      throw new AstraError(
        'plugin.manifest_invalid',
        `dashboard "${decl.schema}" says id "${parsed.data.id}" but the manifest declares "${decl.id}"`,
      );
    }

    for (const item of parsed.data.items) {
      if (item.bind === undefined) continue;
      if (!declaredSources.has(item.bind)) {
        throw new AstraError(
          'plugin.manifest_invalid',
          `dashboard "${decl.id}" binds to "${item.bind}", which the manifest does not declare`,
        );
      }
    }
  }
}
