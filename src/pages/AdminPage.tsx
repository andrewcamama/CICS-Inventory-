import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Unlock, UserCheck, UserX } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export function AdminPage() {
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<'users' | 'categories' | 'locations' | 'logs'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [scanLogs, setScanLogs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Forms
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    full_name: '',
    email: '',
    role: 'staff',
  });
  const [resetTarget, setResetTarget] = useState<{ id: number; username: string } | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const [newCat, setNewCat] = useState({ category_name: '', description: '' });
  const [newLoc, setNewLoc] = useState({
    location_name: '',
    building: 'CICS Main Building',
    room_number: '',
    description: '',
  });

  const loadAll = useCallback(async () => {
    try {
      const [uRes, cRes, lRes, logsRes] = await Promise.all([
        apiRequest<{ users: any[] }>('/api/admin/users'),
        apiRequest<{ categories: any[] }>('/api/admin/categories'),
        apiRequest<{ locations: any[] }>('/api/admin/locations'),
        apiRequest<{ audit_logs: any[]; scan_logs: any[] }>('/api/admin/audit-logs'),
      ]);
      setUsers(uRes.users);
      setCategories(cRes.categories);
      setLocations(lRes.locations);
      setAuditLogs(logsRes.audit_logs);
      setScanLogs(logsRes.scan_logs);
    } catch (err: any) {
      setError(err?.message || 'Failed to load admin records.');
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      setNewUser({ username: '', password: '', full_name: '', email: '', role: 'staff' });
      setMessage('User account created.');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to create user.');
    }
  };

  const handleToggleUser = async (id: number, currentActive: number) => {
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/admin/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: currentActive !== 1 }),
      });
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to update user status.');
    }
  };

  const handleUnlockUser = async (id: number) => {
    setError(null);
    await apiRequest(`/api/admin/users/${id}/unlock`, { method: 'POST' });
    setMessage('Account lockout cleared.');
    await loadAll();
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: resetPassword }),
      });
      setMessage(`Password reset for ${resetTarget.username}.`);
      setResetTarget(null);
      setResetPassword('');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to reset password.');
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify(newCat),
      });
      setNewCat({ category_name: '', description: '' });
      setMessage('Category added.');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to add category.');
    }
  };

  const handleDeleteCategory = async (id: number) => {
    setError(null);
    try {
      await apiRequest(`/api/admin/categories/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete category.');
    }
  };

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/api/admin/locations', {
        method: 'POST',
        body: JSON.stringify(newLoc),
      });
      setNewLoc({ location_name: '', building: 'CICS Main Building', room_number: '', description: '' });
      setMessage('Location added.');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to add location.');
    }
  };

  const handleDeleteLocation = async (id: number) => {
    setError(null);
    try {
      await apiRequest(`/api/admin/locations/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete location.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">Admin Settings</h2>
          <p className="text-sm text-slate-600">
            Manage CICS user accounts, asset categories, room locations, and review audit &amp; scan logs.
          </p>
        </div>
        <div className="inline-flex p-1 bg-slate-200/70 rounded-lg self-start flex-wrap">
          {(
            [
              ['users', 'Users'],
              ['categories', 'Categories'],
              ['locations', 'Locations'],
              ['logs', 'Audit & Scan Logs'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                tab === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
      )}
      {message && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900">{message}</div>
      )}

      {tab === 'users' && (
        <div className="space-y-6">
          <form onSubmit={handleCreateUser} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-display text-sm font-semibold text-slate-900">Create New User</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <input
                type="text"
                required
                placeholder="Username *"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="Password (8+ chars) *"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                required
                placeholder="Full Name *"
                value={newUser.full_name}
                onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <input
                type="email"
                placeholder="Email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <div className="flex gap-2">
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="flex-1 px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="staff">Staff</option>
                  <option value="property_custodian">Custodian</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </div>
          </form>

          {resetTarget && (
            <form onSubmit={handleResetPasswordSubmit} className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="text-xs font-semibold text-amber-950">
                Reset password for {resetTarget.username}:
              </span>
              <input
                type="password"
                required
                minLength={8}
                placeholder="New password (min 8 chars)"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm bg-white border border-amber-300 rounded-lg"
              />
              <div className="flex gap-2">
                <button type="submit" className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg">
                  Save Password
                </button>
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Username</th>
                    <th className="py-3 px-4">Full Name</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Last Login</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.user_id}>
                      <td className="py-3 px-4 font-mono text-xs font-semibold">{u.username}</td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{u.full_name}</p>
                        <p className="text-xs text-slate-500">{u.email || '—'}</p>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">{u.role}</td>
                      <td className="py-3 px-4 text-xs">
                        {Number(u.is_active) === 1 ? (
                          <span className="text-emerald-700 font-semibold">Active</span>
                        ) : (
                          <span className="text-red-700 font-semibold">Inactive</span>
                        )}
                        {u.locked_until && (
                          <span className="block text-amber-700">Locked until {u.locked_until}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">
                        {u.last_login_at || 'Never'}
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setResetTarget({ id: u.user_id, username: u.username })}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded inline-flex items-center gap-1"
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>Reset PW</span>
                        </button>
                        {u.locked_until && (
                          <button
                            type="button"
                            onClick={() => handleUnlockUser(u.user_id)}
                            className="px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded inline-flex items-center gap-1"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Unlock</span>
                          </button>
                        )}
                        {u.user_id !== currentUser?.user_id && (
                          <button
                            type="button"
                            onClick={() => handleToggleUser(u.user_id, u.is_active)}
                            className={`px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1 ${
                              Number(u.is_active) === 1
                                ? 'text-red-700 bg-red-50 hover:bg-red-100'
                                : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                            }`}
                          >
                            {Number(u.is_active) === 1 ? (
                              <>
                                <UserX className="w-3 h-3" />
                                <span>Deactivate</span>
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-3 h-3" />
                                <span>Activate</span>
                              </>
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'categories' && (
        <div className="space-y-6">
          <form onSubmit={handleCreateCategory} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              required
              placeholder="Category Name *"
              value={newCat.category_name}
              onChange={(e) => setNewCat({ ...newCat, category_name: e.target.value })}
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              placeholder="Description"
              value={newCat.description}
              onChange={(e) => setNewCat({ ...newCat, description: e.target.value })}
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <button type="submit" className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg">
              Add Category
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 text-right">Properties</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((c) => (
                  <tr key={c.category_id}>
                    <td className="py-3 px-4 font-medium">{c.category_name}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">{c.description || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">{c.property_count}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(c.category_id)}
                        className="p-1.5 text-red-700 hover:bg-red-50 rounded"
                        aria-label={`Delete ${c.category_name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'locations' && (
        <div className="space-y-6">
          <form onSubmit={handleCreateLocation} className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="text"
              required
              placeholder="Location Name *"
              value={newLoc.location_name}
              onChange={(e) => setNewLoc({ ...newLoc, location_name: e.target.value })}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              placeholder="Building"
              value={newLoc.building}
              onChange={(e) => setNewLoc({ ...newLoc, building: e.target.value })}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              placeholder="Room Number"
              value={newLoc.room_number}
              onChange={(e) => setNewLoc({ ...newLoc, room_number: e.target.value })}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <button type="submit" className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg">
              Add Location
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Building / Room</th>
                  <th className="py-3 px-4 text-right">Properties</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {locations.map((l) => (
                  <tr key={l.location_id}>
                    <td className="py-3 px-4 font-medium">{l.location_name}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {l.building}{l.room_number ? ` · Rm ${l.room_number}` : ''}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">{l.property_count}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteLocation(l.location_id)}
                        className="p-1.5 text-red-700 hover:bg-red-50 rounded"
                        aria-label={`Delete ${l.location_name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="font-display text-sm font-semibold text-slate-900">Audit Logs</h3>
            </div>
            <div className="overflow-x-auto max-h-[520px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">User</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((a) => (
                    <tr key={a.audit_id}>
                      <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">{a.created_at}</td>
                      <td className="py-2.5 px-3 font-mono">{a.username || '—'}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-800">{a.action}</td>
                      <td className="py-2.5 px-3 text-slate-700">{a.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="font-display text-sm font-semibold text-slate-900">QR / Barcode Scan Logs</h3>
            </div>
            <div className="overflow-x-auto max-h-[520px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Code</th>
                    <th className="py-2.5 px-3">Method</th>
                    <th className="py-2.5 px-3">Module</th>
                    <th className="py-2.5 px-3">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {scanLogs.map((s) => (
                    <tr key={s.scan_id}>
                      <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">{s.scanned_at}</td>
                      <td className="py-2.5 px-3 font-mono">{s.scanned_code}</td>
                      <td className="py-2.5 px-3">{s.scan_method}</td>
                      <td className="py-2.5 px-3">{s.module}</td>
                      <td className="py-2.5 px-3">
                        {Number(s.is_successful) === 1 ? (
                          <span className="text-emerald-700 font-semibold">Found</span>
                        ) : (
                          <span className="text-red-700 font-semibold">Miss</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
