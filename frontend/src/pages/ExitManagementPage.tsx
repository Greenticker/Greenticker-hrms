import React, { useEffect, useMemo, useState } from 'react';
import { modulesService } from '../services/modulesService';
import { FullFinalSettlement } from '../types/modules';
import { CheckCircle2, Clock, UserMinus, CalendarClock, ListChecks, AlertTriangle } from 'lucide-react';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { ExportButtons } from '../components/common/ExportButtons';

type Separation = FullFinalSettlement;
type ClearanceKey = keyof Separation['clearances'];

const STAGES: { key: Separation['status']; label: string }[] = [
  { key: 'INITIATED', label: 'Resignation' },
  { key: 'DEPARTMENT_CLEARANCE', label: 'Department' },
  { key: 'IT_CLEARANCE', label: 'IT Assets' },
  { key: 'FINANCE_CLEARANCE', label: 'Finance' },
  { key: 'HR_APPROVED', label: 'HR Approval' },
  { key: 'DISBURSED', label: 'F&F Paid' },
];

const CLEARANCES: { key: ClearanceKey; label: string }[] = [
  { key: 'department', label: 'Department' },
  { key: 'itAssets', label: 'IT Hardware' },
  { key: 'finance', label: 'Finance & Cards' },
  { key: 'admin', label: 'Admin & Badges' },
];

const COMPLETED_STATUSES: Separation['status'][] = ['HR_APPROVED', 'DISBURSED'];

type Filter = 'ALL' | 'IN_PROGRESS' | 'COMPLETED';

const stageLabel = (status: Separation['status']) => STAGES.find((s) => s.key === status)?.label || status;
const pendingClearances = (s: Separation) => CLEARANCES.filter((c) => !s.clearances?.[c.key]?.cleared).length;
const noticeShortfall = (s: Separation) => Math.max(0, (s.noticePeriodDays || 0) - (s.noticeServedDays || 0));

