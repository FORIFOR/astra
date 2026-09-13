import type { VoiceMode } from '../voiceRuntime.js';
import { orbActivation, orbSeeds, orbSettle } from './generated.js';
export const activeOrbMode = (mode: VoiceMode): boolean =>
  ['thinking', 'listening', 'speaking'].includes(mode);
export const safeOrbLevel = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export const shouldAnimateOrb = (mode: VoiceMode, visible: boolean, reduced: boolean): boolean =>
  activeOrbMode(mode) && visible && !reduced;
const linear = (n: number): number => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
const srgb = (n: number): number => (n <= 0.0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - 0.055);

export class OrbMotion {
  mode: VoiceMode = 'idle';
  private values = new Float32Array(orbSeeds.idle);
  private from = new Float32Array(orbSeeds.idle);
  private target = new Float32Array(orbSeeds.idle);
  private changed = 0;
  private last: number | undefined;
  private phase = 0;
  private level = 0;
  setMode(mode: VoiceMode, now: number): void {
    if (mode === this.mode) return;
    this.from.set(this.values);
    this.target.set(activeOrbMode(mode) ? orbSeeds.active : orbSeeds.idle);
    this.mode = mode;
    this.changed = now;
  }
  sample(now: number, input: number, reduced: boolean): Float32Array<ArrayBuffer> {
    const dt = Math.min(0.1, Math.max(0, (now - (this.last ?? now)) / 1000));
    this.last = now;
    const active = activeOrbMode(this.mode);
    const raw = Math.max(
      0,
      Math.min(1, (now - this.changed) / ((active ? orbActivation : orbSettle) * 1000)),
    );
    const t = reduced ? 1 : active ? 1 - (1 - raw) ** 3 : raw * raw * (3 - 2 * raw);
    for (let i = 3; i < this.values.length; i++) {
      const a = this.from[i]!;
      const b = this.target[i]!;
      this.values[i] =
        i >= 40 && (i - 40) % 4 < 3
          ? srgb(linear(a) + (linear(b) - linear(a)) * t)
          : a + (b - a) * t;
    }
    if (reduced) this.level = 0;
    const wanted =
      !reduced && (this.mode === 'listening' || this.mode === 'speaking') ? safeOrbLevel(input) : 0;
    this.level +=
      (wanted - this.level) * (1 - Math.exp(-dt / (wanted > this.level ? 0.045 : 0.18)));
    const out = this.values.slice();
    out[4] = out[4]! + this.level * 0.055;
    out[6] = out[6]! * (1 + this.level * 0.16);
    out[14] = out[14]! * (1 + this.level * 0.15);
    if (!reduced && active) this.phase += dt * out[3]! * (this.mode === 'speaking' ? 1.15 : 1);
    out[2] = (reduced ? 1.5 : this.phase) / Math.max(0.001, out[3]!);
    return out;
  }
}
