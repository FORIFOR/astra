/**
 * @astra/ui-kit
 *
 * Design tokens と共有 UI プリミティブ。
 * 正本: docs/spec/astra_ui_ux_detailed_spec_v0.1.docx §7・§17・§18・§19。
 *
 * トークンは TypeScript のオブジェクトが唯一の正で、CSS はそこから生成する。
 */
export * from './contrast.js';
export * from './tokens/color.js';
export * from './tokens/typography.js';
export * from './tokens/space.js';
export * from './tokens/motion.js';
export * from './tokens/layout.js';
export * from './tokens/dock.js';
export { buildTokensCss, TOKENS_CSS } from './tokens/css.js';
export * from './theme.js';
export * from './navigation.js';
export * from './shortcuts.js';
