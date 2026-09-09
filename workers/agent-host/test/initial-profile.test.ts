import { describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@astra/contracts';
import type { ConnectorRuntime } from '../src/connector-steps.js';
import { runInitialProfile } from '../src/initial-profile.js';

describe('initial profile job', () => {
  it('does not read providers when no initial job is pending', async () => {
    const cloud = vi.fn().mockResolvedValue({ job: null });
    const refreshGrants = vi.fn();
    await runInitialProfile({ cloud, refreshGrants, connectors: {} as ConnectorRuntime });
    expect(cloud).toHaveBeenCalledTimes(1);
    expect(refreshGrants).not.toHaveBeenCalled();
  });
  it('reports unconnected sources honestly and never requests another provider', async () => {
    const called: string[] = [];
    const lease = uuidv7();
    const cloud = vi.fn(async (path: string, _method: string, _body?: unknown) => {
      if (path.endsWith('/claim'))
        return {
          job: {
            lease,
            profile: {
              id: uuidv7(),
              provider: 'microsoft',
              status: 'analysing',
              started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              outcomes: [],
              sections: null,
              profile: null,
            },
          },
        };
      return null;
    });
    await runInitialProfile({
      cloud,
      refreshGrants: async () => {},
      connectors: {
        connected: async (key: string) => {
          called.push(key);
          return false;
        },
      } as unknown as ConnectorRuntime,
    });
    expect(called).toEqual(['outlook', 'outlook']);
    const outcomes = cloud.mock.calls
      .filter(([path]) => path.endsWith('/progress'))
      .map(([, , body]) => body);
    expect(outcomes).toHaveLength(4);
    expect(outcomes).toContainEqual({
      lease,
      outcome: { source: 'outlook_mail', status: 'not_connected', artifacts: 0 },
      artifact_ids: [],
    });
    expect(cloud).toHaveBeenLastCalledWith('/v1/work/initial-profile/finish', 'POST', {
      lease,
      artifact_ids: [],
    });
  });
});
