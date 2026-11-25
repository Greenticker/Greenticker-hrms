import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { isReadOnlyRole } from '../utils/access';
import {
  Badge, btn, card, errMsg, fmtDate, GOOD, inputCls, Modal, Msg, MsgState, okMsg, openApiFile, PageHeader, PRIMARY, SECONDARY, Table, Tabs,
} from '../components/common/ui';
import { Lock, Plus } from 'lucide-react';

const CATEGORIES: [string, string][] = [
  ['HR', 'HR general'], ['LEAVE', 'Leave'], ['DOCUMENTS', 'Letters & documents'], ['BENEFITS', 'Benefits'], ['POLICY', 'Policy'],
  ['PAYROLL', 'Payroll / salary'], ['TAX', 'Tax'], ['REIMBURSEMENT', 'Reimbursement'], ['ACCOUNTS', 'Accounts'],
  ['IT', 'IT support'], ['ADMIN', 'Admin / facilities'], ['ACCESS', 'Access & logins'],
  ['POSH', 'POSH complaint (confidential)'], ['GRIEVANCE', 'Grievance (confidential)'],
];

type Tab = 'mine' | 'queue' | 'all' | 'settings';

export const HrRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role || '';
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [{ id: 'mine', label: 'My tickets' }, { id: 'queue', label: 'My team queue' }];
    if (['SUPER_ADMIN', 'AUDITORS'].includes(role)) t.push({ id: 'all', label: 'All tickets' });
    if (role === 'SUPER_ADMIN') t.push({ id: 'settings', label: 'SLA & ICC' });
    return t;
  }, [role]);
  const [tab, setTab] = useState<Tab>('mine');
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState<MsgState>(null);
  const [open, setOpen] = useState<any>(null);
  const [form, setForm] = useState<any>(null);

  const load = () => {
    if (tab === 'settings') return;
    api.get<any>(`/helpdesk/tickets?scope=${tab === 'all' ? 'auto' : tab}`).then((r) => setRows(r.tickets)).catch((e) => setMsg(errMsg(e)));
  };
  useEffect(load, [tab]);
  const refresh = (t: any) => { setOpen(t); load(); };

  const raise = async () => {
    try {
      const fd = new FormData();
      ['category', 'subject', 'description', 'priority'].forEach((k) => fd.append(k, form[k]));
      if (form.file) fd.append('attachment', form.file);
      const r = await api.upload<any>('/helpdesk/tickets', fd);
      setForm(null);
      setMsg(okMsg(r.acknowledgement));
      load();
    } catch (e) { setMsg(errMsg(e)); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Help desk" subtitle="Tickets go to the right team automatically. POSH and grievance tickets are seen only by the Internal Complaints Committee.">
        {!isReadOnlyRole(role) && <button className={btn(PRIMARY)} onClick={() => setForm({ category: 'HR', subject: '', description: '', priority: 'MEDIUM', file: null })}><Plus className="w-3 h-3 inline" /> Raise ticket</button>}
      </PageHeader>
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setMsg(null); }} />
      <Msg msg={msg} />
      {tab === 'settings' ? <Settings setMsg={setMsg} /> : (
        <div className={card}>
          <Table rows={rows} empty="No tickets." cols={[
            { key: 'ticketNumber', label: 'Ticket', render: (t) => <button className="underline decoration-dotted" onClick={() => api.get<any>(`/helpdesk/tickets/${t._id}`).then((r) => setOpen(r.ticket)).catch((e) => setMsg(errMsg(e)))}>{t.ticketNumber}</button> },
            { key: 'subject', label: 'Subject', render: (t) => <>{t.confidential && <Lock className="w-3 h-3 inline mr-1 text-rose-600" />}{t.subject}</> },
            { key: 'category', label: 'Category' }, { key: 'queue', label: 'Team', render: (t) => t.queue.replace('_', '/') },
            { key: 'employeeName', label: 'Raised by' }, { key: 'priority', label: 'Priority' },
            { key: 'dueAt', label: 'Due', render: (t) => <>{fmtDate(t.dueAt)}{t.slaBreached && <div className="text-rose-600 font-semibold">SLA breached · L{t.escalationLevel}</div>}</> },
            { key: 'status', label: 'Status', render: (t) => <Badge s={t.status} /> },
          ]} />
        </div>
      )}
      {form && (
        <Modal title="Raise a ticket" onClose={() => setForm(null)}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label>Category<select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Priority<select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label>
            <label className="col-span-2">Subject<input className={inputCls} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
            <label className="col-span-2">Description<textarea rows={5} className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label className="col-span-2">Attachment<input type="file" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} /></label>
          </div>
          {['POSH', 'GRIEVANCE'].includes(form.category) && <p className="text-xs text-rose-700">This ticket will be visible only to the Internal Complaints Committee.</p>}
          <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={raise}>Submit</button></div>
        </Modal>
      )}
      {open && <TicketView t={open} onChange={refresh} onClose={() => setOpen(null)} setMsg={setMsg} />}
    </div>
  );
};

