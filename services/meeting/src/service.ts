/**
 * 会議のセッション。正本 §11・§13、Phase 3 実装仕様 §3。
 *
 * 状態はすべて DB に置く。live の STT は落ちるものなので、
 * プロセスのメモリに transcript を溜めると、落ちた瞬間に消える。
 */
import {
  AstraError,
  MeetingBundle,
  uuidv7,
  type AudioSource,
  type Meeting,
  type MeetingSegment,
  type MeetingSpeaker,
  type MeetingStatus,
  type TranscriptPass,
} from '@astra/contracts';
import { withTenant, type DbHandle, type ScopedDb } from '@astra/db';
import {
  appendEvent,
  ensureStream,
  readEventsAfter,
  type EventPublisher,
} from '@astra/service-task';
import { alignSpeakers, stabilize, supersededBy, type StableSegment } from './stabilize.js';
import type { TranscriptResult, TranslationProvider } from './providers.js';

export interface MeetingDeps {
  readonly db: DbHandle;
  readonly publisher: EventPublisher;
  readonly translator?: TranslationProvider;
  readonly now?: () => Date;
}

export interface StartMeetingInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly title: string;
  readonly language: string;
  readonly targetLanguage: string | null;
  readonly audioSources: readonly AudioSource[];
}

export class MeetingService {
  readonly #db: DbHandle;
  readonly #publisher: EventPublisher;
  readonly #translator: TranslationProvider | undefined;
  readonly #now: () => Date;

  constructor(deps: MeetingDeps) {
    this.#db = deps.db;
    this.#publisher = deps.publisher;
    this.#translator = deps.translator;
    this.#now = deps.now ?? (() => new Date());
  }

  /** 会議を始める。同意の確認は呼び出し側（HTTP 層）が済ませている前提。 */
  async start(input: StartMeetingInput): Promise<Meeting> {
    const id = uuidv7();
    const at = this.#now();

    return withTenant(this.#db, input.tenantId, async (tx) => {
      const row = await tx
        .insertInto('meetings')
        .values({
          id,
          tenant_id: input.tenantId,
          title: input.title,
          status: 'RECORDING',
          language: input.language,
          target_language: input.targetLanguage,
          audio_sources: [...input.audioSources],
          consent_at: at,
          started_at: at,
          created_by: input.userId,
          created_at: at,
          updated_at: at,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // transcript のイベント列。SSE はこれをそのまま読む。
      await ensureStream(tx, input.tenantId, 'meeting', id);
      return toMeeting(row);
    });
  }

  async get(tenantId: string, meetingId: string): Promise<Meeting> {
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx.selectFrom('meetings').selectAll().where('id', '=', meetingId).executeTakeFirst(),
    );
    // 別テナントの会議は「無い」。あることを教えない（AC3-12）。
    if (!row) throw new AstraError('meeting.not_found', 'meeting not found');
    return toMeeting(row);
  }

  async list(tenantId: string, limit = 50): Promise<readonly Meeting[]> {
    const rows = await withTenant(this.#db, tenantId, (tx) =>
      tx.selectFrom('meetings').selectAll().orderBy('started_at', 'desc').limit(limit).execute(),
    );
    return rows.map(toMeeting);
  }

