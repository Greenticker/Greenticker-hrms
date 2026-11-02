import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, BellRing, CalendarRange, Edit2, Layers, ListChecks, MessageCircleQuestion, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { BulkUpload, RemindersPanel } from './PmsTools';
import { pmsService, CompetencyInput, CycleInput, KpiInput, TemplateInput } from '../../services/pmsService';
import { Competency, KpiLibraryItem, PmsCycle, PmsTemplate, Question360 } from '../../types/pms';
import { ReasonDialog } from './GoalSheetView';

const GRADE_OPTIONS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];

const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-900';
const labelCls = 'block text-xs font-semibold text-slate-700';
const btnPrimary = 'px-4 py-2 text-xs font-bold text-white bg-[#023b77] hover:bg-[#012a52] rounded-lg cursor-pointer disabled:opacity-50';
const btnGhost = 'px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer';
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const Modal: React.FC<{ title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({ title, onClose, wide, children }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
    <div className={`bg-white rounded-2xl w-full shadow-2xl flex flex-col max-h-[90vh] ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="overflow-y-auto">{children}</div>
    </div>
  </div>
);

const ErrorBox: React.FC<{ error: string | null }> = ({ error }) =>
  error ? <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div> : null;

const SectionHeader: React.FC<{ title: string; hint: string; action?: React.ReactNode }> = ({ title, hint, action }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div>
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
    </div>
    {action}
  </div>
);

const AddButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button type="button" onClick={onClick} className="flex items-center gap-2 px-4 py-2 bg-[#039583] hover:bg-[#027a6b] text-white rounded-xl text-xs font-bold cursor-pointer self-start sm:self-auto">
    <Plus className="w-4 h-4" /> {label}
  </button>
);

// ======================================================================= cycles

const CYCLE_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  ACTIVE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  CLOSED: 'bg-slate-200 text-slate-500 border-slate-300',
};

const CycleForm: React.FC<{ cycle?: PmsCycle; onClose: () => void; onSaved: () => void }> = ({ cycle, onClose, onSaved }) => {
  const nextYear = new Date().getMonth() >= 3 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const [form, setForm] = useState<CycleInput>(
    cycle
      ? { name: cycle.name, year: cycle.year, startDate: cycle.startDate, endDate: cycle.endDate, phases: cycle.phases }
      : { name: '', year: nextYear, startDate: `${nextYear}-04-01`, endDate: `${nextYear + 1}-03-31`, phases: [] }
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // New cycle: fill phase dates from the brief's calendar whenever the year changes
  useEffect(() => {
    if (cycle || !form.year || form.year < 2000) return;
    pmsService.getDefaultPhases(form.year).then((r) =>
      setForm((f) => ({
        ...f,
        name: `FY ${f.year}-${String(f.year + 1).slice(-2)}`,
        startDate: `${f.year}-04-01`,
        endDate: `${f.year + 1}-03-31`,
        phases: r.phases,
      }))
    );
  }, [form.year, cycle]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      cycle ? await pmsService.updateCycle(cycle._id, form) : await pmsService.createCycle(form);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Could not save the cycle.');
      setSaving(false);
    }
  };

  return (
    <Modal title={cycle ? `Edit ${cycle.name}` : 'New appraisal cycle'} onClose={onClose} wide>
      <form onSubmit={save} className="p-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label htmlFor="cy-year" className={labelCls}>Year (April start) *</label>
            <input id="cy-year" type="number" required disabled={!!cycle} value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="cy-name" className={labelCls}>Name</label>
            <input id="cy-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="cy-start" className={labelCls}>Start date</label>
            <input id="cy-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="cy-end" className={labelCls}>End date</label>
            <input id="cy-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputCls} />
          </div>
        </div>

        <div>
          <p className={labelCls}>Phase dates and deadlines</p>
          <div className="mt-1 rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-left">Phase</th>
                  <th className="py-2 px-3 text-left">Starts</th>
                  <th className="py-2 px-3 text-left">Deadline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {form.phases.map((p, i) => (
                  <tr key={p.key}>
                    <td className="py-1.5 px-3 font-semibold text-slate-800">{p.label}</td>
                    {(['start', 'end'] as const).map((field) => (
                      <td key={field} className="py-1.5 px-3">
                        <input
                          type="date"
                          aria-label={`${p.label} ${field === 'start' ? 'start' : 'deadline'}`}
                          value={p[field]}
                          onChange={(e) => setForm({ ...form, phases: form.phases.map((x, j) => (j === i ? { ...x, [field]: e.target.value } : x)) })}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <ErrorBox error={error} />
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving...' : cycle ? 'Save changes' : 'Create cycle'}</button>
        </div>
      </form>
    </Modal>
  );
};

const RevisionWindowForm: React.FC<{ cycle: PmsCycle; onClose: () => void; onSaved: () => void }> = ({ cycle, onClose, onSaved }) => {
  const [closesOn, setClosesOn] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Open goal revision window" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await pmsService.setRevisionWindow(cycle._id, { open: true, closesOn, reason });
            onSaved();
          } catch (err: any) {
            setError(err?.message || 'Could not open the window.');
          }
        }}
        className="p-6 space-y-4"
      >
        <p className="text-xs text-slate-600">
          While the window is open, employees and managers can reopen locked goal sheets. Every change goes through approval again and the old version is kept.
        </p>
        <div>
          <label htmlFor="rw-closes" className={labelCls}>Closes on *</label>
          <input id="rw-closes" type="date" required value={closesOn} onChange={(e) => setClosesOn(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="rw-reason" className={labelCls}>Reason *</label>
          <textarea id="rw-reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Business plan revised after Q1" />
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" className={btnPrimary}>Open window</button>
        </div>
      </form>
    </Modal>
  );
};

const CyclesPanel: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [cycles, setCycles] = useState<PmsCycle[]>([]);
  const [form, setForm] = useState<{ cycle?: PmsCycle } | null>(null);
  const [windowFor, setWindowFor] = useState<PmsCycle | null>(null);
  const [closing, setClosing] = useState<PmsCycle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => pmsService.getCycles().then((r) => setCycles(r.cycles));
  useEffect(() => {
    load();
  }, []);
  const refresh = () => {
    load();
    onChanged();
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Action failed.');
    }
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <SectionHeader title="Appraisal cycles" hint="One cycle per year (April to March). Only one cycle can be active at a time." action={<AddButton label="New cycle" onClick={() => setForm({})} />} />
      <ErrorBox error={error} />
      {cycles.length === 0 && (
        <div className="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">No cycles yet. Create one to start goal setting.</div>
      )}
      {cycles.map((c) => {
        const current = c.phases.find((p) => p.start <= today && today <= p.end);
        return (
          <div key={c._id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900">{c.name}</h4>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${CYCLE_BADGE[c.status]}`}>{c.status}</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {fmtDate(c.startDate)} – {fmtDate(c.endDate)}
                  {c.status === 'ACTIVE' && current && <> · Current phase: <strong className="text-slate-700">{current.label}</strong> (due {fmtDate(current.end)})</>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.status !== 'CLOSED' && (
                  <button type="button" onClick={() => setForm({ cycle: c })} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <Edit2 className="w-3.5 h-3.5" /> Edit dates
                  </button>
                )}
                {c.status === 'DRAFT' && (
                  <button type="button" onClick={() => act(() => pmsService.activateCycle(c._id))} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#039583] text-white hover:bg-[#027a6b] cursor-pointer">
                    Activate
                  </button>
                )}
                {c.status === 'ACTIVE' &&
                  (c.revisionWindow?.open ? (
                    <button type="button" onClick={() => act(() => pmsService.setRevisionWindow(c._id, { open: false }))} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 bg-amber-50 text-amber-800 cursor-pointer">
                      Close revision window
                    </button>
                  ) : (
                    <button type="button" onClick={() => setWindowFor(c)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                      Open revision window
                    </button>
                  ))}
                {c.status === 'ACTIVE' && !c.feedback360?.closed && (
                  <button
                    type="button"
                    onClick={() => window.confirm('Close 360° feedback? No more feedback can be given, and managers and HR can then see reports.') && act(() => pmsService.close360(c._id))}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
                  >
                    Close 360° feedback
                  </button>
                )}
                {c.status === 'ACTIVE' && c.feedback360?.closed && !c.feedback360?.released && (
                  <button
                    type="button"
                    onClick={() => window.confirm('Release 360° reports to employees?') && act(() => pmsService.release360(c._id))}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#039583] text-white hover:bg-[#027a6b] cursor-pointer"
                  >
                    Release 360° results
                  </button>
                )}
                {c.status === 'ACTIVE' && (
                  <button type="button" onClick={() => setClosing(c)} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-rose-700 hover:bg-rose-50 cursor-pointer">
                    Close cycle
                  </button>
                )}
              </div>
            </div>
            {c.feedback360?.closed && (
              <p className="text-[11px] text-slate-500">
                360° feedback closed{c.feedback360.released ? ' · results released to employees' : ' · results not yet released to employees'}
              </p>
            )}
            {c.revisionWindow?.open && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                Revision window open until <strong>{fmtDate(c.revisionWindow.closesOn)}</strong> — {c.revisionWindow.reason} (opened by {c.revisionWindow.openedBy})
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {c.phases.map((p) => {
                const state = today > p.end ? 'past' : today >= p.start ? 'now' : 'next';
                return (
                  <span
                    key={p.key}
                    title={`${fmtDate(p.start)} – ${fmtDate(p.end)}`}
                    className={`px-2 py-1 rounded-lg text-[10px] font-semibold border ${
                      state === 'now' && c.status === 'ACTIVE' ? 'bg-[#023b77] text-white border-[#023b77]' : state === 'past' ? 'bg-slate-50 text-slate-400 border-slate-100' : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    {p.label} · {fmtDate(p.end).slice(0, 6)}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      {form && <CycleForm cycle={form.cycle} onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); }} />}
      {windowFor && <RevisionWindowForm cycle={windowFor} onClose={() => setWindowFor(null)} onSaved={() => { setWindowFor(null); refresh(); }} />}
      {closing && (
        <ReasonDialog
          title={`Close ${closing.name}`}
          label="Reason for closing the cycle"
          confirmLabel="Close cycle"
          danger
          required
          onCancel={() => setClosing(null)}
          onConfirm={async (r) => {
            await pmsService.closeCycle(closing._id, r);
            setClosing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
};

// ==================================================================== templates

const TemplateForm: React.FC<{ template?: PmsTemplate; onClose: () => void; onSaved: () => void }> = ({ template, onClose, onSaved }) => {
  const [form, setForm] = useState<TemplateInput>(
    template
      ? { name: template.name, grades: template.grades, isDefault: template.isDefault, kpiWeight: template.kpiWeight, competencyWeight: template.competencyWeight, feedback360Weight: template.feedback360Weight }
      : { name: '', grades: [], isDefault: false, kpiWeight: 70, competencyWeight: 20, feedback360Weight: 10 }
  );
  const [error, setError] = useState<string | null>(null);
  const total = form.kpiWeight + form.competencyWeight + form.feedback360Weight;
  const toggleGrade = (g: string) =>
    setForm({ ...form, grades: form.grades.includes(g) ? form.grades.filter((x) => x !== g) : [...form.grades, g].sort() });

  return (
    <Modal title={template ? 'Edit template' : 'New template'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            template ? await pmsService.updateTemplate(template._id, form) : await pmsService.createTemplate(form);
            onSaved();
          } catch (err: any) {
            setError(err?.message || 'Could not save the template.');
          }
        }}
        className="p-6 space-y-4"
      >
        <div>
          <label htmlFor="tp-name" className={labelCls}>Name *</label>
          <input id="tp-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="e.g. Senior leadership" />
        </div>
        <div>
          <p className={labelCls}>Grades (designation bands)</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {GRADE_OPTIONS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => toggleGrade(g)}
                className={`px-3 py-1 rounded-lg text-xs font-bold border cursor-pointer ${form.grades.includes(g) ? 'bg-[#023b77] text-white border-[#023b77]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className={labelCls}>Section weights</p>
          <div className="mt-1 grid grid-cols-3 gap-3">
            {([
              ['kpiWeight', 'KPI %'],
              ['competencyWeight', 'Competency %'],
              ['feedback360Weight', '360° %'],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={`tp-${key}`} className="text-[11px] text-slate-500">{label}</label>
                <input id={`tp-${key}`} type="number" min={0} max={100} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} className={`${inputCls} font-mono`} />
              </div>
            ))}
          </div>
          <p className={`mt-1.5 text-[11px] font-bold ${total === 100 ? 'text-emerald-700' : 'text-amber-700'}`}>Total {total}% {total !== 100 && '(must be 100%)'}</p>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="mt-0.5 rounded border-slate-300" />
          <span>Default template — used for any employee whose grade isn't listed in another template, or who has no grade.</span>
        </label>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={total !== 100} className={btnPrimary}>Save template</button>
        </div>
      </form>
    </Modal>
  );
};

const TemplatesPanel: React.FC = () => {
  const [items, setItems] = useState<PmsTemplate[]>([]);
  const [form, setForm] = useState<{ template?: PmsTemplate } | null>(null);
  const load = () => pmsService.getTemplates().then((r) => setItems(r.templates));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="space-y-4">
      <SectionHeader title="Appraisal templates" hint="Which sections count towards the final score, and their weights, for each grade." action={<AddButton label="New template" onClick={() => setForm({})} />} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((t) => (
          <div key={t._id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  {t.name}
                  {t.isDefault && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#039583]/10 text-[#027a6b]">Default</span>}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">{t.grades.length ? `Grades ${t.grades.join(', ')}` : 'No grades assigned'}</p>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => setForm({ template: t })} className="p-1.5 rounded-lg text-slate-400 hover:text-[#023b77] hover:bg-slate-100 cursor-pointer" aria-label={`Edit ${t.name}`}>
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                {!t.isDefault && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (window.confirm(`Delete template "${t.name}"?`)) {
                        await pmsService.deleteTemplate(t._id);
                        load();
                      }
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 flex h-2.5 rounded-full overflow-hidden bg-slate-100">
              <div className="bg-[#023b77]" style={{ width: `${t.kpiWeight}%` }} />
              <div className="bg-[#039583]" style={{ width: `${t.competencyWeight}%` }} />
              <div className="bg-amber-400" style={{ width: `${t.feedback360Weight}%` }} />
            </div>
            <div className="mt-2 flex gap-4 text-[11px] text-slate-600">
              <span><span className="inline-block w-2 h-2 rounded-full bg-[#023b77] mr-1" />KPI {t.kpiWeight}%</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-[#039583] mr-1" />Competency {t.competencyWeight}%</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />360° {t.feedback360Weight}%</span>
            </div>
          </div>
        ))}
      </div>
      {form && <TemplateForm template={form.template} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
};

// ================================================================== KPI library

const KpiForm: React.FC<{ kpi?: KpiLibraryItem; departments: string[]; onClose: () => void; onSaved: () => void }> = ({ kpi, departments, onClose, onSaved }) => {
  const [form, setForm] = useState<KpiInput>(
    kpi ? { department: kpi.department, kra: kpi.kra, kpi: kpi.kpi, unit: kpi.unit, direction: kpi.direction, mandatory: kpi.mandatory } : { department: '', kra: '', kpi: '', unit: '', direction: 'HIGHER', mandatory: false }
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={kpi ? 'Edit KPI' : 'Add KPI to library'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            kpi ? await pmsService.updateKpi(kpi._id, form) : await pmsService.createKpi(form);
            onSaved();
          } catch (err: any) {
            setError(err?.message || 'Could not save the KPI.');
          }
        }}
        className="p-6 space-y-4"
      >
        <div>
          <label htmlFor="kp-dept" className={labelCls}>Department *</label>
          <input id="kp-dept" list="kp-depts" required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputCls} placeholder="e.g. Sales, or All" />
          <datalist id="kp-depts">{departments.map((d) => <option key={d} value={d} />)}</datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="kp-kra" className={labelCls}>KRA *</label>
            <input id="kp-kra" required value={form.kra} onChange={(e) => setForm({ ...form, kra: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="kp-unit" className={labelCls}>Unit *</label>
            <input id="kp-unit" required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputCls} placeholder="%, Count, Days, ₹ Cr" />
          </div>
        </div>
        <div>
          <label htmlFor="kp-kpi" className={labelCls}>KPI *</label>
          <input id="kp-kpi" required value={form.kpi} onChange={(e) => setForm({ ...form, kpi: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label htmlFor="kp-dir" className={labelCls}>Better when</label>
          <select id="kp-dir" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as KpiInput['direction'] })} className={inputCls}>
            <option value="HIGHER">Higher is better</option>
            <option value="LOWER">Lower is better</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={form.mandatory} onChange={(e) => setForm({ ...form, mandatory: e.target.checked })} className="rounded border-slate-300" />
          Mandatory for every employee
        </label>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" className={btnPrimary}>Save KPI</button>
        </div>
      </form>
    </Modal>
  );
};

const KpiLibraryPanel: React.FC = () => {
  const [items, setItems] = useState<KpiLibraryItem[]>([]);
  const [form, setForm] = useState<{ kpi?: KpiLibraryItem } | null>(null);
  const [dept, setDept] = useState('ALL');
  const load = () => pmsService.getKpiLibrary().then((r) => setItems(r.kpis));
  useEffect(() => {
    load();
  }, []);
  const departments = useMemo(() => [...new Set(items.map((k) => k.department))].sort(), [items]);
  const shown = items.filter((k) => dept === 'ALL' || k.department === dept);
  return (
    <div className="space-y-4">
      <SectionHeader title="KPI library" hint="Master list of KRAs and KPIs that managers and employees pick from." action={<AddButton label="Add KPI" onClick={() => setForm({})} />} />
      <div className="flex flex-wrap gap-1.5">
        {['ALL', ...departments].map((d) => (
          <button key={d} type="button" onClick={() => setDept(d)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${dept === d ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            {d === 'ALL' ? `All (${items.length})` : d}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-4">Department</th>
              <th className="py-2.5 px-4">KRA</th>
              <th className="py-2.5 px-4">KPI</th>
              <th className="py-2.5 px-4">Unit</th>
              <th className="py-2.5 px-4">Better when</th>
              <th className="py-2.5 px-4 w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((k) => (
              <tr key={k._id} className="hover:bg-slate-50/60">
                <td className="py-2.5 px-4 text-slate-600">{k.department}</td>
                <td className="py-2.5 px-4 text-slate-700">
                  {k.kra} {k.mandatory && <span className="ml-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Mandatory</span>}
                </td>
                <td className="py-2.5 px-4 font-semibold text-slate-900">{k.kpi}</td>
                <td className="py-2.5 px-4 text-slate-600">{k.unit}</td>
                <td className="py-2.5 px-4">
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    {k.direction === 'HIGHER' ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />}
                    {k.direction === 'HIGHER' ? 'Higher' : 'Lower'}
                  </span>
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex gap-1 justify-end">
                    <button type="button" onClick={() => setForm({ kpi: k })} className="p-1.5 rounded-lg text-slate-400 hover:text-[#023b77] hover:bg-slate-100 cursor-pointer" aria-label={`Edit ${k.kpi}`}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (window.confirm(`Remove "${k.kpi}" from the library? Goal sheets that already use it keep their copy.`)) {
                          await pmsService.deleteKpi(k._id);
                          load();
                        }
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                      aria-label={`Delete ${k.kpi}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <KpiForm kpi={form.kpi} departments={departments} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
};

// ================================================================= competencies

const CompetencyForm: React.FC<{ item?: Competency; onClose: () => void; onSaved: () => void }> = ({ item, onClose, onSaved }) => {
  const [form, setForm] = useState<CompetencyInput>(item ? { name: item.name, description: item.description, appliesTo: item.appliesTo } : { name: '', description: '', appliesTo: 'ALL' });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={item ? 'Edit competency' : 'Add competency'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            item ? await pmsService.updateCompetency(item._id, form) : await pmsService.createCompetency(form);
            onSaved();
          } catch (err: any) {
            setError(err?.message || 'Could not save the competency.');
          }
        }}
        className="p-6 space-y-4"
      >
        <div>
          <label htmlFor="cp-name" className={labelCls}>Name *</label>
          <input id="cp-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label htmlFor="cp-desc" className={labelCls}>Description</label>
          <textarea id="cp-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label htmlFor="cp-applies" className={labelCls}>Applies to</label>
          <select id="cp-applies" value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value as CompetencyInput['appliesTo'] })} className={inputCls}>
            <option value="ALL">All employees</option>
            <option value="MANAGERS">People managers only</option>
          </select>
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" className={btnPrimary}>Save</button>
        </div>
      </form>
    </Modal>
  );
};

const CompetenciesPanel: React.FC = () => {
  const [items, setItems] = useState<Competency[]>([]);
  const [form, setForm] = useState<{ item?: Competency } | null>(null);
  const load = () => pmsService.getCompetencies().then((r) => setItems(r.competencies));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="space-y-4">
      <SectionHeader title="Competencies" hint="Rated 1–5 by the manager at year end and in 360° feedback." action={<AddButton label="Add competency" onClick={() => setForm({})} />} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((c, i) => (
          <div key={c._id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">
                {i + 1}. {c.name}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">{c.appliesTo === 'MANAGERS' ? 'People managers only' : 'All employees'}</p>
              {c.description && <p className="text-xs text-slate-600 mt-1.5">{c.description}</p>}
            </div>
            <div className="flex gap-1 shrink-0">
              <button type="button" onClick={() => setForm({ item: c })} className="p-1.5 rounded-lg text-slate-400 hover:text-[#023b77] hover:bg-slate-100 cursor-pointer" aria-label={`Edit ${c.name}`}>
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (window.confirm(`Delete competency "${c.name}"?`)) {
                    await pmsService.deleteCompetency(c._id);
                    load();
                  }
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                aria-label={`Delete ${c.name}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {form && <CompetencyForm item={form.item} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
};

// ================================================================ 360 questions

const QuestionsPanel: React.FC = () => {
  const [items, setItems] = useState<Question360[]>([]);
  const [comps, setComps] = useState<Competency[]>([]);
  const [form, setForm] = useState<{ q?: Question360; text: string; competencyId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    pmsService.getQuestions().then((r) => setItems(r.questions));
    pmsService.getCompetencies().then((r) => setComps(r.competencies));
  };
  useEffect(load, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError(null);
    try {
      const data = { text: form.text, competencyId: form.competencyId, order: form.q?.order };
      form.q ? await pmsService.updateQuestion(form.q._id, data) : await pmsService.createQuestion(data);
      setForm(null);
      load();
    } catch (err: any) {
      setError(err?.message || 'Could not save the question.');
    }
  };
  return (
    <div className="space-y-4">
      <SectionHeader
        title="360° feedback questions"
        hint="Each question is rated 1–5 and belongs to a competency. People-management questions are only asked about managers. Questions are locked once anyone has given feedback this cycle."
        action={<AddButton label="Add question" onClick={() => setForm({ text: '', competencyId: comps[0]?._id || '' })} />}
      />
      <ErrorBox error={!form ? error : null} />
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs divide-y divide-slate-100">
        {items.map((q, i) => (
          <div key={q._id} className="flex items-start justify-between gap-3 px-5 py-3">
            <div>
              <p className="text-xs text-slate-900">
                <span className="font-mono text-slate-400 mr-2">{i + 1}.</span>
                {q.text}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 ml-6">
                {q.competencyName}
                {q.appliesTo === 'MANAGERS' && ' · managers only'}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button type="button" onClick={() => setForm({ q, text: q.text, competencyId: q.competencyId })} className="p-1.5 rounded-lg text-slate-400 hover:text-[#023b77] hover:bg-slate-100 cursor-pointer" aria-label="Edit question">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm('Delete this question?')) return;
                  setError(null);
                  try {
                    await pmsService.deleteQuestion(q._id);
                    load();
                  } catch (err: any) {
                    setError(err?.message || 'Could not delete.');
                  }
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                aria-label="Delete question"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {form && (
        <Modal title={form.q ? 'Edit question' : 'Add question'} onClose={() => setForm(null)}>
          <form onSubmit={save} className="p-6 space-y-4">
            <div>
              <label htmlFor="q-text" className={labelCls}>Question *</label>
              <textarea id="q-text" required rows={3} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label htmlFor="q-comp" className={labelCls}>Competency *</label>
              <select id="q-comp" value={form.competencyId} onChange={(e) => setForm({ ...form, competencyId: e.target.value })} className={inputCls}>
                {comps.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            <ErrorBox error={error} />
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setForm(null)} className={btnGhost}>Cancel</button>
              <button type="submit" className={btnPrimary}>Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

// ======================================================================== shell

type SetupTab = 'cycles' | 'templates' | 'library' | 'competencies' | 'questions' | 'bulk' | 'reminders';

export const PmsSetup: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [tab, setTab] = useState<SetupTab>('cycles');
  const tabs: [SetupTab, string, React.ComponentType<{ className?: string }>][] = [
    ['cycles', 'Cycles', CalendarRange],
    ['templates', 'Templates', Layers],
    ['library', 'KPI library', ListChecks],
    ['competencies', 'Competencies', Sparkles],
    ['questions', '360° questions', MessageCircleQuestion],
    ['bulk', 'Bulk upload', Upload],
    ['reminders', 'Reminders', BellRing],
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${tab === id ? 'bg-white text-[#023b77] shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      {tab === 'cycles' && <CyclesPanel onChanged={onChanged} />}
      {tab === 'templates' && <TemplatesPanel />}
      {tab === 'library' && <KpiLibraryPanel />}
      {tab === 'competencies' && <CompetenciesPanel />}
      {tab === 'questions' && <QuestionsPanel />}
      {tab === 'bulk' && <BulkUpload />}
      {tab === 'reminders' && <RemindersPanel />}
    </div>
  );
};
