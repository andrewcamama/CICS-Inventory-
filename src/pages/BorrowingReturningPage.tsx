import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { QrScannerPanel } from '../components/QrScannerPanel';
import { ConditionLabel, StatusLabel } from '../components/StatusText';

export function BorrowingReturningPage() {
  const navigate = useNavigate();
  const [txType, setTxType] = useState<'borrowing' | 'returning'>('borrowing');

  // Shared lookup state
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<any | null>(null);

  // Borrowing flow state
  const [borrowers, setBorrowers] = useState<any[]>([]);
  const [borrowerMode, setBorrowerMode] = useState<'existing' | 'new'>('existing');
  const [borrowForm, setBorrowForm] = useState({
    borrower_id: '',
    purpose: '',
    expected_return_date: '',
    new_borrower_name: '',
    new_id_number: '',
    new_borrower_type: 'Faculty',
    new_department: 'CICS',
    new_contact_number: '',
    new_email: '',
  });
  const [pendingTx, setPendingTx] = useState<any | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [borrowActionMsg, setBorrowActionMsg] = useState<{ type: 'ok' | 'reject' | 'err'; text: string } | null>(null);

  // Returning flow state
  const [activeReleaseTx, setActiveReleaseTx] = useState<any | null>(null);
  const [returnForm, setReturnForm] = useState({
    is_complete_on_return: true,
    condition_on_return: 'Good',
    return_remarks: '',
  });
  const [returnMsg, setReturnMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Transactions table
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txFilter, setTxFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadBorrowers = useCallback(async () => {
    const res = await apiRequest<{ borrowers: any[] }>('/api/borrow/borrowers');
    setBorrowers(res.borrowers);
    if (res.borrowers.length > 0 && !borrowForm.borrower_id) {
      setBorrowForm((p) => ({ ...p, borrower_id: String(res.borrowers[0].borrower_id) }));
    }
  }, [borrowForm.borrower_id]);

  const loadTransactions = useCallback(async () => {
    const qs = txFilter ? `?status=${encodeURIComponent(txFilter)}` : '';
    const res = await apiRequest<{ transactions: any[] }>(`/api/borrow/transactions${qs}`);
    setTransactions(res.transactions);
  }, [txFilter]);

  useEffect(() => {
    loadBorrowers();
  }, [loadBorrowers]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const resetFlowState = () => {
    setSelectedProperty(null);
    setLookupError(null);
    setPendingTx(null);
    setShowRejectBox(false);
    setRejectionReason('');
    setBorrowActionMsg(null);
    setActiveReleaseTx(null);
    setReturnMsg(null);
  };

  const handleScanLookup = async (code: string, method: 'QR' | 'Barcode' | 'Manual') => {
    setLookupLoading(true);
    setLookupError(null);
    setBorrowActionMsg(null);
    setReturnMsg(null);
    setPendingTx(null);
    setActiveReleaseTx(null);
    try {
      const qs = new URLSearchParams({
        code,
        method,
        module: txType === 'borrowing' ? 'Borrowing' : 'Returning',
      });
      const res = await apiRequest<{ property: any }>(`/api/properties/lookup?${qs.toString()}`);
      setSelectedProperty(res.property);

      if (txType === 'returning') {
        try {
          const active = await apiRequest<{ transaction: any }>(
            `/api/borrow/active-by-property/${res.property.property_id}`
          );
          setActiveReleaseTx(active.transaction);
          setReturnForm({
            is_complete_on_return: true,
            condition_on_return: res.property.property_condition || 'Good',
            return_remarks: '',
          });
        } catch (activeErr: any) {
          setLookupError(activeErr?.message || 'No Released borrowing transaction found for this property.');
        }
      }
    } catch (err: any) {
      setLookupError(err?.message || 'Property lookup failed.');
      setSelectedProperty(null);
    } finally {
      setLookupLoading(false);
    }
  };

  const handleCreateBorrowRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProperty) return;
    setSubmitting(true);
    setBorrowActionMsg(null);
    try {
      const payload: Record<string, any> = {
        property_id: selectedProperty.property_id,
        purpose: borrowForm.purpose,
        expected_return_date: borrowForm.expected_return_date,
      };
      if (borrowerMode === 'existing') {
        payload.borrower_id = Number(borrowForm.borrower_id);
      } else {
        payload.new_borrower = {
          borrower_name: borrowForm.new_borrower_name,
          id_number: borrowForm.new_id_number,
          borrower_type: borrowForm.new_borrower_type,
          department: borrowForm.new_department,
          contact_number: borrowForm.new_contact_number,
          email: borrowForm.new_email,
        };
      }
      const res = await apiRequest<{ transaction: any }>('/api/borrow/requests', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setPendingTx(res.transaction);
      setShowRejectBox(false);
      await loadBorrowers();
      await loadTransactions();
    } catch (err: any) {
      setBorrowActionMsg({ type: 'err', text: err?.message || 'Failed to create borrowing request.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewPending = async (txToReview: any, approved: boolean) => {
    setSubmitting(true);
    setBorrowActionMsg(null);
    try {
      const res = await apiRequest<{ status: string; message: string; transaction?: any }>(
        `/api/borrow/requests/${txToReview.transaction_id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            approved,
            rejection_reason: approved ? undefined : rejectionReason,
          }),
        }
      );

      if (approved) {
        setBorrowActionMsg({ type: 'ok', text: res.message });
        setPendingTx(null);
        setSelectedProperty((prev: any) =>
          prev ? { ...prev, property_status: 'Borrowed' } : prev
        );
      } else {
        setBorrowActionMsg({ type: 'reject', text: res.message });
        setPendingTx(null);
      }
      await loadTransactions();
    } catch (err: any) {
      setBorrowActionMsg({ type: 'err', text: err?.message || 'Review failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReleaseTx) return;
    setSubmitting(true);
    setReturnMsg(null);
    try {
      const res = await apiRequest<{ message: string; result: any }>(
        `/api/borrow/transactions/${activeReleaseTx.transaction_id}/return`,
        {
          method: 'POST',
          body: JSON.stringify(returnForm),
        }
      );
      setReturnMsg({ type: 'ok', text: res.message });
      setActiveReleaseTx(null);
      setSelectedProperty(null);
      await loadTransactions();
    } catch (err: any) {
      setReturnMsg({ type: 'err', text: err?.message || 'Return processing failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const willTriggerMaintenance =
    !returnForm.is_complete_on_return ||
    ['Needs Repair', 'Damaged', 'Condemned'].includes(returnForm.condition_on_return);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">Borrowing &amp; Returning</h2>
          <p className="text-sm text-slate-600">
            Process borrowing requests, review property availability, release items, and inspect returns.
          </p>
        </div>

        {/* Select Transaction Type */}
        <div className="inline-flex p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => {
              setTxType('borrowing');
              resetFlowState();
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              txType === 'borrowing' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Borrowing
          </button>
          <button
            type="button"
            onClick={() => {
              setTxType('returning');
              resetFlowState();
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              txType === 'returning' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Returning
          </button>
        </div>
      </div>

      {/* Scanner */}
      <QrScannerPanel
        onLookup={handleScanLookup}
        loading={lookupLoading}
        error={lookupError}
        title={
          txType === 'borrowing'
            ? 'Step 1: Scan or Enter Property to Borrow'
            : 'Step 1: Scan or Enter Property Being Returned'
        }
      />

      {borrowActionMsg && (
        <div
          className={`p-4 rounded-xl border text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
            borrowActionMsg.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : borrowActionMsg.type === 'reject'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {borrowActionMsg.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {borrowActionMsg.type === 'reject' && <XCircle className="w-4 h-4 shrink-0" />}
            {borrowActionMsg.type === 'err' && <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{borrowActionMsg.text}</span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="self-start sm:self-auto px-3.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50"
          >
            Return to Dashboard
          </button>
        </div>
      )}

      {returnMsg && (
        <div
          className={`p-4 rounded-xl border text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
            returnMsg.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span className="font-medium">{returnMsg.text}</span>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="self-start sm:self-auto px-3.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50"
          >
            Return to Dashboard
          </button>
        </div>
      )}

      {/* BORROWING FLOW: Step 2 & 3 */}
      {txType === 'borrowing' && selectedProperty && !pendingTx && (
        <form onSubmit={handleCreateBorrowRequest} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="font-mono text-xs font-semibold text-blue-700">{selectedProperty.property_code}</p>
              <h3 className="font-display text-base font-bold text-slate-900">
                {selectedProperty.property_name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedProperty.category_name} · {selectedProperty.location_name}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span>Status: <StatusLabel status={selectedProperty.property_status} /></span>
              <span>Condition: <ConditionLabel condition={selectedProperty.property_condition} /></span>
            </div>
          </div>

          {selectedProperty.property_status !== 'Available' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
              Note: This property is currently <strong>{selectedProperty.property_status}</strong>. You may still log a request for review, but release will be blocked unless status is Available.
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="font-display text-sm font-semibold text-slate-900">
                Step 2: Borrower Information &amp; Borrowing Details
              </h4>
              <div className="flex gap-1 p-0.5 bg-slate-100 rounded-md text-xs">
                <button
                  type="button"
                  onClick={() => setBorrowerMode('existing')}
                  className={`px-3 py-1 rounded font-medium ${borrowerMode === 'existing' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
                >
                  Existing Borrower
                </button>
                <button
                  type="button"
                  onClick={() => setBorrowerMode('new')}
                  className={`px-3 py-1 rounded font-medium ${borrowerMode === 'new' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
                >
                  New Borrower
                </button>
              </div>
            </div>

            {borrowerMode === 'existing' ? (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Select Borrower *</label>
                <select
                  required
                  value={borrowForm.borrower_id}
                  onChange={(e) => setBorrowForm({ ...borrowForm, borrower_id: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {borrowers.map((b) => (
                    <option key={b.borrower_id} value={b.borrower_id}>
                      {b.borrower_name} ({b.id_number} · {b.borrower_type}, {b.department})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={borrowForm.new_borrower_name}
                    onChange={(e) => setBorrowForm({ ...borrowForm, new_borrower_name: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">ID Number *</label>
                  <input
                    type="text"
                    required
                    value={borrowForm.new_id_number}
                    onChange={(e) => setBorrowForm({ ...borrowForm, new_id_number: e.target.value })}
                    placeholder="FAC-2026-001 or 2023-12345"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
                  <select
                    value={borrowForm.new_borrower_type}
                    onChange={(e) => setBorrowForm({ ...borrowForm, new_borrower_type: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Faculty">Faculty</option>
                    <option value="Staff">Staff</option>
                    <option value="Student">Student</option>
                    <option value="Guest">Guest</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    value={borrowForm.new_department}
                    onChange={(e) => setBorrowForm({ ...borrowForm, new_department: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Contact Number</label>
                  <input
                    type="text"
                    value={borrowForm.new_contact_number}
                    onChange={(e) => setBorrowForm({ ...borrowForm, new_contact_number: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={borrowForm.new_email}
                    onChange={(e) => setBorrowForm({ ...borrowForm, new_email: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Purpose of Borrowing *</label>
                <input
                  type="text"
                  required
                  value={borrowForm.purpose}
                  onChange={(e) => setBorrowForm({ ...borrowForm, purpose: e.target.value })}
                  placeholder="e.g. CS 101 Lecture Presentation at Room 301"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Expected Return Date *</label>
                <input
                  type="date"
                  required
                  value={borrowForm.expected_return_date}
                  onChange={(e) => setBorrowForm({ ...borrowForm, expected_return_date: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={resetFlowState}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
            >
              {submitting ? 'Creating Request...' : 'Submit Pending Request for Review'}
            </button>
          </div>
        </form>
      )}

      {/* REVIEW BORROWING REQUEST */}
      {txType === 'borrowing' && pendingTx && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <p className="font-mono text-xs font-semibold text-amber-700">
              {pendingTx.transaction_code} · Pending Review
            </p>
            <h3 className="font-display text-base font-bold text-slate-900 mt-0.5">
              Step 3: Review Borrowing Request
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Is the request approved AND the property available (<span className="font-mono">Available</span>)?
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
              <p className="text-xs text-slate-500">Property</p>
              <p className="font-semibold text-slate-900">{pendingTx.property_name}</p>
              <p className="font-mono text-xs text-slate-600">{pendingTx.property_code} · <StatusLabel status={pendingTx.property_status} /></p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Borrower</p>
              <p className="font-semibold text-slate-900">{pendingTx.borrower_name}</p>
              <p className="text-xs text-slate-600">{pendingTx.id_number} · {pendingTx.department}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Purpose &amp; Due Date</p>
              <p className="text-xs text-slate-800">{pendingTx.purpose}</p>
              <p className="font-mono text-xs text-slate-600 mt-0.5">Due: {pendingTx.expected_return_date}</p>
            </div>
          </div>

          {!showRejectBox ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                disabled={submitting || pendingTx.property_status !== 'Available'}
                onClick={() => handleReviewPending(pendingTx, true)}
                className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg"
              >
                {submitting ? 'Releasing...' : 'Yes — Approve & Release Property'}
              </button>
              <button
                type="button"
                onClick={() => setShowRejectBox(true)}
                className="px-5 py-2.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg"
              >
                No — Reject Request (Do Not Release)
              </button>
            </div>
          ) : (
            <div className="space-y-3 p-4 bg-red-50/70 border border-red-200 rounded-lg">
              <label className="block text-xs font-semibold text-red-900">
                Rejection Reason (Required)
              </label>
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Property unavailable / incomplete borrower clearance"
                className="w-full px-3 py-2 text-sm bg-white border border-red-300 rounded-lg"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={submitting || !rejectionReason.trim()}
                  onClick={() => handleReviewPending(pendingTx, false)}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-lg"
                >
                  Confirm Rejection (Do Not Release Property)
                </button>
                <button
                  type="button"
                  onClick={() => setShowRejectBox(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RETURNING FLOW: Step 2 & 3 */}
      {txType === 'returning' && activeReleaseTx && (
        <form onSubmit={handleConfirmReturn} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="font-mono text-xs font-semibold text-blue-700">
                {activeReleaseTx.transaction_code} · Active Loan
              </p>
              <h3 className="font-display text-base font-bold text-slate-900">
                Receive Returned Property: {activeReleaseTx.property_name} ({activeReleaseTx.property_code})
              </h3>
            </div>
            {Number(activeReleaseTx.is_overdue) === 1 && (
              <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-3 py-1 rounded-md">
                Overdue (Due {activeReleaseTx.expected_return_date})
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
              <p className="text-xs text-slate-500">Borrower</p>
              <p className="font-semibold text-slate-900">{activeReleaseTx.borrower_name}</p>
              <p className="text-xs text-slate-600">{activeReleaseTx.id_number} · {activeReleaseTx.department}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Released At</p>
              <p className="font-mono text-xs text-slate-800">{activeReleaseTx.released_at}</p>
              <p className="text-xs text-slate-500 mt-0.5">Release Cond: {activeReleaseTx.condition_on_release}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Expected Return Date</p>
              <p className="font-mono text-xs text-slate-800">{activeReleaseTx.expected_return_date}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-display text-sm font-semibold text-slate-900">
              Check Property Completeness and Condition
            </h4>

            <div className="flex items-center gap-2.5">
              <input
                id="return-complete-chk"
                type="checkbox"
                checked={returnForm.is_complete_on_return}
                onChange={(e) => setReturnForm({ ...returnForm, is_complete_on_return: e.target.checked })}
                className="w-4 h-4 text-blue-700 border-slate-300 rounded"
              />
              <label htmlFor="return-complete-chk" className="text-sm font-medium text-slate-800">
                All accessories, cables, and components are complete
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Condition on Return *</label>
                <select
                  value={returnForm.condition_on_return}
                  onChange={(e) => setReturnForm({ ...returnForm, condition_on_return: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Good">Good</option>
                  <option value="Fair">Fair</option>
                  <option value="Needs Repair">Needs Repair</option>
                  <option value="Damaged">Damaged</option>
                  <option value="Condemned">Condemned</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Return Remarks</label>
                <input
                  type="text"
                  value={returnForm.return_remarks}
                  onChange={(e) => setReturnForm({ ...returnForm, return_remarks: e.target.value })}
                  placeholder="Note missing accessories or physical damage"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div
              className={`p-3 rounded-lg border text-xs ${
                willTriggerMaintenance
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}
            >
              {willTriggerMaintenance
                ? 'Because the item is incomplete or marked Needs Repair / Damaged / Condemned, its property status will automatically be set to "Under Maintenance".'
                : 'Property is complete and in acceptable condition — its status will automatically be restored to "Available".'}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={resetFlowState}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
            >
              {submitting ? 'Recording Return...' : 'Record Return & Update Property Status'}
            </button>
          </div>
        </form>
      )}

      {/* Borrowing & Returning Transactions Queue */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Borrowing &amp; Returning Transactions
            </h3>
            <p className="text-xs text-slate-500">
              Review pending requests or select an active Released item to process return
            </p>
          </div>
          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            {['', 'Pending', 'Released', 'Returned', 'Rejected'].map((st) => (
              <button
                key={st || 'All'}
                type="button"
                onClick={() => setTxFilter(st)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  txFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st || 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Property</th>
                <th className="py-3 px-4">Borrower</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr
                    key={t.transaction_id}
                    className={Number(t.is_overdue) === 1 ? 'bg-red-50/70' : 'hover:bg-slate-50'}
                  >
                    <td className="py-3 px-4 font-mono text-xs whitespace-nowrap">{t.transaction_code}</td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-slate-900">{t.property_name}</p>
                      <p className="font-mono text-xs text-slate-500">{t.property_code}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-slate-900">{t.borrower_name}</p>
                      <p className="text-xs text-slate-500">{t.id_number} · {t.department}</p>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs whitespace-nowrap">
                      {t.expected_return_date}
                      {Number(t.is_overdue) === 1 && (
                        <span className="block text-red-700 font-semibold">Overdue</span>
                      )}
                    </td>
                    <td className="py-3 px-4"><StatusLabel status={t.transaction_status} /></td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {t.transaction_status === 'Pending' && (
                        <button
                          type="button"
                          onClick={() => {
                            setTxType('borrowing');
                            setPendingTx(t);
                            setSelectedProperty(t);
                            setShowRejectBox(false);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"
                        >
                          Review
                        </button>
                      )}
                      {t.transaction_status === 'Released' && (
                        <button
                          type="button"
                          onClick={() => {
                            setTxType('returning');
                            setActiveReleaseTx(t);
                            setSelectedProperty(t);
                            setReturnForm({
                              is_complete_on_return: true,
                              condition_on_return: t.property_condition || 'Good',
                              return_remarks: '',
                            });
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md"
                        >
                          Process Return
                        </button>
                      )}
                      {t.transaction_status === 'Rejected' && (
                        <span className="text-xs text-slate-500">{t.rejection_reason || 'Rejected'}</span>
                      )}
                      {t.transaction_status === 'Returned' && (
                        <span className="text-xs text-slate-500">{t.condition_on_return || 'Returned'}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
