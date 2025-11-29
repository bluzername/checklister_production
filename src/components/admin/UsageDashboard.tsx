'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
    Activity, 
    Server, 
    Clock, 
    DollarSign, 
    CheckCircle, 
    XCircle,
    Database,
    Zap,
    RefreshCw,
    TrendingUp
} from 'lucide-react';

// Import types from logger (we'll fetch data via server action)
interface ApiLogEntry {
    id: string;
    timestamp: Date;
    service: 'yahoo' | 'eodhd' | 'claude' | 'cache';
    operation: string;
    ticker: string;
    latency_ms: number;
    success: boolean;
    error?: string;
    cached?: boolean;
}

interface ApiStats {
    total_calls: number;
    successful_calls: number;
    failed_calls: number;
    cache_hits: number;
    avg_latency_ms: number;
    calls_by_service: Record<string, number>;
    calls_today: number;
    calls_this_week: number;
    estimated_cost: number;
}

interface CacheStats {
    size: number;
    keys: string[];
    memoryEstimate: string;
}

// Service colors
const SERVICE_COLORS: Record<string, string> = {
    yahoo: 'bg-purple-100 text-purple-700',
    eodhd: 'bg-blue-100 text-blue-700',
    claude: 'bg-orange-100 text-orange-700',
    cache: 'bg-green-100 text-green-700',
};

const SERVICE_ICONS: Record<string, React.ReactNode> = {
    yahoo: <TrendingUp className="w-4 h-4" />,
    eodhd: <Database className="w-4 h-4" />,
    claude: <Zap className="w-4 h-4" />,
    cache: <Server className="w-4 h-4" />,
};

