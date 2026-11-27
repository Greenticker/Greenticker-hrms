import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '../context/AuthContext';
import { employeeService } from '../services/employeeService';
import { request } from '../services/api';
import {
  payrollService,
  PayslipFull,
  PayrollRun,
  PayrollException,
  SalaryRevision,
  SalaryStructureDef,
  StructureComponent,
  DeclarationView,
} from '../services/payrollService';
import { Employee } from '../types/employee';
import { apiErrorMessages } from '../utils/access';
import { Download, Eye, FileText, Lock, Plus, X } from 'lucide-react';

const fmt = (n: number | undefined) =>
  (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thisMonth = () => new Date().toISOString().slice(0, 7);
const inputCls = 'w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/25';
const btn = (tone: string) => `px-3 py-1.5 rounded-lg font-semibold text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${tone}`;
const card = 'bg-white border border-slate-200 rounded-2xl p-5 space-y-4';

const MAKER = ['HR'];
const CHECKER = ['FINANCE'];
const READ_ALL = ['HR', 'FINANCE', 'AUDITORS'];
const TAX_VERIFIERS = ['HR', 'FINANCE'];

const STATUS_STYLE: Record<string, string> = {
  NONE: 'bg-slate-100 text-slate-600',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PAID: 'bg-indigo-100 text-indigo-800',
  REJECTED: 'bg-rose-100 text-rose-800',
  REOPENED: 'bg-sky-100 text-sky-800',
  VERIFIED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  SUBMITTED: 'bg-amber-100 text-amber-800',
};

const Badge: React.FC<{ s: string }> = ({ s }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_STYLE[s] || 'bg-slate-100 text-slate-600'}`}>{s.replace(/_/g, ' ')}</span>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className={`bg-white rounded-2xl ${wide ? 'max-w-4xl' : 'max-w-lg'} w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto`}>
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

const Msg: React.FC<{ msg: { ok: boolean; text: string[] } | null }> = ({ msg }) =>
  msg && msg.text.length ? (
    <div
      role={msg.ok ? 'status' : 'alert'}
      className={`p-3 rounded-xl text-xs border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}
    >
      {msg.text.length === 1 ? msg.text[0] : <ul className="list-disc pl-4">{msg.text.map((t) => <li key={t}>{t}</li>)}</ul>}
    </div>
  ) : null;

type MsgState = { ok: boolean; text: string[] } | null;
const okMsg = (t: string): MsgState => ({ ok: true, text: [t] });
const errMsg = (e: any): MsgState => ({ ok: false, text: apiErrorMessages(e) });

const earningsOf = (p: PayslipFull) =>
  p.earnings?.length
    ? p.earnings
    : [
        { code: 'BASIC', name: 'Basic', amount: p.basicSalary || 0 },
        { code: 'HRA', name: 'HRA', amount: p.hra || 0 },
        { code: 'SPECIAL', name: 'Special allowance', amount: p.specialAllowance || 0 },
        { code: 'CONVEYANCE', name: 'Conveyance', amount: p.conveyanceAllowance || 0 },
      ].filter((l) => l.amount);
const deductionsOf = (p: PayslipFull) =>
  p.deductions?.length
    ? p.deductions
    : [
        { code: 'PF', name: 'Provident fund', amount: p.providentFund || 0 },
        { code: 'PT', name: 'Professional tax', amount: p.professionalTax || 0 },
        { code: 'TDS', name: 'Income tax (TDS)', amount: p.tds || 0 },
        { code: 'OTHER', name: 'Other deductions', amount: p.otherDeductions || 0 },
      ].filter((l) => l.amount);

