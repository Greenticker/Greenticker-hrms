import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types/auth';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  FolderOpen,
  GitBranch,
  Banknote,
  ShieldAlert,
  ShieldCheck,
  FileCheck,
  CalendarHeart,
  Megaphone,
  Network,
  LifeBuoy,
  UserMinus,
  LogOut,
  BarChart3,
  TrendingUp,
  ScrollText,
  Scale,
  Settings,
  Clock,
  CalendarDays,
  Receipt,
  Package,
  HeartPulse,
  Landmark,
  ChevronDown,
  Mail,
  Wallet,
  Calculator,
  CalendarClock,
  Search,
  X,
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  isOpen?: boolean;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  badge?: string;
}

interface NavGroup {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}

const ALL_ENTERPRISE_ROLES: Role[] = [
  'SUPER_ADMIN',
  'ADMIN_1',
  'ADMIN_2',
  'FINANCE',
  'HR',
  'ACCOUNTS',
  'AUDITORS',
  'ADMIN',
  'MANAGER',
  'EMPLOYEE',
];
const STAFF_AND_EMPLOYEES: Role[] = ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'];
const REPORTING_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN'];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab, isOpen = true }) => {
  const { user } = useAuth();
  const role: Role = user?.role || 'EMPLOYEE';
  const isEmployee = role === 'EMPLOYEE';

  // Everything else: grouped behind a dropdown
  const groups: NavGroup[] = useMemo(
    () => [
      {
        id: 'people',
        title: 'People',
        icon: Users,
        items: [
          {
            // Employees get the public company directory, managers also their team, HR/admin roles the full master
            id: 'employees',
            label: role === 'MANAGER' ? 'My Team & Directory' : 'Employee Directory',
            icon: Users,
            roles: ALL_ENTERPRISE_ROLES,
          },
          {
            id: 'organization',
            label: 'Departments & Org',
            icon: Network,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'AUDITORS', 'ADMIN'],
          },
          {
            id: 'onboarding',
            label: 'Onboarding Queue',
            icon: UserPlus,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'HR', 'AUDITORS', 'ADMIN'],
          },
          { id: 'lifecycle', label: 'Employee Lifecycle', icon: GitBranch, roles: ALL_ENTERPRISE_ROLES },
          {
            id: 'exit_management',
            label: 'Exit Management',
            icon: UserMinus,
            roles: REPORTING_ROLES,
          },
          { id: 'resignation', label: 'My Resignation', icon: LogOut, roles: ALL_ENTERPRISE_ROLES },
          {
            id: 'documents',
            label: isEmployee ? 'My Documents' : 'Employee Documents',
            icon: FolderOpen,
            roles: ALL_ENTERPRISE_ROLES,
          },
          { id: 'holidays', label: 'Public Holidays', icon: CalendarHeart, roles: ALL_ENTERPRISE_ROLES },
          { id: 'announcements', label: 'Announcements', icon: Megaphone, roles: ALL_ENTERPRISE_ROLES },
        ],
      },
      {
        id: 'mywork',
        title: 'Time, Claims & Benefits',
        icon: CalendarDays,
        items: [
          { id: 'attendance', label: isEmployee ? 'My Attendance' : 'Attendance', icon: Clock, roles: ALL_ENTERPRISE_ROLES },
          { id: 'leave', label: isEmployee ? 'My Leave' : 'Leave', icon: CalendarDays, roles: ALL_ENTERPRISE_ROLES },
          { id: 'expenses', label: isEmployee ? 'My Claims' : 'Expense Claims', icon: Receipt, roles: ALL_ENTERPRISE_ROLES },
          { id: 'assets', label: isEmployee ? 'My Assets' : 'Assets', icon: Package, roles: ALL_ENTERPRISE_ROLES },
          { id: 'insurance', label: isEmployee ? 'My Benefits' : 'Insurance & Benefits', icon: HeartPulse, roles: ALL_ENTERPRISE_ROLES },
        ],
      },
      {
        id: 'payroll',
        title: 'Payroll & Finance',
        icon: Banknote,
        items: [
          { id: 'payroll', label: isEmployee ? 'My Payslips' : 'Payroll Management', icon: Banknote, roles: ALL_ENTERPRISE_ROLES },
          { id: 'tax', label: isEmployee ? 'My Tax & Form 16' : 'Tax & Ledger', icon: FileCheck, roles: ALL_ENTERPRISE_ROLES },
          { id: 'income_tax_calculator', label: 'Income Tax Calculator', icon: Calculator, roles: ALL_ENTERPRISE_ROLES },
          {
            id: 'salary_arrears',
            label: 'Salary Arrears',
            icon: CalendarClock,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'FINANCE', 'HR', 'ACCOUNTS', 'ADMIN'],
          },
          { id: 'full_final', label: 'F&F Settlement', icon: Wallet, roles: REPORTING_ROLES },
          { id: 'finance', label: 'Finance & Accounting', icon: Landmark, roles: ['FINANCE', 'ACCOUNTS', 'AUDITORS'] },
        ],
      },
      {
        id: 'workplace',
        title: 'Policies & Help',
        icon: LifeBuoy,
        items: [
          { id: 'policies', label: 'Company Policies', icon: Scale, roles: ALL_ENTERPRISE_ROLES },
          { id: 'hr_requests', label: 'Help Desk', icon: LifeBuoy, roles: ALL_ENTERPRISE_ROLES },
          {
            id: 'posh',
            label: 'POSH Committee',
            icon: ShieldAlert,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'HR', 'AUDITORS', 'ADMIN'],
          },
        ],
      },
      {
        id: 'insights',
        title: 'Reports & Audit',
        icon: BarChart3,
        items: [
          { id: 'reports', label: isEmployee ? 'My Statements' : 'Reports', icon: BarChart3, roles: ALL_ENTERPRISE_ROLES },
          { id: 'analytics', label: 'Workforce Analytics', icon: TrendingUp, roles: REPORTING_ROLES },
          {
            id: 'audit_logs',
            label: 'Audit Logs',
            icon: ScrollText,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'HR', 'FINANCE', 'ACCOUNTS', 'AUDITORS', 'ADMIN'],
          },
        ],
      },
      {
        id: 'admin',
        title: 'Administration',
        icon: Settings,
        items: [
          {
            id: 'letter_templates',
            label: 'Letter Templates',
            icon: Mail,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'HR', 'ADMIN'],
          },
          { id: 'settings', label: 'System Settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN', 'ADMIN_1', 'ADMIN_2', 'AUDITORS'] },
          {
            // Admins reach this as a tab inside System Settings
            id: 'roles_permissions',
            label: 'Roles & Permissions',
            icon: ShieldCheck,
            roles: ['HR', 'FINANCE', 'ACCOUNTS'],
          },
        ],
      },
    ],
    [isEmployee, role]
  );

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const searchTerm = query.trim().toLowerCase();

  // Open the group holding the current page (e.g. after navigating from the dashboard).
  useEffect(() => {
    const owner = groups.find((g) => g.items.some((i) => i.id === activeTab));
    if (owner) setOpenGroups((prev) => (prev.has(owner.id) ? prev : new Set(prev).add(owner.id)));
  }, [activeTab, groups]);

  const toggleGroup = (groupId: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  const isVisible = (item: NavItem) =>
    item.roles.includes(role) && (!searchTerm || item.label.toLowerCase().includes(searchTerm));

  const dashboardItem: NavItem = {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ALL_ENTERPRISE_ROLES,
  };

  const renderItem = (item: NavItem, nested = false) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        onClick={() => onSelectTab(item.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`group w-full flex items-center justify-between rounded-xl font-medium transition-all duration-200 cursor-pointer text-left ${
          nested ? 'px-3 py-2 text-[13px]' : 'px-3 py-2.5 text-sm'
        } ${
          isActive
            ? 'bg-primary text-white ring-1 ring-white/10 font-semibold'
            : nested
            ? 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
            : 'text-slate-100 hover:bg-white/[0.08] hover:text-white'
        }`}
      >
        <span className="flex items-center gap-2.5 truncate">
          <Icon
            className={`w-[17px] h-[17px] shrink-0 transition-colors ${
              isActive ? 'text-white' : 'text-slate-400 group-hover:text-primary-light'
            }`}
          />
          <span className="truncate">{item.label}</span>
        </span>
        {item.badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter(isVisible) }))
    .filter((g) => g.items.length > 0);
  const showDashboard = isVisible(dashboardItem);
  const nothingFound = Boolean(searchTerm) && !showDashboard && visibleGroups.length === 0;

  return (
    <aside
      aria-hidden={!isOpen}
      className={`relative bg-navy text-slate-200 h-[calc(100vh-4rem)] sticky top-16 self-start select-none overflow-y-auto overflow-x-hidden shrink-0 transition-[width] duration-200 ease-in-out ${
        isOpen ? 'w-56 border-r border-white/10' : 'w-0 border-r-0 invisible'
      }`}
    >
      <div className="w-56 min-h-full flex flex-col pb-8">
        <div className="px-4 pt-5 pb-4">
          <p className="mb-2.5 px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Workspace
          </p>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a page..."
              aria-label="Find a page"
              className="w-full rounded-xl bg-navy/55 border border-white/10 pl-10 pr-9 py-2.5 text-[13px] text-white placeholder:text-slate-400 shadow-inner shadow-black/10 transition focus:outline-none focus:border-accent/70 focus:ring-2 focus:ring-accent/25 focus:bg-navy/80"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <nav aria-label="Main" className="px-3">
          {showDashboard && <div className="mb-4">{renderItem(dashboardItem)}</div>}

          {visibleGroups.length > 0 && (
            <div>
              <div className="flex items-center gap-3 px-2 pb-2.5">
                <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-slate-400">Navigation</p>
                <span className="h-px flex-1 bg-gradient-to-r from-white/15 to-transparent" />
              </div>
              <div className="space-y-1">
                {visibleGroups.map((group) => {
                  // A group with only one page for this role shows as a plain link
                  if (group.items.length === 1 && !searchTerm) return renderItem(group.items[0]);

                  const GroupIcon = group.icon;
                  const isExpanded = Boolean(searchTerm) || openGroups.has(group.id);
                  const hasActive = group.items.some((i) => i.id === activeTab);
                  return (
                    <div key={group.id}>
                      <button
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={isExpanded}
                        className={`group w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 cursor-pointer ${
                          hasActive && !isExpanded
                            ? 'bg-white/[0.09] text-white ring-1 ring-white/10'
                            : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 truncate">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                            hasActive || isExpanded ? 'bg-accent/20 text-primary-light' : 'bg-white/[0.06] text-slate-400 group-hover:text-primary-light'
                          }`}>
                            <GroupIcon className="w-[17px] h-[17px]" />
                          </span>
                          <span className="truncate">{group.title}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          {!isExpanded && (
                            <span className="min-w-5 px-1.5 py-0.5 rounded-md bg-white/[0.08] text-[10px] font-semibold text-slate-400 text-center">
                              {group.items.length}
                            </span>
                          )}
                          <ChevronDown
                            className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-slate-300' : ''}`}
                          />
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="ml-[27px] pl-3 mt-1.5 mb-2 border-l border-white/15 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                          {group.items.map((item) => renderItem(item, true))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {nothingFound && <p className="px-3 py-4 text-sm text-slate-400">No pages match "{query.trim()}"</p>}
        </nav>

        <div className="mt-auto px-4 pt-5">
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3.5 shadow-inner shadow-black/10">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/50" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[11px] font-semibold tracking-wide text-slate-200">System online</span>
            </div>
            <p className="mt-1.5 pl-5 text-[10px] text-slate-400">Role-based access is active</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
