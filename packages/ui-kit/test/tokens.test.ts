/**
 * Design tokens。UI/UX §17・§18・§19、UI-0 の Exit。
 *
 * 色は目視で決めない。コントラストは計算できるので、ここで機械的に守る。
 */
import { describe, expect, it } from 'vitest';
import {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  BACKGROUND_TOKENS,
  FOREGROUND_TOKENS,
  TOP_LEVEL_TABS,
  TOKENS_CSS,
  breakpoints,
  contrastRatio,
  darkColors,
  isTabId,
  isThemeMode,
  layout,
  layoutModeFor,
  lightColors,
  motion,
  palettes,
  radius,
  resolveLayout,
  resolveTheme,
  applyTheme,
  padding,
  space,
  tabForPath,
  typography,
} from '../src/index.js';

describe('colour tokens', () => {
  it('defines the same keys in both themes', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it.each(['light', 'dark'] as const)(
    '%s: every foreground meets AA on every background',
    (theme) => {
      const palette = palettes[theme];
      for (const bg of BACKGROUND_TOKENS) {
        for (const fg of FOREGROUND_TOKENS) {
          const ratio = contrastRatio(palette[fg], palette[bg]);
          expect(ratio, `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
            AA_NORMAL_TEXT,
          );
        }
      }
    },
  );

  it.each(['light', 'dark'] as const)('%s: text on the accent surface meets AA', (theme) => {
    // primary button は accent 背景。dark の accent 上の白は 3.25:1 しかないので、
    // accentOn を別に持たないと AA を満たせない（§17.1 の表には無い追加トークン）。
    const palette = palettes[theme];
    const ratio = contrastRatio(palette.accentOn, palette.accent);
    expect(ratio, `${theme}: accentOn is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it.each(['light', 'dark'] as const)('%s: the focus ring is visible on every surface', (theme) => {
    // §19「focus ring を消さない」。見えない ring は消したのと同じ。
    const palette = palettes[theme];
    for (const bg of BACKGROUND_TOKENS) {
      expect(contrastRatio(palette.focusRing, palette[bg])).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    }
  });

  it('keeps the accent for selection and primary action only', () => {
    // §17.1: accent は選択と primary action だけ。canvas / surface に使わない。
    for (const palette of [lightColors, darkColors]) {
      expect(palette.canvas).not.toBe(palette.accent);
      expect(palette.surface).not.toBe(palette.accent);
    }
  });

  it('rejects a malformed colour rather than silently scoring it', () => {
    expect(() => contrastRatio('not-a-color', '#FFFFFF')).toThrow(/hex color/);
  });
});

describe('typography', () => {
  it('stays inside the ranges the spec gives', () => {
    const ranges: Record<keyof typeof typography, [number, number]> = {
      pageTitle: [24, 28],
      sectionTitle: [16, 18],
      cardTitle: [14, 16],
      body: [14, 14],
      secondary: [12, 13],
      micro: [11, 12],
    };
    for (const [role, [min, max]] of Object.entries(ranges)) {
      const scale = typography[role as keyof typeof typography];
      expect(scale.size, role).toBeGreaterThanOrEqual(min);
      expect(scale.size, role).toBeLessThanOrEqual(max);
    }
  });

  it('never drops below the 12px readable floor for body copy', () => {
    expect(typography.body.size).toBeGreaterThanOrEqual(14);
    expect(typography.secondary.size).toBeGreaterThanOrEqual(12);
  });
});

describe('spacing and radius', () => {
  it('builds on an 8px base with a single 4px escape hatch', () => {
    expect(space.base).toBe(8);
    expect(space.compact).toBe(4);
    for (const [name, value] of Object.entries(space)) {
      if (name === 'compact') continue;
      expect(value % 8, `space.${name} breaks the 8px grid`).toBe(0);
    }
  });

  it('keeps card padding inside the 16–20px the spec allows', () => {
    // 20px は 8px グリッドから外れるが §17.3 が明示している値なので padding 側で持つ
    expect(padding.card).toBeGreaterThanOrEqual(16);
    expect(padding.cardLoose).toBeLessThanOrEqual(20);
    expect(padding.panel).toBe(24);
  });

  it('matches the radius values the spec fixes', () => {
    expect(radius.small).toBe(8);
    expect(radius.standard).toBe(12);
    expect(radius.dock).toBe(16);
  });
});

describe('motion', () => {
  it('stays inside the ranges the spec gives', () => {
    const ranges: Record<keyof typeof motion, [number, number]> = {
      hover: [80, 120],
      popover: [140, 180],
      dockMorph: [180, 220],
      workspaceExpand: [200, 260],
      successAck: [300, 500],
    };
    for (const [role, [min, max]] of Object.entries(ranges)) {
      const spec = motion[role as keyof typeof motion];
      expect(spec.durationMs, role).toBeGreaterThanOrEqual(min);
      expect(spec.durationMs, role).toBeLessThanOrEqual(max);
    }
  });

  it('keeps hover to properties that cannot shift layout', () => {
    expect(motion.hover.note).toContain('opacity');
  });
});

describe('layout', () => {
  it('uses the dimensions the spec fixes', () => {
    expect(layout.sidebar.expanded).toBe(208);
    expect(layout.sidebar.collapsed).toBe(64);
    expect(layout.topBar).toBe(56);
    expect(layout.mainMin).toBe(640);
    expect(layout.inspector).toBe(320);
  });

  it.each([
    [1440, 'wide'],
    [1280, 'wide'],
    [1279, 'medium'],
    [960, 'medium'],
    [959, 'compact'],
    [720, 'compact'],
    [719, 'unsupported'],
  ])('classifies %ipx as %s', (width, mode) => {
    expect(layoutModeFor(width)).toBe(mode);
  });

  it('keeps the inspector docked only when there is room for three columns', () => {
    expect(resolveLayout(1440, false).inspectorAsDrawer).toBe(false);
    expect(resolveLayout(1100, false).inspectorAsDrawer).toBe(true);
    expect(resolveLayout(800, false).inspectorAsDrawer).toBe(true);
  });

  it('overrides the user and collapses the sidebar when the main column would be squeezed', () => {
    // main の最低幅 640px を守る方を優先する
    expect(resolveLayout(1440, false).sidebarWidth).toBe(208);
    expect(resolveLayout(1440, true).sidebarWidth).toBe(64);
    expect(resolveLayout(1100, false).sidebarCollapsed).toBe(true);
    expect(resolveLayout(800, false).sidebarCollapsed).toBe(true);
  });

  it('leaves room for the main column at the three-column breakpoint', () => {
    const decision = resolveLayout(breakpoints.wide, false);
    const remaining = breakpoints.wide - decision.sidebarWidth - layout.inspector;
    expect(remaining).toBeGreaterThanOrEqual(layout.mainMin);
  });
});

describe('theme', () => {
  it('follows the OS when the mode is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('removes the attribute for system so prefers-color-scheme still applies', () => {
    const calls: string[] = [];
    const root = {
      setAttribute: (k: string, v: string) => calls.push(`set:${k}=${v}`),
      removeAttribute: (k: string) => calls.push(`remove:${k}`),
    };
    applyTheme(root, 'system');
    expect(calls).toEqual(['remove:data-theme']);
    applyTheme(root, 'dark');
    expect(calls).toContain('set:data-theme=dark');
  });

  it('validates stored values before trusting them', () => {
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('DARK')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });
});

describe('navigation', () => {
  it('has exactly four top-level tabs and no more (AC-12)', () => {
    expect(TOP_LEVEL_TABS).toHaveLength(4);
    expect(TOP_LEVEL_TABS.map((t) => t.id)).toEqual(['home', 'work', 'library', 'apps']);
  });

  it('states what each tab answers for the user', () => {
    for (const tab of TOP_LEVEL_TABS) {
      expect(tab.answers.length, tab.id).toBeGreaterThan(0);
      expect(tab.label.length, tab.id).toBeGreaterThan(0);
    }
  });

  it('maps a path to a tab and falls back to home', () => {
    expect(tabForPath('/work/123')).toBe('work');
    expect(tabForPath('/library')).toBe('library');
    expect(tabForPath('/nowhere')).toBe('home');
    expect(isTabId('apps')).toBe(true);
    expect(isTabId('agents')).toBe(false);
  });
});

describe('generated css', () => {
  it('emits a variable for every colour token in both themes', () => {
    for (const token of Object.keys(lightColors)) {
      const name = token.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      expect(TOKENS_CSS, token).toContain(`--astra-color-${name}:`);
    }
    expect(TOKENS_CSS).toContain(`:root[data-theme='dark']`);
    expect(TOKENS_CSS).toContain('prefers-color-scheme: dark');
  });

  it('keeps the focus ring and honours reduced motion', () => {
    expect(TOKENS_CSS).toContain(':focus-visible');
    expect(TOKENS_CSS).toContain('outline: 2px solid var(--astra-color-focus-ring)');
    expect(TOKENS_CSS).toContain('prefers-reduced-motion: reduce');
  });

  it('exposes layout and motion values so CSS never hardcodes them', () => {
    expect(TOKENS_CSS).toContain('--astra-layout-sidebar-expanded: 208px');
    expect(TOKENS_CSS).toContain('--astra-layout-top-bar: 56px');
    expect(TOKENS_CSS).toContain('--astra-motion-dock-morph-duration: 200ms');
  });
});
