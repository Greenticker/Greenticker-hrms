import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { isReadOnlyRole } from '../utils/access';
import {
  Badge, BAD, btn, card, errMsg, fmtMoney, GOOD, inputCls, Modal, Msg, MsgState, okMsg, openApiFile, PageHeader, PRIMARY, saveCsv, SECONDARY, Table, Tabs,
} from '../components/common/ui';

type Tab = 'mine' | 'claims' | 'policies' | 'enrollments' | 'files' | 'premiums';
const HR = ['HR'];
const MANAGE = ['HR', 'ADMIN', 'SUPER_ADMIN', 'ADMIN_1'];
const READ_ALL = ['HR', 'ADMIN', 'SUPER_ADMIN', 'ADMIN_1', 'AUDITORS'];
const PREMIUM_READ = ['FINANCE', 'ACCOUNTS', 'AUDITORS', 'HR'];
const RELATIONS = ['SPOUSE', 'CHILD', 'PARENT', 'PARENT_IN_LAW'];

export const InsurancePage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role || '';
  const hasEmployee = !!(user?.employee || user?.employeeId);
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [];
    if (hasEmployee) t.push({ id: 'mine', label: 'My benefits' }, { id: 'claims', label: 'Claims' });
    if (READ_ALL.includes(role) || PREMIUM_READ.includes(role)) t.push({ id: 'policies', label: 'Policies' });
    if (READ_ALL.includes(role)) t.push({ id: 'enrollments', label: 'Enrolments & dependents' });
    if (HR.includes(role) || role === 'AUDITORS') t.push({ id: 'files', label: 'Insurer files & exits' });
    if (PREMIUM_READ.includes(role)) t.push({ id: 'premiums', label: 'Premium payments' });
    return t.length ? t : [{ id: 'mine' as Tab, label: 'My benefits' }];
  }, [hasEmployee, role]);
  const [tab, setTab] = useState<Tab>(tabs[0].id);
  const [msg, setMsg] = useState<MsgState>(null);
  return (
    <div className="space-y-5">
      <PageHeader title="Insurance & benefits" subtitle="Group mediclaim, accident and term-life cover. Medical details are visible only to you and HR." />
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setMsg(null); }} />
      <Msg msg={msg} />
      {tab === 'mine' && <MyBenefits setMsg={setMsg} readOnly={isReadOnlyRole(role)} />}
      {tab === 'claims' && <Claims setMsg={setMsg} isHr={HR.includes(role)} />}
      {tab === 'policies' && <Policies setMsg={setMsg} canManage={MANAGE.includes(role)} />}
      {tab === 'enrollments' && <Enrollments setMsg={setMsg} isHr={HR.includes(role)} />}
      {tab === 'files' && <Files setMsg={setMsg} isHr={HR.includes(role)} />}
      {tab === 'premiums' && <Premiums setMsg={setMsg} isFinance={role === 'FINANCE'} />}
    </div>
  );
};

type SetMsg = { setMsg: (m: MsgState) => void };

function ecardPdf(c: any) {
  const doc = new jsPDF({ unit: 'mm', format: [86, 120] });
  doc.setFontSize(11);
  doc.text(c.policyName, 6, 10);
  doc.setFontSize(8);
  [`Insurer: ${c.insurer}`, `Policy: ${c.policyNumber}`, `Card: ${c.cardNumber}`, `Member: ${c.member} (${c.employeeCode})`,
    `Sum insured: INR ${fmtMoney(c.sumInsured)}`, `Valid: ${c.validFrom} to ${c.validTo}`, 'Dependents:',
    ...c.dependents.map((d: any) => `  ${d.name} (${d.relation.toLowerCase()}, ${d.dob})`)].forEach((l, i) => doc.text(l, 6, 18 + i * 5));
  doc.save(`ecard_${c.cardNumber}.pdf`);
}

