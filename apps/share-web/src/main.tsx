import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Phase 0 scaffold. Share links are a Phase 2 deliverable
 * (product spec §2.3 "Share機能").
 */
const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <main>Astra Share — Phase 0 scaffold</main>
  </StrictMode>,
);
