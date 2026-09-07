/**
 * 生データ → WorkArtifact。
 *
 * 見るのは:
 *   - 契約（zod）を通る形になっている
 *   - 全文を持たない（抜粋 500 字 / 出所 200 字）
 *   - 判断しない（semantic は null）
 *   - 向きと id とスレッドが正しい
 */
import { describe, expect, it } from 'vitest';
import { WorkArtifact } from '@astra/contracts';
import {
  fromGmail,
  fromGoogleCalendar,
  fromOutlookCalendar,
  fromOutlookMail,
  fromTodo,
  parseAddress,
} from '../src/normalize.js';
import type { MailSummary } from '../src/gmail.js';
import type { CalendarEvent } from '../src/calendar.js';
import type { OutlookEvent, OutlookMailSummary, TodoTask } from '../src/microsoft.js';

const ctx = { observedAt: '2026-09-07T06:00:00.000Z' };

const gmail: MailSummary = {
  id: 'm1',
  threadId: 't1',
  from: '"田中 太郎" <tanaka@example.com>',
  to: ['me@example.com'],
  subject: 'Re: MOPITA 見積の確認',
  snippet: '来週水曜までにご確認いただけますか'.repeat(40),
  receivedAt: '2026-09-07T01:00:00.000Z',
  unread: true,
  hasAttachments: false,
};

describe('parseAddress', () => {
  it('splits name and address in the common forms', () => {
    expect(parseAddress('"田中 太郎" <tanaka@example.com>')).toEqual({
      name: '田中 太郎',
      email: 'tanaka@example.com',
    });
    expect(parseAddress('Tanaka <tanaka@example.com>')).toEqual({
      name: 'Tanaka',
      email: 'tanaka@example.com',
    });
    expect(parseAddress('tanaka@example.com')).toEqual({
      name: 'tanaka@example.com',
      email: 'tanaka@example.com',
    });
    expect(parseAddress('')).toEqual({ name: '', email: null });
  });
});

describe('fromGmail', () => {
  it('produces a contract-valid artifact with an excerpt, never the full text', () => {
    const art = fromGmail(gmail, 'inbound', ctx)!;
    expect(() => WorkArtifact.parse(art)).not.toThrow();
    expect(art.id).toBe('gmail:m1');
    expect(art.thread_id).toBe('gmail:t1');
    expect(art.direction).toBe('inbound');
    expect(art.body_excerpt!.length).toBe(500);
    expect(art.provenance.excerpt!.length).toBe(200);
    expect(art.provenance.external_id).toBe('m1');
    expect(art.provenance.url).toContain('t1');
    expect(art.people).toEqual([
      { name: '田中 太郎', email: 'tanaka@example.com', role: 'from' },
      { name: 'me@example.com', email: 'me@example.com', role: 'to' },
    ]);
    // 判断しない。付けるのは上の層。
    expect(art.semantic).toBeNull();
    expect(art.responded).toBeNull();
  });

  it('marks what was sent as outbound and falls back for an empty subject', () => {
    const art = fromGmail({ ...gmail, subject: '   ', receivedAt: null }, 'outbound', ctx)!;
    expect(art.direction).toBe('outbound');
    expect(art.title).toBe('(件名なし)');
    expect(art.occurred_at).toBe(ctx.observedAt);
  });
});

