/** OS のどこにいても見える、状態表示専用の Voice HUD。 */
import { useEffect, type ReactElement } from 'react';
import { ThemeProvider } from '../state/ThemeProvider.js';
import { LiveWaveform } from '../vendor/deepgram-ui/LiveWaveform.js';
import { AstraOrb, useAccentHex } from './AstraOrb.js';
import { useVoiceRuntime, type VoiceMode } from './voiceRuntime.js';
import { voiceDemoFrom } from './demo.js';
import './voice-hud.css';

function labelFor(mode: VoiceMode): string {
  switch (mode) {
    case 'connecting':
      return '音声を準備しています';
    case 'listening':
      return '聞いています';
    case 'thinking':
      return '考えています';
    case 'speaking':
      return 'Astra が話しています';
    case 'interrupted':
      return '割り込みました';
    case 'error':
      return '音声を続けられません';
    case 'idle':
      return 'Astra';
  }
}

function VoiceHud(): ReactElement {
  // この window は表示専用。実行は Dock window の同じ runtime が担う。
  const live = useVoiceRuntime();
  // 見た目の確認用（開発ビルドのみ）。`#/voice-hud?demo=speaking` で姿を固定する。
  const demo = voiceDemoFrom(globalThis.location?.hash ?? '', import.meta.env.DEV);
  const runtime = demo
    ? {
        ...live,
        mode: demo.mode,
        inputLevel: demo.levels.input,
        outputLevel: demo.levels.output,
        transcript: demo.mode === 'listening' ? 'A社向けにこの提案を直して' : '',
      }
    : live;
  const accent = useAccentHex();
  const volume = runtime.mode === 'speaking' ? runtime.outputLevel : runtime.inputLevel;
  const active = runtime.mode === 'listening' || runtime.mode === 'speaking';

  useEffect(() => {
    document.body.classList.add('astra-voice-hud-page');
    return () => document.body.classList.remove('astra-voice-hud-page');
  }, []);

  return (
    <main className="astra-voice-hud" data-astra-voice-state={runtime.mode}>
      <AstraOrb
        mode={runtime.mode}
        size={132}
        getInputVolume={runtime.inputLevel}
        getOutputVolume={runtime.outputLevel}
      />
      <p className="astra-voice-hud__status" role="status">
        {labelFor(runtime.mode)}
      </p>
      {runtime.transcript.length > 0 && runtime.mode !== 'speaking' && (
        <p className="astra-voice-hud__transcript">{runtime.transcript}</p>
      )}
      {runtime.unavailable && (
        <p className="astra-voice-hud__error" role="alert">
          {runtime.unavailable}
        </p>
      )}
      <div className="astra-voice-hud__wave">
        <LiveWaveform active={active} color={accent} getVolume={volume} />
      </div>
    </main>
  );
}

export function VoiceHudApp(): ReactElement {
  return (
    <ThemeProvider>
      <VoiceHud />
    </ThemeProvider>
  );
}
