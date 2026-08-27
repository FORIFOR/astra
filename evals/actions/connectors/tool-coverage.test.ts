/**
 * 宣言した tool は、実装されているか。正本 §9・§14、実装仕様 §3.6。
 *
 * 見るのは 1 点だけ:
 * **manifest が言っている tool を、走らせたときに誰かが実行するか。**
 *
 * 実装が無いまま宣言だけがあると、走らせても何も起きず、
 * それが**完了として記録される**（実際、Sales CRM の 2 つがそうだった）。
 * 画面には「完了」と出て、成果物は無い。これは失敗より始末が悪い —
 * 誰も失敗したと思わないので、誰も直さない。
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  architectureExecutors,
  careExecutors,
  ehrExecutors,
  salesCrmExecutors,
  stockExecutors,
  videoExecutors,
} from '@astra/service-agent-runtime';
import { generalExecutors, researchExecutors } from '@astra/service-research';
import { meetingExecutors } from '@astra/service-meeting';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const builtinDir = path.join(root, 'plugins/builtin');

/**
 * worker が実際に登録する tool の集合。
 *
 * **worker と同じ工場を呼ぶ。**名前を書き写すと、
 * worker 側で 1 つ外したときにこの試験が気づかない。
 * 依存は使わないので、null を渡して鍵だけ取る。
 */
function registeredTools(): Set<string> {
  const domain = null as never;
  return new Set([
    ...Object.keys(researchExecutors(null as never)),
    ...Object.keys(generalExecutors(null as never)),
    ...Object.keys(videoExecutors(domain)),
    ...Object.keys(careExecutors(domain)),
    ...Object.keys(ehrExecutors(domain)),
    ...Object.keys(architectureExecutors(domain)),
    ...Object.keys(stockExecutors(domain)),
    ...Object.keys(salesCrmExecutors(domain)),
    ...Object.keys(meetingExecutors({ meetings: {}, library: {}, recordings: {} } as never)),
  ]);
}

interface Manifest {
  id: string;
  execution_surfaces?: string[];
  tools?: { id: string; surface?: string }[];
}

/**
 * 端末で走る tool か。**manifest が言っていることで決める。**
 *
 * 一覧を試験側に書き写すと、manifest が変わったときに気づけない。
 * `surface: local` の step は Host Bridge へ回るので、
 * cloud の executor 表には現れないのが正しい。
 */
function runsOnDevice(manifest: Manifest, tool: { surface?: string }): boolean {
  const surface = tool.surface ?? manifest.execution_surfaces?.[0];
  return surface === 'local';
}

async function manifests(): Promise<Manifest[]> {
  const entries = await readdir(builtinDir, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) =>
        parse(await readFile(path.join(builtinDir, entry.name, 'plugin.yaml'), 'utf8')),
      ),
  );
}

describe('every bundled tool has somewhere to run', () => {
  it('leaves no declared tool without an implementation', async () => {
    const registered = registeredTools();
    const orphans: string[] = [];

    for (const manifest of await manifests()) {
      for (const tool of manifest.tools ?? []) {
        if (registered.has(tool.id) || runsOnDevice(manifest, tool)) continue;
        orphans.push(`${manifest.id}: ${tool.id}`);
      }
    }

    expect(
      orphans,
      `これらの tool は宣言だけで、走らせても何も起きない:\n  ${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  it('registers nothing that no manifest asked for', async () => {
    /*
     * 逆向きも見る。宣言に無い tool を登録していると、
     * **承認と権限の検査を通らない経路**ができる（検査は宣言を見るので）。
     */
    const declared = new Set<string>();
    for (const manifest of await manifests()) {
      for (const tool of manifest.tools ?? []) declared.add(tool.id);
    }

    /*
     * 中核の仕事（調査・会議）は plugin ではなく core の計画から来るので、
     * manifest には現れない。**接頭辞で除く**のは乱暴だが、
     * ここで見たいのは「plugin の宣言を迂回する経路が無いか」なので足りる。
     */
    const core = /^(research|meeting|noop)\./;
    const extra = [...registeredTools()].filter((id) => !declared.has(id) && !core.test(id));
    expect(extra, `宣言に無い tool が登録されている: ${extra.join(', ')}`).toEqual([]);
  });
});
