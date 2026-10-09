import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { employeeService } from '../services/employeeService';
import { AllocatedAsset, AssetType, AssetCategory } from '../types/modules';
import {
  Laptop,
  Plug,
  Smartphone,
  Car,
  Package,
  CheckCircle2,
  XCircle,
  Plus,
  X,
  Undo2,
  Tablet,
  Headset,
  Armchair,
  KeyRound,
  Bike,
  History,
} from 'lucide-react';

export const ASSET_CATEGORIES: { id: AssetCategory | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All Categories' },
  { id: 'ELECTRONICS', label: 'Electronics' },
  { id: 'FURNITURE', label: 'Furniture' },
  { id: 'SOFTWARE_LICENSES', label: 'Software Licenses' },
  { id: 'VEHICLES', label: 'Vehicles' },
  { id: 'OTHER', label: 'Other' },
];

const ASSET_META: Record<AssetType, { label: string; category: AssetCategory; icon: React.ComponentType<{ className?: string }> }> = {
  LAPTOP: { label: 'Laptop', category: 'ELECTRONICS', icon: Laptop },
  PHONE: { label: 'Smartphone', category: 'ELECTRONICS', icon: Smartphone },
  CHARGER: { label: 'Charger', category: 'ELECTRONICS', icon: Plug },
  TABLET: { label: 'Tablet', category: 'ELECTRONICS', icon: Tablet },
  HEADSET: { label: 'Headset', category: 'ELECTRONICS', icon: Headset },
  CHAIR: { label: 'Ergonomic Chair', category: 'FURNITURE', icon: Armchair },
  DESK: { label: 'Office Desk', category: 'FURNITURE', icon: Package },
  CABINET: { label: 'Storage Cabinet', category: 'FURNITURE', icon: Package },
  SOFTWARE_LICENSE: { label: 'Software License', category: 'SOFTWARE_LICENSES', icon: KeyRound },
  SUBSCRIPTION: { label: 'SaaS Subscription', category: 'SOFTWARE_LICENSES', icon: KeyRound },
  CAR: { label: 'Company Car', category: 'VEHICLES', icon: Car },
  BIKE: { label: 'Company Bike', category: 'VEHICLES', icon: Bike },
  OTHER: { label: 'Other Asset', category: 'OTHER', icon: Package },
};

const emptyForm = {
  employeeId: '',
  category: 'ELECTRONICS' as AssetCategory,
  type: 'LAPTOP' as AssetType,
  name: '',
  assetTag: '',
  serialNumber: '',
  issuedDate: new Date().toISOString().split('T')[0],
  notes: '',
};

