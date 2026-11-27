import React, { useEffect, useMemo, useState } from 'react';
import { modulesService } from '../services/modulesService';
import { FullFinalSettlement } from '../types/modules';
import { CheckCircle2, Clock, Wallet, Banknote, Landmark, AlertCircle, Calculator, Sparkles, X, UserX } from 'lucide-react';

const inr = (n: number | undefined) => `${(n || 0) < 0 ? '−' : ''}₹${Math.abs(n || 0).toLocaleString('en-IN')}`;
const fmt = (iso?: string) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

type Components = FullFinalSettlement['settlementComponents'];
type PayoutState = 'PAID' | 'PREPARED' | 'READY' | 'BLOCKED';

/** Paid; figures saved and ready to pay; exit approved and figures to prepare; or exit still in progress. */
const payoutState = (f: FullFinalSettlement): PayoutState => {
  if (f.status === 'DISBURSED') return 'PAID';
  if (f.status === 'HR_APPROVED') return f.fnf?.status === 'SETTLEMENT_PREPARED' ? 'PREPARED' : 'READY';
  return 'BLOCKED';
};

const PAYOUT_BADGE: Record<PayoutState, { label: string; className: string }> = {
  PAID: { label: 'Paid', className: 'bg-emerald-50 text-emerald-800' },
  PREPARED: { label: 'Ready to pay', className: 'bg-sky-50 text-sky-800' },
  READY: { label: 'Settlement to prepare', className: 'bg-indigo-50 text-indigo-800' },
  BLOCKED: { label: 'Exit in progress', className: 'bg-amber-50 text-amber-800' },
};

const total = (c: Components) =>
  (c.unpaidSalary || 0) + (c.leaveEncashmentAmount || 0) + (c.gratuity || 0) + (c.bonusOrIncentive || 0) -
  (c.noticePayShortfallDeduction || 0) - (c.otherDeductions || 0);

const FIELDS: { key: keyof Components; label: string; kind: 'earning' | 'deduction' | 'days' }[] = [
  { key: 'unpaidSalary', label: 'Unpaid salary (final month)', kind: 'earning' },
  { key: 'leaveEncashmentDays', label: 'Leave encashment days', kind: 'days' },
  { key: 'leaveEncashmentAmount', label: 'Leave encashment amount', kind: 'earning' },
  { key: 'gratuity', label: 'Gratuity', kind: 'earning' },
  { key: 'bonusOrIncentive', label: 'Bonus / incentive', kind: 'earning' },
  { key: 'noticePayShortfallDeduction', label: 'Notice shortfall recovery', kind: 'deduction' },
  { key: 'otherDeductions', label: 'Other deductions', kind: 'deduction' },
];

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl flex flex-col max-h-[90vh]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="overflow-y-auto">{children}</div>
    </div>
  </div>
);

