/**
 * デスクトップアプリが、そもそも起動できる形になっているか。
 *
 * **これが無くて、GUI は一度も起動できなかった。**
 * `tauri` という script は package.json に在ったが、
 * `@tauri-apps/cli` が**リポジトリの全履歴で一度も入っていなかった**ので、
 * 呼んでも動かない。Rust は `cargo test` で通り、frontend は
 * `vite build` で通り、**その間にある「アプリを組み立てる」段が
 * 誰にも走らされていなかった。**
 *
 * ここで見るのは中身ではなく、**入口が在るか**だけ。
 * 実際に組み立てるのは重いので CI に任せ、
 * 「組み立てる道具が無い」状態はここで落とす。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

const readJson = async (file: string): Promise<Record<string, never>> =>
  JSON.parse(await readFile(file, 'utf8')) as Record<string, never>;

describe('the desktop app can actually be launched', () => {
  it('has the tool that builds it', async () => {
    const pkg = await readJson(path.join(here, '../package.json'));
    const dev = (pkg as unknown as { devDependencies: Record<string, string> }).devDependencies;
    // これが無いと `tauri` script は在るのに動かない
    expect(dev['@tauri-apps/cli'], '@tauri-apps/cli が入っていない').toBeTruthy();
  });

  it('has a way in for running it and for shipping it', async () => {
    const pkg = await readJson(path.join(here, '../package.json'));
    const scripts = (pkg as unknown as { scripts: Record<string, string> }).scripts;
    expect(scripts['tauri:dev']).toBeTruthy();
    expect(scripts['tauri:build']).toBeTruthy();
  });

  it('points the dev server where the app looks for it', async () => {
    /*
     * `devUrl` と vite の port がずれていると、
     * 窓は開くが**中身が出ない**。動かないより分かりにくい。
     */
    const config = await readJson(path.join(here, '../src-tauri/tauri.conf.json'));
    const devUrl = (config as unknown as { build: { devUrl: string } }).build.devUrl;
    const vite = await readFile(path.join(here, '../vite.config.ts'), 'utf8');
    const port = /port:\s*(\d+)/.exec(vite)?.[1];
    expect(port, 'vite の port が読めない').toBeTruthy();
    expect(devUrl).toContain(port!);
  });

  it('builds the frontend into the folder the app bundles', async () => {
    // ここがずれると、古い画面が入ったまま配られる
    const config = await readJson(path.join(here, '../src-tauri/tauri.conf.json'));
    const dist = (config as unknown as { build: { frontendDist: string } }).build.frontendDist;
    expect(dist).toBe('../dist');
  });
});
