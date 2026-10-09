import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types/auth';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  FileText,
  GitBranch,
  Clock,
  CalendarDays,
  Receipt,
  Banknote,
  Shield,
  ShieldAlert,
  FileCheck,
  Calendar,
  Megaphone,
  Briefcase,
  Building2,
  Target,
  FileQuestion,
  UserMinus,
  BarChart3,
  User,
  Settings,
  ChevronDown,
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
  flat?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab, isOpen = true }) => {
  const { user } = useAuth();
  const role: Role = user?.role || 'EMPLOYEE';

  const sections: NavSection[] = useMemo(
    () => [
      {
        id: 'home',
        title: 'Home',
        flat: true,
        items: [
          { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'EMPLOYEE'] },
          { id: 'profile', label: 'My Profile', icon: User, roles: ['ADMIN', 'EMPLOYEE'] },
          { id: 'settings', label: 'System Settings', icon: Settings, roles: ['ADMIN'] },
        ],
      },
      {
        id: 'people',
        title: 'People',
        items: [
          { id: 'employees', label: 'Employees Directory', icon: Users, roles: ['ADMIN'] },
          { id: 'organization', label: 'Departments & Org', icon: Building2, roles: ['ADMIN'] },
          { id: 'onboarding', label: 'Onboarding Queue', icon: UserPlus, roles: ['ADMIN'], badge: '1 New' },
          { id: 'documents', label: 'Employee Documents', icon: FileText, roles: ['ADMIN', 'EMPLOYEE'] },
          { id: 'lifecycle', label: 'Employee Lifecycle', icon: GitBranch, roles: ['ADMIN', 'EMPLOYEE'] },
          { id: 'recruitment', label: 'Recruitment & Referrals', icon: Briefcase, roles: ['ADMIN', 'EMPLOYEE'] },
        ],
      },
      {
        id: 'time',
        title: 'Time',
        items: [
          { id: 'attendance', label: 'Attendance & Overtime', icon: Clock, roles: ['ADMIN', 'EMPLOYEE'] },
          { id: 'shifts', label: 'Work Shifts & Rosters', icon: Calendar, roles: ['ADMIN'] },
        ],
      },
      {
        id: 'payroll',
        title: 'Payroll',
        items: [
          { id: 'leave', label: 'Leave Management', icon: CalendarDays, roles: ['ADMIN', 'EMPLOYEE'] },
          { id: 'expenses', label: 'Expense Claims', icon: Receipt, roles: ['ADMIN', 'EMPLOYEE'] },
          {
            id: 'payroll',
            label: role === 'EMPLOYEE' ? 'My Payslips' : 'Payroll Management',
            icon: Banknote,
            roles: ['ADMIN', 'HR', 'EMPLOYEE'],
          },
          {
            id: 'tax',
            label: role === 'EMPLOYEE' ? 'My Tax & Form 16' : 'Tax & Form 16',
            icon: FileCheck,
            roles: ['ADMIN', 'HR', 'EMPLOYEE'],
          },
          { id: 'insurance', label: 'Insurance & Benefits', icon: Shield, roles: ['ADMIN', 'EMPLOYEE'] },
        ],
      },
      {
        id: 'compliance',
        title: 'Compliance',
        items: [
          { id: 'policies', label: 'Company Policies', icon: FileCheck, roles: ['ADMIN', 'EMPLOYEE'] },
          // Rule 21: Highly confidential, not visible to managers or employees
          { id: 'posh', label: 'POSH Committee', icon: ShieldAlert, roles: ['ADMIN'] },
          { id: 'holidays', label: 'Public Holidays', icon: Calendar, roles: ['ADMIN', 'EMPLOYEE'] },
          { id: 'announcements', label: 'Announcements', icon: Megaphone, roles: ['ADMIN', 'EMPLOYEE'] },
        ],
      },
      {
        id: 'talent',
        title: 'Talent',
        items: [
          { id: 'performance', label: 'Performance Reviews', icon: Target, roles: ['ADMIN'] },
          { id: 'hr_requests', label: 'HR Service Desk', icon: FileQuestion, roles: ['ADMIN', 'EMPLOYEE'] },
          { id: 'full_final', label: 'Full & Final Settlement', icon: UserMinus, roles: ['ADMIN'] },
        ],
      },
      {
        id: 'insights',
        title: 'Insights',
        items: [
          { id: 'reports', label: 'Reports & Analytics', icon: BarChart3, roles: ['ADMIN'] },
          // Restricted to Admin
          { id: 'audit_logs', label: 'Security & Audit Logs', icon: ShieldAlert, roles: ['ADMIN'] },
        ],
      },
    ],
    [role]
  );

  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

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

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;

    return (
      <button
        key={item.id}
        onClick={() => onSelectTab(item.id)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
          isActive
            ? 'bg-[#039583] text-white shadow-xs font-semibold'
            : 'text-slate-200 hover:bg-[#039583]/20 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2.5 truncate">
          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-300'}`} />
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

  return (
    <aside
      aria-hidden={!isOpen}
      className={`bg-[#023b77] text-slate-200 h-[calc(100vh-4rem)] sticky top-16 self-start select-none overflow-y-auto shrink-0 transition-[width] duration-200 ease-in-out ${
        isOpen ? 'w-64 border-r border-[#039583]/30' : 'w-0 border-r-0 invisible'
      }`}
    >
      <div className="w-64 min-h-full flex flex-col pb-8">
        <div className="py-4 space-y-1">
          {sections.map((section) => {
            const visibleItems = section.items.filter((item) => item.roles.includes(role));
            if (visibleItems.length === 0) return null;

            if (section.flat) {
              return (
                <div key={section.id} className="px-3 pb-1">
                  {visibleItems.map(renderItem)}
                </div>
              );
            }

            const isExpanded = openSections.has(section.id);
            const hasActive = visibleItems.some((i) => i.id === activeTab);
            const hasBadge = visibleItems.some((i) => i.badge);

            return (
              <div key={section.id} className="px-3">
                <button
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-colors cursor-pointer ${
                    hasActive && !isExpanded ? 'text-white bg-[#039583]/30' : 'text-slate-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {section.title}
                    {hasBadge && !isExpanded && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {isExpanded && <div className="space-y-0.5 mt-1 mb-2">{visibleItems.map(renderItem)}</div>}
              </div>
            );
          })}
        </div>

        <div className="mt-auto p-4 border-t border-[#039583]/30 bg-[#012a52]">
          <div className="flex items-center gap-2.5 text-xs">
            <div className="w-2 h-2 rounded-full bg-[#039583] animate-pulse" />
            <span className="text-slate-200 font-mono text-[11px]">System Online</span>
          </div>
        </div>
      </div>
    </aside>
  );
};