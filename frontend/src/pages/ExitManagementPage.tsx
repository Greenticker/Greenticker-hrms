import React, { useEffect, useMemo, useState } from 'react';
import { modulesService } from '../services/modulesService';
import { employeeService } from '../services/employeeService';
import { ClearanceKey as ClearanceId, FullFinalSettlement, InitiateExitInput, Resignation, SeparationType } from '../types/modules';
import { Employee } from '../types/employee';
import { CheckCircle2, Clock, UserMinus, CalendarClock, ListChecks, AlertTriangle, Plus, X, Inbox, BadgeCheck, Wallet } from 'lucide-react';

type Separation = FullFinalSettlement;

const SEPARATION_TYPES: { key: SeparationType; label: string }[] = [
  { key: 'RESIGNATION', label: 'Resignation' },
  { key: 'TERMINATION', label: 'Termination' },
  { key: 'RETIREMENT', label: 'Retirement' },
  { key: 'MUTUAL_SEPARATION', label: 'Mutual separation' },
  { key: 'END_OF_CONTRACT', label: 'End of contract' },
];
const separationLabel = (t?: SeparationType) => SEPARATION_TYPES.find((s) => s.key === t)?.label || 'Resignation';

const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
};
const daysBetween = (from: string, to: string) => {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000);
};

