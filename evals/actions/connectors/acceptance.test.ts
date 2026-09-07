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
import { CONNECTORS, TOOL_CONNECTOR } from '@astra/worker-agent-host';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface Manifest {
  permissions: string[];
  connectors: { id: string; scopes: string[]; grants: string[]; purpose?: string | null }[];
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

    it(`${name}: each connection asks the provider for exactly the scopes its grants need`, async () => {
      // 同意は接続（capability）ごと。接続が要求する scope は、その接続が与える許可の分だけ。
      for (const c of (await manifest(name)).connectors) {
        expect(c.scopes.slice().sort(), c.id).toEqual(googleScopesFor(c.grants as never));
      }
    });

    it(`${name}: the connections together cover the permissions, each once`, async () => {
      const m = await manifest(name);
      const all = m.connectors.flatMap((c) => c.grants).sort();
      expect(all).toEqual([...m.permissions].sort());
    });

    it(`${name}: would read back the permissions each connection asked for`, async () => {
      // 要求 → 同意 → 記録 が閉じているか。ここが開いていると、
      // 許したはずの操作が動かない、あるいはその逆になる。
      const m = await manifest(name);
      for (const c of m.connectors) {
        const granted = googleScopesFor(c.grants as never).join(' ');
        const readBack = permissionsFromGoogleScopes(granted);
        // 与えると言った許可は全部読み戻せる。Google の広い scope（modify ⊇ readonly）が
        // 余分に含む分は plugin の許可の中に収まる（宣言に無い許可は生まれない）。
        for (const g of c.grants) expect(readBack, c.id).toContain(g);
        for (const p of readBack) expect(m.permissions, `${c.id} reads back ${p}`).toContain(p);
      }
    });
  }

  /**
   * GOOGLE_READ_ONLY_FIRST。
   *
   * 「Work Context は読むだけ」という画面の説明と、OAuth の事実を一致させる。
   * 読む接続に書く scope が 1 つも無く、書く接続は理由（purpose）を持ち、
   * 書く tool は書く接続に、読む tool は読む接続に結ばれている。
   */
  describe('read-only first (GOOGLE_READ_ONLY_FIRST)', () => {
    const WRITE_SCOPE = /(modify|send|compose|calendar\.events|calendar$|mail\.google\.com)/;

    for (const [name, readId, actionsId] of [
      ['gmail', 'gmail', 'gmail-actions'],
      ['calendar', 'google-calendar', 'google-calendar-actions'],
    ] as const) {
      it(`${name}: the read connection holds no write scope`, async () => {
        const read = (await manifest(name)).connectors.find((c) => c.id === readId)!;
        expect(read.scopes.filter((s) => WRITE_SCOPE.test(s))).toEqual([]);
        expect(read.grants.every((g) => g.endsWith('.read'))).toBe(true);
      });

      it(`${name}: every write permission lives in the actions connection, with a purpose`, async () => {
        const m = await manifest(name);
        const actions = m.connectors.find((c) => c.id === actionsId)!;
        const writes = m.permissions.filter((p) => !p.endsWith('.read'));
        expect(actions.grants.slice().sort()).toEqual(writes.sort());
        expect((actions.purpose ?? '').length).toBeGreaterThan(0);
      });
    }

    it('binds read tools to read connections and write tools to actions connections', () => {
      for (const [toolId, key] of Object.entries(TOOL_CONNECTOR)) {
        const risk = { ...GMAIL_TOOLS, ...CALENDAR_TOOLS }[toolId]?.risk;
        if (!risk) continue; // Microsoft 側は読む tool しか無い
        if (risk === 'READ') expect(key, toolId).not.toMatch(/-actions$/);
        else expect(key, toolId).toMatch(/-actions$/);
      }
    });

    it('the device worker names the same connections the manifests declare', async () => {
      for (const name of ['gmail', 'calendar', 'outlook', 'microsoft-todo'] as const) {
        for (const c of (await manifest(name)).connectors) {
          const entry = CONNECTORS[c.id as keyof typeof CONNECTORS];
          expect(entry, `${name}/${c.id}`).toBeDefined();
          expect(entry.connectorId).toBe(c.id);
        }
      }
    });
  });

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

  it('does not ask the consent screen for the same thing twice within one connection', async () => {
    // gmail.modify は readonly と compose を含む。送る接続で 3 つ並べると同意画面が読めなくなる。
    const actions = (await manifest('gmail')).connectors.find((c) => c.id === 'gmail-actions')!;
    expect(actions.scopes).not.toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(actions.scopes).not.toContain('https://www.googleapis.com/auth/gmail.compose');
    expect(actions.scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(actions.scopes).toContain('https://www.googleapis.com/auth/gmail.send');
  });
});
