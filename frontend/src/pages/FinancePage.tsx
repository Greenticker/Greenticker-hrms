import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { employeeService } from '../services/employeeService';
import { Employee } from '../types/employee';
import {
  Badge, BAD, btn, card, downloadApiFile, errMsg, fmtDate, fmtMoney, GOOD, inputCls, Modal, Msg, MsgState, okMsg, PageHeader, PRIMARY, SECONDARY,
  Table, Tabs,
} from '../components/common/ui';

type Tab = 'journals' | 'gl' | 'payments' | 'loans' | 'recon' | 'periods';
const thisMonth = () => new Date().toISOString().slice(0, 7);

export const FinancePage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role || '';
  const isAccounts = role === 'ACCOUNTS';
  const isFinance = role === 'FINANCE';
  const [tab, setTab] = useState<Tab>('journals');
  const [msg, setMsg] = useState<MsgState>(null);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'journals', label: 'Journals' }, { id: 'gl', label: 'GL mapping' }, { id: 'payments', label: 'Claim payments' },
    { id: 'loans', label: 'Loans & advances' }, { id: 'recon', label: 'Bank reconciliation' }, { id: 'periods', label: 'Period close' },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Finance & Accounting"
        subtitle={isAccounts ? 'You post journals, reconcile and close periods. Finance approves and releases.' : isFinance ? 'You approve journals and mapping changes, and release payments.' : 'Read-only.'} />
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setMsg(null); }} />
      <Msg msg={msg} />
      {tab === 'journals' && <Journals isAccounts={isAccounts} setMsg={setMsg} />}
      {tab === 'gl' && <GlMapping canPropose={isAccounts || isFinance} setMsg={setMsg} />}
      {tab === 'payments' && <Payments isAccounts={isAccounts} setMsg={setMsg} />}
      {tab === 'loans' && <Loans isFinance={isFinance} setMsg={setMsg} />}
      {tab === 'recon' && <Recon isAccounts={isAccounts} setMsg={setMsg} />}
      {tab === 'periods' && <Periods isAccounts={isAccounts} isFinance={isFinance} setMsg={setMsg} />}
    </div>
  );
};

type SetMsg = { setMsg: (m: MsgState) => void };

const Journals: React.FC<{ isAccounts: boolean } & SetMsg> = ({ isAccounts, setMsg }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [month, setMonth] = useState(thisMonth());
  const [open, setOpen] = useState<any>(null);
  const load = () => api.get<{ journals: any[] }>('/finance/journals').then((r) => setRows(r.journals)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  const act = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      setMsg(okMsg(ok));
      setOpen(null);
      load();
    } catch (e: any) {
      setMsg(errMsg(e));
    }
  };
  return (
    <div className={card}>
      {isAccounts && (
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs">Month<input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <button className={btn(PRIMARY)} onClick={() => act(() => api.post('/finance/journals/payroll', { month }), 'Payroll journal created; waiting for Finance approval.')}>Generate payroll JV</button>
          <button className={btn(SECONDARY)} onClick={() => act(() => api.post('/finance/provisions', { month }), 'Provision journal created.')}>Month-end provisions</button>
        </div>
      )}
      <Table rows={rows} empty="No journals yet." cols={[
        { key: 'number', label: 'Voucher', render: (j) => <button className="underline decoration-dotted" onClick={() => setOpen(j)}>{j.number}</button> },
        { key: 'type', label: 'Type' }, { key: 'month', label: 'Month' },
        { key: 'totalDebit', label: 'Debit', right: true, render: (j) => fmtMoney(j.totalDebit) },
        { key: 'totalCredit', label: 'Credit', right: true, render: (j) => fmtMoney(j.totalCredit) },
        { key: 'createdBy', label: 'Prepared by' }, { key: 'approvedBy', label: 'Approved by', render: (j) => j.approvedBy || '—' },
        { key: 'status', label: 'Status', render: (j) => <Badge s={j.status} /> },
      ]} />
      {open && (
        <Modal title={`${open.number} — ${open.narration}`} onClose={() => setOpen(null)} wide>
          <Table rows={open.lines} rowKey={(_, i) => String(i)} cols={[
            { key: 'glCode', label: 'GL' }, { key: 'glName', label: 'Account' }, { key: 'costCenter', label: 'Cost centre' },
            { key: 'debit', label: 'Debit', right: true, render: (l: any) => (l.debit ? fmtMoney(l.debit) : '') },
            { key: 'credit', label: 'Credit', right: true, render: (l: any) => (l.credit ? fmtMoney(l.credit) : '') },
          ]} />
          <p className="text-xs font-bold">Total Dr ₹{fmtMoney(open.totalDebit)} = Cr ₹{fmtMoney(open.totalCredit)}</p>
          {open.costCenters && (
            <Table rows={open.costCenters} rowKey={(c: any) => c.costCenter} cols={[
              { key: 'costCenter', label: 'Cost centre' }, { key: 'headcount', label: 'Headcount', right: true },
              { key: 'gross', label: 'Gross', right: true, render: (c: any) => fmtMoney(c.gross) }, { key: 'net', label: 'Net', right: true, render: (c: any) => fmtMoney(c.net) },
            ]} />
          )}
          <div className="flex flex-wrap gap-2 justify-end">
            {open.canApprove && <button className={btn(GOOD)} onClick={() => act(() => api.post(`/finance/journals/${open._id}/approve`), 'Journal posted.')}>Approve & post</button>}
            {open.canApprove && <button className={btn(BAD)} onClick={() => { const c = window.prompt('Reason?'); if (c) act(() => api.post(`/finance/journals/${open._id}/reject`, { comment: c }), 'Journal rejected.'); }}>Reject</button>}
            {isAccounts && open.status === 'POSTED' && <button className={btn(SECONDARY)} onClick={() => act(() => api.post(`/finance/journals/${open._id}/reverse`, {}), 'Reversal created for next month.')}>Reverse</button>}
            {open.status === 'POSTED' && <button className={btn(SECONDARY)} onClick={() => downloadApiFile(`/finance/journals/${open._id}/export?format=tally`, `${open.number}.xml`).catch((e) => setMsg(errMsg(e)))}>Tally XML</button>}
            {open.status === 'POSTED' && <button className={btn(SECONDARY)} onClick={() => downloadApiFile(`/finance/journals/${open._id}/export?format=csv`, `${open.number}.csv`).catch((e) => setMsg(errMsg(e)))}>CSV</button>}
          </div>
        </Modal>
      )}
    </div>
  );
};

