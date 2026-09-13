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
import { floatingSurface } from './dock.js';

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function colorVars(colors: ColorTokens): string[] {
  return Object.entries(colors).map(([name, value]) => `  --genie-color-${kebab(name)}: ${value};`);
}

function staticVars(): string[] {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(space))
    lines.push(`  --genie-space-${name}: ${value}px;`);
  for (const [name, value] of Object.entries(radius))
    lines.push(`  --genie-radius-${name}: ${value}px;`);
  for (const [name, value] of Object.entries(padding))
    lines.push(`  --genie-padding-${kebab(name)}: ${value}px;`);
  lines.push(`  --genie-border-hairline: ${border.hairline}px;`);
  for (const [name, value] of Object.entries(elevation))
    lines.push(`  --genie-elevation-${name}: ${value};`);
  for (const [role, scale] of Object.entries(typography)) {
    lines.push(`  --genie-font-size-${kebab(role)}: ${scale.size}px;`);
    lines.push(`  --genie-font-weight-${kebab(role)}: ${scale.weight};`);
    lines.push(`  --genie-line-height-${kebab(role)}: ${scale.lineHeight};`);
  }
  /*
   * 画面側が使っていた短い名前。**出していなかった。**
   * `var(--genie-font-size-sm, 0.875rem)` は黙って 14px に落ち、
   * §17.2 が 11–12px と定める micro の文字が body の大きさで出ていた。
   * 見た目は壊れないので、目で見ても気づけない。ここで実値に結ぶ。
   */
  lines.push(`  --genie-space-xs: ${space.compact}px;`);
  lines.push(`  --genie-space-sm: ${space.base}px;`);
  lines.push(`  --genie-space-md: ${space.lg}px;`);
  lines.push(`  --genie-radius-sm: ${radius.small}px;`);
  lines.push(`  --genie-font-size-sm: ${typography.micro.size}px;`);
  lines.push(`  --genie-font-sans: ${fontStacks.sans};`);
  lines.push(`  --genie-font-mono: ${fontStacks.mono};`);
  for (const [role, spec] of Object.entries(motion)) {
    lines.push(`  --genie-motion-${kebab(role)}-duration: ${spec.durationMs}ms;`);
    lines.push(`  --genie-motion-${kebab(role)}-easing: ${spec.easing};`);
  }
  lines.push(`  --genie-layout-sidebar-expanded: ${layout.sidebar.expanded}px;`);
  lines.push(`  --genie-layout-sidebar-collapsed: ${layout.sidebar.collapsed}px;`);
  lines.push(`  --genie-layout-top-bar: ${layout.topBar}px;`);
  lines.push(`  --genie-layout-main-min: ${layout.mainMin}px;`);
  lines.push(`  --genie-layout-inspector: ${layout.inspector}px;`);
  for (const [name, value] of Object.entries(zIndex)) lines.push(`  --genie-z-${name}: ${value};`);
  for (const [name, value] of Object.entries(breakpoints)) {
    lines.push(`  --genie-breakpoint-${name}: ${value}px;`);
  }
  // floating surface（Dock / HUD）。Deepgram の dark scheme を値の正として持つ
  for (const [name, value] of Object.entries(floatingSurface)) {
    lines.push(
      `  --genie-float-${kebab(name)}: ${typeof value === 'number' ? `${value}px` : value};`,
    );
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
  background: var(--genie-color-canvas);
  color: var(--genie-color-text);
  font-family: var(--genie-font-sans);
  font-size: var(--genie-font-size-body);
  line-height: var(--genie-line-height-body);
  -webkit-font-smoothing: antialiased;
}

/* §19: focus ring を消さない。色だけに頼らないよう offset も付ける。 */
:focus-visible {
  outline: 2px solid var(--genie-color-focus-ring);
  outline-offset: 2px;
  border-radius: var(--genie-radius-small);
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
