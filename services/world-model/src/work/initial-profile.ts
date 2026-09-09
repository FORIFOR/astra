import { sql } from 'kysely';
import { withTenant, type DbHandle } from '@astra/db';
import {
  InitialProfile,
  type InitialProfileOutcome,
  type InitialProfileSections,
  WorkArtifact,
  uuidv7,
  type PersonalizationProfile,
} from '@astra/contracts';
import { buildWorkContext, clusterProjects, personKey } from './graph.js';
import { wallClock } from './business-time.js';
import { deriveProfile, EMPTY_PERSONALIZATION } from './personalization.js';

// Provider titles may exceed the editable profile's 200-character limit.
const summaryText = (value: string): string => {
  let result = '';
  for (const character of value.trim()) {
    if (result.length + character.length > 200) break;
    result += character;
  }
  return result.trim();
};

export function initialSnapshot(
  artifacts: readonly WorkArtifact[],
  now: Date,
): {
  sections: InitialProfileSections;
  profile: PersonalizationProfile;
} {
  const context = buildWorkContext({ artifacts, corrections: [], now, inferenceEnabled: true });
  const history = artifacts.filter((a) => Date.parse(a.occurred_at) <= now.getTime());
  const profile = deriveProfile(history, EMPTY_PERSONALIZATION, now, 90);
  const meetings = history.filter((a) => a.kind === 'calendar_event');
  const afternoon = meetings.filter((a) => wallClock(new Date(a.occurred_at)).getUTCHours() >= 12);
  const workPattern =
    meetings.length >= 5 && afternoon.length / meetings.length >= 0.65
      ? ['午後に会議が多い', ...profile.work_patterns.map((item) => item.label)]
      : profile.work_patterns.map((item) => item.label);
  const people = new Map<string, { name: string; count: number }>();
  for (const artifact of artifacts) {
    const seen = new Set<string>();
    for (const person of artifact.people) {
      if (
        artifact.kind !== 'email' ||
        (artifact.direction === 'inbound' ? person.role !== 'from' : person.role !== 'to')
      )
        continue;
      const key = personKey(person);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = people.get(key) ?? { name: person.name, count: 0 };
      entry.count += 1;
      people.set(key, entry);
    }
  }
  return {
    profile,
    sections: {
      focus: clusterProjects(
        artifacts.filter(
          (a) => a.completed !== true && Date.parse(a.occurred_at) >= now.getTime() - 45 * 86400000,
        ),
      )
        .sort((a, b) => b.artifacts.length - a.artifacts.length)
        .slice(0, 5)
        .map((project) => summaryText(project.name))
        .filter(Boolean),
      people: [...people.values()]
        .filter((p) => p.count >= 2)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 12)
        .map((p) => summaryText(p.name))
        .filter(Boolean),
      priorities: context.priorities
        .slice(0, 5)
        .map((item) => summaryText(item.title))
        .filter(Boolean),
      work_pattern: workPattern.slice(0, 3).map(summaryText).filter(Boolean),
      open_items: new Set([...context.waiting_on, ...context.owed].map((item) => item.id)).size,
    },
  };
}

export class InitialProfileService {
  constructor(
    private readonly db: DbHandle,
    private readonly now: () => Date,
  ) {}

  async get(tenant: string, user: string): Promise<InitialProfile | null> {
    return withTenant(this.db, tenant, async (tx) => {
      const r = await sql<{
        payload: unknown;
      }>`SELECT payload FROM initial_profiles WHERE user_id=${user}`.execute(tx);
      return r.rows[0] ? InitialProfile.parse(r.rows[0].payload) : null;
    });
  }

  async begin(
    tenant: string,
    user: string,
    provider: 'google' | 'microsoft',
  ): Promise<InitialProfile> {
    const stamp = this.now().toISOString();
    const value: InitialProfile = {
      id: uuidv7(),
      provider,
      status: 'queued',
      started_at: stamp,
      updated_at: stamp,
      outcomes: [],
      sections: null,
      profile: null,
    };
    await withTenant(this.db, tenant, (tx) =>
      sql`INSERT INTO initial_profiles (tenant_id,user_id,payload)
      VALUES (${tenant},${user},${JSON.stringify(value)}::jsonb) ON CONFLICT DO NOTHING`.execute(
        tx,
      ),
    );
    return (await this.get(tenant, user))!;
  }

  async claim(
    tenant: string,
    user: string,
  ): Promise<{ lease: string; profile: InitialProfile } | null> {
    const now = this.now();
    const lease = uuidv7();
    return withTenant(this.db, tenant, async (tx) => {
      const r = await sql<{ payload: unknown }>`UPDATE initial_profiles
        SET lease_id=${lease}, lease_until=${new Date(now.getTime() + 5 * 60_000)},
          payload=jsonb_set(payload,'{status}','"analysing"'::jsonb)
        WHERE user_id=${user} AND (payload->>'status'='queued' OR
          (payload->>'status'='analysing' AND lease_until < ${now})) RETURNING payload`.execute(tx);
      return r.rows[0] ? { lease, profile: InitialProfile.parse(r.rows[0].payload) } : null;
    });
  }

