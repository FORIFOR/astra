/**
 * 会議前の brief。MEETING_BRIEF_GATE。
 *
 *   次の予定 → 案件（entity resolution）→ 前回の会議 → その後のメール → 開いている件
 *   → 決定的な事実（出所つき）→ 確かめたいこと（規則。理由と出所を持つ）
 *
 * LLM に全部作らせない。事実は artifact から機械で並べ、質問は開いている件から規則で作る。
 * 別案件のものは混ぜない。出所の無い文は 1 つも出さない。
 */
import type {
  BriefFact,
  MeetingBrief,
  Provenance,
  SuggestedQuestion,
  WorkArtifact,
  WorkContext,
} from '@astra/contracts';
import { clusterProjects, titleTokens } from './graph.js';

export interface MeetingBriefInput {
  readonly artifacts: readonly WorkArtifact[];
  readonly context: WorkContext;
  readonly now: Date;
  /** 次の予定を探す範囲（時間）。 */
  readonly horizonHours?: number;
  /** 特定の予定（artifact id）。無ければ直近の 1 件。 */
  readonly eventId?: string | null;
}

const MEETING_KINDS = new Set(['meeting', 'decision', 'action_item']);

function byTimeAsc(a: WorkArtifact, b: WorkArtifact): number {
  return a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id);
}

/** 次の予定（時刻のある予定だけ）。 */
export function nextEvent(
  artifacts: readonly WorkArtifact[],
  now: Date,
  horizonHours = 24,
  eventId: string | null = null,
): WorkArtifact | null {
  const events = artifacts.filter((a) => a.kind === 'calendar_event');
  if (eventId) return events.find((a) => a.id === eventId) ?? null;
  const end = new Date(now.getTime() + horizonHours * 3_600_000).toISOString();
  const soon = events
    .filter(
      (a) =>
        a.occurred_at >= new Date(now.getTime() - 15 * 60_000).toISOString() &&
        a.occurred_at <= end,
    )
    .sort(byTimeAsc);
  return soon[0] ?? null;
}

/** 予定の案件。cluster に入っていればそれ、無ければ題名の語で cluster を当てる。 */
function projectOf(
  event: WorkArtifact,
  artifacts: readonly WorkArtifact[],
): { name: string; members: WorkArtifact[] } | null {
  const clusters = clusterProjects(artifacts);
  const own = clusters.find((c) => c.artifacts.some((a) => a.id === event.id));
  if (own && own.artifacts.length > 1) return { name: own.name, members: own.artifacts };
  const q = titleTokens(event.title).filter((w) => w.length >= 2);
  const scored = clusters
    .filter((c) => !c.artifacts.some((a) => a.id === event.id))
    .map((c) => ({
      c,
      hit: titleTokens(c.name)
        .filter((h) => h.length >= 2)
        .filter((h) => q.some((w) => w === h || w.includes(h) || h.includes(w))).length,
    }))
    .filter((s) => s.hit > 0)
    .sort((a, b) => b.hit - a.hit || a.c.name.localeCompare(b.c.name));
  const best = scored[0]?.c;
  return best
    ? { name: best.name, members: [...best.artifacts, event] }
    : own
      ? { name: own.name, members: own.artifacts }
      : null;
}

function item(text: string, sources: Provenance[]): BriefFact {
  return { text: text.slice(0, 300), sources };
}

