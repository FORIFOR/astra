/**
 * LLM への Context Injection。**全データを毎回渡さない。**（CONTEXT_MINIMIZATION_GATE）
 *
 *   query → 意図 → 候補（案件・待ち・返すもの）→ 関連の閾値 → 最小の pack → LLM
 *
 * 「この Swift コード直して」に受信箱や人間関係を添える理由は無い（0 件）。
 * 「今日何を優先？」には上位 3 件。「MTI に返信して」にはその相手・案件の分だけ。
 * 「MOPITA 定例の準備」にはその案件と相手と開いている件だけ。
 *
 * 目標は「大量に知っている AI」ではなく、**必要なときだけ必要なことを思い出す AI**。
 * 1 turn ごとに selected / available を残し、渡した量を後から数えられるようにする。
 */
import {
  MAX_INJECTED_PRIORITIES,
  renderWorkContext,
  type ContextIntent,
  type InjectedPriority,
  type InjectionStats,
  type PersonalizationProfile,
  type WorkContext,
  type WorkPriority,
} from '@astra/contracts';
import { titleTokens } from './graph.js';

/** 今日 / 今週の優先を聞いている問い。**命令（「会議を録音して」）は含めない。** */
const PRIORITIES_INTENT =
  /(優先|やばい|忙し|何をす|何から|どれから|何が残|抱えて|締め?切り|期限|返信待ち|待ってい|返さな|今日.*(予定|やる|すべき|何)|今週.*(やる|予定|何)|priorit|what should|what.*focus|this week|deadline|waiting on|overdue)/i;
/** 返事を書こうとしている問い。 */
const EMAIL_REPLY_INTENT =
  /((返信|返事|お返事|reply|respond).*(して|書い|下書き|作っ|draft|write)|(メール|mail).*(返し|書い|返信|reply))/i;
/** 会議の準備。 */
const MEETING_PREP_INTENT =
  /((会議|定例|ミーティング|打ち合わせ|打合せ|mtg|meeting|商談).*(準備|備え|聞く|質問|議題|確認しておく|prep|agenda|before))/i;

/** 関連の閾値。名指しは 1、意図だけの一致は 0.5。これ未満は渡さない。 */
export const RELEVANCE_THRESHOLD = 0.5;

export interface InjectionInput {
  readonly question: string;
  readonly context: WorkContext;
  readonly profile?: PersonalizationProfile | null;
}

export interface ContextPack {
  readonly intent: ContextIntent;
  readonly items: InjectedPriority[];
  readonly text: string;
  readonly stats: InjectionStats;
}

export function classifyContextIntent(question: string): Exclude<ContextIntent, 'project'> {
  if (EMAIL_REPLY_INTENT.test(question)) return 'email_reply';
  if (MEETING_PREP_INTENT.test(question)) return 'meeting_prep';
  if (PRIORITIES_INTENT.test(question)) return 'priorities';
  return 'none';
}

/** 問いの語と名前（案件・人）の重なり。名指しは案件名・人名だけで判定する（状況の行では当てない）。 */
function mentions(question: readonly string[], name: string | null | undefined): boolean {
  if (!name) return false;
  const hay = titleTokens(name).filter((h) => h.length >= 2);
  return question.some((w) =>
    hay.some((h) => h === w || w.includes(h) || (w.length >= 3 && h.includes(w))),
  );
}

function asInjected(p: WorkPriority, extra: readonly string[] = []): InjectedPriority {
  return {
    project: p.project,
    score: p.score,
    lines: [...p.lines, ...extra].slice(0, 3),
  };
}

/**
 * 問いに応じた最小の pack。
 *
 * 候補は案件（priorities）・待ち・返すもの。available はその総数、selected は渡した数。
 */