const SettlementForm: React.FC<{ fnf: FullFinalSettlement; onClose: () => void; onSaved: (s: FullFinalSettlement) => void }> = ({ fnf, onClose, onSaved }) => {
  const [values, setValues] = useState<Components>({ ...fnf.settlementComponents, otherDeductions: fnf.settlementComponents.otherDeductions || 0 });
  const [note, setNote] = useState(fnf.settlementComponents.otherDeductionsNote || '');
  const [basis, setBasis] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const net = total(values);

  const suggest = async () => {
    setError(null);
    try {
      const res = await modulesService.getSettlementSuggestion(fnf._id);
      setBasis(res.basis);
      if (res.components) setValues({ ...res.components, bonusOrIncentive: values.bonusOrIncentive || 0, otherDeductions: values.otherDeductions || 0 });
    } catch (err: any) {
      setError(err?.message || 'Could not work out suggested figures.');
    }
  };

  return (
    <Modal title={`Settlement — ${fnf.employeeName}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await modulesService.saveSettlement(fnf._id, { ...values, otherDeductionsNote: note.trim() });
            onSaved(res.settlement);
          } catch (err: any) {
            setError(err?.message || 'Could not save the settlement.');
            setBusy(false);
          }
        }}
        className="p-6 space-y-4"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-600">
            Last working day {fmt(fnf.lastWorkingDay)} · notice {fnf.noticeServedDays} of {fnf.noticePeriodDays} days
          </p>
          <button type="button" onClick={suggest} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-primary/30 text-primary hover:bg-primary-hover/5 cursor-pointer">
            <Sparkles className="w-3.5 h-3.5" /> Suggest figures
          </button>
        </div>
        {basis.length > 0 && (
          <ul className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-3 space-y-1 list-disc pl-5">
            {basis.map((b) => <li key={b}>{b}</li>)}
            <li className="list-none -ml-5 text-slate-400">Suggestions only. Check against payroll and your policies before saving.</li>
          </ul>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`fnf-${f.key}`} className="block text-xs font-semibold text-slate-700">
                {f.label} {f.kind === 'deduction' && <span className="text-rose-600">(−)</span>}
              </label>
              <input
                id={`fnf-${f.key}`}
                type="number"
                min={0}
                step={f.kind === 'days' ? 1 : 'any'}
                value={(values[f.key] as number) ?? 0}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: Math.max(0, Number(e.target.value) || 0) }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
              />
            </div>
          ))}
        </div>
        {(values.otherDeductions || 0) > 0 && (
          <div>
            <label htmlFor="fnf-note" className="block text-xs font-semibold text-slate-700">What are the other deductions for? *</label>
            <input id="fnf-note" required value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" placeholder="e.g. Unreturned charger" />
          </div>
        )}
        <div className={`p-3 rounded-xl flex justify-between items-center ${net < 0 ? 'bg-rose-50 border border-rose-200' : 'bg-emerald-50 border border-emerald-200'}`}>
          <span className="text-xs font-bold text-slate-800">{net < 0 ? 'Net recoverable from employee' : 'Net payable'}</span>
          <span className={`text-lg font-black font-mono ${net < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{inr(net)}</span>
        </div>
        {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
          <button type="submit" disabled={busy} className="px-4 py-2 text-xs font-bold text-white bg-primary hover:bg-navy rounded-lg cursor-pointer disabled:opacity-50">
            {busy ? 'Saving...' : 'Save settlement'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const PaidForm: React.FC<{ fnf: FullFinalSettlement; onClose: () => void; onPaid: (s: FullFinalSettlement, emails: string[]) => void }> = ({ fnf, onClose, onPaid }) => {
  const today = new Date();
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`Mark as paid — ${fnf.employeeName}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await modulesService.disburseSettlement(fnf._id, reference.trim(), paidOn);
            onPaid(res.settlement, res.emails.map((m) => m.email));
          } catch (err: any) {
            setError(err?.message || 'Could not mark as paid.');
            setBusy(false);
          }
        }}
        className="p-6 space-y-4"
      >
        <p className="text-xs text-slate-600">
          Net amount <strong className="text-slate-900">{inr(fnf.settlementComponents.totalPayable)}</strong>. The employee is emailed and the
          settlement is locked.
        </p>
        <div>
          <label htmlFor="fnf-ref" className="block text-xs font-semibold text-slate-700">Payment reference *</label>
          <input id="fnf-ref" required value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono" placeholder="Bank UTR / transaction ID" />
        </div>
        <div>
          <label htmlFor="fnf-paid-on" className="block text-xs font-semibold text-slate-700">Paid on *</label>
          <input id="fnf-paid-on" type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
        </div>
        {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
          <button type="submit" disabled={busy || !reference.trim()} className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer disabled:opacity-50">
            {busy ? 'Saving...' : 'Mark as paid'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const FullFinalPage: React.FC = () => {
  const [settlements, setSettlements] = useState<FullFinalSettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FullFinalSettlement | null>(null);
  const [paying, setPaying] = useState<FullFinalSettlement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const fetchFnF = async () => {
      setLoading(true);
      try {
        const res = await modulesService.getFullFinalSettlements();
        setSettlements(res.settlements);
      } catch (err: any) {
        console.error('Failed to load FnF records', err);
        setError(err?.message || 'Could not load settlement records.');
      } finally {
        setLoading(false);
      }
    };
    fetchFnF();
  }, []);

  const replace = (s: FullFinalSettlement) => setSettlements((prev) => prev.map((x) => (x._id === s._id ? s : x)));

  const totals = useMemo(() => {
    const sum = (pick: (f: FullFinalSettlement) => number, list = settlements) => list.reduce((acc, f) => acc + (pick(f) || 0), 0);
    const unpaid = settlements.filter((f) => payoutState(f) !== 'PAID');
    return {
      netPayable: sum((f) => f.settlementComponents?.totalPayable),
      pendingPayout: sum((f) => f.settlementComponents?.totalPayable, unpaid),
      pendingCount: unpaid.length,
      gratuity: sum((f) => f.settlementComponents?.gratuity),
      disbursed: settlements.length - unpaid.length,
    };
  }, [settlements]);

  const summaryTiles = [
    { label: 'Total Net Settlements', value: inr(totals.netPayable), icon: Wallet, tone: 'text-primary' },
    { label: `Pending Payout (${totals.pendingCount})`, value: inr(totals.pendingPayout), icon: Clock, tone: 'text-amber-600' },
    { label: 'Gratuity Liability', value: inr(totals.gratuity), icon: Landmark, tone: 'text-indigo-600' },
    { label: 'Settlements Paid', value: String(totals.disbursed), icon: Banknote, tone: 'text-emerald-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-primary text-white p-6 rounded-2xl border border-accent/30 shadow-xs">
        <h1 className="text-2xl font-bold tracking-tight text-white">Full and Final Settlement</h1>
        <p className="text-xs text-slate-200 mt-1">Settlements start when an exit gets final approval. Finance prepares the figures and records the payout.</p>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="cursor-pointer" aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

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
        <div className="py-12 text-center text-xs text-slate-400">Loading settlements...</div>
      ) : error ? (
        <div className="p-12 text-center text-xs text-rose-600 bg-white rounded-2xl border border-rose-200">{error}</div>
      ) : settlements.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">No settlements yet.</div>
      ) : (
        settlements.map((fnf) => {
          const c = fnf.settlementComponents;
          const state = payoutState(fnf);
          const badge = PAYOUT_BADGE[state];
          const earnings = [
            { label: 'Unpaid Days Salary', value: c.unpaidSalary },
            { label: `Leave Encashment (${c.leaveEncashmentDays} days)`, value: c.leaveEncashmentAmount },
            { label: 'Gratuity Payout', value: c.gratuity },
            { label: 'Bonus / Incentive', value: c.bonusOrIncentive },
          ];
          const grossEarnings = earnings.reduce((acc, e) => acc + (e.value || 0), 0);
          const deductions = (c.noticePayShortfallDeduction || 0) + (c.otherDeductions || 0);

          return (
            <div key={fnf._id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
                <div>
                  <span className="text-[10px] font-bold font-mono uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded">F&F • {fnf.employeeCode}</span>
                  <h2 className="text-lg font-bold text-slate-900 mt-1">Settlement Statement: {fnf.employeeName}</h2>
                  <p className="text-xs text-slate-500 font-mono">{fnf.department} • Last Working Day: {fnf.lastWorkingDay}</p>
                  {fnf.employeeDeactivatedOn && (
                    <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                      <UserX className="w-3.5 h-3.5" /> Marked exited and login disabled on {fmt(fnf.employeeDeactivatedOn)}
                    </p>
                  )}
                </div>
                <div className={`px-3 py-1.5 rounded-xl font-bold text-xs uppercase flex items-center gap-1.5 ${badge.className}`}>
                  {state === 'BLOCKED' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  {badge.label}
                </div>
              </div>

              {state === 'BLOCKED' ? (
                <p className="text-xs text-slate-500">The settlement starts once the exit gets final approval in Exit Management.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
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
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                      <h3 className="font-bold uppercase tracking-wider text-slate-500 text-[11px] mb-3">Deductions</h3>
                      <dl className="space-y-2 font-mono">
                        <div className="flex justify-between gap-3">
                          <dt className="text-slate-600 font-sans">Notice Pay Shortfall ({Math.max(0, fnf.noticePeriodDays - fnf.noticeServedDays)} days)</dt>
                          <dd className="font-semibold text-rose-700">− {inr(c.noticePayShortfallDeduction)}</dd>
                        </div>
                        {(c.otherDeductions || 0) > 0 && (
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-600 font-sans">Other: {c.otherDeductionsNote}</dt>
                            <dd className="font-semibold text-rose-700">− {inr(c.otherDeductions)}</dd>
                          </div>
                        )}
                        <div className="flex justify-between gap-3 pt-2 border-t border-slate-200">
                          <dt className="font-bold text-slate-800 font-sans">Total Deductions</dt>
                          <dd className="font-bold text-rose-700">− {inr(deductions)}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold uppercase text-slate-900">{state === 'PAID' ? 'Net Settlement Paid' : 'Net Settlement Payable'}</span>
                      {state === 'PAID' && fnf.fnf && (
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          Paid {fmt(fnf.fnf.paidOn)} · ref <span className="font-mono">{fnf.fnf.paymentReference}</span> · by {fnf.fnf.paidBy}
                        </p>
                      )}
                      {state === 'PREPARED' && fnf.fnf?.preparedBy && (
                        <p className="text-[11px] text-slate-600 mt-0.5">Prepared by {fnf.fnf.preparedBy} on {fmt(fnf.fnf.preparedOn)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-black text-emerald-600 font-mono">{inr(c.totalPayable)}</span>
                      {fnf.permissions?.canSettle && (
                        <button type="button" onClick={() => setEditing(fnf)} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer">
                          <Calculator className="w-3.5 h-3.5" /> {state === 'PREPARED' ? 'Edit figures' : 'Prepare settlement'}
                        </button>
                      )}
                      {fnf.permissions?.canDisburse && (
                        <button type="button" onClick={() => setPaying(fnf)} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer">
                          <Banknote className="w-3.5 h-3.5" /> Mark as paid
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })
      )}

      {editing && (
        <SettlementForm
          fnf={editing}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            replace(s);
            setEditing(null);
            setNotice(`Settlement for ${s.employeeName} saved. Net ${inr(s.settlementComponents.totalPayable)}.`);
          }}
        />
      )}
      {paying && (
        <PaidForm
          fnf={paying}
          onClose={() => setPaying(null)}
          onPaid={(s, emails) => {
            replace(s);
            setPaying(null);
            setNotice(`F&F of ${s.employeeName} marked as paid.${emails.length ? ` Email sent to ${emails.join(', ')}.` : ''}`);
          }}
        />
      )}
    </div>
  );
};