const MyBenefits: React.FC<SetMsg & { readOnly: boolean }> = ({ setMsg, readOnly }) => {
  const [data, setData] = useState<any>(null);
  const [dep, setDep] = useState<any>(null);
  const [proof, setProof] = useState<File | null>(null);
  const load = () => api.get<any>('/benefits/me').then(setData).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  if (!data) return null;
  const addDep = async () => {
    try {
      const fd = new FormData();
      Object.entries(dep).forEach(([k, v]) => v && fd.append(k, String(v)));
      if (proof) fd.append('proof', proof);
      await api.upload('/benefits/me/dependents', fd);
      setDep(null);
      setProof(null);
      setMsg(okMsg('Dependent added; HR will verify it before cover starts.'));
      load();
    } catch (e) { setMsg(errMsg(e)); }
  };
  const optIn = async (policyId: string, name: string, premium: number) => {
    if (!window.confirm(`Opt into ${name}? ₹${fmtMoney(premium / 12)} will be deducted from each month's salary.`)) return;
    try { await api.post('/benefits/me/topup', { policyId }); setMsg(okMsg('Opted in; the premium is deducted through payroll.')); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">Enrolment window: <b>{data.windowOpen ? 'open' : 'closed'}</b>
        {data.settings?.enrollmentWindow?.until ? ` (until ${data.settings.enrollmentWindow.until})` : ''}. Outside the window you can add dependents only for a life event (birth, marriage, adoption) within {data.settings?.lifeEventDays} days, with proof.</p>
      {data.enrollments.map((e: any) => (
        <div key={e._id} className={card}>
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <h3 className="font-bold text-sm">{e.policy.name} <Badge s={e.status} /></h3>
              <p className="text-xs text-slate-500">{e.policy.insurer} · Policy {e.policy.policyNumber} · Sum insured ₹{fmtMoney(e.sumInsured)} · {e.coverageStart} to {e.coverageEnd}
                {e.monthlyPremium ? ` · Premium ₹${fmtMoney(e.monthlyPremium)}/month via payroll` : ''}</p>
            </div>
            <div className="flex gap-2">
              <button className={btn(SECONDARY)} onClick={() => api.get<any>(`/benefits/ecard/${encodeURIComponent(e._id)}`).then((r) => ecardPdf(r.ecard)).catch((er) => setMsg(errMsg(er)))}>e-card</button>
              {!readOnly && (e.policy.allowedRelations || []).length > 0 && e.status === 'ACTIVE' && (
                <button className={btn(PRIMARY)} onClick={() => setDep({ policyId: e.policyId, name: '', relation: e.policy.allowedRelations[0], dob: '', gender: '', lifeEvent: '', eventDate: '' })}>Add dependent</button>
              )}
            </div>
          </div>
          <Table rows={e.dependents} empty="No dependents." cols={[
            { key: 'name', label: 'Name' }, { key: 'relation', label: 'Relation' }, { key: 'dob', label: 'Date of birth' },
            { key: 'addedVia', label: 'Added via' }, { key: 'status', label: 'Status', render: (d: any) => <Badge s={d.status} /> },
          ]} />
        </div>
      ))}
      {data.optionalPolicies?.length > 0 && !readOnly && (
        <div className={card}>
          <h3 className="font-bold text-sm">Optional covers</h3>
          {data.optionalPolicies.map((p: any) => (
            <div key={p._id} className="flex justify-between items-center text-xs">
              <span>{p.name} — sum insured ₹{fmtMoney(p.sumInsured)}, premium ₹{fmtMoney(p.premiumAnnual)}/year</span>
              <button className={btn(PRIMARY)} onClick={() => optIn(p._id, p.name, p.premiumAnnual)}>Opt in</button>
            </div>
          ))}
        </div>
      )}
      {dep && (
        <Modal title="Add dependent" onClose={() => setDep(null)}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="col-span-2">Name<input className={inputCls} value={dep.name} onChange={(e) => setDep({ ...dep, name: e.target.value })} /></label>
            <label>Relation<select className={inputCls} value={dep.relation} onChange={(e) => setDep({ ...dep, relation: e.target.value })}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select></label>
            <label>Date of birth<input type="date" className={inputCls} value={dep.dob} onChange={(e) => setDep({ ...dep, dob: e.target.value })} /></label>
            <label>Gender<select className={inputCls} value={dep.gender} onChange={(e) => setDep({ ...dep, gender: e.target.value })}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></select></label>
            {!data.windowOpen && (
              <>
                <label>Life event<select className={inputCls} value={dep.lifeEvent} onChange={(e) => setDep({ ...dep, lifeEvent: e.target.value })}><option value="">—</option><option value="BIRTH">Birth</option><option value="MARRIAGE">Marriage</option><option value="ADOPTION">Adoption</option></select></label>
                <label>Event date<input type="date" className={inputCls} value={dep.eventDate} onChange={(e) => setDep({ ...dep, eventDate: e.target.value })} /></label>
                <label className="col-span-2">Proof (certificate)<input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setProof(e.target.files?.[0] || null)} /></label>
              </>
            )}
          </div>
          <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={addDep}>Submit for HR verification</button></div>
        </Modal>
      )}
    </div>
  );
};

