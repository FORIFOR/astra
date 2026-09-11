/**
 * 「これ返して」の解決と、返信案に添える最小の文脈。REPLY_IN_CONTEXT_GATE。
 *
 * 解決は**決定的**で、候補の順に見る。曖昧なら似たメールを勝手に選ばない（none / ambiguous）。
 * 添える文脈は、そのスレッド・その案件・その案件の直近の会議・開いている件・本人が確認した働き方だけ。
 * 別案件のメールや今日の全予定は入れない。
 */
import type {
  PersonalizationProfile,
  Provenance,
  ReplyCandidate,
  ReplyPack,
  ReplyResolution,
  ReplyTarget,
  WorkArtifact,
  WorkContext,
} from '@astra/contracts';
import { cleanTitle, clusterProjects, titleTokens } from './graph.js';

/** 名指しの一致（0.6）以上で採用。それ未満は「分からない」。 */
export const REPLY_MATCH_THRESHOLD = 0.6;

function normalizedSubject(s: string): string {
  return cleanTitle(s)
    .replace(/\s*[-–—|]\s*(gmail|inbox|受信トレイ|mail|outlook).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

function isEmail(a: WorkArtifact): boolean {
  return a.kind === 'email';
}

function byTimeDesc(a: WorkArtifact, b: WorkArtifact): number {
  return b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id);
}

function toTarget(
  a: WorkArtifact,
  matchedBy: ReplyTarget['matched_by'],
  confidence: number,
  project: string | null,
): ReplyTarget {
  return {
    artifact_id: a.id,
    source: a.source,
    thread_id: a.thread_id,
    external_id: a.provenance.external_id,
    subject: a.title,
    to: a.people.find((p) => p.role === 'from') ?? null,
    project,
    matched_by: matchedBy,
    confidence,
  };
}

/** 候補 1 つを、メールの artifact に当てる。同点で別スレッドが並べば曖昧。 */
function matchLabel(
  label: string,
  artifacts: readonly WorkArtifact[],
): { best: WorkArtifact; score: number } | { ambiguous: WorkArtifact[] } | null {
  const wanted = normalizedSubject(label);
  if (!wanted) return null;
  const wantedTokens = titleTokens(wanted);
  const scored = artifacts
    .filter(isEmail)
    .map((a) => {
      const subject = normalizedSubject(a.title);
      const score = subject === wanted ? 1 : jaccard(wantedTokens, titleTokens(subject));
      return { a, score };
    })
    .filter((s) => s.score >= REPLY_MATCH_THRESHOLD)
    .sort((x, y) => y.score - x.score || byTimeDesc(x.a, y.a));
  if (scored.length === 0) return null;
  const top = scored[0]!;
  const tied = scored.filter((s) => s.score === top.score);
  const threads = new Set(tied.map((s) => s.a.thread_id ?? s.a.id));
  // 同じスレッドの複数通は、いちばん新しい 1 通で代表する（曖昧ではない）
  if (threads.size > 1) return { ambiguous: tied.map((s) => s.a) };
  return { best: top.a, score: top.score };
}

export interface ResolveReplyInput {
  readonly utterance: string;
  readonly candidates: readonly ReplyCandidate[];
  readonly artifacts: readonly WorkArtifact[];
}

/** 候補の順に決める。**先に決まったものを、後の候補で上書きしない。** */
export function resolveReplyTarget(input: ResolveReplyInput): ReplyResolution {
  const emails = input.artifacts.filter(isEmail);
  if (emails.length === 0) return { status: 'none' };
  const clusters = clusterProjects(input.artifacts);
  const projectOf = (a: WorkArtifact): string | null =>
    clusters.find((c) => c.artifacts.some((x) => x.id === a.id))?.name ?? null;

  for (const c of input.candidates) {
    const hit = matchLabel(c.label, emails);
    if (!hit) continue;
    if ('ambiguous' in hit) {
      return { status: 'ambiguous', candidates: hit.ambiguous.slice(0, 5).map((a) => a.title) };
    }
    return {
      status: 'resolved',
      target: toTarget(hit.best, c.kind, hit.score, projectOf(hit.best)),
    };
  }

  // 5. 発話の中の人・案件。**受信（相手からの）メールだけ**、いちばん新しい 1 通。
  const q = titleTokens(input.utterance).filter((w) => w.length >= 2);
  if (q.length > 0) {
    const inbound = emails.filter((a) => a.direction === 'inbound').sort(byTimeDesc);
    const named = inbound.filter((a) => {
      const from = a.people.find((p) => p.role === 'from');
      const names = [
        ...(from ? titleTokens(from.name) : []),
        ...(projectOf(a) ? titleTokens(projectOf(a)!) : []),
      ].filter((h) => h.length >= 2);
      return q.some((w) =>
        names.some((h) => h === w || w.includes(h) || (w.length >= 3 && h.includes(w))),
      );
    });
    if (named.length > 0) {
      const threads = new Set(named.map((a) => a.thread_id ?? a.id));
      const people = new Set(named.map((a) => a.people.find((p) => p.role === 'from')?.name ?? ''));
      // 相手が 1 人に決まるなら、その人の最新のスレッド。相手が複数なら曖昧。
      if (people.size === 1 || threads.size === 1) {
        const best = named[0]!;
        return { status: 'resolved', target: toTarget(best, 'named', 0.7, projectOf(best)) };
      }
      return {
        status: 'ambiguous',
        candidates: [...threads]
          .slice(0, 5)
          .map((t) => named.find((a) => (a.thread_id ?? a.id) === t)!.title),
      };
    }
  }
  return { status: 'none' };
}

export interface ReplyPackInput {
  readonly target: ReplyTarget;
  readonly artifacts: readonly WorkArtifact[];
  readonly context: WorkContext;
  readonly profile?: PersonalizationProfile | null;
}

/** 返信案に添える最小の pack。 */
export function buildReplyPack(input: ReplyPackInput): ReplyPack {
  const { target, artifacts, context } = input;
  const thread = artifacts
    .filter((a) => isEmail(a) && target.thread_id !== null && a.thread_id === target.thread_id)
    .sort(byTimeDesc)
    .slice(0, 5)
    .map((a) => a.provenance);
  const self = artifacts.find((a) => a.id === target.artifact_id);
  if (thread.length === 0 && self) thread.push(self.provenance);

  const project = target.project;
  const meeting =
    project === null
      ? null
      : (artifacts
          .filter(
            (a) =>
              (a.kind === 'meeting' || a.kind === 'decision' || a.kind === 'action_item') &&
              inCluster(a, project, artifacts),
          )
          .sort(byTimeDesc)[0]?.provenance ?? null);
  const open =
    project === null
      ? []
      : [
          ...context.owed
            .filter((o) => o.project === project)
            .map((o) => `${o.to} に返す: ${o.what}`),
          ...context.waiting_on
            .filter((w) => w.project === project)
            .map((w) => `${w.who} からの返事待ち: ${w.what}`),
        ].slice(0, 5);
  const personalization = (input.profile?.inference_enabled ? input.profile.working_style : [])
    .filter((t) => t.enabled && t.status === 'confirmed' && t.value !== 0)
    .map((t) => t.label)
    .slice(0, 5);
  const sources: Provenance[] = [...thread];
  if (meeting) sources.push(meeting);
  for (const o of context.owed.filter((o) => o.project === project)) sources.push(...o.sources);
  for (const w of context.waiting_on.filter((w) => w.project === project))
    sources.push(...w.sources);
  const seen = new Set<string>();
  const dedup = sources.filter((s) => {
    const k = `${s.source}:${s.external_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    target,
    thread,
    project,
    meeting,
    open_items: open,
    personalization,
    sources: dedup.slice(0, 12),
  };
}

function inCluster(a: WorkArtifact, project: string, artifacts: readonly WorkArtifact[]): boolean {
  const c = clusterProjects(artifacts).find((x) => x.name === project);
  return c?.artifacts.some((x) => x.id === a.id) ?? false;
}

/** LLM に渡す文字列。**抜粋だけ。**上限つき。 */
export function renderReplyContext(pack: ReplyPack, limit = 1_800): string {
  const lines: string[] = [];
  lines.push(`返信先: ${pack.target.to?.name ?? '相手'} / 件名: ${pack.target.subject}`);
  if (pack.project) lines.push(`案件: ${pack.project}`);
  if (pack.thread.length > 0) {
    lines.push('このスレッド（新しい順、抜粋）:');
    for (const t of pack.thread) lines.push(`- ${t.label}${t.excerpt ? `: ${t.excerpt}` : ''}`);
  }
  if (pack.meeting)
    lines.push(
      `直近の会議: ${pack.meeting.label}${pack.meeting.excerpt ? `: ${pack.meeting.excerpt}` : ''}`,
    );
  if (pack.open_items.length > 0) {
    lines.push('開いている件:');
    for (const o of pack.open_items) lines.push(`- ${o}`);
  }
  if (pack.personalization.length > 0)
    lines.push(`書き方（本人が確認済み）: ${pack.personalization.join('、')}`);
  const text = lines.join('\n');
  return text.length > limit ? text.slice(0, limit) : text;
}

/** 返信案の指示。**抜粋に無い事実を書かせない。**送らない。 */
export function replyInstruction(pack: ReplyPack): string {
  return [
    `次のメールへの返信を日本語で書いてください。宛先は ${pack.target.to?.name ?? '相手'} さん。`,
    '前提（このスレッド・案件・直近の会議・開いている件）に書かれていることだけを事実として使ってください。',
    '日時・金額・約束は前提に現れた表記のまま。前提に無いことは約束しないでください。',
    '件名は書かず、本文だけ。署名は書かないでください。',
  ].join('\n');
}

/** 確認カードに出す一言。何を踏まえたか。 */
export function replyBasis(pack: ReplyPack): string {
  const parts = ['このスレッド'];
  if (pack.meeting) parts.push('直近の会議');
  if (pack.open_items.length > 0) parts.push('開いている件');
  return `${parts.join('と')}を踏まえて作りました。`;
}
