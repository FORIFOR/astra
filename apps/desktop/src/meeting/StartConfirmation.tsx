/**
 * 録音を始める前の確認。UI/UX §12.1。
 *
 * **同意の確認を飛ばせない。**録音は参加者の権利に関わるので、
 * 「押したら始まる」ボタンの前に、何を録るかと同意の確認を必ず出す。
 */
import { useState, type ReactElement } from 'react';
import type { AudioSource } from '@astra/contracts';

export interface MeetingStartValues {
  readonly title: string;
  readonly audioSources: readonly AudioSource[];
  readonly language: string;
  readonly targetLanguage: string | null;
}

const LANGUAGES = [
  { id: 'ja-JP', label: '日本語' },
  { id: 'en-US', label: 'English' },
] as const;

export function StartConfirmation({
  defaultTitle = '',
  onCancel,
  onStart,
}: {
  defaultTitle?: string;
  onCancel(): void;
  onStart(values: MeetingStartValues): void;
}): ReactElement {
  const [title, setTitle] = useState(defaultTitle);
  const [microphone, setMicrophone] = useState(true);
  const [system, setSystem] = useState(false);
  const [language, setLanguage] = useState('ja-JP');
  const [translate, setTranslate] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('en-US');
  const [consent, setConsent] = useState(false);

  const sources: AudioSource[] = [
    ...(microphone ? (['microphone'] as const) : []),
    ...(system ? (['system'] as const) : []),
  ];
  // 何も録らない録音は始められない。同意も必須。
  const ready = consent && sources.length > 0 && title.trim().length > 0;

  return (
    <form
      className="astra-meeting-start"
      aria-label="録音の開始確認"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onStart({
          title: title.trim(),
          audioSources: sources,
          language,
          targetLanguage: translate ? targetLanguage : null,
        });
      }}
    >
      <label className="astra-meeting-start__title">
        <span>会議名</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>

      <fieldset className="astra-meeting-start__sources">
        <legend>録音する音声</legend>
        <label>
          <input
            type="checkbox"
            checked={microphone}
            onChange={(e) => setMicrophone(e.target.checked)}
          />
          マイク
        </label>
        <label>
          <input type="checkbox" checked={system} onChange={(e) => setSystem(e.target.checked)} />
          システム音声
        </label>
      </fieldset>

      <label className="astra-meeting-start__language">
        <span>話される言語</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <div className="astra-meeting-start__translation">
        <label>
          <input
            type="checkbox"
            checked={translate}
            onChange={(e) => setTranslate(e.target.checked)}
          />
          翻訳
        </label>
        {translate ? (
          <select
            aria-label="翻訳先"
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
          >
            {LANGUAGES.filter((l) => l.id !== language).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <label className="astra-meeting-start__consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        参加者への録音・文字起こしの同意を確認しました
      </label>

      <div className="astra-meeting-start__actions">
        <button type="button" onClick={onCancel}>
          キャンセル
        </button>
        <button type="submit" disabled={!ready}>
          記録を開始
        </button>
      </div>
    </form>
  );
}