const Claims: React.FC<SetMsg & { isHr: boolean }> = ({ setMsg, isHr }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState<any>(null);
  const load = () => api.get<any>('/benefits/claims').then((r) => setRows(r.claims)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  const submit = async () => {
    try { await api.post('/benefits/claims', { ...f, amountRequested: Number(f.amountRequested) }); setF(null); setMsg(okMsg('Claim intimated. Track its status here.')); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  const update = async (c: any, status: string) => {
    const remarks = window.prompt('Remarks (optional)') || '';
    try { await api.put(`/benefits/claims/${c._id}/status`, { status, remarks }); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className={card}>
      <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={() => setF({ policyId: 'benpol_gmc', patientName: '', relation: 'SELF', hospitalName: '', admissionDate: '', claimType: 'CASHLESS', amountRequested: '', diagnosis: '' })}>Intimate a claim</button></div>
      <Table rows={rows} cols={[
        { key: 'claimNumber', label: 'Claim', render: (c) => c.claimNumber || c._id }, { key: 'employeeName', label: 'Employee' }, { key: 'patientName', label: 'Patient' },
        { key: 'hospitalName', label: 'Hospital' }, { key: 'amountRequested', label: 'Amount', right: true, render: (c) => fmtMoney(c.amountRequested) },
        { key: 'status', label: 'Status', render: (c) => <Badge s={c.status} /> },
        { key: 'a', label: '', render: (c) => isHr && !c._legacy && !['SETTLED', 'REJECTED'].includes(c.status) && (
          <select className={inputCls} value="" aria-label="Update status" onChange={(e) => e.target.value && update(c, e.target.value)}>
            <option value="">Update…</option>{['UNDER_REVIEW', 'SUBMITTED_TO_TPA', 'APPROVED', 'SETTLED', 'REJECTED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        ) },
      ]} />
      {f && (
        <Modal title="Intimate an insurance claim" onClose={() => setF(null)}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[['patientName', 'Patient name'], ['relation', 'Relation'], ['hospitalName', 'Hospital'], ['admissionDate', 'Admission date'], ['amountRequested', 'Estimated amount'], ['diagnosis', 'Diagnosis']].map(([k, l]) => (
              <label key={k}>{l}<input className={inputCls} type={k === 'admissionDate' ? 'date' : k === 'amountRequested' ? 'number' : 'text'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
            ))}
            <label>Type<select className={inputCls} value={f.claimType} onChange={(e) => setF({ ...f, claimType: e.target.value })}><option>CASHLESS</option><option>REIMBURSEMENT</option></select></label>
          </div>
          <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={submit}>Submit</button></div>
        </Modal>
      )}
    </div>
  );
};

const Policies: React.FC<SetMsg & { canManage: boolean }> = ({ setMsg, canManage }) => {
  const [data, setData] = useState<any>({ policies: [], settings: {} });
  const [edit, setEdit] = useState<any>(null);
  const [win, setWin] = useState<any>(null);
  const load = () => api.get<any>('/benefits/policies').then((r) => { setData(r); setWin(r.settings.enrollmentWindow); }).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  const save = async () => {
    try {
      const body = { ...edit, eligibleGrades: String(edit.eligibleGrades || '').split(',').map((g: string) => g.trim()).filter(Boolean) };
      if (edit._id) await api.put(`/benefits/policies/${edit._id}`, body); else await api.post('/benefits/policies', body);
      setEdit(null); setMsg(okMsg('Policy saved; eligible employees are enrolled automatically.')); load();
    } catch (e) { setMsg(errMsg(e)); }
  };
  const saveWin = async () => {
    try { await api.put('/benefits/settings', { enrollmentWindow: win }); setMsg(okMsg('Enrolment window saved.')); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      {canManage && win && (
        <div className={card}>
          <h3 className="font-bold text-sm">Enrolment window</h3>
          <div className="flex flex-wrap gap-3 items-end text-xs">
            <label className="flex gap-1 items-center"><input type="checkbox" checked={!!win.open} onChange={(e) => setWin({ ...win, open: e.target.checked })} /> Open</label>
            <label>From<input type="date" className={inputCls} value={win.from || ''} onChange={(e) => setWin({ ...win, from: e.target.value })} /></label>
            <label>Until<input type="date" className={inputCls} value={win.until || ''} onChange={(e) => setWin({ ...win, until: e.target.value })} /></label>
            <button className={btn(PRIMARY)} onClick={saveWin}>Save</button>
          </div>
        </div>
      )}
      <div className={card}>
        {canManage && <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={() => setEdit({ type: 'GMC', name: '', insurer: '', policyNumber: '', sumInsured: '', premiumAnnual: '', validFrom: '', validTo: '', eligibleGrades: '', maxDependents: 5 })}>New policy</button></div>}
        <Table rows={data.policies} cols={[
          { key: 'type', label: 'Type' }, { key: 'name', label: 'Policy' }, { key: 'insurer', label: 'Insurer' }, { key: 'policyNumber', label: 'Policy no.' },
          { key: 'sumInsured', label: 'Sum insured', right: true, render: (p) => fmtMoney(p.sumInsured) },
          { key: 'premiumAnnual', label: 'Premium / life / yr', right: true, render: (p) => fmtMoney(p.premiumAnnual) },
          { key: 'v', label: 'Valid', render: (p) => `${p.validFrom} → ${p.validTo}` }, { key: 'g', label: 'Grades', render: (p) => (p.eligibleGrades || []).join(', ') || 'All' },
          { key: 'a', label: '', render: (p) => canManage && <button className={btn(SECONDARY)} onClick={() => setEdit({ ...p, eligibleGrades: (p.eligibleGrades || []).join(', ') })}>Edit</button> },
        ]} />
      </div>
      {edit && (
        <Modal title={edit._id ? `Edit ${edit.name}` : 'New insurance policy'} onClose={() => setEdit(null)}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label>Type<select className={inputCls} value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{['GMC', 'GPA', 'GTL', 'TOPUP'].map((t) => <option key={t}>{t}</option>)}</select></label>
            {[['name', 'Name'], ['insurer', 'Insurer'], ['policyNumber', 'Policy number'], ['sumInsured', 'Sum insured'], ['premiumAnnual', 'Annual premium per life'],
              ['validFrom', 'Valid from'], ['validTo', 'Valid to'], ['eligibleGrades', 'Eligible grades (comma separated, blank = all)'], ['maxDependents', 'Max dependents']].map(([k, l]) => (
              <label key={k}>{l}<input className={inputCls} type={k.startsWith('valid') ? 'date' : ['sumInsured', 'premiumAnnual', 'maxDependents'].includes(k) ? 'number' : 'text'} value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>
            ))}
          </div>
          <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={save}>Save</button></div>
        </Modal>
      )}
    </div>
  );
};

const Enrollments: React.FC<SetMsg & { isHr: boolean }> = ({ setMsg, isHr }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [onlyPending, setOnlyPending] = useState(true);
  const load = () => api.get<any>('/benefits/enrollments').then((r) => setRows(r.enrollments)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  const verify = async (e: any, d: any, decision: string) => {
    const comment = decision === 'REJECTED' ? window.prompt('Reason?') || '' : '';
    if (decision === 'REJECTED' && !comment) return;
    try { await api.post(`/benefits/enrollments/${e.employeeId}/${e.policyId}/dependents/${d._id}/verify`, { decision, comment }); load(); } catch (er) { setMsg(errMsg(er)); }
  };
  const deps = rows.flatMap((e) => e.dependents.map((d: any) => ({ ...d, enr: e }))).filter((d) => !onlyPending || d.status === 'PENDING_VERIFICATION');
  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-sm">Dependents</h3>
          <label className="text-xs flex gap-1 items-center"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Waiting for verification only</label>
        </div>
        <Table rows={deps} empty="Nothing to verify." cols={[
          { key: 'e', label: 'Employee', render: (d) => d.enr.employeeName }, { key: 'p', label: 'Policy', render: (d) => d.enr.policy.name },
          { key: 'name', label: 'Dependent' }, { key: 'relation', label: 'Relation' }, { key: 'dob', label: 'DOB' },
          { key: 'addedVia', label: 'Via', render: (d) => `${d.addedVia}${d.lifeEvent ? ` (${d.lifeEvent.toLowerCase()} ${d.eventDate})` : ''}` },
          { key: 'proof', label: 'Proof', render: (d) => (d.proof ? <button className="underline text-indigo-700" onClick={() => openApiFile(`/benefits/enrollments/${d.enr.employeeId}/${d.enr.policyId}/dependents/${d._id}/proof`).catch((e) => setMsg(errMsg(e)))}>view</button> : '—') },
          { key: 'status', label: 'Status', render: (d) => <Badge s={d.status} /> },
          { key: 'a', label: '', render: (d) => isHr && d.canVerify && <div className="flex gap-1"><button className={btn(GOOD)} onClick={() => verify(d.enr, d, 'APPROVED')}>Verify</button><button className={btn(BAD)} onClick={() => verify(d.enr, d, 'REJECTED')}>Reject</button></div> },
        ]} />
      </div>
      <div className={card}>
        <h3 className="font-bold text-sm">Enrolments</h3>
        <Table rows={rows} cols={[
          { key: 'employeeName', label: 'Employee' }, { key: 'policyType', label: 'Policy' }, { key: 'coverageStart', label: 'From' }, { key: 'coverageEnd', label: 'To' },
          { key: 'lives', label: 'Lives', right: true, render: (e) => 1 + e.dependents.filter((d: any) => d.status === 'ACTIVE').length },
          { key: 'status', label: 'Status', render: (e) => <Badge s={e.status} /> },
        ]} />
      </div>
    </div>
  );
};

const Files: React.FC<SetMsg & { isHr: boolean }> = ({ setMsg, isHr }) => {
  const [kind, setKind] = useState('deletion');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api.get<any>(`/benefits/insurer-file?kind=${kind}&month=${month}`).then((r) => setRows(r.rows)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, [kind, month]);
  const cols = ['policyNumber', 'employeeCode', 'relation', 'name', 'dob', 'effectiveDate', 'action'];
  return (
    <div className={card}>
      <div className="flex flex-wrap gap-2 items-end text-xs">
        <label>File<select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}><option value="addition">Additions</option><option value="deletion">Deletions</option></select></label>
        <label>Month<input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <button className={btn(SECONDARY)} onClick={() => saveCsv(`insurer_${kind}_${month}.csv`, cols, rows)}>Download CSV</button>
      </div>
      {isHr && <p className="text-xs text-slate-500">Coverage ends automatically on the last working day when an exit is initiated; those lives appear in that month's deletion file.</p>}
      <Table rows={rows} rowKey={(_, i) => String(i)} cols={cols.map((c) => ({ key: c, label: c.replace(/([A-Z])/g, ' $1') }))} />
    </div>
  );
};

const Premiums: React.FC<SetMsg & { isFinance: boolean }> = ({ setMsg, isFinance }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [pols, setPols] = useState<any[]>([]);
  const [f, setF] = useState({ policyId: '', amount: '', reference: '', period: '' });
  const load = () => {
    api.get<any>('/benefits/premium-payments').then((r) => setRows(r.payments)).catch((e) => setMsg(errMsg(e)));
    api.get<any>('/benefits/policies').then((r) => setPols(r.policies)).catch(() => undefined);
  };
  useEffect(load, []);
  const pay = async () => {
    try { await api.post('/benefits/premium-payments', { ...f, amount: Number(f.amount) }); setMsg(okMsg('Premium payment recorded.')); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className={card}>
      {isFinance && (
        <div className="grid md:grid-cols-5 gap-2">
          <select className={inputCls} aria-label="Policy" value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })}><option value="">Policy…</option>{pols.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
          <input className={inputCls} type="number" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <input className={inputCls} placeholder="Payment reference" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          <input className={inputCls} placeholder="Period (e.g. 2026-27)" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} />
          <button className={btn(PRIMARY)} onClick={pay}>Record payment</button>
        </div>
      )}
      <Table rows={rows} cols={[
        { key: 'policyName', label: 'Policy' }, { key: 'insurer', label: 'Insurer' }, { key: 'period', label: 'Period' }, { key: 'livesCovered', label: 'Lives', right: true },
        { key: 'amount', label: 'Amount', right: true, render: (p) => fmtMoney(p.amount) }, { key: 'reference', label: 'Reference' },
        { key: 'gl', label: 'GL', render: (p) => `${p.glCode} ${p.glName}` }, { key: 'paidBy', label: 'Paid by' },
      ]} />
    </div>
  );
};

export default InsurancePage;