  /**
   * provider から来た結果を捌く。
   *
   * interim はイベントとしてだけ流し、確定だけを保存する（D-24）。
   * 戻り値は「保存した確定 segment」。
   */
  async ingest(
    tenantId: string,
    meetingId: string,
    results: readonly TranscriptResult[],
  ): Promise<readonly MeetingSegment[]> {
    for (const partial of results.filter((r) => !r.isFinal)) {
      await this.#emit(tenantId, meetingId, 'meeting.transcript.partial', {
        // 保存しないので id は使い捨て。UI は差し替えに使うだけ。
        segment_id: `partial:${partial.startMs}`,
        speaker_tag: partial.speakerTag,
        text: partial.text,
        start_ms: partial.startMs,
        end_ms: partial.endMs,
        language: partial.language,
      });
    }

    const stable = stabilize(results);
    const saved: MeetingSegment[] = [];
    for (const segment of stable) {
      const row = await this.#appendSegment(tenantId, meetingId, 'live', segment, []);
      if (row) saved.push(row);
    }
    return saved;
  }

  /** STT が落ちた。**録音は続く**ので会議は終わらせない（AC3-11）。 */
  async markDegraded(tenantId: string, meetingId: string): Promise<void> {
    await withTenant(this.#db, tenantId, (tx) =>
      tx
        .updateTable('meetings')
        .set({ degraded_at: this.#now(), updated_at: this.#now() })
        .where('id', '=', meetingId)
        .where('degraded_at', 'is', null)
        .execute(),
    );
  }

  async setStatus(tenantId: string, meetingId: string, status: MeetingStatus): Promise<void> {
    const at = this.#now();
    const ending = status === 'COMPLETE' || status === 'FAILED';

    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .updateTable('meetings')
        .set({ status, updated_at: at, ...(ending ? { ended_at: at } : {}) })
        .where('id', '=', meetingId)
        .returning(['finalize_task_id'])
        .executeTakeFirst(),
    );

    // 終端イベント。これを出さないと、終わった会議の SSE が開いたままになる。
    if (ending && row) {
      await this.#emit(tenantId, meetingId, 'meeting.ended', {
        status,
        finalize_task_id: row.finalize_task_id,
      });
    }
  }

  async segments(
    tenantId: string,
    meetingId: string,
    pass?: TranscriptPass,
  ): Promise<readonly MeetingSegment[]> {
    const rows = await withTenant(this.#db, tenantId, async (tx) => {
      // pass 指定が無ければ final を見せ、無ければ live に落ちる。
      const wanted = pass ?? ((await this.#hasFinal(tx, meetingId)) ? 'final' : 'live');
      return tx
        .selectFrom('meeting_segments')
        .selectAll()
        .where('meeting_id', '=', meetingId)
        .where('pass', '=', wanted)
        .orderBy('start_ms')
        .execute();
    });
    return rows.map(toSegment);
  }

  /** speaker_tag に名前を付ける。会議の中だけの対応（D-27）。 */
  async nameSpeaker(
    tenantId: string,
    meetingId: string,
    userId: string,
    speakerTag: number,
    displayName: string,
  ): Promise<MeetingSpeaker> {
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .insertInto('meeting_speakers')
        .values({
          tenant_id: tenantId,
          meeting_id: meetingId,
          speaker_tag: speakerTag,
          display_name: displayName,
          named_by: userId,
          created_at: this.#now(),
        })
        // 付け直しは上書き。会議中に何度でも直せる。
        .onConflict((oc) =>
          oc.columns(['meeting_id', 'speaker_tag']).doUpdateSet({
            display_name: displayName,
            named_by: userId,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    return {
      meeting_id: row.meeting_id,
      speaker_tag: row.speaker_tag,
      display_name: row.display_name,
      named_by: row.named_by,
      created_at: row.created_at.toISOString(),
    } as MeetingSpeaker;
  }

  async speakers(tenantId: string, meetingId: string): Promise<readonly MeetingSpeaker[]> {
    const rows = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('meeting_speakers')
        .selectAll()
        .where('meeting_id', '=', meetingId)
        .orderBy('speaker_tag')
        .execute(),
    );
    return rows.map((row) => ({
      meeting_id: row.meeting_id,
      speaker_tag: row.speaker_tag,
      display_name: row.display_name,
      named_by: row.named_by,
      created_at: row.created_at.toISOString(),
    })) as MeetingSpeaker[];
  }

  /**
   * 確定 segment を訳す。**interim は訳さない**（画面が揺れる。D-26）。
   * 同じ segment を二度訳しても増えない。
   */
  async translate(
    tenantId: string,
    meetingId: string,
    segment: MeetingSegment,
    targetLanguage: string,
  ): Promise<string | null> {
    if (!this.#translator) return null;
    const text = await this.#translator.translate(
      segment.text,
      segment.language ?? 'auto',
      targetLanguage,
    );

    await withTenant(this.#db, tenantId, (tx) =>
      tx
        .insertInto('translations')
        .values({
          segment_id: segment.id,
          tenant_id: tenantId,
          meeting_id: meetingId,
          target_language: targetLanguage,
          text,
          created_at: this.#now(),
        })
        .onConflict((oc) => oc.columns(['segment_id', 'target_language']).doNothing())
        .execute(),
    );

    await this.#emit(tenantId, meetingId, 'meeting.translation.final', {
      segment_id: segment.id,
      target_language: targetLanguage,
      text,
    });
    return text;
  }

  /**
   * 最終パスの結果を積む。**live 行は触らない**（D-25）。
   * どの live を置き換えたかは final 側にだけ持つ。
   */
  async applyFinalPass(
    tenantId: string,
    meetingId: string,
    results: readonly TranscriptResult[],
  ): Promise<readonly MeetingSegment[]> {
    const live = await this.segments(tenantId, meetingId, 'live');
    const stable = stabilize(results);

    // 話者番号は provider ごとに違う。時間で対応を取る。
    const mapping = alignSpeakers(
      live.map((s) => ({ id: s.id, speakerTag: s.speaker_tag, ...msOf(s) })),
      stable.map((s, i) => ({ id: String(i), speakerTag: s.speakerTag, ...msOf(s) })),
    );

    const saved: MeetingSegment[] = [];
    for (const segment of stable) {
      const covered = supersededBy(
        { id: 'final', speakerTag: segment.speakerTag, ...msOf(segment) },
        live.map((s) => ({ id: s.id, speakerTag: s.speaker_tag, ...msOf(s) })),
      );
      const liveTag =
        segment.speakerTag === null
          ? null
          : (mapping.get(segment.speakerTag) ?? segment.speakerTag);
      const row = await this.#appendSegment(
        tenantId,
        meetingId,
        'final',
        { ...segment, speakerTag: liveTag },
        covered,
      );
      if (row) saved.push(row);
    }
    return saved;
  }

  async recordBundle(
    tenantId: string,
    meetingId: string,
    fields: {
      readonly recordingArtifactId?: string;
      readonly bundleArtifactId?: string;
      readonly finalizeTaskId?: string;
    },
  ): Promise<void> {
    await withTenant(this.#db, tenantId, (tx) =>
      tx
        .updateTable('meetings')
        .set({
          updated_at: this.#now(),
          ...(fields.recordingArtifactId
            ? { recording_artifact_id: fields.recordingArtifactId }
            : {}),
          ...(fields.bundleArtifactId ? { bundle_artifact_id: fields.bundleArtifactId } : {}),
          ...(fields.finalizeTaskId ? { finalize_task_id: fields.finalizeTaskId } : {}),
        })
        .where('id', '=', meetingId)
        .execute(),
    );
  }

  /** SSE のリプレイ。会議が無ければ 404 にしてから読む。 */
  async eventsAfter(tenantId: string, meetingId: string, after: number) {
    await this.get(tenantId, meetingId);
    return withTenant(this.#db, tenantId, (tx) => readEventsAfter(tx, 'meeting', meetingId, after));
  }

  // ------------------------------------------------------------- internals

  async #appendSegment(
    tenantId: string,
    meetingId: string,
    pass: TranscriptPass,
    segment: StableSegment,
    supersedes: readonly string[],
  ): Promise<MeetingSegment | null> {
    const id = uuidv7();
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .insertInto('meeting_segments')
        .values({
          id,
          tenant_id: tenantId,
          meeting_id: meetingId,
          pass,
          // 出所は一次情報。**保存の時点で落とさない**（正本 §11.3）。
          source: segment.source ?? null,
          speaker_tag: segment.speakerTag,
          text: segment.text,
          start_ms: segment.startMs,
          end_ms: segment.endMs,
          language: segment.language,
          confidence: segment.confidence === null ? null : String(segment.confidence),
          supersedes: [...supersedes],
          created_at: this.#now(),
        })
        // activity は何度でも再実行され得る。二重に積まない。
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst(),
    );
    if (!row) return null;

    const saved = toSegment(row);
    if (pass === 'live') {
      await this.#emit(tenantId, meetingId, 'meeting.transcript.final', {
        segment_id: saved.id,
        speaker_tag: saved.speaker_tag,
        text: saved.text,
        start_ms: saved.start_ms,
        end_ms: saved.end_ms,
        language: saved.language,
      });
    }
    return saved;
  }

  async #hasFinal(tx: ScopedDb, meetingId: string): Promise<boolean> {
    const row = await tx
      .selectFrom('meeting_segments')
      .select('id')
      .where('meeting_id', '=', meetingId)
      .where('pass', '=', 'final')
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async #emit(
    tenantId: string,
    meetingId: string,
    type:
      | 'meeting.transcript.partial'
      | 'meeting.transcript.final'
      | 'meeting.translation.final'
      | 'meeting.ended',
    payload: Record<string, unknown>,
  ): Promise<void> {
    await withTenant(this.#db, tenantId, (tx) =>
      appendEvent(
        tx,
        { tenantId, streamKind: 'meeting', streamId: meetingId, type, payload },
        this.#publisher,
      ),
    );
  }
}

