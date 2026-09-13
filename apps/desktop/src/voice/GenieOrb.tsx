/** The user-selected Liquid Orb Editor shader; all rendering stays on this device. */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { VoiceMode } from './voiceRuntime.js';
import { createOrbRenderer, type OrbSource } from './liquid-orb/renderer.js';
import './liquid-orb/orb.css';
import { orbFallback } from './liquid-orb/generated.js';
const ACCENT_LIGHT = '#5B4CF0';
const ACCENT_DARK = '#8A7DFF';
export function orbStateFor(mode: VoiceMode): VoiceMode {
  return mode === 'error' || mode === 'interrupted' ? 'idle' : mode;
}
/** CSS 変数から hex を読む。`#rrggbb` でなければ既定に落とす。 */
function readHex(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function GenieOrb({
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<OrbSource>({ mode, getInputVolume, getOutputVolume });
  source.current = { mode: orbStateFor(mode), getInputVolume, getOutputVolume };
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const abort = new AbortController();
    const fail = (): void => {
      if (!abort.signal.aborted) setReady(false);
    };
    void createOrbRenderer(element, () => source.current, fail, abort.signal)
      .then(() => {
        if (!abort.signal.aborted) setReady(true);
      })
      .catch(fail);
    return () => abort.abort();
  }, []);
  useEffect(() => {
    canvas.current?.dispatchEvent(new Event('genie-orb-state'));
  }, [mode]);
  return (
    <span
      className="astra-orb genie-liquid-orb"
      data-astra-voice-state={mode}
      data-genie-orb-renderer={ready ? 'webgpu' : 'static'}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {!ready && <img className="genie-liquid-orb__fallback" src={orbFallback} alt="" />}
      <canvas ref={canvas} style={{ opacity: ready ? 1 : 0 }} />
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
    setHex(readHex('--genie-color-accent', ACCENT_LIGHT));
  }, []);
  return hex;
}
