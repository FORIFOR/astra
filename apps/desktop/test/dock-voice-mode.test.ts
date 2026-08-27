/** Orb の姿（Deepgram の idle / connecting / listening / thinking / speaking）と demo。 */
import { describe, expect, it } from 'vitest';
import { dockVoiceMode, voiceModeLabel } from '../src/dock/dockVoiceMode.js';
import { syntheticLevel, voiceDemoFrom } from '../src/voice/demo.js';

describe('dockVoiceMode', () => {
  it('follows the dock while nothing is being spoken', () => {
    expect(dockVoiceMode('READY')).toBe('idle');
    expect(dockVoiceMode('TYPING')).toBe('idle');
    expect(dockVoiceMode('LISTENING')).toBe('listening');
    expect(dockVoiceMode('UNDERSTANDING')).toBe('thinking');
    expect(dockVoiceMode('WORKING')).toBe('thinking');
  });

  it('lets speaking, connecting and error win over the dock state', () => {
    expect(dockVoiceMode('READY', 'speaking')).toBe('speaking');
    expect(dockVoiceMode('UNDERSTANDING', 'speaking')).toBe('speaking');
    expect(dockVoiceMode('LISTENING', 'connecting')).toBe('connecting');
    expect(dockVoiceMode('READY', 'error')).toBe('error');
  });

  it('does not keep listening once the dock has stopped', () => {
    expect(dockVoiceMode('READY', 'listening')).toBe('idle');
  });

  it('uses the same words as the HUD', () => {
    expect(voiceModeLabel('listening')).toBe('聞いています');
    expect(voiceModeLabel('speaking')).toBe('Astra が話しています');
    expect(voiceModeLabel('idle')).toBeNull();
  });
});

describe('voiceDemoFrom', () => {
  it('is off outside development builds, whatever the hash says', () => {
    expect(voiceDemoFrom('#/dock?demo=listening', false)).toBeNull();
  });

  it('fixes the dock in a state and feeds a synthetic level', () => {
    const demo = voiceDemoFrom('#/dock?demo=listening', true)!;
    expect(demo.state).toBe('LISTENING');
    expect(demo.mode).toBe('listening');
    expect(demo.levels.input()).toBeGreaterThan(0);
    expect(demo.levels.output()).toBe(0);
    expect(voiceDemoFrom('#/dock?demo=speaking', true)!.levels.output()).toBeGreaterThan(0);
  });

  it('ignores unknown names', () => {
    expect(voiceDemoFrom('#/dock?demo=nope', true)).toBeNull();
    expect(voiceDemoFrom('#/dock', true)).toBeNull();
  });

  it('keeps the synthetic level inside the visible range', () => {
    for (let t = 0; t < 3000; t += 100) {
      const v = syntheticLevel(t);
      expect(v).toBeGreaterThanOrEqual(0.15);
      expect(v).toBeLessThanOrEqual(0.85);
    }
  });
});
