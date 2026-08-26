/**
 * Dock window のルート。main window とは別の window で動く（§4）。
 */
import type { ReactElement } from 'react';
import { ThemeProvider } from '../state/ThemeProvider.js';
import { TaskDock } from './TaskDock.js';
import './dock.css';

export function DockApp(): ReactElement {
  return (
    <ThemeProvider>
      <TaskDock />
    </ThemeProvider>
  );
}
