/**
 * トークンを CSS カスタムプロパティへ落とす。
 *
 * TypeScript のオブジェクトを唯一の正とし、CSS はそこから生成する。
 * 別々に手で持つと必ずずれる（色を 1 つ足したのに CSS 側を忘れる、など）。
 */
import { darkColors, lightColors, type ColorTokens } from './color.js';
import { fontStacks, typography } from './typography.js';
import { MIN_TOUCH_TARGET_PX, border, elevation, padding, radius, space } from './space.js';
import { motion, REDUCED_MOTION_DURATION_MS } from './motion.js';
import { breakpoints, layout, zIndex } from './layout.js';

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function colorVars(colors: ColorTokens): string[] {
  return Object.entries(colors).map(([name, value]) => `  --astra-color-${kebab(name)}: ${value};`);
}

function staticVars(): string[] {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(space))
    lines.push(`  --astra-space-${name}: ${value}px;`);
  for (const [name, value] of Object.entries(radius))
    lines.push(`  --astra-radius-${name}: ${value}px;`);
  for (const [name, value] of Object.entries(padding))
    lines.push(`  --astra-padding-${kebab(name)}: ${value}px;`);
  lines.push(`  --astra-border-hairline: ${border.hairline}px;`);
  for (const [name, value] of Object.entries(elevation))
    lines.push(`  --astra-elevation-${name}: ${value};`);
  for (const [role, scale] of Object.entries(typography)) {
    lines.push(`  --astra-font-size-${kebab(role)}: ${scale.size}px;`);
    lines.push(`  --astra-font-weight-${kebab(role)}: ${scale.weight};`);
    lines.push(`  --astra-line-height-${kebab(role)}: ${scale.lineHeight};`);
  }
  lines.push(`  --astra-font-sans: ${fontStacks.sans};`);
  lines.push(`  --astra-font-mono: ${fontStacks.mono};`);
  for (const [role, spec] of Object.entries(motion)) {
    lines.push(`  --astra-motion-${kebab(role)}-duration: ${spec.durationMs}ms;`);
    lines.push(`  --astra-motion-${kebab(role)}-easing: ${spec.easing};`);
  }
  lines.push(`  --astra-layout-sidebar-expanded: ${layout.sidebar.expanded}px;`);
  lines.push(`  --astra-layout-sidebar-collapsed: ${layout.sidebar.collapsed}px;`);
  lines.push(`  --astra-layout-top-bar: ${layout.topBar}px;`);
  lines.push(`  --astra-layout-main-min: ${layout.mainMin}px;`);
  lines.push(`  --astra-layout-inspector: ${layout.inspector}px;`);
  for (const [name, value] of Object.entries(zIndex)) lines.push(`  --astra-z-${name}: ${value};`);
  for (const [name, value] of Object.entries(breakpoints)) {
    lines.push(`  --astra-breakpoint-${name}: ${value}px;`);
  }
  return lines;
}

/** すべてのトークンを含む基底スタイル。アプリはこれを 1 度だけ挿す。 */
export function buildTokensCss(): string {
  return `:root {
${staticVars().join('\n')}
${colorVars(lightColors).join('\n')}
}

:root[data-theme='dark'] {
${colorVars(darkColors).join('\n')}
}

/* 明示指定が無いときは OS 設定に従う（テーマの既定は system） */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${colorVars(darkColors)
  .map((line) => `  ${line}`)
  .join('\n')}
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--astra-color-canvas);
  color: var(--astra-color-text);
  font-family: var(--astra-font-sans);
  font-size: var(--astra-font-size-body);
  line-height: var(--astra-line-height-body);
  -webkit-font-smoothing: antialiased;
}

/* §19: focus ring を消さない。色だけに頼らないよう offset も付ける。 */
:focus-visible {
  outline: 2px solid var(--astra-color-focus-ring);
  outline-offset: 2px;
  border-radius: var(--astra-radius-small);
}

/*
 * §19: 44px 相当の当たりを取る。**見た目ではなく当たりの大きさ。**
 * icon が 16px でも、押せる範囲はここまで広げる。
 * 中の並びは各コンポーネントが決めるので、大きさだけを与える。
 */
button,
[role='button'],
summary,
a[href] {
  min-height: ${MIN_TOUCH_TARGET_PX}px;
}

/* 文中のリンクまで 44px にすると、行が壊れる。文字の中は対象外。 */
p a[href],
li a[href],
span a[href] {
  min-height: 0;
}

/* §18: prefers-reduced-motion では morph を簡略化する */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: ${REDUCED_MOTION_DURATION_MS}ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: ${REDUCED_MOTION_DURATION_MS}ms !important;
    scroll-behavior: auto !important;
  }
}
`;
}

export const TOKENS_CSS = buildTokensCss();
