/**
 * Workspace の下端にある「Ask Astra…」。UI/UX §7・§7.1。
 *
 * **これが無いと、Workspace から Astra へ話しかけられない。**
 * Task Dock は別 window なので、本体を開いている人には見えない。
 * §7 が「Conversation は下部 composer として**常に継続できる**」と
 * 言っているのは、そのため。
 *
 * Dock との違い:
 *   Dock      … 何かを**始める**ための口。呼び出して、閉じる
 *   Composer  … 開いている仕事の**続き**を話す口。閉じない
 */
import { useCallback, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { isComposing } from '@astra/ui-kit';

export interface ComposerConversation {
  send(text: string): Promise<{ needsClarification: boolean; answer: string | null }>;
}

export function Composer({
  conversation,
  placeholder = 'Ask Astra…',
}: {
  conversation?: ComposerConversation | undefined;
  placeholder?: string;
}): ReactElement {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(async () => {
    const asked = text.trim();
    if (asked.length === 0 || sending) return;

    if (!conversation) {
      // **繋がっていないことを、黙って飲み込まない**（§21）
      setError('まだ接続していません。サインインし直してください。');
      return;
    }

    setSending(true);
    setError(null);
    try {
      const result = await conversation.send(asked);
      setText('');
      /*
       * 聞き返しも答えも、同じ場所に出す。
       * **聞き返しを「答え」として出さない**ので、文言は engine のものをそのまま使う。
       */
      setAnswer(result.answer);
    } catch (cause) {
      // §21: 何が起きたかを言う。黙って送れなかったことにしない。
      setError(cause instanceof Error ? cause.message : '送れませんでした');
    } finally {
      setSending(false);
    }
  }, [conversation, sending, text]);

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  return (
    <form className="astra-composer" onSubmit={onSubmit}>
      {answer !== null && (
        // 直前の返事。長い会話は Work 面で見る（ここは 1 往復だけ）
        <p className="astra-composer__answer" role="status">
          {answer}
        </p>
      )}
      {error !== null && (
        <p className="astra-composer__error" role="alert">
          {error}
        </p>
      )}
      <div className="astra-composer__row">
        <textarea
          ref={field}
          className="astra-composer__input"
          value={text}
          rows={1}
          placeholder={placeholder}
          aria-label="Astra に頼む"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            /*
             * **変換確定の Enter を送信にしない。**日本語入力では Enter が
             * 「変換を確定する」キーでもある。見落とすと、
             * 変換途中の文がそのまま送られる（§20）。
             */
            if (isComposing(event.nativeEvent)) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="submit"
          className="astra-composer__send"
          disabled={sending || text.trim().length === 0}
        >
          {sending ? '送っています' : '送る'}
        </button>
      </div>
    </form>
  );
}
