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
    if (role !== 'HR' && role !== 'ADMIN') return;
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

      {role === 'ADMIN' && (
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
              onClick={() => onNavigateTab('leave')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-amber-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Pending Approvals</span>
                <CalendarCheck className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">11</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-600 font-medium">
                <span>7 Leaves</span>
                <span className="text-slate-300">·</span>
                <span>4 Expenses</span>
              </div>
            </div>

            {/* Link to the confidential dashboards (no sensitive figures shown here) */}
            <div
              onClick={() => onNavigateTab('reports')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-rose-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">Confidential Dashboards</span>
                <Lock className="w-4 h-4 text-rose-500" />
              </div>
              <p className="text-lg font-bold text-slate-900 mt-2">Reports & Analytics</p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-indigo-600 font-semibold">
                <span>Workforce · Compliance · Reports</span>
                <ArrowUpRight className="w-3 h-3" />
              </div>
            </div>
          </div>

          <div>
            {operationalQueueCard}
          </div>
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
      {/* 4. EMPLOYEE DASHBOARD */}
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