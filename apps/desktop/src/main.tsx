import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { DockApp } from './dock/DockApp.js';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

/**
 * Dock は別 window だが bundle は 1 つ。hash で入口を分ける。
 * window ごとに bundle を分けると、共有 state と token の重複読み込みが増える。
 */
const isDock = globalThis.location?.hash.startsWith('#/dock') ?? false;

createRoot(container).render(<StrictMode>{isDock ? <DockApp /> : <App />}</StrictMode>);
