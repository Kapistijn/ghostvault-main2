import { useState, useEffect, lazy, Suspense, memo } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import LoadingSpinner from './components/LoadingSpinner';

// Lazy load panels for better initial load performance
const EncryptPanel = lazy(() => import('./ui/EncryptPanel'));
const DecryptPanel = lazy(() => import('./ui/DecryptPanel'));
const GhostTrustedManager = lazy(() => import('./ui/GhostTrustedManager'));
const DebugPanel = lazy(() => import('./ui/DebugPanel'));
const ConfigEditor = lazy(() => import('./ui/ConfigEditor'));

// Loading component for lazy loaded panels
const LoadingPanel = memo(function LoadingPanel() {
  return (
    <div className="flex items-center justify-center p-12">
      <LoadingSpinner size="lg" text="Laden..." />
    </div>
  );
});

const App = memo(function App() {
  const [activeTab, setActiveTab] = useState<'encrypt' | 'decrypt' | 'trusted'>('encrypt');
  const [version, setVersion] = useState<string>('');
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [configLoaded, setConfigLoaded] = useState<boolean>(false);
  const [showConfigMenu, setShowConfigMenu] = useState<boolean>(false);
  const [config, setConfig] = useState<any>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Load version on mount
  useEffect(() => {
    // Read version from package.json with timeout
    const fetchVersion = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      try {
        const response = await fetch('/package.json', { signal: controller.signal });
        const pkg = await response.json();
        setVersion(pkg.version || '2.5');
      } catch (error) {
        setVersion('2.5');
      } finally {
        clearTimeout(timeoutId);
      }
    };
    
    fetchVersion();
    
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('ghostvault_theme') as 'dark' | 'light';
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('light', savedTheme === 'light');
    }
    
    // Load config
    import('./core/config').then(async ({ loadConfig }) => {
      try {
        const config = await loadConfig();
        setConfigLoaded(true);
        setConfig(config);
      } catch (error) {
        console.error('Failed to load config:', error);
        setConfigLoaded(false);
      }
    }).catch(() => {
      console.warn('Config module not available');
      setConfigLoaded(false);
    });
  }, []);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    // Set initial status
    setIsOnline(navigator.onLine);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.classList.toggle('light', newTheme === 'light');
    localStorage.setItem('ghostvault_theme', newTheme);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Validate key is a string
      if (typeof e.key !== 'string') return;
      
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '1') {
          e.preventDefault();
          setActiveTab('encrypt');
        } else if (e.key === '2') {
          e.preventDefault();
          setActiveTab('decrypt');
        } else if (e.key === '3') {
          e.preventDefault();
          setActiveTab('trusted');
        } else if (e.key === 'd') {
          e.preventDefault();
          // Toggle debug panel - use a more reliable selector
          const debugButtons = document.querySelectorAll('button');
          debugButtons.forEach(btn => {
            const className = (btn as HTMLButtonElement).className || '';
            if (className.includes('fixed') && className.includes('bottom-4') && className.includes('left-4')) {
              (btn as HTMLButtonElement).click();
            }
          });
        } else if (e.key === 'c') {
          e.preventDefault();
          // Toggle config menu
          setShowConfigMenu(!showConfigMenu);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [showConfigMenu]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-void p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <header className="mb-8 text-center">
            <h1 className="font-display text-4xl md:text-6xl tracking-widest text-neon-cyan">
              GHOSTVAULT v2
            </h1>
            <p className="mt-2 font-mono text-sm text-ghost-500">
              Streaming encrypted file storage for 1TB+ files
            </p>
            {version && (
              <p className="mt-1 font-mono text-xs text-ghost-600">
                v{version}
              </p>
            )}
          </header>

          <div className="mb-6 flex justify-center gap-4">
            <button
              onClick={() => setActiveTab('encrypt')}
              className={`font-display px-6 py-2 tracking-widest uppercase transition ${
                activeTab === 'encrypt'
                  ? 'text-neon-cyan border-b-2 border-neon-cyan'
                  : 'text-ghost-500 hover:text-ghost-300'
              }`}
              title="Versleutelen (Ctrl+1)"
            >
              Versleutelen
            </button>
            <button
              onClick={() => setActiveTab('decrypt')}
              className={`font-display px-6 py-2 tracking-widest uppercase transition ${
                activeTab === 'decrypt'
                  ? 'text-neon-magenta border-b-2 border-neon-magenta'
                  : 'text-ghost-500 hover:text-ghost-300'
              }`}
              title="Herstel (Ctrl+2)"
            >
              Herstel
            </button>
            <button
              onClick={() => setActiveTab('trusted')}
              className={`font-display px-6 py-2 tracking-widest uppercase transition ${
                activeTab === 'trusted'
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-ghost-500 hover:text-ghost-300'
              }`}
              title="GhostTrusted (Ctrl+3)"
            >
              GhostTrusted
            </button>
          </div>

          <Suspense fallback={<LoadingPanel />}>
            {activeTab === 'encrypt' && <EncryptPanel />}
            {activeTab === 'decrypt' && <DecryptPanel />}
            {activeTab === 'trusted' && <GhostTrustedManager />}
          </Suspense>

          <Suspense fallback={null}>
            <DebugPanel />
          </Suspense>

          {/* Online/Offline Status Indicator - Bottom Right */}
          <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={`flex items-center gap-2 px-3 py-1 rounded-lg font-mono text-[10px] transition-opacity hover:opacity-80 ${
                theme === 'dark'
                  ? 'bg-purple-900/30 text-purple-400 border border-purple-500/50'
                  : 'bg-yellow-900/30 text-yellow-400 border border-yellow-500/50'
              }`}
              title="Toggle theme (Ctrl+T)"
            >
              <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
              <span>{theme === 'dark' ? 'DARK' : 'LIGHT'}</span>
            </button>
            
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs ${
              isOnline 
                ? 'bg-green-900/30 text-green-400 border border-green-500/50' 
                : 'bg-red-900/30 text-red-400 border border-red-500/50'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'
              }`}></div>
              <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
            
            {/* Config Status Indicator */}
            <div 
              className={`flex items-center gap-2 px-3 py-1 rounded-lg font-mono text-[10px] cursor-pointer hover:opacity-80 transition-opacity ${
                configLoaded 
                  ? 'bg-blue-900/30 text-blue-400 border border-blue-500/50' 
                  : 'bg-orange-900/30 text-orange-400 border border-orange-500/50'
              }`}
              onClick={() => setShowConfigMenu(!showConfigMenu)}
              title="Klik om config menu te openen (Ctrl+C)"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${
                configLoaded ? 'bg-blue-400' : 'bg-orange-400'
              }`}></div>
              <span>{configLoaded ? 'CONFIG OK' : 'CONFIG ERROR'}</span>
            </div>
          </div>

          {/* Config Menu Modal */}
          {showConfigMenu && config && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70" onClick={() => setShowConfigMenu(false)}>
              <div 
                className="bg-void border border-ghost-500/30 rounded-lg p-6 max-w-4xl max-h-[80vh] overflow-y-auto w-full mx-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-display text-2xl text-neon-cyan">Config Editor</h2>
                  <button 
                    onClick={() => setShowConfigMenu(false)}
                    className="text-ghost-500 hover:text-ghost-300 text-2xl"
                  >
                    ×
                  </button>
                </div>
                
                <Suspense fallback={<LoadingPanel />}>
                  <ConfigEditor config={config} setConfig={setConfig} />
                </Suspense>
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
});

export default App;
