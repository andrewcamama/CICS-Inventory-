import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Edit3 } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { QrScannerPanel } from '../components/QrScannerPanel';
import { ConditionLabel, StatusLabel } from '../components/StatusText';

interface MetaData {
  locations: Array<{ location_id: number; location_name: string }>;
  conditions: string[];
  statuses: string[];
}

export function PropertyMonitoringPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canUpdate = user?.role === 'admin' || user?.role === 'property_custodian';

  const [meta, setMeta] = useState<MetaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [property, setProperty] = useState<any | null>(null);
  const [updateHistory, setUpdateHistory] = useState<any[]>([]);
  const [borrowHistory, setBorrowHistory] = useState<any[]>([]);

  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [updateForm, setUpdateForm] = useState({
    property_condition: 'Good',
    property_status: 'Available',
    location_id: '',
    assigned_personnel: '',
    remarks: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<MetaData>('/api/properties/meta')
      .then((m) => setMeta(m))
      .catch(() => {});
  }, []);

  const handleLookup = async (code: string, method: 'QR' | 'Barcode' | 'Manual') => {
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    setShowUpdateForm(false);
    try {
      const qs = new URLSearchParams({
        code,
        method,
        module: 'Property Monitoring',
      });
      const res = await apiRequest<{
        property: any;
        update_history: any[];
        borrow_history: any[];
      }>(`/api/properties/lookup?${qs.toString()}`);
      setProperty(res.property);
      setUpdateHistory(res.update_history);
      setBorrowHistory(res.borrow_history);
      setUpdateForm({
        property_condition: res.property.property_condition,
        property_status: res.property.property_status,
        location_id: String(res.property.location_id),
        assigned_personnel: res.property.assigned_personnel || '',
        remarks: '',
      });
    } catch (err: any) {
      setError(err?.message || 'Property could not be retrieved.');
      setProperty(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!property) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const res = await apiRequest<{ property: any; changes_count: number }>(
        `/api/properties/${property.property_id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            property_condition: updateForm.property_condition,
            property_status: updateForm.property_status,
            location_id: Number(updateForm.location_id),
            assigned_personnel: updateForm.assigned_personnel,
            remarks: updateForm.remarks,
          }),
        }
      );

      // Refresh full history
      const detail = await apiRequest<{
        property: any;
        update_history: any[];
        borrow_history: any[];
      }>(`/api/properties/${property.property_id}`);

      setProperty(detail.property);
      setUpdateHistory(detail.update_history);
      setBorrowHistory(detail.borrow_history);
      setShowUpdateForm(false);
      setSaveMessage(
        res.changes_count > 0
          ? `Monitoring update saved (${res.changes_count} field change(s) logged).`
          : 'No changes detected.'
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to save monitoring update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-slate-900">Property Monitoring</h2>
        <p className="text-sm text-slate-600">
          Scan QR code or enter Property ID to inspect condition, status, location, assigned personnel, and history.
        </p>
      </div>

      <QrScannerPanel
        onLookup={handleLookup}
        loading={loading}
        error={error}
        title="Scan or Enter Property ID to Monitor"
      />

      {property && (
        <div className="space-y-6">
          {saveMessage && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{saveMessage}</span>
            </div>
          )}

          {/* Core Monitoring Snapshot */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <p className="font-mono text-xs font-semibold text-blue-700">{property.property_code}</p>
                <h3 className="font-display text-lg font-bold text-slate-900">{property.property_name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {property.category_name} · {property.brand || 'N/A'} {property.model || ''}
                  {property.serial_number ? ` · SN: ${property.serial_number}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="self-start px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Return to Dashboard
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500">Current Condition</p>
                <div className="mt-1.5"><ConditionLabel condition={property.property_condition} /></div>
              </div>
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500">Current Status</p>
                <div className="mt-1.5"><StatusLabel status={property.property_status} /></div>
              </div>
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500">Location</p>
                <p className="text-sm font-semibold text-slate-900 mt-1">{property.location_name}</p>
                <p className="text-xs text-slate-500">
                  {property.building}{property.room_number ? ` · Rm ${property.room_number}` : ''}
                </p>
              </div>
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500">Assigned Personnel</p>
                <p className="text-sm font-semibold text-slate-900 mt-1">
                  {property.assigned_personnel || 'Unassigned'}
                </p>
              </div>
            </div>

            {canUpdate && !showUpdateForm && (
              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">Is an update necessary?</p>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowUpdateForm(true)}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg flex items-center gap-1.5"
                  >
                    <Edit3 className="w-4 h-4" />
                    <span>Yes — Update Monitoring Details</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    No — Return to Dashboard
                  </button>
                </div>
              </div>
            )}

            {canUpdate && showUpdateForm && meta && (
              <form onSubmit={handleSaveUpdate} className="pt-4 border-t border-slate-200 space-y-4">
                <h4 className="font-display text-sm font-semibold text-slate-900">
                  Update Condition, Status, Location &amp; Personnel
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Condition</label>
                    <select
                      value={updateForm.property_condition}
                      onChange={(e) => setUpdateForm({ ...updateForm, property_condition: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {meta.conditions.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                    <select
                      value={updateForm.property_status}
                      onChange={(e) => setUpdateForm({ ...updateForm, property_status: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {meta.statuses.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Location</label>
                    <select
                      value={updateForm.location_id}
                      onChange={(e) => setUpdateForm({ ...updateForm, location_id: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {meta.locations.map((l) => (
                        <option key={l.location_id} value={l.location_id}>{l.location_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Assigned Personnel</label>
                    <input
                      type="text"
                      value={updateForm.assigned_personnel}
                      onChange={(e) => setUpdateForm({ ...updateForm, assigned_personnel: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Inspection Remarks</label>
                    <input
                      type="text"
                      value={updateForm.remarks}
                      onChange={(e) => setUpdateForm({ ...updateForm, remarks: e.target.value })}
                      placeholder="Observation notes from physical check"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowUpdateForm(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                  >
                    {saving ? 'Saving...' : 'Save Monitoring Update'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Borrowing History */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Borrowing History
              </h3>
            </div>
            {borrowHistory.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 text-center">No borrowing history for this property.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Tx Code</th>
                      <th className="py-3 px-4">Borrower</th>
                      <th className="py-3 px-4">Purpose</th>
                      <th className="py-3 px-4">Expected Return</th>
                      <th className="py-3 px-4">Returned At</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {borrowHistory.map((bt) => (
                      <tr key={bt.transaction_id}>
                        <td className="py-3 px-4 font-mono text-xs">{bt.transaction_code}</td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{bt.borrower_name}</p>
                          <p className="text-xs text-slate-500">{bt.id_number} · {bt.department}</p>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700">{bt.purpose}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-xs">{bt.expected_return_date}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-xs">{bt.returned_at || '—'}</td>
                        <td className="py-3 px-4"><StatusLabel status={bt.transaction_status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Field Update History */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Property Update History
              </h3>
            </div>
            {updateHistory.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 text-center">No property updates logged yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Field</th>
                      <th className="py-3 px-4">Old Value</th>
                      <th className="py-3 px-4">New Value</th>
                      <th className="py-3 px-4">Updated By</th>
                      <th className="py-3 px-4">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {updateHistory.map((u) => (
                      <tr key={u.update_id}>
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">{u.updated_at}</td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-800">{u.field_name}</td>
                        <td className="py-3 px-4 text-slate-600">{u.old_value || '—'}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{u.new_value || '—'}</td>
                        <td className="py-3 px-4 text-slate-700">{u.updated_by_name || u.updated_by_username || 'System'}</td>
                        <td className="py-3 px-4 text-slate-600">{u.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
