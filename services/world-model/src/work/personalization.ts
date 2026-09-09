/**
 * Personalization Profile。**仕事の状況（Work Graph）とは別に持つ、比較的長期の傾向。**
 *
 * 観測（observed）→ 推測（inferred）→ 本人が確認（confirmed）の 3 段。推測を事実として固定しない。
 * 本人が「この推測を使わない」と言えば enabled=false で、以後の注入に出ない。全体の停止も 1 操作。
 */
import type {
  PersonalizationProfile,
  PersonalizationTrait,
  PersonalizationUpdate,
  WorkArtifact,
} from '@astra/contracts';
import { clusterProjects, personKey } from './graph.js';

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

export interface StoredPersonalization {
  readonly inference_enabled: boolean;
  /** key → 本人の上書き。 */
  readonly overrides: Readonly<
    Record<
      string,
      {
        status?: PersonalizationTrait['status'];
        enabled?: boolean;
        value?: PersonalizationTrait['value'];
      }
    >
  >;
  readonly updated_at: string;
}

export const EMPTY_PERSONALIZATION: StoredPersonalization = {
  inference_enabled: true,
  overrides: {},
  updated_at: new Date(0).toISOString(),
};

/** 直近 28 日の予定から、会議の多い曜日と空いている時間帯を推測する。 */
export function deriveProfile(
  artifacts: readonly WorkArtifact[],
  stored: StoredPersonalization,
  now: Date,
): PersonalizationProfile {
  const since = now.getTime() - 28 * 86_400_000;
  const events = artifacts.filter(
    (a) =>
      (a.kind === 'calendar_event' || a.kind === 'meeting') && Date.parse(a.occurred_at) >= since,
  );

  const perDay = new Map<number, number>();
  const busyHours = new Set<number>();
  for (const e of events) {
    const d = new Date(e.occurred_at);
    perDay.set(d.getDay(), (perDay.get(d.getDay()) ?? 0) + 1);
    const endH = e.ends_at ? new Date(e.ends_at).getHours() : d.getHours() + 1;
    for (let h = d.getHours(); h < Math.max(endH, d.getHours() + 1); h += 1) busyHours.add(h);
  }
  const weeks = 4;
  const heavy = [...perDay.entries()]
    .filter(([, n]) => n / weeks >= 2)
    .map(([d]) => d)
    .sort();
  const patterns: PersonalizationTrait[] = [];
  if (heavy.length) {
    patterns.push(
      trait(
        'work.meetingHeavyDays',
        `${heavy.map((d) => WEEKDAY_JA[d]).join('・')}は会議が多い`,
        heavy.map((d) => WEEKDAY_JA[d]!),
        'inferred',
        events.slice(0, 3),
      ),
    );
  }
  // 9–18 時で会議の無い最長の連続時間帯（2 時間以上）を集中時間とみなす。
  let run: number[] = [],
    best: number[] = [];
  for (let h = 9; h <= 18; h += 1) {
    if (!busyHours.has(h) && events.length > 0) {
      run.push(h);
      if (run.length > best.length) best = [...run];
    } else run = [];
  }
  if (best.length >= 2) {
    patterns.push(
      trait(
        'work.deepWorkHours',
        `${best[0]}:00–${best[best.length - 1]! + 1}:00 は集中時間らしい`,
        [`${best[0]}:00-${best[best.length - 1]! + 1}:00`],
        'inferred',
        events.slice(0, 3),
      ),
    );
  }

  const clusters = clusterProjects(artifacts).sort(
    (a, b) => b.artifacts.length - a.artifacts.length || a.name.localeCompare(b.name),
  );
  const entities: PersonalizationTrait[] = clusters
    .slice(0, 5)
    .map((c) =>
      trait(
        'entity.project.' + c.key,
        c.name,
        c.artifacts.length,
        'observed',
        c.artifacts.slice(0, 2),
      ),
    );
  const people = new Map<string, { name: string; n: number; arts: WorkArtifact[] }>();
  for (const a of artifacts)
    for (const p of a.people) {
      const k = personKey(p);
      const cur = people.get(k) ?? { name: p.name, n: 0, arts: [] };
      cur.n += 1;
      if (cur.arts.length < 2) cur.arts.push(a);
      people.set(k, cur);
    }
  for (const [k, v] of [...people.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, 5)) {
    entities.push(trait('entity.person.' + k, v.name, v.n, 'observed', v.arts));
  }

  // 回答の好みは、本人が言ったものだけ（データからは推測しない）。
  const style: PersonalizationTrait[] = [];
  for (const key of ['style.prefersConcise', 'style.prefersEvidence', 'style.prefersActionable']) {
    const o = stored.overrides[key];
    if (o?.status === 'confirmed' || o?.value !== undefined) {
      style.push({
        key,
        label: typeof o.value === 'string' ? o.value : STYLE_LABEL[key]!,
        value: o.value ?? 1,
        status: o.status ?? 'confirmed',
        enabled: o.enabled ?? true,
        sources: [],
      });
    }
  }
  const apply = (t: PersonalizationTrait): PersonalizationTrait => {
    const o = stored.overrides[t.key];
    return o
      ? {
          ...t,
          ...(o.status ? { status: o.status } : {}),
          ...(o.enabled !== undefined ? { enabled: o.enabled } : {}),
          ...(o.value !== undefined ? { value: o.value } : {}),
        }
      : t;
  };
  return {
    working_style: style,
    work_patterns: patterns.map(apply),
    frequent_entities: entities.map(apply),
    inference_enabled: stored.inference_enabled,
    updated_at: stored.updated_at,
  };
}

const STYLE_LABEL: Record<string, string> = {
  'style.prefersConcise': '短く要点から',
  'style.prefersEvidence': '出所を示す',
  'style.prefersActionable': '実装できる具体案を優先',
};

function trait(
  key: string,
  label: string,
  value: PersonalizationTrait['value'],
  status: PersonalizationTrait['status'],
  arts: readonly WorkArtifact[],
): PersonalizationTrait {
  return { key, label, value, status, enabled: true, sources: arts.map((a) => a.provenance) };
}

/** 本人の更新を stored に畳む（1 操作）。 */
export function applyUpdate(
  stored: StoredPersonalization,
  update: PersonalizationUpdate,
  now: Date,
): StoredPersonalization {
  const overrides = { ...stored.overrides };
  for (const t of update.traits) {
    overrides[t.key] = {
      ...(overrides[t.key] ?? {}),
      ...(t.status ? { status: t.status } : {}),
      ...(t.enabled !== undefined ? { enabled: t.enabled } : {}),
      ...(t.value !== undefined ? { value: t.value } : {}),
    };
  }
  return {
    inference_enabled: update.inference_enabled ?? stored.inference_enabled,
    overrides,
    updated_at: now.toISOString(),
  };
}
