import React, { useEffect, useState } from 'react';
import { BarChart3, Banknote, Download, LifeBuoy, Lock, Megaphone, Save, Send } from 'lucide-react';
import { pmsService } from '../../services/pmsService';
import { exportToExcel } from '../../utils/exportUtils';
import { CalibrationRow, IncrementRow, PayrollRow, Pip } from '../../types/pms';
import { AppraisalBadge, PipCard, RATING_LABEL } from './AppraisalPanel';

type View = 'calibration' | 'payroll' | 'pips';

const n2 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
const inr = (v: number | null) => (v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
const ErrorBox: React.FC<{ error: string | null }> = ({ error }) =>
  error ? <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div> : null;

// ------------------------------------------------------------- calibration

const Calibration: React.FC<{ isHR: boolean; onOpen: (employeeId: string) => void }> = ({ isHR, onOpen }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof pmsService.getCalibration>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => pmsService.getCalibration().then(setData).catch((err) => setError(err?.message || 'Could not load calibration.'));
  useEffect(() => {
    load();
  }, []);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="py-10 text-center text-xs text-slate-400">Loading...</div>;

  const inCalibration = data.rows.filter((r) => r.status === 'CALIBRATION').length;
  const finalCount = data.rows.filter((r) => r.status === 'FINAL').length;
  const act = async (fn: () => Promise<Record<string, number>>, label: string) => {
    setError(null);
    setMsg(null);
    try {
      const res = await fn();
      setMsg(`${label}: ${Object.values(res)[0]}`);
      load();
    } catch (err: any) {
      setError(err?.message || 'Action failed.');
    }
  };
  const maxPct = Math.max(1, ...Object.values(data.distribution).map((d) => d.pct));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Rating distribution (from calibration onwards)</p>
          <div className="space-y-2">
            {['5', '4', '3', '2', '1'].map((k) => (
              <div key={k} className="grid grid-cols-[150px_1fr_70px] items-center gap-3 text-xs">
                <span className="font-semibold text-slate-700">{k} · {RATING_LABEL[Number(k)]}</span>
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-[#023b77]" style={{ width: `${(data.distribution[k].pct / maxPct) * 100}%` }} />
                </div>
                <span className="text-right font-mono text-slate-600">{data.distribution[k].count} · {data.distribution[k].pct}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <p className="text-xs text-slate-600"><strong className="text-slate-900">{inCalibration}</strong> waiting in calibration · <strong className="text-slate-900">{finalCount}</strong> locked, not published · <strong className="text-slate-900">{data.notStarted.length}</strong> not started</p>
          <button type="button" disabled={!inCalibration} onClick={() => act(pmsService.lockCalibration, 'Locked')} className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#023b77] text-white cursor-pointer disabled:opacity-40">
            <Lock className="w-3.5 h-3.5" /> Approve & lock calibrated ratings
          </button>
          {isHR && (
            <button type="button" disabled={!finalCount} onClick={() => window.confirm(`Publish ${finalCount} ratings? Employees will see them immediately.`) && act(pmsService.publishRatings, 'Published')} className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#039583] text-white cursor-pointer disabled:opacity-40">
              <Megaphone className="w-3.5 h-3.5" /> Publish locked ratings
            </button>
          )}
          <p className="text-[10px] text-slate-400">HR adjusts individual ratings (±1 with a reason) by opening an employee. Management approves the result by locking.</p>
        </div>
      </div>
      <ErrorBox error={error} />
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{msg}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-4">Employee</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3 text-right">KPI</th>
              <th className="py-2.5 px-3 text-right">Comp.</th>
              <th className="py-2.5 px-3 text-right">360°</th>
              <th className="py-2.5 px-3 text-right">Final score</th>
              <th className="py-2.5 px-3 text-center">Calc.</th>
              <th className="py-2.5 px-3 text-center">Reviewer</th>
              <th className="py-2.5 px-3 text-center">Calibrated</th>
              <th className="py-2.5 px-3 text-center">Final</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.map((r: CalibrationRow) => (
              <tr key={r._id} onClick={() => onOpen(r.employeeId)} className="hover:bg-slate-50 cursor-pointer">
                <td className="py-2.5 px-4">
                  <p className="font-semibold text-slate-900">{r.employeeName}</p>
                  <p className="text-[11px] text-slate-400">{[r.department, r.grade, `mgr ${r.managerName}`].filter(Boolean).join(' · ')}</p>
                </td>
                <td className="py-2.5 px-3"><AppraisalBadge status={r.status} /></td>
                <td className="py-2.5 px-3 text-right font-mono">{n2(r.kpiScore)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{n2(r.competencyScore)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{n2(r.score360)}</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold">{n2(r.finalScore)}</td>
                <td className="py-2.5 px-3 text-center font-mono">{r.computedRating ?? '—'}</td>
                <td className="py-2.5 px-3 text-center font-mono">{r.proposedRating ?? '—'}</td>
                <td className="py-2.5 px-3 text-center font-mono" title={r.calibration?.reason}>{r.calibratedRating ?? '—'}{r.calibration?.rating ? ' *' : ''}</td>
                <td className="py-2.5 px-3 text-center">
                  {r.finalRating ? <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-[#023b77] text-white text-[11px] font-bold">{r.finalRating}</span> : '—'}
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><td colSpan={10} className="py-10 text-center text-slate-400">No appraisals started yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data.notStarted.length > 0 && (
        <p className="text-[11px] text-slate-500">Not started: {data.notStarted.map((n) => n.employeeName).join(', ')}</p>
      )}
    </div>
  );
};

// ----------------------------------------------------------------- payroll

const Payroll: React.FC = () => {
  const [table, setTable] = useState<IncrementRow[]>([]);
  const [data, setData] = useState<{ cycle: { name: string }; rows: PayrollRow[]; notReady: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => {
    pmsService.getIncrementTable().then((r) => setTable(r.rows));
    pmsService.getPayrollExport().then(setData).catch((err) => setError(err?.message || 'Could not load payroll export.'));
  };
  useEffect(load, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Increment table</p>
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-500">
              <tr><th className="text-left py-1">Rating</th><th className="text-right py-1">Increment %</th><th className="text-right py-1">Bonus ×</th></tr>
            </thead>
            <tbody>
              {table.map((row, i) => (
                <tr key={row.rating}>
                  <td className="py-1 font-bold">{row.rating}</td>
                  {(['incrementPct', 'bonusMultiplier'] as const).map((k) => (
                    <td key={k} className="py-1 pl-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={`${k === 'incrementPct' ? 'Increment %' : 'Bonus multiplier'} for rating ${row.rating}`}
                        value={row[k]}
                        onChange={(e) => setTable((t) => t.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)))}
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-right font-mono"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={async () => {
              setError(null);
              try {
                setTable((await pmsService.saveIncrementTable(table)).rows);
                setMsg('Increment table saved.');
                load();
              } catch (err: any) {
                setError(err?.message || 'Could not save.');
              }
            }}
            className="mt-3 flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" /> Save table
          </button>
        </div>
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <p className="text-xs text-slate-600">
            Only accepted ratings (closed) go to payroll. <strong className="text-slate-900">{data?.rows.length ?? 0}</strong> ready ·{' '}
            <strong className="text-slate-900">{data?.notReady ?? 0}</strong> still in progress or under appeal.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!data?.rows.length}
              onClick={() =>
                data &&
                exportToExcel(data.rows, `Payroll_Increments_${data.cycle.name.replace(/\s+/g, '_')}`, 'Increments', [
                  { header: 'Employee code', key: 'employeeCode' },
                  { header: 'Employee', key: 'employeeName' },
                  { header: 'Department', key: 'department' },
                  { header: 'Final rating', key: 'rating' },
                  { header: 'Increment %', key: 'incrementPct' },
                  { header: 'Bonus multiplier', key: 'bonusMultiplier' },
                  { header: 'Current annual salary', key: 'currentAnnualSalary' },
                  { header: 'New annual salary', key: 'newAnnualSalary' },
                ])
              }
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" /> Export to Excel
            </button>
            <button
              type="button"
              disabled={!data?.rows.some((r) => !r.payrollSentOn)}
              onClick={async () => {
                if (!window.confirm('Mark these ratings as sent to payroll? This is recorded in the audit log.')) return;
                setError(null);
                try {
                  setMsg(`Marked as sent: ${(await pmsService.markPayrollSent()).sent}`);
                  load();
                } catch (err: any) {
                  setError(err?.message || 'Could not mark as sent.');
                }
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#039583] text-white cursor-pointer disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" /> Mark as sent to payroll
            </button>
          </div>
        </div>
      </div>
      <ErrorBox error={error} />
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{msg}</div>}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-4">Employee</th>
              <th className="py-2.5 px-3 text-center">Rating</th>
              <th className="py-2.5 px-3 text-right">Increment</th>
              <th className="py-2.5 px-3 text-right">Bonus ×</th>
              <th className="py-2.5 px-3 text-right">Current salary</th>
              <th className="py-2.5 px-3 text-right">New salary</th>
              <th className="py-2.5 px-3">Payroll</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.rows.map((r) => (
              <tr key={r.appraisalId}>
                <td className="py-2.5 px-4"><p className="font-semibold text-slate-900">{r.employeeName}</p><p className="text-[11px] text-slate-400">{[r.employeeCode, r.department].filter(Boolean).join(' · ')}</p></td>
                <td className="py-2.5 px-3 text-center font-bold">{r.rating}</td>
                <td className="py-2.5 px-3 text-right font-mono">{r.incrementPct}%</td>
                <td className="py-2.5 px-3 text-right font-mono">{r.bonusMultiplier}</td>
                <td className="py-2.5 px-3 text-right font-mono">{inr(r.currentAnnualSalary)}</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold">{inr(r.newAnnualSalary)}</td>
                <td className="py-2.5 px-3 text-[11px]">{r.payrollSentOn ? <span className="text-emerald-700 font-semibold">Sent {new Date(r.payrollSentOn).toLocaleDateString('en-IN')}</span> : <span className="text-slate-400">Not sent</span>}</td>
              </tr>
            ))}
            {!data?.rows.length && <tr><td colSpan={7} className="py-10 text-center text-slate-400">No accepted ratings yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// -------------------------------------------------------------------- PIPs

const Pips: React.FC<{ isHR: boolean }> = ({ isHR }) => {
  const [data, setData] = useState<{ pips: Pip[]; eligible: { appraisalId: string; employeeName: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => pmsService.getPips().then(setData).catch((err) => setError(err?.message || 'Could not load plans.'));
  useEffect(() => {
    load();
  }, []);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="py-10 text-center text-xs text-slate-400">Loading...</div>;
  return (
    <div className="space-y-4">
      {isHR && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <p className="text-xs text-slate-600">
            Employees with an accepted rating of 1 get a 90-day improvement plan with reviews at day 30, 60 and 90.{' '}
            {data.eligible.length ? <>Waiting: <strong className="text-slate-900">{data.eligible.map((e) => e.employeeName).join(', ')}</strong></> : 'Nobody is waiting for a plan.'}
          </p>
          <button
            type="button"
            disabled={!data.eligible.length}
            onClick={async () => {
              setError(null);
              try {
                await pmsService.startPips();
                load();
              } catch (err: any) {
                setError(err?.message || 'Could not start plans.');
              }
            }}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-[#023b77] text-white cursor-pointer disabled:opacity-40 shrink-0"
          >
            Start improvement plans
          </button>
        </div>
      )}
      <ErrorBox error={error} />
      {data.pips.map((pip) => (
        <div key={pip._id} className="space-y-1">
          <p className="text-sm font-bold text-slate-900">{pip.employeeName}</p>
          <PipCard pip={pip} onChange={(u) => setData((d) => d && { ...d, pips: d.pips.map((x) => (x._id === u._id ? u : x)) })} />
        </div>
      ))}
      {data.pips.length === 0 && <div className="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">No improvement plans.</div>}
    </div>
  );
};

// ------------------------------------------------------------------- shell

export const YearEndAdmin: React.FC<{ isHR: boolean; onOpenEmployee: (employeeId: string) => void }> = ({ isHR, onOpenEmployee }) => {
  const [view, setView] = useState<View>('calibration');
  const views: [View, string, React.ComponentType<{ className?: string }>, boolean][] = [
    ['calibration', 'Calibration', BarChart3, true],
    ['payroll', 'Payroll', Banknote, isHR],
    ['pips', 'Improvement plans', LifeBuoy, true],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {views.filter(([, , , v]) => v).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setView(id)} className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${view === id ? 'bg-white text-[#023b77] shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      {view === 'calibration' && <Calibration isHR={isHR} onOpen={onOpenEmployee} />}
      {view === 'payroll' && isHR && <Payroll />}
      {view === 'pips' && <Pips isHR={isHR} />}
    </div>
  );
};
