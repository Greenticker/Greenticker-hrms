import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types/auth';
import { Bell, LogOut, ChevronDown, UserCheck } from 'lucide-react';
import { AnusyutiLogo } from '../common/anusyuti_logo';

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
  currentSectionTitle = 'Anusyuti.',
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
      case 'ADMIN':
        return 'bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-purple-200 border-purple-400/40 shadow-xs';
      case 'EMPLOYEE':
        return 'bg-gradient-to-r from-teal-500/20 to-cyan-500/20 text-teal-200 border-teal-400/40 shadow-xs';
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
            <AnusyutiLogo size="sm" variant="horizontal" theme="light" />
          </div>
        </button>
        <div className="h-4 w-[1px] bg-slate-500 hidden sm:block" />
        <span className="text-xs font-medium text-slate-200 hidden sm:block">
          {currentSectionTitle}
        </span>
      </div>

      {/* Zone 2: Center (Role Testing Switcher Banner) */}
      <div className="hidden md:flex items-center gap-1 p-1 bg-[#012a52] rounded-xl text-xs border border-[#039583]/50 shadow-inner">
        <div className="px-2.5 text-slate-300 font-semibold flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
          <UserCheck className="w-3.5 h-3.5 text-[#039583]" />
          Active Role:
        </div>
        {(['ADMIN', 'EMPLOYEE'] as Role[]).map((r) => (
          <button
            key={r}
            onClick={() => handleRoleSwitch(r)}
            disabled={isSwitching}
            className={`px-3.5 py-1.5 font-bold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
              user?.role === r
                ? 'bg-[#039583] text-white shadow-sm ring-1 ring-white/30 scale-[1.02]'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full transition-all ${
                user?.role === r ? 'bg-white ring-2 ring-white/40' : 'bg-slate-400'
              }`}
            />
            {r === 'ADMIN' ? 'Administrator' : 'Employee'}
          </button>
        ))}
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
                  {user?.role === 'ADMIN' ? 'Administrator' : 'Employee'}
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
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Switch Active Role (Testing)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(['ADMIN', 'EMPLOYEE'] as Role[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => handleRoleSwitch(r)}
                      className={`text-xs py-2 px-3 rounded-xl font-bold text-left transition-all cursor-pointer flex items-center justify-between border ${
                        user?.role === r
                          ? 'bg-[#023b77] text-white border-[#023b77] shadow-sm'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <span className="truncate">{r === 'ADMIN' ? 'Admin' : 'Employee'}</span>
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          user?.role === r ? 'bg-[#039583] ring-2 ring-white' : 'bg-slate-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
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