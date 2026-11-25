import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Badge, btn, card, errMsg, fmtDate, inputCls, Msg, MsgState, okMsg, PageHeader, PRIMARY, saveCsv, SECONDARY, Table, Tabs } from '../components/common/ui';

type Tab = 'logs' | 'logins' | 'reviews';

const changesOf = (d: any): { field: string; oldValue: any; newValue: any }[] => {
  const ch = d?.changes;
  if (Array.isArray(ch)) return ch.map((c: any) => ({ field: c.field, oldValue: c.oldValue ?? c.old, newValue: c.newValue ?? c.new }));
  if (d && 'field' in d) return [{ field: d.field, oldValue: d.old, newValue: d.new }];
  return [];
};
const show = (v: any) => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export const AuditLogsPage: React.FC<{ onNavigateTab?: (tab: string) => void }> = () => {
  const { user } = useAuth();
  const role = user?.role || '';
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [{ id: 'logs', label: 'Audit trail' }];
    if (['SUPER_ADMIN', 'AUDITORS', 'ADMIN', 'ADMIN_1', 'ADMIN_2'].includes(role)) t.push({ id: 'logins', label: 'Login history' });
    if (['SUPER_ADMIN', 'AUDITORS'].includes(role)) t.push({ id: 'reviews', label: 'Reviews' });
    return t;
  }, [role]);
  const [tab, setTab] = useState<Tab>('logs');
  const [msg, setMsg] = useState<MsgState>(null);
  return (
    <div className="space-y-5">
      <PageHeader title="Audit logs" subtitle="Every change with user, time, IP, old and new value. Logs are read-only for everyone, including Super Admin." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <Msg msg={msg} />
      {tab === 'logs' && <Logs setMsg={setMsg} />}
      {tab === 'logins' && <Logins setMsg={setMsg} />}
      {tab === 'reviews' && <Reviews setMsg={setMsg} canSign={role === 'AUDITORS'} />}
    </div>
  );
};

type SetMsg = { setMsg: (m: MsgState) => void };

const Logs: React.FC<SetMsg> = ({ setMsg }) => {
  const [f, setF] = useState({ module: '', action: '', userEmail: '', dateFrom: '', dateTo: '' });
  const [data, setData] = useState<any>({ logs: [], scope: 'ALL' });
  const [open, setOpen] = useState<string | null>(null);
  const load = () => {
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    api.get<any>(`/audit-logs?${p}`).then(setData).catch((e) => setMsg(errMsg(e)));
  };
  useEffect(load, []);
  const exportCsv = () => saveCsv('audit_log.csv', ['timestamp', 'userEmail', 'role', 'action', 'module', 'entity', 'entityId', 'ipAddress', 'changes'],
    data.logs.map((l: any) => ({ ...l, changes: changesOf(l.details).map((c) => `${c.field}: ${show(c.oldValue)} -> ${show(c.newValue)}`).join(' | ') })));
  return (
    <div className={card}>
      <div className="flex flex-wrap gap-2 items-end text-xs">
        {(['module', 'action', 'userEmail'] as const).map((k) => <label key={k}>{k}<input className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
        <label>From<input type="date" className={inputCls} value={f.dateFrom} onChange={(e) => setF({ ...f, dateFrom: e.target.value })} /></label>
        <label>To<input type="date" className={inputCls} value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })} /></label>
        <button className={btn(PRIMARY)} onClick={load}>Filter</button>
        <button className={btn(SECONDARY)} onClick={exportCsv}>Export</button>
        <span className="text-slate-500">Scope: {Array.isArray(data.scope) ? data.scope.join(', ') : 'all modules'}</span>
      </div>
      <Table rows={data.logs} cols={[
        { key: 'timestamp', label: 'When', render: (l) => fmtDate(l.timestamp) },
        { key: 'userEmail', label: 'User', render: (l) => <>{l.userEmail}<div className="text-slate-400">{l.role}</div></> },
        { key: 'action', label: 'Action', render: (l) => <Badge s={l.action} tone={/DENIED|BLOCKED|FAILED|LOCKED|TAMPER/.test(l.action) ? 'red' : 'grey'} /> },
        { key: 'module', label: 'Module' }, { key: 'entityId', label: 'Record', render: (l) => <span className="font-mono">{l.entity} {String(l.entityId ?? '').slice(0, 24)}</span> },
        { key: 'ipAddress', label: 'IP' },
        { key: 'changes', label: 'Old → new', render: (l) => {
          const ch = changesOf(l.details);
          if (!ch.length) return <button className="text-slate-500 underline" onClick={() => setOpen(open === l._id ? null : l._id)}>details</button>;
          return <ul>{ch.slice(0, open === l._id ? 50 : 3).map((c, i) => <li key={i}><b>{c.field}</b>: <span className="text-rose-700 line-through">{show(c.oldValue).slice(0, 60)}</span> → <span className="text-emerald-700">{show(c.newValue).slice(0, 60)}</span></li>)}</ul>;
        } },
      ]} />
      {open && <pre className="text-[10px] bg-slate-50 p-2 rounded overflow-x-auto">{JSON.stringify(data.logs.find((l: any) => l._id === open)?.details, null, 2)}</pre>}
    </div>
  );
};