const GlMapping: React.FC<{ canPropose: boolean } & SetMsg> = ({ canPropose, setMsg }) => {
  const [data, setData] = useState<{ mappings: any[]; changes: any[] }>({ mappings: [], changes: [] });
  const [f, setF] = useState({ component: '', glCode: '', glName: '', side: 'DR' });
  const load = () => api.get<any>('/finance/gl-mappings').then(setData).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  const propose = async () => {
    try {
      await api.post('/finance/gl-mappings/changes', f);
      setMsg(okMsg('Change sent for approval; it applies once another Finance user approves it.'));
      load();
    } catch (e) { setMsg(errMsg(e)); }
  };
  const decide = async (id: string, decision: string) => {
    try { await api.post(`/finance/gl-mappings/changes/${id}/decide`, { decision }); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      {canPropose && (
        <div className={card}>
          <h3 className="font-bold text-sm">Propose a mapping change</h3>
          <div className="grid md:grid-cols-5 gap-2">
            <input className={inputCls} placeholder="Pay component (e.g. NIGHT)" value={f.component} onChange={(e) => setF({ ...f, component: e.target.value.toUpperCase() })} />
            <input className={inputCls} placeholder="GL code" value={f.glCode} onChange={(e) => setF({ ...f, glCode: e.target.value })} />
            <input className={inputCls} placeholder="GL name" value={f.glName} onChange={(e) => setF({ ...f, glName: e.target.value })} />
            <select className={inputCls} value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}><option value="DR">Expense (Dr)</option><option value="CR">Liability (Cr)</option></select>
            <button className={btn(PRIMARY)} onClick={propose}>Send for approval</button>
          </div>
        </div>
      )}
      {data.changes.some((c) => c.status === 'PENDING') && (
        <div className={card}>
          <h3 className="font-bold text-sm">Changes waiting for approval</h3>
          <Table rows={data.changes.filter((c) => c.status === 'PENDING')} cols={[
            { key: 'component', label: 'Component' }, { key: 'new', label: 'New', render: (c) => `${c.glCode} ${c.glName}` },
            { key: 'old', label: 'Current', render: (c) => (c.old ? `${c.old.glCode} ${c.old.glName}` : 'unmapped') },
            { key: 'requestedBy', label: 'Requested by' },
            { key: 'a', label: '', render: (c) => c.canApprove && <div className="flex gap-1"><button className={btn(GOOD)} onClick={() => decide(c._id, 'APPROVED')}>Approve</button><button className={btn(BAD)} onClick={() => decide(c._id, 'REJECTED')}>Reject</button></div> },
          ]} />
        </div>
      )}
      <div className={card}>
        <Table rows={data.mappings} rowKey={(m) => m.component} cols={[
          { key: 'component', label: 'Pay component' }, { key: 'glCode', label: 'GL code' }, { key: 'glName', label: 'GL account' },
          { key: 'side', label: 'Side' }, { key: 'approvedBy', label: 'Approved by' },
        ]} />
      </div>
    </div>
  );
};

