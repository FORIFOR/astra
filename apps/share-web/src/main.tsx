import { StrictMode, useEffect } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicShareClient } from '@astra/api-client';
import { TOKENS_CSS } from '@astra/ui-kit';
import { ShareViewer } from './ShareViewer.js';
import './share.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

const client = new PublicShareClient({
  baseUrl: import.meta.env.VITE_ASTRA_API_URL ?? 'http://127.0.0.1:3000',
});

function Root(): JSX.Element {
  useEffect(() => {
    if (document.getElementById('astra-tokens')) return;
    const style = document.createElement('style');
    style.id = 'astra-tokens';
    style.textContent = TOKENS_CSS;
    document.head.appendChild(style);
  }, []);
  return <ShareViewer client={client} />;
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
