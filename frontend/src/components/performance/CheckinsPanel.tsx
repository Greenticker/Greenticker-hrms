import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, MessageSquare, Save, Send } from 'lucide-react';
import { pmsService } from '../../services/pmsService';
import { Checkin, CheckinStatus } from '../../types/pms';
import { ReasonDialog } from './GoalSheetView';

const STATUS: Record<CheckinStatus, { label: string; cls: string }> = {
  OPEN: { label: 'Open', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  WITH_MANAGER: { label: 'With manager', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  DONE: { label: 'Done', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
};

const fmt = (iso?: string) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const CheckinCard: React.FC<{ employeeId: string; checkin: Checkin; onChange: (c: Checkin) => void }> = ({ employeeId, checkin, onChange }) => {
  const perms = checkin.permissions;
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    setProgress(Object.fromEntries(checkin.lines.map((l) => [l.lineId, l.value == null ? '' : String(l.value)])));
    setComment(checkin.employeeComment);
    setDirty(false);
  }, [checkin]);

  const payload = () => ({
    progress: Object.fromEntries(Object.entries(progress).map(([k, v]) => [k, v.trim() === '' ? null : Number(v)])),
    employeeComment: comment,
  });

  const run = async (fn: () => Promise<{ checkin: Checkin }>) => {
    setBusy(true);
    setError(null);
    try {
      onChange((await fn()).checkin);
      return true;
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const isMidYear = checkin.period === 'MID_YEAR';
  const s = STATUS[checkin.status];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-bold text-slate-900">{checkin.label}</h4>
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${s.cls}`}>{s.label}</span>
          {checkin.overdue && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-100 text-rose-700">Overdue</span>}
        </div>
        {checkin.due && (
          <span className="text-[11px] text-slate-500 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Due {fmt(checkin.due)}
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {!isMidYear && checkin.lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase font-bold text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="py-2 pr-3 text-left">KPI</th>
                  <th className="py-2 px-3 text-right">Target</th>
                  <th className="py-2 px-3 text-right w-32">Progress to date</th>
                  <th className="py-2 px-3 text-right">Achieved</th>
                  <th className="py-2 pl-3 text-center">Indicative</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {checkin.lines.map((l) => (
                  <tr key={l.lineId}>
                    <td className="py-2 pr-3">
                      <span className="font-semibold text-slate-800">{l.kpi}</span> <span className="text-slate-400">({l.unit})</span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{l.target}</td>
                    <td className="py-2 px-3 text-right">
                      {perms.canEdit ? (
                        <input
                          type="number"
                          min={0}
                          step="any"
                          aria-label={`Progress for ${l.kpi}`}
                          value={progress[l.lineId] ?? ''}
                          onChange={(e) => {
                            setProgress((p) => ({ ...p, [l.lineId]: e.target.value }));
                            setDirty(true);
                          }}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-right font-mono"
                        />
                      ) : (
                        <span className="font-mono">{l.value ?? '—'}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600">{l.achievement == null ? '—' : `${Math.round(l.achievement * 1000) / 10}%`}</td>
                    <td className="py-2 pl-3 text-center font-bold">{l.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-400 mt-1">Indicative scores use progress so far. Final scores come from year-end actuals.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-1">{isMidYear ? 'Employee self-review' : 'Employee update'}</p>
            {perms.canEdit ? (
              <textarea
                rows={4}
                aria-label="Employee comment"
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  setDirty(true);
                }}
                placeholder={isMidYear ? 'How has the first half gone? What will you focus on next?' : 'Progress, blockers, help needed...'}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            ) : (
              <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 min-h-[3rem] whitespace-pre-wrap">{checkin.employeeComment || <span className="text-slate-400">Not added yet.</span>}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-1">Manager comments</p>
            <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 min-h-[3rem] whitespace-pre-wrap">
              {checkin.managerComment || <span className="text-slate-400">{checkin.status === 'WITH_MANAGER' ? 'Waiting for the manager.' : 'Not added yet.'}</span>}
            </p>
            {checkin.completedBy && <p className="text-[10px] text-slate-400 mt-1">Completed by {checkin.completedBy} on {fmt(checkin.completedOn)}</p>}
          </div>
        </div>

        {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}

        {(perms.canEdit || perms.canComplete) && (
          <div className="flex flex-wrap justify-end gap-2">
            {perms.canEdit && (
              <button type="button" disabled={!dirty || busy} onClick={() => run(() => pmsService.saveCheckin(employeeId, checkin.period, payload()))} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-40">
                <Save className="w-3.5 h-3.5" /> Save
              </button>
            )}
            {perms.canSubmit && (
              <button
                type="button"
                disabled={busy || !comment.trim()}
                onClick={async () => {
                  if (dirty && !(await run(() => pmsService.saveCheckin(employeeId, checkin.period, payload())))) return;
                  await run(() => pmsService.submitCheckin(employeeId, checkin.period));
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#039583] text-white hover:bg-[#027a6b] cursor-pointer disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" /> Send to manager
              </button>
            )}
            {perms.canComplete && (
              <button type="button" onClick={() => setCompleting(true)} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#023b77] text-white hover:bg-[#012a52] cursor-pointer">
                <MessageSquare className="w-3.5 h-3.5" /> Add comments & complete
              </button>
            )}
          </div>
        )}
      </div>

      {completing && (
        <ReasonDialog
          title={`Complete ${checkin.label}`}
          label="Your comments for the employee"
          confirmLabel="Complete"
          required
          onCancel={() => setCompleting(false)}
          onConfirm={async (text) => {
            onChange((await pmsService.completeCheckin(employeeId, checkin.period, text)).checkin);
            setCompleting(false);
          }}
        />
      )}
    </div>
  );
};

export const CheckinsPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [data, setData] = useState<{ goalsLocked: boolean; checkins: Checkin[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pmsService.getCheckins(employeeId).then(setData).catch((err) => setError(err?.message || 'Could not load check-ins.'));
  }, [employeeId]);

  if (error) return <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>;
  if (!data) return <div className="py-10 text-center text-xs text-slate-400">Loading check-ins...</div>;

  const done = data.checkins.filter((c) => c.status === 'DONE').length;

  return (
    <div className="space-y-4">
      {!data.goalsLocked && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          Check-ins open once the goal sheet is approved and locked.
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <CheckCircle2 className="w-4 h-4 text-[#039583]" /> {done} of {data.checkins.length} check-ins completed
      </div>
      {data.checkins.map((c) => (
        <CheckinCard
          key={c.period}
          employeeId={employeeId}
          checkin={c}
          onChange={(updated) => setData((d) => d && { ...d, checkins: d.checkins.map((x) => (x.period === updated.period ? updated : x)) })}
        />
      ))}
    </div>
  );
};
