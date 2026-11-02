import React, { useEffect, useMemo, useState } from 'react';
import { modulesService } from '../services/modulesService';
import { FullFinalSettlement } from '../types/modules';
import { CheckCircle2, Clock, Wallet, Banknote, Landmark, AlertCircle } from 'lucide-react';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { ExportButtons } from '../components/common/ExportButtons';

const inr = (n: number | undefined) => `₹${(n || 0).toLocaleString('en-IN')}`;

const CLEARANCE_KEYS = ['department', 'itAssets', 'finance', 'admin'] as const;
const clearedCount = (f: FullFinalSettlement) => CLEARANCE_KEYS.filter((k) => f.clearances?.[k]?.cleared).length;

type PayoutState = 'PAID' | 'READY' | 'BLOCKED';

/** Disbursed once paid; ready for payroll once HR approved with all clearances in; otherwise blocked. */
const payoutState = (f: FullFinalSettlement): PayoutState => {
  if (f.status === 'DISBURSED') return 'PAID';
  if (f.status === 'HR_APPROVED' && clearedCount(f) === CLEARANCE_KEYS.length) return 'READY';
  return 'BLOCKED';
};

const PAYOUT_BADGE: Record<PayoutState, { label: string; className: string }> = {
  PAID: { label: 'Disbursed', className: 'bg-emerald-50 text-emerald-800' },
  READY: { label: 'Ready for Payout', className: 'bg-sky-50 text-sky-800' },
  BLOCKED: { label: 'Awaiting Clearances', className: 'bg-amber-50 text-amber-800' },
};

