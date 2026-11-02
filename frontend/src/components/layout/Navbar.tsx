import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types/auth';
import { Bell, LogOut, ChevronDown, UserCheck } from 'lucide-react';
import { VetanLogo } from '../common/anusyuti_logo';

interface NavbarProps {
  onOpenNotifications: () => void;
  unreadCount?: number;
  currentSectionTitle?: string;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenNotifications,
  unreadCount = 2,
  currentSectionTitle = 'vetan.ai.',
  isSidebarOpen,
  onToggleSidebar,
}) => {
  const { user, logout, switchRole } = useAuth();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const handleRoleSwitch = async (role: Role) => {
    setIsSwitching(true);
    try {
      await switchRole(role);
      setIsProfileOpen(false);
    } catch (err) {
      console.error('Failed to switch role', err);
    } finally {
      setIsSwitching(false);
    }
  };

  const getRoleBadgeStyle = (role: Role) => {
    switch (role) {
      case 'SUPER_ADMIN':
      case 'ADMIN':
        return 'bg-purple-500/20 text-purple-200 border-purple-400/40 shadow-xs';
      case 'ADMIN_1':
        return 'bg-indigo-500/20 text-indigo-200 border-indigo-400/40 shadow-xs';
      case 'ADMIN_2':
        return 'bg-violet-500/20 text-violet-200 border-violet-400/40 shadow-xs';
      case 'HR':
        return 'bg-teal-500/20 text-teal-200 border-teal-400/40 shadow-xs';
      case 'FINANCE':
        return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40 shadow-xs';
      case 'ACCOUNTS':
        return 'bg-amber-500/20 text-amber-200 border-amber-400/40 shadow-xs';
      case 'AUDITORS':
        return 'bg-rose-500/20 text-rose-200 border-rose-400/40 shadow-xs';
      case 'MANAGER':
        return 'bg-blue-500/20 text-blue-200 border-blue-400/40 shadow-xs';
      case 'EMPLOYEE':
      default:
        return 'bg-slate-500/20 text-slate-200 border-slate-400/40 shadow-xs';
    }
  };

  const getRoleLabel = (r: Role) => {
    switch (r) {
      case 'SUPER_ADMIN':
        return 'Super Admin';
      case 'ADMIN_1':
        return 'Admin 1';
      case 'ADMIN_2':
        return 'Admin 2';
      case 'FINANCE':
        return 'Finance';
      case 'HR':
        return 'HR';
      case 'ACCOUNTS':
        return 'Accounts';
      case 'AUDITORS':
        return 'Auditors';
      case 'ADMIN':
        return 'Admin';
      case 'MANAGER':
        return 'Manager';
      case 'EMPLOYEE':
        return 'Employee';
      default:
        return String(r);
    }
  };

  return (
    <header className="h-16 bg-[#023b77] border-b border-[#039583]/40 sticky top-0 z-30 px-6 flex items-center justify-between text-white shadow-md">
      {/* Zone 1: Logo (toggles sidebar) & Current Breadcrumb */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          title={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          className="flex items-center gap-3 group cursor-pointer focus:outline-none"
        >
          <div className="bg-white px-3 py-1.5 rounded-xl shadow-md border border-slate-200/90 flex items-center justify-center group-hover:ring-2 group-hover:ring-[#039583] transition">
            <VetanLogo size="sm" variant="horizontal" theme="light" />
          </div>
        </button>
        <div className="h-4 w-[1px] bg-slate-500 hidden sm:block" />
        <span className="text-xs font-medium text-slate-200 hidden sm:block">
          {currentSectionTitle}
        </span>
      </div>

      {/* Zone 2: Center (Role Testing Switcher Dropdown) */}
      <div className="hidden md:flex items-center gap-2.5 px-3 py-1.5 bg-[#012a52] rounded-xl text-xs border border-[#039583]/50 shadow-inner">
        <div className="text-slate-300 font-semibold flex items-center gap-1.5 uppercase tracking-wider text-[10px] shrink-0">
          <UserCheck className="w-3.5 h-3.5 text-[#039583]" />
          Active Role:
        </div>
        <select
          value={user?.role || 'EMPLOYEE'}
          onChange={(e) => handleRoleSwitch(e.target.value as Role)}
          disabled={isSwitching}
          className="bg-[#023b77] text-white text-xs font-bold px-3 py-1.5 rounded-lg border border-[#039583] focus:outline-none focus:ring-2 focus:ring-[#039583] cursor-pointer shadow-xs"
        >
          <option value="SUPER_ADMIN">Super Admin</option>
          <option value="ADMIN_1">Admin 1</option>
          <option value="ADMIN_2">Admin 2</option>
          <option value="FINANCE">Finance</option>
          <option value="HR">HR</option>
          <option value="ACCOUNTS">Accounts</option>
          <option value="AUDITORS">Auditors</option>
          <option value="MANAGER">Manager</option>
          <option value="EMPLOYEE">Employee</option>
        </select>
      </div>

      {/* Zone 3: Actions (Notifications, Profile) */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenNotifications}
          className="relative p-2 text-slate-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          title="View Notifications"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#039583] rounded-full animate-pulse" />
          )}
        </button>

        <div className="h-4 w-[1px] bg-slate-500" />

        <div className="relative">
          <button
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer border border-transparent hover:border-white/10"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#039583] to-[#023b77] text-white font-bold text-xs flex items-center justify-center shadow-xs ring-2 ring-white/20">
              {user ? `${user.firstName[0]}${user.lastName[0]}` : 'U'}
            </div>
            <div className="text-left hidden lg:block">
              <p className="text-xs font-bold text-white leading-tight">
                {user?.firstName} {user?.lastName}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md border tracking-wide uppercase ${
                    user ? getRoleBadgeStyle(user.role) : ''
                  }`}
                >
                  {user ? getRoleLabel(user.role) : 'Employee'}
                </span>
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-300" />
          </button>

          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-slate-200 py-3 z-50 text-slate-900 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-4 py-2.5 border-b border-slate-100">
                <p className="text-sm font-bold text-slate-900">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                <div className="mt-2.5 flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                  <span className="text-[11px] font-mono text-slate-600 font-semibold">
                    ID: {user?.employee?.employeeCode || 'PENDING'}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-[11px] text-slate-600 truncate">
                    {user?.employee?.department || 'Operations'}
                  </span>
                </div>
              </div>

              <div className="px-4 py-3 border-b border-slate-100">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Select Role to Switch
                </label>
                <select
                  value={user?.role || 'EMPLOYEE'}
                  onChange={(e) => handleRoleSwitch(e.target.value as Role)}
                  disabled={isSwitching}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-[#039583] cursor-pointer"
                >
                  <option value="SUPER_ADMIN">Super Admin (Full Access)</option>
                  <option value="ADMIN_1">Admin 1 (Operations & HR)</option>
                  <option value="ADMIN_2">Admin 2 (Assets & Ticketing)</option>
                  <option value="FINANCE">Finance (Payroll & Loans)</option>
                  <option value="HR">HR (Core HR & Onboarding)</option>
                  <option value="ACCOUNTS">Accounts (Ledger & Posting)</option>
                  <option value="AUDITORS">Auditors (Read Only Compliance)</option>
                  <option value="MANAGER">Manager (Team Approvals)</option>
                  <option value="EMPLOYEE">Employee (Self Service)</option>
                </select>
              </div>

              <div className="px-2 pt-2">
                <button
                  onClick={() => {
                    setIsProfileOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};