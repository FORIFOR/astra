import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PersonalizationProfile,
  InitialProfileSections,
  uuidv7,
  type WorkArtifact,
} from '@astra/contracts';
import { createDb, withIdentity, type DbHandle } from '@astra/db';
import { WorkContextService } from '../src/work/service.js';
import { initialSnapshot } from '../src/work/initial-profile.js';

const NOW = new Date('2026-09-09T12:00:00Z');
const artifact = (id: string): WorkArtifact => ({
  id,
  source: 'gmail',
  kind: 'email',
  title: 'Astra review',
  body_excerpt: null,
  people: [
    { name: 'Colleague', email: 'colleague@example.invalid', role: 'from' },
    { name: 'Me', email: 'self@example.invalid', role: 'to' },
  ],
  direction: 'inbound',
  occurred_at: NOW.toISOString(),
  ends_at: null,
  due_at: null,
  thread_id: id,
  project_hint: 'Astra',
  responded: null,
  completed: null,
  provenance: {
    source: 'gmail',
    external_id: id,
    label: 'Astra review',
    observed_at: NOW.toISOString(),
    url: null,
    excerpt: null,
  },
  semantic: null,
  origin: null,
});

describe('initial profile summary', () => {
  it('bounds long entity keys without merging distinct contacts', () => {
    const longMail = (suffix: string) => ({
      ...artifact(suffix),
      people: [
        {
          name: 'Colleague',
          email: `${'a'.repeat(90)}${suffix}@example.invalid`,
          role: 'from' as const,
        },
      ],
    });
    const snapshot = initialSnapshot([longMail('1'), longMail('2')], NOW);
    const profile = PersonalizationProfile.parse(snapshot.profile);
    const keys = profile.frequent_entities.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.length <= 100)).toBe(true);
    expect(initialSnapshot([longMail('1'), longMail('2')], NOW).profile).toEqual(profile);
  });
  it('does not invent facts for empty data', () => {
    expect(initialSnapshot([], NOW).sections).toEqual({
      focus: [],
      people: [],
      priorities: [],
      work_pattern: [],
      open_items: 0,
    });
  });
  it('counts recurring counterparts rather than the mailbox owner', () => {
    expect(initialSnapshot([artifact('a'), artifact('b')], NOW).sections.people).toEqual([
      'Colleague',
    ]);
  });
  it('keeps long provider subjects within the editable profile limits', () => {
    const event = {
      ...artifact('long'),
      kind: 'calendar_event' as const,
      source: 'google_calendar' as const,
      title: 'Meeting '.repeat(60),
      occurred_at: new Date(NOW.getTime() + 3600000).toISOString(),
    };
    const sections = initialSnapshot([event], NOW).sections;
    expect(InitialProfileSections.safeParse(sections).success).toBe(true);
    expect(sections.priorities[0]?.length).toBeLessThanOrEqual(200);
    const emoji = initialSnapshot([{ ...event, title: 'A' + '🙂'.repeat(200) }], NOW).sections;
    expect(emoji.priorities[0]).not.toMatch(/[\uD800-\uDBFF]$/u);
  });
});

