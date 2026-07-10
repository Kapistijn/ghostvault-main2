import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { getLogger } from './core';
import { loadConfig } from './core/config';
import { registerServiceWorker } from './serviceWorkerRegistration';

/**
 * Load configuration for side effects (logger setup, version surfacing).
 * File logging is a Node-only concern (no fs in the browser), so we do not
 * configure it here; config.ts applies the env-aware log path on the Node
 * side. A failure here must never block rendering.
 */
async function initializeApp(): Promise<void> {
  try {
    const config = await loadConfig();
    const logger = getLogger('app', {
      enableConsole: config.logging.enableConsole,
      enableStorage: config.logging.enableStorage,
    });
    logger.info(`GhostVault v${config.version} gestart`);
  } catch (error) {
    console.error('[Config] Failed to load configuration, using defaults:', error);
  }
}

function render(): void {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element (#root) not found in index.html');
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Register the service worker, then render once. Config loading runs but must
// never gate the UI, so render happens regardless of its outcome.
registerServiceWorker();
initializeApp().finally(render);
