/**
 * 規制データをリンクで外へ出さない。正本 §21、Phase 2 §2。
 *
 * REGULATED の cloud 送信可否は plugin policy が決めるが、
 * **その規則はまだ実行していない**（OQ-25）。
 * 判定できないまま外へ出すのは、判定して許すのとは違う。
 */
import { describe, expect, it, vi } from 'vitest';
import { uuidv7, type Artifact, type Sensitivity } from '@astra/contracts';
import { ShareService } from '../src/service.js';

const artifactWith = (sensitivity: Sensitivity): Artifact =>
  ({
    id: uuidv7(),
    tenant_id: uuidv7(),
    type: 'DOCUMENT',
    title: '診療記録',
    sensitivity,
    tags: [],
  }) as unknown as Artifact;

const serviceFor = (sensitivity: Sensitivity) =>
  new ShareService({
    db: {} as never,
    library: { get: vi.fn(async () => artifactWith(sensitivity)) } as never,
    shareHost: 'http://localhost:1430',
  });

describe('sharing by sensitivity', () => {
  it('refuses a REGULATED artifact before it touches the database', async () => {
    await expect(
      serviceFor('REGULATED').create(uuidv7(), uuidv7(), uuidv7(), {
        expires_in: '1d',
      } as never),
    ).rejects.toThrow(/REGULATED/);
  });

  it('says why, so it can be acted on', async () => {
    try {
      await serviceFor('REGULATED').create(uuidv7(), uuidv7(), uuidv7(), {
        expires_in: '1d',
      } as never);
    } catch (error) {
      expect((error as Error).message).toContain('policy');
    }
  });

  it('gets past the check for everything else', async () => {
    // ここから先は DB を触るので、この試験では通過したことだけを見る
    for (const sensitivity of ['PUBLIC', 'PRIVATE', 'CONFIDENTIAL'] as const) {
      await expect(
        serviceFor(sensitivity).create(uuidv7(), uuidv7(), uuidv7(), {
          expires_in: '1d',
        } as never),
      ).rejects.not.toThrow(/REGULATED/);
    }
  });
});
