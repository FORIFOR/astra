import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { DockApp } from './dock/DockApp.js';
import { VoiceHudApp } from './voice/VoiceHudApp.js';
import { GalleryApp } from './gallery/Gallery.js';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

/**
 * Dock は別 window だが bundle は 1 つ。hash で入口を分ける。
 * window ごとに bundle を分けると、共有 state と token の重複読み込みが増える。
 */
const isDock = globalThis.location?.hash.startsWith('#/dock') ?? false;
const isVoiceHud = globalThis.location?.hash.startsWith('#/voice-hud') ?? false;
// 部品の見本帳。開発ビルドだけ。本番の bundle には hash を打っても入らない。
const isGallery =
  import.meta.env.DEV && (globalThis.location?.hash.startsWith('#/gallery') ?? false);

createRoot(container).render(
  <StrictMode>
    {isGallery ? <GalleryApp /> : isVoiceHud ? <VoiceHudApp /> : isDock ? <DockApp /> : <App />}
  </StrictMode>,
);
