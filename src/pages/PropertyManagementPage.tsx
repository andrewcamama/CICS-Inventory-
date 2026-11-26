import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, QrCode, Search, Edit3, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { QrScannerPanel } from '../components/QrScannerPanel';
import { QrLabelPrintModal, type QrLabelData } from '../components/QrLabelPrintModal';
import { ConditionLabel, StatusLabel } from '../components/StatusText';

interface MetaResponse {
  categories: Array<{ category_id: number; category_name: string }>;
  locations: Array<{ location_id: number; location_name: string; building: string; room_number: string | null }>;
  suggested_property_code: string;
  conditions: string[];
  statuses: string[];
}

export function PropertyManagementPage() {
  const navigate = useNavigate();
  const [flowStep, setFlowStep] = useState<'prompt' | 'new' | 'scan_existing' | 'inspect_existing' | 'edit_existing'>('prompt');
  const [meta, setMeta] = useState<MetaResponse | null>(null);

  // Registry List state
  const [items, setItems] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterLoc, setFilterLoc] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCond, setFilterCond] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // New Property Form state
  const [newForm, setNewForm] = useState({
    property_code: '',
    property_name: '',
    description: '',
    category_id: '',
    brand: '',
    model: '',
    serial_number: '',
    acquisition_date: '',
    acquisition_cost: '0',
    location_id: '',
    assigned_personnel: '',
    property_condition: 'Good',
    property_status: 'Available',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Existing Lookup / Edit state
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [foundProperty, setFoundProperty] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [editRemarks, setEditRemarks] = useState('');
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);

  // Printable QR Modal
  const [qrModalLabel, setQrModalLabel] = useState<QrLabelData | null>(null);
  const [isNewCreationModal, setIsNewCreationModal] = useState(false);

  const loadMeta = useCallback(async () => {
    const m = await apiRequest<MetaResponse>('/api/properties/meta');
    setMeta(m);
    setNewForm((prev) => ({
      ...prev,
      property_code: prev.property_code || m.suggested_property_code,
      category_id: prev.category_id || (m.categories[0]?.category_id ? String(m.categories[0].category_id) : ''),
      location_id: prev.location_id || (m.locations[0]?.location_id ? String(m.locations[0].location_id) : ''),
    }));
  }, []);

  const loadRegistry = useCallback(async () => {
    setListLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '10' });
      if (search.trim()) qs.set('search', search.trim());
      if (filterCat) qs.set('category_id', filterCat);
      if (filterLoc) qs.set('location_id', filterLoc);
      if (filterStatus) qs.set('status', filterStatus);
      if (filterCond) qs.set('condition', filterCond);

      const res = await apiRequest<{ items: any[]; pagination: { total: number; total_pages: number } }>(
        `/api/properties?${qs.toString()}`
      );
      setItems(res.items);
      setTotalPages(res.pagination.total_pages);
      setTotalCount(res.pagination.total);
    } finally {
      setListLoading(false);
    }
  }, [page, search, filterCat, filterLoc, filterStatus, filterCond]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const res = await apiRequest<{ property: any }>('/api/properties', {
        method: 'POST',
        body: JSON.stringify({
          ...newForm,
          category_id: Number(newForm.category_id),
          location_id: Number(newForm.location_id),
          acquisition_cost: Number(newForm.acquisition_cost || 0),
        }),
      });
      await loadMeta();
      await loadRegistry();
      setIsNewCreationModal(true);
      setQrModalLabel({
        property_id: res.property.property_id,
        property_code: res.property.property_code,
        property_name: res.property.property_name,
        serial_number: res.property.serial_number,
        category_name: res.property.category_name,
        location_name: res.property.location_name,
        qr_value: res.property.qr_value,
        qr_image_data: res.property.qr_image_data,
      });
      setNewForm((prev) => ({
        ...prev,
        property_code: '',
        property_name: '',
        description: '',
        brand: '',
        model: '',
        serial_number: '',
        acquisition_date: '',
        acquisition_cost: '0',
        assigned_personnel: '',
      }));
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save property.');
    } finally {
      setSaving(false);
    }
  };

  const handleLookupExisting = async (code: string, method: 'QR' | 'Barcode' | 'Manual') => {
    setLookupLoading(true);
    setLookupError(null);
    setUpdateSuccess(null);
    try {
      const qs = new URLSearchParams({
        code,
        method,
        module: 'Property Management',
      });
      const res = await apiRequest<{ property: any }>(`/api/properties/lookup?${qs.toString()}`);
      setFoundProperty(res.property);
      setEditForm({
        property_name: res.property.property_name,
        description: res.property.description || '',
        category_id: String(res.property.category_id),
        brand: res.property.brand || '',
        model: res.property.model || '',
        serial_number: res.property.serial_number || '',
        acquisition_date: res.property.acquisition_date || '',
        acquisition_cost: String(res.property.acquisition_cost ?? 0),
        location_id: String(res.property.location_id),
        assigned_personnel: res.property.assigned_personnel || '',
        property_condition: res.property.property_condition,
        property_status: res.property.property_status,
      });
      setEditRemarks('');
      setFlowStep('inspect_existing');
    } catch (err: any) {
      setLookupError(err?.message || 'Property lookup failed.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSaveUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foundProperty) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiRequest<{ property: any; changes_count: number }>(
        `/api/properties/${foundProperty.property_id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            ...editForm,
            category_id: Number(editForm.category_id),
            location_id: Number(editForm.location_id),
            acquisition_cost: Number(editForm.acquisition_cost || 0),
            remarks: editRemarks,
          }),
        }
      );
      setFoundProperty(res.property);
      setUpdateSuccess(
        res.changes_count > 0
          ? `Saved ${res.changes_count} field change(s) to property_updates and audit_logs.`
          : 'No field changes were detected.'
      );
      setFlowStep('inspect_existing');
      await loadRegistry();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to update property.');
    } finally {
      setSaving(false);
    }
  };

  const handleReprintQr = async (propertyId: number) => {
    try {
      const label = await apiRequest<QrLabelData>(`/api/properties/${propertyId}/qr`);
      setIsNewCreationModal(false);
      setQrModalLabel(label);
    } catch (err: any) {
      setLookupError(err?.message || 'Unable to generate QR label.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">Property Management</h2>
          <p className="text-sm text-slate-600">
            Register new CICS properties with QR tags, or scan existing properties to inspect and update records.
          </p>
        </div>
        {flowStep !== 'prompt' && (
          <button
            type="button"
            onClick={() => {
              setFlowStep('prompt');
              setFormError(null);
              setLookupError(null);
              setUpdateSuccess(null);
            }}
            className="self-start px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Start Over</span>
          </button>
        )}
      </div>

      {/* Flow Decision Card: Is this a new property? */}
      {flowStep === 'prompt' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Is this a new property?
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            Choose whether you are registering a newly acquired item or scanning an existing CICS property.
          </p>
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => {
                setFlowStep('new');
                if (meta && !newForm.property_code) {
                  setNewForm((p) => ({ ...p, property_code: meta.suggested_property_code }));
                }
              }}
              className="px-5 py-3 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Yes — Register New Property</span>
            </button>
            <button
              type="button"
              onClick={() => setFlowStep('scan_existing')}
              className="px-5 py-3 text-sm font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center justify-center gap-2"
            >
              <QrCode className="w-4 h-4" />
              <span>No — Scan Existing Property</span>
            </button>
          </div>
        </div>
      )}

      {/* YES: New Property Form */}
      {flowStep === 'new' && meta && (
        <form onSubmit={handleCreateProperty} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Register New CICS Property
            </h3>
            <p className="text-xs text-slate-500">
              Saving automatically generates a QR code encoding the Property Code and opens the printable label.
            </p>
          </div>

          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Property Code *</label>
              <input
                type="text"
                required
                value={newForm.property_code}
                onChange={(e) => setNewForm({ ...newForm, property_code: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Property Name *</label>
              <input
                type="text"
                required
                value={newForm.property_name}
                onChange={(e) => setNewForm({ ...newForm, property_name: e.target.value })}
                placeholder="e.g. Dell Latitude 5440 Laptop"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
              <select
                required
                value={newForm.category_id}
                onChange={(e) => setNewForm({ ...newForm, category_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {meta.categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Location *</label>
              <select
                required
                value={newForm.location_id}
                onChange={(e) => setNewForm({ ...newForm, location_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {meta.locations.map((l) => (
                  <option key={l.location_id} value={l.location_id}>
                    {l.location_name} {l.room_number ? `(Rm ${l.room_number})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Assigned Personnel</label>
              <input
                type="text"
                value={newForm.assigned_personnel}
                onChange={(e) => setNewForm({ ...newForm, assigned_personnel: e.target.value })}
                placeholder="Custodian or faculty in charge"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Brand</label>
              <input
                type="text"
                value={newForm.brand}
                onChange={(e) => setNewForm({ ...newForm, brand: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Model</label>
              <input
                type="text"
                value={newForm.model}
                onChange={(e) => setNewForm({ ...newForm, model: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Serial Number</label>
              <input
                type="text"
                value={newForm.serial_number}
                onChange={(e) => setNewForm({ ...newForm, serial_number: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Acquisition Date</label>
              <input
                type="date"
                value={newForm.acquisition_date}
                onChange={(e) => setNewForm({ ...newForm, acquisition_date: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Acquisition Cost (PHP)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={newForm.acquisition_cost}
                onChange={(e) => setNewForm({ ...newForm, acquisition_cost: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Condition</label>
              <select
                value={newForm.property_condition}
                onChange={(e) => setNewForm({ ...newForm, property_condition: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {meta.conditions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select
                value={newForm.property_status}
                onChange={(e) => setNewForm({ ...newForm, property_status: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {meta.statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">Description / Specifications</label>
              <textarea
                rows={2}
                value={newForm.description}
                onChange={(e) => setNewForm({ ...newForm, description: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setFlowStep('prompt')}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
            >
              {saving ? 'Saving & Generating QR...' : 'Save Property & Generate QR'}
            </button>
          </div>
        </form>
      )}

      {/* NO: Scan Existing Property */}
      {flowStep === 'scan_existing' && (
        <QrScannerPanel
          onLookup={handleLookupExisting}
          loading={lookupLoading}
          error={lookupError}
        />
      )}

      {/* Display Retrieved Existing Property + "Is an update necessary?" */}
      {flowStep === 'inspect_existing' && foundProperty && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          {updateSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{updateSuccess}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <p className="font-mono text-xs font-semibold text-blue-700">{foundProperty.property_code}</p>
              <h3 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                {foundProperty.property_name}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {foundProperty.category_name} · {foundProperty.location_name}
                {foundProperty.serial_number ? ` · SN: ${foundProperty.serial_number}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleReprintQr(foundProperty.property_id)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Reprint QR</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500">Status</p>
              <div className="mt-1"><StatusLabel status={foundProperty.property_status} /></div>
            </div>
            <div>
              <p className="text-xs text-slate-500">Condition</p>
              <div className="mt-1"><ConditionLabel condition={foundProperty.property_condition} /></div>
            </div>
            <div>
              <p className="text-xs text-slate-500">Assigned Personnel</p>
              <p className="text-sm font-medium text-slate-800 mt-1">{foundProperty.assigned_personnel || 'Unassigned'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Acquisition Cost</p>
              <p className="font-mono tabular-nums text-sm font-medium text-slate-800 mt-1">
                PHP {Number(foundProperty.acquisition_cost || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm font-medium text-slate-900">Is an update necessary?</p>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setFlowStep('edit_existing')}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg flex items-center gap-1.5"
              >
                <Edit3 className="w-4 h-4" />
                <span>Yes — Update Record</span>
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
        </div>
      )}

      {/* Edit Existing Property Form */}
      {flowStep === 'edit_existing' && foundProperty && meta && (
        <form onSubmit={handleSaveUpdate} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Update Property: <span className="font-mono">{foundProperty.property_code}</span>
            </h3>
            <p className="text-xs text-slate-500">
              Every changed field is logged individually in property_updates and recorded in audit_logs.
            </p>
          </div>

          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Property Name *</label>
              <input
                type="text"
                required
                value={editForm.property_name || ''}
                onChange={(e) => setEditForm({ ...editForm, property_name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
              <select
                value={editForm.category_id || ''}
                onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {meta.categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>{c.category_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Location *</label>
              <select
                value={editForm.location_id || ''}
                onChange={(e) => setEditForm({ ...editForm, location_id: e.target.value })}
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
                value={editForm.assigned_personnel || ''}
                onChange={(e) => setEditForm({ ...editForm, assigned_personnel: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Serial Number</label>
              <input
                type="text"
                value={editForm.serial_number || ''}
                onChange={(e) => setEditForm({ ...editForm, serial_number: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Condition</label>
              <select
                value={editForm.property_condition || 'Good'}
                onChange={(e) => setEditForm({ ...editForm, property_condition: e.target.value })}
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
                value={editForm.property_status || 'Available'}
                onChange={(e) => setEditForm({ ...editForm, property_status: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {meta.statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Acquisition Cost (PHP)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editForm.acquisition_cost || '0'}
                onChange={(e) => setEditForm({ ...editForm, acquisition_cost: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">Update Remarks / Reason</label>
              <input
                type="text"
                value={editRemarks}
                onChange={(e) => setEditRemarks(e.target.value)}
                placeholder="Reason for transfer, repair, or status change"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setFlowStep('inspect_existing')}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
            >
              {saving ? 'Saving Updates...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* Searchable, Filterable, Paginated Property Registry */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900">
                Property Registry
              </h3>
              <p className="text-xs text-slate-500">
                <span className="font-mono tabular-nums">{totalCount}</span> matching asset(s)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search code, name, serial, brand..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <select
              value={filterCat}
              onChange={(e) => {
                setFilterCat(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="">All Categories</option>
              {meta?.categories.map((c) => (
                <option key={c.category_id} value={c.category_id}>{c.category_name}</option>
              ))}
            </select>

            <select
              value={filterLoc}
              onChange={(e) => {
                setFilterLoc(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="">All Locations</option>
              {meta?.locations.map((l) => (
                <option key={l.location_id} value={l.location_id}>{l.location_name}</option>
              ))}
            </select>

            <div className="flex gap-2">
              <select
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setPage(1);
                }}
                className="flex-1 px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">All Status</option>
                {meta?.statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>

              <select
                value={filterCond}
                onChange={(e) => {
                  setFilterCond(e.target.value);
                  setPage(1);
                }}
                className="flex-1 px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">All Cond.</option>
                {meta?.conditions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Property Name</th>
                <th className="py-3 px-4">Category &amp; Location</th>
                <th className="py-3 px-4">Condition</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {listLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                    Loading properties...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    No properties match your current filters.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.property_id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                      {item.property_code}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-slate-900">{item.property_name}</p>
                      <p className="text-xs text-slate-500">
                        {item.brand || '—'} {item.model || ''}
                        {item.serial_number ? ` · SN: ${item.serial_number}` : ''}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      <p>{item.category_name}</p>
                      <p className="text-slate-500">{item.location_name}</p>
                    </td>
                    <td className="py-3 px-4"><ConditionLabel condition={item.property_condition} /></td>
                    <td className="py-3 px-4"><StatusLabel status={item.property_status} /></td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => handleReprintQr(item.property_id)}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md inline-flex items-center gap-1"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>Reprint QR</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLookupExisting(item.property_code, 'Manual')}
                        className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span className="font-mono tabular-nums">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <QrLabelPrintModal
        label={qrModalLabel}
        onClose={() => setQrModalLabel(null)}
        primaryDoneLabel={isNewCreationModal ? 'Save Property Record & Return to Dashboard' : 'Close'}
        onPrimaryDone={() => {
          setQrModalLabel(null);
          if (isNewCreationModal) {
            navigate('/');
          }
        }}
      />
    </div>
  );
}
