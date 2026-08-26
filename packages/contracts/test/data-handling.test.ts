/**
 * データがどこまで出るか。UI/UX §22。
 *
 * ここで守りたいのは 1 つだけ:
 * **送っていないのに送ったと言わない／送ったのに黙らない。**
 */
import { describe, expect, it } from 'vitest';
import {
  DATA_HANDLING,
  DATA_HANDLING_DETAIL,
  DATA_HANDLING_LABEL,
  EXTERNAL_SEND_SCOPES,
  LOCAL_ONLY_SCOPES,
  PERMISSION_SCOPES,
  dataHandlingFor,
} from '../src/index.js';

describe('the vocabulary', () => {
  it('has a short label and one more level for every state', () => {
    for (const handling of DATA_HANDLING) {
      expect(DATA_HANDLING_LABEL[handling].length).toBeGreaterThan(0);
      // 「短い」— chip に載る長さ
      expect(DATA_HANDLING_LABEL[handling].length).toBeLessThanOrEqual(10);
      expect(DATA_HANDLING_DETAIL[handling].length).toBeGreaterThan(0);
    }
  });
});

describe('deciding from the surface and the risk', () => {
  it('keeps a local read local', () => {
    expect(dataHandlingFor('local', 'READ')).toBe('local_only');
    expect(dataHandlingFor('local', 'REVERSIBLE_WRITE')).toBe('local_only');
  });

  it('does not call cloud processing an external send', () => {
    // クラウドで動く = 外へ送る、ではない
    expect(dataHandlingFor('cloud', 'READ')).toBe('cloud_used');
    expect(dataHandlingFor('cloud', 'REVERSIBLE_WRITE')).toBe('cloud_used');
  });

  it('calls an external commit an external send wherever it runs', () => {
    expect(dataHandlingFor('cloud', 'EXTERNAL_COMMIT')).toBe('external_send');
    // local で動いていても、外へ出るなら外へ出ると言う
    expect(dataHandlingFor('local', 'EXTERNAL_COMMIT')).toBe('external_send');
    expect(dataHandlingFor('local', 'FINANCIAL')).toBe('external_send');
  });
});

describe('the scope lists', () => {
  it('names real scopes only', () => {
    for (const scope of [...EXTERNAL_SEND_SCOPES, ...LOCAL_ONLY_SCOPES]) {
      expect(PERMISSION_SCOPES).toContain(scope);
    }
  });

  it('does not treat writing to our own library as sending it away', () => {
    // 名前の形（.write）で判断すると、ここを取り違える
    expect(EXTERNAL_SEND_SCOPES).not.toContain('artifacts.write');
    expect(EXTERNAL_SEND_SCOPES).toContain('email.send');
  });

  it('keeps a scope out of both lists rather than in both', () => {
    for (const scope of EXTERNAL_SEND_SCOPES) {
      expect(LOCAL_ONLY_SCOPES).not.toContain(scope);
    }
  });
});
