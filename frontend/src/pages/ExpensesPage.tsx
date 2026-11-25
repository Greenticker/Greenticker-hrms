import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { isReadOnlyRole } from '../utils/access';
import {
  Badge, BAD, btn, card, errMsg, fmtMoney, GOOD, inputCls, Modal, Msg, MsgState, okMsg, openApiFile, PageHeader, PRIMARY, SECONDARY, Table, Tabs,
} from '../components/common/ui';
import { Plus } from 'lucide-react';

interface Claim {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  title: string;
  category: string;
  amount: number;
  expenseDate: string;
  billNumber?: string;
  description?: string;
  receipt?: { fileName: string; fileUrl: string } | null;
  receiptName?: string;
  status: string;
  approverId?: string;
  duplicateFlag?: string | null;
  paymentMode?: string;
  payrollMonth?: string;
  paymentReference?: string;
  canManagerDecide: boolean;
  canFinanceDecide: boolean;
  history?: { action: string; by: string; at: string; comment?: string }[];
}

type Tab = 'mine' | 'approvals' | 'all' | 'limits';
const ALL_ROLES = ['FINANCE', 'ACCOUNTS', 'AUDITORS'];
const CONFIG_ROLES = ['ADMIN', 'SUPER_ADMIN', 'FINANCE'];

