import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { pmsService } from '../../services/pmsService';
import { exportToExcel } from '../../utils/exportUtils';
import { PmsReports as Reports } from '../../types/pms';
import { STATUS_STYLE } from './GoalSheetView';
import { APPRAISAL_STATUS, AppraisalBadge, RATING_LABEL } from './AppraisalPanel';

type View = 'status' | 'spread' | 'ratings' | 'feedback' | 'training';

const n2 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));

const Card: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-xs">
    <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h4>
      {action}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const ExportBtn: React.FC<{ onClick: () => void; disabled?: boolean }> = ({ onClick, disabled }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-40">
    <Download className="w-3.5 h-3.5" /> Export
  </button>
);

/** One horizontal stacked bar per stage; each segment = count in that status. */
const StageBar: React.FC<{ label: string; counts: Record<string, number>; order: [string, string, string][]; total: number }> = ({ label, counts, order, total }) => (
  <div>
    <div className="flex justify-between text-xs mb-1">
      <span className="font-semibold text-slate-800">{label}</span>
      <span className="text-slate-500 font-mono">{total}</span>
    </div>
    <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
      {order.map(([key, , color]) => (counts[key] ? <div key={key} title={`${key}: ${counts[key]}`} style={{ width: `${(counts[key] / total) * 100}%`, background: color }} /> : null))}
    </div>
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
      {order.map(([key, name, color]) =>
        counts[key] ? (
          <span key={key} className="text-[10px] text-slate-600 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: color }} /> {name} {counts[key]}
          </span>
        ) : null
      )}
    </div>
  </div>
);

const GOAL_ORDER: [string, string, string][] = [
  ['LOCKED', STATUS_STYLE.LOCKED.label, '#039583'],
  ['APPROVED', STATUS_STYLE.APPROVED.label, '#6366f1'],
  ['SUBMITTED', STATUS_STYLE.SUBMITTED.label, '#3b82f6'],
  ['DRAFT', STATUS_STYLE.DRAFT.label, '#f59e0b'],
  ['NOT_STARTED', STATUS_STYLE.NOT_STARTED.label, '#cbd5e1'],
];
const CHECKIN_ORDER: [string, string, string][] = [
  ['DONE', 'Done', '#039583'],
  ['WITH_MANAGER', 'With manager', '#3b82f6'],
  ['OPEN', 'Open', '#cbd5e1'],
];
const NOM_ORDER: [string, string, string][] = [
  ['APPROVED', 'Approved', '#039583'],
  ['SUBMITTED', 'With manager', '#3b82f6'],
  ['DRAFT', 'Draft', '#f59e0b'],
  ['NOT_STARTED', 'Not started', '#cbd5e1'],
];
const APPRAISAL_ORDER: [string, string, string][] = [
  ['CLOSED', APPRAISAL_STATUS.CLOSED.label, '#039583'],
  ['APPEAL', APPRAISAL_STATUS.APPEAL.label, '#e11d48'],
  ['PUBLISHED', APPRAISAL_STATUS.PUBLISHED.label, '#14b8a6'],
  ['FINAL', APPRAISAL_STATUS.FINAL.label, '#64748b'],
  ['CALIBRATION', APPRAISAL_STATUS.CALIBRATION.label, '#a855f7'],
  ['REVIEWER', APPRAISAL_STATUS.REVIEWER.label, '#6366f1'],
  ['MANAGER', APPRAISAL_STATUS.MANAGER.label, '#3b82f6'],
  ['SELF', APPRAISAL_STATUS.SELF.label, '#f59e0b'],
  ['NOT_STARTED', 'Not started', '#cbd5e1'],
];
const CHECKIN_LABEL: Record<string, string> = { Q1: 'Q1 check-in', Q2: 'Q2 check-in', MID_YEAR: 'Mid-year review', Q3: 'Q3 check-in' };

