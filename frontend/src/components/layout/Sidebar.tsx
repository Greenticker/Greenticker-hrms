import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types/auth';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  FolderOpen,
  GitBranch,
  Clock,
  CalendarDays,
  Receipt,
  Banknote,
  HeartPulse,
  ShieldAlert,
  ShieldCheck,
  FileCheck,
  Calendar,
  CalendarHeart,
  Megaphone,
  Briefcase,
  Network,
  Package,
  Target,
  LifeBuoy,
  UserMinus,
  LogOut,
  BarChart3,
  TrendingUp,
  ScrollText,
  Scale,
  User,
  Settings,
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

interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab, isOpen = true }) => {
  const { user } = useAuth();
  const role: Role = user?.role || 'EMPLOYEE';
  const isEmployee = role === 'EMPLOYEE';

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

  // Always visible above the groups
  const pinnedItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ALL_ENTERPRISE_ROLES },
    { id: 'profile', label: 'My Profile', icon: User, roles: ALL_ENTERPRISE_ROLES },
  ];

  const sections: NavSection[] = useMemo(
    () => [
      {
        id: 'people',
        title: 'People',
        items: [
          {
            id: 'employees',
            label: 'Employee Directory',
            icon: Users,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'AUDITORS', 'ADMIN', 'MANAGER'],
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
          {
            id: 'lifecycle',
            label: 'Employee Lifecycle',
            icon: GitBranch,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
          {
            id: 'exit_management',
            label: 'Exit Management',
            icon: UserMinus,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN'],
          },
          {
            id: 'resignation',
            label: 'My Resignation',
            icon: LogOut,
            roles: ALL_ENTERPRISE_ROLES,
          },
          {
            id: 'documents',
            label: isEmployee ? 'My Documents' : 'Employee Documents',
            icon: FolderOpen,
            roles: ALL_ENTERPRISE_ROLES,
          },
        ],
      },
      {
        id: 'talent',
        title: 'Hiring & Performance',
        items: [
          {
            id: 'recruitment',
            label: 'Recruitment & Hiring',
            icon: Briefcase,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
          {
            id: 'performance',
            label: 'Performance',
            icon: Target,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'HR', 'AUDITORS', 'ADMIN', 'MANAGER'],
          },
        ],
      },
      {
        id: 'time',
        title: 'Time & Leave',
        items: [
          {
            id: 'attendance',
            label: 'Attendance & Overtime',
            icon: Clock,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
          {
            id: 'leave',
            label: isEmployee ? 'My Leave' : 'Leave Management',
            icon: CalendarDays,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
          {
            id: 'shifts',
            label: 'Shifts & Timesheets',
            icon: Calendar,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN', 'MANAGER'],
          },
          { id: 'holidays', label: 'Public Holidays', icon: CalendarHeart, roles: ALL_ENTERPRISE_ROLES },
        ],
      },
      {
        id: 'payroll',
        title: 'Payroll & Finance',
        items: [
          {
            id: 'payroll',
            label: isEmployee ? 'My Payslips' : 'Payroll Management',
            icon: Banknote,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
          {
            id: 'tax',
            label: isEmployee ? 'My Tax & Form 16' : 'Tax & Ledger',
            icon: FileCheck,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
          {
            id: 'income_tax_calculator',
            label: 'Income Tax Calculator',
            icon: Calculator,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
          {
            id: 'expenses',
            label: 'Advances, Loans & Expenses',
            icon: Receipt,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
          {
            id: 'salary_arrears',
            label: 'Salary Arrears',
            icon: CalendarClock,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'FINANCE', 'HR', 'ACCOUNTS', 'ADMIN'],
          },
          {
            id: 'full_final',
            label: 'F&F Settlement',
            icon: Wallet,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN'],
          },
        ],
      },
      {
        id: 'benefits',
        title: 'Benefits & Assets',
        items: [
          {
            id: 'insurance',
            label: 'Insurance & Benefits',
            icon: HeartPulse,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
          {
            id: 'assets',
            label: 'Assets Register',
            icon: Package,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN'],
          },
        ],
      },
      {
        id: 'workplace',
        title: 'Policies & Help',
        items: [
          { id: 'policies', label: 'Company Policies', icon: Scale, roles: ALL_ENTERPRISE_ROLES },
          { id: 'announcements', label: 'Announcements', icon: Megaphone, roles: ALL_ENTERPRISE_ROLES },
          {
            id: 'hr_requests',
            label: 'Help Desk',
            icon: LifeBuoy,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
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
        items: [
          {
            id: 'reports',
            label: 'Reports',
            icon: BarChart3,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN'],
          },
          {
            id: 'analytics',
            label: 'Workforce Analytics',
            icon: TrendingUp,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS', 'ADMIN'],
          },
          {
            id: 'audit_logs',
            label: 'Audit Logs',
            icon: ScrollText,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'HR', 'AUDITORS', 'ADMIN'],
          },
        ],
      },
      {
        id: 'admin',
        title: 'Administration',
        items: [
          {
            id: 'letter_templates',
            label: 'Letter Templates',
            icon: Mail,
            roles: ['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'HR', 'ADMIN'],
          },
          {
            id: 'settings',
            label: 'System Settings',
            icon: Settings,
            roles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            // Admins reach this as a tab inside System Settings
            id: 'roles_permissions',
            label: 'Roles & Permissions',
            icon: ShieldCheck,
            roles: ['ADMIN_1', 'ADMIN_2', 'HR', 'AUDITORS'],
          },
        ],
      },
    ],
    [isEmployee]
  );

  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const searchTerm = query.trim().toLowerCase();

  // Keep the section containing the active tab expanded.
  useEffect(() => {
    const owner = sections.find((s) => s.items.some((i) => i.id === activeTab));
    if (owner) {
      setOpenSections((prev) => {
        if (prev.has(owner.id)) return prev;
        const next = new Set(prev);
        next.add(owner.id);
        return next;
      });
    }
  }, [activeTab, sections]);

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const isVisible = (item: NavItem) =>
    item.roles.includes(role) && (!searchTerm || item.label.toLowerCase().includes(searchTerm));

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;

    return (
      <button
        key={item.id}
        onClick={() => onSelectTab(item.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer text-left ${
          isActive
            ? 'bg-[#039583] text-white shadow-xs font-semibold'
            : 'text-slate-200 hover:bg-[#039583]/20 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2.5 truncate">
          <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-white' : 'text-slate-300'}`} />
          <span className="truncate">{item.label}</span>
        </div>
        {item.badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  const visiblePinned = pinnedItems.filter(isVisible);
  const visibleSections = sections
    .map((section) => ({ ...section, items: section.items.filter(isVisible) }))
    .filter((section) => section.items.length > 0);

  return (
    <aside
      aria-hidden={!isOpen}
      className={`bg-[#023b77] text-slate-200 h-[calc(100vh-4rem)] sticky top-16 self-start select-none overflow-y-auto shrink-0 transition-[width] duration-200 ease-in-out ${
        isOpen ? 'w-72 border-r border-[#039583]/30' : 'w-0 border-r-0 invisible'
      }`}
    >
      <div className="w-72 min-h-full flex flex-col pb-8">
        <div className="px-3 pt-4 pb-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a page..."
              aria-label="Find a page"
              className="w-full rounded-lg bg-white/10 border border-white/10 pl-9 pr-8 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#039583] focus:bg-white/15"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {visiblePinned.length > 0 && <div className="px-3 pb-2 space-y-0.5">{visiblePinned.map(renderItem)}</div>}

        <div className="space-y-1 border-t border-white/10 pt-2">
          {visibleSections.map((section) => {
            // While searching, show every matching group expanded
            const isExpanded = Boolean(searchTerm) || openSections.has(section.id);
            const hasActive = section.items.some((i) => i.id === activeTab);
            const hasBadge = section.items.some((i) => i.badge);

            return (
              <div key={section.id} className="px-3">
                <button
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer ${
                    hasActive && !isExpanded ? 'text-white bg-[#039583]/30' : 'text-slate-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {section.title}
                    {hasBadge && !isExpanded && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  </span>
                  <span className="flex items-center gap-2">
                    {!isExpanded && (
                      <span className="text-[11px] font-semibold text-slate-400 normal-case tracking-normal">
                        {section.items.length}
                      </span>
                    )}
                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                {isExpanded && <div className="space-y-0.5 mt-1 mb-2">{section.items.map(renderItem)}</div>}
              </div>
            );
          })}

          {searchTerm && visiblePinned.length === 0 && visibleSections.length === 0 && (
            <p className="px-6 py-4 text-sm text-slate-400">No pages match "{query.trim()}"</p>
          )}
        </div>

        <div className="mt-auto p-4 border-t border-[#039583]/30 bg-[#012a52]">
          <div className="flex items-center gap-2.5 text-xs">
            <div className="w-2 h-2 rounded-full bg-[#039583] animate-pulse" />
            <span className="text-slate-200 font-mono text-xs">System Online · RBAC Enforced</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