export const FullFinalPage: React.FC = () => {
  const [settlements, setSettlements] = useState<FullFinalSettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFnF = async () => {
      setLoading(true);
      try {
        const res = await modulesService.getFullFinalSettlements();
        setSettlements(res.settlements);
      } catch (err: any) {
        console.error('Failed to load FnF records', err);
        setError(err?.response?.data?.error || 'Could not load settlement records.');
      } finally {
        setLoading(false);
      }
    };
    fetchFnF();
  }, []);

  const totals = useMemo(() => {
    const sum = (pick: (f: FullFinalSettlement) => number, list = settlements) =>
      list.reduce((acc, f) => acc + (pick(f) || 0), 0);
    const unpaid = settlements.filter((f) => payoutState(f) !== 'PAID');
    return {
      netPayable: sum((f) => f.settlementComponents?.totalPayable),
      pendingPayout: sum((f) => f.settlementComponents?.totalPayable, unpaid),
      pendingCount: unpaid.length,
      gratuity: sum((f) => f.settlementComponents?.gratuity),
      disbursed: settlements.length - unpaid.length,
    };
  }, [settlements]);

  const handleExportExcel = () => {
    exportToExcel(
      settlements,
      'Full_Final_Settlement_Report',
      'FnFSettlements',
      [
        { header: 'Employee Code', key: 'employeeCode' },
        { header: 'Employee Name', key: 'employeeName' },
        { header: 'Department', key: 'department' },
        { header: 'Last Working Day', key: 'lastWorkingDay' },
        { header: 'Unpaid Salary (₹)', key: (f) => f.settlementComponents?.unpaidSalary || 0 },
        { header: 'Encashable Leaves (₹)', key: (f) => f.settlementComponents?.leaveEncashmentAmount || 0 },
        { header: 'Gratuity (₹)', key: (f) => f.settlementComponents?.gratuity || 0 },
        { header: 'Bonus / Incentive (₹)', key: (f) => f.settlementComponents?.bonusOrIncentive || 0 },
        { header: 'Notice Shortfall (₹)', key: (f) => f.settlementComponents?.noticePayShortfallDeduction || 0 },
        { header: 'Net Payable (₹)', key: (f) => f.settlementComponents?.totalPayable || 0 },
        { header: 'Payout Status', key: (f) => PAYOUT_BADGE[payoutState(f)].label },
      ]
    );
  };

  const handleExportPdf = () => {
    const headers = ['Code', 'Employee', 'Department', 'Last Working Day', 'Net Payable (₹)', 'Payout'];
    const rows = settlements.map((f) => [
      f.employeeCode,
      f.employeeName,
      f.department,
      f.lastWorkingDay,
      inr(f.settlementComponents?.totalPayable),
      PAYOUT_BADGE[payoutState(f)].label,
    ]);
    exportToPdf(
      'Full and Final (F&F) Separation Settlement Audit Report',
      headers,
      rows,
      'Full_Final_Settlement_Report',
      `Exported ${settlements.length} employee separation settlement dossiers`
    );
  };

  const summaryTiles = [
    { label: 'Total Net Settlements', value: inr(totals.netPayable), icon: Wallet, tone: 'text-[#023b77]' },
    { label: `Pending Payout (${totals.pendingCount})`, value: inr(totals.pendingPayout), icon: Clock, tone: 'text-amber-600' },
    { label: 'Gratuity Liability', value: inr(totals.gratuity), icon: Landmark, tone: 'text-indigo-600' },
    { label: 'Settlements Disbursed', value: String(totals.disbursed), icon: Banknote, tone: 'text-emerald-600' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Full and Final Settlement</h1>
          <p className="text-xs text-slate-200 mt-1">
            Final pay computation and payout status for separating employees.
          </p>
        </div>
        <ExportButtons onExportExcel={handleExportExcel} onExportPdf={handleExportPdf} disabled={settlements.length === 0} />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summaryTiles.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">{t.label}</span>
                <Icon className={`w-4 h-4 ${t.tone}`} />
              </div>
              <p className="text-xl font-black text-slate-900 mt-2 font-mono tabular-nums">{t.value}</p>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading settlement dossiers...</div>
      ) : error ? (
        <div className="p-12 text-center text-xs text-rose-600 bg-white rounded-2xl border border-rose-200">{error}</div>
      ) : settlements.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          No pending or active separation settlements.
        </div>
      ) : (
        settlements.map((fnf) => {
          const c = fnf.settlementComponents;
          const state = payoutState(fnf);
          const badge = PAYOUT_BADGE[state];
          const cleared = clearedCount(fnf);
          const earnings = [
            { label: 'Unpaid Days Salary', value: c.unpaidSalary },
            { label: `Leave Encashment (${c.leaveEncashmentDays} days)`, value: c.leaveEncashmentAmount },
            { label: 'Gratuity Payout', value: c.gratuity },
            { label: 'Pro-rated Bonus / Incentive', value: c.bonusOrIncentive },
          ];
          const grossEarnings = earnings.reduce((acc, e) => acc + (e.value || 0), 0);

          return (
            <div key={fnf._id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
                <div>
                  <span className="text-[10px] font-bold font-mono uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                    F&F DOSSIER • {fnf.employeeCode}
                  </span>
                  <h2 className="text-lg font-bold text-slate-900 mt-1">Settlement Statement: {fnf.employeeName}</h2>
                  <p className="text-xs text-slate-500 font-mono">
                    {fnf.department} • Last Working Day: {fnf.lastWorkingDay} • Clearances {cleared}/{CLEARANCE_KEYS.length}
                  </p>
                </div>
                <div className={`px-3 py-1.5 rounded-xl font-bold text-xs uppercase flex items-center gap-1.5 ${badge.className}`}>
                  {state === 'BLOCKED' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  {badge.label}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                {/* Earnings */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                  <h3 className="font-bold uppercase tracking-wider text-slate-500 text-[11px] mb-3">Earnings</h3>
                  <dl className="space-y-2 font-mono">
                    {earnings.map((e) => (
                      <div key={e.label} className="flex justify-between gap-3">
                        <dt className="text-slate-600 font-sans">{e.label}</dt>
                        <dd className="font-semibold text-slate-900">{inr(e.value)}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between gap-3 pt-2 border-t border-slate-200">
                      <dt className="font-bold text-slate-800 font-sans">Gross Earnings</dt>
                      <dd className="font-bold text-slate-900">{inr(grossEarnings)}</dd>
                    </div>
                  </dl>
                </div>

                {/* Deductions */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                  <h3 className="font-bold uppercase tracking-wider text-slate-500 text-[11px] mb-3">Deductions</h3>
                  <dl className="space-y-2 font-mono">
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-600 font-sans">
                        Notice Pay Shortfall ({Math.max(0, fnf.noticePeriodDays - fnf.noticeServedDays)} days)
                      </dt>
                      <dd className="font-semibold text-rose-700">− {inr(c.noticePayShortfallDeduction)}</dd>
                    </div>
                    <div className="flex justify-between gap-3 pt-2 border-t border-slate-200">
                      <dt className="font-bold text-slate-800 font-sans">Total Deductions</dt>
                      <dd className="font-bold text-rose-700">− {inr(c.noticePayShortfallDeduction)}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 flex justify-between items-center">
                <span className="text-xs font-bold uppercase text-slate-900">
                  {state === 'PAID' ? 'Net Settlement Disbursed' : 'Net Settlement Payable'}
                </span>
                <span className="text-xl font-black text-emerald-600 font-mono">{inr(c.totalPayable)} INR</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