export function buildMeetingBrief(input: MeetingBriefInput): MeetingBrief | null {
  const { artifacts, context, now } = input;
  const event = nextEvent(artifacts, now, input.horizonHours ?? 24, input.eventId ?? null);
  if (!event) return null;
  const project = projectOf(event, artifacts);
  const members = project?.members ?? [event];
  const inProject = (a: WorkArtifact): boolean => members.some((m) => m.id === a.id);

  // 前回の会議: 案件の中で、今より前の会議（またはその決定・やること）。いちばん新しい会議の日を基準にする。
  const meetings = artifacts
    .filter((a) => a.kind === 'meeting' && inProject(a) && a.occurred_at < now.toISOString())
    .sort(byTimeAsc);
  const lastMeeting = meetings.at(-1) ?? null;
  const previous: BriefFact[] = [];
  if (lastMeeting) {
    previous.push(item(`前回: ${lastMeeting.title}`, [lastMeeting.provenance]));
    const outcomes = artifacts
      .filter(
        (a) =>
          (a.kind === 'decision' || a.kind === 'action_item') &&
          inProject(a) &&
          a.occurred_at < now.toISOString(),
      )
      .filter(
        (a) =>
          Math.abs(Date.parse(a.occurred_at) - Date.parse(lastMeeting.occurred_at)) < 6 * 3_600_000,
      )
      .sort(byTimeAsc);
    for (const o of outcomes.slice(0, 5)) {
      const label = o.kind === 'decision' ? '決定' : 'やること';
      const text = o.semantic?.request ?? o.title;
      previous.push(
        item(`${label}: ${text}${o.completed === true ? '（済）' : ''}`, [o.provenance]),
      );
    }
  }

  // その後のメール（前回の会議より後、無ければ 7 日）
  const sinceIso = lastMeeting
    ? lastMeeting.occurred_at
    : new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const mails = artifacts
    .filter(
      (a) =>
        a.kind === 'email' &&
        inProject(a) &&
        a.occurred_at > sinceIso &&
        a.occurred_at <= now.toISOString(),
    )
    .sort(byTimeAsc);
  const since: BriefFact[] = [];
  const inbound = mails.filter((m) => m.direction === 'inbound');
  if (inbound.length > 0) {
    since.push(
      item(
        `${inbound.length} 件のメールが届いています`,
        inbound.slice(-3).map((m) => m.provenance),
      ),
    );
  }
  const asks = inbound.filter(
    (m) =>
      m.semantic &&
      ['request_to_me', 'question', 'approval_pending', 'scheduling'].includes(m.semantic.category),
  );
  for (const m of asks.slice(-3))
    since.push(
      item(
        `${m.people.find((p) => p.role === 'from')?.name ?? '相手'}: ${m.semantic?.request ?? m.title}`,
        [m.provenance],
      ),
    );

  // 開いている件（この案件だけ）
  const open: BriefFact[] = [];
  for (const o of context.owed
    .filter((o) => project !== null && o.project === project.name)
    .slice(0, 3)) {
    open.push(
      item(
        `${o.to} に返す: ${o.what}${o.due_at ? `（期限 ${o.due_at.slice(0, 10)}）` : ''}`,
        o.sources,
      ),
    );
  }
  for (const w of context.waiting_on
    .filter((w) => project !== null && w.project === project.name)
    .slice(0, 3)) {
    open.push(
      item(
        `${w.who} からの返事待ち: ${w.what}（${String(Math.round(w.since_days))} 日）`,
        w.sources,
      ),
    );
  }

  // 確かめたいこと（規則）。理由と出所を持つ。開いている件が無ければ作らない。
  const questions: SuggestedQuestion[] = [];
  for (const w of context.waiting_on.filter(
    (w) => project !== null && w.project === project.name,
  )) {
    questions.push({
      question: `${w.what}は、その後いかがでしょうか？`,
      reason: `${w.who} からの返事を ${String(Math.round(w.since_days))} 日待っており、確定の連絡がありません`,
      sources: w.sources,
      extracted_by: 'rule',
    });
  }
  for (const o of context.owed.filter((o) => project !== null && o.project === project.name)) {
    questions.push({
      question: `${o.what}について、条件や懸念はありますか？`,
      reason: `${o.to} に返すものが残っています${o.due_at ? `（期限 ${o.due_at.slice(0, 10)}）` : ''}`,
      sources: o.sources,
      extracted_by: 'rule',
    });
  }
  for (const a of artifacts
    .filter((a) => a.kind === 'action_item' && inProject(a) && a.completed !== true)
    .slice(0, 2)) {
    if (questions.length >= 3) break;
    questions.push({
      question: `「${a.semantic?.request ?? a.title}」は進んでいますか？`,
      reason: '前回の会議のやることで、完了の記録がありません',
      sources: [a.provenance],
      extracted_by: 'rule',
    });
  }

  const provenance: Provenance[] = [
    event.provenance,
    ...previous.flatMap((p) => p.sources),
    ...since.flatMap((s) => s.sources),
    ...open.flatMap((o) => o.sources),
  ];
  const seen = new Set<string>();
  const dedup = provenance.filter((p) => {
    const k = `${p.source}:${p.external_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    event_id: event.id,
    title: event.title,
    starts_at: event.occurred_at,
    project: project?.name ?? null,
    previous: previous.slice(0, 6),
    since_last_meeting: since.slice(0, 6),
    open_items: open.slice(0, 6),
    suggested_questions: questions.slice(0, 3),
    provenance: dedup,
    generated_at: now.toISOString(),
  };
}
