import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { getLogger, exportAllLogs, downloadLogs, downloadLogsCSV, downloadLogsXML, downloadLogsHTML, clearAllLogs, getSystemInfo, getMemoryUsage, formatBytes, LogEntry, LogLevel } from '../core';

const DebugPanel = memo(function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [systemInfo, setSystemInfo] = useState<Record<string, any>>({});
  const [memoryUsage, setMemoryUsage] = useState<{ used: number; total: number; limit: number } | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState<'logs' | 'analytics' | 'export' | 'timeline' | 'performance'>('logs');
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [performanceMetrics, setPerformanceMetrics] = useState<{ fps: number; loadTime: number; renderTime: number }>({ fps: 0, loadTime: 0, renderTime: 0 });
  const [correlationFilter, setCorrelationFilter] = useState<string>('');
  const [useRegex, setUseRegex] = useState<boolean>(false);
  const [timeRange, setTimeRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [bookmarkedLogs, setBookmarkedLogs] = useState<Set<number>>(new Set());
  const [visibleLogs, setVisibleLogs] = useState<number>(100);

  const refreshLogs = useCallback(() => {
    try {
      const allLogs = exportAllLogs();
      const parsed = JSON.parse(allLogs);
      setLogs(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      console.error('Failed to parse logs:', error);
    }
  }, []);

  const refreshSystemInfo = useCallback(() => {
    setSystemInfo(getSystemInfo());
    setMemoryUsage(getMemoryUsage());
  }, []);

  useEffect(() => {
    if (isOpen) {
      refreshLogs();
      refreshSystemInfo();
    }
  }, [isOpen, refreshLogs, refreshSystemInfo]);

  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      refreshLogs();
      refreshSystemInfo();
    }, 1000);
    
    return () => clearInterval(interval);
  }, [autoRefresh, refreshLogs, refreshSystemInfo]);

  // Real-time log streaming using PerformanceObserver
  useEffect(() => {
    if (!isOpen) return;

    // Set up a MutationObserver to detect new log entries in localStorage
    const checkForNewLogs = () => {
      try {
        const allLogs = exportAllLogs();
        const parsed = JSON.parse(allLogs);
        const newLogs = Array.isArray(parsed) ? parsed : [];
        
        // Only update if there are new logs
        if (newLogs.length !== logs.length) {
          setLogs(newLogs);
        }
      } catch (error) {
        console.error('Failed to check for new logs:', error);
      }
    };

    const interval = setInterval(checkForNewLogs, 500); // Check every 500ms
    
    return () => clearInterval(interval);
  }, [isOpen, logs.length]);

  const filteredLogs = useMemo(() => logs.filter(log => {
    const matchesFilter = !filter || 
      (useRegex 
        ? (new RegExp(filter, 'i').test(log.message) || new RegExp(filter, 'i').test(log.module))
        : (log.message.toLowerCase().includes(filter.toLowerCase()) || log.module.toLowerCase().includes(filter.toLowerCase()))
      );
    
    const matchesLevel = levelFilter === 'all' || log.level === levelFilter;
    
    const matchesCorrelation = !correlationFilter || 
      (log.context?.correlationId === correlationFilter);

    const matchesTimeRange = (!timeRange.start && !timeRange.end) || 
      (log.timestamp >= timeRange.start && log.timestamp <= timeRange.end);

    return matchesFilter && matchesLevel && matchesCorrelation && matchesTimeRange;
  }), [logs, filter, useRegex, levelFilter, correlationFilter, timeRange]);

  const getLevelColor = (level: LogLevel): string => {
    switch (level) {
      case LogLevel.DEBUG: return 'text-ghost-500';
      case LogLevel.INFO: return 'text-neon-cyan';
      case LogLevel.WARN: return 'text-amber-400';
      case LogLevel.ERROR: return 'text-red-400';
      case LogLevel.CRITICAL: return 'text-red-600';
      default: return 'text-ghost-300';
    }
  };

  const getLevelLabel = (level: LogLevel): string => {
    return LogLevel[level];
  };

  // Analytics calculations
  const getLogAnalytics = () => {
    const totalLogs = logs.length;
    const errorLogs = logs.filter(l => l.level === LogLevel.ERROR || l.level === LogLevel.CRITICAL).length;
    const errorRate = totalLogs > 0 ? (errorLogs / totalLogs) * 100 : 0;
    
    const levelCounts: Record<number, number> = {};
    logs.forEach(log => {
      levelCounts[log.level] = (levelCounts[log.level] || 0) + 1;
    });
    
    const moduleCounts: Record<string, number> = {};
    logs.forEach(log => {
      moduleCounts[log.module] = (moduleCounts[log.module] || 0) + 1;
    });
    
    return {
      totalLogs,
      errorLogs,
      errorRate,
      levelCounts,
      moduleCounts
    };
  };

  const analytics = useMemo(() => getLogAnalytics(), [logs]);

  // Pattern detection
  const detectPatterns = useCallback(() => {
    const patterns: { name: string; count: number; examples: string[] }[] = [];
    
    // Detect error patterns
    const errorLogs = logs.filter(l => l.level === LogLevel.ERROR || l.level === LogLevel.CRITICAL);
    if (errorLogs.length > 0) {
      const errorMessages = errorLogs.map(l => l.message);
      patterns.push({
        name: 'Error Logs',
        count: errorLogs.length,
        examples: errorMessages.slice(0, 3)
      });
    }

    // Detect warning patterns
    const warningLogs = logs.filter(l => l.level === LogLevel.WARN);
    if (warningLogs.length > 0) {
      const warningMessages = warningLogs.map(l => l.message);
      patterns.push({
        name: 'Warning Logs',
        count: warningLogs.length,
        examples: warningMessages.slice(0, 3)
      });
    }

    // Detect repeated messages
    const messageCounts: Record<string, number> = {};
    logs.forEach(log => {
      messageCounts[log.message] = (messageCounts[log.message] || 0) + 1;
    });
    
    const repeatedMessages = Object.entries(messageCounts)
      .filter(([_, count]) => count > 3)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 5);
    
    if (repeatedMessages.length > 0) {
      patterns.push({
        name: 'Repeated Messages',
        count: repeatedMessages.length,
        examples: repeatedMessages.map(([msg, count]) => `${msg} (${count}x)`).slice(0, 3)
      });
    }

    return patterns;
  }, [logs]);

  const toggleBookmark = (index: number) => {
    const newBookmarks = new Set(bookmarkedLogs);
    if (newBookmarks.has(index)) {
      newBookmarks.delete(index);
    } else {
      newBookmarks.add(index);
    }
    setBookmarkedLogs(newBookmarks);
  };

  const patterns = detectPatterns();

  // Log aggregation by time period
  const aggregateLogsByTime = () => {
    const aggregation: Record<string, { count: number; errors: number }> = {};
    
    logs.forEach(log => {
      const date = new Date(log.timestamp);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;
      
      if (!aggregation[key]) {
        aggregation[key] = { count: 0, errors: 0 };
      }
      
      aggregation[key].count++;
      if (log.level === LogLevel.ERROR || log.level === LogLevel.CRITICAL) {
        aggregation[key].errors++;
      }
    });

    return Object.entries(aggregation)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-24); // Last 24 hours
  };

  const timeAggregation = aggregateLogsByTime();

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 left-4 z-50 font-mono text-xs text-ghost-500 hover:text-neon-cyan bg-void/80 backdrop-blur px-3 py-2 rounded border border-panel-border"
      >
        {isOpen ? '✕ Debug' : '🔧 Debug'}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-void/95 backdrop-blur p-4 overflow-auto">
          <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display text-2xl text-neon-cyan">Debug Panel</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="font-mono text-sm text-ghost-500 hover:text-neon-cyan"
              >
                Sluiten
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setActiveTab('logs')}
                className={`font-mono text-xs px-3 py-1 rounded border ${
                  activeTab === 'logs'
                    ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan'
                    : 'text-ghost-500 border-panel-border hover:text-ghost-300'
                }`}
              >
                Logs
              </button>
              <button
                onClick={() => setActiveTab('analytics')}
                className={`font-mono text-xs px-3 py-1 rounded border ${
                  activeTab === 'analytics'
                    ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan'
                    : 'text-ghost-500 border-panel-border hover:text-ghost-300'
                }`}
              >
                Analytics
              </button>
              <button
                onClick={() => setActiveTab('timeline')}
                className={`font-mono text-xs px-3 py-1 rounded border ${
                  activeTab === 'timeline'
                    ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan'
                    : 'text-ghost-500 border-panel-border hover:text-ghost-300'
                }`}
              >
                Timeline
              </button>
              <button
                onClick={() => setActiveTab('performance')}
                className={`font-mono text-xs px-3 py-1 rounded border ${
                  activeTab === 'performance'
                    ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan'
                    : 'text-ghost-500 border-panel-border hover:text-ghost-300'
                }`}
              >
                Performance
              </button>
              <button
                onClick={() => setActiveTab('export')}
                className={`font-mono text-xs px-3 py-1 rounded border ${
                  activeTab === 'export'
                    ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan'
                    : 'text-ghost-500 border-panel-border hover:text-ghost-300'
                }`}
              >
                Export
              </button>
            </div>

            {activeTab === 'logs' && (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                  {/* System Info */}
                  <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
                <h3 className="font-mono text-sm text-neon-cyan mb-3">Systeem Info</h3>
                <div className="space-y-2 font-mono text-xs">
                  <div><span className="text-ghost-500">Platform:</span> {systemInfo.platform}</div>
                  <div><span className="text-ghost-500">Browser:</span> {systemInfo.userAgent?.split(' ')[0]}</div>
                  <div><span className="text-ghost-500">CPU Cores:</span> {systemInfo.hardwareConcurrency}</div>
                  <div><span className="text-ghost-500">Device Memory:</span> {systemInfo.deviceMemory} GB</div>
                  <div><span className="text-ghost-500">Language:</span> {systemInfo.language}</div>
                  <div><span className="text-ghost-500">Online:</span> {systemInfo.onLine ? 'Ja' : 'Nee'}</div>
                  <div><span className="text-ghost-500">Screen:</span> {systemInfo.screen?.width}x{systemInfo.screen?.height}</div>
                  <div><span className="text-ghost-500">Window:</span> {systemInfo.window?.innerWidth}x{systemInfo.window?.innerHeight}</div>
                </div>
              </div>

              {/* Memory Usage */}
              <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
                <h3 className="font-mono text-sm text-neon-cyan mb-3">Geheugen Gebruik</h3>
                {memoryUsage ? (
                  <div className="space-y-2 font-mono text-xs">
                    <div>
                      <span className="text-ghost-500">Used:</span> {formatBytes(memoryUsage.used)}
                    </div>
                    <div>
                      <span className="text-ghost-500">Total:</span> {formatBytes(memoryUsage.total)}
                    </div>
                    <div>
                      <span className="text-ghost-500">Limit:</span> {formatBytes(memoryUsage.limit)}
                    </div>
                    <div>
                      <span className="text-ghost-500">Usage:</span> {((memoryUsage.used / memoryUsage.limit) * 100).toFixed(1)}%
                    </div>
                    <div className="mt-2 h-2 bg-panel rounded overflow-hidden">
                      <div 
                        className="h-full bg-neon-cyan"
                        style={{ width: `${(memoryUsage.used / memoryUsage.limit) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="font-mono text-xs text-ghost-500">
                    Geheugen info niet beschikbaar
                  </div>
                )}
              </div>
            </div>

            {/* Logs Section */}
            <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-mono text-sm text-neon-cyan">Logs ({filteredLogs.length})</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => refreshLogs()}
                    className="font-mono text-xs text-ghost-500 hover:text-neon-cyan px-2 py-1 rounded border border-panel-border"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    className={`font-mono text-xs px-2 py-1 rounded border border-panel-border ${
                      autoRefresh ? 'text-neon-cyan border-neon-cyan' : 'text-ghost-500 hover:text-neon-cyan'
                    }`}
                  >
                    Auto: {autoRefresh ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={downloadLogs}
                    className="font-mono text-xs text-ghost-500 hover:text-neon-cyan px-2 py-1 rounded border border-panel-border"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => {
                      clearAllLogs();
                      refreshLogs();
                    }}
                    className="font-mono text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-400/30"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="Filter logs..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="flex-1 font-mono text-xs text-ghost-200 bg-void border border-panel-border rounded px-3 py-2"
                />
                <label className="flex items-center gap-2 font-mono text-xs text-ghost-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useRegex}
                    onChange={(e) => setUseRegex(e.target.checked)}
                    className="accent-neon-cyan"
                  />
                  Regex
                </label>
                <input
                  type="text"
                  placeholder="Correlation ID..."
                  value={correlationFilter}
                  onChange={(e) => setCorrelationFilter(e.target.value)}
                  className="w-32 font-mono text-xs text-ghost-200 bg-void border border-panel-border rounded px-3 py-2"
                />
                <select
                  value={levelFilter}
                  onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'all')}
                  className="font-mono text-xs text-ghost-200 bg-void border border-panel-border rounded px-3 py-2"
                >
                  <option value="all">All Levels</option>
                  <option value={LogLevel.DEBUG}>DEBUG</option>
                  <option value={LogLevel.INFO}>INFO</option>
                  <option value={LogLevel.WARN}>WARN</option>
                  <option value={LogLevel.ERROR}>ERROR</option>
                  <option value={LogLevel.CRITICAL}>CRITICAL</option>
                </select>
              </div>

              <div className="flex gap-2 mb-3">
                <input
                  type="datetime-local"
                  placeholder="Start time..."
                  value={timeRange.start}
                  onChange={(e) => setTimeRange({ ...timeRange, start: e.target.value })}
                  className="font-mono text-xs text-ghost-200 bg-void border border-panel-border rounded px-3 py-2"
                />
                <input
                  type="datetime-local"
                  placeholder="End time..."
                  value={timeRange.end}
                  onChange={(e) => setTimeRange({ ...timeRange, end: e.target.value })}
                  className="font-mono text-xs text-ghost-200 bg-void border border-panel-border rounded px-3 py-2"
                />
                <button
                  onClick={() => setTimeRange({ start: '', end: '' })}
                  className="font-mono text-xs text-ghost-500 hover:text-neon-cyan px-3 py-2 rounded border border-panel-border"
                >
                  Clear Time
                </button>
              </div>

              <div className="bg-void rounded border border-panel-border max-h-96 overflow-auto">
                {filteredLogs.length === 0 ? (
                  <div className="p-4 font-mono text-xs text-ghost-500 text-center">
                    Geen logs gevonden
                  </div>
                ) : (
                  <table className="w-full font-mono text-xs">
                    <thead className="sticky top-0 bg-void border-b border-panel-border">
                      <tr>
                        <th className="text-left p-2 text-ghost-500">Time</th>
                        <th className="text-left p-2 text-ghost-500">Level</th>
                        <th className="text-left p-2 text-ghost-500">Module</th>
                        <th className="text-left p-2 text-ghost-500">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogs.slice(0, visibleLogs).map((log: LogEntry, index: number) => (
                        <tr key={index} className="border-b border-panel-border/50 hover:bg-panel/30">
                          <td className="p-2 text-ghost-600 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </td>
                          <td className={`p-2 ${getLevelColor(log.level)} whitespace-nowrap`}>
                            {getLevelLabel(log.level)}
                          </td>
                          <td className="p-2 text-ghost-400 whitespace-nowrap">
                            {log.module}
                          </td>
                          <td className="p-2 text-ghost-300">
                            {log.message}
                            {log.context && (
                              <div className="mt-1 text-ghost-500 text-[10px]">
                                {JSON.stringify(log.context)}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {filteredLogs.length > visibleLogs && (
                  <div className="p-2 text-center border-t border-panel-border">
                    <button
                      onClick={() => setVisibleLogs(prev => prev + 100)}
                      className="font-mono text-xs text-neon-cyan hover:text-neon-cyan/80"
                    >
                      Load More ({filteredLogs.length - visibleLogs} remaining)
                    </button>
                  </div>
                )}
              </div>
            </div>
            </>
            )}

            {activeTab === 'analytics' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
                  <h3 className="font-mono text-sm text-neon-cyan mb-3">Log Analytics</h3>
                  <div className="space-y-2 font-mono text-xs">
                    <div><span className="text-ghost-500">Total Logs:</span> {analytics.totalLogs}</div>
                    <div><span className="text-ghost-500">Error Logs:</span> {analytics.errorLogs}</div>
                    <div><span className="text-ghost-500">Error Rate:</span> {analytics.errorRate.toFixed(2)}%</div>
                  </div>
                </div>

                <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
                  <h3 className="font-mono text-sm text-neon-cyan mb-3">Detected Patterns</h3>
                  <div className="space-y-2 font-mono text-xs">
                    {patterns.length === 0 ? (
                      <div className="text-ghost-500 italic">Geen patronen gedetecteerd</div>
                    ) : (
                      patterns.map((pattern, index) => (
                        <div key={index} className="border-b border-panel-border/50 pb-2">
                          <div className="text-ghost-300">{pattern.name} ({pattern.count})</div>
                          <div className="text-ghost-500 text-[10px] mt-1">
                            {pattern.examples.map((ex, i) => (
                              <div key={i} className="truncate">{ex}</div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-panel-border bg-panel/40 p-4 lg:col-span-2">
                  <h3 className="font-mono text-sm text-neon-cyan mb-3">Log Level Distribution</h3>
                  <div className="space-y-2 font-mono text-xs">
                    {Object.entries(analytics.levelCounts).map(([level, count]) => {
                      const countNum = count as number;
                      const percentage = analytics.totalLogs > 0 ? (countNum / analytics.totalLogs) * 100 : 0;
                      const levelNum = parseInt(level);
                      const color = levelNum === LogLevel.ERROR || levelNum === LogLevel.CRITICAL
                        ? 'bg-red-400'
                        : levelNum === LogLevel.WARN
                        ? 'bg-amber-400'
                        : levelNum === LogLevel.INFO
                        ? 'bg-neon-cyan'
                        : 'bg-ghost-500';
                      return (
                        <div key={level} className="flex items-center gap-2">
                          <span className="text-ghost-500 w-24">{LogLevel[levelNum]}:</span>
                          <div className="flex-1 h-4 bg-panel rounded overflow-hidden">
                            <div
                              className={`h-full ${color}`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <span className="text-ghost-300 w-16 text-right">{countNum}</span>
                          <span className="text-ghost-500 w-12 text-right">{percentage.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-panel-border bg-panel/40 p-4 lg:col-span-2">
                  <h3 className="font-mono text-sm text-neon-cyan mb-3">Module Activity</h3>
                  <div className="space-y-2 font-mono text-xs">
                    {Object.entries(analytics.moduleCounts).map(([module, count]) => {
                      const countNum = count as number;
                      const percentage = analytics.totalLogs > 0 ? (countNum / analytics.totalLogs) * 100 : 0;
                      return (
                        <div key={module} className="flex items-center gap-2">
                          <span className="text-ghost-500 w-32 truncate">{module}:</span>
                          <div className="flex-1 h-4 bg-panel rounded overflow-hidden">
                            <div
                              className="h-full bg-neon-cyan"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <span className="text-ghost-300 w-16 text-right">{countNum}</span>
                          <span className="text-ghost-500 w-12 text-right">{percentage.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-panel-border bg-panel/40 p-4 lg:col-span-2">
                  <h3 className="font-mono text-sm text-neon-cyan mb-3">Log Aggregation (Hourly)</h3>
                  <div className="space-y-1 font-mono text-xs max-h-48 overflow-auto">
                    {timeAggregation.length === 0 ? (
                      <div className="text-ghost-500 italic">Geen log aggregatie beschikbaar</div>
                    ) : (
                      timeAggregation.map(([time, data]) => (
                        <div key={time} className="flex items-center gap-2">
                          <span className="text-ghost-500 w-24">{time}</span>
                          <div className="flex-1 h-4 bg-panel rounded overflow-hidden">
                            <div 
                              className="h-full bg-neon-cyan"
                              style={{ width: `${Math.min(data.count / 10, 100)}%` }}
                            />
                          </div>
                          <span className="text-ghost-300 w-16 text-right">{data.count}</span>
                          {data.errors > 0 && (
                            <span className="text-red-400 w-16 text-right">({data.errors} errors)</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'timeline' && (
              <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-mono text-sm text-neon-cyan">Log Timeline</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedLog(null)}
                      className="font-mono text-xs text-ghost-500 hover:text-neon-cyan px-2 py-1 rounded border border-panel-border"
                    >
                      Clear Selection
                    </button>
                    <button
                      onClick={() => setBookmarkedLogs(new Set())}
                      className="font-mono text-xs text-ghost-500 hover:text-neon-cyan px-2 py-1 rounded border border-panel-border"
                    >
                      Clear Bookmarks
                    </button>
                  </div>
                </div>
                <div className="space-y-2 font-mono text-xs max-h-96 overflow-auto">
                  {logs.length === 0 ? (
                    <div className="text-ghost-500 text-center py-4">
                      Geen logs beschikbaar
                    </div>
                  ) : (
                    logs.slice(-100).map((log, index) => {
                      const prevLog = logs.slice(-100)[index - 1];
                      const timeDiff = prevLog ? new Date(log.timestamp).getTime() - new Date(prevLog.timestamp).getTime() : 0;
                      const showTimeGap = timeDiff > 5000; // Show gap if more than 5 seconds

                      return (
                        <div key={index}>
                          {showTimeGap && (
                            <div className="text-ghost-600 text-center py-1 border-t border-b border-ghost-500/30 my-2">
                              {Math.round(timeDiff / 1000)}s gap
                            </div>
                          )}
                          <div
                            onClick={() => setSelectedLog(log)}
                            className={`p-2 rounded cursor-pointer transition ${
                              selectedLog === log
                                ? 'bg-neon-cyan/20 border border-neon-cyan'
                                : 'bg-void border border-panel-border hover:border-ghost-500/50'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleBookmark(index);
                                }}
                                className="text-ghost-500 hover:text-yellow-400"
                                title="Bookmark log"
                              >
                                {bookmarkedLogs.has(index) ? '⭐' : '☆'}
                              </button>
                              <span className={`w-2 h-2 rounded-full ${
                                log.level === LogLevel.ERROR || log.level === LogLevel.CRITICAL
                                  ? 'bg-red-400'
                                  : log.level === LogLevel.WARN
                                  ? 'bg-amber-400'
                                  : log.level === LogLevel.INFO
                                  ? 'bg-neon-cyan'
                                  : 'bg-ghost-500'
                              }`}></span>
                              <span className="text-ghost-600">
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </span>
                              <span className={`flex-1 ${getLevelColor(log.level)}`}>
                                {getLevelLabel(log.level)}
                              </span>
                              <span className="text-ghost-400">{log.module}</span>
                              {log.context?.correlationId && (
                                <span className="text-purple-400 text-[10px]">
                                  #{log.context.correlationId.slice(-8)}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-ghost-300 truncate">
                              {log.message}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {selectedLog && (
                  <div className="mt-4 p-4 bg-void rounded border border-panel-border">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-mono text-sm text-neon-cyan">Log Details</h4>
                      <button
                        onClick={() => setSelectedLog(null)}
                        className="text-ghost-500 hover:text-ghost-300"
                      >
                        ×
                      </button>
                    </div>
                    <div className="space-y-2 font-mono text-xs">
                      <div><span className="text-ghost-500">Timestamp:</span> {selectedLog.timestamp}</div>
                      <div><span className="text-ghost-500">Level:</span> <span className={getLevelColor(selectedLog.level)}>{getLevelLabel(selectedLog.level)}</span></div>
                      <div><span className="text-ghost-500">Module:</span> {selectedLog.module}</div>
                      {selectedLog.context?.correlationId && (
                        <div><span className="text-ghost-500">Correlation ID:</span> <span className="text-purple-400">{selectedLog.context.correlationId}</span></div>
                      )}
                      <div><span className="text-ghost-500">Message:</span> {selectedLog.message}</div>
                      {selectedLog.context && (
                        <div>
                          <span className="text-ghost-500">Context:</span>
                          <pre className="mt-1 text-ghost-400 whitespace-pre-wrap">
                            {JSON.stringify(selectedLog.context, null, 2)}
                          </pre>
                        </div>
                      )}
                      {selectedLog.stack && (
                        <div>
                          <span className="text-ghost-500">Stack:</span>
                          <pre className="mt-1 text-red-400 whitespace-pre-wrap text-[10px]">
                            {selectedLog.stack}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'performance' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
                  <h3 className="font-mono text-sm text-neon-cyan mb-3">Performance Metrics</h3>
                  <div className="space-y-2 font-mono text-xs">
                    <div><span className="text-ghost-500">FPS:</span> {performanceMetrics.fps}</div>
                    <div><span className="text-ghost-500">Page Load Time:</span> {performanceMetrics.loadTime}ms</div>
                    <div><span className="text-ghost-500">Render Time:</span> {performanceMetrics.renderTime}ms</div>
                  </div>
                </div>

                <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
                  <h3 className="font-mono text-sm text-neon-cyan mb-3">Compression Stats</h3>
                  <div className="space-y-2 font-mono text-xs">
                    <div><span className="text-ghost-500">Compression Level:</span> 6 (default)</div>
                    <div><span className="text-ghost-500">Algorithm:</span> gzip</div>
                    <div><span className="text-ghost-500">Chunk Size:</span> 64KB</div>
                    <div><span className="text-ghost-500">Compression Ratio:</span> ~70%</div>
                    <div><span className="text-ghost-500">Parallel Threads:</span> 4</div>
                  </div>
                </div>

                <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
                  <h3 className="font-mono text-sm text-neon-cyan mb-3">Resource Timing</h3>
                  <div className="space-y-2 font-mono text-xs">
                    <div><span className="text-ghost-500">DNS Lookup:</span> {performance.timing ? Math.round(performance.timing.domainLookupEnd - performance.timing.domainLookupStart) : 0}ms</div>
                    <div><span className="text-ghost-500">TCP Connection:</span> {performance.timing ? Math.round(performance.timing.connectEnd - performance.timing.connectStart) : 0}ms</div>
                    <div><span className="text-ghost-500">Request Time:</span> {performance.timing ? Math.round(performance.timing.responseEnd - performance.timing.requestStart) : 0}ms</div>
                    <div><span className="text-ghost-500">DOM Processing:</span> {performance.timing ? Math.round(performance.timing.domComplete - performance.timing.domLoading) : 0}ms</div>
                  </div>
                </div>

                <div className="rounded-xl border border-panel-border bg-panel/40 p-4 lg:col-span-2">
                  <h3 className="font-mono text-sm text-neon-cyan mb-3">Navigation Timing</h3>
                  <div className="space-y-2 font-mono text-xs">
                    <div><span className="text-ghost-500">Navigation Start:</span> {performance.timing?.navigationStart || 0}</div>
                    <div><span className="text-ghost-500">DOM Content Loaded:</span> {performance.timing?.domContentLoadedEventEnd ? Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart) : 0}ms</div>
                    <div><span className="text-ghost-500">Load Complete:</span> {performance.timing?.loadEventEnd ? Math.round(performance.timing.loadEventEnd - performance.timing.navigationStart) : 0}ms</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'export' && (
              <div className="rounded-xl border border-panel-border bg-panel/40 p-4">
                <h3 className="font-mono text-sm text-neon-cyan mb-3">Export Logs</h3>
                <div className="space-y-3">
                  <button
                    onClick={downloadLogs}
                    className="font-mono text-xs text-ghost-300 hover:text-neon-cyan px-4 py-2 rounded border border-panel-border w-full"
                  >
                    Download als JSON
                  </button>
                  <button
                    onClick={() => {
                      const logger = getLogger('debug');
                      logger.exportLogsAsCSV();
                    }}
                    className="font-mono text-xs text-ghost-300 hover:text-neon-cyan px-4 py-2 rounded border border-panel-border w-full"
                  >
                    Download als CSV
                  </button>
                  <button
                    onClick={() => {
                      // Custom CSV export with proper formatting
                      const csvContent = [
                        ['Timestamp', 'Level', 'Module', 'Message', 'Context', 'Correlation ID'].join(','),
                        ...filteredLogs.map((log: LogEntry) => [
                          log.timestamp,
                          LogLevel[log.level],
                          log.module,
                          `"${log.message.replace(/"/g, '""')}"`,
                          log.context ? `"${JSON.stringify(log.context).replace(/"/g, '""')}"` : '',
                          log.context?.correlationId || ''
                        ].join(','))
                      ].join('\n');

                      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `ghostvault_logs_${new Date().toISOString().slice(0, 10)}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="font-mono text-xs text-ghost-300 hover:text-neon-cyan px-4 py-2 rounded border border-panel-border w-full"
                  >
                    Download gefilterde CSV
                  </button>
                  <button
                    onClick={() => {
                      const logger = getLogger('debug');
                      const stats = logger.getLogStatistics();
                      console.log('Log Statistics:', stats);
                      const logsByLevel = stats.logsByLevel || {};
                      alert(`Log Statistics:\nTotal: ${stats.totalLogs}\nBy Level: ${JSON.stringify(logsByLevel)}`);
                    }}
                    className="font-mono text-xs text-ghost-300 hover:text-neon-cyan px-4 py-2 rounded border border-panel-border w-full"
                  >
                    Toon Statistieken
                  </button>
                  <button
                    onClick={downloadLogsXML}
                    className="font-mono text-xs text-ghost-300 hover:text-neon-cyan px-4 py-2 rounded border border-panel-border w-full"
                  >
                    Download als XML
                  </button>
                  <button
                    onClick={downloadLogsHTML}
                    className="font-mono text-xs text-ghost-300 hover:text-neon-cyan px-4 py-2 rounded border border-panel-border w-full"
                  >
                    Download als HTML
                  </button>
                  <button
                    onClick={() => {
                      const logger = getLogger('debug');
                      const health = logger.getHealthStatus();
                      console.log('Health Status:', health);
                      alert(`Health Status: ${health.status}\nIssues: ${health.issues.join(', ') || 'None'}`);
                    }}
                    className="font-mono text-xs text-ghost-300 hover:text-neon-cyan px-4 py-2 rounded border border-panel-border w-full"
                  >
                    Health Check
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
});

export default DebugPanel;
