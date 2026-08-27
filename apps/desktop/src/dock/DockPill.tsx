/**
 * 上部のピル。Voice OS 型の「常に居る入口」。
 *
 * 何もしていないときは徹底して静か: 押している間だけ話すキーと一言だけ。
 * 聞いている間は赤い点と波形と途中の文字、考えている間は Orb と一言。
 * 録音ボタンや機能の並びは置かない（それは押したときの入力カードの仕事）。
 */
import { useMemo, type ReactElement } from 'react';
import {
  bindingLabel,
  currentPlatform,
  defaultBinding,
  type InteractionState,
} from '@astra/ui-kit';
import { AstraOrb, useAccentHex } from '../voice/AstraOrb.js';
import type { VoiceMode } from '../voice/voiceRuntime.js';
import { LiveWaveform } from '../vendor/deepgram-ui/LiveWaveform.js';

export function DockPill({
  state,
  orbMode,
  intent,
  voiceLevels,
  onOpen,
}: {
  state: InteractionState;
  orbMode: VoiceMode;
  intent: string;
  voiceLevels?: { input: () => number; output: () => number };
  onOpen(): void;
}): ReactElement {
  const accent = useAccentHex();
  const keys = useMemo(() => {
    const platform = currentPlatform();
    return bindingLabel(defaultBinding('dock.pushToTalk', platform), platform).split(' + ');
  }, []);

  if (state === 'LISTENING') {
    return (
      <button type="button" className="astra-pill astra-pill--listening" onClick={onOpen}>
        <span className="astra-pill__dot" aria-hidden="true" />
        <span className="astra-pill__text" aria-live="polite">
          {intent.length > 0 ? intent : '聞いています…'}
        </span>
        <span className="astra-pill__wave" aria-hidden="true">
          <LiveWaveform
            active
            color={accent}
            getVolume={voiceLevels ? voiceLevels.input : () => 0}
          />
        </span>
      </button>
    );
  }

  if (state === 'UNDERSTANDING') {
    return (
      <div className="astra-pill astra-pill--thinking" role="status">
        <span className="astra-pill__orb" data-astra-voice-state={orbMode}>
          <AstraOrb mode="thinking" size={16} />
        </span>
        <span className="astra-pill__text">考えています…</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="astra-pill astra-pill--idle"
      onClick={onOpen}
      aria-label="Astra に頼む"
    >
      <span className="astra-pill__mark" aria-hidden="true">
        <AstraOrb mode="idle" size={12} />
      </span>
      {keys.map((key) => (
        <kbd key={key} className="astra-pill__key">
          {key.toLowerCase()}
        </kbd>
      ))}
      <span className="astra-pill__text">長押しで音声入力</span>
    </button>
  );
}