/** Small dialog asking for a remark/comment before an action. */
const TextDialog: React.FC<{
  title: string;
  label: string;
  intro?: string;
  required?: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (text: string) => Promise<void>;
}> = ({ title, label, intro, required, confirmLabel, onCancel, onConfirm }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (required && !text.trim()) return;
          setBusy(true);
          setError(null);
          try {
            await onConfirm(text.trim());
          } catch (err: any) {
            setError(err?.message || 'Something went wrong.');
            setBusy(false);
          }
        }}
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {intro && <p className="text-xs text-slate-600">{intro}</p>}
        <div>
          <label htmlFor="exit-dialog-text" className="block text-xs font-semibold text-slate-700">{label}{required && ' *'}</label>
          <textarea id="exit-dialog-text" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
        </div>
        {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
          <button type="submit" disabled={busy || (required && !text.trim())} className="px-4 py-2 text-xs font-bold text-white bg-[#023b77] hover:bg-[#012a52] rounded-lg cursor-pointer disabled:opacity-50">
            {busy ? 'Saving...' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

const InitiateExitModal: React.FC<{
  openExitEmployeeIds: Set<string>;
  fromResignation?: Resignation | null;
  onClose: () => void;
  onCreated: (s: Separation) => void;
}> = ({ openExitEmployeeIds, fromResignation, onClose, onCreated }) => {
  const today = toIsoDate(new Date());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [form, setForm] = useState<InitiateExitInput>(
    fromResignation
      ? {
          resignationId: fromResignation._id,
          employeeId: fromResignation.employeeId,
          separationType: 'RESIGNATION',
          resignationDate: fromResignation.noticeDate,
          lastWorkingDay: fromResignation.proposedLastWorkingDay,
          noticePeriodDays: 30,
          reason: fromResignation.reason,
        }
      : {
          employeeId: '',
          separationType: 'RESIGNATION',
          resignationDate: today,
          lastWorkingDay: addDays(today, 30),
          noticePeriodDays: 30,
          reason: '',
        }
  );
  // Until the user picks a last working day, keep it in step with the notice period
  // (a resignation already carries the employee's proposed last day)
  const [lastDayTouched, setLastDayTouched] = useState(Boolean(fromResignation));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    employeeService
      .getEmployees()
      .then((r) => setEmployees(r.employees))
      .catch(() => setError('Could not load the employee list.'))
      .finally(() => setLoadingPeople(false));
  }, []);

  const eligible = employees
    .filter((e) => (!['INACTIVE', 'TERMINATED', 'EXITED'].includes(e.status) && !openExitEmployeeIds.has(e._id)) || e._id === fromResignation?.employeeId)
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

  const update = (patch: Partial<InitiateExitInput>) => {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (!lastDayTouched && ('resignationDate' in patch || 'noticePeriodDays' in patch) && next.resignationDate) {
        next.lastWorkingDay = addDays(next.resignationDate, Number(next.noticePeriodDays) || 0);
      }
      return next;
    });
  };

  const datesValid = Boolean(form.resignationDate && form.lastWorkingDay) && form.lastWorkingDay >= form.resignationDate;
  const served = datesValid ? Math.min(form.noticePeriodDays, daysBetween(form.resignationDate, form.lastWorkingDay)) : 0;
  const shortfall = datesValid ? Math.max(0, form.noticePeriodDays - served) : 0;
  const canSave = Boolean(form.employeeId) && datesValid && form.noticePeriodDays >= 0 && !saving;

  const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-900';
  const labelCls = 'block text-xs font-semibold text-slate-700';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">
            {fromResignation ? `Initiate exit for ${fromResignation.employeeName}` : 'Initiate employee exit'}
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canSave) return;
            setSaving(true);
            setError(null);
            try {
              const res = await modulesService.initiateExit({ ...form, reason: form.reason.trim() });
              onCreated(res.settlement);
            } catch (err: any) {
              setError(err?.message || 'Could not start the exit.');
              setSaving(false);
            }
          }}
          className="p-6 space-y-4 overflow-y-auto"
        >
          <div>
            <label htmlFor="exit-employee" className={labelCls}>Employee *</label>
            <select
              id="exit-employee"
              required
              value={form.employeeId}
              onChange={(e) => update({ employeeId: e.target.value })}
              className={inputCls}
              disabled={loadingPeople || Boolean(fromResignation)}
            >
              <option value="">{loadingPeople ? 'Loading employees...' : 'Select the employee who is leaving'}</option>
              {eligible.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.firstName} {e.lastName} ({e.employeeCode}){e.department ? ` · ${e.department}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">Employees who already have an exit in progress are not listed.</p>
          </div>

          <div>
            <label htmlFor="exit-type" className={labelCls}>Separation type *</label>
            <select
              id="exit-type"
              value={form.separationType}
              onChange={(e) => update({ separationType: e.target.value as SeparationType })}
              className={inputCls}
            >
              {SEPARATION_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="exit-notice-date" className={labelCls}>Notice / resignation date *</label>
              <input id="exit-notice-date" type="date" required value={form.resignationDate} onChange={(e) => update({ resignationDate: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label htmlFor="exit-notice-days" className={labelCls}>Notice period (days) *</label>
              <input
                id="exit-notice-days"
                type="number"
                min={0}
                max={365}
                required
                value={form.noticePeriodDays}
                onChange={(e) => update({ noticePeriodDays: Math.max(0, Number(e.target.value) || 0) })}
                className={`${inputCls} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="exit-last-day" className={labelCls}>Last working day *</label>
              <input
                id="exit-last-day"
                type="date"
                required
                min={form.resignationDate}
                value={form.lastWorkingDay}
                onChange={(e) => {
                  setLastDayTouched(true);
                  update({ lastWorkingDay: e.target.value });
                }}
                className={inputCls}
              />
            </div>
          </div>

          {datesValid ? (
            <p className={`text-[11px] rounded-lg px-3 py-2 ${shortfall > 0 ? 'bg-orange-50 text-orange-800' : 'bg-emerald-50 text-emerald-800'}`}>
              {served} of {form.noticePeriodDays} notice days will be served.
              {shortfall > 0 && ` ${shortfall} day${shortfall === 1 ? '' : 's'} short — notice pay recovery applies in the F&F settlement.`}
            </p>
          ) : (
            <p className="text-[11px] rounded-lg px-3 py-2 bg-rose-50 text-rose-700">The last working day can't be before the notice date.</p>
          )}

          <div>
            <label htmlFor="exit-reason" className={labelCls}>Reason / notes</label>
            <textarea
              id="exit-reason"
              rows={3}
              maxLength={1000}
              value={form.reason}
              onChange={(e) => update({ reason: e.target.value })}
              placeholder="e.g. Resigned for higher studies; handover to Priya"
              className={inputCls}
            />
          </div>

          <p className="text-[11px] text-slate-500">
            The exit starts at the Resignation stage with all four clearances (Department, IT, Finance, Admin) pending.
          </p>

          {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={!canSave} className="px-4 py-2 text-xs font-bold text-white bg-[#023b77] hover:bg-[#012a52] rounded-lg cursor-pointer disabled:opacity-50">
              {saving ? 'Starting...' : 'Initiate exit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
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
  const [canInitiate, setCanInitiate] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [resignations, setResignations] = useState<Resignation[]>([]);
  const [fromResignation, setFromResignation] = useState<Resignation | null>(null);
  const [clearing, setClearing] = useState<{ sep: Separation; key: ClearanceId; label: string; cleared: boolean } | null>(null);
  const [approving, setApproving] = useState<Separation | null>(null);

  const replaceSeparation = (updated: Separation) =>
    setSeparations((prev) => prev.map((s) => (s._id === updated._id ? updated : s)));
  const pendingResignations = resignations.filter((r) => r.status === 'SUBMITTED');

  useEffect(() => {
    const fetchSeparations = async () => {
      setLoading(true);
      try {
        const res = await modulesService.getFullFinalSettlements();
        setSeparations(res.settlements);
        setCanInitiate(Boolean(res.canInitiate));
        modulesService.getResignations().then((r) => setResignations(r.resignations)).catch(() => setResignations([]));
      } catch (err: any) {
        console.error('Failed to load exit records', err);
        setError(err?.message || 'Could not load exit records.');
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
        <div className="flex flex-wrap items-center gap-2">
          {canInitiate && (
            <button
              type="button"
              onClick={() => setInitiating(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#039583] hover:bg-[#027a6b] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Initiate Exit</span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Resignations submitted by employees, waiting for HR */}
      {pendingResignations.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-xs">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-amber-100 bg-amber-50/60 rounded-t-2xl">
            <Inbox className="w-4 h-4 text-amber-700" />
            <h2 className="text-sm font-bold text-slate-900">Resignations awaiting action ({pendingResignations.length})</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingResignations.map((r) => (
              <div key={r._id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {r.employeeName} <span className="text-xs font-normal text-slate-500">({r.employeeCode}) · {r.department}</span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Resigned {new Date(r.submittedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · proposed last day{' '}
                    <strong className="text-slate-700">{r.proposedLastWorkingDay}</strong>
                    {r.managerName && ` · manager ${r.managerName}`}
                  </p>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2">“{r.reason}”</p>
                </div>
                {canInitiate && (
                  <button
                    type="button"
                    onClick={() => {
                      setFromResignation(r);
                      setInitiating(true);
                    }}
                    className="shrink-0 px-4 py-2 text-xs font-bold text-white bg-[#023b77] hover:bg-[#012a52] rounded-lg cursor-pointer"
                  >
                    Initiate exit
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
          // Stage progress from the record itself, so clearances can happen in any order
          const cl = (k: ClearanceKey) => Boolean(sep.clearances?.[k]?.cleared);
          const approved = sep.status === 'HR_APPROVED' || sep.status === 'DISBURSED';
          const stageDone = [true, cl('department'), cl('itAssets'), cl('finance') && cl('admin'), approved, sep.status === 'DISBURSED'];
          const firstOpen = stageDone.indexOf(false);
          const shortfall = noticeShortfall(sep);
          const servedPct = sep.noticePeriodDays > 0 ? Math.min(100, (sep.noticeServedDays / sep.noticePeriodDays) * 100) : 100;

          return (
            <div key={sep._id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
              {/* Employee header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
                <div>
                  <span className="text-[10px] font-bold font-mono uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                    {separationLabel(sep.separationType)} • {sep.employeeCode}
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
                    const done = stageDone[idx];
                    const current = idx === firstOpen;
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
                        {sep.permissions?.canClear.includes(key) && (
                          <button
                            type="button"
                            onClick={() => setClearing({ sep, key, label, cleared: !cleared })}
                            className={`mt-1.5 px-2.5 py-1 text-[11px] font-bold rounded-md cursor-pointer ${
                              cleared ? 'text-slate-600 hover:bg-slate-100' : 'bg-[#039583] text-white hover:bg-[#027a6b]'
                            }`}
                          >
                            {cleared ? 'Reopen' : 'Mark cleared'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Final approval -> F&F */}
              {sep.fnf ? (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
                  <Wallet className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Exit approved{sep.exitApprovedBy && ` by ${sep.exitApprovedBy}`}. F&F settlement initiated</strong>
                    {` on ${new Date(sep.fnf.initiatedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                    {' '}— continue on the F&F Settlement page.
                  </span>
                </div>
              ) : sep.permissions?.canApprove ? (
                <div className="p-4 rounded-xl bg-[#023b77]/5 border border-[#023b77]/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs text-slate-700">All clearances are complete. Give final approval to close the exit and start the F&F settlement.</p>
                  <button
                    type="button"
                    onClick={() => setApproving(sep)}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#023b77] hover:bg-[#012a52] rounded-lg cursor-pointer"
                  >
                    <BadgeCheck className="w-4 h-4" /> Final approval
                  </button>
                </div>
              ) : !approved && pendingClearances(sep) > 0 ? (
                <p className="text-[11px] text-slate-500">Final approval unlocks once all {CLEARANCES.length} clearances are complete.</p>
              ) : null}

              {sep.notes && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-xl p-3">
                  <span className="font-bold text-slate-800">HR notes: </span>
                  {sep.notes}
                </p>
              )}
              {sep.initiatedBy && (
                <p className="text-[10px] text-slate-400 font-mono">
                  Initiated by {sep.initiatedBy}
                  {sep.initiatedOn && ` on ${new Date(sep.initiatedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                </p>
              )}
            </div>
          );
        })
      )}

      {initiating && (
        <InitiateExitModal
          openExitEmployeeIds={new Set(separations.filter((s) => s.status !== 'DISBURSED').map((s) => s.employeeId))}
          fromResignation={fromResignation}
          onClose={() => {
            setInitiating(false);
            setFromResignation(null);
          }}
          onCreated={(s) => {
            setSeparations((prev) => [s, ...prev]);
            if (s.resignationId) {
              setResignations((prev) => prev.map((r) => (r._id === s.resignationId ? { ...r, status: 'EXIT_INITIATED', exitId: s._id } : r)));
            }
            setInitiating(false);
            setFromResignation(null);
            setFilter('ALL');
            setNotice(`Exit initiated for ${s.employeeName}. Last working day: ${s.lastWorkingDay}. The employee has been notified.`);
          }}
        />
      )}

      {clearing && (
        <TextDialog
          title={`${clearing.cleared ? 'Clear' : 'Reopen'} ${clearing.label} — ${clearing.sep.employeeName}`}
          label={clearing.cleared ? 'Remarks (what was handed over / returned)' : 'Reason for reopening (optional)'}
          required={clearing.cleared}
          confirmLabel={clearing.cleared ? 'Mark cleared' : 'Reopen'}
          onCancel={() => setClearing(null)}
          onConfirm={async (text) => {
            const res = await modulesService.setExitClearance(clearing.sep._id, clearing.key, clearing.cleared, text);
            replaceSeparation(res.settlement);
            setClearing(null);
          }}
        />
      )}

      {approving && (
        <TextDialog
          title={`Final approval — ${approving.employeeName}`}
          label="Comment (optional)"
          intro="This closes the exit and starts the Full & Final settlement. Finance, Accounts and HR are emailed."
          confirmLabel="Approve & start F&F"
          onCancel={() => setApproving(null)}
          onConfirm={async (text) => {
            const res = await modulesService.approveExit(approving._id, text);
            replaceSeparation(res.settlement);
            setApproving(null);
            setNotice(
              `Exit of ${res.settlement.employeeName} approved and F&F settlement initiated.` +
                (res.emails.length ? ` Email sent to ${res.emails.map((m) => m.email).join(', ')}.` : '')
            );
          }}
        />
      )}
    </div>
  );
};
