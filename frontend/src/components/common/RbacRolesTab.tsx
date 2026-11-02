import React, { useState, useEffect } from 'react';
import { request } from '../../services/api';
import {
  Shield,
  Plus,
  Check,
  X,
  Edit2,
  Trash2,
  Lock,
  Users,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Layers,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

export interface RoleData {
  key: string;
  name: string;
  description: string;
  isSystemRole: boolean;
  permissions: string[];
  userCount: number;
}

const PERMISSION_GROUPS: Record<string, { label: string; perms: { key: string; label: string }[] }> = {
  employee: {
    label: 'Employee Directory & Lifecycle',
    perms: [
      { key: 'employee:view_all', label: 'View All Employees' },
      { key: 'employee:view_team', label: 'View Direct Team' },
      { key: 'employee:view_self', label: 'View Self Profile' },
      { key: 'employee:create', label: 'Create New Employee / Onboard' },
      { key: 'employee:edit_all', label: 'Edit Any Employee' },
      { key: 'employee:edit_hr', label: 'Edit HR & Official Data' },
      { key: 'employee:edit_self', label: 'Edit Personal Details' },
      { key: 'employee:delete', label: 'Delete Employee Record' },
      { key: 'employee:deactivate', label: 'Deactivate / Offboard' },
    ],
  },
  org: {
    label: 'Organization & Departments',
    perms: [
      { key: 'org:configure', label: 'Configure Company Settings' },
      { key: 'department:manage', label: 'Manage Departments' },
      { key: 'designation:manage', label: 'Manage Designations' },
      { key: 'location:manage', label: 'Manage Office Locations' },
    ],
  },
  policy: {
    label: 'Company Policies',
    perms: [
      { key: 'policy:create', label: 'Create Company Policies' },
      { key: 'policy:edit', label: 'Edit Existing Policies' },
      { key: 'policy:delete', label: 'Delete Policies' },
      { key: 'policy:view', label: 'View Policies' },
      { key: 'policy:acknowledge', label: 'Acknowledge Policy Signoffs' },
    ],
  },
  attendance: {
    label: 'Attendance & Overtime',
    perms: [
      { key: 'attendance:checkin_out', label: 'Punch Check-in / Out' },
      { key: 'attendance:view_self', label: 'View Self Attendance' },
      { key: 'attendance:view_team', label: 'View Team Attendance' },
      { key: 'attendance:view_all', label: 'View All Attendance Logs' },
      { key: 'attendance:manage', label: 'Approve & Regularize Overtime' },
    ],
  },
  leave: {
    label: 'Leave Management',
    perms: [
      { key: 'leave:apply', label: 'Apply For Leave' },
      { key: 'leave:view_self', label: 'View Self Leave Balance' },
      { key: 'leave:view_team', label: 'View Team Leave Requests' },
      { key: 'leave:view_all', label: 'View All Leave Records' },
      { key: 'leave:approve_team', label: 'Approve Team Leave' },
      { key: 'leave:approve_all', label: 'Approve Any Leave' },
      { key: 'leave:configure', label: 'Configure Leave Quotas & Types' },
    ],
  },
  expense: {
    label: 'Expense Claims',
    perms: [
      { key: 'expense:apply', label: 'Submit Expense Claim' },
      { key: 'expense:view_self', label: 'View Self Expenses' },
      { key: 'expense:view_team', label: 'View Team Expenses' },
      { key: 'expense:view_all', label: 'View All Expense Claims' },
      { key: 'expense:approve_team', label: 'Approve Team Claims' },
      { key: 'expense:approve_all', label: 'Approve All Claims' },
      { key: 'expense:configure', label: 'Configure Expense Policies' },
    ],
  },
  payroll: {
    label: 'Payroll & Tax',
    perms: [
      { key: 'payroll:view_self', label: 'View Personal Payslips' },
      { key: 'payroll:view_all', label: 'View Company Payroll' },
      { key: 'payroll:process', label: 'Execute Monthly Payroll' },
      { key: 'payroll:configure', label: 'Configure CTC & Salary Bands' },
      { key: 'tax:view_self', label: 'View Self Tax Calculations' },
      { key: 'tax:manage_all', label: 'Manage Form 24Q & Tax' },
      { key: 'form16:view_self', label: 'Download Self Form 16' },
      { key: 'form16:generate', label: 'Generate Company Form 16' },
    ],
  },
  document: {
    label: 'Documents & HR Letters',
    perms: [
      { key: 'document:view_self', label: 'View Self Documents' },
      { key: 'document:view_all', label: 'View All Vault Documents' },
      { key: 'document:verify', label: 'Verify Compliance Documents' },
      { key: 'document:generate_letters', label: 'Generate HR Offer/Relieving Letters' },
    ],
  },
  posh: {
    label: 'POSH & Compliance',
    perms: [
      { key: 'posh:view_cases', label: 'View POSH Cases' },
      { key: 'posh:manage', label: 'Manage POSH Investigations' },
    ],
  },
  ai: {
    label: 'AI HR Assistant',
    perms: [
      { key: 'ai:use', label: 'Use AI Assistant Chat' },
      { key: 'ai:configure', label: 'Configure AI Prompt & Policy Sync' },
    ],
  },
  audit: {
    label: 'Security & Audit Logs',
    perms: [
      { key: 'audit:view', label: 'View Immutable Audit Logs' },
      { key: 'report:view_all', label: 'View All Structured Reports' },
      { key: 'report:view_team', label: 'View Team Reports' },
      { key: 'report:view_self', label: 'View Self Reports' },
    ],
  },
};

interface RbacRolesTabProps {
  // Hides create / edit / delete while the backend only exposes the built-in roles
  readOnly?: boolean;
}

export const RbacRolesTab: React.FC<RbacRolesTabProps> = ({ readOnly = false }) => {
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoleKey, setActiveRoleKey] = useState<string>('ADMIN');
  const [editModalRole, setEditModalRole] = useState<RoleData | null>(null);
  const [isAddRoleModalOpen, setIsAddRoleModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'matrix'>('cards');

  // Form states
  const [roleName, setRoleName] = useState('');
  const [roleKeyInput, setRoleKeyInput] = useState('');
  const [roleDesc, setRoleDesc] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await request<{ roles: RoleData[] }>('/rbac/roles');
      setRoles(res.roles || []);
      if (res.roles && res.roles.length > 0 && !activeRoleKey) {
        setActiveRoleKey(res.roles[0].key);
      }
    } catch (err: any) {
      console.error('Failed to load RBAC roles', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    setRoleName('');
    setRoleKeyInput('');
    setRoleDesc('');
    setSelectedPerms([
      'employee:view_self',
      'attendance:checkin_out',
      'attendance:view_self',
      'leave:apply',
      'leave:view_self',
      'policy:view',
      'ai:use',
    ]);
    setIsAddRoleModalOpen(true);
  };

  const handleOpenEditModal = (role: RoleData) => {
    setEditModalRole(role);
    setRoleName(role.name);
    setRoleKeyInput(role.key);
    setRoleDesc(role.description);
    setSelectedPerms([...role.permissions]);
  };

  const handleTogglePermission = (permKey: string) => {
    setSelectedPerms((prev) =>
      prev.includes(permKey) ? prev.filter((p) => p !== permKey) : [...prev, permKey]
    );
  };

  const handleToggleGroup = (groupPerms: string[]) => {
    const allSelected = groupPerms.every((p) => selectedPerms.includes(p));
    if (allSelected) {
      setSelectedPerms((prev) => prev.filter((p) => !groupPerms.includes(p)));
    } else {
      setSelectedPerms((prev) => Array.from(new Set([...prev, ...groupPerms])));
    }
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim()) return;

    setSaving(true);
    setFeedback(null);

    try {
      const isEditing = Boolean(editModalRole);
      const url = isEditing ? `/rbac/roles/${editModalRole!.key}` : '/rbac/roles';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await request<{ success: boolean; message: string; role: RoleData }>(url, {
        method,
        body: JSON.stringify({
          key: roleKeyInput || roleName.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
          name: roleName.trim(),
          description: roleDesc.trim(),
          permissions: selectedPerms,
        }),
      });

      setFeedback({ type: 'success', message: res.message || 'Role saved successfully.' });
      setTimeout(() => {
        setIsAddRoleModalOpen(false);
        setEditModalRole(null);
        setFeedback(null);
        fetchRoles();
      }, 1200);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save role.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (roleKey: string) => {
    if (!window.confirm(`Are you sure you want to delete custom role "${roleKey}"?`)) return;
    try {
      await request(`/rbac/roles/${roleKey}`, { method: 'DELETE' });
      fetchRoles();
    } catch (err: any) {
      alert(err.message || 'Failed to delete role.');
    }
  };

  const activeRole = roles.find((r) => r.key === activeRoleKey) || roles[0];

  return (
    <div className="space-y-6">
      {/* Subheader banner */}
      <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Role-Based Access Control (RBAC) Matrix
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span>Roles & Functional Access Permissions</span>
          </h2>
          <p className="text-xs text-slate-300 mt-0.5">
            {readOnly
              ? 'Built-in roles and the module permissions each one grants.'
              : 'Configure system default roles or create custom enterprise roles with granular module permissions.'}
          </p>
        </div>

        <div className="flex items-center gap-3 self-start md:self-auto">
          <div className="bg-slate-800 p-1 rounded-xl border border-slate-700 flex items-center gap-1">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                viewMode === 'cards' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Role Cards
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                viewMode === 'matrix' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Access Matrix
            </button>
          </div>

          {!readOnly && (
            <button
              onClick={handleOpenAddModal}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-colors shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Custom Role</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200">
          <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-mono">Loading RBAC roles & access map...</p>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Roles Selector Sidebar */}
          <div className="lg:col-span-4 space-y-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 px-1">
                Configured Roles ({roles.length})
              </h3>
              <div className="space-y-2">
                {roles.map((r) => {
                  const isActive = r.key === activeRoleKey;
                  return (
                    <div
                      key={r.key}
                      onClick={() => setActiveRoleKey(r.key)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-900 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                              isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-800'
                            }`}
                          >
                            {r.key}
                          </span>
                          {r.isSystemRole && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              System
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full ${
                            isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {r.userCount} Users
                        </span>
                      </div>

                      <h4 className="font-bold text-sm mt-2">{r.name}</h4>
                      <p className={`text-xs mt-1 line-clamp-2 ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                        {r.description}
                      </p>

                      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-200/20 text-[11px] font-mono">
                        <span className={isActive ? 'text-emerald-400' : 'text-indigo-600'}>
                          {r.permissions.length} Permissions Active
                        </span>
                        <ChevronRight className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Role Details & Permissions Inspection Panel */}
          {activeRole && (
            <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-slate-900 text-white">
                      {activeRole.key}
                    </span>
                    {activeRole.isSystemRole ? (
                      <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                        Protected System Role
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                        Custom Organization Role
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mt-2">{activeRole.name}</h3>
                  <p className="text-xs text-slate-600 mt-1">{activeRole.description}</p>
                </div>

                {!readOnly && (
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    onClick={() => handleOpenEditModal(activeRole)}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit Permissions</span>
                  </button>

                  {!activeRole.isSystemRole && (
                    <button
                      onClick={() => handleDeleteRole(activeRole.key)}
                      className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl transition-colors cursor-pointer"
                      title="Delete Role"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                )}
              </div>

              {/* Active Permissions Breakdown by Group */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Allowed Module Access Permissions ({activeRole.permissions.length})
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(PERMISSION_GROUPS).map(([grpKey, grp]) => {
                    const activeCount = grp.perms.filter((p) =>
                      activeRole.permissions.includes(p.key)
                    ).length;

                    return (
                      <div
                        key={grpKey}
                        className={`p-4 rounded-xl border text-xs space-y-2.5 ${
                          activeCount > 0 ? 'bg-slate-50/80 border-slate-200' : 'bg-slate-50/20 border-slate-100 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                          <span className="font-bold text-slate-900">{grp.label}</span>
                          <span
                            className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                              activeCount === grp.perms.length
                                ? 'bg-emerald-100 text-emerald-800'
                                : activeCount > 0
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-slate-200 text-slate-500'
                            }`}
                          >
                            {activeCount} / {grp.perms.length} Enabled
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          {grp.perms.map((p) => {
                            const isAllowed = activeRole.permissions.includes(p.key);
                            return (
                              <div
                                key={p.key}
                                className={`flex items-center justify-between py-1 px-2 rounded font-mono text-[11px] ${
                                  isAllowed ? 'bg-emerald-50/60 text-emerald-950 font-semibold' : 'text-slate-400'
                                }`}
                              >
                                <span className="truncate">{p.label}</span>
                                {isAllowed ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                ) : (
                                  <span className="text-[10px] text-slate-300">Off</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Full Access Matrix View */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Comprehensive Role Permission Matrix</h3>
              <p className="text-xs text-slate-500">Cross-role permission comparison for auditing access controls</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/80 text-[11px] font-bold text-slate-600 uppercase">
                  <th className="py-3.5 px-4 sticky left-0 bg-slate-100 z-10 w-64">Permission Capability</th>
                  {roles.map((r) => (
                    <th key={r.key} className="py-3.5 px-3 text-center min-w-[110px]">
                      <div className="font-bold text-slate-900 font-mono text-xs">{r.key}</div>
                      <div className="text-[10px] font-normal text-slate-500 truncate max-w-[120px] mx-auto">{r.name}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {Object.entries(PERMISSION_GROUPS).map(([grpKey, grp]) => (
                  <React.Fragment key={grpKey}>
                    <tr className="bg-slate-900 text-white font-sans font-bold text-xs">
                      <td colSpan={roles.length + 1} className="py-2.5 px-4">
                        {grp.label}
                      </td>
                    </tr>
                    {grp.perms.map((p) => (
                      <tr key={p.key} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-sans text-slate-800 font-medium sticky left-0 bg-white shadow-2xs">
                          <div>{p.label}</div>
                          <div className="text-[10px] font-mono text-slate-400">{p.key}</div>
                        </td>
                        {roles.map((r) => {
                          const hasPerm = r.permissions.includes(p.key);
                          return (
                            <td key={r.key} className="py-2.5 px-3 text-center">
                              {hasPerm ? (
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700">
                                  <Check className="w-3.5 h-3.5" />
                                </span>
                              ) : (
                                <span className="text-slate-300 font-sans text-xs">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Role Modal */}
      {(isAddRoleModalOpen || editModalRole) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">
                  {editModalRole ? `Edit Role: ${editModalRole.name}` : 'Create New Custom Role'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setIsAddRoleModalOpen(false);
                  setEditModalRole(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {feedback && (
              <div
                className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                  feedback.type === 'success'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border border-rose-200 text-rose-800'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                )}
                <span>{feedback.message}</span>
              </div>
            )}

            <form onSubmit={handleSaveRole} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role Title *</label>
                  <input
                    type="text"
                    required
                    value={roleName}
                    onChange={(e) => {
                      setRoleName(e.target.value);
                      if (!editModalRole) {
                        setRoleKeyInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '_'));
                      }
                    }}
                    placeholder="e.g. Payroll Auditor / Recruiter"
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role Identifier Key *</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editModalRole)}
                    value={roleKeyInput}
                    onChange={(e) => setRoleKeyInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '_'))}
                    placeholder="RECRUITER"
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description & Responsibilities</label>
                <input
                  type="text"
                  value={roleDesc}
                  onChange={(e) => setRoleDesc(e.target.value)}
                  placeholder="Summarize the core functional access and scope of this role..."
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              {/* Permission Checkbox Selector Matrix */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Module Permission Checkboxes ({selectedPerms.length} Selected)
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPerms(
                          Object.values(PERMISSION_GROUPS).flatMap((g) => g.perms.map((p) => p.key))
                        )
                      }
                      className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedPerms([])}
                      className="text-[11px] font-bold text-slate-500 hover:underline cursor-pointer"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto pr-1">
                  {Object.entries(PERMISSION_GROUPS).map(([grpKey, grp]) => {
                    const groupPermKeys = grp.perms.map((p) => p.key);
                    const isAllGroupSelected = groupPermKeys.every((k) => selectedPerms.includes(k));

                    return (
                      <div key={grpKey} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                          <span className="font-bold text-xs text-slate-900">{grp.label}</span>
                          <button
                            type="button"
                            onClick={() => handleToggleGroup(groupPermKeys)}
                            className="text-[10px] font-bold text-indigo-700 hover:underline cursor-pointer"
                          >
                            {isAllGroupSelected ? 'Deselect Group' : 'Select Group'}
                          </button>
                        </div>

                        <div className="space-y-1">
                          {grp.perms.map((p) => {
                            const checked = selectedPerms.includes(p.key);
                            return (
                              <label
                                key={p.key}
                                className="flex items-center gap-2.5 py-1 px-1.5 rounded hover:bg-white cursor-pointer select-none text-xs"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => handleTogglePermission(p.key)}
                                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                                />
                                <span className={checked ? 'font-semibold text-slate-900' : 'text-slate-600'}>
                                  {p.label}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddRoleModalOpen(false);
                    setEditModalRole(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Role & Permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