export const ExitManagementPage: React.FC = () => {
  const [separations, setSeparations] = useState<Separation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  useEffect(() => {
    const fetchSeparations = async () => {
      setLoading(true);
      try {
        const res = await modulesService.getFullFinalSettlements();
        setSeparations(res.settlements);
      } catch (err: any) {
        console.error('Failed to load exit records', err);
        setError(err?.response?.data?.error || 'Could not load exit records.');
      } finally {
        setLoading(false);
      }
    };
    fetchSeparations();
  }, []);

  const stats = useMemo(
    () => ({
      total: separations.length,
      inProgress: separations.filter((s) => !COMPLETED_STATUSES.includes(s.status)).length,
      pendingClearances: separations.reduce((sum, s) => sum + pendingClearances(s), 0),
      shortfall: separations.filter((s) => noticeShortfall(s) > 0).length,
    }),
    [separations]
  );

  const visible = separations.filter((s) => {
    if (filter === 'IN_PROGRESS') return !COMPLETED_STATUSES.includes(s.status);
    if (filter === 'COMPLETED') return COMPLETED_STATUSES.includes(s.status);
    return true;
  });

  const handleExportExcel = () => {
    exportToExcel(
      separations,
      'Exit_Management_Report',
      'Separations',
      [
        { header: 'Employee Code', key: 'employeeCode' },
        { header: 'Employee Name', key: 'employeeName' },
        { header: 'Department', key: 'department' },
        { header: 'Resignation Date', key: 'resignationDate' },
        { header: 'Last Working Day', key: 'lastWorkingDay' },
        { header: 'Notice Period (Days)', key: 'noticePeriodDays' },
        { header: 'Notice Served (Days)', key: 'noticeServedDays' },
        { header: 'Stage', key: (s) => stageLabel(s.status) },
        { header: 'Pending Clearances', key: (s) => pendingClearances(s) },
      ]
    );
  };

  const handleExportPdf = () => {
    const headers = ['Code', 'Employee', 'Department', 'Resigned', 'Last Working Day', 'Notice', 'Stage'];
    const rows = separations.map((s) => [
      s.employeeCode,
      s.employeeName,
      s.department,
      s.resignationDate,
      s.lastWorkingDay,
      `${s.noticeServedDays}/${s.noticePeriodDays} days`,
      stageLabel(s.status),
    ]);
    exportToPdf(
      'Employee Exit & Separation Tracker',
      headers,
      rows,
      'Exit_Management_Report',
      `Exported ${separations.length} employee separation records`
    );
  };

  const statTiles = [
    { label: 'Total Separations', value: stats.total, icon: UserMinus, tone: 'text-[#023b77]' },
    { label: 'Exits In Progress', value: stats.inProgress, icon: CalendarClock, tone: 'text-amber-600' },
    { label: 'Clearances Pending', value: stats.pendingClearances, icon: ListChecks, tone: 'text-rose-600' },
    { label: 'Notice Shortfall', value: stats.shortfall, icon: AlertTriangle, tone: 'text-orange-600' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Exit Management</h1>
          <p className="text-xs text-slate-200 mt-1">
            Resignations, notice periods and departmental clearances for separating employees.
          </p>
        </div>
        <ExportButtons onExportExcel={handleExportExcel} onExportPdf={handleExportPdf} disabled={separations.length === 0} />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statTiles.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold">{t.label}</span>
                <Icon className={`w-4 h-4 ${t.tone}`} />
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">{t.value}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {([
          ['ALL', 'All'],
          ['IN_PROGRESS', 'In Progress'],
          ['COMPLETED', 'Completed'],
        ] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
              filter === key
                ? 'bg-[#023b77] text-white border-[#023b77]'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading exit records...</div>
      ) : error ? (
        <div className="p-12 text-center text-xs text-rose-600 bg-white rounded-2xl border border-rose-200">{error}</div>
      ) : visible.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          No separations in this view.
        </div>
      ) : (
        visible.map((sep) => {
          const currentStage = STAGES.findIndex((s) => s.key === sep.status);
          const shortfall = noticeShortfall(sep);
          const servedPct = sep.noticePeriodDays > 0 ? Math.min(100, (sep.noticeServedDays / sep.noticePeriodDays) * 100) : 100;

          return (
            <div key={sep._id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
              {/* Employee header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
                <div>
                  <span className="text-[10px] font-bold font-mono uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                    SEPARATION • {sep.employeeCode}
                  </span>
                  <h2 className="text-lg font-bold text-slate-900 mt-1">{sep.employeeName}</h2>
                  <p className="text-xs text-slate-500 font-mono">
                    {sep.department} • Resigned: {sep.resignationDate} • Last Working Day: {sep.lastWorkingDay}
                  </p>
                </div>
                <div
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs uppercase flex items-center gap-1.5 ${
                    COMPLETED_STATUSES.includes(sep.status) ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  {COMPLETED_STATUSES.includes(sep.status) ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                  {stageLabel(sep.status)}
                </div>
              </div>

              {/* Stage tracker */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Exit Workflow</h3>
                <ol className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {STAGES.map((stage, idx) => {
                    const done = idx < currentStage || sep.status === 'DISBURSED';
                    const current = idx === currentStage && sep.status !== 'DISBURSED';
                    return (
                      <li key={stage.key} className="space-y-1.5">
                        <div
                          className={`h-1.5 rounded-full ${
                            done ? 'bg-emerald-500' : current ? 'bg-amber-400' : 'bg-slate-200'
                          }`}
                        />
                        <p
                          className={`text-[11px] font-semibold ${
                            done ? 'text-emerald-700' : current ? 'text-amber-700' : 'text-slate-400'
                          }`}
                        >
                          {stage.label}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {/* Notice period */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">Notice Period</span>
                  <span className="font-mono text-slate-600">
                    {sep.noticeServedDays} of {sep.noticePeriodDays} days served
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full ${shortfall > 0 ? 'bg-orange-500' : 'bg-emerald-500'}`}
                    style={{ width: `${servedPct}%` }}
                  />
                </div>
                {shortfall > 0 && (
                  <p className="text-[11px] text-orange-700 font-medium">
                    {shortfall} day{shortfall === 1 ? '' : 's'} short. Notice pay recovery applies in the F&F settlement.
                  </p>
                )}
              </div>

              {/* Clearances */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  Departmental Clearances ({CLEARANCES.length - pendingClearances(sep)}/{CLEARANCES.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {CLEARANCES.map(({ key, label }) => {
                    const c = sep.clearances?.[key];
                    const cleared = Boolean(c?.cleared);
                    return (
                      <div
                        key={key}
                        className={`p-3.5 rounded-xl border space-y-1 ${
                          cleared ? 'bg-slate-50 border-slate-100' : 'bg-amber-50/60 border-amber-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-slate-800">{label}</span>
                          {cleared ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Clock className="w-4 h-4 text-amber-600" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500">{c?.remarks || (cleared ? 'Cleared' : 'Awaiting clearance')}</p>
                        {cleared && c?.clearedBy && (
                          <p className="text-[10px] text-slate-400 font-mono">Cleared by {c.clearedBy}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {sep.notes && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-xl p-3">
                  <span className="font-bold text-slate-800">HR notes: </span>
                  {sep.notes}
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