function StatCard({ 
    title, 
    value, 
    subtitle, 
    icon, 
    color = 'teal' 
}: { 
    title: string; 
    value: string | number; 
    subtitle?: string;
    icon: React.ReactNode;
    color?: string;
}) {
    const colorClasses: Record<string, string> = {
        teal: 'from-teal-400 to-teal-600',
        blue: 'from-blue-400 to-blue-600',
        green: 'from-green-400 to-green-600',
        amber: 'from-amber-400 to-amber-600',
        purple: 'from-purple-400 to-purple-600',
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center`}>
                    <div className="text-white">{icon}</div>
                </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500">{title}</div>
            {subtitle && <div className="text-xs text-gray-400 mt-1">{subtitle}</div>}
        </div>
    );
}

function LogsTable({ logs }: { logs: ApiLogEntry[] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-gray-50">
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Time</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Service</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Operation</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Ticker</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Latency</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {logs.length === 0 ? (
                        <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                                No API calls logged yet. Run an analysis to see logs here.
                            </td>
                        </tr>
                    ) : (
                        logs.map((log) => (
                            <tr key={log.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                                    {new Date(log.timestamp).toLocaleTimeString()}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${SERVICE_COLORS[log.service]}`}>
                                        {SERVICE_ICONS[log.service]}
                                        {log.service}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-gray-700">{log.operation}</td>
                                <td className="px-4 py-3 font-mono font-medium text-gray-900">{log.ticker}</td>
                                <td className="px-4 py-3 text-right font-mono text-gray-600">
                                    {log.cached ? (
                                        <span className="text-green-600">cached</span>
                                    ) : (
                                        `${log.latency_ms}ms`
                                    )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    {log.success ? (
                                        <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />
                                    ) : (
                                        <div className="flex items-center justify-center gap-1">
                                            <XCircle className="w-5 h-5 text-red-500" />
                                            {log.error && (
                                                <span className="text-xs text-red-500 max-w-[150px] truncate" title={log.error}>
                                                    {log.error}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

function ServiceBreakdown({ callsByService }: { callsByService: Record<string, number> }) {
    const total = Object.values(callsByService).reduce((a, b) => a + b, 0);
    
    return (
        <div className="space-y-3">
            {Object.entries(callsByService).map(([service, count]) => {
                const percentage = total > 0 ? (count / total) * 100 : 0;
                return (
                    <div key={service}>
                        <div className="flex items-center justify-between mb-1">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${SERVICE_COLORS[service]}`}>
                                {SERVICE_ICONS[service]}
                                {service}
                            </span>
                            <span className="text-sm font-medium text-gray-700">{count} calls</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                                className={`h-full ${service === 'yahoo' ? 'bg-purple-500' : service === 'eodhd' ? 'bg-blue-500' : service === 'claude' ? 'bg-orange-500' : 'bg-green-500'}`}
                                style={{ width: `${percentage}%` }}
                            />
                        </div>
                    </div>
                );
            })}
            {Object.keys(callsByService).length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No service calls recorded</p>
            )}
        </div>
    );
}

export function UsageDashboard() {
    const [stats, setStats] = useState<ApiStats | null>(null);
    const [logs, setLogs] = useState<ApiLogEntry[]>([]);
    const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const fetchData = useCallback(async () => {
        try {
            const response = await fetch('/api/admin/stats');
            if (response.ok) {
                const data = await response.json();
                setStats(data.stats);
                setLogs(data.logs);
                setCacheStats(data.cacheStats);
            }
        } catch (error) {
            console.error('Failed to fetch admin stats:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        
        // Auto-refresh every 10 seconds
        let interval: NodeJS.Timeout | null = null;
        if (autoRefresh) {
            interval = setInterval(fetchData, 10000);
        }
        
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [autoRefresh, fetchData]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
            </div>
        );
    }

    const successRate = stats && stats.total_calls > 0 
        ? ((stats.successful_calls / stats.total_calls) * 100).toFixed(1)
        : '0';
    
    const cacheHitRate = stats && stats.total_calls > 0
        ? ((stats.cache_hits / stats.total_calls) * 100).toFixed(1)
        : '0';

    return (
        <div className="space-y-8">
            {/* Header Actions */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">API Usage Statistics</h2>
                    <p className="text-sm text-gray-500">Monitor API calls, costs, and performance</p>
                </div>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                        />
                        Auto-refresh
                    </label>
                    <button
                        onClick={fetchData}
                        className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title="Total Calls"
                    value={stats?.total_calls ?? 0}
                    subtitle={`${stats?.calls_today ?? 0} today`}
                    icon={<Activity className="w-5 h-5" />}
                    color="teal"
                />
                <StatCard
                    title="Success Rate"
                    value={`${successRate}%`}
                    subtitle={`${stats?.failed_calls ?? 0} failures`}
                    icon={<CheckCircle className="w-5 h-5" />}
                    color="green"
                />
                <StatCard
                    title="Avg Latency"
                    value={`${stats?.avg_latency_ms ?? 0}ms`}
                    subtitle="per call"
                    icon={<Clock className="w-5 h-5" />}
                    color="blue"
                />
                <StatCard
                    title="Est. Cost"
                    value={`$${stats?.estimated_cost?.toFixed(4) ?? '0.0000'}`}
                    subtitle="this session"
                    icon={<DollarSign className="w-5 h-5" />}
                    color="amber"
                />
            </div>

            {/* Two Column Layout */}
            <div className="grid md:grid-cols-3 gap-6">
                {/* Service Breakdown */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Service Breakdown</h3>
                    <ServiceBreakdown callsByService={stats?.calls_by_service ?? {}} />
                </div>

                {/* Cache Stats */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Cache Performance</h3>
                    <div className="space-y-4">
                        <div>
                            <div className="text-3xl font-bold text-green-600">{cacheHitRate}%</div>
                            <div className="text-sm text-gray-500">Cache Hit Rate</div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-lg font-semibold text-gray-900">{cacheStats?.size ?? 0}</div>
                                <div className="text-xs text-gray-500">Cached Items</div>
                            </div>
                            <div>
                                <div className="text-lg font-semibold text-gray-900">{cacheStats?.memoryEstimate ?? '0 B'}</div>
                                <div className="text-xs text-gray-500">Memory Usage</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Cost Estimate */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Cost Breakdown</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">Yahoo Finance</span>
                            <span className="font-mono text-sm text-green-600">$0.00 (Free)</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">EODHD</span>
                            <span className="font-mono text-sm text-gray-900">
                                ~${((stats?.calls_by_service?.eodhd ?? 0) * 0.0002).toFixed(4)}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">Claude (Haiku)</span>
                            <span className="font-mono text-sm text-gray-900">
                                ~${((stats?.calls_by_service?.claude ?? 0) * 0.00025).toFixed(4)}
                            </span>
                        </div>
                        <div className="border-t border-gray-200 pt-3 mt-3">
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-medium text-gray-900">Session Total</span>
                                <span className="font-mono font-bold text-gray-900">
                                    ${stats?.estimated_cost?.toFixed(4) ?? '0.0000'}
                                </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-2">
                                + $20/mo EODHD subscription
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Recent Logs */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900">Recent API Calls</h3>
                    <p className="text-sm text-gray-500">Last 50 API calls (newest first)</p>
                </div>
                <LogsTable logs={logs} />
            </div>
        </div>
    );
}