/** Builds the payslip PDF. With a password, the file opens only with that password. */
function payslipPdf(p: PayslipFull, password?: string) {
  const doc = password
    ? new jsPDF({ encryption: { userPassword: password, ownerPassword: `${password}#owner`, userPermissions: ['print'] } })
    : new jsPDF();
  doc.setFontSize(14);
  doc.text('Payslip', 14, 16);
  doc.setFontSize(10);
  doc.text(`${p.monthName} (${p.month})`, 14, 23);
  autoTable(doc, {
    startY: 28,
    theme: 'plain',
    styles: { fontSize: 9 },
    body: [
      ['Employee', `${p.employeeName} (${p.employeeCode})`, 'Designation', p.designation || '-'],
      ['Department', p.department || '-', 'PAN', p.panNumber || '-'],
      ['UAN', p.pfUan || '-', 'Bank account', p.bankAccountNumber || '-'],
      ['Days in month', String(p.daysInMonth ?? '-'), 'Paid days', `${p.workedDays} (LOP ${p.lopDays})`],
    ],
  });
  const e = earningsOf(p);
  const d = deductionsOf(p);
  const rows = Array.from({ length: Math.max(e.length, d.length) }, (_, i) => [
    e[i]?.name || '',
    e[i] ? fmt(e[i].amount) : '',
    d[i]?.name || '',
    d[i] ? fmt(d[i].amount) : '',
  ]);
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 6,
    head: [['Earnings', 'Amount (INR)', 'Deductions', 'Amount (INR)']],
    body: [...rows, ['Gross earnings', fmt(p.grossSalary), 'Total deductions', fmt(p.totalDeductions)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  const y = (doc as any).lastAutoTable.finalY + 10;
  doc.setFontSize(12);
  doc.text(`Net pay: INR ${fmt(p.netSalary)}`, 14, y);
  doc.setFontSize(8);
  doc.text('This is a system-generated payslip and does not need a signature.', 14, y + 8);
  doc.save(`payslip_${p.employeeCode}_${p.month}.pdf`);
}

const PayslipView: React.FC<{ p: PayslipFull }> = ({ p }) => {
  const e = earningsOf(p);
  const d = deductionsOf(p);
  return (
    <div className="space-y-4 text-xs">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><span className="text-slate-500 block">Employee</span><b>{p.employeeName}</b> ({p.employeeCode})</div>
        <div><span className="text-slate-500 block">Month</span><b>{p.monthName}</b></div>
        <div><span className="text-slate-500 block">Paid days</span><b>{p.workedDays}</b> / {p.daysInMonth ?? '-'} (LOP {p.lopDays})</div>
        <div><span className="text-slate-500 block">Status</span><Badge s={p.status} /></div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <table className="w-full">
          <thead><tr className="text-left text-slate-500 border-b"><th className="py-1">Earnings</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {e.map((l) => <tr key={l.code + l.name}><td className="py-1">{l.name}</td><td className="text-right font-mono">{fmt(l.amount)}</td></tr>)}
            <tr className="border-t font-bold"><td className="py-1">Gross</td><td className="text-right font-mono">{fmt(p.grossSalary)}</td></tr>
          </tbody>
        </table>
        <table className="w-full">
          <thead><tr className="text-left text-slate-500 border-b"><th className="py-1">Deductions</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {d.map((l) => <tr key={l.code + l.name}><td className="py-1">{l.name}</td><td className="text-right font-mono">{fmt(l.amount)}</td></tr>)}
            <tr className="border-t font-bold"><td className="py-1">Total</td><td className="text-right font-mono">{fmt(p.totalDeductions)}</td></tr>
          </tbody>
        </table>
      </div>
      {!!p.employerContributions?.length && (
        <p className="text-slate-500">
          Employer contributions (not part of net pay): {p.employerContributions.map((c) => `${c.name} ₹${fmt(c.amount)}`).join(', ')}
        </p>
      )}
      <div className="p-3 rounded-xl bg-primary text-white flex justify-between font-bold">
        <span>Net pay</span><span className="font-mono">₹{fmt(p.netSalary)}</span>
      </div>
    </div>
  );
};

type Tab = 'mine' | 'tax' | 'run' | 'inputs' | 'revisions' | 'structures' | 'declarations' | 'form16';

export const PayrollPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role || '';
  const hasEmployee = !!(user?.employee || user?.employeeId);
  const isMaker = MAKER.includes(role);
  const isChecker = CHECKER.includes(role);
  const readAll = READ_ALL.includes(role);
  const isAccounts = role === 'ACCOUNTS';
  const canSeeRuns = readAll || isAccounts;

  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [];
    if (hasEmployee) t.push({ id: 'mine', label: 'My payslips' }, { id: 'tax', label: 'My tax declaration' }, { id: 'form16', label: 'Form 16' });
    if (canSeeRuns) t.push({ id: 'run', label: 'Payroll runs' });
    if (readAll) t.push({ id: 'inputs', label: 'Pay inputs' }, { id: 'revisions', label: 'Salary revisions' }, { id: 'structures', label: 'Structures & statutory' });
    if (readAll) t.push({ id: 'declarations', label: 'Tax proofs' });
    if (readAll && !hasEmployee) t.push({ id: 'form16', label: 'Form 16' });
    return t;
  }, [hasEmployee, canSeeRuns, readAll]);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id || 'mine');
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab) && tabs[0]) setTab(tabs[0].id);
  }, [tabs, tab]);

  const [employees, setEmployees] = useState<Employee[]>([]);
  useEffect(() => {
    if (readAll) employeeService.getEmployees().then((r) => setEmployees(r.employees || [])).catch(() => setEmployees([]));
  }, [readAll]);

  if (!tabs.length) {
    return <div className="p-6 text-sm text-slate-600">You do not have access to payroll.</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Payroll</h1>
        <p className="text-xs text-slate-500">
          {isMaker && 'You prepare payroll (maker). Finance approves, locks and releases payment.'}
          {isChecker && 'You approve payroll prepared by HR (checker), release payment and approve salary revisions.'}
          {isAccounts && 'You can see department-level payroll summaries.'}
          {role === 'AUDITORS' && 'Read-only view of payroll.'}
          {!readAll && !isAccounts && 'Your payslips, tax declaration and Form 16.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={btn(tab === t.id ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'mine' && <MyPayslips />}
      {tab === 'tax' && <MyDeclaration />}
      {tab === 'form16' && <Form16Panel employees={readAll ? employees : []} />}
      {tab === 'run' && <RunsPanel isMaker={isMaker} isChecker={isChecker} isAccounts={isAccounts} />}
      {tab === 'inputs' && <InputsPanel employees={employees} isMaker={isMaker} />}
      {tab === 'revisions' && <RevisionsPanel employees={employees} isMaker={isMaker} isChecker={isChecker} />}
      {tab === 'structures' && <StructuresPanel isMaker={isMaker} employees={employees} />}
      {tab === 'declarations' && <DeclarationsPanel canVerify={TAX_VERIFIERS.includes(role)} />}
    </div>
  );
};

// ------------------------------------------------------------------ employee: own payslips