const Payments: React.FC<{ isAccounts: boolean } & SetMsg> = ({ isAccounts, setMsg }) => {
  const [claims, setClaims] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const load = () => {
    api.get<any>('/expenses?status=VERIFIED').then((r) => setClaims(r.claims.filter((c: any) => c.paymentMode === 'BANK' && !c.batchId))).catch(() => setClaims([]));
    api.get<any>('/finance/payment-batches').then((r) => setBatches(r.batches)).catch((e) => setMsg(errMsg(e)));
  };
  useEffect(load, []);
  const prepare = async () => {
    try { await api.post('/finance/payment-batches', { claimIds: sel }); setSel([]); setMsg(okMsg('Payment batch prepared for Finance to release.')); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  const release = async (id: string) => {
    const reference = window.prompt('Bank payment reference / UTR');
    if (!reference) return;
    try { await api.post(`/finance/payment-batches/${id}/release`, { reference }); setMsg(okMsg('Payment released; claims marked paid.')); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="font-bold text-sm">Verified claims to pay by bank</h3>
        <Table rows={claims} cols={[
          { key: 's', label: '', render: (c) => isAccounts && <input type="checkbox" aria-label={`Select ${c.title}`} checked={sel.includes(c._id)} onChange={(e) => setSel(e.target.checked ? [...sel, c._id] : sel.filter((x) => x !== c._id))} /> },
          { key: 'employeeName', label: 'Employee' }, { key: 'title', label: 'Claim' }, { key: 'amount', label: 'Amount', right: true, render: (c) => fmtMoney(c.amount) },
        ]} />
        {isAccounts && <div className="flex justify-end"><button className={btn(PRIMARY)} disabled={!sel.length} onClick={prepare}>Prepare payment batch</button></div>}
      </div>
      <div className={card}>
        <h3 className="font-bold text-sm">Payment batches</h3>
        <Table rows={batches} cols={[
          { key: 'preparedAt', label: 'Prepared', render: (b) => fmtDate(b.preparedAt) }, { key: 'count', label: 'Claims', right: true },
          { key: 'total', label: 'Total', right: true, render: (b) => fmtMoney(b.total) }, { key: 'preparedBy', label: 'Prepared by' },
          { key: 'releasedBy', label: 'Released by', render: (b) => b.releasedBy || '—' }, { key: 'status', label: 'Status', render: (b) => <Badge s={b.status} /> },
          { key: 'a', label: '', render: (b) => b.canRelease && <button className={btn(GOOD)} onClick={() => release(b._id)}>Release</button> },
        ]} />
      </div>
    </div>
  );
};

const Loans: React.FC<{ isFinance: boolean } & SetMsg> = ({ isFinance, setMsg }) => {
  const [loans, setLoans] = useState<any[]>([]);
  const [emps, setEmps] = useState<Employee[]>([]);
  const [f, setF] = useState({ employeeId: '', principal: '', tenureMonths: '6', startMonth: thisMonth(), type: 'LOAN', reason: '' });
  const load = () => api.get<any>('/finance/loans').then((r) => setLoans(r.loans)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); if (isFinance) employeeService.getEmployees().then((r) => setEmps(r.employees || [])).catch(() => undefined); }, [isFinance]);
  const sanction = async () => {
    try { await api.post('/finance/loans', { ...f, principal: Number(f.principal), tenureMonths: Number(f.tenureMonths) }); setMsg(okMsg('Sanctioned; EMIs are added to payroll.')); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      {isFinance && (
        <div className={card}>
          <h3 className="font-bold text-sm">Sanction a loan / advance</h3>
          <div className="grid md:grid-cols-7 gap-2">
            <select className={inputCls} aria-label="Employee" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
              <option value="">Employee…</option>{emps.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
            </select>
            <select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="LOAN">Loan</option><option value="ADVANCE">Salary advance</option></select>
            <input className={inputCls} type="number" placeholder="Amount" value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} />
            <input className={inputCls} type="number" placeholder="Instalments" value={f.tenureMonths} onChange={(e) => setF({ ...f, tenureMonths: e.target.value })} />
            <input className={inputCls} type="month" value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: e.target.value })} />
            <input className={inputCls} placeholder="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            <button className={btn(PRIMARY)} onClick={sanction}>Sanction</button>
          </div>
        </div>
      )}
      <div className={card}>
        <Table rows={loans} cols={[
          { key: 'employeeName', label: 'Employee' }, { key: 'type', label: 'Type' }, { key: 'principal', label: 'Amount', right: true, render: (l) => fmtMoney(l.principal) },
          { key: 'emi', label: 'EMI', right: true, render: (l) => fmtMoney(l.emi) }, { key: 'startMonth', label: 'From' },
          { key: 'recovered', label: 'Recovered', right: true, render: (l) => fmtMoney(l.recovered) },
          { key: 'outstanding', label: 'Outstanding', right: true, render: (l) => fmtMoney(l.outstanding) }, { key: 'status', label: 'Status', render: (l) => <Badge s={l.status} /> },
        ]} />
      </div>
    </div>
  );
};

