import { InitialProfile, InitialProfileOutcome } from '@astra/contracts';
import type { ConnectorRuntime } from './connector-steps.js';
import { WorkSyncLoop } from './work-sync.js';

/** A leased, bounded first read. No timer-driven re-analysis after confirmation. */
export async function runInitialProfile(deps: {
  cloud: (path: string, method: string, body?: unknown) => Promise<unknown>;
  connectors: ConnectorRuntime;
  refreshGrants: () => Promise<void>;
}): Promise<void> {
  const result = (await deps.cloud('/v1/work/initial-profile/claim', 'POST')) as {
    job: { lease: string; profile: unknown } | null;
  };
  if (!result.job) return;
  const { lease } = result.job;
  const profile = InitialProfile.parse(result.job.profile);
  await deps.refreshGrants();
  const ids = new Set<string>();
  const sources =
    profile.provider === 'google'
      ? (['gmail', 'google_calendar'] as const)
      : (['outlook_mail', 'outlook_calendar'] as const);
  const loop = new WorkSyncLoop({
    connectors: deps.connectors,
    sources,
    lookbackDays: 45,
    calendarLookbackDays: 90,
    lookaheadDays: 45,
    metadataOnly: true,
    maxClassifications: 0,
    push: async (batch) => {
      await deps.cloud('/v1/work/artifacts', 'POST', batch);
      for (const artifact of batch.artifacts) ids.add(artifact.id);
    },
    onSourceStart: async (source) => {
      await deps.cloud('/v1/work/initial-profile/progress', 'POST', {
        lease,
        outcome: { source, status: 'reading', artifacts: 0 },
        artifact_ids: [...ids],
      });
    },
    onOutcome: async (outcome) => {
      await deps.cloud('/v1/work/initial-profile/progress', 'POST', {
        lease,
        outcome: InitialProfileOutcome.parse(outcome),
        artifact_ids: [...ids],
      });
    },
  });
  await loop.syncOnce();
  await deps.cloud('/v1/work/initial-profile/finish', 'POST', { lease, artifact_ids: [...ids] });
}