const Logins: React.FC<SetMsg> = ({ setMsg }) => {
  const [data, setData] = useState<any>({ history: [], lockouts: [] });
  const [email, setEmail] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const load = () => api.get<any>(`/audit/login-history?${email ? `email=${encodeURIComponent(email)}&` : ''}${failedOnly ? 'success=false' : ''}`).then(setData).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, [failedOnly]);
  return (
    <div className={card}>
      <div className="flex flex-wrap gap-2 items-end text-xs">
        <label>Email<input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="flex gap-1 items-center"><input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed only</label>
        <button className={btn(PRIMARY)} onClick={load}>Search</button>
        <span className="text-rose-700 font-semibold">{data.lockouts.length} lockout event(s)</span>
      </div>
      <Table rows={data.history} cols={[
        { key: 'at', label: 'When', render: (h) => fmtDate(h.at) }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role', render: (h) => h.role || '—' },
        { key: 'success', label: 'Result', render: (h) => <Badge s={h.success ? 'OK' : 'FAILED'} tone={h.success ? 'green' : 'red'} /> },
        { key: 'reason', label: 'Detail', render: (h) => h.reason.replace(/_/g, ' ').toLowerCase() }, { key: 'ipAddress', label: 'IP' },
      ]} />
    </div>
  );
};

const Reviews: React.FC<SetMsg & { canSign: boolean }> = ({ setMsg, canSign }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ from: '', to: '', findings: '' });
  const load = () => api.get<any>('/audit/reviews').then((r) => setRows(r.reviews)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  return (
    <div className={card}>
      <p className="text-xs text-slate-500">The audit trail is reviewed by Auditors, who make no changes themselves, so no one reviews their own actions.</p>
      {canSign && (
        <div className="grid md:grid-cols-4 gap-2 text-xs items-end">
          <label>From<input type="date" className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label>To<input type="date" className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          <label>Findings<input className={inputCls} value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} /></label>
          <button className={btn(PRIMARY)} onClick={() => api.post('/audit/reviews', f).then(() => { setMsg(okMsg('Review signed off.')); load(); }).catch((e) => setMsg(errMsg(e)))}>Sign off review</button>
        </div>
      )}
      <Table rows={rows} cols={[
        { key: 'period', label: 'Period', render: (r) => `${r.from} → ${r.to}` }, { key: 'entries', label: 'Entries', right: true },
        { key: 'reviewer', label: 'Reviewer' }, { key: 'at', label: 'Signed', render: (r) => fmtDate(r.at) }, { key: 'findings', label: 'Findings' },
      ]} />
    </div>
  );
};

export default AuditLogsPage;
