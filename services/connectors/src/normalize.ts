/**
 * 各サービスの生データ → `WorkArtifact`。Work Context 仕様 §正規化。
 *
 * ここで Google / Microsoft の差が消える。上の層（Work Graph・端末の LLM）は
 * どのサービスから来たかを気にしない。
 *
 * 守ること:
 *   - **全文を持たない。**抜粋は 500 字、出所の excerpt は 200 字まで
 *   - 判断しない。「依頼か」「急ぎか」は付けない（semantic は null のまま）
 *   - 出所（Provenance）を必ず付ける。付けられないものは出さない
 */
import type { PersonRef, WorkArtifact } from '@astra/contracts';
import type { CalendarEvent } from './calendar.js';
import type { MailSummary } from './gmail.js';
import type { OutlookEvent, OutlookMailSummary, OutlookRecipient, TodoTask } from './microsoft.js';

export const EXCERPT_CHARS = 500;
export const PROVENANCE_EXCERPT_CHARS = 200;

const UNTITLED = '(件名なし)';

/**
 * 契約の Timestamp は UTC の ISO（`Z`）。Google は `+09:00` 付きで返すことがあるので、
 * ここで揃える。読めない時刻は null にして、偽の時刻を作らない。
 */
export function isoUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function excerpt(text: string, limit: number): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return null;
  return flat.length > limit ? flat.slice(0, limit) : flat;
}

/** `"Name" <addr>` / `Name <addr>` / `addr` を name と email に分ける。 */
export function parseAddress(value: string): { name: string; email: string | null } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (m) {
    const email = m[2]!.trim();
    const name = (m[1] ?? '').trim();
    return { name: name || email, email };
  }
  const bare = value.trim();
  if (!bare) return { name: '', email: null };
  return bare.includes('@') ? { name: bare, email: bare } : { name: bare, email: null };
}

function person(value: string, role: PersonRef['role']): PersonRef | null {
  const { name, email } = parseAddress(value);
  if (!name) return null;
  return { name: name.slice(0, 200), email, role };
}

function outlookPerson(r: OutlookRecipient | null, role: PersonRef['role']): PersonRef | null {
  if (!r) return null;
  const name = r.name || r.address;
  if (!name) return null;
  return { name: name.slice(0, 200), email: r.address || null, role };
}

function compact<T>(items: readonly (T | null)[]): T[] {
  return items.filter((x): x is T => x !== null);
}

export interface NormalizeContext {
  /** 取り込んだ時刻（出所の observed_at）。 */
  readonly observedAt: string;
}

// ------------------------------------------------------------------ Gmail

/**
 * Gmail の 1 通。`direction` は呼ぶ側が知っている（INBOX から来たか SENT から来たか）。
 * 一覧は差出人と件名と snippet しか持たない。**本文は取りに行かない。**
 */