  async progress(
    tenant: string,
    user: string,
    lease: string,
    outcome: InitialProfileOutcome,
    artifactIds: readonly string[] = [],
  ): Promise<boolean> {
    return withTenant(this.db, tenant, async (tx) => {
      const r = await sql<{ payload: unknown }>`SELECT payload FROM initial_profiles
        WHERE user_id=${user} AND lease_id=${lease} AND payload->>'status'='analysing' FOR UPDATE`.execute(
        tx,
      );
      if (!r.rows[0]) return false;
      const p = InitialProfile.parse(r.rows[0].payload);
      const expected =
        p.provider === 'google'
          ? ['gmail', 'google_calendar']
          : ['outlook_mail', 'outlook_calendar'];
      if (!expected.includes(outcome.source)) return false;
      p.outcomes = [...p.outcomes.filter((o) => o.source !== outcome.source), outcome];
      p.updated_at = this.now().toISOString();
      if (outcome.status === 'synced' && artifactIds.length) {
        const rows = await sql<{
          body: unknown;
        }>`SELECT body FROM work_artifacts WHERE user_id=${user}
          AND id=ANY(${sql.val(artifactIds)}::text[]) AND observed_at >= ${new Date(p.started_at)}`.execute(
          tx,
        );
        const allowed = new Set(
          p.outcomes.filter((o) => o.status === 'synced').map((o) => o.source),
        );
        const artifacts = rows.rows
          .map((r) => WorkArtifact.parse(r.body))
          .filter((a) => allowed.has(a.source as InitialProfileOutcome['source']));
        const snapshot = initialSnapshot(artifacts, this.now());
        p.sections = snapshot.sections;
        p.profile = snapshot.profile;
      }
      await sql`UPDATE initial_profiles SET payload=${JSON.stringify(p)}::jsonb,
        lease_until=${new Date(this.now().getTime() + 5 * 60_000)} WHERE user_id=${user}`.execute(
        tx,
      );
      return true;
    });
  }

  async finish(
    tenant: string,
    user: string,
    lease: string,
    artifactIds: readonly string[],
  ): Promise<boolean> {
    return withTenant(this.db, tenant, async (tx) => {
      const r = await sql<{
        payload: unknown;
      }>`SELECT payload FROM initial_profiles WHERE user_id=${user}
        AND lease_id=${lease} AND payload->>'status'='analysing' FOR UPDATE`.execute(tx);
      if (!r.rows[0]) return false;
      const p = InitialProfile.parse(r.rows[0].payload);
      const successful = p.outcomes.filter((o) => o.status === 'synced');
      p.status =
        successful.length &&
        p.outcomes.length === 2 &&
        p.outcomes.every((o) => o.status !== 'reading')
          ? 'ready'
          : 'failed';
      if (p.status === 'ready') {
        const rows = artifactIds.length
          ? await sql<{ body: unknown }>`SELECT body FROM work_artifacts
          WHERE user_id=${user} AND id=ANY(${sql.val(artifactIds)}::text[])
          AND observed_at >= ${new Date(p.started_at)}`.execute(tx)
          : { rows: [] };
        const allowed = new Set(successful.map((o) => o.source));
        const artifacts = rows.rows
          .map((r) => WorkArtifact.parse(r.body))
          .filter((a) => allowed.has(a.source as InitialProfileOutcome['source']));
        const snapshot = initialSnapshot(artifacts, this.now());
        p.sections = snapshot.sections;
        p.profile = snapshot.profile;
      }
      p.updated_at = this.now().toISOString();
      await sql`UPDATE initial_profiles SET payload=${JSON.stringify(p)}::jsonb, lease_id=NULL, lease_until=NULL WHERE user_id=${user}`.execute(
        tx,
      );
      return true;
    });
  }

  async retry(tenant: string, user: string): Promise<void> {
    await withTenant(this.db, tenant, (tx) =>
      sql`UPDATE initial_profiles SET
      payload=payload || '{"status":"queued","outcomes":[],"sections":null,"profile":null}'::jsonb
      WHERE user_id=${user} AND payload->>'status'='failed'`.execute(tx),
    );
  }

  async confirm(tenant: string, user: string, sections: InitialProfileSections): Promise<boolean> {
    return withTenant(this.db, tenant, async (tx) => {
      const r = await sql<{ payload: unknown }>`SELECT payload FROM initial_profiles
        WHERE user_id=${user} AND payload->>'status' IN ('ready','confirmed') FOR UPDATE`.execute(
        tx,
      );
      if (!r.rows[0]) return false;
      const p = InitialProfile.parse(r.rows[0].payload);
      p.sections = sections;
      p.status = 'confirmed';
      p.updated_at = this.now().toISOString();
      // Keep just the five reviewed groups as user-confirmed personalization.
      // The provenance-bearing original inference remains in work artifacts.
      p.profile = {
        inference_enabled: true,
        updated_at: p.updated_at,
        work_patterns: [],
        frequent_entities: [],
        working_style: Object.entries(sections).map(([key, value]) => ({
          key: `initial.${key}`,
          label: (
            {
              focus: '現在の仕事',
              people: 'よく関わる人',
              priorities: '直近の優先事項',
              work_pattern: '仕事の傾向',
              open_items: '未完了の項目',
            } as Record<string, string>
          )[key]!,
          value,
          status: 'confirmed' as const,
          enabled: true,
          sources: [],
        })),
      };
      await sql`UPDATE initial_profiles SET payload=${JSON.stringify(p)}::jsonb WHERE user_id=${user}`.execute(
        tx,
      );
      return true;
    });
  }
}