// ------------------------------------------------------------------ 変換

const msOf = (s: { start_ms: number; end_ms: number } | StableSegment) =>
  'start_ms' in s
    ? { startMs: s.start_ms, endMs: s.end_ms }
    : { startMs: s.startMs, endMs: s.endMs };

function toMeeting(row: Record<string, unknown>): Meeting {
  const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);
  return {
    id: row['id'],
    tenant_id: row['tenant_id'],
    title: row['title'],
    status: row['status'],
    language: row['language'],
    target_language: row['target_language'] ?? null,
    audio_sources: row['audio_sources'],
    consent_at: iso(row['consent_at']),
    started_at: iso(row['started_at']),
    ended_at: iso(row['ended_at']),
    degraded_at: iso(row['degraded_at']),
    recording_artifact_id: row['recording_artifact_id'] ?? null,
    bundle_artifact_id: row['bundle_artifact_id'] ?? null,
    finalize_task_id: row['finalize_task_id'] ?? null,
    created_by: row['created_by'],
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
  } as Meeting;
}

function toSegment(row: Record<string, unknown>): MeetingSegment {
  return {
    id: row['id'],
    meeting_id: row['meeting_id'],
    pass: row['pass'],
    speaker_tag: row['speaker_tag'] ?? null,
    text: row['text'],
    start_ms: row['start_ms'],
    end_ms: row['end_ms'],
    language: row['language'] ?? null,
    confidence: row['confidence'] === null ? null : Number(row['confidence']),
    supersedes: row['supersedes'] ?? [],
    created_at: row['created_at'] instanceof Date ? row['created_at'].toISOString() : null,
  } as MeetingSegment;
}

/** finalize が作った bundle の形を検証する。壊れたものを Library へ入れない。 */
export function parseBundle(value: unknown): MeetingBundle {
  return MeetingBundle.parse(value);
}