export const PmsReports: React.FC<{ onOpenEmployee: (employeeId: string) => void }> = ({ onOpenEmployee }) => {
  const [data, setData] = useState<Reports | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('status');
  useEffect(() => {
    pmsService.getReports().then(setData).catch((err) => setError(err?.message || 'Could not load reports.'));
  }, []);
  if (error) return <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>;
  if (!data) return <div className="py-10 text-center text-xs text-slate-400">Loading reports...</div>;

  const total = data.headcount || 1;
  const views: [View, string][] = [
    ['status', 'Status tracker'],
    ['spread', 'Rating spread'],
    ['ratings', `Final ratings (${data.finalRatings.length})`],
    ['feedback', '360° summary'],
    ['training', `Training needs (${data.trainingNeeds.length})`],
  ];
  const maxPct = Math.max(1, ...Object.values(data.ratingSpread).map((d) => d.pct));
  const file = (name: string) => `PMS_${name}_${data.cycle.name.replace(/\s+/g, '_')}`;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {data.cycle.name} · {data.scope === 'all' ? 'all employees' : 'your team'} ({data.headcount})
      </p>
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {views.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setView(id)} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${view === id ? 'bg-white text-[#023b77] shadow-xs' : 'text-slate-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'status' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Where everyone is">
            <div className="space-y-4">
              <StageBar label="Goal sheets" counts={data.status.goals} order={GOAL_ORDER} total={total} />
              <StageBar label="360° nominations" counts={data.status.nominations} order={NOM_ORDER} total={total} />
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-800">360° feedback given</span>
                  <span className="text-slate-500 font-mono">{data.status.feedback.given} / {data.status.feedback.assigned}</span>
                </div>
                <div className="h-3 rounded-full overflow-hidden bg-slate-100">
                  <div className="h-full bg-[#039583]" style={{ width: `${data.status.feedback.assigned ? (data.status.feedback.given / data.status.feedback.assigned) * 100 : 0}%` }} />
                </div>
              </div>
              <StageBar label="Year-end appraisal" counts={data.status.appraisal} order={APPRAISAL_ORDER} total={total} />
            </div>
          </Card>
          <Card title="Check-ins">
            <div className="space-y-4">
              {Object.entries(data.status.checkins).map(([period, counts]) => (
                <StageBar key={period} label={CHECKIN_LABEL[period] || period} counts={counts} order={CHECKIN_ORDER} total={total} />
              ))}
            </div>
          </Card>
          <div className="lg:col-span-2">
            <Card
              title="By department"
              action={<ExportBtn onClick={() => exportToExcel(data.departments, file('Departments'), 'Departments', [
                { header: 'Department', key: 'department' },
                { header: 'Employees', key: 'employees' },
                { header: 'Goals locked', key: 'goalsLocked' },
                { header: 'Appraisals at calibration or later', key: 'appraisalsDone' },
                ...[5, 4, 3, 2, 1].map((r) => ({ header: `Rated ${r}`, key: (d: Reports['departments'][number]) => d.ratings[String(r)] })),
              ])} />}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase font-bold text-slate-500">
                    <tr className="border-b border-slate-100">
                      <th className="py-2 text-left">Department</th>
                      <th className="py-2 text-right">Employees</th>
                      <th className="py-2 text-right">Goals locked</th>
                      <th className="py-2 text-right">Appraisals done</th>
                      {[5, 4, 3, 2, 1].map((r) => <th key={r} className="py-2 text-right w-12">{r}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.departments.map((d) => (
                      <tr key={d.department}>
                        <td className="py-2 font-semibold text-slate-800">{d.department}</td>
                        <td className="py-2 text-right font-mono">{d.employees}</td>
                        <td className="py-2 text-right font-mono">{d.goalsLocked} <span className="text-slate-400">({Math.round((d.goalsLocked / d.employees) * 100)}%)</span></td>
                        <td className="py-2 text-right font-mono">{d.appraisalsDone}</td>
                        {[5, 4, 3, 2, 1].map((r) => <td key={r} className="py-2 text-right font-mono text-slate-600">{d.ratings[String(r)] || '·'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {view === 'spread' && (
        <Card title="Rating spread (calibration onwards)">
          <div className="space-y-2.5 max-w-2xl">
            {['5', '4', '3', '2', '1'].map((k) => (
              <div key={k} className="grid grid-cols-[170px_1fr_80px] items-center gap-3 text-xs">
                <span className="font-semibold text-slate-700">{k} · {RATING_LABEL[Number(k)]}</span>
                <div className="h-4 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-[#023b77]" style={{ width: `${(data.ratingSpread[k].pct / maxPct) * 100}%` }} />
                </div>
                <span className="text-right font-mono text-slate-600">{data.ratingSpread[k].count} · {data.ratingSpread[k].pct}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {view === 'ratings' && (
        <Card
          title="Final rating list"
          action={<ExportBtn disabled={!data.finalRatings.length} onClick={() => exportToExcel(data.finalRatings, file('Final_Ratings'), 'Ratings', [
            { header: 'Employee code', key: 'employeeCode' },
            { header: 'Employee', key: 'employeeName' },
            { header: 'Department', key: 'department' },
            { header: 'Grade', key: 'grade' },
            { header: 'Manager', key: 'managerName' },
            { header: 'Status', key: 'status' },
            { header: 'KPI score', key: 'kpiScore' },
            { header: 'Competency score', key: 'competencyScore' },
            { header: '360 score', key: 'score360' },
            { header: 'Final score', key: 'finalScore' },
            { header: 'Final rating', key: 'finalRating' },
          ])} />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase font-bold text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="py-2 text-left">Employee</th><th className="py-2 text-left">Status</th>
                  <th className="py-2 text-right">KPI</th><th className="py-2 text-right">Comp.</th><th className="py-2 text-right">360°</th>
                  <th className="py-2 text-right">Final</th><th className="py-2 text-center">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.finalRatings.map((r) => (
                  <tr key={r.employeeId} onClick={() => onOpenEmployee(r.employeeId)} className="hover:bg-slate-50 cursor-pointer">
                    <td className="py-2"><p className="font-semibold text-slate-900">{r.employeeName}</p><p className="text-[11px] text-slate-400">{[r.department, r.grade].filter(Boolean).join(' · ')}</p></td>
                    <td className="py-2"><AppraisalBadge status={r.status} /></td>
                    <td className="py-2 text-right font-mono">{n2(r.kpiScore)}</td>
                    <td className="py-2 text-right font-mono">{n2(r.competencyScore)}</td>
                    <td className="py-2 text-right font-mono">{n2(r.score360)}</td>
                    <td className="py-2 text-right font-mono font-bold">{n2(r.finalScore)}</td>
                    <td className="py-2 text-center font-bold">{r.finalRating ?? '—'}</td>
                  </tr>
                ))}
                {!data.finalRatings.length && <tr><td colSpan={7} className="py-8 text-center text-slate-400">No appraisals have reached calibration yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {view === 'feedback' && (
        <Card
          title="360° summary"
          action={<ExportBtn disabled={!data.report360.length} onClick={() => exportToExcel(data.report360, file('360_Summary'), '360', [
            { header: 'Employee', key: 'employeeName' },
            { header: 'Department', key: 'department' },
            { header: '360 score', key: 'score360' },
            { header: 'Replies counted', key: 'responses' },
            { header: 'Groups shown', key: 'groupsShown' },
          ])} />}
        >
          {!data.feedback360Closed ? (
            <p className="text-xs text-slate-500">The 360° summary is available once HR closes feedback for the cycle.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase font-bold text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="py-2 text-left">Employee</th><th className="py-2 text-right">360° score</th>
                    <th className="py-2 text-right">Replies counted</th><th className="py-2 text-right">Groups shown</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.report360.map((r) => (
                    <tr key={r.employeeId} onClick={() => onOpenEmployee(r.employeeId)} className="hover:bg-slate-50 cursor-pointer">
                      <td className="py-2"><p className="font-semibold text-slate-900">{r.employeeName}</p><p className="text-[11px] text-slate-400">{r.department}</p></td>
                      <td className="py-2 text-right font-mono font-bold">{n2(r.score360)}</td>
                      <td className="py-2 text-right font-mono">{r.responses}</td>
                      <td className="py-2 text-right font-mono">{r.groupsShown} / 4</td>
                    </tr>
                  ))}
                  {!data.report360.length && <tr><td colSpan={4} className="py-8 text-center text-slate-400">Nobody received 360° feedback this cycle.</td></tr>}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-400 mt-2">Replies from groups with fewer than 3 people are not counted, to protect anonymity.</p>
            </div>
          )}
        </Card>
      )}

      {view === 'training' && (
        <Card
          title="Training needs (competencies rated 2 or below)"
          action={<ExportBtn disabled={!data.trainingNeeds.length} onClick={() => exportToExcel(data.trainingNeeds, file('Training_Needs'), 'Training', [
            { header: 'Employee code', key: 'employeeCode' },
            { header: 'Employee', key: 'employeeName' },
            { header: 'Department', key: 'department' },
            { header: 'Manager', key: 'managerName' },
            { header: 'Competency', key: 'competency' },
            { header: 'Score', key: 'score' },
            { header: 'Source', key: 'source' },
          ])} />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase font-bold text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="py-2 text-left">Employee</th><th className="py-2 text-left">Competency</th>
                  <th className="py-2 text-right">Score</th><th className="py-2 text-left pl-4">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.trainingNeeds.map((t, i) => (
                  <tr key={i}>
                    <td className="py-2"><p className="font-semibold text-slate-900">{t.employeeName}</p><p className="text-[11px] text-slate-400">{t.department} · mgr {t.managerName}</p></td>
                    <td className="py-2 text-slate-800">{t.competency}</td>
                    <td className="py-2 text-right font-mono font-bold text-rose-700">{typeof t.score === 'number' ? t.score.toFixed(t.score % 1 ? 2 : 0) : t.score}</td>
                    <td className="py-2 pl-4 text-slate-600">{t.source}</td>
                  </tr>
                ))}
                {!data.trainingNeeds.length && <tr><td colSpan={4} className="py-8 text-center text-slate-400">No low-rated competencies yet. They appear once managers rate competencies at year end.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