const MyPayslips: React.FC = () => {
  const [slips, setSlips] = useState<PayslipFull[]>([]);
  const [open, setOpen] = useState<PayslipFull | null>(null);
  const [msg, setMsg] = useState<MsgState>(null);
  useEffect(() => {
    payrollService.myPayslips().then((r) => setSlips(r.payslips)).catch((e) => setMsg(errMsg(e)));
  }, []);
  const download = async (id: string) => {
    try {
      const r = await payrollService.payslip(id);
      payslipPdf(r.payslip, r.pdfPassword);
      setMsg(okMsg(`Payslip downloaded. It is password-protected: ${r.pdfPasswordHint}.`));
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  return (
    <div className={card}>
      <Msg msg={msg} />
      {!slips.length ? (
        <p className="text-xs text-slate-500">No payslips yet. Payslips appear here once Finance approves the month's payroll.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b"><th className="py-2">Month</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {slips.map((p) => (
              <tr key={p._id} className="border-b border-slate-100">
                <td className="py-2 font-semibold">{p.monthName}</td>
                <td className="text-right font-mono">{fmt(p.grossSalary)}</td>
                <td className="text-right font-mono">{fmt(p.totalDeductions)}</td>
                <td className="text-right font-mono font-bold">{fmt(p.netSalary)}</td>
                <td><Badge s={p.status} /></td>
                <td className="text-right space-x-2">
                  <button className={btn('bg-slate-100 text-slate-700')} onClick={() => setOpen(p)}><Eye className="w-3 h-3 inline" /> View</button>
                  <button className={btn('bg-primary text-white')} onClick={() => download(p._id)}><Lock className="w-3 h-3 inline" /> PDF</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <Modal title={`Payslip — ${open.monthName}`} onClose={() => setOpen(null)} wide>
          <PayslipView p={open} />
        </Modal>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ employee: investment declaration

const MyDeclaration: React.FC = () => {
  const [decl, setDecl] = useState<DeclarationView | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<MsgState>(null);
  const [proof, setProof] = useState<{ section: string; amount: string; file: File | null } | null>(null);
  const load = (d?: DeclarationView) => {
    const apply = (v: DeclarationView) => {
      setDecl(v);
      setAmounts(Object.fromEntries(v.sections.map((s) => [s.section, s.declared ? String(s.declared) : ''])));
    };
    if (d) apply(d);
    else payrollService.myDeclaration().then((r) => apply(r.declaration)).catch((e) => setMsg(errMsg(e)));
  };
  useEffect(() => load(), []);
  if (!decl) return <div className={card}><Msg msg={msg} /></div>;

  const save = async () => {
    try {
      const items: Record<string, number> = {};
      Object.entries(amounts).forEach(([k, v]) => (items[k] = Number(v) || 0));
      const r = await payrollService.saveDeclaration({ regime: decl.regime, npsOptIn: decl.npsOptIn, items });
      load(r.declaration);
      setMsg(okMsg('Declaration saved. TDS from the next payroll uses it.'));
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  const upload = async () => {
    if (!proof?.file) return setMsg({ ok: false, text: ['Choose the proof file.'] });
    try {
      const r = await payrollService.uploadProof(proof.section, Number(proof.amount) || 0, proof.file);
      load(r.declaration);
      setProof(null);
      setMsg(okMsg('Proof uploaded for verification.'));
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  return (
    <div className={card}>
      <div className="flex flex-wrap gap-4 items-end justify-between">
        <div>
          <h3 className="font-bold text-sm">Investment declaration — FY {decl.fy}</h3>
          <p className="text-xs text-slate-500">
            Declaration window: <b>{decl.declarationOpen ? 'open' : 'closed'}</b>
            {decl.windows?.declaration?.until ? ` (until ${decl.windows.declaration.until})` : ''} · Proof window:{' '}
            <b>{decl.proofOpen ? 'open' : 'closed'}</b>
            {decl.windows?.proof?.until ? ` (until ${decl.windows.proof.until})` : ''}
          </p>
        </div>
        <div className="flex gap-3 items-center text-xs">
          <label className="font-semibold">Tax regime</label>
          <select
            className={inputCls + ' w-32'}
            value={decl.regime}
            disabled={!decl.declarationOpen}
            onChange={(e) => setDecl({ ...decl, regime: e.target.value as 'OLD' | 'NEW', sections: decl.sections.map((s) => ({ ...s, applies: s.section === '80CCD2' || e.target.value === 'OLD' })) })}
          >
            <option value="NEW">New regime</option>
            <option value="OLD">Old regime</option>
          </select>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={decl.npsOptIn} disabled={!decl.declarationOpen} onChange={(e) => setDecl({ ...decl, npsOptIn: e.target.checked })} />
            Employer NPS (80CCD(2))
          </label>
        </div>
      </div>
      <Msg msg={msg} />
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b"><th className="py-2">Section</th><th className="text-right">Limit</th><th className="text-right w-40">Declared</th><th>Proofs</th><th /></tr>
        </thead>
        <tbody>
          {decl.sections.map((s) => (
            <tr key={s.section} className={`border-b border-slate-100 ${s.applies ? '' : 'opacity-40'}`}>
              <td className="py-2">{s.label}</td>
              <td className="text-right font-mono">{s.cap ? fmt(s.cap) : '—'}</td>
              <td className="text-right">
                <input
                  type="number"
                  min={0}
                  aria-label={`Declared ${s.section}`}
                  className={inputCls + ' text-right'}
                  disabled={!decl.declarationOpen || !s.applies}
                  value={amounts[s.section] || ''}
                  onChange={(e) => setAmounts({ ...amounts, [s.section]: e.target.value })}
                />
              </td>
              <td>
                {s.proofs.map((p) => (
                  <div key={p._id}>{p.fileName} ₹{fmt(p.amount)} <Badge s={p.status} />{p.comment ? ` — ${p.comment}` : ''}</div>
                ))}
              </td>
              <td className="text-right">
                {decl.proofOpen && s.applies && (
                  <button className={btn('bg-slate-100 text-slate-700')} onClick={() => setProof({ section: s.section, amount: amounts[s.section] || '', file: null })}>
                    Upload proof
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end">
        <button className={btn('bg-primary text-white')} disabled={!decl.declarationOpen} onClick={save}>Save declaration</button>
      </div>
      {proof && (
        <Modal title={`Upload proof — ${proof.section}`} onClose={() => setProof(null)}>
          <label className="text-xs font-semibold block">Amount</label>
          <input type="number" className={inputCls} value={proof.amount} onChange={(e) => setProof({ ...proof, amount: e.target.value })} />
          <label className="text-xs font-semibold block">File (PDF/JPG/PNG)</label>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setProof({ ...proof, file: e.target.files?.[0] || null })} />
          <div className="flex justify-end"><button className={btn('bg-primary text-white')} onClick={upload}>Upload</button></div>
        </Modal>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ Form 16

const Form16Panel: React.FC<{ employees: Employee[] }> = ({ employees }) => {
  const [empId, setEmpId] = useState('');
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<MsgState>(null);
  const load = () => {
    setMsg(null);
    payrollService.form16(undefined, empId || undefined).then(setData).catch((e) => { setData(null); setMsg(errMsg(e)); });
  };
  useEffect(load, [empId]);
  const pdf = () => {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFontSize(13);
    doc.text(`Form 16 (summary) — FY ${data.fy}`, 14, 16);
    doc.setFontSize(9);
    doc.text(`${data.employee.name} (${data.employee.employeeCode}) · PAN ${data.employee.pan || '-'}`, 14, 23);
    autoTable(doc, { startY: 28, head: [['Part A — Quarter', 'Gross paid', 'TDS deducted']], body: data.partA.quarters.map((q: any) => [q.quarter, fmt(q.gross), fmt(q.tds)]) });
    const b = data.partB;
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 6,
      head: [['Part B', 'Amount (INR)']],
      body: [
        ['Regime', b.regime],
        ['Gross salary', fmt(b.grossSalary)],
        ['Standard deduction', fmt(b.standardDeduction)],
        ['Professional tax', fmt(b.professionalTax)],
        ['Chapter VI-A deductions', fmt(b.chapterVIA)],
        ['Taxable income', fmt(b.taxableIncome)],
        ['Tax on income', fmt(b.taxOnIncome)],
        ['TDS deducted', fmt(b.tdsDeducted)],
      ],
    });
    doc.save(`form16_${data.employee.employeeCode}_${data.fy}.pdf`);
  };
  return (
    <div className={card}>
      {!!employees.length && (
        <div className="max-w-sm">
          <label className="text-xs font-semibold">Employee</label>
          <select className={inputCls} value={empId} onChange={(e) => setEmpId(e.target.value)}>
            <option value="">Myself</option>
            {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
          </select>
        </div>
      )}
      <Msg msg={msg} />
      {data && (
        <div className="space-y-3 text-xs">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm">FY {data.fy} — {data.employee.name}</h3>
            <button className={btn('bg-primary text-white')} onClick={pdf}><Download className="w-3 h-3 inline" /> Download</button>
          </div>
          <table className="w-full">
            <thead><tr className="text-left text-slate-500 border-b"><th className="py-1">Quarter</th><th className="text-right">Gross</th><th className="text-right">TDS</th></tr></thead>
            <tbody>
              {data.partA.quarters.map((q: any) => <tr key={q.quarter}><td className="py-1">{q.quarter}</td><td className="text-right font-mono">{fmt(q.gross)}</td><td className="text-right font-mono">{fmt(q.tds)}</td></tr>)}
            </tbody>
          </table>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(data.partB).map(([k, v]) => (
              <div key={k} className="p-2 bg-slate-50 rounded-lg"><span className="text-slate-500 block">{k}</span><b>{typeof v === 'number' ? fmt(v) : String(v)}</b></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ runs: maker prepares, checker approves / releases

const RunsPanel: React.FC<{ isMaker: boolean; isChecker: boolean; isAccounts: boolean }> = ({ isMaker, isChecker, isAccounts }) => {
  const [month, setMonth] = useState(thisMonth());
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [preview, setPreview] = useState<{ rows: PayslipFull[]; exceptions: PayrollException[]; totals: Record<string, number> } | null>(null);
  const [register, setRegister] = useState<any>(null);
  const [open, setOpen] = useState<PayslipFull | null>(null);
  const [msg, setMsg] = useState<MsgState>(null);
  const [busy, setBusy] = useState(false);

  const loadRuns = () => payrollService.runs().then((r) => setRuns(r.runs)).catch((e) => setMsg(errMsg(e)));
  const loadRegister = (m = month) => payrollService.register(m).then(setRegister).catch(() => setRegister(null));
  useEffect(() => {
    loadRuns();
  }, []);
  useEffect(() => {
    setPreview(null);
    loadRegister(month);
  }, [month]);
  const run = runs.find((r) => r._id === month);

  const act = async (fn: () => Promise<any>, ok: string | ((r: any) => string)) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(okMsg(typeof ok === 'string' ? ok : ok(r)));
      loadRuns();
      loadRegister();
    } catch (e: any) {
      const extra = (e?.data?.exceptions || []).map((x: PayrollException) => `${x.employeeName}: ${x.message}`);
      setMsg({ ok: false, text: [...apiErrorMessages(e), ...extra] });
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await payrollService.preview(month);
      setPreview(r);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-semibold block">Month</label>
            <input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="text-xs">
            Status: <Badge s={run?.status || 'NONE'} /> {run?.locked && <span className="ml-1 text-slate-600"><Lock className="w-3 h-3 inline" /> locked</span>}
          </div>
          <div className="flex flex-wrap gap-2 ml-auto">
            {(isMaker || isChecker) && <button className={btn('bg-slate-100 text-slate-800')} disabled={busy} onClick={doPreview}>Preview & exceptions</button>}
            {isMaker && (
              <button className={btn('bg-primary text-white')} disabled={busy || run?.locked || run?.status === 'PAID'}
                onClick={() => act(() => payrollService.prepare(month), (r) => r.message)}>
                Prepare payroll
              </button>
            )}
            {isChecker && run?.status === 'PENDING_APPROVAL' && (
              <>
                <button className={btn('bg-emerald-600 text-white')} disabled={busy || !run.canApprove}
                  title={run.canApprove ? '' : 'You prepared this run or created one of the employees in it'}
                  onClick={() => window.confirm(`Approve and lock ${run.monthName} payroll?`) && act(() => payrollService.approve(month), (r) => r.message || 'Payroll approved and locked.')}>
                  Approve & lock
                </button>
                <button className={btn('bg-rose-600 text-white')} disabled={busy}
                  onClick={() => { const c = window.prompt('Reason for sending the payroll back to HR?'); if (c?.trim()) act(() => payrollService.reject(month, c), 'Payroll sent back to HR.'); }}>
                  Reject
                </button>
              </>
            )}
            {isChecker && run?.status === 'APPROVED' && (
              <>
                <button className={btn('bg-slate-100 text-slate-800')} onClick={() => payrollService.bankAdvice(month).catch((e) => setMsg(errMsg(e)))}>Bank advice (NEFT CSV)</button>
                <button className={btn('bg-indigo-600 text-white')} disabled={busy}
                  onClick={() => { const ref = window.prompt('Bank payment / UTR reference'); if (ref?.trim()) act(() => payrollService.release(month, ref), 'Salary released; payslips are visible to employees.'); }}>
                  Release payment
                </button>
              </>
            )}
            {isMaker && run?.locked && run.status !== 'PAID' && !run.unlockRequest && (
              <button className={btn('bg-amber-500 text-white')} disabled={busy}
                onClick={() => { const r = window.prompt('Why does this month need to be unlocked?'); if (r?.trim()) act(() => payrollService.requestUnlock(month, r), 'Unlock requested from Finance.'); }}>
                Request unlock
              </button>
            )}
            {isChecker && run?.unlockRequest && (
              <button className={btn('bg-amber-500 text-white')} disabled={busy}
                onClick={() => window.confirm(`Unlock ${month}? Reason: ${run.unlockRequest?.reason}`) && act(() => payrollService.approveUnlock(month), 'Month unlocked for corrections.')}>
                Approve unlock
              </button>
            )}
          </div>
        </div>
        {run?.unlockRequest && <p className="text-xs text-amber-700">Unlock requested by {run.unlockRequest.by}: {run.unlockRequest.reason}</p>}
        {run?.rejectionComment && run.status === 'REJECTED' && <p className="text-xs text-rose-700">Rejected: {run.rejectionComment}</p>}
        {!!run?.conflicts?.length && <p className="text-xs text-rose-700">You cannot approve: you created the employee record of {run.conflicts.join(', ')}.</p>}
        <Msg msg={msg} />
        {!isAccounts && (run?.status === 'APPROVED' || run?.status === 'PAID') ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="font-semibold text-slate-600 self-center">Statutory files:</span>
            {['pf-ecr', 'esic', 'pt', 'lwf'].map((k) => (
              <button key={k} className={btn('bg-slate-100 text-slate-700')} onClick={() => payrollService.statutoryFile(k, month).catch((e) => setMsg(errMsg(e)))}>
                <FileText className="w-3 h-3 inline" /> {k.toUpperCase()}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {preview && (
        <div className={card}>
          <h3 className="font-bold text-sm">Preview — {preview.rows.length} employees, net ₹{fmt(preview.totals.netSalary)}</h3>
          {!!preview.exceptions.length && (
            <div className="space-y-1">
              {preview.exceptions.map((x, i) => (
                <div key={i} className={`text-xs p-2 rounded-lg ${x.blocking ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
                  <b>{x.type.replace(/_/g, ' ')}</b> · {x.employeeName}: {x.message} {x.blocking && '(blocking)'}
                </div>
              ))}
            </div>
          )}
          <SlipTable rows={preview.rows} onOpen={setOpen} />
        </div>
      )}

      {register && (
        <div className={card}>
          <h3 className="font-bold text-sm">Payroll register — {month}</h3>
          {register.summaryOnly ? (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Department</th><th className="text-right">Headcount</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net</th><th className="text-right">Employer cost</th></tr></thead>
              <tbody>
                {register.departments.map((d: any) => (
                  <tr key={d.department} className="border-b border-slate-100">
                    <td className="py-2">{d.department}</td><td className="text-right">{d.headcount}</td>
                    <td className="text-right font-mono">{fmt(d.gross)}</td><td className="text-right font-mono">{fmt(d.deductions)}</td>
                    <td className="text-right font-mono">{fmt(d.net)}</td><td className="text-right font-mono">{fmt(d.employerCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : register.rows?.length ? (
            <>
              <p className="text-xs text-slate-500">Gross ₹{fmt(register.totals.grossSalary)} · Deductions ₹{fmt(register.totals.totalDeductions)} · Net ₹{fmt(register.totals.netSalary)} · TDS ₹{fmt(register.totals.tds)}</p>
              <SlipTable rows={register.rows} onOpen={setOpen} />
            </>
          ) : (
            <p className="text-xs text-slate-500">No payslips for this month yet.</p>
          )}
        </div>
      )}

      <div className={card}>
        <h3 className="font-bold text-sm">All runs</h3>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Month</th><th>Status</th><th className="text-right">Net</th><th>Prepared by</th><th>Approved by</th><th>Payment ref</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r._id} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => setMonth(r._id)}>
                <td className="py-2 font-semibold">{r.monthName || r._id}</td><td><Badge s={r.status} /></td>
                <td className="text-right font-mono">{fmt(r.totals?.netSalary)}</td><td>{r.preparedBy || '-'}</td><td>{r.approvedBy || '-'}</td><td>{r.paymentReference || '-'}</td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={6} className="py-3 text-slate-500">No payroll runs yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <Modal title={`${open.employeeName} — ${open.monthName}`} onClose={() => setOpen(null)} wide><PayslipView p={open} /></Modal>}
    </div>
  );
};

const SlipTable: React.FC<{ rows: PayslipFull[]; onOpen: (p: PayslipFull) => void }> = ({ rows, onOpen }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-slate-500 border-b">
          <th className="py-2">Employee</th><th className="text-right">Paid days</th><th className="text-right">Gross</th><th className="text-right">PF</th><th className="text-right">TDS</th><th className="text-right">Deductions</th><th className="text-right">Net</th><th className="text-right">Variance</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p._id} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => onOpen(p)}>
            <td className="py-2">{p.employeeName} <span className="text-slate-400">{p.employeeCode}</span></td>
            <td className="text-right">{p.workedDays}</td>
            <td className="text-right font-mono">{fmt(p.grossSalary)}</td>
            <td className="text-right font-mono">{fmt(p.providentFund)}</td>
            <td className="text-right font-mono">{fmt(p.tds)}</td>
            <td className="text-right font-mono">{fmt(p.totalDeductions)}</td>
            <td className="text-right font-mono font-bold">{fmt(p.netSalary)}</td>
            <td className="text-right">{p.variancePct != null ? `${p.variancePct}%` : '-'}</td>
            <td><Badge s={p.status || 'DRAFT'} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ------------------------------------------------------------------ inputs (LOP, OT, arrears, bonus, deductions)

const InputsPanel: React.FC<{ employees: Employee[]; isMaker: boolean }> = ({ employees, isMaker }) => {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<{ inputs: any[]; locked: boolean; manualKinds: string[]; kinds: Record<string, { label: string; earning: boolean }> } | null>(null);
  const [form, setForm] = useState({ employeeId: '', kind: '', amount: '', label: '' });
  const [msg, setMsg] = useState<MsgState>(null);
  const load = () => payrollService.inputs(month).then(setData).catch((e) => setMsg(errMsg(e)));
  useEffect(() => {
    load();
  }, [month]);
  const add = async () => {
    try {
      await payrollService.addInput({ employeeId: form.employeeId, month, kind: form.kind, amount: Number(form.amount), label: form.label });
      setForm({ ...form, amount: '', label: '' });
      setMsg(okMsg('Input added.'));
      load();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  return (
    <div className={card}>
      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs font-semibold block">Month</label>
          <input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        {data?.locked && <span className="text-xs text-slate-600"><Lock className="w-3 h-3 inline" /> Month locked</span>}
      </div>
      <Msg msg={msg} />
      {isMaker && data && !data.locked && (
        <div className="grid md:grid-cols-5 gap-2 items-end">
          <select className={inputCls} value={form.employeeId} aria-label="Employee" onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">Employee…</option>
            {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
          </select>
          <select className={inputCls} value={form.kind} aria-label="Kind" onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="">Type…</option>
            {data.manualKinds.map((k) => <option key={k} value={k}>{data.kinds[k]?.label || k}</option>)}
          </select>
          <input className={inputCls} type="number" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input className={inputCls} placeholder="Label (optional)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <button className={btn('bg-primary text-white')} onClick={add}><Plus className="w-3 h-3 inline" /> Add</button>
        </div>
      )}
      <table className="w-full text-xs">
        <thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Employee</th><th>Type</th><th>Label</th><th className="text-right">Amount / days</th><th>Source</th><th /></tr></thead>
        <tbody>
          {data?.inputs.map((r) => (
            <tr key={r._id} className="border-b border-slate-100">
              <td className="py-2">{r.employeeName}</td>
              <td>{data.kinds[r.kind]?.label || r.kind}</td>
              <td>{r.label}</td>
              <td className="text-right font-mono">{r.days ? `${r.days} day(s)` : fmt(r.amount)}</td>
              <td>{r.source}</td>
              <td className="text-right">
                {isMaker && r.source === 'MANUAL' && !data.locked && (
                  <button className={btn('bg-rose-50 text-rose-700')} onClick={() => payrollService.removeInput(r._id).then(load).catch((e) => setMsg(errMsg(e)))}>Remove</button>
                )}
              </td>
            </tr>
          ))}
          {!data?.inputs.length && <tr><td colSpan={6} className="py-3 text-slate-500">No inputs for this month.</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

// ------------------------------------------------------------------ salary revisions + appraisal increments

interface PendingIncrement {
  appraisalId: string;
  employeeName: string;
  employeeCode?: string;
  incrementPct?: number;
  oldSalary?: number;
  newSalary?: number;
  effectiveFrom: string;
  proposedBy?: string;
  canApprove: boolean;
}

const RevisionsPanel: React.FC<{ employees: Employee[]; isMaker: boolean; isChecker: boolean }> = ({ employees, isMaker, isChecker }) => {
  const [rows, setRows] = useState<SalaryRevision[]>([]);
  const [increments, setIncrements] = useState<PendingIncrement[]>([]);
  const [form, setForm] = useState({ employeeId: '', newAnnualSalary: '', effectiveFrom: new Date().toISOString().slice(0, 10), reason: '' });
  const [msg, setMsg] = useState<MsgState>(null);
  const load = () => {
    payrollService.revisions().then((r) => setRows(r.revisions)).catch((e) => setMsg(errMsg(e)));
    request<{ increments: PendingIncrement[] }>('/performance/appraisals/increments?status=PENDING_APPROVAL')
      .then((r) => setIncrements(r.increments))
      .catch(() => setIncrements([]));
  };
  useEffect(load, []);
  const propose = async () => {
    try {
      await payrollService.proposeRevision({ ...form, newAnnualSalary: Number(form.newAnnualSalary) });
      setMsg(okMsg('Revision sent to Finance for approval.'));
      setForm({ ...form, newAnnualSalary: '', reason: '' });
      load();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  const decide = async (r: SalaryRevision, decision: 'APPROVED' | 'REJECTED') => {
    const comment = decision === 'REJECTED' ? window.prompt('Reason for rejecting?') || '' : '';
    if (decision === 'REJECTED' && !comment.trim()) return;
    try {
      await payrollService.decideRevision(r.employeeId, r._id, decision, comment);
      setMsg(okMsg(`Revision ${decision.toLowerCase()}.`));
      load();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  const decideIncrements = async (decision: 'APPROVED' | 'REJECTED') => {
    const ids = increments.filter((i) => i.canApprove).map((i) => i.appraisalId);
    const comment = decision === 'REJECTED' ? window.prompt('Reason for rejecting these increments?') || '' : '';
    if (decision === 'REJECTED' && !comment.trim()) return;
    try {
      const res = await request<{ decided: number }>('/performance/appraisals/increments/approve', {
        method: 'POST',
        body: JSON.stringify({ decision, comment, appraisalIds: ids }),
      });
      setMsg(okMsg(`${res.decided} increment(s) ${decision.toLowerCase()}.`));
      load();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  return (
    <div className="space-y-4">
      <Msg msg={msg} />
      {isMaker && (
        <div className={card}>
          <h3 className="font-bold text-sm">Propose a salary revision</h3>
          <p className="text-xs text-slate-500">Salary is never edited directly. HR proposes the new CTC; Finance approves it. Backdated revisions are paid as arrears.</p>
          <div className="grid md:grid-cols-5 gap-2">
            <select className={inputCls} aria-label="Employee" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
              <option value="">Employee…</option>
              {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
            </select>
            <input className={inputCls} type="number" placeholder="New annual CTC" value={form.newAnnualSalary} onChange={(e) => setForm({ ...form, newAnnualSalary: e.target.value })} />
            <input className={inputCls} type="date" aria-label="Effective from" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
            <input className={inputCls} placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <button className={btn('bg-primary text-white')} onClick={propose}>Send for approval</button>
          </div>
        </div>
      )}
      {increments.length > 0 && (
        <div className={card}>
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm">Appraisal increments awaiting approval ({increments.length})</h3>
            {isChecker && (
              <div className="space-x-2">
                <button className={btn('bg-emerald-600 text-white')} disabled={!increments.some((i) => i.canApprove)} onClick={() => decideIncrements('APPROVED')}>Approve all</button>
                <button className={btn('bg-rose-600 text-white')} disabled={!increments.some((i) => i.canApprove)} onClick={() => decideIncrements('REJECTED')}>Reject all</button>
              </div>
            )}
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Employee</th><th className="text-right">Increment</th><th className="text-right">Old</th><th className="text-right">New</th><th>Effective</th><th>Proposed by</th></tr></thead>
            <tbody>
              {increments.map((i) => (
                <tr key={i.appraisalId} className="border-b border-slate-100">
                  <td className="py-2">{i.employeeName}</td><td className="text-right">{i.incrementPct}%</td>
                  <td className="text-right font-mono">{fmt(i.oldSalary)}</td><td className="text-right font-mono">{fmt(i.newSalary)}</td>
                  <td>{i.effectiveFrom}</td><td>{i.proposedBy || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={card}>
        <h3 className="font-bold text-sm">Revisions</h3>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Employee</th><th className="text-right">Old CTC</th><th className="text-right">New CTC</th><th>Effective</th><th>Reason</th><th>Proposed by</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id} className="border-b border-slate-100">
                <td className="py-2">{r.employeeName}</td>
                <td className="text-right font-mono">{fmt(r.oldSalary)}</td><td className="text-right font-mono">{fmt(r.newSalary)}</td>
                <td>{r.effectiveFrom}</td><td>{r.reason || r.source}</td><td>{r.proposedBy || '-'}</td><td><Badge s={r.status} /></td>
                <td className="text-right space-x-1">
                  {isChecker && r.status === 'PENDING_APPROVAL' && (
                    <>
                      <button className={btn('bg-emerald-600 text-white')} disabled={!r.canDecide} title={r.canDecide ? '' : 'You proposed it or it is your own salary'} onClick={() => decide(r, 'APPROVED')}>Approve</button>
                      <button className={btn('bg-rose-600 text-white')} disabled={!r.canDecide} onClick={() => decide(r, 'REJECTED')}>Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-3 text-slate-500">No salary revisions.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ structures + statutory settings

const emptyStructure = (): Partial<SalaryStructureDef> => ({
  name: '',
  grades: [],
  employerPfInCtc: true,
  active: true,
  components: [
    { code: 'BASIC', name: 'Basic', basis: 'PCT_CTC', value: 40 },
    { code: 'HRA', name: 'HRA', basis: 'PCT_BASIC', value: 50 },
    { code: 'SPECIAL', name: 'Special allowance', basis: 'BALANCE', value: 0 },
  ],
});

const StructuresPanel: React.FC<{ isMaker: boolean; employees: Employee[] }> = ({ isMaker, employees }) => {
  const [structures, setStructures] = useState<SalaryStructureDef[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [edit, setEdit] = useState<Partial<SalaryStructureDef> | null>(null);
  const [assign, setAssign] = useState<SalaryStructureDef | null>(null);
  const [assignIds, setAssignIds] = useState<string[]>([]);
  const [previewCtc, setPreviewCtc] = useState('600000');
  const [previewSlip, setPreviewSlip] = useState<PayslipFull | null>(null);
  const [msg, setMsg] = useState<MsgState>(null);
  const load = () => {
    payrollService.structures().then((r) => setStructures(r.structures)).catch((e) => setMsg(errMsg(e)));
    payrollService.settings().then((r) => setSettings(r.settings)).catch(() => undefined);
  };
  useEffect(load, []);

  const saveStructure = async () => {
    if (!edit) return;
    try {
      await payrollService.saveStructure(edit, edit._id);
      setEdit(null);
      setMsg(okMsg('Structure saved.'));
      load();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  const doAssign = async () => {
    if (!assign) return;
    try {
      await payrollService.assignStructure(assign._id, { employeeIds: assignIds });
      setAssign(null);
      setMsg(okMsg('Structure assigned.'));
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  const saveSettings = async () => {
    try {
      await payrollService.saveSettings({ statutory: settings.statutory, variancePct: settings.variancePct });
      setMsg(okMsg('Statutory settings saved.'));
      load();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  const setComp = (i: number, patch: Partial<StructureComponent>) =>
    edit && setEdit({ ...edit, components: edit.components!.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const st = settings?.statutory;
  const setSt = (section: string, field: string, value: any) =>
    setSettings({ ...settings, statutory: { ...st, [section]: { ...st[section], [field]: value } } });

  return (
    <div className="space-y-4">
      <Msg msg={msg} />
      <div className={card}>
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-sm">Salary structures</h3>
          {isMaker && <button className={btn('bg-primary text-white')} onClick={() => setEdit(emptyStructure())}><Plus className="w-3 h-3 inline" /> New structure</button>}
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Name</th><th>Components</th><th>Grades</th><th /></tr></thead>
          <tbody>
            {structures.map((s) => (
              <tr key={s._id} className="border-b border-slate-100">
                <td className="py-2 font-semibold">{s.name}</td>
                <td>{s.components.map((c) => `${c.code} (${c.basis === 'BALANCE' ? 'balance' : `${c.value}${c.basis === 'FIXED' ? '' : '%'} ${c.basis.replace('PCT_', 'of ')}`})`).join(', ')}</td>
                <td>{s.grades.join(', ') || '-'}</td>
                <td className="text-right space-x-1">
                  {isMaker && <button className={btn('bg-slate-100 text-slate-700')} onClick={() => setEdit(s)}>Edit</button>}
                  {isMaker && <button className={btn('bg-slate-100 text-slate-700')} onClick={() => { setAssign(s); setAssignIds([]); }}>Assign</button>}
                  <button className={btn('bg-slate-100 text-slate-700')} onClick={() => payrollService.previewStructure(Number(previewCtc), s._id).then((r) => setPreviewSlip(r.payslip)).catch((e) => setMsg(errMsg(e)))}>Preview</button>
                </td>
              </tr>
            ))}
            {!structures.length && <tr><td colSpan={4} className="py-3 text-slate-500">No custom structures; the default structure (Basic 50% of CTC, HRA, special allowance) applies.</td></tr>}
          </tbody>
        </table>
        <div className="flex gap-2 items-end text-xs">
          <div>
            <label className="font-semibold block">Preview CTC</label>
            <input className={inputCls} type="number" value={previewCtc} onChange={(e) => setPreviewCtc(e.target.value)} />
          </div>
          <button className={btn('bg-slate-100 text-slate-700')} onClick={() => payrollService.previewStructure(Number(previewCtc)).then((r) => setPreviewSlip(r.payslip)).catch((e) => setMsg(errMsg(e)))}>Preview default</button>
        </div>
      </div>

      {st && (
        <div className={card}>
          <h3 className="font-bold text-sm">Statutory settings</h3>
          <div className="grid md:grid-cols-3 gap-4 text-xs">
            <fieldset className="space-y-2" disabled={!isMaker}>
              <legend className="font-semibold">Provident fund</legend>
              <label className="flex gap-2 items-center"><input type="checkbox" checked={!!st.pf.enabled} onChange={(e) => setSt('pf', 'enabled', e.target.checked)} /> Enabled</label>
              <label className="block">Employee rate %<input className={inputCls} type="number" value={st.pf.eeRate} onChange={(e) => setSt('pf', 'eeRate', e.target.value)} /></label>
              <label className="block">Employer rate %<input className={inputCls} type="number" value={st.pf.erRate} onChange={(e) => setSt('pf', 'erRate', e.target.value)} /></label>
              <label className="block">Wage ceiling<input className={inputCls} type="number" value={st.pf.wageCeiling} onChange={(e) => setSt('pf', 'wageCeiling', e.target.value)} /></label>
              <label className="flex gap-2 items-center"><input type="checkbox" checked={!!st.pf.capAtCeiling} onChange={(e) => setSt('pf', 'capAtCeiling', e.target.checked)} /> Cap PF at ceiling</label>
            </fieldset>
            <fieldset className="space-y-2" disabled={!isMaker}>
              <legend className="font-semibold">ESIC</legend>
              <label className="flex gap-2 items-center"><input type="checkbox" checked={!!st.esic.enabled} onChange={(e) => setSt('esic', 'enabled', e.target.checked)} /> Enabled</label>
              <label className="block">Employee rate %<input className={inputCls} type="number" value={st.esic.eeRate} onChange={(e) => setSt('esic', 'eeRate', e.target.value)} /></label>
              <label className="block">Employer rate %<input className={inputCls} type="number" value={st.esic.erRate} onChange={(e) => setSt('esic', 'erRate', e.target.value)} /></label>
              <label className="block">Gross limit<input className={inputCls} type="number" value={st.esic.grossLimit} onChange={(e) => setSt('esic', 'grossLimit', e.target.value)} /></label>
            </fieldset>
            <fieldset className="space-y-2" disabled={!isMaker}>
              <legend className="font-semibold">Other</legend>
              <label className="block">Default state (PT/LWF)
                <select className={inputCls} value={st.defaultState} onChange={(e) => setSettings({ ...settings, statutory: { ...st, defaultState: e.target.value } })}>
                  {Object.keys(st.pt || {}).map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">Minimum monthly wage<input className={inputCls} type="number" value={st.minimumMonthlyWage || 0} onChange={(e) => setSettings({ ...settings, statutory: { ...st, minimumMonthlyWage: e.target.value } })} /></label>
              <label className="block">Variance alert %<input className={inputCls} type="number" value={settings.variancePct} onChange={(e) => setSettings({ ...settings, variancePct: e.target.value })} /></label>
              <p className="text-slate-500">PT slabs configured for: {Object.keys(st.pt || {}).join(', ')}</p>
            </fieldset>
          </div>
          {isMaker && <div className="flex justify-end"><button className={btn('bg-primary text-white')} onClick={saveSettings}>Save settings</button></div>}
          {isMaker && <TaxWindows settings={settings} onSaved={load} setMsg={setMsg} />}
        </div>
      )}

      {edit && (
        <Modal title={edit._id ? `Edit ${edit.name}` : 'New salary structure'} onClose={() => setEdit(null)} wide>
          <div className="grid md:grid-cols-2 gap-3 text-xs">
            <label>Name<input className={inputCls} value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>Grades (comma separated)<input className={inputCls} value={(edit.grades || []).join(', ')} onChange={(e) => setEdit({ ...edit, grades: e.target.value.split(',') })} /></label>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th>Code</th><th>Name</th><th>Basis</th><th>Value</th><th /></tr></thead>
            <tbody>
              {edit.components!.map((c, i) => (
                <tr key={i}>
                  <td><input className={inputCls} value={c.code} onChange={(e) => setComp(i, { code: e.target.value })} /></td>
                  <td><input className={inputCls} value={c.name} onChange={(e) => setComp(i, { name: e.target.value })} /></td>
                  <td>
                    <select className={inputCls} value={c.basis} onChange={(e) => setComp(i, { basis: e.target.value as StructureComponent['basis'] })}>
                      <option value="PCT_CTC">% of monthly CTC</option><option value="PCT_BASIC">% of Basic</option><option value="FIXED">Fixed amount</option><option value="BALANCE">Balancing figure</option>
                    </select>
                  </td>
                  <td><input className={inputCls} type="number" disabled={c.basis === 'BALANCE'} value={c.value} onChange={(e) => setComp(i, { value: Number(e.target.value) })} /></td>
                  <td><button className={btn('text-rose-600')} onClick={() => setEdit({ ...edit, components: edit.components!.filter((_, j) => j !== i) })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between">
            <button className={btn('bg-slate-100 text-slate-700')} onClick={() => setEdit({ ...edit, components: [...edit.components!, { code: '', name: '', basis: 'FIXED', value: 0 }] })}>Add component</button>
            <button className={btn('bg-primary text-white')} onClick={saveStructure}>Save</button>
          </div>
        </Modal>
      )}
      {assign && (
        <Modal title={`Assign ${assign.name}`} onClose={() => setAssign(null)}>
          <div className="max-h-72 overflow-y-auto text-xs space-y-1">
            {employees.map((e) => (
              <label key={e._id} className="flex gap-2 items-center">
                <input type="checkbox" checked={assignIds.includes(e._id)} onChange={(ev) => setAssignIds(ev.target.checked ? [...assignIds, e._id] : assignIds.filter((x) => x !== e._id))} />
                {e.firstName} {e.lastName} ({e.employeeCode})
              </label>
            ))}
          </div>
          <div className="flex justify-end"><button className={btn('bg-primary text-white')} onClick={doAssign}>Assign</button></div>
        </Modal>
      )}
      {previewSlip && <Modal title="Structure preview" onClose={() => setPreviewSlip(null)} wide><PayslipView p={previewSlip} /></Modal>}
    </div>
  );
};

const TaxWindows: React.FC<{ settings: any; onSaved: () => void; setMsg: (m: MsgState) => void }> = ({ settings, onSaved, setMsg }) => {
  const [w, setW] = useState({
    declarationWindow: settings.declarationWindow || { open: false, until: null },
    proofWindow: settings.proofWindow || { open: false, until: null },
  });
  const save = async () => {
    try {
      await payrollService.setWindows(w);
      setMsg(okMsg('Tax windows saved.'));
      onSaved();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  return (
    <div className="border-t pt-3 text-xs space-y-2">
      <h4 className="font-semibold">Investment declaration & proof windows</h4>
      {(['declarationWindow', 'proofWindow'] as const).map((k) => (
        <div key={k} className="flex gap-3 items-center">
          <span className="w-32">{k === 'declarationWindow' ? 'Declarations' : 'Proofs'}</span>
          <label className="flex gap-1 items-center"><input type="checkbox" checked={!!w[k].open} onChange={(e) => setW({ ...w, [k]: { ...w[k], open: e.target.checked } })} /> Open</label>
          <input type="date" className={inputCls + ' w-44'} value={w[k].until || ''} onChange={(e) => setW({ ...w, [k]: { ...w[k], until: e.target.value || null } })} />
        </div>
      ))}
      <button className={btn('bg-primary text-white')} onClick={save}>Save windows</button>
    </div>
  );
};

// ------------------------------------------------------------------ HR / Finance: verify tax proofs

const DeclarationsPanel: React.FC<{ canVerify: boolean }> = ({ canVerify }) => {
  const [rows, setRows] = useState<DeclarationView[]>([]);
  const [msg, setMsg] = useState<MsgState>(null);
  const load = () => payrollService.allDeclarations().then((r) => setRows(r.declarations)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => {
    load();
  }, []);
  const verify = async (empId: string, proofId: string, amount: number, decision: 'VERIFIED' | 'REJECTED') => {
    let verified = amount;
    let comment = '';
    if (decision === 'VERIFIED') {
      const v = window.prompt('Verified amount', String(amount));
      if (v === null) return;
      verified = Number(v) || 0;
    } else {
      comment = window.prompt('Reason for rejecting this proof?') || '';
      if (!comment.trim()) return;
    }
    try {
      await payrollService.verifyProof(empId, proofId, decision, verified, comment);
      setMsg(okMsg(`Proof ${decision.toLowerCase()}.`));
      load();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  return (
    <div className={card}>
      <Msg msg={msg} />
      {!rows.length && <p className="text-xs text-slate-500">No declarations submitted yet.</p>}
      {rows.map((d) => (
        <div key={d.employeeId + d.fy} className="border border-slate-100 rounded-xl p-3 text-xs space-y-1">
          <div className="font-bold">{d.employeeName} · FY {d.fy} · {d.regime} regime{d.npsOptIn ? ' · NPS' : ''}</div>
          {d.sections.filter((s) => s.declared || s.proofs.length).map((s) => (
            <div key={s.section} className="pl-2">
              <span className="font-semibold">{s.section}</span> declared ₹{fmt(s.declared)}
              {s.proofs.map((p) => (
                <div key={p._id} className="pl-4 flex gap-2 items-center">
                  <button className="underline text-indigo-700" onClick={() => payrollService.proofFile(d.employeeId, p._id).catch((e) => setMsg(errMsg(e)))}>{p.fileName}</button>
                  ₹{fmt(p.amount)} <Badge s={p.status} /> {p.verifiedAmount != null && p.status === 'VERIFIED' ? `(₹${fmt(p.verifiedAmount)})` : ''}
                  {canVerify && p.status === 'SUBMITTED' && (
                    <>
                      <button className={btn('bg-emerald-600 text-white')} onClick={() => verify(d.employeeId, p._id, p.amount, 'VERIFIED')}>Verify</button>
                      <button className={btn('bg-rose-600 text-white')} onClick={() => verify(d.employeeId, p._id, p.amount, 'REJECTED')}>Reject</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default PayrollPage;