export function fromGmail(
  mail: MailSummary,
  direction: 'inbound' | 'outbound',
  ctx: NormalizeContext,
): WorkArtifact | null {
  if (!mail.id) return null;
  const occurred = isoUtc(mail.receivedAt) ?? ctx.observedAt;
  const title = mail.subject.trim() || UNTITLED;
  return {
    id: `gmail:${mail.id}`,
    source: 'gmail',
    kind: 'email',
    title: title.slice(0, 500),
    body_excerpt: excerpt(mail.snippet, EXCERPT_CHARS),
    people: compact([person(mail.from, 'from'), ...mail.to.map((t) => person(t, 'to'))]),
    direction,
    occurred_at: occurred,
    ends_at: null,
    due_at: null,
    thread_id: mail.threadId ? `gmail:${mail.threadId}` : null,
    project_hint: null,
    responded: null,
    completed: null,
    provenance: {
      source: 'gmail',
      external_id: mail.id,
      label: title.slice(0, 200),
      observed_at: ctx.observedAt,
      url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(mail.threadId || mail.id)}`,
      excerpt: excerpt(mail.snippet, PROVENANCE_EXCERPT_CHARS),
    },
    semantic: null,
  };
}

// -------------------------------------------------------- Google Calendar

function calendarStart(part: CalendarEvent['start']): string | null {
  if (part.dateTime) return isoUtc(part.dateTime);
  if (part.date) return `${part.date}T00:00:00.000Z`;
  return null;
}

export function fromGoogleCalendar(
  event: CalendarEvent,
  ctx: NormalizeContext,
): WorkArtifact | null {
  if (!event.id || event.status === 'cancelled') return null;
  const start = calendarStart(event.start);
  if (!start) return null;
  const title = event.title.trim() || '(タイトルなし)';
  return {
    id: `google_calendar:${event.id}`,
    source: 'google_calendar',
    kind: 'calendar_event',
    title: title.slice(0, 500),
    body_excerpt: excerpt(event.description ?? '', EXCERPT_CHARS),
    people: compact(
      event.attendees.map((a) =>
        a.email ? person(a.email, a.organizer ? 'organizer' : 'attendee') : null,
      ),
    ),
    direction: 'self',
    occurred_at: start,
    ends_at: calendarStart(event.end),
    due_at: null,
    thread_id: null,
    project_hint: null,
    responded: null,
    completed: null,
    provenance: {
      source: 'google_calendar',
      external_id: event.id,
      label: title.slice(0, 200),
      observed_at: ctx.observedAt,
      url: event.htmlLink,
      excerpt: excerpt(event.description ?? '', PROVENANCE_EXCERPT_CHARS),
    },
    semantic: null,
  };
}

// ---------------------------------------------------------------- Outlook

export function fromOutlookMail(
  mail: OutlookMailSummary,
  ctx: NormalizeContext,
): WorkArtifact | null {
  if (!mail.id) return null;
  const direction = mail.folder === 'sentitems' ? 'outbound' : 'inbound';
  const occurred =
    isoUtc(direction === 'outbound' ? mail.sentAt : mail.receivedAt) ??
    isoUtc(mail.receivedAt) ??
    isoUtc(mail.sentAt) ??
    ctx.observedAt;
  const title = mail.subject.trim() || UNTITLED;
  return {
    id: `outlook_mail:${mail.id}`,
    source: 'outlook_mail',
    kind: 'email',
    title: title.slice(0, 500),
    body_excerpt: excerpt(mail.preview, EXCERPT_CHARS),
    people: compact([
      outlookPerson(mail.from, 'from'),
      ...mail.to.map((t) => outlookPerson(t, 'to')),
      ...mail.cc.map((t) => outlookPerson(t, 'cc')),
    ]),
    direction,
    occurred_at: occurred,
    ends_at: null,
    due_at: null,
    thread_id: mail.conversationId ? `outlook_mail:${mail.conversationId}` : null,
    project_hint: null,
    responded: null,
    completed: null,
    provenance: {
      source: 'outlook_mail',
      external_id: mail.id,
      label: title.slice(0, 200),
      observed_at: ctx.observedAt,
      url: mail.webLink,
      excerpt: excerpt(mail.preview, PROVENANCE_EXCERPT_CHARS),
    },
    semantic: null,
  };
}

function outlookStart(part: OutlookEvent['start']): string | null {
  if (part.dateTime) return isoUtc(part.dateTime);
  if (part.date) return `${part.date}T00:00:00.000Z`;
  return null;
}

export function fromOutlookCalendar(
  event: OutlookEvent,
  ctx: NormalizeContext,
): WorkArtifact | null {
  if (!event.id || event.isCancelled) return null;
  const start = outlookStart(event.start);
  if (!start) return null;
  const title = event.title.trim() || '(タイトルなし)';
  return {
    id: `outlook_calendar:${event.id}`,
    source: 'outlook_calendar',
    kind: 'calendar_event',
    title: title.slice(0, 500),
    body_excerpt: excerpt(event.preview, EXCERPT_CHARS),
    people: compact([
      outlookPerson(event.organizer, 'organizer'),
      ...event.attendees.map((a) =>
        outlookPerson({ name: a.name, address: a.address }, 'attendee'),
      ),
    ]),
    direction: 'self',
    occurred_at: start,
    ends_at: outlookStart(event.end),
    due_at: null,
    thread_id: null,
    project_hint: null,
    responded: null,
    completed: null,
    provenance: {
      source: 'outlook_calendar',
      external_id: event.id,
      label: title.slice(0, 200),
      observed_at: ctx.observedAt,
      url: event.webLink,
      excerpt: excerpt(event.preview, PROVENANCE_EXCERPT_CHARS),
    },
    semantic: null,
  };
}

/** 既定の一覧名。案件名として使わない。 */
const DEFAULT_LIST_NAMES = new Set([
  'tasks',
  'タスク',
  'to do',
  'flagged emails',
  'フラグ付きメール',
]);

export function fromTodo(task: TodoTask, ctx: NormalizeContext): WorkArtifact | null {
  if (!task.id) return null;
  const title = task.title.trim();
  if (!title) return null;
  const listName = task.listName.trim();
  const project = listName && !DEFAULT_LIST_NAMES.has(listName.toLowerCase()) ? listName : null;
  return {
    id: `microsoft_todo:${task.id}`,
    source: 'microsoft_todo',
    kind: 'task',
    title: title.slice(0, 500),
    body_excerpt: excerpt(task.preview, EXCERPT_CHARS),
    people: [],
    direction: 'self',
    occurred_at: isoUtc(task.lastModifiedAt) ?? isoUtc(task.createdAt) ?? ctx.observedAt,
    ends_at: null,
    due_at: isoUtc(task.dueAt),
    thread_id: null,
    project_hint: project ? project.slice(0, 200) : null,
    responded: null,
    completed: task.status === 'completed',
    provenance: {
      source: 'microsoft_todo',
      external_id: task.id,
      label: title.slice(0, 200),
      observed_at: ctx.observedAt,
      url: null,
      excerpt: excerpt(task.preview, PROVENANCE_EXCERPT_CHARS),
    },
    semantic: null,
  };
}
