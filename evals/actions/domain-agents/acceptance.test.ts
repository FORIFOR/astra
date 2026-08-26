/**
 * 専業 Agent。正本 §15。
 *
 * §15 は 7 つの領域を挙げている。ここで見るのは 2 つ:
 *   - 7 つとも同梱されていること（**表から消して辻褄を合わせない**）
 *   - 「決めない」と書いてある領域が、実際に決めていないこと
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PolicyDocument, builtInPoliciesFor, type ComplianceProfile } from '@astra/contracts';
import { evaluate } from '@astra/policy';
import { containsRecommendation, orderProblems, orderReadback } from '@astra/service-agent-runtime';

const root = fileURLToPath(new URL('../../..', import.meta.url));

interface Manifest {
  id: string;
  compliance_profile: ComplianceProfile;
  tools: { id: string; risk: string; requires_confirmation?: boolean }[];
  policies?: string[];
}

async function manifests(): Promise<Manifest[]> {
  const dirs = await readdir(`${root}/plugins/builtin`, { withFileTypes: true });
  return Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map(
        async (d) =>
          parse(
            await readFile(`${root}/plugins/builtin/${d.name}/plugin.yaml`, 'utf8'),
          ) as Manifest,
      ),
  );
}

/** §15 の 7 領域に対応する plugin。 */
const DOMAIN_AGENTS = [
  { section: '§15.1 Image', id: null }, // service として実装（plugin ではない）
  { section: '§15.2 Video', id: 'com.astra.video' },
  { section: '§15.3 Sales CRM', id: 'com.astra.sales-crm' },
  { section: '§15.4 Care Support', id: 'com.astra.care' },
  { section: '§15.5 EHR', id: 'com.astra.ehr' },
  { section: '§15.6 Architecture', id: 'com.astra.architecture' },
  { section: '§15.7 Stock', id: 'com.astra.stock' },
] as const;

describe('every domain the spec names', () => {
  it('has something bundled for it', async () => {
    const ids = new Set((await manifests()).map((m) => m.id));
    for (const agent of DOMAIN_AGENTS) {
      if (agent.id === null) continue;
      expect(ids.has(agent.id), `${agent.section} is missing`).toBe(true);
    }
  });

  it('runs the regulated ones under a regulated profile', async () => {
    const byId = new Map((await manifests()).map((m) => [m.id, m]));
    // §15.4「REGULATED policy required」/ §15.5「高リスク領域」/ §15.7「FINANCIAL policy」
    expect(byId.get('com.astra.care')!.compliance_profile).toBe('CARE');
    expect(byId.get('com.astra.ehr')!.compliance_profile).toBe('REGULATED_HEALTH');
    expect(byId.get('com.astra.stock')!.compliance_profile).toBe('FINANCIAL');
  });

  it('gives every regulated one enforceable rules', async () => {
    for (const manifest of await manifests()) {
      if (!['CARE', 'REGULATED_HEALTH', 'FINANCIAL'].includes(manifest.compliance_profile))
        continue;
      // 規則の無い規制 plugin は publish で落ちる。ここでも見る。
      expect(manifest.policies?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('§15.7 the order readback', () => {
  const rules = async (): Promise<PolicyDocument> =>
    PolicyDocument.parse(
      parse(await readFile(`${root}/plugins/builtin/stock/policies/stock.yaml`, 'utf8')),
    );

  it('is required by the rules, not just by the code', async () => {
    const decision = evaluate({
      risk: 'REVERSIBLE_WRITE',
      surface: 'cloud',
      toolId: 'stock.draft_order',
      complianceProfile: 'FINANCIAL',
      policies: [await rules(), ...builtInPoliciesFor('FINANCIAL')],
    } as never);
    expect(decision.requiresReadback).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.requiresAudit).toBe(true);
  });

  it('says the amount, the price and the order type', () => {
    const spoken = orderReadback({
      symbol: '7203',
      side: 'BUY',
      quantity: 100,
      orderType: 'LIMIT',
      limitPrice: 2_500,
    });
    expect(spoken).toContain('100 株');
    expect(spoken).toContain('2500');
    expect(spoken).toContain('指値');
  });

  it('will not speak an order with a hole in it', () => {
    // 欠けたまま確認だけ取るのが、いちばん危ない形
    expect(
      orderProblems({
        symbol: '7203',
        side: 'BUY',
        quantity: null,
        orderType: 'MARKET',
        limitPrice: null,
      }),
    ).toContain('数量が入っていません');
  });

  it('does not ship a tool that places an order', async () => {
    const stock = (await manifests()).find((m) => m.id === 'com.astra.stock')!;
    // §15.7「default = research/draft order only」
    for (const tool of stock.tools) {
      expect(tool.risk).not.toBe('FINANCIAL');
      expect(tool.id).not.toMatch(/place|submit|execute/);
    }
  });
});

describe('what the analysts must not say', () => {
  it('catches a recommendation', () => {
    expect(containsRecommendation('いまが買い時')).toBe(true);
    expect(containsRecommendation('前期比 12% 増収。出典: 決算短信')).toBe(false);
  });
});
