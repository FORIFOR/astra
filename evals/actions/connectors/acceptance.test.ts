/**
 * Connector の受け入れ。正本 §2.4・§9・§21、UI/UX §22。
 *
 * ここで見るのは 1 点に尽きる:
 * **manifest が言っていることと、実装が守っていることが同じか。**
 *
 * 宣言と実装がずれる壊れ方は、試験を書かないと表に出ない。
 * 「送信には確認が要る」と manifest に書いてあっても、
 * 実装が確認を見ていなければ、書いてあること自体が嘘になる。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { EXTERNAL_SEND_SCOPES, PERMISSION_SCOPES, riskRank } from '@astra/contracts';
import {
  CALENDAR_OPERATIONS,
  GMAIL_OPERATIONS,
  googleScopesFor,
  permissionsFromGoogleScopes,
  type OperationDecl,
} from '@astra/service-connectors';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface Manifest {
  permissions: string[];
  connectors: { scopes: string[] }[];
  tools: { id: string; risk: string; requires_confirmation?: boolean }[];
}

async function manifest(name: string): Promise<Manifest> {
  return parse(await readFile(path.join(root, 'plugins/builtin', name, 'plugin.yaml'), 'utf8'));
}

/** manifest の tool と、実装の操作の対応。名前は別物なので、ここで結ぶ。 */
const GMAIL_TOOLS: Record<string, OperationDecl> = {
  'mail.search': GMAIL_OPERATIONS.list,
  'mail.read': GMAIL_OPERATIONS.get,
  'mail.draft.create': GMAIL_OPERATIONS.draft,
  'mail.send': GMAIL_OPERATIONS.send,
  'mail.trash': GMAIL_OPERATIONS.trash,
};

const CALENDAR_TOOLS: Record<string, OperationDecl> = {
  'calendar.list_events': CALENDAR_OPERATIONS.list,
  'calendar.get_event': CALENDAR_OPERATIONS.get,
  'calendar.create_event': CALENDAR_OPERATIONS.create,
};

describe('the connector manifests match what is implemented', () => {
  for (const [name, tools] of [
    ['gmail', GMAIL_TOOLS],
    ['calendar', CALENDAR_TOOLS],
  ] as const) {
    it(`${name}: declares no tool that does not exist`, async () => {
      const declared = (await manifest(name)).tools.map((t) => t.id).sort();
      expect(declared).toEqual(Object.keys(tools).sort());
    });

    it(`${name}: agrees with the implementation about risk`, async () => {
      for (const tool of (await manifest(name)).tools) {
        expect(tool.risk, `${tool.id}`).toBe(tools[tool.id]!.risk);
      }
    });

    it(`${name}: requires confirmation exactly where the implementation demands approval`, async () => {
      for (const tool of (await manifest(name)).tools) {
        expect(tool.requires_confirmation === true, `${tool.id}`).toBe(
          tools[tool.id]!.requiresApproval,
        );
      }
    });

    it(`${name}: asks for no permission that no tool uses`, async () => {
      const declared = new Set((await manifest(name)).permissions);
      const used = new Set(Object.values(tools).map((op) => op.scope));
      // 使われない許可は、いずれ「あるから使う」になる
      expect([...declared].filter((p) => !used.has(p))).toEqual([]);
      expect([...used].filter((p) => !declared.has(p))).toEqual([]);
    });

    it(`${name}: names only real permission scopes`, async () => {
      for (const permission of (await manifest(name)).permissions) {
        expect(PERMISSION_SCOPES as readonly string[]).toContain(permission);
      }
    });

    it(`${name}: asks the provider for exactly the scopes its permissions need`, async () => {
      const declared = (await manifest(name)).permissions as never;
      const asked = (await manifest(name)).connectors.flatMap((c) => c.scopes).sort();
      expect(asked).toEqual(googleScopesFor(declared));
    });

    it(`${name}: would read back the permissions it asked for`, async () => {
      // 要求 → 同意 → 記録 が閉じているか。ここが開いていると、
      // 許したはずの操作が動かない、あるいはその逆になる。
      const declared = (await manifest(name)).permissions as never;
      const granted = googleScopesFor(declared).join(' ');
      expect(permissionsFromGoogleScopes(granted).sort()).toEqual([...declared].sort());
    });
  }

  it('marks everything that leaves the tenant as needing a person', async () => {
    for (const name of ['gmail', 'calendar'] as const) {
      const m = await manifest(name);
      const leaves = m.permissions.filter((p) =>
        (EXTERNAL_SEND_SCOPES as readonly string[]).includes(p),
      );
      if (leaves.length === 0) continue;
      const externals = m.tools.filter(
        (t) => riskRank(t.risk as never) >= riskRank('EXTERNAL_COMMIT'),
      );
      expect(
        externals.length,
        `${name} holds ${leaves.join(', ')} but commits nothing`,
      ).toBeGreaterThan(0);
      for (const tool of externals) {
        expect(tool.requires_confirmation, `${tool.id}`).toBe(true);
      }
    }
  });

  it('never lets the draft permission reach a destructive operation', () => {
    // 下書きを許した人は、受信箱を動かしてよいとは言っていない
    expect(GMAIL_OPERATIONS.trash.scope).not.toBe(GMAIL_OPERATIONS.draft.scope);
    expect(GMAIL_OPERATIONS.send.scope).not.toBe(GMAIL_OPERATIONS.draft.scope);
  });

  it('does not ask the consent screen for the same thing twice', async () => {
    // gmail.modify は readonly と compose を含む。3 つ並べると同意画面が読めなくなる。
    const asked = (await manifest('gmail')).connectors.flatMap((c) => c.scopes);
    expect(asked).not.toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(asked).toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(asked).toContain('https://www.googleapis.com/auth/gmail.send');
  });
});
