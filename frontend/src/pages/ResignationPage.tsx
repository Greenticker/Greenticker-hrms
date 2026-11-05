import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, LogOut, Mail, Undo2, X } from 'lucide-react';
import { modulesService } from '../services/modulesService';
import { ClearanceKey, MyResignationView } from '../types/modules';

const CLEARANCE_LABELS: [ClearanceKey, string][] = [
  ['department', 'Department'],
  ['itAssets', 'IT assets'],
  ['finance', 'Finance'],
  ['admin', 'Admin'],
];

const fmt = (iso?: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ResignForm: React.FC<{ onClose: () => void; onDone: (emails: string[]) => void }> = ({ onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [lastDay, setLastDay] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-900';
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await modulesService.submitResignation({ reason: reason.trim(), proposedLastWorkingDay: lastDay });
            onDone(res.emails.map((m) => m.email));
          } catch (err: any) {
            setError(err?.message || 'Could not submit your resignation.');
            setBusy(false);
          }
        }}
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Submit resignation</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div>
          <label htmlFor="resign-reason" className="block text-xs font-semibold text-slate-700">Reason *</label>
          <textarea id="resign-reason" required rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="Why are you leaving?" />
        </div>
        <div>
          <label htmlFor="resign-last-day" className="block text-xs font-semibold text-slate-700">Proposed last working day *</label>
          <input id="resign-last-day" type="date" required min={todayIso()} value={lastDay} onChange={(e) => setLastDay(e.target.value)} className={inputCls} />
          <p className="text-[10px] text-slate-400 mt-1">HR confirms the final date based on your notice period.</p>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 rounded border-slate-300" />
          <span>I understand that HR and my reporting manager will be emailed. I can withdraw this until HR starts my exit.</span>
        </label>
        {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
          <button type="submit" disabled={busy || !confirm || !reason.trim() || !lastDay} className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer disabled:opacity-50">
            {busy ? 'Submitting...' : 'Submit resignation'}
          </button>
        </div>
      </form>
    </div>
  );
};

export const ResignationPage: React.FC = () => {
  const [data, setData] = useState<MyResignationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => modulesService.getMyResignation().then(setData).catch((err) => setError(err?.message || 'Could not load your resignation.'));
  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>;
  if (!data) return <div className="py-12 text-center text-xs text-slate-400">Loading...</div>;

  const { resignation: res, exit } = data;
  const active = res && res.status !== 'WITHDRAWN' ? res : null;
  const approved = exit?.status === 'HR_APPROVED' || exit?.status === 'DISBURSED';

  // Overall journey for the employee
  const steps = [
    { label: 'Resignation submitted', done: Boolean(active) || Boolean(exit), when: active?.submittedOn },
    { label: 'Exit started by HR', done: Boolean(exit), when: exit?.initiatedOn },
    { label: 'Clearances completed', done: Boolean(exit) && CLEARANCE_LABELS.every(([k]) => exit!.clearances?.[k]?.cleared), when: null },
    { label: 'Exit approved', done: approved, when: exit?.exitApprovedOn },
    { label: 'F&F settlement started', done: Boolean(exit?.fnf), when: exit?.fnf?.initiatedOn },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">My Resignation</h1>
          {data.employee && (
            <p className="text-xs text-slate-200 mt-1">
              {data.employee.name} · {data.employee.employeeCode}
              {data.employee.managerName && ` · Manager: ${data.employee.managerName}`}
            </p>
          )}
        </div>
        {data.canResign && (
          <button type="button" onClick={() => setForm(true)} className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold cursor-pointer">
            <LogOut className="w-4 h-4" /> Resign
          </button>
        )}
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
          <Mail className="w-4 h-4 shrink-0 mt-0.5" /> <span>{notice}</span>
        </div>
      )}

      {!data.employee ? (
        <div className="p-10 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200">Your login is not linked to an employee record.</div>
      ) : !active && !exit ? (
        <div className="p-10 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
          <p className="text-sm font-semibold text-slate-800">You have no resignation in progress.</p>
          <p className="text-xs text-slate-500">If you decide to leave, use the Resign button. HR and your manager will be notified by email.</p>
          {res?.status === 'WITHDRAWN' && <p className="text-[11px] text-slate-400">Your last resignation was withdrawn on {fmt(res.withdrawnOn)}.</p>}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Progress</h3>
            <ol className="space-y-3">
              {steps.map((s, i) => {
                const current = !s.done && steps.slice(0, i).every((p) => p.done);
                return (
                  <li key={s.label} className="flex items-center gap-3 text-xs">
                    {s.done ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <Clock className={`w-5 h-5 ${current ? 'text-amber-500' : 'text-slate-300'}`} />}
                    <span className={s.done ? 'font-semibold text-slate-900' : current ? 'font-semibold text-amber-700' : 'text-slate-400'}>{s.label}</span>
                    {s.when && <span className="text-[11px] text-slate-400">{fmt(s.when)}</span>}
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {active && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-2 text-xs">
                <h3 className="font-bold text-slate-900">Your resignation</h3>
                <p className="text-slate-600">Submitted {fmt(active.submittedOn)} · proposed last day <strong>{fmt(active.proposedLastWorkingDay)}</strong></p>
                <p className="text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{active.reason}</p>
                {active.status === 'SUBMITTED' && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('Withdraw your resignation?')) return;
                      try {
                        await modulesService.withdrawResignation(active._id);
                        setNotice('Your resignation was withdrawn. HR and your manager have been notified.');
                        load();
                      } catch (err: any) {
                        setError(err?.message || 'Could not withdraw.');
                      }
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Withdraw resignation
                  </button>
                )}
              </div>
            )}
            {exit && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3 text-xs">
                <h3 className="font-bold text-slate-900">Exit details</h3>
                <p className="text-slate-600">
                  Last working day <strong>{fmt(exit.lastWorkingDay)}</strong> · notice {exit.noticeServedDays} of {exit.noticePeriodDays} days
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {CLEARANCE_LABELS.map(([k, label]) => (
                    <div key={k} className={`p-2.5 rounded-lg border ${exit.clearances?.[k]?.cleared ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>
                      <p className="font-semibold">{label}</p>
                      <p className="text-[10px]">{exit.clearances?.[k]?.cleared ? 'Cleared' : 'Pending'}</p>
                    </div>
                  ))}
                </div>
                {exit.fnf && <p className="text-emerald-700 font-semibold">Your Full & Final settlement has started. Finance will contact you about the payout.</p>}
              </div>
            )}
          </div>
        </>
      )}

      {form && (
        <ResignForm
          onClose={() => setForm(false)}
          onDone={(emails) => {
            setForm(false);
            setNotice(emails.length ? `Resignation submitted. Email sent to ${emails.join(', ')}.` : 'Resignation submitted. HR and your manager have been notified in the app.');
            load();
          }}
        />
      )}
    </div>
  );
};
