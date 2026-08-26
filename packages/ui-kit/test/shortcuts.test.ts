/**
 * UI/UX §20 の表を、表のまま確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  alternatesFor,
  bindingFor,
  bindingLabel,
  currentPlatform,
  defaultBinding,
  isComposing,
  matchesBinding,
  resolveShortcut,
  sameBinding,
  type Binding,
  type KeyLike,
} from '../src/shortcuts.js';

const press = (code: string, over: Partial<KeyLike> = {}): KeyLike => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe('the §20 table', () => {
  it('keeps every row the spec lists', () => {
    expect(SHORTCUTS.map((s) => s.id)).toEqual([
      'dock.toggle',
      'dock.pushToTalk',
      'dock.send',
      'dock.newline',
      'surface.dismiss',
      'context.open',
    ]);
  });

  it('uses Option+Space on macOS and Ctrl+Alt+Space on Windows', () => {
    expect(bindingLabel(defaultBinding('dock.toggle', 'macos'), 'macos')).toBe('Option + Space');
    expect(bindingLabel(defaultBinding('dock.toggle', 'windows'), 'windows')).toBe(
      'Alt + Ctrl + Space',
    );
  });

  it('gives Context Lens the Cmd/Ctrl+Shift+C the spec names', () => {
    expect(bindingLabel(defaultBinding('context.open', 'macos'), 'macos')).toBe(
      'Shift + Command + C',
    );
    expect(bindingLabel(defaultBinding('context.open', 'windows'), 'windows')).toBe(
      'Shift + Ctrl + C',
    );
  });

  it('never gives two shortcuts the same default on one platform', () => {
    for (const platform of ['macos', 'windows', 'linux'] as const) {
      const seen: Binding[] = [];
      for (const spec of SHORTCUTS) {
        const binding = spec.defaults[platform];
        expect(seen.some((b) => sameBinding(b, binding))).toBe(false);
        seen.push(binding);
      }
    }
  });
});

describe('matching a key press', () => {
  it('does not treat Shift+Enter as Enter', () => {
    const send = defaultBinding('dock.send', 'macos');
    expect(matchesBinding(press('Enter'), send, 'macos')).toBe(true);
    // 改行のつもりの打鍵で送信しない
    expect(matchesBinding(press('Enter', { shiftKey: true }), send, 'macos')).toBe(false);
  });

  it('reads primary as Command on macOS and Ctrl elsewhere', () => {
    const mac = defaultBinding('context.open', 'macos');
    expect(matchesBinding(press('KeyC', { metaKey: true, shiftKey: true }), mac, 'macos')).toBe(
      true,
    );
    // macOS で Ctrl+Shift+C は別物
    expect(matchesBinding(press('KeyC', { ctrlKey: true, shiftKey: true }), mac, 'macos')).toBe(
      false,
    );
    const win = defaultBinding('context.open', 'windows');
    expect(matchesBinding(press('KeyC', { ctrlKey: true, shiftKey: true }), win, 'windows')).toBe(
      true,
    );
  });

  it('resolves within a scope, and refuses when a key is bound twice', () => {
    expect(resolveShortcut(press('Escape'), 'macos', {}, 'surface')).toBe('surface.dismiss');
    // global の打鍵は surface の解決に混ざらない
    expect(resolveShortcut(press('Space', { altKey: true }), 'macos', {}, 'surface')).toBeNull();

    // 設定で衝突させたら、どちらも動かさない（勝手に選ばない）
    const clashing = { 'context.open': defaultBinding('surface.dismiss', 'macos') } as const;
    expect(resolveShortcut(press('Escape'), 'macos', clashing, 'surface')).toBeNull();
  });

  it('honours a setting that overrides the default', () => {
    const override = {
      'dock.toggle': {
        code: 'KeyJ',
        modifiers: { primary: true, alt: false, shift: true, control: false },
      },
    } as const;
    expect(bindingFor('dock.toggle', 'macos', override).code).toBe('KeyJ');
    expect(
      resolveShortcut(press('KeyJ', { metaKey: true, shiftKey: true }), 'macos', override),
    ).toBe('dock.toggle');
    // 既定はもう効かない
    expect(resolveShortcut(press('Space', { altKey: true }), 'macos', override)).toBeNull();
  });
});

describe('when the OS or the IME has taken the default', () => {
  it('offers alternates that are not already taken', () => {
    const taken = [defaultBinding('dock.toggle', 'macos')];
    const alternates = alternatesFor('dock.toggle', 'macos', taken);
    expect(alternates.length).toBeGreaterThan(0);
    for (const candidate of alternates) {
      expect(taken.some((t) => sameBinding(t, candidate))).toBe(false);
      // 他のショートカットの既定とも当たらない
      for (const spec of SHORTCUTS) {
        if (spec.id === 'dock.toggle') continue;
        expect(sameBinding(spec.defaults.macos, candidate)).toBe(false);
      }
    }
  });

  it('returns nothing rather than inventing a candidate', () => {
    const everything = [...alternatesFor('dock.pushToTalk', 'macos')];
    expect(alternatesFor('dock.pushToTalk', 'macos', everything)).toEqual([]);
  });
});

describe('Japanese input', () => {
  it('does not call a conversion Enter a send', () => {
    expect(isComposing({ isComposing: true })).toBe(true);
    // isComposing を出さない環境の印
    expect(isComposing({ keyCode: 229 })).toBe(true);
    expect(isComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});

describe('platform detection', () => {
  it('reads the platform from the user agent', () => {
    expect(currentPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macos');
    expect(currentPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(currentPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
  });
});
