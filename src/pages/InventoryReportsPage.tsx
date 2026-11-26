import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Search } from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../lib/api';
import { StatusLabel } from '../components/StatusText';

export function InventoryReportsPage() {
  const [periodType, setPeriodType] = useState<'Monthly' | 'Quarterly' | 'Annual' | 'Custom'>('Monthly');
  const todayStr = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${todayStr.slice(0, 8)}01`;
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(todayStr);

  const [report, setReport] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await apiRequest<{ reports: any[] }>('/api/reports/history');
      setHistory(res.reports);
    } catch {
      // ignore
    }
  }, []);

  const generateReport = useCallback(
    async (save = true) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          period_type: periodType,
          save: save ? 'true' : 'false',
        });
        if (periodType === 'Custom') {
          qs.set('start_date', startDate);
          qs.set('end_date', endDate);
        }
        const data = await apiRequest(`/api/reports/generate?${qs.toString()}`);
        setReport(data);
        setStartDate(data.start_date);
        setEndDate(data.end_date);
        if (save) await loadHistory();
      } catch (err: any) {
        setError(err?.message || 'Failed to generate report.');
      } finally {
        setLoading(false);
      }
    },
    [periodType, startDate, endDate, loadHistory]
  );

  useEffect(() => {
    generateReport(false);
    loadHistory();
  }, []);

  const handleExport = async (format: 'pdf' | 'excel') => {
    setExporting(format);
    setError(null);
    try {
      const qs = new URLSearchParams({ period_type: periodType });
      if (periodType === 'Custom') {
        qs.set('start_date', startDate);
        qs.set('end_date', endDate);
      }
      const ext = format === 'pdf' ? 'pdf' : 'xlsx';
      await downloadAuthenticatedFile(
        `/api/reports/export/${format}?${qs.toString()}`,
        `CICS_Inventory_Report_${startDate}_to_${endDate}.${ext}`
      );
      await loadHistory();
    } catch (err: any) {
      setError(err?.message || `Failed to export ${format.toUpperCase()} report.`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-slate-900">Inventory Reports</h2>
        <p className="text-sm text-slate-600">
          Specify a reporting period, retrieve matching inventory records, and export formatted PDF or Excel reports.
        </p>
      </div>

      {/* Period & Export Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              Specify Reporting Period
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex p-1 bg-slate-100 rounded-lg">
                {(['Monthly', 'Quarterly', 'Annual', 'Custom'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriodType(p)}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      periodType === p ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {periodType === 'Custom' && (
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                  <span className="text-slate-500">to</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => generateReport(true)}
              className="px-4 py-2.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <Search className="w-4 h-4" />
              <span>{loading ? 'Generating...' : 'Generate Report'}</span>
            </button>
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => handleExport('pdf')}
              className="px-4 py-2.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileText className="w-4 h-4 text-red-700" />
              <span>{exporting === 'pdf' ? 'Exporting PDF...' : 'Export PDF'}</span>
            </button>
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => handleExport('excel')}
              className="px-4 py-2.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <span>{exporting === 'excel' ? 'Exporting Excel...' : 'Export Excel'}</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </div>
        )}
      </div>

      {report && (
        <div className="space-y-6">
          {/* Status Totals */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  {report.period_type} Inventory Summary ({report.start_date} to {report.end_date})
                </h3>
                <p className="text-xs text-slate-500 font-mono">Generated: {report.generated_at}</p>
              </div>
              <p className="font-mono tabular-nums text-sm font-bold text-slate-900">
                Total Value: PHP {Number(report.totals_by_status.total_value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                ['Total', report.totals_by_status.total_properties, 'text-slate-900'],
                ['Available', report.totals_by_status.available, 'text-emerald-700'],
                ['Borrowed', report.totals_by_status.borrowed, 'text-blue-700'],
                ['Maintenance', report.totals_by_status.under_maintenance, 'text-amber-700'],
                ['Missing', report.totals_by_status.missing, 'text-red-700'],
                ['Disposed', report.totals_by_status.disposed, 'text-slate-600'],
                ['Overdue', report.totals_by_status.overdue, 'text-red-700'],
              ].map(([label, val, tone]) => (
                <div key={String(label)} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className={`font-mono tabular-nums text-xl font-bold mt-1 ${tone}`}>{val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* By Category & Location */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h4 className="font-display text-sm font-semibold text-slate-900">Totals by Category</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      <th className="py-2.5 px-3 text-right">Avail</th>
                      <th className="py-2.5 px-3 text-right">Borrowed</th>
                      <th className="py-2.5 px-3 text-right">Maint</th>
                      <th className="py-2.5 px-4 text-right">Missing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {report.by_category.map((c: any) => (
                      <tr key={c.category_id}>
                        <td className="py-2.5 px-4 font-sans font-medium text-slate-800">{c.category_name}</td>
                        <td className="py-2.5 px-3 text-right">{c.total_count}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-700">{c.available_count}</td>
                        <td className="py-2.5 px-3 text-right text-blue-700">{c.borrowed_count}</td>
                        <td className="py-2.5 px-3 text-right text-amber-700">{c.maintenance_count}</td>
                        <td className="py-2.5 px-4 text-right text-red-700">{c.missing_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h4 className="font-display text-sm font-semibold text-slate-900">Totals by Location</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4">Location</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      <th className="py-2.5 px-3 text-right">Avail</th>
                      <th className="py-2.5 px-3 text-right">Borrowed</th>
                      <th className="py-2.5 px-4 text-right">Missing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {report.by_location.map((l: any) => (
                      <tr key={l.location_id}>
                        <td className="py-2.5 px-4 font-sans font-medium text-slate-800">{l.location_name}</td>
                        <td className="py-2.5 px-3 text-right">{l.total_count}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-700">{l.available_count}</td>
                        <td className="py-2.5 px-3 text-right text-blue-700">{l.borrowed_count}</td>
                        <td className="py-2.5 px-4 text-right text-red-700">{l.missing_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Overdue Items */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h4 className="font-display text-sm font-semibold text-slate-900">
                Overdue Items ({report.overdue_items.length})
              </h4>
            </div>
            {report.overdue_items.length === 0 ? (
              <p className="p-5 text-xs text-slate-500 text-center">No overdue borrowings.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4">Tx Code</th>
                      <th className="py-2.5 px-4">Property</th>
                      <th className="py-2.5 px-4">Borrower</th>
                      <th className="py-2.5 px-4">Expected Return</th>
                      <th className="py-2.5 px-4">Days Overdue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.overdue_items.map((o: any) => (
                      <tr key={o.transaction_id} className="bg-red-50/70">
                        <td className="py-2.5 px-4 font-mono">{o.transaction_code}</td>
                        <td className="py-2.5 px-4 font-medium">{o.property_code} · {o.property_name}</td>
                        <td className="py-2.5 px-4">{o.borrower_name} ({o.id_number})</td>
                        <td className="py-2.5 px-4 font-mono tabular-nums">{o.expected_return_date}</td>
                        <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-red-700">
                          {o.days_overdue}d
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Properties Added & Borrow Transactions & Condition Changes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h4 className="font-display text-sm font-semibold text-slate-900">
                  Properties Added in Period ({report.properties_added.length})
                </h4>
              </div>
              {report.properties_added.length === 0 ? (
                <p className="p-5 text-xs text-slate-500 text-center">No properties added in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="py-2.5 px-4">Code</th>
                        <th className="py-2.5 px-4">Name</th>
                        <th className="py-2.5 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.properties_added.map((p: any) => (
                        <tr key={p.property_code}>
                          <td className="py-2.5 px-4 font-mono">{p.property_code}</td>
                          <td className="py-2.5 px-4 font-medium">{p.property_name}</td>
                          <td className="py-2.5 px-4"><StatusLabel status={p.property_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h4 className="font-display text-sm font-semibold text-slate-900">
                  Borrowing &amp; Return Activity ({report.borrow_transactions.length})
                </h4>
              </div>
              {report.borrow_transactions.length === 0 ? (
                <p className="p-5 text-xs text-slate-500 text-center">No borrowing activity in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="py-2.5 px-4">Tx Code</th>
                        <th className="py-2.5 px-4">Property</th>
                        <th className="py-2.5 px-4">Borrower</th>
                        <th className="py-2.5 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.borrow_transactions.map((bt: any) => (
                        <tr key={bt.transaction_code}>
                          <td className="py-2.5 px-4 font-mono">{bt.transaction_code}</td>
                          <td className="py-2.5 px-4">{bt.property_code}</td>
                          <td className="py-2.5 px-4">{bt.borrower_name}</td>
                          <td className="py-2.5 px-4"><StatusLabel status={bt.transaction_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Condition & Status Changes */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h4 className="font-display text-sm font-semibold text-slate-900">
                Condition &amp; Field Changes ({report.condition_changes.length})
              </h4>
            </div>
            {report.condition_changes.length === 0 ? (
              <p className="p-5 text-xs text-slate-500 text-center">No condition or field changes in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4">Timestamp</th>
                      <th className="py-2.5 px-4">Property</th>
                      <th className="py-2.5 px-4">Field</th>
                      <th className="py-2.5 px-4">Change</th>
                      <th className="py-2.5 px-4">Updated By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.condition_changes.map((ch: any) => (
                      <tr key={ch.update_id}>
                        <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">{ch.updated_at}</td>
                        <td className="py-2.5 px-4 font-medium">{ch.property_code} · {ch.property_name}</td>
                        <td className="py-2.5 px-4 font-mono">{ch.field_name}</td>
                        <td className="py-2.5 px-4">
                          {ch.old_value || '—'} → <span className="font-semibold">{ch.new_value || '—'}</span>
                        </td>
                        <td className="py-2.5 px-4">{ch.updated_by_name || 'System'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Saved Report History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h4 className="font-display text-sm font-semibold text-slate-900">
            Saved Report Log (inventory_reports)
          </h4>
          <Download className="w-4 h-4 text-slate-400" />
        </div>
        {history.length === 0 ? (
          <p className="p-5 text-xs text-slate-500 text-center">No saved report records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 px-4">Report Title</th>
                  <th className="py-2.5 px-4">Format</th>
                  <th className="py-2.5 px-4">Totals</th>
                  <th className="py-2.5 px-4">Generated By</th>
                  <th className="py-2.5 px-4">Generated At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr key={h.report_id}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{h.report_title}</td>
                    <td className="py-2.5 px-4 font-mono">{h.export_format}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                      Total {h.total_properties} · Avail {h.total_available} · Overdue {h.total_overdue}
                    </td>
                    <td className="py-2.5 px-4">{h.generated_by_name || h.generated_by_username}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">{h.generated_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
