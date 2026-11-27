import React, { useEffect, useState } from 'react';
import { request, api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { apiErrorMessages, canWriteMaster, isReadOnlyRole } from '../../utils/access';
import { Lock, Unlock, Upload, X } from 'lucide-react';

/**
 * Attendance requests (regularization / overtime / comp-off), manager approvals, the month
 * summary that feeds payroll, and HR tools (bulk upload, devices, lock / unlock, settings).
 */

type Kind = 'REGULARIZATION' | 'OVERTIME' | 'COMP_OFF';
interface AttRequest {
  _id: string;
  kind: Kind;
  employeeName: string;
  date: string;
  reason: string;
  checkInTime?: string;
  checkOutTime?: string;
  hours?: number;
  days?: number;
  amount?: number;
  expiresOn?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approverName: string;
  decidedBy?: string;
  comment?: string;
  canDecide: boolean;
}
interface SummaryRow {
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  absentDays: number;
  halfDays: number;
  lateMarks: number;
  lateDeductionDays: number;
  lopDays: number;
  approvedOvertimeHours: number;
}

const KIND_LABEL: Record<Kind, string> = { REGULARIZATION: 'Regularization (missed punch)', OVERTIME: 'Overtime', COMP_OFF: 'Comp-off' };
const STATUS_STYLE: Record<string, string> = { PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-emerald-100 text-emerald-800', REJECTED: 'bg-rose-100 text-rose-800' };
const inputCls = 'w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/25';
const btn = (tone: string) => `px-3 py-1.5 rounded-lg font-semibold text-xs cursor-pointer disabled:opacity-50 ${tone}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const ATT_ADMIN = ['ADMIN', 'SUPER_ADMIN', 'ADMIN_1', 'HR', 'ADMIN_2'];
const DEVICE_ADMIN = ['ADMIN', 'SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2'];

export const AttendanceWorkflow: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role || 'EMPLOYEE';
  const readOnly = isReadOnlyRole(role);
  const isHr = canWriteMaster(role);
  const [tab, setTab] = useState<'requests' | 'approvals' | 'summary' | 'tools'>('requests');
  const [mine, setMine] = useState<AttRequest[]>([]);
  const [approvals, setApprovals] = useState<AttRequest[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = (text: string, ok = true) => { setMsg({ ok, text }); window.setTimeout(() => setMsg(null), 7000); };

  const load = () => {
    request<{ requests: AttRequest[] }>('/attendance/requests?scope=mine').then((r) => setMine(r.requests)).catch(() => {});
    request<{ requests: AttRequest[] }>('/attendance/requests?scope=approvals').then((r) => setApprovals(r.requests)).catch(() => {});
  };
  useEffect(load, []);

  // raise
  const [form, setForm] = useState<{ kind: Kind; date: string; checkInTime: string; checkOutTime: string; hours: string; reason: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const raise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setErrors([]);
    try {
      await request('/attendance/requests', { method: 'POST', body: JSON.stringify({ ...form, hours: form.hours ? Number(form.hours) : undefined }) });
      setForm(null);
      flash('Request sent to your manager for approval.');
      load();
    } catch (err: any) {
      setErrors(apiErrorMessages(err));
    }
  };

  // decide
  const [deciding, setDeciding] = useState<{ r: AttRequest; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [comment, setComment] = useState('');
  const decide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deciding) return;
    setErrors([]);
    try {
      await request(`/attendance/requests/${deciding.r._id}/decide`, { method: 'POST', body: JSON.stringify({ decision: deciding.decision, comment }) });
      setDeciding(null);
      flash(`Request ${deciding.decision.toLowerCase()}.`);
      load();
    } catch (err: any) {
      setErrors(apiErrorMessages(err));
    }
  };

  const row = (r: AttRequest, showName: boolean) => (
    <div key={r._id} className="p-3.5 rounded-xl border border-slate-200 bg-white text-xs flex flex-col md:flex-row md:items-center justify-between gap-2">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          {showName && <b className="text-slate-900">{r.employeeName}</b>}
          <span className="font-semibold">{KIND_LABEL[r.kind]}</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLE[r.status]}`}>{r.status}</span>
        </div>
        <p className="text-slate-600">
          {r.date}
          {r.kind === 'REGULARIZATION' && ` · ${r.checkInTime} – ${r.checkOutTime}`}
          {r.kind === 'OVERTIME' && ` · ${r.hours} h${r.amount ? ` · ₹${Math.round(r.amount).toLocaleString('en-IN')} to payroll` : ''}`}
          {r.kind === 'COMP_OFF' && ` · ${r.days} day(s)${r.expiresOn ? ` · expires ${r.expiresOn}` : ''}`}
        </p>
        <p className="text-slate-500">{r.reason}</p>
        <p className="text-[11px] text-slate-400">Approver: {r.approverName}{r.decidedBy ? ` · ${r.status.toLowerCase()} by ${r.decidedBy}` : ''}{r.comment ? ` · "${r.comment}"` : ''}</p>
      </div>
      {r.canDecide && !readOnly && (
        <div className="flex gap-2">
          <button onClick={() => { setErrors([]); setComment(''); setDeciding({ r, decision: 'APPROVED' }); }} className={btn('bg-emerald-600 text-white')}>Approve</button>
          <button onClick={() => { setErrors([]); setComment(''); setDeciding({ r, decision: 'REJECTED' }); }} className={btn('bg-white border border-rose-200 text-rose-700')}>Reject</button>
        </div>
      )}
    </div>
  );

  const tabs: [typeof tab, string, boolean][] = [
    ['requests', 'My requests', !readOnly],
    ['approvals', `Approvals (${approvals.length})`, approvals.length > 0 || role === 'MANAGER' || isHr],
    ['summary', 'Month summary', true],
    ['tools', 'HR tools', ATT_ADMIN.includes(role) || role === 'AUDITORS'],
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2 flex-wrap">
          {tabs.filter(([, , s]) => s).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${tab === id ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'requests' && !readOnly && (
          <button onClick={() => { setErrors([]); setForm({ kind: 'REGULARIZATION', date: new Date().toISOString().slice(0, 10), checkInTime: '09:00', checkOutTime: '18:00', hours: '', reason: '' }); }} className={btn('bg-primary text-white')}>
            Raise request
          </button>
        )}
      </div>
      {msg && <p role="status" className={`text-xs font-semibold ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</p>}

      {tab === 'requests' && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">Missed a punch, worked overtime or worked on a weekly off? Raise it here; nothing changes until your manager approves.</p>
          {mine.length ? mine.map((r) => row(r, false)) : <p className="text-xs text-slate-400">No requests yet.</p>}
        </div>
      )}
      {tab === 'approvals' && (
        <div className="space-y-2">{approvals.length ? approvals.map((r) => row(r, true)) : <p className="text-xs text-slate-400">Nothing waiting for you.</p>}</div>
      )}
      {tab === 'summary' && <MonthSummary canFinalise={isHr} flash={flash} />}
      {tab === 'tools' && <HrTools role={role} flash={flash} />}

      {form && (
        <Dialog title="Raise attendance request" onClose={() => setForm(null)}>
          <form onSubmit={raise} className="space-y-3 text-xs">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })} aria-label="Request type" className={inputCls}>
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <input type="date" required max={new Date().toISOString().slice(0, 10)} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="Date" className={inputCls} />
            {form.kind === 'REGULARIZATION' && (
              <div className="grid grid-cols-2 gap-2">
                <input type="time" required value={form.checkInTime} onChange={(e) => setForm({ ...form, checkInTime: e.target.value })} aria-label="Check-in" className={inputCls} />
                <input type="time" required value={form.checkOutTime} onChange={(e) => setForm({ ...form, checkOutTime: e.target.value })} aria-label="Check-out" className={inputCls} />
              </div>
            )}
            {form.kind === 'OVERTIME' && (
              <input type="number" step="0.25" min="0.25" required placeholder="Overtime hours" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} aria-label="Hours" className={inputCls} />
            )}
            {form.kind === 'COMP_OFF' && <p className="text-slate-500">For work on a weekly off or holiday. Approved comp-off is credited to your leave and expires after a set number of days.</p>}
            <textarea required rows={2} placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} aria-label="Reason" className={inputCls} />
            <ErrorList list={errors} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className={btn('text-slate-600')}>Cancel</button>
              <button type="submit" className={btn('bg-primary text-white')}>Submit</button>
            </div>
          </form>
        </Dialog>
      )}
      {deciding && (
        <Dialog title={`${deciding.decision === 'APPROVED' ? 'Approve' : 'Reject'} ${KIND_LABEL[deciding.r.kind].toLowerCase()}`} onClose={() => setDeciding(null)}>
          <form onSubmit={decide} className="space-y-3 text-xs">
            <p>{deciding.r.employeeName} · {deciding.r.date}</p>
            <textarea rows={2} required={deciding.decision === 'REJECTED'} placeholder={deciding.decision === 'REJECTED' ? 'Reason (required)' : 'Comment'} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" className={inputCls} />
            <ErrorList list={errors} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeciding(null)} className={btn('text-slate-600')}>Back</button>
              <button type="submit" className={btn(deciding.decision === 'APPROVED' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white')}>Confirm</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
};

const Dialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      {children}
    </div>
  </div>
);

const ErrorList: React.FC<{ list: string[] }> = ({ list }) =>
  list.length ? <div role="alert" className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{list.join(' ')}</div> : null;

const MonthSummary: React.FC<{ canFinalise: boolean; flash: (t: string, ok?: boolean) => void }> = ({ canFinalise, flash }) => {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<{ rows: SummaryRow[]; finalised: boolean; finalisedBy?: string; locked: boolean } | null>(null);
  const load = () => request<{ rows: SummaryRow[]; finalised: boolean; finalisedBy?: string; locked: boolean }>(`/attendance/summary?month=${month}`).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="rounded-lg border border-slate-300 px-2 py-1.5" />
        {data && <span className="text-slate-500">{data.finalised ? `Finalised${data.finalisedBy ? ` by ${data.finalisedBy}` : ''}` : 'Not finalised'}{data.locked ? ' · locked' : ''}</span>}
        {canFinalise && data && !data.locked && (
          <button
            onClick={async () => {
              if (!window.confirm(`Finalise ${month}? Absent days, half days and late-mark deductions are sent to payroll as LOP.`)) return;
              try {
                await request('/attendance/finalize', { method: 'POST', body: JSON.stringify({ month }) });
                flash('Month finalised; LOP sent to payroll.');
                load();
              } catch (err: any) {
                flash(err.message, false);
              }
            }}
            className={btn('bg-primary text-white')}
          >
            Finalise for payroll
          </button>
        )}
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500">
            <tr>{['Employee', 'Working', 'Present', 'Leave', 'Absent', 'Half days', 'Late', 'Late deduction', 'LOP days', 'OT hours'].map((h) => <th key={h} className="py-2 px-3">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.rows.map((r) => (
              <tr key={r.employeeId}>
                <td className="py-2 px-3 font-semibold">{r.employeeName} <span className="text-slate-400 font-normal">{r.employeeCode}</span></td>
                {[r.workingDays, r.presentDays, r.leaveDays, r.absentDays, r.halfDays, r.lateMarks, r.lateDeductionDays, r.lopDays, r.approvedOvertimeHours].map((v, i) => (
                  <td key={i} className={`py-2 px-3 font-mono ${i === 7 && v ? 'text-rose-700 font-bold' : ''}`}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const HrTools: React.FC<{ role: string; flash: (t: string, ok?: boolean) => void }> = ({ role, flash }) => {
  const canEdit = canWriteMaster(role) || role === 'ADMIN_2';
  const isDeviceAdmin = DEVICE_ADMIN.includes(role);
  const [locks, setLocks] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [lockMonth, setLockMonth] = useState(thisMonth());
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const load = () => {
    request<{ locks: any[] }>('/attendance/locks').then((r) => setLocks(r.locks)).catch(() => {});
    request<{ devices: any[] }>('/attendance/devices').then((r) => setDevices(r.devices)).catch(() => {});
    request<{ settings: any }>('/attendance/settings').then((r) => setSettings(r.settings)).catch(() => {});
  };
  useEffect(load, []);
  const call = async (path: string, body: unknown, ok: string) => {
    try {
      await request(path, { method: 'POST', body: JSON.stringify(body) });
      flash(ok);
      load();
    } catch (err: any) {
      flash(err.message, false);
    }
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
      <section className="border border-slate-200 rounded-xl p-4 space-y-2">
        <h4 className="font-bold text-slate-900">Month lock (after payroll cut-off)</h4>
        {canEdit && (
          <div className="flex gap-2">
            <input type="month" value={lockMonth} onChange={(e) => setLockMonth(e.target.value)} aria-label="Month to lock" className="rounded-lg border border-slate-300 px-2 py-1" />
            <button onClick={() => call('/attendance/lock', { month: lockMonth }, `${lockMonth} locked.`)} className={btn('bg-primary text-white flex items-center gap-1')}><Lock className="w-3 h-3" /> Lock</button>
          </div>
        )}
        {locks.map((l) => (
          <div key={l._id} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <span>{l._id}: {l.locked ? `locked by ${l.lockedBy}` : `unlocked by ${l.unlockedBy}`}{l.unlockRequest ? ` · unlock requested by ${l.unlockRequest.by}: "${l.unlockRequest.reason}"` : ''}</span>
            {canEdit && l.locked && !l.unlockRequest && (
              <button onClick={() => { const reason = window.prompt('Why does this month need to be unlocked?'); if (reason) call('/attendance/unlock-request', { month: l._id, reason }, 'Unlock requested; another approver must approve it.'); }} className={btn('bg-white border border-slate-300')}>Request unlock</button>
            )}
            {canEdit && l.unlockRequest && (
              <button onClick={() => call(`/attendance/unlock/${l._id}/approve`, {}, `${l._id} unlocked.`)} className={btn('bg-amber-600 text-white flex items-center gap-1')}><Unlock className="w-3 h-3" /> Approve unlock</button>
            )}
          </div>
        ))}
      </section>

      {canEdit && (
        <section className="border border-slate-200 rounded-xl p-4 space-y-2">
          <h4 className="font-bold text-slate-900">Bulk attendance upload</h4>
          <p className="text-slate-500">CSV columns: employeeCode,date,checkInTime,checkOutTime,status. Valid rows are saved; rows with errors are listed.</p>
          <input
            type="file"
            accept=".csv"
            aria-label="Attendance CSV"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append('file', f);
              try {
                setUploadResult(await api.upload('/attendance/bulk-upload', fd));
              } catch (err: any) {
                flash(err.message, false);
              }
            }}
            className="text-xs file:mr-2 file:px-2.5 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary file:text-white"
          />
          {uploadResult && (
            <div>
              <p className="font-semibold">{uploadResult.summary.saved} saved, {uploadResult.summary.failed} failed</p>
              <ul className="list-disc pl-4 text-rose-700">{uploadResult.results.filter((r: any) => r.status === 'FAILED').map((r: any) => <li key={r.row}>Row {r.row}: {r.errors.join(' ')}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <section className="border border-slate-200 rounded-xl p-4 space-y-2">
        <h4 className="font-bold text-slate-900 flex items-center gap-1"><Upload className="w-3.5 h-3.5" /> Biometric devices</h4>
        <p className="text-slate-500">Devices post punches to <code>/api/attendance/device-punches</code> with their key; duplicate punches within a minute are ignored.</p>
        {devices.map((d) => <p key={d._id}>{d.name} ({d.location || 'no location'}) · every {d.syncIntervalMinutes} min · last sync {d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString() : 'never'} · {d.punchCount} punches</p>)}
        {isDeviceAdmin && (
          <button
            onClick={async () => {
              const name = window.prompt('Device name (e.g. Pune main door)');
              if (!name) return;
              try {
                const r = await request<{ deviceKey: string }>('/attendance/devices', { method: 'POST', body: JSON.stringify({ name }) });
                setNewKey(r.deviceKey);
                load();
              } catch (err: any) {
                flash(err.message, false);
              }
            }}
            className={btn('bg-primary text-white')}
          >
            Add device
          </button>
        )}
        {newKey && <p className="p-2 rounded bg-amber-50 border border-amber-200">Device key (shown once, configure it on the device): <code className="select-all">{newKey}</code></p>}
      </section>

      {settings && (
        <section className="border border-slate-200 rounded-xl p-4 space-y-2">
          <h4 className="font-bold text-slate-900">Policy</h4>
          {[
            ['lateMarksPerHalfDay', 'Late marks per half-day deduction'],
            ['otMultiplier', 'Overtime rate (× hourly)'],
            ['compOffExpiryDays', 'Comp-off expires after (days)'],
            ['halfDayMinHours', 'Half day below (hours)'],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2">
              <span>{label}</span>
              <input type="number" disabled={!canEdit} value={settings[k]} onChange={(e) => setSettings({ ...settings, [k]: Number(e.target.value) })} className="w-20 rounded border border-slate-300 px-2 py-1" />
            </label>
          ))}
          <label className="flex items-center justify-between gap-2">
            <span>Punch outside geo-fence</span>
            <select disabled={!canEdit} value={settings.outsideGeofence} onChange={(e) => setSettings({ ...settings, outsideGeofence: e.target.value })} className="rounded border border-slate-300 px-2 py-1">
              <option value="FLAG">Accept and flag</option>
              <option value="BLOCK">Block</option>
            </select>
          </label>
          {canEdit && (
            <button onClick={async () => { try { await request('/attendance/settings', { method: 'PUT', body: JSON.stringify(settings) }); flash('Policy saved.'); } catch (err: any) { flash(err.message, false); } }} className={btn('bg-primary text-white')}>
              Save policy
            </button>
          )}
        </section>
      )}
    </div>
  );
};
