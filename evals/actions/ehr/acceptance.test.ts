/**
 * EHR Assist。正本 §15.5。
 *
 * §15.5 が言う 3 つを、宣言ではなく**動きで**確かめる:
 *   - Write-back は明示承認 + audit
 *   - 診断 / 治療を自律決定しない
 *   - 初期版は read / assist / draft 中心
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PolicyDocument, builtInPoliciesFor } from '@astra/contracts';
import { evaluate } from '@astra/policy';
import { checkDraft, citedLines, extract, extractionTable } from '@astra/service-agent-runtime';

const root = fileURLToPath(new URL('../../..', import.meta.url));

const manifest = async (): Promise<Record<string, unknown>> =>
  parse(await readFile(`${root}/plugins/builtin/ehr/plugin.yaml`, 'utf8')) as Record<
    string,
    unknown
  >;

const rules = async (): Promise<PolicyDocument> =>
  PolicyDocument.parse(
    parse(await readFile(`${root}/plugins/builtin/ehr/policies/ehr.yaml`, 'utf8')),
  );

const note = (id: string, body: string) => ({
  id,
  title: '記録',
  body,
  author: null,
  encounterId: 'e1',
  signed: true,
});

describe('read / assist / draft only', () => {
  it('ships exactly one tool that writes', async () => {
    const tools = (await manifest())['tools'] as {
      id: string;
      risk: string;
      requires_confirmation?: boolean;
    }[];
    const writing = tools.filter((t) => t.risk !== 'READ');
    // 増やすときは、増やす理由を先に決める
    expect(writing).toHaveLength(1);
    expect(writing[0]!.id).toBe('ehr.draft_note');
    expect(writing[0]!.requires_confirmation).toBe(true);
  });

  it('runs under the health profile', async () => {
    expect((await manifest())['compliance_profile']).toBe('REGULATED_HEALTH');
  });
});

describe('write-back', () => {
  const context = (over: Record<string, unknown> = {}) => ({
    risk: 'REVERSIBLE_WRITE' as const,
    surface: 'cloud' as const,
    toolId: 'ehr.draft_note',
    complianceProfile: 'REGULATED_HEALTH' as const,
    ...over,
  });

  it('needs an explicit approval, a readback and an audit', async () => {
    const decision = evaluate({
      ...context(),
      policies: [await rules(), ...builtInPoliciesFor('REGULATED_HEALTH')],
    } as never);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.requiresReadback).toBe(true);
    expect(decision.requiresAudit).toBe(true);
    expect(decision.requiresReceipt).toBe(true);
  });

  it('audits a plain read as well', async () => {
    const decision = evaluate({
      ...context({ risk: 'READ', toolId: 'ehr.search' }),
      policies: [await rules(), ...builtInPoliciesFor('REGULATED_HEALTH')],
    } as never);
    expect(decision.requiresAudit).toBe(true);
  });

  it('refuses to destroy or to send outside at all', async () => {
    const policies = [await rules(), ...builtInPoliciesFor('REGULATED_HEALTH')];
    // 確認すれば通る、ではない
    expect(evaluate({ ...context({ risk: 'DESTRUCTIVE' }), policies } as never).denied).toBe(true);
    expect(evaluate({ ...context({ risk: 'EXTERNAL_COMMIT' }), policies } as never).denied).toBe(
      true,
    );
  });
});

describe('not deciding for the clinician', () => {
  const cited = citedLines([note('n1', '高血圧症と診断されている')]);

  it('stops a draft that makes the call itself', () => {
    expect(checkDraft('本日から降圧薬を投与する', cited).ok).toBe(false);
  });

  it('lets the record be quoted', () => {
    expect(checkDraft('高血圧症と診断されている', cited).ok).toBe(true);
  });
});

describe('what is not written down', () => {
  it('is reported as missing, never as normal', () => {
    const table = extractionTable(extract([note('n1', '体温 36.5')]));
    expect(table).toContain('記載なし');
    // 書かれていないことと、正常だったことは違う
    expect(table).not.toContain('異常なし');
    expect(table).not.toContain('正常');
  });
});
