/**
 * イベント列への追記。実装仕様 §7.2。
 *
 * 契約は「stream 内で 1 始まり・欠番なし・単調増加」。これはクライアントの
 * 取りこぼし検知に使われるので緩めない。
 */
import { sql } from 'kysely';
import { EventEnvelope, uuidv7, type EventType, type StreamKind } from '@astra/contracts';
import type { ScopedDb } from '@astra/db';

/** イベントを購読者へ配る先。Redis pub/sub か、テストの no-op。 */
export interface EventPublisher {
  publish(channel: string, payload: string): Promise<void>;
}

export const NoopPublisher: EventPublisher = {
  async publish() {
    /* テストと単一プロセス構成では配信不要 */
  },
};

export function channelFor(streamKind: StreamKind, streamId: string): string {
  return `astra:stream:${streamKind}:${streamId}`;
}

export interface AppendEventInput {
  readonly tenantId: string;
  readonly streamKind: StreamKind;
  readonly streamId: string;
  readonly type: EventType;
  readonly payload: unknown;
  readonly taskId?: string | null;
  readonly conversationId?: string | null;
  /** activity 再実行時の二重発火を防ぐ。`<taskId>:<stepIndex>:<name>` の形。 */
  readonly idempotencyKey?: string | undefined;
}

export async function ensureStream(
  tx: ScopedDb,
  tenantId: string,
  streamKind: StreamKind,
  streamId: string,
): Promise<void> {
  await sql`
    insert into event_streams (stream_kind, stream_id, tenant_id)
    values (${streamKind}, ${streamId}, ${tenantId})
    on conflict (stream_kind, stream_id) do nothing
  `.execute(tx);
}

/**
 * 追記する。冪等キー付きで既に存在すれば、**採番せずに**既存イベントを返す。
 *
 * 「採番してから ON CONFLICT DO NOTHING」にすると、衝突のたびに番号が 1 つ捨てられて
 * 欠番になる。欠番なしは契約なので、存在確認を先に行う。
 */
export async function appendEvent(
  tx: ScopedDb,
  input: AppendEventInput,
  publisher: EventPublisher = NoopPublisher,
): Promise<EventEnvelope> {
  await ensureStream(tx, input.tenantId, input.streamKind, input.streamId);

  if (input.idempotencyKey !== undefined) {
    const existing = await tx
      .selectFrom('task_events')
      .select(['event_id', 'sequence', 'type', 'payload', 'created_at'])
      .where('stream_kind', '=', input.streamKind)
      .where('stream_id', '=', input.streamId)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();
    if (existing) {
      return buildEnvelope(
        input,
        Number(existing.sequence),
        existing.event_id,
        existing.created_at,
      );
    }
  }

  const allocated = await sql<{ seq: string }>`
    update event_streams set next_seq = next_seq + 1
     where stream_kind = ${input.streamKind} and stream_id = ${input.streamId}
     returning (next_seq - 1)::text as seq
  `.execute(tx);
  const sequence = Number(allocated.rows[0]?.seq ?? '0');
  if (sequence < 1) throw new Error(`failed to allocate a sequence for ${input.streamId}`);

  const eventId = uuidv7();
  const createdAt = new Date();

  await tx
    .insertInto('task_events')
    .values({
      event_id: eventId,
      tenant_id: input.tenantId,
      stream_kind: input.streamKind,
      stream_id: input.streamId,
      sequence: String(sequence),
      type: input.type,
      task_id: input.taskId ?? null,
      conversation_id: input.conversationId ?? null,
      payload: JSON.stringify(input.payload),
      idempotency_key: input.idempotencyKey ?? null,
      created_at: createdAt,
    })
    .execute();

  const envelope = buildEnvelope(input, sequence, eventId, createdAt);
  await publisher.publish(channelFor(input.streamKind, input.streamId), JSON.stringify(envelope));
  return envelope;
}

function buildEnvelope(
  input: AppendEventInput,
  sequence: number,
  eventId: string,
  createdAt: Date,
): EventEnvelope {
  return EventEnvelope.parse({
    event_id: eventId,
    type: input.type,
    timestamp: createdAt.toISOString(),
    tenant_id: input.tenantId,
    stream_kind: input.streamKind,
    stream_id: input.streamId,
    sequence,
    ...(input.taskId ? { task_id: input.taskId } : {}),
    ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
    payload: input.payload,
  });
}

/** `sequence > after` を昇順で読み出す。SSE のリプレイ（実装仕様 §7.3）で使う。 */
export async function readEventsAfter(
  tx: ScopedDb,
  streamKind: StreamKind,
  streamId: string,
  after: number,
  limit = 1000,
): Promise<EventEnvelope[]> {
  const rows = await sql<{
    event_id: string;
    seq_text: string;
    type: string;
    task_id: string | null;
    conversation_id: string | null;
    payload: unknown;
    tenant_id: string;
    created_at: Date;
  }>`
    select event_id, sequence::text as seq_text, type, task_id, conversation_id,
           payload, tenant_id, created_at
      from task_events
     where stream_kind = ${streamKind} and stream_id = ${streamId}
       and sequence > ${after}
     order by task_events.sequence asc
     limit ${limit}
  `.execute(tx);

  return rows.rows.map((r) =>
    EventEnvelope.parse({
      event_id: r.event_id,
      type: r.type,
      timestamp: r.created_at.toISOString(),
      tenant_id: r.tenant_id,
      stream_kind: streamKind,
      stream_id: streamId,
      sequence: Number(r.seq_text),
      ...(r.task_id ? { task_id: r.task_id } : {}),
      ...(r.conversation_id ? { conversation_id: r.conversation_id } : {}),
      payload: r.payload,
    }),
  );
}
