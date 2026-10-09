import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types/auth';
import {
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  Lock,
  Shield,
} from 'lucide-react';

/**
 * Access tiers for this page:
 *  - PUBLIC_TO_STAFF : ADMIN, HR, MANAGER
 *  - WORKFORCE       : ADMIN, HR
 *  - CONFIDENTIAL    : ADMIN only (payroll, compliance & RBAC)
 */
const WORKFORCE_ROLES: Role[] = ['ADMIN'];
const CONFIDENTIAL_ROLES: Role[] = ['ADMIN'];

const ConfidentialBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
    <Lock className="w-3 h-3" />
    Confidential · Admin only
  </span>
);

export const ReportsPage: React.FC = () => {
  const { user } = useAuth();
  const role: Role = user?.role || 'EMPLOYEE';

  const canSeeWorkforce = WORKFORCE_ROLES.includes(role);
  const canSeeConfidential = CONFIDENTIAL_ROLES.includes(role);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Executive Reports & Workforce Analytics
        </h1>
      </div>

      {/* ============================================================ */}
      {/* TIER 1: Visible to ADMIN, HR, MANAGER                        */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">On-Time Attendance Rate</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-black text-emerald-600 font-mono">96.8%</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Hybrid 2-day in-office adherence</p>
        </div>

        {canSeeWorkforce && (
          <>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Active Headcount</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-slate-900 font-mono">148</span>
                <span className="text-xs font-bold text-emerald-600 flex items-center">
                  <ArrowUpRight className="w-3.5 h-3.5" /> +12% YoY
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">142 Active · 6 Probation</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Average Employee Tenure</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-slate-900 font-mono">3.4</span>
                <span className="text-xs font-bold text-slate-500 font-sans">Years</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Industry benchmark: 2.1 yrs</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Today's Attendance</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-slate-900 font-mono">94.2%</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">134 Present · 8 On Leave</p>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Leave Utilization Breakdown (all report viewers) */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Leave & Quota Utilization Index
            </h3>
            <span className="text-xs font-mono text-slate-400">YTD Calendar 2026</span>
          </div>

          <div className="space-y-3 pt-2">
            {[
              { label: 'Casual Leave (CL)', utilized: '34%', color: 'bg-blue-500' },
              { label: 'Earned Leave (EL)', utilized: '48%', color: 'bg-amber-500' },
              { label: 'Sick Leave (SL)', utilized: '22%', color: 'bg-rose-500' },
              { label: 'Remote / Work From Home (WFH)', utilized: '82%', color: 'bg-emerald-500' },
              { label: 'Parental / Maternity Leaves', utilized: '12%', color: 'bg-purple-500' },
            ].map((l) => (
              <div key={l.label} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-800">{l.label}</span>
                  <span className="font-mono text-slate-500">{l.utilized} consumed</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${l.color}`} style={{ width: l.utilized }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Department Headcount (ADMIN + HR) */}
        {canSeeWorkforce && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Department Headcount Distribution
              </h3>
              <span className="text-xs font-mono text-slate-400">148 Personnel</span>
            </div>

            <div className="space-y-3 pt-2">
              {[
                { dept: 'Engineering & Technology', count: 62, pct: 42, color: 'bg-indigo-600' },
                { dept: 'Product & Design', count: 24, pct: 16, color: 'bg-purple-600' },
                { dept: 'Sales & Customer Success', count: 32, pct: 22, color: 'bg-blue-600' },
                { dept: 'Finance & Compliance', count: 16, pct: 11, color: 'bg-emerald-600' },
                { dept: 'People Operations & HR', count: 14, pct: 9, color: 'bg-amber-600' },
              ].map((d) => (
                <div key={d.dept} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-800">{d.dept}</span>
                    <span className="font-mono text-slate-500">{d.count} ({d.pct}%)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${d.color}`} style={{ width: `${d.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* TIER 3: CONFIDENTIAL — ADMIN only                            */}
      {/* ============================================================ */}
      {canSeeConfidential && (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-slate-900">Confidential Dashboards</h2>
            <ConfidentialBadge />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Payroll */}
            <div className="bg-white p-6 rounded-2xl border border-rose-200/70 shadow-xs space-y-3">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold uppercase tracking-wider">Payroll Cycle (Sep 2026)</span>
                <Banknote className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-3xl font-black text-slate-900 font-mono tabular-nums">₹642,800</p>
              <p className="text-[11px] text-indigo-600 font-semibold">Processing Due Sep 30</p>
            </div>

            {/* Compliance & Org rules */}
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-rose-200/70 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Compliance & Organization Rules
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100 flex items-start gap-2.5">
                  <Shield className="w-4 h-4 text-purple-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-purple-900">Core Policies Configured</p>
                    <p className="text-[11px] text-purple-700 mt-0.5">
                      15 Starter HR policies & POSH templates initialized.
                    </p>
                  </div>
                </div>



                <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-100 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-emerald-900">RBAC Security Enforced</p>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      Strict data isolation across ADMIN, HR, MANAGER, and EMPLOYEE.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Notice for roles that cannot see the restricted sections */}
      {!canSeeConfidential && (
        <div className="flex items-start gap-2.5 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
          <Lock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p>
            {canSeeWorkforce
              ? 'Payroll and compliance dashboards are confidential and available to Admin only.'
              : 'Organization-wide workforce, payroll and compliance dashboards are restricted. You are viewing the reports available to managers.'}
          </p>
        </div>
      )}
    </div>
  );
};