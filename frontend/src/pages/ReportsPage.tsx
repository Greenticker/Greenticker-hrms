import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { isReadOnlyRole } from '../utils/access';
import {
  Badge, btn, card, downloadApiFile, errMsg, fmtDate, inputCls, Modal, Msg, MsgState, okMsg, PageHeader, PRIMARY, SECONDARY, Table,
} from '../components/common/ui';

const NEEDS_PERIOD = ['attrition', 'joiners-leavers', 'leave'];
const NEEDS_MONTH = ['attendance', 'payroll-register', 'payroll-cost'];

export const ReportsPage: React.FC = () => {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<any[]>([]);
  const [key, setKey] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({ month: new Date().toISOString().slice(0, 7), from: `${new Date().getFullYear()}-01-01`, to: new Date().toISOString().slice(0, 10) });
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<MsgState>(null);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [sched, setSched] = useState<any>(null);

  useEffect(() => {
    api.get<any>('/reports').then((r) => { setCatalog(r.reports); if (r.reports[0]) setKey(r.reports[0].key); }).catch((e) => setMsg(errMsg(e)));
    loadSchedules();
  }, []);
  const loadSchedules = () => api.get<any>('/reports-schedules').then((r) => setSchedules(r.schedules)).catch(() => undefined);

  const qs = () => {
    const p = new URLSearchParams();
    if (NEEDS_PERIOD.includes(key)) { p.set('from', filters.from); p.set('to', filters.to); }
    if (NEEDS_MONTH.includes(key)) p.set('month', filters.month);
    ['department', 'location', 'groupBy'].forEach((k) => filters[k] && p.set(k, filters[k]));
    return p.toString();
  };
  const run = () => api.get<any>(`/reports/${key}?${qs()}`).then(setData).catch((e) => { setData(null); setMsg(errMsg(e)); });
  useEffect(() => { if (key) run(); }, [key]);

  const pdf = () => {
    if (!data) return;
    const doc = new jsPDF({ orientation: data.columns.length > 6 ? 'landscape' : 'portrait' });
    doc.setFontSize(12);
    doc.text(`${data.title} (${data.scope.toLowerCase()} scope)`, 14, 14);
    doc.setFontSize(8);
    doc.text(`Generated ${fmtDate(data.generatedAt)} by ${user?.firstName} ${user?.lastName}${data.masked.length ? ` · masked: ${data.masked.join(', ')}` : ''}`, 14, 20);
    autoTable(doc, { startY: 24, head: [data.columns], body: data.rows.map((r: any) => data.columns.map((c: string) => String(r[c] ?? ''))), styles: { fontSize: 7 } });
    doc.save(`${key}.pdf`);
    // the server logs every export; the PDF is built from the same scoped, masked rows
    downloadApiFile(`/reports/${key}/export?${qs()}`, `${key}.csv`).catch(() => undefined);
  };

  const createSchedule = async () => {
    try {
      await api.post('/reports-schedules', { reportKey: sched.reportKey, frequency: sched.frequency, recipients: sched.recipients.split(',').map((s: string) => s.trim()).filter(Boolean) });
      setSched(null);
      setMsg(okMsg('Report scheduled.'));
      loadSchedules();
    } catch (e) { setMsg(errMsg(e)); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Reports and exports follow your access: your team, your own data, or the whole organisation. Sensitive fields are masked for roles that may not see them; every export is logged." />
      <Msg msg={msg} />
      <div className={card}>
        <div className="flex flex-wrap gap-2 items-end text-xs">
          <label>Report<select className={inputCls + ' w-60'} value={key} onChange={(e) => setKey(e.target.value)}>{catalog.map((c) => <option key={c.key} value={c.key}>{c.title} ({c.scope.toLowerCase()})</option>)}</select></label>
          {NEEDS_PERIOD.includes(key) && <><label>From<input type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
            <label>To<input type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label></>}
          {NEEDS_MONTH.includes(key) && <label>Month<input type="month" className={inputCls} value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })} /></label>}
          {key === 'headcount' && <label>Group by<select className={inputCls} value={filters.groupBy || 'department'} onChange={(e) => setFilters({ ...filters, groupBy: e.target.value })}><option value="department">Department</option><option value="location">Location</option><option value="designation">Designation</option></select></label>}
          {key !== 'my-statement' && <label>Department<input className={inputCls} placeholder="All" value={filters.department || ''} onChange={(e) => setFilters({ ...filters, department: e.target.value })} /></label>}
          <button className={btn(PRIMARY)} onClick={run}>Run</button>
          {data && <button className={btn(SECONDARY)} onClick={() => downloadApiFile(`/reports/${key}/export?${qs()}`, `${key}.csv`).catch((e) => setMsg(errMsg(e)))}>Export CSV</button>}
          {data && <button className={btn(SECONDARY)} onClick={pdf}>Export PDF</button>}
          {!isReadOnlyRole(user?.role) && key !== 'my-statement' && <button className={btn(SECONDARY)} onClick={() => setSched({ reportKey: key, frequency: 'MONTHLY', recipients: user?.email || '' })}>Schedule by email</button>}
        </div>
        {data && (
          <>
            <p className="text-xs text-slate-500">{data.rows.length} rows · scope {data.scope.toLowerCase()}{data.masked.length ? ` · masked for your role: ${data.masked.join(', ')}` : ''}</p>
            <Table rows={data.rows} rowKey={(_, i) => String(i)} cols={data.columns.map((c: string) => ({ key: c, label: c.replace(/([A-Z])/g, ' $1') }))} />
          </>
        )}
      </div>
      {schedules.length > 0 && (
        <div className={card}>
          <h3 className="font-bold text-sm">Scheduled reports</h3>
          <Table rows={schedules} cols={[
            { key: 'title', label: 'Report' }, { key: 'frequency', label: 'Frequency' }, { key: 'recipients', label: 'Recipients', render: (s) => s.recipients.join(', ') },
            { key: 'lastRunAt', label: 'Last sent', render: (s) => fmtDate(s.lastRunAt) }, { key: 'active', label: 'Status', render: (s) => <Badge s={s.active ? 'ACTIVE' : 'CANCELLED'} /> },
            { key: 'a', label: '', render: (s) => <button className={btn(SECONDARY)} onClick={() => api.post<any>(`/reports-schedules/${s._id}/run`).then((r) => setMsg(okMsg(`Sent to ${r.results.filter((x: any) => x.sent).length} recipient(s).`))).catch((e) => setMsg(errMsg(e)))}>Send now</button> },
          ]} />
        </div>
      )}
      {sched && (
        <Modal title="Schedule report by email" onClose={() => setSched(null)}>
          <div className="space-y-2 text-xs">
            <label className="block">Frequency<select className={inputCls} value={sched.frequency} onChange={(e) => setSched({ ...sched, frequency: e.target.value })}><option>DAILY</option><option>WEEKLY</option><option>MONTHLY</option></select></label>
            <label className="block">Recipients (HRMS user emails, comma separated)<input className={inputCls} value={sched.recipients} onChange={(e) => setSched({ ...sched, recipients: e.target.value })} /></label>
            <p className="text-slate-500">Reports go only to HRMS users who are allowed to see this report; each gets their own scope and masking.</p>
          </div>
          <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={createSchedule}>Schedule</button></div>
        </Modal>
      )}
    </div>
  );
};

export default ReportsPage;
