/**
 * Image Agent。正本 §15.1、Phase 5 実装仕様 §5。
 *
 * 生成モデルは代役。ここで確かめたいのは**生成物の扱い**:
 * prompt が残るか、派生が辿れるか、黙って消えないか。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@astra/contracts';
import { createDb, withIdentity, type DbHandle } from '@astra/db';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { DeterministicImageGenerator, ImageService, titleFor } from '../src/image.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe('titleFor', () => {
  it('keeps a short prompt as it is, and trims a long one', () => {
    expect(titleFor('  夕暮れの   港町  ')).toBe('夕暮れの 港町');
    expect(titleFor('あ'.repeat(80))).toHaveLength(40);
  });
});

describe('the stand-in generator', () => {
  it('produces a real PNG, deterministically', async () => {
    const generator = new DeterministicImageGenerator();
    const a = await generator.generate({ prompt: '港町', seed: 7 });
    const b = await generator.generate({ prompt: '港町', seed: 7 });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    // PNG の magic
    expect(Buffer.from(a.bytes.slice(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
    // 代役であることは generator が名乗る。生成物そのものには載せない。
    expect(generator.isStandIn).toBe(true);
  });

  it('derives a seed from the prompt when none was given', async () => {
    const generator = new DeterministicImageGenerator();
    const a = await generator.generate({ prompt: '港町' });
    const b = await generator.generate({ prompt: '山道' });
    expect(a.seed).not.toBe(b.seed);
  });
});

describe.skipIf(!url)('ImageService', () => {
  let db: DbHandle;
  let library: LibraryService;
  let images: ImageService;
  let storeRoot: string;
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();
  const userId = uuidv7();

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 6,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-image-test',
    });
    await withIdentity(db, async (tx) => {
      for (const id of [tenantId, otherTenantId]) {
        await tx.insertInto('tenants').values({ id, name: 'I', kind: 'personal' }).execute();
      }
      await tx
        .insertInto('users')
        .values({ id: userId, email: `i-${userId}@example.com`, display_name: 'I' })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .execute();
    });

    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-image-'));
    library = new LibraryService(db, new FsObjectStore(storeRoot));
    images = new ImageService({ library, generator: new DeterministicImageGenerator() });
  }, 60_000);

  afterAll(async () => {
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('refuses to generate without a prompt', async () => {
    await expect(images.generate({ tenantId, userId, request: { prompt: '   ' } })).rejects.toThrow(
      /needs a prompt/,
    );
  });

  it('saves the result to the library with the prompt on it', async () => {
    // 載せないと、後から見て「何を頼んだ絵か」が分からなくなる
    const { artifact, seed } = await images.generate({
      tenantId,
      userId,
      request: { prompt: '夕暮れの港町' },
    });
    expect(artifact.type).toBe('IMAGE');
    expect(artifact.title).toBe('夕暮れの港町');
    expect(ImageService.promptOf(artifact)).toBe('夕暮れの港町');
    expect(ImageService.seedOf(artifact)).toBe(seed);
    expect(artifact.source_agent_id).toBe('image');
  });

  it('keeps a derived image pointing at what it came from', async () => {
    const first = await images.generate({ tenantId, userId, request: { prompt: '港町' } });
    const second = await images.generate({
      tenantId,
      userId,
      request: { prompt: '港町、夜', parentArtifactId: first.artifact.id },
    });
    expect(second.artifact.parent_artifact_id).toBe(first.artifact.id);
  });

  it('refuses to derive from another tenant’s image', async () => {
    // 確かめずに parent を付けると、他人の作品に紐づけられる
    const mine = await images.generate({ tenantId, userId, request: { prompt: '港町' } });
    await expect(
      images.generate({
        tenantId: otherTenantId,
        userId,
        request: { prompt: '盗んだ港町', parentArtifactId: mine.artifact.id },
      }),
    ).rejects.toThrow();
  });

  it('reproduces the same image from the same seed', async () => {
    const a = await images.generate({ tenantId, userId, request: { prompt: '山道', seed: 42 } });
    const b = await images.generate({ tenantId, userId, request: { prompt: '山道', seed: 42 } });
    // 再現できないと lineage の意味が薄い
    expect(a.artifact.sha256).toBe(b.artifact.sha256);
    expect(a.seed).toBe(42);
  });

  it('says nothing about a prompt it never stored', () => {
    expect(ImageService.promptOf({ tags: [] } as never)).toBeNull();
    expect(ImageService.seedOf({ tags: ['seed:これは数ではない'] } as never)).toBeNull();
  });
});
