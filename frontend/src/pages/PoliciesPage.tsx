import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import {
  Badge, BAD, btn, card, downloadApiFile, errMsg, fmtDate, GOOD, inputCls, Modal, Msg, MsgState, okMsg, PageHeader, PRIMARY, saveCsv, SECONDARY, Table,
} from '../components/common/ui';
import { getAuthToken, API_BASE } from '../services/api';

const AUTHORS = ['HR', 'ADMIN', 'SUPER_ADMIN', 'ADMIN_1'];

export const PoliciesPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role || '';
  const canAuthor = AUTHORS.includes(role);
  const [data, setData] = useState<any>({ policies: [], locations: [] });
  const [status, setStatus] = useState('ALL');
  const [msg, setMsg] = useState<MsgState>(null);
  const [open, setOpen] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const load = () => api.get<any>(`/policies?status=${status}`).then(setData).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, [status]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); setMsg(okMsg(ok)); setOpen(null); setEdit(null); load(); } catch (e) { setMsg(errMsg(e)); }
  };

  const viewPdf = async (p: any) => {
    // inline view; view-only policies are never offered as downloads
    const res = await fetch(`${API_BASE}/policies/${p._id}/file`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
    if (!res.ok) return setMsg(errMsg({ message: 'Could not open the document.' }));
    setPdfUrl(URL.createObjectURL(await res.blob()));
  };

  const save = async () => {
    const fd = new FormData();
    ['title', 'category', 'content', 'summary', 'effectiveDate', 'changeNote'].forEach((k) => edit[k] != null && fd.append(k, edit[k]));
    fd.append('applicableLocations', (edit.applicableLocations || []).join(','));
    fd.append('applicableGrades', edit.applicableGradesText || '');
    fd.append('viewOnly', String(!!edit.viewOnly));
    fd.append('mandatory', String(edit.mandatory !== false));
    if (edit.file) fd.append('policyPdf', edit.file);
    const path = edit.mode === 'version' ? `/policies/${edit.fromId}/new-version` : edit._id ? null : '/policies';
    if (path) await act(() => api.upload(path, fd), edit.mode === 'version' ? 'New version drafted. Send it for approval.' : 'Draft saved.');
    else await act(() => api.put(`/policies/${edit._id}`, {
      title: edit.title, category: edit.category, content: edit.content, summary: edit.summary, effectiveDate: edit.effectiveDate,
      applicableLocations: edit.applicableLocations, applicableGrades: (edit.applicableGradesText || '').split(','), viewOnly: edit.viewOnly, mandatory: edit.mandatory,
    }), 'Draft updated.');
  };

  const policies = data.policies as any[];
  return (
    <div className="space-y-5">
      <PageHeader title="Company policies" subtitle={canAuthor ? 'Draft → send for approval → a second person publishes. Published policies change only through a new version.' : 'Read and acknowledge the policies that apply to you. Acknowledgements are permanent.'}>
        <div className="flex gap-2">
          {canAuthor && (
            <select className={inputCls + ' w-48'} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
              {['ALL', 'DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'ARCHIVED', 'REJECTED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          )}
          {canAuthor && <button className={btn(PRIMARY)} onClick={() => setEdit({ title: '', category: 'HR', content: '', effectiveDate: new Date().toISOString().slice(0, 10), applicableLocations: [], viewOnly: false, mandatory: true })}>New policy</button>}
        </div>
      </PageHeader>
      <Msg msg={msg} />
      <div className={card}>
        <Table rows={policies} empty="No policies." cols={[
          { key: 'title', label: 'Policy', render: (p) => <button className="underline decoration-dotted text-left" onClick={() => setOpen(p)}>{p.title}</button> },
          { key: 'version', label: 'Version' }, { key: 'category', label: 'Category' }, { key: 'effectiveDate', label: 'Effective' },
          { key: 'applies', label: 'Applies to', render: (p) => [(p.applicableLocations || []).join(', '), (p.applicableGrades || []).join(', ')].filter(Boolean).join(' · ') || 'Everyone' },
          { key: 'status', label: 'Status', render: (p) => <><Badge s={p.status} /> {p.viewOnly && <Badge s="VIEW ONLY" tone="grey" />}</> },
          { key: 'ack', label: 'My acknowledgement', render: (p) => (p.acknowledged ? <span className="text-emerald-700">✓ {fmtDate(p.acknowledgedAt)}</span> : p.status === 'PUBLISHED' && !canAuthor ? <span className="text-amber-700">Pending</span> : '—') },
        ]} />
      </div>
      {open && (
        <Modal title={`${open.title} (${open.version})`} onClose={() => setOpen(null)} wide>
          <p className="text-xs text-slate-500">Effective {open.effectiveDate} · {open.category} · <Badge s={open.status} /> {open.approvedBy && `· approved by ${open.approvedBy}`} {open.changeNote && `· ${open.changeNote}`}</p>
          <div className="text-xs whitespace-pre-wrap bg-slate-50 rounded-xl p-3 max-h-80 overflow-y-auto select-text">{open.content}</div>
          {(open.fileUrl || open.fileName) && (
            <div className="flex gap-2">
              <button className={btn(SECONDARY)} onClick={() => viewPdf(open)}>View document</button>
              {(!open.viewOnly || canAuthor) && <button className={btn(SECONDARY)} onClick={() => downloadApiFile(`/policies/${open._id}/file?download=true`, open.fileName || 'policy.pdf').catch((e) => setMsg(errMsg(e)))}>Download</button>}
              {open.viewOnly && !canAuthor && <span className="text-xs text-slate-500 self-center">View-only: downloading is disabled.</span>}
            </div>
          )}
          <div className="flex flex-wrap gap-2 justify-end border-t pt-3">
            {open.status === 'PUBLISHED' && !open.acknowledged && user?.employee && (
              <button className={btn(GOOD)} onClick={() => window.confirm('I have read and understood this policy. This acknowledgement cannot be withdrawn.') && act(() => api.post(`/policies/${open._id}/acknowledge`, {}), 'Acknowledged.')}>I acknowledge</button>
            )}
            {canAuthor && open.canEdit && <button className={btn(SECONDARY)} onClick={() => setEdit({ ...open, applicableGradesText: (open.applicableGrades || []).join(', ') })}>Edit draft</button>}
            {canAuthor && ['DRAFT', 'REJECTED'].includes(open.status) && <button className={btn(PRIMARY)} onClick={() => act(() => api.post(`/policies/${open._id}/submit`), 'Sent for approval.')}>Send for approval</button>}
            {open.canApprove && <><button className={btn(GOOD)} onClick={() => act(() => api.post(`/policies/${open._id}/approve`, { decision: 'APPROVED' }), 'Published; applicable employees have been asked to acknowledge.')}>Approve & publish</button>
              <button className={btn(BAD)} onClick={() => { const c = window.prompt('Reason?'); if (c) act(() => api.post(`/policies/${open._id}/approve`, { decision: 'REJECTED', comment: c }), 'Returned to the author.'); }}>Reject</button></>}
            {canAuthor && open.status === 'PUBLISHED' && <button className={btn(SECONDARY)} onClick={() => setEdit({ ...open, mode: 'version', fromId: open._id, changeNote: '', applicableGradesText: (open.applicableGrades || []).join(', ') })}>New version</button>}
            {canAuthor && open.status !== 'DRAFT' && <button className={btn(SECONDARY)} onClick={() => api.get<any>(`/policies/${open._id}/acknowledgements`).then(setReport).catch((e) => setMsg(errMsg(e)))}>Acknowledgement report</button>}
            {canAuthor && ['DRAFT', 'REJECTED'].includes(open.status) && <button className={btn(BAD)} onClick={() => window.confirm('Delete this draft?') && act(() => api.delete(`/policies/${open._id}`), 'Draft deleted.')}>Delete draft</button>}
          </div>
        </Modal>
      )}
      {edit && (
        <Modal title={edit.mode === 'version' ? `New version of ${edit.title}` : edit._id ? 'Edit draft' : 'New policy (draft)'} onClose={() => setEdit(null)} wide>
          <div className="grid md:grid-cols-2 gap-3 text-xs">
            <label>Title<input className={inputCls} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
            <label>Category<input className={inputCls} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></label>
            <label>Effective date<input type="date" className={inputCls} value={edit.effectiveDate} onChange={(e) => setEdit({ ...edit, effectiveDate: e.target.value })} /></label>
            <label>Grades (comma separated, blank = all)<input className={inputCls} value={edit.applicableGradesText || ''} onChange={(e) => setEdit({ ...edit, applicableGradesText: e.target.value })} /></label>
            <fieldset className="md:col-span-2"><legend className="font-semibold">Locations (none ticked = all)</legend>
              <div className="flex flex-wrap gap-3">{data.locations.map((l: string) => (
                <label key={l} className="flex gap-1 items-center"><input type="checkbox" checked={(edit.applicableLocations || []).includes(l)} onChange={(e) => setEdit({ ...edit, applicableLocations: e.target.checked ? [...(edit.applicableLocations || []), l] : edit.applicableLocations.filter((x: string) => x !== l) })} />{l}</label>
              ))}</div>
            </fieldset>
            <label className="md:col-span-2">Policy text<textarea rows={8} className={inputCls} value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} /></label>
            {edit.mode === 'version' && <label className="md:col-span-2">What changed<input className={inputCls} value={edit.changeNote} onChange={(e) => setEdit({ ...edit, changeNote: e.target.value })} /></label>}
            {!edit._id || edit.mode === 'version' ? <label>PDF (optional)<input type="file" accept=".pdf" onChange={(e) => setEdit({ ...edit, file: e.target.files?.[0] })} /></label> : <span />}
            <label className="flex gap-2 items-center"><input type="checkbox" checked={!!edit.viewOnly} onChange={(e) => setEdit({ ...edit, viewOnly: e.target.checked })} /> View-only (employees cannot download)</label>
          </div>
          <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={save}>Save draft</button></div>
        </Modal>
      )}
      {report && (
        <Modal title={`Acknowledgements — ${report.policy.title} ${report.policy.version}`} onClose={() => setReport(null)} wide>
          <p className="text-xs">{report.summary.acknowledged} of {report.summary.applicable} acknowledged · {report.summary.pending} pending</p>
          <div className="flex gap-2">
            <button className={btn(SECONDARY)} onClick={() => saveCsv('acknowledged.csv', ['employeeCode', 'employeeName', 'department', 'acknowledgedAt', 'ipAddress'], report.acknowledged)}>Export acknowledged</button>
            <button className={btn(SECONDARY)} onClick={() => saveCsv('pending.csv', ['employeeCode', 'employeeName', 'department', 'location'], report.pending)}>Export pending</button>
          </div>
          <h4 className="font-semibold text-xs">Pending</h4>
          <Table rows={report.pending} rowKey={(r: any) => r.employeeId} cols={[{ key: 'employeeCode', label: 'Code' }, { key: 'employeeName', label: 'Name' }, { key: 'department', label: 'Department' }]} />
          <h4 className="font-semibold text-xs">Acknowledged</h4>
          <Table rows={report.acknowledged} rowKey={(r: any) => r.employeeId} cols={[{ key: 'employeeCode', label: 'Code' }, { key: 'employeeName', label: 'Name' }, { key: 'acknowledgedAt', label: 'When', render: (r: any) => fmtDate(r.acknowledgedAt) }]} />
        </Modal>
      )}
      {pdfUrl && (
        <Modal title="Policy document" onClose={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} wide>
          <iframe title="Policy document" src={`${pdfUrl}#toolbar=0`} className="w-full h-[70vh] rounded-lg border" />
        </Modal>
      )}
    </div>
  );
};

export default PoliciesPage;
