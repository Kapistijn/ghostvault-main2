import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { getLogger } from './core';
import { loadConfig } from './core/config';
import { registerServiceWorker } from './serviceWorkerRegistration';

// Load configuration and configure logger
async function initializeApp() {
  try {
    const config = await loadConfig();
    
    // Configure logger with file logging if APP_LOGS_DIR is set
    const appLogsDir = typeof process !== 'undefined' && (process as any).env?.APP_LOGS_DIR || config.logging.logDirectory;
    const appVersion = typeof process !== 'undefined' && (process as any).env?.APP_VERSION || config.version;

    if (appLogsDir) {
      // Configure default logger to use file logging with version-specific subdirectory
      getLogger('app', {
        enableFileLogging: config.logging.enableFileLogging,
        logDirectory: appLogsDir,
        version: appVersion,
        enableConsole: config.logging.enableConsole,
        enableStorage: config.logging.enableStorage,
        maxFileSize: config.logging.maxFileSize,
        maxFiles: config.logging.maxFiles,
        compressOldLogs: config.logging.compressOldLogs,
        compressAfterDays: config.logging.compressAfterDays
      });
      
      const logger = getLogger('app');
      logger.info(`Logs komen in: ${appLogsDir}\\ghostvault_${appVersion}`);
      logger.info(`App versie: ${appVersion}`);
      logger.info(`Config loaded from config.json`);
    }
  } catch (error) {
    console.error('[Config] Failed to load configuration:', error);
    // Continue with default configuration
  }
}

// Initialize app then render
initializeApp().then(() => {
  // Register service worker
  registerServiceWorker();

  // Validate root element exists
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element not found');
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}).catch(error => {
  console.error('[Init] Failed to initialize app:', error);
  // Fallback render without config
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element not found');
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
