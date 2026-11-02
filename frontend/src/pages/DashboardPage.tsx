import React, { useState, useEffect } from 'react';

import { useAuth } from '../context/AuthContext';
import { onboardingQueueService } from '../services/onboardingQueueService';
import { documentService } from '../services/documentService';
import { modulesService } from '../services/modulesService';

import { Role } from '../types/auth';

import {
  Users,
  Clock,
  CalendarCheck,
  CheckCircle2,
  LogIn,
  LogOut,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  Laptop,
  Lock,
  DollarSign,
  Receipt,
  CreditCard,
  FileSpreadsheet,
  TrendingUp,
  PieChart,
  Landmark,
  ShieldCheck,
  Play,
  FileText,
  AlertTriangle,
} from 'lucide-react';

interface DashboardPageProps {
  onNavigateTab: (tabId: string) => void;
}

interface OperationalQueueItem {
  id: string;
  category: 'ONBOARDING' | 'DOCUMENTS' | 'LEAVE' | 'EXPENSES';
  title: string;
  person: string;
  department?: string;
  time: string;
  status: string;
  action: string;
  tab: string;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigateTab }) => {
  const { user } = useAuth();

  const role: Role = user?.role || 'EMPLOYEE';

  // Real-time Employee Attendance state with dynamic overtime computation!
  const [isCheckedIn, setIsCheckedIn] = useState(true);
  const [checkInTime, setCheckInTime] = useState('08:45 AM');
  const [workedMinutes, setWorkedMinutes] = useState(570); // 9h 30m

  // Upcoming Holiday state dynamically populated from company holiday schedule
  const [upcomingHoliday, setUpcomingHoliday] = useState<{
    name: string;
    date: string;
    dayOfWeek?: string;
    type?: string;
  }>({
    name: 'Dussehra (Vijayadashami / Dasara)',
    date: '2026-10-20',
    dayOfWeek: 'Tuesday',
    type: 'MANDATORY',
  });

  useEffect(() => {
    let cancelled = false;
    modulesService
      .getHolidays()
      .then((res) => {
        if (cancelled || !res.holidays || res.holidays.length === 0) return;
        const today = new Date().toISOString().split('T')[0];
        const next = res.holidays.find((h) => h.date >= today) || res.holidays[0];
        if (next) {
          setUpcomingHoliday(next);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Live HR Operational Queue state
  const [operationalQueue, setOperationalQueue] = useState<OperationalQueueItem[]>([]);
  const [queueFilter, setQueueFilter] = useState<'ALL' | 'ONBOARDING' | 'DOCUMENTS' | 'LEAVE' | 'EXPENSES'>('ALL');
  const [hrStats, setHrStats] = useState({
    headcount: 148,
    pendingOnboarding: 1,
    pendingDocuments: 2,
    pendingLeaves: 3,
  });
  const [isQueueLoading, setIsQueueLoading] = useState(false);

  useEffect(() => {
    if (!['SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTS', 'AUDITORS'].includes(role)) return;
    let cancelled = false;

    const loadHRData = async () => {
      setIsQueueLoading(true);
      try {
        const [onbRes, docRes, leaveRes, expRes] = await Promise.allSettled([
          onboardingQueueService.getQueue(),
          documentService.getDocuments({ status: 'PENDING' }),
          modulesService.getLeaveRequests({ status: 'PENDING' }),
          modulesService.getExpenses({ status: 'PENDING' }),
        ]);

        const items: OperationalQueueItem[] = [];

        // 1. Onboarding Submissions
        if (onbRes.status === 'fulfilled' && onbRes.value.submissions) {
          const subs = onbRes.value.submissions;
          subs.forEach((s) => {
            if (s.status === 'SUBMITTED' || s.status === 'IN_PROGRESS' || s.status === 'NEEDS_CORRECTION') {
              items.push({
                id: s._id,
                category: 'ONBOARDING',
                title:
                  s.status === 'SUBMITTED'
                    ? 'New Hire Dossier (Pending Verification)'
                    : s.status === 'NEEDS_CORRECTION'
                    ? 'Onboarding Dossier (Corrections Requested)'
                    : `New Hire Onboarding (Step ${s.currentStep || 1}/8)`,
                person: `${s.employeeName} (${s.designation || 'New Joiner'})`,
                department: s.department,
                time: s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : 'In Progress',
                status: s.status,
                action: s.status === 'SUBMITTED' ? 'Review & Verify' : 'View Application',
                tab: 'onboarding',
              });
            }
          });
        }

        // 2. Pending Documents
        if (docRes.status === 'fulfilled' && docRes.value.documents) {
          docRes.value.documents.forEach((d) => {
            items.push({
              id: d._id,
              category: 'DOCUMENTS',
              title: `${d.title || 'Document'} Verification`,
              person: `${d.employeeName} · ${d.category}`,
              department: d.department,
              time: d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : 'Recent',
              status: d.status,
              action: 'Verify Document',
              tab: 'documents',
            });
          });
        }

        // 3. Pending Leaves
        if (leaveRes.status === 'fulfilled' && leaveRes.value.requests) {
          leaveRes.value.requests.forEach((l) => {
            items.push({
              id: l._id,
              category: 'LEAVE',
              title: `${l.leaveType} Leave (${l.daysCount} Day${l.daysCount > 1 ? 's' : ''})`,
              person: `${l.employeeName} · ${l.reason || 'Pending Approval'}`,
              department: l.department || 'Operations',
              time: l.appliedAt ? new Date(l.appliedAt).toLocaleDateString() : 'Recent',
              status: l.status,
              action: 'Review Leave',
              tab: 'leave',
            });
          });
        }

        // 4. Pending Expenses
        if (expRes.status === 'fulfilled' && expRes.value.claims) {
          expRes.value.claims.forEach((e) => {
            items.push({
              id: e._id,
              category: 'EXPENSES',
              title: `Expense Claim: ${e.title} (₹${e.amount})`,
              person: `${e.employeeName} · ${e.category}`,
              department: e.department || 'Operations',
              time: e.submittedAt ? new Date(e.submittedAt).toLocaleDateString() : 'Recent',
              status: e.status,
              action: 'Process Claim',
              tab: 'expenses',
            });
          });
        }

        if (!cancelled) {
          setOperationalQueue(items);
          setHrStats({
            headcount: 148,
            pendingOnboarding:
              onbRes.status === 'fulfilled'
                ? onbRes.value.stats?.submitted ||
                  onbRes.value.submissions?.filter((s) => s.status === 'SUBMITTED').length ||
                  1
                : 1,
            pendingDocuments: docRes.status === 'fulfilled' ? docRes.value.documents?.length || 2 : 2,
            pendingLeaves: leaveRes.status === 'fulfilled' ? leaveRes.value.requests?.length || 3 : 3,
          });
        }
      } catch (err) {
        console.warn('Could not load operational queue:', err);
      } finally {
        if (!cancelled) setIsQueueLoading(false);
      }
    };

    loadHRData();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const expectedMinutes = 480; // 8h

  const calculateHours = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  // Shift rule: 8h shift including break. Up to 10h = no extra pay.
  // Day shift: >10h = +0.5 day, >14h = +1 day (night shift pays +1 / +1.5 days).
  const extraDayCredit =
    workedMinutes <= 10 * 60 ? 0 : workedMinutes <= 14 * 60 ? 0.5 : 1;

  const handleCheckInToggle = () => {
    if (isCheckedIn) {
      setIsCheckedIn(false);
    } else {
      setIsCheckedIn(true);
      const nowStr = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setCheckInTime(nowStr);
    }
  };

  // Shared by the ADMIN and HR dashboards
  const operationalQueueCard = (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">
              HR Operational Queue
            </h3>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              {operationalQueue.length} Active Tasks
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Live operational tasks awaiting HR action and approval
          </p>
        </div>

        <button
          onClick={() => onNavigateTab('onboarding')}
          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer self-start sm:self-auto"
        >
          <span>Open Full Queue</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Filter Pills */}
      <div className="flex items-center gap-1.5 py-3 overflow-x-auto text-[11px]">
        {[
          { id: 'ALL', label: `All (${operationalQueue.length})` },
          {
            id: 'ONBOARDING',
            label: `Onboarding (${operationalQueue.filter((i) => i.category === 'ONBOARDING').length})`,
          },
          {
            id: 'DOCUMENTS',
            label: `Docs (${operationalQueue.filter((i) => i.category === 'DOCUMENTS').length})`,
          },
          {
            id: 'LEAVE',
            label: `Leaves (${operationalQueue.filter((i) => i.category === 'LEAVE').length})`,
          },
          {
            id: 'EXPENSES',
            label: `Expenses (${operationalQueue.filter((i) => i.category === 'EXPENSES').length})`,
          },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setQueueFilter(f.id as any)}
            className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
              queueFilter === f.id
                ? 'bg-slate-900 text-white font-bold shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Operational Tasks List */}
      <div className="space-y-2.5 flex-1 mt-1">
        {isQueueLoading ? (
          <div className="p-8 text-center text-xs text-slate-400 font-mono">
            Loading live operational queue...
          </div>
        ) : operationalQueue.filter((item) => queueFilter === 'ALL' || item.category === queueFilter).length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200">
            <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1.5" />
            <p className="text-xs font-semibold text-slate-700">All Clear</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              No pending tasks in this operational queue.
            </p>
          </div>
        ) : (
          operationalQueue
            .filter((item) => queueFilter === 'ALL' || item.category === queueFilter)
            .slice(0, 5)
            .map((item) => (
              <div
                key={item.id}
                onClick={() => onNavigateTab(item.tab)}
                className="flex items-center justify-between p-3 rounded-xl border border-slate-200/80 bg-slate-50/60 hover:bg-white hover:border-indigo-300 hover:shadow-xs transition cursor-pointer group"
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[9px] font-bold font-mono px-1.5 py-0.2 rounded uppercase border ${
                        item.category === 'ONBOARDING'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : item.category === 'DOCUMENTS'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : item.category === 'LEAVE'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {item.category}
                    </span>
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {item.title}
                    </p>
                  </div>

                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {item.person} {item.department ? `· ${item.department}` : ''} ·{' '}
                    <span className="font-mono text-slate-400">{item.time}</span>
                  </p>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateTab(item.tab);
                  }}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 bg-white group-hover:bg-indigo-600 group-hover:text-white border border-slate-200 group-hover:border-indigo-600 rounded-lg text-xs font-semibold text-slate-700 transition cursor-pointer shadow-2xs"
                >
                  <span>{item.action}</span>
                  <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-white" />
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Welcome back, {user?.firstName} {user?.lastName}
          </h1>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 1. ADMIN DASHBOARD                                           */}
      {/* Day-to-day operations only. Payroll, workforce analytics and */}
      {/* compliance live (Admin-only) in Reports & Analytics.         */}
      {/* ============================================================ */}

      {/* ============================================================ */}
      {/* 1. SUPER ADMIN / GLOBAL ADMIN DASHBOARD                      */}
      {/* ============================================================ */}
      {(role === 'SUPER_ADMIN' || role === 'ADMIN') && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => onNavigateTab('employees')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-slate-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Total Employees</span>
                <Users className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">148</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-600 font-medium">
                <span>142 Active</span>
                <span className="text-slate-300">·</span>
                <span>6 Probation</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('attendance')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-emerald-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Today's Attendance</span>
                <Clock className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">94.2%</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500 font-medium">
                <span>134 Present</span>
                <span className="text-slate-300">·</span>
                <span>8 On Leave</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('settings')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-purple-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">System Configuration</span>
                <Lock className="w-4 h-4 text-purple-600" />
              </div>
              <p className="text-2xl font-black text-purple-700 mt-2 font-mono tabular-nums">Full Authority</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-purple-600 font-medium">
                <span>Tax Rules · Code · Masters</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('audit_logs')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-rose-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">RBAC Access Matrix</span>
                <ShieldCheck className="w-4 h-4 text-rose-500" />
              </div>
              <p className="text-lg font-bold text-slate-900 mt-2">Audit Logs & Matrix</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-indigo-600 font-semibold">
                <span>Immutable Logs · Role Scopes</span>
                <ArrowUpRight className="w-3 h-3" />
              </div>
            </div>
          </div>

          <div>{operationalQueueCard}</div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 1B. ADMIN LEVEL 1 DASHBOARD                                  */}
      {/* ============================================================ */}
      {role === 'ADMIN_1' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => onNavigateTab('employees')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-indigo-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Core HR Directory</span>
                <Users className="w-4 h-4 text-indigo-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">148</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-indigo-600 font-medium">
                <span>Read & Write Access</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('onboarding')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-amber-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Pending Onboarding</span>
                <Users className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-2xl font-black text-amber-600 mt-2 font-mono tabular-nums">
                {hrStats.pendingOnboarding}
              </p>
              <p className="text-[11px] text-slate-500 mt-2">New hire dossiers awaiting review</p>
            </div>

            <div
              onClick={() => onNavigateTab('assets')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-emerald-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Asset Inventory</span>
                <Laptop className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">218</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-600 font-medium">
                <span>Hardware & Software Allocation</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('leave')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-blue-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Pending Approvals</span>
                <CalendarCheck className="w-4 h-4 text-blue-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">11</p>
              <p className="text-[11px] text-slate-500 mt-2">Leaves, Claims & Advances</p>
            </div>
          </div>

          <div>{operationalQueueCard}</div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 1C. ADMIN LEVEL 2 DASHBOARD                                  */}
      {/* ============================================================ */}
      {role === 'ADMIN_2' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => onNavigateTab('assets')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-violet-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Asset Issue / Return</span>
                <Laptop className="w-4 h-4 text-violet-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">218</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-violet-600 font-medium">
                <span>Day-to-day Issue & Returns</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('hr_requests')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-blue-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Ticketing Service Desk</span>
                <AlertTriangle className="w-4 h-4 text-blue-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">8</p>
              <p className="text-[11px] text-slate-500 mt-2">Open facility & support tickets</p>
            </div>

            <div
              onClick={() => onNavigateTab('attendance')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-emerald-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Today's Attendance</span>
                <Clock className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">94.2%</p>
              <p className="text-[11px] text-slate-500 mt-2">134 Present · Shift active</p>
            </div>

            <div
              onClick={() => onNavigateTab('shifts')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-amber-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Workshift Rosters</span>
                <CalendarCheck className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-lg font-bold text-slate-900 mt-2">Active Shifts</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-600 font-semibold">
                <span>Rosters & Schedules</span>
              </div>
            </div>
          </div>

          <div>{operationalQueueCard}</div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 2. HR SPECIALIST DASHBOARD */}
      {/* ============================================================ */}

      {role === 'HR' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => onNavigateTab('employees')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-slate-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Active Headcount
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                {hrStats.headcount}
              </p>

              <p className="text-[11px] text-slate-500 mt-2">
                Across 5 departments
              </p>
            </div>

            <div
              onClick={() => onNavigateTab('onboarding')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-indigo-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Pending Onboarding
                </span>

                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-2xl font-black text-indigo-600 mt-2 font-mono tabular-nums">
                {hrStats.pendingOnboarding}
              </p>

              <p className="text-[11px] text-slate-500 mt-2">
                Requires HR audit & approval
              </p>
            </div>

            <div
              onClick={() => onNavigateTab('documents')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-amber-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Pending Document Verification
                </span>

                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-2xl font-black text-amber-600 mt-2 font-mono tabular-nums">
                {hrStats.pendingDocuments}
              </p>

              <p className="text-[11px] text-slate-500 mt-2">
                Requires HR review & stamp
              </p>
            </div>

            <div
              onClick={() => onNavigateTab('leave')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-blue-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Pending Leave Approvals
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                {hrStats.pendingLeaves}
              </p>

              <p className="text-[11px] text-slate-500 mt-2">
                Casual, Sick & Maternity leave
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {operationalQueueCard}

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-3">
                HR Policy Authority Notice
              </h3>

              <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200/80 space-y-2">
                <p className="text-xs font-bold text-blue-900">
                  Operational HR Role Boundary (Rule 2)
                </p>

                <p className="text-xs text-blue-800 leading-relaxed">
                  As an HR user, you have complete authority to manage employee
                  lifecycle, verify onboarding documents, approve leave and
                  expense claims, and run operational payroll.
                </p>

                <p className="text-xs text-blue-700 font-medium">
                  Note: Fundamental company policy creation, alteration, and
                  system deletion remain an exclusive{' '}
                  <strong>ADMIN</strong> responsibility.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 3. MANAGER DASHBOARD */}
      {/* ============================================================ */}

      {role === 'MANAGER' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => onNavigateTab('employees')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-slate-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  My Team Members
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                6
              </p>

              <p className="text-[11px] text-slate-500 mt-2">
                Platform Engineering Team
              </p>
            </div>

            <div
              onClick={() => onNavigateTab('attendance')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-emerald-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Team Attendance Today
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-2xl font-black text-emerald-600 mt-2 font-mono tabular-nums">
                100%
              </p>

              <p className="text-[11px] text-slate-500 mt-2">
                6 Present on site / remote
              </p>
            </div>

            <div
              onClick={() => onNavigateTab('leave')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-amber-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Pending Leave Requests
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-2xl font-black text-amber-600 mt-2 font-mono tabular-nums">
                2
              </p>

              <p className="text-[11px] text-slate-500 mt-2">
                Direct reports awaiting approval
              </p>
            </div>

            <div
              onClick={() => onNavigateTab('attendance')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-indigo-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Team Extra Pay This Week
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                8h 45m
              </p>

              <p className="text-[11px] text-slate-500 mt-2">
                Calculated from shifts
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Direct Team Roster
                </h3>
                <button
                  onClick={() => onNavigateTab('employees')}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                >
                  View Directory →
                </button>
              </div>

              <div className="space-y-2">
                {[
                  {
                    name: 'Rohan Verma',
                    role: 'Senior Frontend Engineer',
                    status: 'Checked In (08:45 AM)',
                    overtime: 'None today',
                  },
                  {
                    name: 'Sneha Patel',
                    role: 'Product Designer',
                    status: 'Onboarding in progress',
                    overtime: 'None',
                  },
                  {
                    name: 'Vikramaditya Rao',
                    role: 'DevOps Specialist',
                    status: 'Checked In (09:02 AM)',
                    overtime: 'None today',
                  },
                ].map((member, i) => (
                  <div
                    key={i}
                    onClick={() => onNavigateTab('attendance')}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs cursor-pointer hover:bg-slate-100/80 transition"
                  >
                    <div>
                      <p className="font-bold text-slate-900">{member.name}</p>
                      <p className="text-slate-500 text-[11px]">
                        {member.role}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="font-medium text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded text-[11px]">
                        {member.status}
                      </span>

                      <p className="text-[10px] text-slate-400 font-mono mt-1">
                        Extra pay: {member.overtime}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-3">
                Manager Scope & Data Isolation
              </h3>

              <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200/80 space-y-2">
                <p className="text-xs font-bold text-emerald-900">
                  Strict Team Isolation (Rule 3)
                </p>

                <p className="text-xs text-emerald-700 font-medium">
                  Organizational payroll, unassigned employees, and
                  administrative policies remain restricted.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 4. FINANCE ROLE DASHBOARD                                     */}
      {/* Executive Financial Operations, Payroll, Tax, and Approvals   */}
      {/* ============================================================ */}

      {role === 'FINANCE' && (
        <div className="space-y-6">
          {/* Executive Finance KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => onNavigateTab('payroll')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-[#023b77] hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Monthly Payroll Disbursal</span>
                <Landmark className="w-4 h-4 text-[#023b77]" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                ₹34,80,000
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-600 font-medium">
                <span>148 Employees</span>
                <span className="text-slate-300">·</span>
                <span>Net Disbursed</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('expenses')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-amber-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Pending Expense Claims</span>
                <Receipt className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                ₹48,250
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-600 font-medium">
                <span>9 Claims Awaiting Finance Review</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('tax')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-indigo-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">TDS & Form 24Q Withholding</span>
                <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                ₹4,12,600
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-indigo-600 font-medium">
                <span>Challan 281 Reconciled</span>
                <span className="text-slate-300">·</span>
                <span>Q4 Ready</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('payroll')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-emerald-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Statutory Dues (EPF & ESI)</span>
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                ₹2,88,400
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-600 font-medium">
                <span>100% On-Time Compliance</span>
              </div>
            </div>
          </div>

          {/* Quick Finance Actions */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Finance Operations & Disbursal Hub</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => onNavigateTab('payroll')}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-[#023b77] hover:text-white hover:border-[#023b77] transition-all text-left group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <Play className="w-4 h-4 text-[#039583] group-hover:text-white" />
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-white" />
                </div>
                <p className="text-xs font-bold text-slate-900 group-hover:text-white">Run Monthly Payroll</p>
                <p className="text-[10px] text-slate-500 group-hover:text-blue-100 mt-0.5">Calculate earnings & generate slips</p>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('expenses')}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-amber-600 hover:text-white hover:border-amber-600 transition-all text-left group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <Receipt className="w-4 h-4 text-amber-500 group-hover:text-white" />
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-white" />
                </div>
                <p className="text-xs font-bold text-slate-900 group-hover:text-white">Review Expense Claims</p>
                <p className="text-[10px] text-slate-500 group-hover:text-amber-100 mt-0.5">Approve claims & payouts</p>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('tax')}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all text-left group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <FileText className="w-4 h-4 text-indigo-500 group-hover:text-white" />
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-white" />
                </div>
                <p className="text-xs font-bold text-slate-900 group-hover:text-white">Form 16 Certificates</p>
                <p className="text-[10px] text-slate-500 group-hover:text-indigo-100 mt-0.5">Part A & B tax certificates</p>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('tax')}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all text-left group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500 group-hover:text-white" />
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-white" />
                </div>
                <p className="text-xs font-bold text-slate-900 group-hover:text-white">Form 27A & Form 24Q</p>
                <p className="text-[10px] text-slate-500 group-hover:text-emerald-100 mt-0.5">TDS quarterly return & e-filing</p>
              </button>
            </div>
          </div>

          {/* Department Cost Distribution & Statutory Remittance Status */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Department Payroll Cost Centers</h3>
                  <p className="text-xs text-slate-500">Monthly compensation expenditure distribution</p>
                </div>
                <span className="text-xs font-bold font-mono text-[#023b77]">₹34,80,000 / mo</span>
              </div>

              <div className="space-y-3 pt-2">
                {[
                  { dept: 'Engineering & Technology', amount: '₹18,40,000', pct: 53, color: 'bg-indigo-600' },
                  { dept: 'Sales & Client Growth', amount: '₹7,80,000', pct: 22, color: 'bg-emerald-600' },
                  { dept: 'Finance & Accounts', amount: '₹3,20,000', pct: 9, color: 'bg-[#023b77]' },
                  { dept: 'Operations & Human Resources', amount: '₹3,10,000', pct: 9, color: 'bg-amber-600' },
                  { dept: 'Executive & Strategic Advisory', amount: '₹2,30,000', pct: 7, color: 'bg-purple-600' },
                ].map((item) => (
                  <div key={item.dept} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{item.dept}</span>
                      <span className="font-mono font-bold text-slate-900">
                        {item.amount} <span className="text-slate-400 font-normal">({item.pct}%)</span>
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Statutory Compliance Health Calendar */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Statutory Remittance & Filings</h3>
                  <p className="text-xs text-slate-500">Government compliance deadlines & verification</p>
                </div>
                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  100% Compliant
                </span>
              </div>

              <div className="space-y-3 pt-2">
                <div className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/70 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                      EPF
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">Employees' Provident Fund (EPF/EPS)</p>
                      <p className="text-[11px] text-slate-500">Due: 15th of month · Electronic Challan cum Return (ECR)</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                    Remitted & ECR Filed
                  </span>
                </div>

                <div className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/70 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                      ESI
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">Employee State Insurance (ESIC)</p>
                      <p className="text-[11px] text-slate-500">Due: 15th of month · Statutory Monthly Return</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                    Paid & Cleared
                  </span>
                </div>

                <div className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/70 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
                      TDS
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">Income Tax TDS (Section 192)</p>
                      <p className="text-[11px] text-slate-500">Due: 7th of following month · Challan ITNS 281</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                    Deposited (BSR Verified)
                  </span>
                </div>

                <div className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/70 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                      PT
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">Professional Tax (PT Karnataka/MH)</p>
                      <p className="text-[11px] text-slate-500">Due: 20th of month · State Commercial Tax Dept</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                    Reconciled
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Disbursed Payroll Runs Ledger */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Recent Disbursed Payroll Batches</h3>
                <p className="text-xs text-slate-500">Audit trail of finalized organizational compensation runs</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('payroll')}
                className="text-xs font-bold text-[#023b77] hover:underline cursor-pointer"
              >
                View Complete Payroll Ledger →
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Cycle Month</th>
                    <th className="py-3 px-4">Headcount</th>
                    <th className="py-3 px-4">Gross Disbursal</th>
                    <th className="py-3 px-4">Total Deductions (TDS/PF)</th>
                    <th className="py-3 px-4">Net Payout Amount</th>
                    <th className="py-3 px-4">Disbursal Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {[
                    { month: 'February 2026', count: 148, gross: '₹38,92,600', ded: '₹4,12,600', net: '₹34,80,000', status: 'Disbursed' },
                    { month: 'January 2026', count: 146, gross: '₹38,24,000', ded: '₹4,04,000', net: '₹34,20,000', status: 'Disbursed' },
                    { month: 'December 2025', count: 142, gross: '₹37,56,000', ded: '₹3,96,000', net: '₹33,60,000', status: 'Disbursed' },
                    { month: 'November 2025', count: 140, gross: '₹37,00,000', ded: '₹3,90,000', net: '₹33,10,000', status: 'Disbursed' },
                  ].map((run, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-3.5 px-4 font-sans font-bold text-slate-900">{run.month}</td>
                      <td className="py-3.5 px-4 text-slate-600">{run.count} Employees</td>
                      <td className="py-3.5 px-4 text-slate-700">{run.gross}</td>
                      <td className="py-3.5 px-4 text-rose-600 font-medium">{run.ded}</td>
                      <td className="py-3.5 px-4 font-bold text-emerald-700">{run.net}</td>
                      <td className="py-3.5 px-4 font-sans">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {run.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-sans">
                        <button
                          type="button"
                          onClick={() => onNavigateTab('payroll')}
                          className="text-xs font-semibold text-[#023b77] hover:underline cursor-pointer"
                        >
                          View Run
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 4B. ACCOUNTS & LEDGER CONTROLLER DASHBOARD                   */}
      {/* ============================================================ */}
      {role === 'ACCOUNTS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => onNavigateTab('tax')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-[#023b77] hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">General Ledger & JV Posting</span>
                <Landmark className="w-4 h-4 text-[#023b77]" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">100% Reconciled</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-600 font-medium">
                <span>Journal Vouchers Posted</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('expenses')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-amber-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Loan Recovery Ledger</span>
                <Receipt className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">₹1,24,500</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-600 font-medium">
                <span>Active Advances & Recoveries</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('assets')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-indigo-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Asset Register (Read)</span>
                <Laptop className="w-4 h-4 text-indigo-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">₹42,80,000</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-indigo-600 font-medium">
                <span>Asset Valuation & Depreciation</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('full_final')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-emerald-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Exit Settlement Payouts</span>
                <CreditCard className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">F&F Ready</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-600 font-medium">
                <span>Payout Posting & Verification</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Accounts & Ledger Control Center</h3>
            <p className="text-xs text-slate-500">
              Accounts access includes Read & Write on General Ledger, JV posting, Loan recoveries, and Read Only on Asset Register & Payroll batches.
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigateTab('tax')}
                className="px-4 py-2 rounded-xl bg-[#023b77] text-white text-xs font-bold hover:bg-[#012a52] transition cursor-pointer"
              >
                Open General Ledger
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('expenses')}
                className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition cursor-pointer"
              >
                View Loan Recoveries
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('assets')}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition cursor-pointer"
              >
                Inspect Asset Register
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 4C. AUDITORS STATUTORY COMPLIANCE DASHBOARD                  */}
      {/* ============================================================ */}
      {role === 'AUDITORS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => onNavigateTab('roles_permissions')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-rose-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">18-Module RBAC Matrix</span>
                <ShieldCheck className="w-4 h-4 text-rose-500" />
              </div>
              <p className="text-2xl font-black text-rose-700 mt-2 font-mono tabular-nums">100% Compliant</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-rose-600 font-medium">
                <span>Official PDF Access Scope</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('audit_logs')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-indigo-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Immutable Audit Log</span>
                <FileText className="w-4 h-4 text-indigo-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">Real-time</p>
              <p className="text-[11px] text-slate-500 mt-2">Cryptographic Audit Inspection</p>
            </div>

            <div
              onClick={() => onNavigateTab('tax')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-emerald-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Statutory Compliance</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-black text-emerald-700 mt-2 font-mono tabular-nums">EPF / ESI / TDS</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-600 font-medium">
                <span>Challans & Returns Reconciled</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('documents')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-blue-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Employee Document Vault</span>
                <FileSpreadsheet className="w-4 h-4 text-blue-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">100% Verified</p>
              <p className="text-[11px] text-slate-500 mt-2">Read-Only Statutory Compliance</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Auditor Compliance Inspection Center</h3>
            <p className="text-xs text-slate-500">
              Auditor scope grants Read-Only access across all 18 modules for statutory auditing, compliance verification, and security log review.
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigateTab('roles_permissions')}
                className="px-4 py-2 rounded-xl bg-rose-700 text-white text-xs font-bold hover:bg-rose-800 transition cursor-pointer"
              >
                Inspect RBAC Access Matrix
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('reports')}
                className="px-4 py-2 rounded-xl bg-[#023b77] text-white text-xs font-bold hover:bg-[#012a52] transition cursor-pointer"
              >
                View Compliance Reports
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 5. EMPLOYEE DASHBOARD */}
      {/* ============================================================ */}

      {role === 'EMPLOYEE' && (
        <div className="space-y-6">
          {/* Quick Attendance Widget */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div>
                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded uppercase tracking-wide">
                  Integrated Time & Extra Pay Tracker
                </span>

                <h3 className="text-base font-bold text-slate-900 mt-1">
                  Today's Attendance
                </h3>

                <p className="text-xs text-slate-500">
                  Expected shift: 09:00 AM - 06:00 PM (8h working + 1h lunch)
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => onNavigateTab('attendance')}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  <span>Attendance Terminal</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleCheckInToggle}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    isCheckedIn
                      ? 'bg-rose-600 hover:bg-rose-700 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {isCheckedIn ? (
                    <>
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Check Out</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Check In</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Status
                </span>

                <p className="text-sm font-bold text-emerald-700 mt-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {isCheckedIn ? 'Checked In' : 'Checked Out'}
                </p>

                <p className="text-[11px] text-slate-400 mt-0.5">
                  Punch: {checkInTime}
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Expected Hours
                </span>

                <p className="text-sm font-bold text-slate-900 mt-1 font-mono">
                  8h 00m
                </p>

                <p className="text-[11px] text-slate-400 mt-0.5">
                  Shift scheduled
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Total Time on Shift
                </span>

                <p className="text-sm font-bold text-slate-900 mt-1 font-mono">
                  {calculateHours(workedMinutes)}
                </p>

                <p className="text-[11px] text-slate-400 mt-0.5">
                  Break included
                </p>
              </div>

              <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-200">
                <span className="text-[10px] font-semibold text-indigo-700 uppercase tracking-wider">
                  Extra Pay
                </span>

                <p className="text-sm font-bold text-indigo-900 mt-1 font-mono">
                  {extraDayCredit > 0 ? `+${extraDayCredit} day` : 'None'}
                </p>

                <p className="text-[11px] text-indigo-600 mt-0.5">
                  Auto-calculated
                </p>
              </div>
            </div>
          </div>

          {/* Self-service summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              onClick={() => onNavigateTab('leave')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-blue-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Leave Balance
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                18.5 Days
              </p>

              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
                <span>8 Casual</span>
                <span className="text-slate-300">·</span>
                <span>6 Sick</span>
                <span className="text-slate-300">·</span>
                <span>4.5 Earned</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('assets')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-indigo-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Company Assets
                </span>
                <Laptop className="w-4 h-4 text-indigo-600" />
              </div>

              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                Allocated
              </p>

              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-indigo-600 font-semibold">
                <span>Hardware & licenses</span>
              </div>
            </div>

            <div
              onClick={() => onNavigateTab('holidays')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-amber-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Upcoming Holiday
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>

              <p className="text-lg font-bold text-slate-900 mt-2 truncate" title={upcomingHoliday.name}>
                {upcomingHoliday.name}
              </p>

              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
                <span>
                  {upcomingHoliday.dayOfWeek ? `${upcomingHoliday.dayOfWeek}, ` : ''}
                  {new Date(upcomingHoliday.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' · '}
                  {upcomingHoliday.type === 'MANDATORY' ? 'Mandatory' : 'Restricted'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};