export const AssetsPage: React.FC = () => {
  const { user } = useAuth();
  const [assets, setAssets] = useState<AllocatedAsset[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [employees, setEmployees] = useState<{ _id: string; name: string; code: string }[]>([]);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [showReturned, setShowReturned] = useState(false);

  const [isOpen, setIsOpen] = useState(false);
  const [selectedAssetForHistory, setSelectedAssetForHistory] = useState<AllocatedAsset | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await modulesService.getAssets(filterEmployee || undefined);
      setAssets(Array.isArray(res?.assets) ? res.assets : []);
      setCanManage(res?.canManage ?? false);
    } catch (err: any) {
      setError(err?.message || 'Could not load assets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filterEmployee]);

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      employeeService
        .getEmployees()
        .then((res) =>
          setEmployees(
            res.employees.map((e) => ({
              _id: e._id,
              name: `${e.firstName} ${e.lastName}`,
              code: e.employeeCode,
            }))
          )
        )
        .catch((e) => console.error('Failed to load employees', e));
    }
  }, [user?.role]);

  const active = useMemo(() => assets.filter((a) => a.status === 'ALLOCATED'), [assets]);

  const filtered = useMemo(() => {
    let list = showReturned ? assets : active;
    if (selectedCategory !== 'ALL') {
      list = list.filter((a) => (a.category || ASSET_META[a.type]?.category) === selectedCategory);
    }
    return list;
  }, [assets, active, showReturned, selectedCategory]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await modulesService.allocateAsset({
        ...form,
        serialNumber: form.serialNumber || undefined,
        notes: form.notes || undefined,
      });
      setIsOpen(false);
      setForm(emptyForm);
      flash('Asset allocated successfully.');
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Could not allocate the asset.');
    } finally {
      setSaving(false);
    }
  };

  const handleReturn = async (a: AllocatedAsset) => {
    if (!window.confirm(`Mark ${a.name} (${a.assetTag}) as returned by ${a.employeeName}?`)) return;
    try {
      await modulesService.returnAsset(a._id);
      flash('Asset marked as returned.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not update the asset.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Allocated Assets
          </h1>
        </div>
        {canManage && (
          <button
            onClick={() => {
              setForm(emptyForm);
              setFormError(null);
              setIsOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm shrink-0 border border-[#039583] cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Allocate Asset
          </button>
        )}
      </div>

      {notice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">{notice}</div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {/* Category Filter Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-2 overflow-x-auto no-scrollbar">
        {ASSET_CATEGORIES.map((cat) => {
          const count = cat.id === 'ALL' ? active.length : active.filter((a) => (a.category || ASSET_META[a.type]?.category) === cat.id).length;
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition shrink-0 flex items-center gap-2 cursor-pointer ${
                isActive
                  ? 'bg-[#023b77] text-white shadow-sm'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <span>{cat.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${isActive ? 'bg-[#039583] text-white' : 'bg-slate-200 text-slate-700'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">
            {selectedCategory === 'ALL' ? 'All categories' : selectedCategory.replace('_', ' ')} — {showReturned ? 'All assets' : 'Currently allocated'} ({filtered.length})
          </h2>
          <div className="flex items-center gap-3 text-xs">
            {canManage && (
              <select
                value={filterEmployee}
                onChange={(e) => setFilterEmployee(e.target.value)}
                className="p-2 bg-slate-50 border border-slate-200 rounded-xl"
              >
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e._id} value={e._id}>
                    {e.name} ({e.code})
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
              <input type="checkbox" checked={showReturned} onChange={(e) => setShowReturned(e.target.checked)} />
              Show returned
            </label>
          </div>
        </div>

        {loading ? (
          <p className="p-10 text-center text-xs text-slate-400">Loading assets...</p>
        ) : filtered.length === 0 ? (
          <p className="p-10 text-center text-xs text-slate-400">No assets found in this category.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
               <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                <tr>
                  {canManage && <th className="text-left px-4 py-2.5">Employee</th>}
                  <th className="text-left px-4 py-2.5">Asset & Category</th>
                  <th className="text-left px-4 py-2.5">Tag / Serial</th>
                  <th className="text-left px-4 py-2.5">Issued</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-right px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((a) => {
                  const meta = ASSET_META[a.type] || { label: a.type, category: a.category || 'ELECTRONICS', icon: Package };
                  const Icon = meta.icon;
                  const catLabel = (a.category || meta.category).replace('_', ' ');
                  return (
                    <tr key={a._id} className="hover:bg-slate-50/60">
                      {canManage && (
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{a.employeeName}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{a.employeeCode}</p>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{a.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="px-1.5 py-0.2 bg-slate-100 text-slate-700 font-mono text-[10px] rounded">
                                {catLabel}
                              </span>
                              <span className="text-[11px] text-slate-400">{meta.label}{a.notes ? ` • ${a.notes}` : ''}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">
                        {a.assetTag}
                        {a.serialNumber && <div className="text-[11px] text-slate-400">{a.serialNumber}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {a.issuedDate}
                        <div className="text-[11px] text-slate-400">by {a.allocatedBy}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            a.status === 'ALLOCATED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {a.status === 'ALLOCATED' ? 'Allocated' : `Returned ${a.returnedDate || ''}`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setSelectedAssetForHistory(a)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 font-semibold text-slate-700 cursor-pointer shadow-xs"
                            title="View allocation history log"
                          >
                            <History className="w-3.5 h-3.5 text-slate-500" /> History
                          </button>
                          {canManage && a.status === 'ALLOCATED' && (
                            <button
                              onClick={() => handleReturn(a)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 font-semibold text-slate-700 cursor-pointer"
                            >
                              <Undo2 className="w-3.5 h-3.5" /> Return
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Allocate modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">Allocate an Asset</h3>
              <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAllocate} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Employee *</label>
                <select
                  required
                  value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <option value="">Select employee...</option>
                  {employees.map((e) => (
                    <option key={e._id} value={e._id}>
                      {e.name} ({e.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category *</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as AssetCategory })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                  >
                    <option value="ELECTRONICS">Electronics</option>
                    <option value="FURNITURE">Furniture</option>
                    <option value="SOFTWARE_LICENSES">Software Licenses</option>
                    <option value="VEHICLES">Vehicles</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Asset type *</label>
                  <select
                    value={form.type}
                    onChange={(e) => {
                      const type = e.target.value as AssetType;
                      const meta = ASSET_META[type];
                      setForm({ ...form, type, category: meta ? meta.category : form.category });
                    }}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    {(Object.keys(ASSET_META) as AssetType[]).map((t) => (
                      <option key={t} value={t}>
                        {ASSET_META[t].label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Issued on</label>
                  <input
                    type="date"
                    value={form.issuedDate}
                    onChange={(e) => setForm({ ...form, issuedDate: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Asset tag *</label>
                  <input
                    required
                    value={form.assetTag}
                    onChange={(e) => setForm({ ...form, assetTag: e.target.value })}
                    placeholder="RHY-AST-0150"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Make / model / item name *</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. MacBook Pro 16, Herman Miller Chair, JetBrains License"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Serial / registration no.</label>
                <input
                  value={form.serialNumber}
                  onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  placeholder="Optional serial number or license key"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  placeholder="Configuration, specs, or assignment remarks"
                />
              </div>

              {formError && <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">{formError}</div>}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setIsOpen(false)} className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl disabled:opacity-50 cursor-pointer">
                  {saving ? 'Saving...' : 'Allocate Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* History Modal / Side Drawer */}
      {selectedAssetForHistory && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-end p-0 sm:p-4">
          <div className="bg-white h-full sm:h-auto sm:max-h-[90vh] w-full sm:max-w-md sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            <div className="p-6 bg-[#023b77] text-white flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#039583] text-white">
                    {selectedAssetForHistory.assetTag}
                  </span>
                  <span className="text-xs text-slate-200 font-mono">{selectedAssetForHistory.serialNumber || 'No Serial #'}</span>
                </div>
                <h3 className="text-lg font-bold mt-1 text-white">{selectedAssetForHistory.name}</h3>
              </div>
              <button
                onClick={() => setSelectedAssetForHistory(null)}
                className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Current Status:</span>
                  <span className={`font-bold uppercase ${selectedAssetForHistory.status === 'ALLOCATED' ? 'text-emerald-600' : 'text-slate-600'}`}>
                    {selectedAssetForHistory.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Assigned Employee:</span>
                  <span className="font-semibold text-slate-900">{selectedAssetForHistory.employeeName} ({selectedAssetForHistory.employeeCode})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Department:</span>
                  <span className="font-medium text-slate-700">{selectedAssetForHistory.department}</span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                  Allocation Timeline & History Log
                </h4>
                <div className="space-y-3 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-200">
                  {(selectedAssetForHistory.history || []).map((h, idx) => (
                    <div key={idx} className="relative flex items-start gap-3 pl-2">
                      <div className={`w-3 h-3 rounded-full mt-1 shrink-0 z-10 border-2 border-white ${
                        h.action === 'ALLOCATED' ? 'bg-emerald-500' : 'bg-amber-500'
                      }`} />
                      <div className="flex-1 bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                            h.action === 'ALLOCATED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {h.action}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">{h.date}</span>
                        </div>
                        <p className="font-semibold text-slate-900">
                          {h.employeeName} <span className="text-slate-400 font-mono font-normal">({h.employeeCode})</span>
                        </p>
                        {h.performedBy && (
                          <p className="text-[11px] text-slate-500">
                            Authorized by: <span className="font-medium text-slate-700">{h.performedBy}</span>
                          </p>
                        )}
                        {h.notes && (
                          <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg mt-1 border border-slate-100">
                            {h.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button
                onClick={() => setSelectedAssetForHistory(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs cursor-pointer"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