export function selectContextPack(input: InjectionInput): ContextPack {
  const { context, question } = input;
  const available = context.priorities.length + context.waiting_on.length + context.owed.length;
  const empty = (intent: ContextIntent): ContextPack => ({
    intent,
    items: [],
    text: '',
    stats: { intent, selected_artifacts: 0, available_artifacts: available, chars: 0 },
  });
  if (!context.inference_enabled) return empty('none');
  if (input.profile && !input.profile.inference_enabled) return empty('none');

  const q = titleTokens(question);
  const named = context.priorities.filter((p) => mentions(q, p.project));
  const personNamed = (project: string): boolean =>
    context.waiting_on.some((w) => w.project === project && mentions(q, w.who)) ||
    context.owed.some((o) => o.project === project && mentions(q, o.to));
  const byPerson = context.priorities.filter((p) => personNamed(p.project));
  const targets = [...new Set([...named, ...byPerson])];
  const openItems = (project: string): { lines: string[]; count: number } => {
    const waits = context.waiting_on.filter((w) => w.project === project);
    const owed = context.owed.filter((o) => o.project === project);
    return {
      lines: [
        ...waits.map((w) => `${w.who} からの返事待ち: ${w.what}`),
        ...owed.map((o) => `${o.to} に返す: ${o.what}`),
      ],
      count: waits.length + owed.length,
    };
  };
  const finish = (
    intent: ContextIntent,
    items: InjectedPriority[],
    selected: number,
  ): ContextPack => {
    const text = renderWorkContext(items);
    return {
      intent,
      items,
      text,
      stats: {
        intent,
        selected_artifacts: selected,
        available_artifacts: available,
        chars: text.length,
      },
    };
  };
  const rank = (a: WorkPriority, b: WorkPriority): number =>
    b.score - a.score || a.id.localeCompare(b.id);

  const intent = classifyContextIntent(question);
  switch (intent) {
    case 'email_reply': {
      // 返信の相手・案件が名指しされていなければ、受信箱をまるごと添える理由は無い。
      if (targets.length === 0) return empty(intent);
      const items: InjectedPriority[] = [];
      let selected = 0;
      for (const p of [...targets].sort(rank).slice(0, 1)) {
        const open = openItems(p.project);
        items.push(asInjected(p, open.lines));
        selected += 1 + open.count;
      }
      return finish(intent, items, selected);
    }
    case 'meeting_prep': {
      // 名指しの案件 → 無ければ、今日の会議が状況に出ている案件 → それも無ければ 0
      const meetingLike = context.priorities.filter((p) =>
        p.lines.some((l) => /(会議|定例|ミーティング|meeting|打ち合わせ)/.test(l)),
      );
      const chosen = (targets.length > 0 ? targets : meetingLike).sort(rank).slice(0, 1);
      if (chosen.length === 0) return empty(intent);
      const items: InjectedPriority[] = [];
      let selected = 0;
      for (const p of chosen) {
        const open = openItems(p.project);
        items.push(asInjected(p, open.lines));
        selected += 1 + open.count;
      }
      return finish(intent, items, selected);
    }
    case 'priorities': {
      const rest = context.priorities.filter((p) => !targets.includes(p)).sort(rank);
      const chosen = [...targets.sort(rank), ...rest].slice(0, MAX_INJECTED_PRIORITIES);
      return finish(
        intent,
        chosen.map((p) => asInjected(p)),
        chosen.length,
      );
    }
    case 'none': {
      // 意図は無くても、案件を名指ししたならその案件だけ（「MOPITA の状況は？」）
      if (targets.length === 0) return empty('none');
      const chosen = targets.sort(rank).slice(0, MAX_INJECTED_PRIORITIES);
      return finish(
        'project',
        chosen.map((p) => asInjected(p)),
        chosen.length,
      );
    }
  }
}

/** 互換: 渡す案件の一覧だけ。 */
export function selectInjection(input: InjectionInput): InjectedPriority[] {
  return selectContextPack(input).items;
}

/** 質問に添える文字列。空なら何も添えない。 */
export function injectionText(input: InjectionInput): string {
  return selectContextPack(input).text;
}