const TicketView: React.FC<{ t: any; onChange: (t: any) => void; onClose: () => void; setMsg: (m: MsgState) => void }> = ({ t, onChange, onClose, setMsg }) => {
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const post = async (path: string, body: any, ok?: string) => {
    try { const r = await api.post<any>(`/helpdesk/tickets/${t._id}/${path}`, body); onChange(r.ticket); setText(''); if (ok) setMsg(okMsg(ok)); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <Modal title={`${t.ticketNumber} — ${t.subject}`} onClose={onClose} wide>
      <p className="text-xs text-slate-500">{t.category} → {t.queue.replace('_', '/')} team · {t.priority} · raised {fmtDate(t.createdAt)} by {t.employeeName} · <Badge s={t.status} />
        {t.assignedTo && ` · assigned to ${t.assignedTo}`}{t.rating ? ` · rated ${t.rating}/5` : ''}</p>
      <p className="text-xs whitespace-pre-wrap bg-slate-50 p-3 rounded-xl">{t.description}</p>
      {t.attachment && <button className="text-xs underline text-indigo-700" onClick={() => openApiFile(`/helpdesk/tickets/${t._id}/attachment`).catch((e) => setMsg(errMsg(e)))}>{t.attachment.fileName}</button>}
      <div className="space-y-2">
        {t.comments.map((c: any) => (
          <div key={c._id} className={`text-xs p-2 rounded-lg ${c.internal ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
            <b>{c.by}</b> · {fmtDate(c.at)} {c.internal && <Badge s="INTERNAL NOTE" tone="amber" />}{c.resolution && <Badge s="RESOLUTION" tone="green" />}
            <div className="whitespace-pre-wrap">{c.text}</div>
          </div>
        ))}
      </div>
      {t.status !== 'CLOSED' && (t.isAgent || t.canClose || t.canReopen || !t.isAgent) && (
        <div className="space-y-2">
          <textarea className={inputCls} rows={3} placeholder="Write a reply…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2 items-center">
            {t.isAgent && <label className="text-xs flex gap-1 items-center"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (hidden from the employee)</label>}
            <button className={btn(SECONDARY)} disabled={!text.trim()} onClick={() => post('comments', { text, internal })}>Add comment</button>
            {t.canResolve && <button className={btn(GOOD)} disabled={!text.trim()} onClick={() => post('resolve', { resolution: text }, 'Resolved.')}>Resolve with this reply</button>}
            {t.canReopen && <button className={btn(SECONDARY)} disabled={!text.trim()} onClick={() => post('reopen', { reason: text }, 'Reopened.')}>Reopen (reason above)</button>}
            {t.canClose && [5, 4, 3, 2, 1].map((n) => <button key={n} className={btn(n >= 4 ? GOOD : SECONDARY)} onClick={() => post('close', { rating: n, feedback: text }, 'Closed. Thanks for the rating.')}>Close · {n}★</button>)}
          </div>
        </div>
      )}
      <details className="text-xs"><summary className="cursor-pointer text-slate-500">History (cannot be edited)</summary>
        <ul>{t.history.map((h: any, i: number) => <li key={i}>{fmtDate(h.at)} — {h.action.replace(/_/g, ' ').toLowerCase()} by {h.by}{h.reason ? `: ${h.reason}` : ''}</li>)}</ul>
      </details>
    </Modal>
  );
};

const Settings: React.FC<{ setMsg: (m: MsgState) => void }> = ({ setMsg }) => {
  const [s, setS] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => {
    api.get<any>('/helpdesk/settings').then((r) => setS(r.settings)).catch((e) => setMsg(errMsg(e)));
    api.get<any>('/admin/users').then((r) => setUsers(r.users)).catch(() => undefined);
  }, []);
  if (!s) return null;
  const save = async () => {
    try { await api.put('/helpdesk/settings', { slaHours: s.slaHours, iccMemberUserIds: s.iccMemberUserIds }); setMsg(okMsg('Help desk settings saved.')); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className={card}>
      <h3 className="font-bold text-sm">SLA (hours to resolve)</h3>
      <div className="flex gap-3 text-xs">{Object.keys(s.slaHours).map((p) => (
        <label key={p}>{p}<input type="number" className={inputCls} value={s.slaHours[p]} onChange={(e) => setS({ ...s, slaHours: { ...s.slaHours, [p]: Number(e.target.value) } })} /></label>
      ))}</div>
      <h3 className="font-bold text-sm">Internal Complaints Committee members</h3>
      <div className="max-h-56 overflow-y-auto text-xs grid md:grid-cols-2 gap-1">
        {users.filter((u) => u.isActive).map((u) => (
          <label key={u._id} className="flex gap-1 items-center"><input type="checkbox" checked={s.iccMemberUserIds.includes(u._id)} onChange={(e) => setS({ ...s, iccMemberUserIds: e.target.checked ? [...s.iccMemberUserIds, u._id] : s.iccMemberUserIds.filter((x: string) => x !== u._id) })} />{u.name} ({u.role})</label>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <button className={btn(SECONDARY)} onClick={() => api.post<any>('/helpdesk/escalations/run').then((r) => setMsg(okMsg(`SLA check done: ${r.escalated.length} ticket(s) escalated.`))).catch((e) => setMsg(errMsg(e)))}>Run SLA check now</button>
        <button className={btn(PRIMARY)} onClick={save}>Save</button>
      </div>
    </div>
  );
};

export default HrRequestsPage;