describe.skipIf(!process.env['TEST_DATABASE_URL'])('initial profile persistence', () => {
  let db: DbHandle;
  let work: WorkContextService;
  const tenant = uuidv7(),
    other = uuidv7(),
    user = uuidv7();
  let clock = NOW;
  beforeAll(async () => {
    db = createDb({
      url: process.env['TEST_DATABASE_URL']!,
      identityUrl: process.env['TEST_IDENTITY_DATABASE_URL'],
      maxConnections: 6,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000,
      statementTimeoutMillis: 20000,
      applicationName: 'astra-initial-profile-test',
    });
    await withIdentity(db, async (tx) => {
      for (const id of [tenant, other])
        await tx.insertInto('tenants').values({ id, name: 'Initial', kind: 'personal' }).execute();
      await tx
        .insertInto('users')
        .values({ id: user, email: `${user}@example.invalid`, display_name: 'Initial' })
        .execute();
    });
    work = new WorkContextService({ db, now: () => clock });
  });
  afterAll(async () => {
    await db?.close();
  });
  it('starts once, leases exclusively, reports real counts, and freezes reviewed data', async () => {
    const initial = await work.initialProfile.begin(tenant, user, 'google');
    expect((await work.initialProfile.begin(tenant, user, 'microsoft')).id).toBe(initial.id);
    const claims = await Promise.all([
      work.initialProfile.claim(tenant, user),
      work.initialProfile.claim(tenant, user),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean)!;
    expect(await work.initialProfile.get(other, user)).toBeNull();
    expect(
      await work.initialProfile.progress(tenant, user, uuidv7(), {
        source: 'gmail',
        status: 'synced',
        artifacts: 999,
      }),
    ).toBe(false);
    expect(
      await work.initialProfile.progress(tenant, user, claim.lease, {
        source: 'outlook_mail',
        status: 'synced',
        artifacts: 0,
      }),
    ).toBe(false);
    await work.ingest(tenant, user, {
      source: 'gmail',
      cursor: null,
      watermark: null,
      artifacts: [artifact('a'), artifact('b')],
    });
    await work.initialProfile.progress(
      tenant,
      user,
      claim.lease,
      { source: 'gmail', status: 'synced', artifacts: 2 },
      ['a', 'b'],
    );
    expect((await work.initialProfile.get(tenant, user))?.sections?.people).toEqual(['Colleague']);
    await work.initialProfile.progress(tenant, user, claim.lease, {
      source: 'google_calendar',
      status: 'not_connected',
      artifacts: 0,
    });
    expect(await work.initialProfile.finish(tenant, user, claim.lease, ['a', 'b'])).toBe(true);
    const ready = (await work.initialProfile.get(tenant, user))!;
    expect(ready.status).toBe('ready');
    expect(ready.sections?.people).toEqual(['Colleague']);
    expect((await work.personalization(tenant, user)).working_style).toEqual([]);
    expect(
      await work.initialProfile.confirm(tenant, user, {
        ...ready.sections!,
        focus: ['User correction'],
      }),
    ).toBe(true);
    const frozen = await work.personalization(tenant, user);
    expect(frozen.working_style.find((x) => x.key === 'initial.focus')?.value).toEqual([
      'User correction',
    ]);
    await work.ingest(tenant, user, {
      source: 'gmail',
      cursor: null,
      watermark: null,
      artifacts: [{ ...artifact('new'), project_hint: 'Later project' }],
    });
    expect(await work.personalization(tenant, user)).toEqual(frozen);
    expect(await work.initialProfile.claim(tenant, user)).toBeNull();
    await work.initialProfile.retry(tenant, user);
    expect((await work.initialProfile.get(tenant, user))?.status).toBe('confirmed');
    expect(
      (await new WorkContextService({ db }).initialProfile.begin(tenant, user, 'google')).id,
    ).toBe(initial.id);
  });
  it('recovers an expired worker lease without accepting stale progress', async () => {
    const owner = uuidv7();
    await withIdentity(db, (tx) =>
      tx
        .insertInto('users')
        .values({ id: owner, email: `${owner}@example.invalid`, display_name: 'Recovery' })
        .execute(),
    );
    await work.initialProfile.begin(tenant, owner, 'google');
    const old = (await work.initialProfile.claim(tenant, owner))!;
    clock = new Date(NOW.getTime() + 6 * 60_000);
    const next = (await work.initialProfile.claim(tenant, owner))!;
    expect(next.lease).not.toBe(old.lease);
    expect(await work.initialProfile.finish(tenant, owner, old.lease, [])).toBe(false);
    await work.initialProfile.progress(tenant, owner, next.lease, {
      source: 'gmail',
      status: 'failed',
      artifacts: 0,
    });
    await work.initialProfile.progress(tenant, owner, next.lease, {
      source: 'google_calendar',
      status: 'not_granted',
      artifacts: 0,
    });
    await work.initialProfile.finish(tenant, owner, next.lease, []);
    expect((await work.initialProfile.get(tenant, owner))?.status).toBe('failed');
    await work.initialProfile.retry(tenant, owner);
    expect((await work.initialProfile.get(tenant, owner))?.sections).toBeNull();
    expect(await work.initialProfile.claim(tenant, owner)).not.toBeNull();
  });
});
