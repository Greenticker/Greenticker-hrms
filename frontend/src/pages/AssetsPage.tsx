import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { employeeService } from '../services/employeeService';
import { Employee } from '../types/employee';
import { isReadOnlyRole } from '../utils/access';
import {
  Badge, BAD, btn, card, errMsg, fmtDate, fmtMoney, GOOD, inputCls, Modal, Msg, MsgState, okMsg, PageHeader, PRIMARY, saveCsv, SECONDARY, Table, Tabs,
} from '../components/common/ui';

type Tab = 'mine' | 'requests' | 'all' | 'register';
const ADMINS = ['ADMIN', 'ADMIN_1', 'ADMIN_2', 'SUPER_ADMIN'];
const READ_ALL = [...ADMINS, 'HR', 'FINANCE', 'ACCOUNTS', 'AUDITORS'];

export const AssetsPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role || '';
  const hasEmployee = !!(user?.employee || user?.employeeId);
  const isAdmin = ADMINS.includes(role);
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [];
    if (hasEmployee) t.push({ id: 'mine', label: 'My assets' });
    t.push({ id: 'requests', label: 'Requests' });
    if (READ_ALL.includes(role)) t.push({ id: 'all', label: 'Asset master' }, { id: 'register', label: 'Register & depreciation' });
    return t;
  }, [hasEmployee, role]);
  const [tab, setTab] = useState<Tab>(tabs[0].id);
  const [msg, setMsg] = useState<MsgState>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [emps, setEmps] = useState<Employee[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [create, setCreate] = useState<any>(null);
  const me = user?.employee?._id || user?.employeeId;

  const load = () => {
    if (tab === 'mine' || tab === 'all') {
      api.get<any>(tab === 'mine' ? `/assets?employeeId=${me}` : '/assets').then((r) => setAssets(r.assets)).catch((e) => setMsg(errMsg(e)));
    }
  };
  useEffect(load, [tab]);
  useEffect(() => { if (isAdmin) employeeService.getEmployees().then((r) => setEmps(r.employees || [])).catch(() => undefined); }, [isAdmin]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    try { const r = await fn(); setMsg(okMsg(ok)); if (r?.asset) setOpen(r.asset); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  const ask = (q: string) => window.prompt(q) || '';

  return (
    <div className="space-y-5">
      <PageHeader title="Assets" subtitle="Request, issue, acknowledge, return and track company assets. Records are never deleted; write-offs need Finance approval.">
        {tab === 'all' && isAdmin && <button className={btn(PRIMARY)} onClick={() => setCreate({ type: 'LAPTOP', name: '', assetTag: '', serialNumber: '', vendor: '', cost: '', purchaseDate: '', invoiceNumber: '', depreciationMethod: 'SLM' })}>Record asset</button>}
      </PageHeader>
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setMsg(null); }} />
      <Msg msg={msg} />
      {(tab === 'mine' || tab === 'all') && (
        <div className={card}>
          <Table rows={assets} empty="No assets." cols={[
            { key: 'assetTag', label: 'Tag', render: (a) => <button className="underline decoration-dotted" onClick={() => setOpen(a)}>{a.assetTag}</button> },
            { key: 'name', label: 'Asset' }, { key: 'type', label: 'Type' }, { key: 'serialNumber', label: 'Serial' },
            { key: 'employeeName', label: 'With', render: (a) => a.employeeName || '—' },
            { key: 'status', label: 'Status', render: (a) => <><Badge s={a.status} /> {a.ackStatus === 'PENDING' && <Badge s="ACK PENDING" tone="amber" />}</> },
            { key: 'a', label: '', render: (a) => a.canAcknowledge && <button className={btn(GOOD)} onClick={() => act(() => api.post(`/assets/${a._id}/acknowledge`, {}), 'Receipt acknowledged.')}>Acknowledge</button> },
          ]} />
        </div>
      )}
      {tab === 'requests' && <Requests setMsg={setMsg} readOnly={isReadOnlyRole(role)} />}
      {tab === 'register' && <Register setMsg={setMsg} isAccounts={role === 'ACCOUNTS'} />}
      {open && (
        <Modal title={`${open.assetTag} — ${open.name}`} onClose={() => setOpen(null)} wide>
          <div className="grid md:grid-cols-3 gap-2 text-xs">
            {[['Type', open.type], ['Serial', open.serialNumber], ['Vendor', open.vendor], ['Cost', open.cost != null ? `₹${fmtMoney(open.cost)}` : '—'],
              ['Purchased', open.purchaseDate], ['Book value', open.bookValue != null ? `₹${fmtMoney(open.bookValue)}` : '—'], ['Status', open.status],
              ['With', open.employeeName || '—'], ['Acknowledged', open.acknowledgedAt ? fmtDate(open.acknowledgedAt) : open.ackStatus || '—'], ['Recorded by', open.recordedBy]].map(([k, v]) => (
              <div key={k}><span className="text-slate-500 block">{k}</span><b>{v || '—'}</b></div>
            ))}
          </div>
          {open.recovery && <p className="text-xs">Recovery: ₹{fmtMoney(open.recovery.amount)} — {open.recovery.reason} <Badge s={open.recovery.status} /></p>}
          {open.writeOff && <p className="text-xs">Write-off: {open.writeOff.reason} <Badge s={open.writeOff.status} /></p>}
          <div className="flex flex-wrap gap-2">
            {open.canAcknowledge && <button className={btn(GOOD)} onClick={() => act(() => api.post(`/assets/${open._id}/acknowledge`, {}), 'Acknowledged.')}>Acknowledge receipt</button>}
            {open.employeeId === me && ['ALLOCATED'].includes(open.status) && (
              <button className={btn(BAD)} onClick={() => { const kind = window.confirm('Is the asset LOST? (OK = lost, Cancel = damaged)') ? 'LOSS' : 'DAMAGE'; const d = ask('What happened?'); if (d) act(() => api.post(`/assets/${open._id}/report`, { kind, description: d }), 'Reported to admin.'); }}>Report loss / damage</button>
            )}
            {isAdmin && open.canIssue && (
              <select className={inputCls + ' w-56'} value="" aria-label="Issue to" onChange={(e) => e.target.value && act(() => api.post(`/assets/${open._id}/issue`, { employeeId: e.target.value }), 'Issued; the employee has been asked to acknowledge.')}>
                <option value="">Issue to…</option>{emps.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
              </select>
            )}
            {isAdmin && open.status === 'ALLOCATED' && (
              <>
                <select className={inputCls + ' w-56'} value="" aria-label="Transfer to" onChange={(e) => e.target.value && act(() => api.post(`/assets/${open._id}/transfer`, { toEmployeeId: e.target.value }), 'Transferred.')}>
                  <option value="">Transfer to…</option>{emps.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
                </select>
                <button className={btn(SECONDARY)} onClick={() => { const c = (ask('Condition on return: GOOD, FAIR or DAMAGED') || 'GOOD').toUpperCase(); act(() => api.post(`/assets/${open._id}/return`, { condition: c }), 'Returned to stock.'); }}>Mark returned</button>
              </>
            )}
            {isAdmin && open.employeeId && open.recovery?.status !== 'PENDING_FINANCE' && ['ALLOCATED', 'REPORTED_LOST', 'REPORTED_DAMAGED'].includes(open.status) && (
              <button className={btn(SECONDARY)} onClick={() => { const amount = Number(ask('Recovery amount (0 to waive)')); const reason = ask('Reason'); if (reason) act(() => api.post(`/assets/${open._id}/recovery`, { amount, reason }), 'Recovery sent to Finance for approval.'); }}>Propose recovery</button>
            )}
            {open.canApproveRecovery && <><button className={btn(GOOD)} onClick={() => act(() => api.post(`/assets/${open._id}/recovery/decide`, { decision: 'APPROVED' }), 'Recovery approved; it is deducted in payroll.')}>Approve recovery</button><button className={btn(BAD)} onClick={() => act(() => api.post(`/assets/${open._id}/recovery/decide`, { decision: 'REJECTED' }), 'Recovery rejected.')}>Reject</button></>}
            {isAdmin && !['WRITTEN_OFF', 'DISPOSED'].includes(open.status) && open.writeOff?.status !== 'PENDING_FINANCE' && (
              <button className={btn(SECONDARY)} onClick={() => { const r = ask('Reason for write-off / disposal'); if (r) act(() => api.post(`/assets/${open._id}/write-off`, { reason: r }), 'Write-off sent to Finance.'); }}>Request write-off</button>
            )}
            {open.canApproveWriteOff && <><button className={btn(GOOD)} onClick={() => act(() => api.post(`/assets/${open._id}/write-off/decide`, { decision: 'APPROVED' }), 'Written off.')}>Approve write-off</button><button className={btn(BAD)} onClick={() => act(() => api.post(`/assets/${open._id}/write-off/decide`, { decision: 'REJECTED' }), 'Write-off rejected.')}>Reject</button></>}
          </div>
          <h4 className="font-semibold text-xs">History</h4>
          <ul className="text-xs space-y-0.5">
            {(open.history || []).map((h: any, i: number) => (
              <li key={i}>{fmtDate(h.at)} — {h.action.replace(/_/g, ' ').toLowerCase()} by {h.by}{h.to ? ` → ${h.to}` : ''}{h.condition ? ` (${h.condition})` : ''}{h.reason ? `: ${h.reason}` : ''}</li>
            ))}
          </ul>
        </Modal>
      )}
      {create && (
        <Modal title="Record a new asset" onClose={() => setCreate(null)}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label>Type<select className={inputCls} value={create.type} onChange={(e) => setCreate({ ...create, type: e.target.value })}>{['LAPTOP', 'DESKTOP', 'MONITOR', 'PHONE', 'SIM', 'TABLET', 'HEADSET', 'CHAIR', 'SOFTWARE_LICENSE', 'CAR', 'OTHER'].map((t) => <option key={t}>{t}</option>)}</select></label>
            {[['name', 'Make / model'], ['assetTag', 'Asset tag'], ['serialNumber', 'Serial number'], ['vendor', 'Vendor'], ['invoiceNumber', 'Invoice no.'], ['cost', 'Cost'], ['purchaseDate', 'Purchase date']].map(([k, l]) => (
              <label key={k}>{l}<input className={inputCls} type={k === 'cost' ? 'number' : k === 'purchaseDate' ? 'date' : 'text'} value={create[k]} onChange={(e) => setCreate({ ...create, [k]: e.target.value })} /></label>
            ))}
            <label>Depreciation<select className={inputCls} value={create.depreciationMethod} onChange={(e) => setCreate({ ...create, depreciationMethod: e.target.value })}><option value="SLM">Straight line</option><option value="WDV">Written-down value</option></select></label>
          </div>
          <p className="text-xs text-slate-500">Another admin issues the asset; you cannot issue an asset you recorded.</p>
          <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={() => act(async () => { await api.post('/assets', { ...create, cost: Number(create.cost) }); setCreate(null); }, 'Asset recorded in stock.')}>Save</button></div>
        </Modal>
      )}
    </div>
  );
};

type SetMsg = { setMsg: (m: MsgState) => void };

const Requests: React.FC<SetMsg & { readOnly: boolean }> = ({ setMsg, readOnly }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState<any>(null);
  const load = () => api.get<any>('/assets/requests').then((r) => setRows(r.requests)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  const decide = async (r: any, decision: string) => {
    const comment = decision === 'REJECTED' ? window.prompt('Reason?') || '' : '';
    if (decision === 'REJECTED' && !comment) return;
    try { await api.post(`/assets/requests/${r._id}/decide`, { decision, comment }); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className={card}>
      {!readOnly && <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={() => setF({ type: 'LAPTOP', reason: '' })}>Request an asset</button></div>}
      <Table rows={rows} cols={[
        { key: 'employeeName', label: 'Employee' }, { key: 'type', label: 'Asset' }, { key: 'reason', label: 'Reason' },
        { key: 'approverName', label: 'Approver', render: (r) => r.approverName || 'Admin' }, { key: 'raisedAt', label: 'Raised', render: (r) => fmtDate(r.raisedAt) },
        { key: 'status', label: 'Status', render: (r) => <Badge s={r.status} /> },
        { key: 'a', label: '', render: (r) => r.canDecide && <div className="flex gap-1"><button className={btn(GOOD)} onClick={() => decide(r, 'APPROVED')}>Approve</button><button className={btn(BAD)} onClick={() => decide(r, 'REJECTED')}>Reject</button></div> },
      ]} />
      {f && (
        <Modal title="Request an asset" onClose={() => setF(null)}>
          <label className="text-xs block">Type<select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['LAPTOP', 'MONITOR', 'PHONE', 'SIM', 'HEADSET', 'CHAIR', 'SOFTWARE_LICENSE', 'OTHER'].map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="text-xs block">Reason<textarea className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
          <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={() => api.post('/assets/requests', f).then(() => { setF(null); setMsg(okMsg('Request sent to your manager.')); load(); }).catch((e) => setMsg(errMsg(e)))}>Submit</button></div>
        </Modal>
      )}
    </div>
  );
};

const Register: React.FC<SetMsg & { isAccounts: boolean }> = ({ setMsg, isAccounts }) => {
  const [data, setData] = useState<any>(null);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const load = () => api.get<any>('/assets/register').then(setData).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  const run = async () => {
    try { const r = await api.post<any>('/assets/depreciation', { asOf }); setMsg(okMsg(`Depreciation run for ${r.rows.length} assets as of ${r.asOf}.`)); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  if (!data) return null;
  const cols = ['assetTag', 'serialNumber', 'type', 'name', 'vendor', 'cost', 'purchaseDate', 'status', 'employeeName', 'bookValue', 'accumulatedDepreciation'];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {data.summary.map((s: any) => (
          <div key={s.status} className="bg-white border border-slate-200 rounded-xl p-3 text-xs"><Badge s={s.status} /><p className="text-lg font-bold mt-1">{s.count}</p><p className="text-slate-500">Book value ₹{fmtMoney(s.bookValue)}</p></div>
        ))}
      </div>
      <div className={card}>
        <div className="flex flex-wrap gap-2 items-end text-xs">
          {isAccounts && <><label>As of<input type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label><button className={btn(PRIMARY)} onClick={run}>Run depreciation</button></>}
          <button className={btn(SECONDARY)} onClick={() => saveCsv(`asset_register_${asOf}.csv`, cols, data.rows)}>Export register</button>
          {data.readOnly && <span className="text-slate-500">Read-only view for verification.</span>}
        </div>
        <Table rows={data.rows} cols={[
          { key: 'assetTag', label: 'Tag' }, { key: 'name', label: 'Asset' }, { key: 'serialNumber', label: 'Serial' }, { key: 'status', label: 'Status', render: (a) => <Badge s={a.status} /> },
          { key: 'employeeName', label: 'With', render: (a) => a.employeeName || '—' }, { key: 'cost', label: 'Cost', right: true, render: (a) => (a.cost != null ? fmtMoney(a.cost) : '—') },
          { key: 'bookValue', label: 'Book value', right: true, render: (a) => (a.bookValue != null ? fmtMoney(a.bookValue) : '—') },
        ]} />
      </div>
    </div>
  );
};

export default AssetsPage;
