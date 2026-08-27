/**
 * Astra の Orb。描画は Deepgram 公式（`vendor/deepgram-ui/Orb.tsx`）。
 *
 * 変えているのは色だけ。**動きは Deepgram、色は Astra。**
 * Orb は hex に alpha を足して使うので、CSS 変数ではなく実値を渡す。
 * 変数から読めなければ §17.1 の accent を使う（見た目が変わるだけで、動きは同じ）。
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Orb, type OrbState } from '../vendor/deepgram-ui/Orb.js';
import type { VoiceMode } from './voiceRuntime.js';

/** §17.1 の accent。変数が読めないときの既定。 */
const ACCENT_LIGHT = '#5B4CF0';
const ACCENT_DARK = '#8A7DFF';

export function orbStateFor(mode: VoiceMode): OrbState {
  switch (mode) {
    case 'speaking':
      return 'talking';
    case 'listening':
    case 'connecting':
    case 'thinking':
      return 'listening';
    default:
      return 'idle';
  }
}

/** CSS 変数から hex を読む。`#rrggbb` でなければ既定に落とす。 */
function readHex(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function AstraOrb({
  mode,
  size = 48,
  getInputVolume,
  getOutputVolume,
}: {
  mode: VoiceMode;
  size?: number;
  getInputVolume?: () => number;
  getOutputVolume?: () => number;
}): ReactElement {
  const [colors, setColors] = useState<[string, string]>([ACCENT_LIGHT, ACCENT_DARK]);

  useEffect(() => {
    // theme が変わっても追う。読めない環境では既定のまま。
    setColors([
      readHex('--astra-color-accent', ACCENT_LIGHT),
      readHex('--astra-color-accent-on', ACCENT_DARK),
    ]);
  }, []);

  const state = useMemo(() => orbStateFor(mode), [mode]);

  return (
    <span className="astra-orb" data-astra-voice-state={mode}>
      <Orb
        state={state}
        size={size}
        colors={colors}
        {...(getInputVolume ? { getInputVolume } : {})}
        {...(getOutputVolume ? { getOutputVolume } : {})}
      />
    </span>
  );
}

/**
 * accent の実値。canvas（LiveWaveform）は `currentColor` を解決できず黒で描く。
 * Orb と同じ読み方で hex を渡す。
 */
export function useAccentHex(): string {
  const [hex, setHex] = useState(ACCENT_LIGHT);
  useEffect(() => {
    setHex(readHex('--astra-color-accent', ACCENT_LIGHT));
  }, []);
  return hex;
}
