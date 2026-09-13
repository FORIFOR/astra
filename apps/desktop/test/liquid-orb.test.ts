import { describe, expect, it } from 'vitest';
import { OrbMotion, safeOrbLevel, shouldAnimateOrb } from '../src/voice/liquid-orb/motion.js';
import { orbSeeds } from '../src/voice/liquid-orb/generated.js';

describe('liquid orb state and energy policy', () => {
  it('animates only active, visible work without reduced motion', () => {
    for (const mode of [
      'idle',
      'connecting',
      'thinking',
      'listening',
      'speaking',
      'error',
    ] as const) {
      expect(shouldAnimateOrb(mode, false, false)).toBe(false);
      expect(shouldAnimateOrb(mode, true, true)).toBe(false);
    }
    expect(shouldAnimateOrb('connecting', true, false)).toBe(false);
    expect(shouldAnimateOrb('thinking', true, false)).toBe(true);
  });
  it('has no invented microphone activity while preparing or thinking', () => {
    expect(safeOrbLevel(NaN)).toBe(0);
    expect(safeOrbLevel(Infinity)).toBe(0);
    for (const mode of ['connecting', 'thinking'] as const) {
      const a = new OrbMotion(),
        b = new OrbMotion();
      a.setMode(mode, 0);
      b.setMode(mode, 0);
      for (let i = 0; i < 1000; i += 33)
        expect(a.sample(i, 0, false)).toEqual(b.sample(i, 1, false));
    }
  });
  it('smooths actual audio and settles after silence', () => {
    const m = new OrbMotion();
    m.setMode('speaking', 0);
    for (let i = 0; i <= 1000; i += 10) m.sample(i, 1, false);
    const loud = m.sample(1010, 1, false)[4]!;
    for (let i = 1020; i <= 3000; i += 10) m.sample(i, 0, false);
    expect(loud).toBeGreaterThan(m.sample(3010, 0, false)[4]!);
    expect(loud).toBeLessThanOrEqual(0.776);
  });
  it('freezes motion and audio under Reduce Motion', () => {
    const m = new OrbMotion();
    m.setMode('listening', 0);
    expect(m.sample(1000, 0, true)).toEqual(m.sample(10000, 1, true));
  });
  it('preserves the chosen Siri shader uniform layout', () => {
    expect(orbSeeds.active).toHaveLength(136);
    expect(orbSeeds.active[15]).toBe(9);
    expect(orbSeeds.active[3]).toBe(0.82);
    expect(orbSeeds.active[4]).toBe(0.72);
  });
});