describe('fromGoogleCalendar', () => {
  const event: CalendarEvent = {
    id: 'e1',
    title: 'MOPITA 定例',
    description: null,
    location: null,
    start: { dateTime: '2026-09-08T01:00:00+09:00', date: null, timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-08T02:00:00+09:00', date: null, timeZone: 'Asia/Tokyo' },
    attendees: [
      { email: 'sato@example.com', responseStatus: 'accepted', organizer: true },
      { email: 'me@example.com', responseStatus: 'needsAction', organizer: false },
    ],
    organizerEmail: 'sato@example.com',
    status: 'confirmed',
    htmlLink: 'https://calendar.google.com/event?eid=e1',
    conferenceUri: null,
  };

  it('keeps start/end and attendee roles', () => {
    const art = fromGoogleCalendar(event, ctx)!;
    expect(() => WorkArtifact.parse(art)).not.toThrow();
    expect(art.kind).toBe('calendar_event');
    // +09:00 は UTC に揃える（契約の Timestamp は Z）
    expect(art.occurred_at).toBe('2026-09-07T16:00:00.000Z');
    expect(art.ends_at).toBe('2026-09-07T17:00:00.000Z');
    expect(art.people.map((p) => p.role)).toEqual(['organizer', 'attendee']);
    expect(art.provenance.url).toBe('https://calendar.google.com/event?eid=e1');
  });

  it('turns an all-day event into a date and drops cancelled ones', () => {
    const allDay = fromGoogleCalendar(
      {
        ...event,
        start: { dateTime: null, date: '2026-09-10', timeZone: null },
        end: { dateTime: null, date: '2026-09-11', timeZone: null },
      },
      ctx,
    )!;
    expect(allDay.occurred_at).toBe('2026-09-10T00:00:00.000Z');
    expect(fromGoogleCalendar({ ...event, status: 'cancelled' }, ctx)).toBeNull();
  });
});

describe('fromOutlookMail', () => {
  const mail: OutlookMailSummary = {
    id: 'AAMk1',
    conversationId: 'AAQk1',
    from: { name: '田中 太郎', address: 'tanaka@example.com' },
    to: [{ name: 'me', address: 'me@example.com' }],
    cc: [{ name: '佐藤', address: 'sato@example.com' }],
    subject: '見積の確認',
    preview: '来週水曜までに',
    receivedAt: '2026-09-07T01:00:00Z',
    sentAt: '2026-09-07T00:59:00Z',
    unread: true,
    hasAttachments: false,
    webLink: 'https://outlook.office.com/mail/id/AAMk1',
    folder: 'inbox',
  };

  it('uses the folder to decide the direction and the conversation as the thread', () => {
    const inbound = fromOutlookMail(mail, ctx)!;
    expect(() => WorkArtifact.parse(inbound)).not.toThrow();
    expect(inbound.id).toBe('outlook_mail:AAMk1');
    expect(inbound.direction).toBe('inbound');
    expect(inbound.thread_id).toBe('outlook_mail:AAQk1');
    expect(inbound.occurred_at).toBe('2026-09-07T01:00:00.000Z');
    expect(inbound.people.map((p) => p.role)).toEqual(['from', 'to', 'cc']);

    const outbound = fromOutlookMail({ ...mail, folder: 'sentitems' }, ctx)!;
    expect(outbound.direction).toBe('outbound');
    expect(outbound.occurred_at).toBe('2026-09-07T00:59:00.000Z');
  });
});

describe('fromOutlookCalendar', () => {
  const event: OutlookEvent = {
    id: 'ev1',
    title: '',
    preview: '',
    location: null,
    start: { dateTime: '2026-09-08T01:00:00.000Z', date: null, timeZone: 'UTC' },
    end: { dateTime: '2026-09-08T02:00:00.000Z', date: null, timeZone: 'UTC' },
    attendees: [
      { name: '佐藤', address: 'sato@example.com', responseStatus: 'accepted', type: 'required' },
    ],
    organizer: { name: '鈴木', address: 'suzuki@example.com' },
    isOrganizer: false,
    isCancelled: false,
    webLink: null,
    onlineMeetingUrl: null,
  };

  it('is contract-valid even without a title, and skips cancellations', () => {
    const art = fromOutlookCalendar(event, ctx)!;
    expect(() => WorkArtifact.parse(art)).not.toThrow();
    expect(art.title).toBe('(タイトルなし)');
    expect(art.people).toEqual([
      { name: '鈴木', email: 'suzuki@example.com', role: 'organizer' },
      { name: '佐藤', email: 'sato@example.com', role: 'attendee' },
    ]);
    expect(fromOutlookCalendar({ ...event, isCancelled: true }, ctx)).toBeNull();
  });
});

describe('fromTodo', () => {
  const task: TodoTask = {
    id: 't1',
    listId: 'L2',
    listName: 'MOPITA',
    title: '要件定義書レビュー',
    preview: '',
    status: 'notStarted',
    importance: 'high',
    dueAt: '2026-09-09T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00Z',
    lastModifiedAt: '2026-09-06T00:00:00Z',
    completedAt: null,
  };

  it('uses a named list as the project hint and carries the due date', () => {
    const art = fromTodo(task, ctx)!;
    expect(() => WorkArtifact.parse(art)).not.toThrow();
    expect(art.kind).toBe('task');
    expect(art.project_hint).toBe('MOPITA');
    expect(art.due_at).toBe('2026-09-09T00:00:00.000Z');
    expect(art.completed).toBe(false);
    expect(art.occurred_at).toBe('2026-09-06T00:00:00.000Z');
  });

  it('does not treat the default list as a project, and marks completion', () => {
    const art = fromTodo({ ...task, listName: 'Tasks', status: 'completed' }, ctx)!;
    expect(art.project_hint).toBeNull();
    expect(art.completed).toBe(true);
    expect(fromTodo({ ...task, title: '  ' }, ctx)).toBeNull();
  });
});