const Recon: React.FC<{ isAccounts: boolean } & SetMsg> = ({ isAccounts, setMsg }) => {
  const [recons, setRecons] = useState<any[]>([]);
  const [month, setMonth] = useState(thisMonth());
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState<any>(null);
  const load = () => api.get<any>('/finance/bank-recon').then((r) => setRecons(r.recons)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  const upload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('month', month);
    fd.append('file', file);
    try { const r = await api.upload<any>('/finance/bank-recon', fd); setOpen(r.recon); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className={card}>
      {isAccounts && (
        <div className="flex flex-wrap gap-2 items-end text-xs">
          <label>Salary month<input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <label>Bank statement CSV (accountNumber, amount, status, reference)<input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          <button className={btn(PRIMARY)} disabled={!file} onClick={upload}>Reconcile</button>
        </div>
      )}
      <Table rows={recons} cols={[
        { key: 'month', label: 'Month' }, { key: 'fileName', label: 'File' }, { key: 'at', label: 'When', render: (r) => fmtDate(r.at) },
        { key: 'm', label: 'Matched', right: true, render: (r) => r.summary.matched }, { key: 'f', label: 'Failed', right: true, render: (r) => r.summary.failed },
        { key: 'u', label: 'Unmatched', right: true, render: (r) => r.summary.unmatched },
        { key: 'o', label: '', render: (r) => <button className={btn(SECONDARY)} onClick={() => setOpen(r)}>Details</button> },
      ]} />
      {open && (
        <Modal title={`Reconciliation ${open.month}`} onClose={() => setOpen(null)} wide>
          {(['failed', 'unmatched', 'unexpected', 'matched'] as const).map((k) => (
            <div key={k}>
              <h4 className="font-semibold text-xs capitalize mb-1">{k} ({open[k].length})</h4>
              <Table rows={open[k]} rowKey={(_, i) => `${k}${i}`} cols={[
                { key: 'employeeName', label: 'Employee', render: (r: any) => r.employeeName || '—' }, { key: 'accountNumber', label: 'Account' },
                { key: 'amount', label: 'Amount', right: true, render: (r: any) => fmtMoney(r.amount) }, { key: 'reason', label: 'Note', render: (r: any) => r.reason || r.reference || '' },
              ]} />
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
};

const Periods: React.FC<{ isAccounts: boolean; isFinance: boolean } & SetMsg> = ({ isAccounts, isFinance, setMsg }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [month, setMonth] = useState(thisMonth());
  const load = () => api.get<any>('/finance/periods').then((r) => setRows(r.periods)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  return (
    <div className={card}>
      {isAccounts && (
        <div className="flex gap-2 items-end text-xs">
          <label>Month<input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <button className={btn(PRIMARY)} onClick={() => api.post(`/finance/periods/${month}/close`).then(() => { setMsg(okMsg(`${month} closed; no more postings.`)); load(); }).catch((e) => setMsg(errMsg(e)))}>Close period</button>
        </div>
      )}
      <Table rows={rows} cols={[
        { key: '_id', label: 'Month' }, { key: 'status', label: 'Status', render: (p) => <Badge s={p.status} /> }, { key: 'closedBy', label: 'Closed by' },
        { key: 'closedAt', label: 'Closed at', render: (p) => fmtDate(p.closedAt) }, { key: 'reopenReason', label: 'Reopened', render: (p) => p.reopenReason || '—' },
        { key: 'a', label: '', render: (p) => isFinance && p.status === 'CLOSED' && <button className={btn(SECONDARY)} onClick={() => { const reason = window.prompt('Why reopen?'); if (reason) api.post(`/finance/periods/${p._id}/reopen`, { reason }).then(load).catch((e) => setMsg(errMsg(e))); }}>Reopen</button> },
      ]} />
    </div>
  );
};

export default FinancePage;
