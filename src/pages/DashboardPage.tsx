import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ArrowRight, Package, ScanLine, ArrowLeftRight, FileBarChart2, RefreshCw } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface DashboardData {
  summary: {
    total_properties: number;
    available: number;
    borrowed: number;
    under_maintenance: number;
    missing: number;
    overdue_borrowings: number;
  };
  inventory_summary: Array<{
    category_id: number;
    category_name: string;
    total_count: number;
    available_count: number;
    borrowed_count: number;
    maintenance_count: number;
    missing_count: number;
    total_value: number;
  }>;
  active_borrowings: Array<{
    transaction_id: number;
    transaction_code: string;
    property_code: string;
    property_name: string;
    borrower_name: string;
    id_number: string;
    department: string;
    purpose: string;
    expected_return_date: string;
    is_overdue: number;
    days_overdue: number;
  }>;
  recent_audit_events: Array<{
    audit_id: number;
    username: string | null;
    action: string;
    details: string | null;
    created_at: string;
  }>;
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<DashboardData>('/api/dashboard');
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const isStaff = user?.role === 'staff';

  const moduleCards = [
    ...(!isStaff
      ? [
          {
            title: 'Property Management',
            desc: 'Register new assets, generate QR labels, or update existing property records.',
            to: '/properties',
            icon: Package,
          },
        ]
      : []),
    {
      title: 'Property Monitoring',
      desc: 'Scan QR/barcode or enter Property ID to inspect condition, location, and history.',
      to: '/monitoring',
      icon: ScanLine,
    },
    ...(!isStaff
      ? [
          {
            title: 'Borrowing & Returning',
            desc: 'Process borrowing requests, review availability, release assets, and inspect returns.',
            to: '/borrowing',
            icon: ArrowLeftRight,
          },
        ]
      : []),
    {
      title: 'Inventory Reports',
      desc: 'Generate monthly, quarterly, annual, or custom reports and export to PDF or Excel.',
      to: '/reports',
      icon: FileBarChart2,
    },
  ];

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-800 flex items-center justify-between">
        <span>{error}</span>
        <button
          type="button"
          onClick={loadDashboard}
          className="px-3.5 py-2 text-xs font-medium bg-red-700 text-white rounded-lg hover:bg-red-800"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const summaryItems = [
    { label: 'Total Properties', value: data.summary.total_properties, tone: 'text-slate-900' },
    { label: 'Available', value: data.summary.available, tone: 'text-emerald-700' },
    { label: 'Borrowed', value: data.summary.borrowed, tone: 'text-blue-700' },
    { label: 'Under Maintenance', value: data.summary.under_maintenance, tone: 'text-amber-700' },
    { label: 'Missing', value: data.summary.missing, tone: 'text-red-700' },
    { label: 'Overdue Borrowings', value: data.summary.overdue_borrowings, tone: 'text-red-700' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">
            CICS Inventory Overview
          </h2>
          <p className="text-sm text-slate-600">
            Real-time property status, active borrowings, and audit activity across CICS facilities.
          </p>
        </div>
        <button
          type="button"
          onClick={loadDashboard}
          className="self-start px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {summaryItems.map((item) => (
          <div key={item.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">{item.label}</p>
            <p className={`font-mono tabular-nums text-2xl font-bold mt-2 ${item.tone}`}>
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {/* Module Navigation */}
      <div>
        <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
          Operational Modules
        </h3>
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${isStaff ? 'lg:grid-cols-2' : 'lg:grid-cols-4'} gap-4`}>
          {moduleCards.map((mod) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.to}
                type="button"
                onClick={() => navigate(mod.to)}
                className="text-left bg-white border border-slate-200 hover:border-blue-600 rounded-xl p-4 transition-colors group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Icon className="w-5 h-5 text-blue-700" />
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-700 transition-colors" />
                  </div>
                  <p className="font-display text-sm font-semibold text-slate-900">{mod.title}</p>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">{mod.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart + Recent Audit Events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-4">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Inventory Breakdown by Category
            </h3>
            <p className="text-xs text-slate-500">
              Aggregated from v_inventory_summary across all CICS asset categories
            </p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.inventory_summary}
                margin={{ top: 8, right: 12, left: -12, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis
                  dataKey="category_name"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  interval={0}
                  angle={-12}
                  textAnchor="end"
                  height={52}
                />
                <YAxis tick={{ fontSize: 11, fill: '#475569' }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="available_count" name="Available" stackId="a" fill="#16A34A" />
                <Bar dataKey="borrowed_count" name="Borrowed" stackId="a" fill="#1D4ED8" />
                <Bar dataKey="maintenance_count" name="Maintenance" stackId="a" fill="#D97706" />
                <Bar dataKey="missing_count" name="Missing" stackId="a" fill="#DC2626" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
          <div className="mb-4">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Recent Audit Events
            </h3>
            <p className="text-xs text-slate-500">Latest 5 recorded system actions</p>
          </div>
          {data.recent_audit_events.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No audit events recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 flex-1">
              {data.recent_audit_events.map((ev) => (
                <div key={ev.audit_id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-semibold text-blue-800">{ev.action}</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {ev.created_at}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 mt-1 leading-snug">
                    {ev.details || 'Action recorded'}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    User: {ev.username || 'System'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active Borrowings Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Active Borrowings
            </h3>
            <p className="text-xs text-slate-500">
              Currently released properties from v_active_borrowings · Overdue items highlighted
            </p>
          </div>
          {!isStaff && (
            <button
              type="button"
              onClick={() => navigate('/borrowing')}
              className="px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg whitespace-nowrap"
            >
              Manage Borrowing
            </button>
          )}
        </div>

        {data.active_borrowings.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No properties are currently borrowed.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Transaction</th>
                  <th className="py-3 px-4">Property</th>
                  <th className="py-3 px-4">Borrower</th>
                  <th className="py-3 px-4">Purpose</th>
                  <th className="py-3 px-4">Expected Return</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {data.active_borrowings.map((row) => {
                  const overdue = Number(row.is_overdue) === 1;
                  return (
                    <tr
                      key={row.transaction_id}
                      className={overdue ? 'bg-red-50/80 hover:bg-red-50' : 'hover:bg-slate-50'}
                    >
                      <td className="py-3 px-4 font-mono text-xs text-slate-800 whitespace-nowrap">
                        {row.transaction_code}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{row.property_name}</p>
                        <p className="font-mono text-xs text-slate-500">{row.property_code}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{row.borrower_name}</p>
                        <p className="text-xs text-slate-500">
                          {row.id_number} · {row.department}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 max-w-xs truncate">
                        {row.purpose}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {row.expected_return_date}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {overdue ? (
                          <span className="text-xs font-semibold text-red-700">
                            Overdue ({row.days_overdue}d)
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-blue-700">On Loan</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
