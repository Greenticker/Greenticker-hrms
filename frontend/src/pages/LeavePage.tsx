import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { leaveService, BalanceRow, LeaveRequestItem, LeaveSettings, LeaveType, YearEndRow, ApplyInput } from '../services/leaveService';
import { employeeService } from '../services/employeeService';
import { Employee } from '../types/employee';
import { apiErrorMessages, canWriteMaster, isReadOnlyRole } from '../utils/access';
import { ChevronLeft, ChevronRight, Lock, Plus, Settings2, Users, X } from 'lucide-react';

type Tab = 'mine' | 'approvals' | 'calendar' | 'all' | 'settings';

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
};
const inputCls = 'w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/25';
const btn = (tone: string) => `px-3 py-1.5 rounded-lg font-semibold text-xs cursor-pointer disabled:opacity-50 ${tone}`;
const today = () => new Date().toISOString().slice(0, 10);
const LEAVE_READ_ALL = ['ADMIN', 'SUPER_ADMIN', 'ADMIN_1', 'HR', 'ADMIN_2', 'AUDITORS'];

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className={`bg-white rounded-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'} w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto`}>
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const Errors: React.FC<{ list: string[] }> = ({ list }) =>
  list.length ? (
    <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
      {list.length === 1 ? list[0] : <ul className="list-disc pl-4">{list.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
  ) : null;

export const LeavePage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role || 'EMPLOYEE';
  const isHr = canWriteMaster(role);
  const seesAll = LEAVE_READ_ALL.includes(role);
  const readOnly = isReadOnlyRole(role);

  const [tab, setTab] = useState<Tab>('mine');
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [settings, setSettings] = useState<LeaveSettings | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [mine, setMine] = useState<LeaveRequestItem[]>([]);
  const [approvals, setApprovals] = useState<LeaveRequestItem[]>([]);
  const [allReqs, setAllReqs] = useState<LeaveRequestItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = (text: string, ok = true) => {
    setNotice({ ok, text });
    window.setTimeout(() => setNotice(null), 7000);
  };

  const load = async () => {
    leaveService.getTypes().then((r) => { setTypes(r.types); setSettings(r.settings); }).catch(() => {});
    leaveService.getRequests('mine').then((r) => { setMine(r.requests); setBalances(r.balances); }).catch(() => {});
    leaveService.getRequests('approvals', 'PENDING').then((r) => setApprovals(r.requests)).catch(() => setApprovals([]));
    if (seesAll) leaveService.getRequests('all').then((r) => setAllReqs(r.requests)).catch(() => {});
  };
  useEffect(() => {
    load();
    if (isHr) employeeService.getEmployees().then((r) => setEmployees(r.employees)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- apply / edit
  const emptyForm: ApplyInput & { _editId?: string } = { leaveType: 'CL', startDate: today(), endDate: today(), isHalfDay: false, halfDaySession: 'FIRST_HALF', reason: '', convertExcessToLop: false };
  const [form, setForm] = useState<(ApplyInput & { _editId?: string }) | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const selectedType = types.find((t) => t.code === form?.leaveType);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setErrors([]);
    const { _editId, ...data } = form;
    if (data.isHalfDay) data.endDate = data.startDate;
    try {
      if (_editId) {
        await leaveService.edit(_editId, data);
        flash('Leave changed. It has gone back to your manager for approval.');
      } else {
        await leaveService.apply(data);
        flash('Leave applied and sent for approval.');
      }
      setForm(null);
      load();
    } catch (err: any) {
      setErrors(apiErrorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- decide
  const [deciding, setDeciding] = useState<{ req: LeaveRequestItem; status: 'APPROVED' | 'REJECTED' | 'CANCELLED' } | null>(null);
  const [comment, setComment] = useState('');
  const decide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deciding) return;
    setBusy(true);
    setErrors([]);
    try {
      await leaveService.decide(deciding.req._id, deciding.status, comment.trim() || undefined);
      flash(`Leave ${deciding.status.toLowerCase()}.`);
      setDeciding(null);
      load();
    } catch (err: any) {
      setErrors(apiErrorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- delegate
  const [delegate, setDelegate] = useState<{ delegateId: string; delegateName: string; from: string; until: string } | null>(null);
  const [delegateForm, setDelegateForm] = useState<{ delegateId: string; from: string; until: string } | null>(null);
  const [delegateOptions, setDelegateOptions] = useState<Employee[]>([]);
  useEffect(() => {
    leaveService.getDelegate().then((r) => setDelegate(r.delegate)).catch(() => {});
  }, []);
  const openDelegate = () => {
    setErrors([]);
    employeeService.getDirectory().then((r) => setDelegateOptions(r.employees as unknown as Employee[])).catch(() => {});
    setDelegateForm({ delegateId: delegate?.delegateId || '', from: delegate?.from || today(), until: delegate?.until || today() });
  };

  const requestRow = (r: LeaveRequestItem, showName: boolean) => (
    <div key={r._id} className="p-4 rounded-xl border border-slate-200 bg-white text-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {showName && <span className="font-bold text-slate-900 text-sm">{r.employeeName}</span>}
          <span className="font-semibold text-slate-800">{r.leaveTypeName}</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${STATUS_STYLE[r.status]}`}>{r.status}</span>
          {r.escalated && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Escalated (SLA)</span>}
        </div>
        <p className="text-slate-600">
          {r.startDate}
          {r.endDate !== r.startDate ? ` → ${r.endDate}` : ''} · {r.daysCount} day(s)
          {r.isHalfDay ? ` (${r.halfDaySession === 'SECOND_HALF' ? 'second' : 'first'} half)` : ''}
          {r.lopDays ? ` · ${r.lopDays} day(s) loss of pay` : ''}
        </p>
        <p className="text-slate-500">{r.reason}</p>
        <p className="text-[11px] text-slate-400">
          Approver: {r.approverName || 'HR'}
          {r.reviewedBy ? ` · ${r.status.toLowerCase()} by ${r.reviewedBy}` : ''}
          {r.reviewComment || r.rejectionReason ? ` · "${r.reviewComment || r.rejectionReason}"` : ''}
          {r.appliedOnBehalfBy ? ` · applied by ${r.appliedOnBehalfBy}` : ''}
        </p>
      </div>
      {!readOnly && (
        <div className="flex gap-2 shrink-0">
          {r.canDecide && (
            <>
              <button onClick={() => { setComment(''); setErrors([]); setDeciding({ req: r, status: 'APPROVED' }); }} className={btn('bg-emerald-600 hover:bg-emerald-700 text-white')}>
                Approve
              </button>
              <button onClick={() => { setComment(''); setErrors([]); setDeciding({ req: r, status: 'REJECTED' }); }} className={btn('bg-white border border-rose-200 text-rose-700 hover:bg-rose-50')}>
                Reject
              </button>
            </>
          )}
          {r.canEdit && (
            <button
              onClick={() => {
                setErrors([]);
                setForm({ _editId: r._id, leaveType: r.leaveType, startDate: r.startDate, endDate: r.endDate, isHalfDay: r.isHalfDay, halfDaySession: r.halfDaySession || 'FIRST_HALF', reason: r.reason });
              }}
              className={btn('bg-white border border-slate-300 text-slate-700 hover:bg-slate-50')}
            >
              Change
            </button>
          )}
          {r.canCancel && (
            <button onClick={() => { setComment(''); setErrors([]); setDeciding({ req: r, status: 'CANCELLED' }); }} className={btn('bg-white border border-slate-300 text-slate-700 hover:bg-slate-50')}>
              Cancel leave
            </button>
          )}
        </div>
      )}
    </div>
  );

  const tabs: [Tab, string, boolean][] = [
    ['mine', 'My Leave', !!user?.employeeId || !!user?.employee],
    ['approvals', `Approvals (${approvals.length})`, approvals.length > 0 || role === 'MANAGER' || isHr],
    ['calendar', 'Team Calendar', true],
    ['all', 'All Requests', seesAll],
    ['settings', 'Leave Settings', isHr || role === 'AUDITORS'],
  ];

  return (
    <div className="space-y-6">
      <div className="bg-primary text-white p-6 rounded-2xl border border-accent/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leave Management</h1>
          <p className="text-xs text-slate-300 mt-1">Requests go to your reporting manager (or their delegate) for approval.</p>
        </div>
        {!readOnly && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={openDelegate} className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold text-xs cursor-pointer">
              {delegate ? `Delegate: ${delegate.delegateName}` : 'Set approval delegate'}
            </button>
            <button onClick={() => { setErrors([]); setForm({ ...emptyForm, leaveType: types.find((t) => t.active)?.code || 'CL' }); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs cursor-pointer">
              <Plus className="w-4 h-4" /> Apply for leave
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div role="status" className={`p-4 rounded-xl border text-sm flex justify-between ${notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {tabs.filter(([, , show]) => show).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${tab === id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'mine' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {balances.map((b) => (
              <div key={b.code} className="bg-white p-4 rounded-xl border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">{b.name}</p>
                <p className="text-2xl font-black text-slate-900 font-mono mt-1">{b.paid ? b.available : b.used}</p>
                <p className="text-[10px] text-slate-400">
                  {b.paid ? `available of ${b.total} · used ${b.used}${b.pending ? ` · pending ${b.pending}` : ''}` : 'days taken'}
                </p>
                {b.nextExpiry && <p className="text-[10px] text-amber-700 font-semibold">next expiry {b.nextExpiry}</p>}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {mine.length === 0 ? <p className="text-xs text-slate-400 bg-white p-8 rounded-xl border border-slate-200 text-center">No leave applied yet.</p> : mine.map((r) => requestRow(r, false))}
          </div>
        </div>
      )}

      {tab === 'approvals' && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Requests from your team (directly or as a delegate / escalation). Your own leave goes to your manager.
          </p>
          {approvals.length === 0 ? <p className="text-xs text-slate-400 bg-white p-8 rounded-xl border border-slate-200 text-center">Nothing waiting for your approval.</p> : approvals.map((r) => requestRow(r, true))}
        </div>
      )}

      {tab === 'calendar' && <TeamCalendar />}

      {tab === 'all' && seesAll && (
        <div className="space-y-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status" className="text-xs p-2 bg-white border border-slate-200 rounded-xl">
            {['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : s}</option>)}
          </select>
          {allReqs.filter((r) => statusFilter === 'ALL' || r.status === statusFilter).map((r) => requestRow(r, true))}
        </div>
      )}

      {tab === 'settings' && <LeaveSettingsPanel types={types} settings={settings} employees={employees} canEdit={isHr} onSaved={load} flash={flash} />}

      {/* ---------------- apply / change */}
      {form && (
        <Modal title={form._editId ? 'Change leave' : 'Apply for leave'} onClose={() => setForm(null)}>
          <form onSubmit={submit} className="space-y-3 text-xs">
            {form._editId && <p className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">Changing an approved leave sends it back to your manager for fresh approval.</p>}
            {isHr && !form._editId && (
              <label className="block">
                <span className="font-semibold text-slate-700">For employee</span>
                <select value={form.targetEmployeeId || ''} onChange={(e) => setForm({ ...form, targetEmployeeId: e.target.value || undefined })} className={inputCls}>
                  <option value="">Myself</option>
                  {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="font-semibold text-slate-700">Leave type *</span>
              <select value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })} className={inputCls}>
                {types.filter((t) => t.active).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
            </label>
            {selectedType?.allowHalfDay && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!form.isHalfDay} onChange={(e) => setForm({ ...form, isHalfDay: e.target.checked })} /> Half day
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-semibold text-slate-700">{form.isHalfDay ? 'Date *' : 'From *'}</span>
                <input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} className={inputCls} />
              </label>
              {form.isHalfDay ? (
                <label className="block">
                  <span className="font-semibold text-slate-700">Session *</span>
                  <select value={form.halfDaySession} onChange={(e) => setForm({ ...form, halfDaySession: e.target.value })} className={inputCls}>
                    <option value="FIRST_HALF">First half</option>
                    <option value="SECOND_HALF">Second half</option>
                  </select>
                </label>
              ) : (
                <label className="block">
                  <span className="font-semibold text-slate-700">To *</span>
                  <input type="date" required min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputCls} />
                </label>
              )}
            </div>
            <label className="block">
              <span className="font-semibold text-slate-700">Reason *</span>
              <textarea required rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls} />
            </label>
            {selectedType?.paid && (
              <label className="flex items-center gap-2 cursor-pointer text-slate-600">
                <input type="checkbox" checked={!!form.convertExcessToLop} onChange={(e) => setForm({ ...form, convertExcessToLop: e.target.checked })} />
                If my balance is not enough, apply the extra days as loss of pay
              </label>
            )}
            {selectedType && (
              <p className="text-[11px] text-slate-400">
                {selectedType.sandwich ? 'Weekends / holidays between leave days are counted (sandwich rule). ' : 'Weekends and holidays are not counted. '}
                Can be applied up to {selectedType.maxBackdatedDays} day(s) in the past.
              </p>
            )}
            <Errors list={errors} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className={btn('text-slate-600 hover:bg-slate-100')}>Cancel</button>
              <button type="submit" disabled={busy} className={btn('bg-slate-900 hover:bg-primary-hover text-white')}>{busy ? 'Submitting...' : form._editId ? 'Submit change' : 'Apply'}</button>
            </div>
          </form>
        </Modal>
      )}

      {deciding && (
        <Modal title={deciding.status === 'APPROVED' ? 'Approve leave' : deciding.status === 'REJECTED' ? 'Reject leave' : 'Cancel leave'} onClose={() => setDeciding(null)}>
          <form onSubmit={decide} className="space-y-3 text-xs">
            <p className="text-slate-600">
              {deciding.req.employeeName}: {deciding.req.leaveTypeName}, {deciding.req.startDate} → {deciding.req.endDate} ({deciding.req.daysCount} day(s))
            </p>
            <label className="block">
              <span className="font-semibold text-slate-700">Comment{deciding.status === 'REJECTED' ? ' *' : ''}</span>
              <textarea rows={2} required={deciding.status === 'REJECTED'} value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
            </label>
            {deciding.status === 'CANCELLED' && <p className="text-slate-500">Approved days return to your balance and your manager is notified.</p>}
            <Errors list={errors} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeciding(null)} className={btn('text-slate-600 hover:bg-slate-100')}>Back</button>
              <button type="submit" disabled={busy} className={btn(deciding.status === 'APPROVED' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white')}>
                {deciding.status === 'APPROVED' ? 'Approve' : deciding.status === 'REJECTED' ? 'Reject' : 'Cancel leave'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {delegateForm && (
        <Modal title="Approval delegate" onClose={() => setDelegateForm(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setErrors([]);
              try {
                await leaveService.setDelegate(delegateForm.delegateId ? delegateForm : {});
                const r = await leaveService.getDelegate();
                setDelegate(r.delegate);
                setDelegateForm(null);
                flash(delegateForm.delegateId ? 'Delegate saved. They can approve your team’s leave in that period.' : 'Delegate removed.');
              } catch (err: any) {
                setErrors(apiErrorMessages(err));
              }
            }}
            className="space-y-3 text-xs"
          >
            <p className="text-slate-500">While you are away, this colleague can approve leave requests that come to you.</p>
            <select value={delegateForm.delegateId} onChange={(e) => setDelegateForm({ ...delegateForm, delegateId: e.target.value })} aria-label="Delegate" className={inputCls}>
              <option value="">No delegate</option>
              {delegateOptions.filter((e) => e._id !== (user?.employee?._id || user?.employeeId)).map((e) => (
                <option key={e._id} value={e._id}>{e.firstName} {e.lastName} · {e.designation}</option>
              ))}
            </select>
            {delegateForm.delegateId && (
              <div className="grid grid-cols-2 gap-3">
                <input type="date" aria-label="From" value={delegateForm.from} onChange={(e) => setDelegateForm({ ...delegateForm, from: e.target.value })} className={inputCls} />
                <input type="date" aria-label="Until" value={delegateForm.until} onChange={(e) => setDelegateForm({ ...delegateForm, until: e.target.value })} className={inputCls} />
              </div>
            )}
            <p className="text-[11px] text-slate-400">Requests not handled within {settings?.slaDays ?? 3} day(s) also escalate to your own manager.</p>
            <Errors list={errors} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDelegateForm(null)} className={btn('text-slate-600 hover:bg-slate-100')}>Cancel</button>
              <button type="submit" className={btn('bg-primary text-white')}>Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

// ==================================================================== team calendar

const TeamCalendar: React.FC = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Awaited<ReturnType<typeof leaveService.getCalendar>> | null>(null);
  useEffect(() => {
    leaveService.getCalendar(month).then(setData).catch(() => setData(null));
  }, [month]);
  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const n = new Date(y, m, 0).getDate();
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  }, [month]);
  const shift = (d: number) => {
    const [y, m] = month.split('-').map(Number);
    const dt = new Date(y, m - 1 + d, 1);
    setMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  };
  if (!data) return <p className="text-xs text-slate-400">Loading calendar...</p>;
  const cell = (emp: string, day: string) => data.entries.find((e) => e.employeeId === emp && e.startDate <= day && day <= e.endDate);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 overflow-x-auto">
      <div className="flex items-center gap-3 text-xs">
        <button onClick={() => shift(-1)} aria-label="Previous month" className="p-1 rounded hover:bg-slate-100 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
        <span className="font-bold text-slate-900">{month}</span>
        <button onClick={() => shift(1)} aria-label="Next month" className="p-1 rounded hover:bg-slate-100 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
        <span className="text-slate-500">{data.scope === 'ALL' ? 'Everyone' : data.scope === 'TEAM' ? 'Your team only' : 'Your own leave'}</span>
      </div>
      <table className="text-[10px] border-collapse">
        <thead>
          <tr>
            <th className="text-left pr-3 py-1 sticky left-0 bg-white">Employee</th>
            {days.map((d) => (
              <th key={d} className={`w-6 text-center ${data.holidays[d] ? 'text-rose-600' : 'text-slate-400'}`} title={data.holidays[d]}>{d.slice(-2)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.people.map(([id, name]) => (
            <tr key={id} className="border-t border-slate-100">
              <td className="pr-3 py-1 whitespace-nowrap font-semibold text-slate-700 sticky left-0 bg-white">{name}</td>
              {days.map((d) => {
                const e = cell(id, d);
                return (
                  <td key={d} title={e ? `${e.leaveType} (${e.status.toLowerCase()})` : ''} className={`w-6 h-6 text-center ${e ? (e.status === 'APPROVED' ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-100 text-amber-800') : ''}`}>
                    {e ? e.leaveType.slice(0, 2) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-slate-400">Green = approved, amber = pending. Red dates are holidays.</p>
    </div>
  );
};

// ==================================================================== HR settings

const LeaveSettingsPanel: React.FC<{
  types: LeaveType[];
  settings: LeaveSettings | null;
  employees: Employee[];
  canEdit: boolean;
  onSaved: () => void;
  flash: (t: string, ok?: boolean) => void;
}> = ({ types, settings, employees, canEdit, onSaved, flash }) => {
  const [editing, setEditing] = useState<Partial<LeaveType> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [adjust, setAdjust] = useState({ employeeId: '', leaveType: 'CL', days: '', reason: '' });
  const [yearEnd, setYearEnd] = useState<{ rows: YearEndRow[]; totals: Record<string, number>; dryRun: boolean } | null>(null);
  const [payoutMonth, setPayoutMonth] = useState(new Date().toISOString().slice(0, 7));
  const [sla, setSla] = useState(String(settings?.slaDays ?? 3));

  const saveType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setErrors([]);
    try {
      await leaveService.saveType(editing, editing._id);
      setEditing(null);
      onSaved();
      flash('Leave type saved.');
    } catch (err: any) {
      setErrors(apiErrorMessages(err));
    }
  };

  const num = (k: keyof LeaveType, label: string) => (
    <label className="block">
      <span className="font-semibold text-slate-700">{label}</span>
      <input type="number" min={0} value={(editing as any)?.[k] ?? 0} onChange={(e) => setEditing({ ...editing!, [k]: Number(e.target.value) })} className={inputCls} />
    </label>
  );
  const flag = (k: keyof LeaveType, label: string) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={!!(editing as any)?.[k]} onChange={(e) => setEditing({ ...editing!, [k]: e.target.checked })} /> {label}
    </label>
  );

  return (
    <div className="space-y-6 text-xs">
      {!canEdit && (
        <p className="text-slate-500 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Read-only view of the leave rules.</p>
      )}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <div className="p-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Settings2 className="w-4 h-4" /> Leave types and rules</h3>
          {canEdit && (
            <button onClick={() => { setErrors([]); setEditing({ code: '', name: '', annualEntitlement: 0, carryForwardMax: 0, encashable: false, encashMax: 0, allowHalfDay: true, maxBackdatedDays: 7, gender: 'ANY', minServiceDays: 0, sandwich: false, excessPolicy: 'BLOCK', paid: true, active: true }); }} className={btn('bg-primary text-white')}>
              Add leave type
            </button>
          )}
        </div>
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500">
            <tr>
              {['Type', 'Per year', 'Carry fwd', 'Encash', 'Half day', 'Backdate', 'Eligibility', 'Sandwich', 'Over balance', ''].map((h) => <th key={h} className="py-2 px-3">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {types.map((t) => (
              <tr key={t._id} className={t.active ? '' : 'opacity-50'}>
                <td className="py-2 px-3 font-semibold">{t.code} · {t.name}{t.paid ? '' : ' (unpaid)'}</td>
                <td className="py-2 px-3 font-mono">{t.annualEntitlement}</td>
                <td className="py-2 px-3 font-mono">{t.carryForwardMax}</td>
                <td className="py-2 px-3">{t.encashable ? `up to ${t.encashMax}` : 'No'}</td>
                <td className="py-2 px-3">{t.allowHalfDay ? 'Yes' : 'No'}</td>
                <td className="py-2 px-3">{t.maxBackdatedDays}d</td>
                <td className="py-2 px-3">{t.gender !== 'ANY' ? `${t.gender.toLowerCase()} · ` : ''}{t.minServiceDays ? `${t.minServiceDays}d service` : 'all'}</td>
                <td className="py-2 px-3">{t.sandwich ? 'Yes' : 'No'}</td>
                <td className="py-2 px-3">{t.excessPolicy === 'LOP' ? 'Loss of pay' : 'Blocked'}</td>
                <td className="py-2 px-3">{canEdit && <button onClick={() => { setErrors([]); setEditing(t); }} className="text-indigo-700 hover:underline cursor-pointer">Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Adjust an employee's balance</h3>
            <p className="text-slate-500">Logged with your name and reason. You cannot adjust your own balance.</p>
            <select value={adjust.employeeId} onChange={(e) => setAdjust({ ...adjust, employeeId: e.target.value })} aria-label="Employee" className={inputCls}>
              <option value="">Select employee...</option>
              {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select value={adjust.leaveType} onChange={(e) => setAdjust({ ...adjust, leaveType: e.target.value })} aria-label="Leave type" className={inputCls}>
                {types.filter((t) => t.paid).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
              <input type="number" step="0.5" placeholder="Days (+/-)" value={adjust.days} onChange={(e) => setAdjust({ ...adjust, days: e.target.value })} aria-label="Days" className={inputCls} />
            </div>
            <input placeholder="Reason *" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} aria-label="Reason" className={inputCls} />
            <button
              disabled={!adjust.employeeId || !adjust.days || !adjust.reason.trim()}
              onClick={async () => {
                try {
                  await leaveService.adjust(adjust.employeeId, { leaveType: adjust.leaveType, days: Number(adjust.days), reason: adjust.reason });
                  flash('Balance adjusted.');
                  setAdjust({ employeeId: '', leaveType: adjust.leaveType, days: '', reason: '' });
                } catch (err: any) {
                  flash(err.message, false);
                }
              }}
              className={btn('bg-primary text-white')}
            >
              Save adjustment
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Year-end process</h3>
            <p className="text-slate-500">Carries forward, encashes (paid through payroll) and lapses balances as per each type's rules, then resets entitlements.</p>
            {settings?.lastYearEnd && <p className="text-slate-400">Last run {settings.lastYearEnd.on.slice(0, 10)} by {settings.lastYearEnd.by}.</p>}
            <label className="flex items-center gap-2">Encashment paid in <input type="month" value={payoutMonth} onChange={(e) => setPayoutMonth(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1" /></label>
            <div className="flex gap-2">
              <button onClick={async () => setYearEnd(await leaveService.yearEnd({ dryRun: true, payoutMonth }))} className={btn('bg-white border border-slate-300')}>Preview</button>
              <button
                onClick={async () => {
                  if (!window.confirm('Run the year-end process now? Balances are reset for the new year.')) return;
                  try {
                    setYearEnd(await leaveService.yearEnd({ dryRun: false, payoutMonth }));
                    flash('Year-end processed. Encashment sent to payroll.');
                    onSaved();
                  } catch (err: any) {
                    flash(err.message, false);
                  }
                }}
                className={btn('bg-primary text-white')}
              >
                Run year-end
              </button>
            </div>
            {yearEnd && (
              <p className="text-slate-700">
                {yearEnd.dryRun ? 'Preview' : 'Done'}: carry forward {yearEnd.totals.carryForward} days, encash {yearEnd.totals.encash} days (₹{Math.round(yearEnd.totals.encashAmount).toLocaleString('en-IN')}), lapse {yearEnd.totals.lapse} days.
              </p>
            )}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <span>Approval SLA (days before escalation)</span>
              <input type="number" min={1} value={sla} onChange={(e) => setSla(e.target.value)} aria-label="SLA days" className="w-16 rounded-lg border border-slate-300 px-2 py-1" />
              <button onClick={async () => { await leaveService.saveSettings({ slaDays: Number(sla) }); flash('SLA saved.'); onSaved(); }} className={btn('bg-white border border-slate-300')}>Save</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <Modal title={editing._id ? `Edit ${editing.code}` : 'New leave type'} onClose={() => setEditing(null)} wide>
          <form onSubmit={saveType} className="space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="block"><span className="font-semibold text-slate-700">Code *</span><input required disabled={!!editing._id} value={editing.code || ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} className={inputCls} /></label>
              <label className="block sm:col-span-3"><span className="font-semibold text-slate-700">Name *</span><input required value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} /></label>
              {num('annualEntitlement', 'Days per year')}
              {num('carryForwardMax', 'Max carry forward')}
              {num('encashMax', 'Max encashment days')}
              {num('maxBackdatedDays', 'Backdating allowed (days)')}
              {num('minServiceDays', 'Min. service (days)')}
              <label className="block">
                <span className="font-semibold text-slate-700">Gender</span>
                <select value={editing.gender || 'ANY'} onChange={(e) => setEditing({ ...editing, gender: e.target.value as LeaveType['gender'] })} className={inputCls}>
                  <option value="ANY">Any</option><option value="FEMALE">Female</option><option value="MALE">Male</option>
                </select>
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Beyond balance</span>
                <select value={editing.excessPolicy || 'BLOCK'} onChange={(e) => setEditing({ ...editing, excessPolicy: e.target.value as LeaveType['excessPolicy'] })} className={inputCls}>
                  <option value="BLOCK">Block</option><option value="LOP">Convert to loss of pay</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-4">
              {flag('paid', 'Paid leave')}
              {flag('encashable', 'Encashable')}
              {flag('allowHalfDay', 'Half day allowed')}
              {flag('sandwich', 'Sandwich rule (count weekends / holidays in between)')}
              {flag('active', 'Active')}
            </div>
            <div className="flex flex-wrap gap-4">
              <span className="font-semibold text-slate-700">Employment types:</span>
              {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(editing.employmentTypes || ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).includes(t)}
                    onChange={() => {
                      const cur = editing.employmentTypes || ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'];
                      setEditing({ ...editing, employmentTypes: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] });
                    }}
                  />
                  {t.replace('_', ' ').toLowerCase()}
                </label>
              ))}
            </div>
            <Errors list={errors} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className={btn('text-slate-600 hover:bg-slate-100')}>Cancel</button>
              <button type="submit" className={btn('bg-primary text-white')}>Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