export const ExpensesPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role || '';
  const hasEmployee = !!(user?.employee || user?.employeeId);
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [];
    if (hasEmployee && !isReadOnlyRole(role)) t.push({ id: 'mine', label: 'My claims' }, { id: 'approvals', label: 'Approvals' });
    if (ALL_ROLES.includes(role)) t.push({ id: 'all', label: 'All claims' });
    t.push({ id: 'limits', label: 'Claim limits' });
    return t;
  }, [hasEmployee, role]);
  const [tab, setTab] = useState<Tab>(tabs[0].id);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<MsgState>(null);
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState<Claim | null>(null);

  const load = () => {
    const scope = tab === 'mine' ? 'mine' : tab === 'approvals' ? 'approvals' : 'auto';
    api.get<{ claims: Claim[]; limits: Record<string, number> }>(`/expenses?scope=${scope}`)
      .then((r) => { setClaims(r.claims); setLimits(r.limits); })
      .catch((e) => setMsg(errMsg(e)));
  };
  useEffect(load, [tab]);

  const decide = async (c: Claim, stage: 'manager' | 'finance', decision: string, extra: Record<string, unknown> = {}) => {
    let comment = '';
    if (decision === 'REJECTED') {
      comment = window.prompt('Reason for rejecting?') || '';
      if (!comment.trim()) return;
    }
    try {
      await api.put(`/expenses/${c._id}/${stage}-decision`, { decision, comment, ...extra });
      setMsg(okMsg(`Claim ${decision.toLowerCase()}.`));
      setOpen(null);
      load();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Expense claims" subtitle="Submit claims with the bill. Your manager approves, Finance verifies, and payment goes through payroll or a bank batch.">
        {tab === 'mine' && <button className={btn(PRIMARY)} onClick={() => setShow(true)}><Plus className="w-3 h-3 inline" /> New claim</button>}
      </PageHeader>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <Msg msg={msg} />
      {tab === 'limits' ? (
        <LimitsPanel limits={limits} canEdit={CONFIG_ROLES.includes(role)} onSaved={(l) => { setLimits(l); setMsg(okMsg('Limits saved.')); }} setMsg={setMsg} />
      ) : (
        <div className={card}>
          <Table<Claim>
            rows={claims}
            empty="No claims."
            cols={[
              { key: 'employeeName', label: 'Employee', render: (c) => <>{c.employeeName}<div className="text-slate-400">{c.employeeCode}</div></> },
              { key: 'title', label: 'Claim', render: (c) => <button className="text-left underline decoration-dotted" onClick={() => setOpen(c)}>{c.title}</button> },
              { key: 'category', label: 'Category' },
              { key: 'expenseDate', label: 'Date' },
              { key: 'billNumber', label: 'Bill no.', render: (c) => <>{c.billNumber || '—'}{c.duplicateFlag && <div className="text-rose-600 font-semibold">Duplicate bill</div>}</> },
              { key: 'amount', label: 'Amount', right: true, render: (c) => fmtMoney(c.amount) },
              { key: 'status', label: 'Status', render: (c) => <Badge s={c.status} /> },
              {
                key: 'act', label: '', render: (c) => (
                  <div className="flex gap-1 justify-end">
                    {c.canManagerDecide && <><button className={btn(GOOD)} onClick={() => decide(c, 'manager', 'APPROVED')}>Approve</button><button className={btn(BAD)} onClick={() => decide(c, 'manager', 'REJECTED')}>Reject</button></>}
                    {c.canFinanceDecide && <button className={btn(PRIMARY)} onClick={() => setOpen(c)}>Verify</button>}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}
      {show && <ClaimForm limits={limits} onClose={() => setShow(false)} onDone={(w) => { setShow(false); setMsg(okMsg(w ? `Claim submitted. Note: ${w}` : 'Claim submitted to your manager.')); load(); }} />}
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)}>
          <div className="text-xs space-y-1">
            <p><b>{open.employeeName}</b> · {open.category} · {open.expenseDate} · ₹{fmtMoney(open.amount)}</p>
            <p>Bill no. {open.billNumber || '—'} {open.receipt && <button className="underline text-indigo-700 ml-2" onClick={() => openApiFile(`/expenses/${open._id}/receipt`).catch((e) => setMsg(errMsg(e)))}>View bill</button>}</p>
            {open.duplicateFlag && <p className="text-rose-700 font-semibold">{open.duplicateFlag}</p>}
            {open.description && <p className="text-slate-600">{open.description}</p>}
            {open.paymentMode && <p>Payment: {open.paymentMode === 'PAYROLL' ? `with ${open.payrollMonth} salary` : 'bank transfer'} {open.paymentReference ? `(ref ${open.paymentReference})` : ''}</p>}
            <ul className="mt-2 border-t pt-2">
              {(open.history || []).map((h, i) => <li key={i}>{h.at.slice(0, 16).replace('T', ' ')} — {h.action.replace(/_/g, ' ').toLowerCase()} by {h.by}{h.comment ? `: ${h.comment}` : ''}</li>)}
            </ul>
          </div>
          {open.canFinanceDecide && (
            <div className="flex flex-wrap gap-2 justify-end border-t pt-3">
              <button className={btn(GOOD)} onClick={() => decide(open, 'finance', 'VERIFIED', { paymentMode: 'PAYROLL', acceptDuplicate: !!open.duplicateFlag && window.confirm('This bill number was used before. Pay anyway?') })}>Verify · pay with salary</button>
              <button className={btn(SECONDARY)} onClick={() => decide(open, 'finance', 'VERIFIED', { paymentMode: 'BANK', acceptDuplicate: !!open.duplicateFlag && window.confirm('This bill number was used before. Pay anyway?') })}>Verify · bank transfer</button>
              <button className={btn(BAD)} onClick={() => decide(open, 'finance', 'REJECTED')}>Reject</button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};

const ClaimForm: React.FC<{ limits: Record<string, number>; onClose: () => void; onDone: (warning?: string) => void }> = ({ limits, onClose, onDone }) => {
  const [f, setF] = useState({ title: '', category: Object.keys(limits)[0] || 'TRAVEL', amount: '', expenseDate: new Date().toISOString().slice(0, 10), billNumber: '', description: '' });
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<MsgState>(null);
  const over = Number(f.amount) > (limits[f.category] ?? Infinity);
  const submit = async () => {
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append('receipt', file);
      const r = await api.upload<{ warning?: string }>('/expenses', fd);
      onDone(r.warning);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  return (
    <Modal title="New expense claim" onClose={onClose}>
      <Msg msg={msg} />
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="col-span-2">Title<input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label>Category
          <select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.keys(limits).map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label>Amount (limit ₹{fmtMoney(limits[f.category])})<input className={inputCls} type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label>Expense date<input className={inputCls} type="date" value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></label>
        <label>Bill / invoice no.<input className={inputCls} value={f.billNumber} onChange={(e) => setF({ ...f, billNumber: e.target.value })} /></label>
        <label className="col-span-2">Description<textarea className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="col-span-2">Bill (PDF / image)<input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
      </div>
      {over && <p className="text-xs text-rose-700">The amount is above the {f.category.toLowerCase()} limit.</p>}
      <div className="flex justify-end"><button className={btn(PRIMARY)} disabled={over} onClick={submit}>Submit</button></div>
    </Modal>
  );
};

const LimitsPanel: React.FC<{ limits: Record<string, number>; canEdit: boolean; onSaved: (l: Record<string, number>) => void; setMsg: (m: MsgState) => void }> = ({ limits, canEdit, onSaved, setMsg }) => {
  const [l, setL] = useState<Record<string, string>>({});
  useEffect(() => setL(Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, String(v)]))), [limits]);
  const save = async () => {
    try {
      const r = await api.put<{ settings: { claimLimits: Record<string, number> } }>('/finance/settings', { claimLimits: l });
      onSaved(r.settings.claimLimits);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  return (
    <div className={card}>
      <p className="text-xs text-slate-500">Maximum amount per claim, by category.</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
        {Object.keys(l).map((k) => (
          <label key={k}>{k.replace(/_/g, ' ')}<input className={inputCls} type="number" disabled={!canEdit} value={l[k]} onChange={(e) => setL({ ...l, [k]: e.target.value })} /></label>
        ))}
      </div>
      {canEdit && <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={save}>Save limits</button></div>}
    </div>
  );
};

export default ExpensesPage;
