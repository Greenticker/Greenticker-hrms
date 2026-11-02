import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  History,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { pmsService } from '../../services/pmsService';
import { Direction, GoalLine, GoalSheet, GoalSheetStatus, KpiLibraryItem, PmsRules } from '../../types/pms';

// ------------------------------------------------------------------ shared bits

export const STATUS_STYLE: Record<GoalSheetStatus, { label: string; cls: string }> = {
  NOT_STARTED: { label: 'Not started', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  DRAFT: { label: 'Draft', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  SUBMITTED: { label: 'With manager', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  APPROVED: { label: 'With reviewer', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  LOCKED: { label: 'Locked', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
};

export const StatusBadge: React.FC<{ status: GoalSheetStatus }> = ({ status }) => {
  const s = STATUS_STYLE[status] || STATUS_STYLE.DRAFT;
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase whitespace-nowrap ${s.cls}`}>{s.label}</span>;
};

const STEPS: { status: GoalSheetStatus; label: string }[] = [
  { status: 'DRAFT', label: 'Draft' },
  { status: 'SUBMITTED', label: 'Manager' },
  { status: 'APPROVED', label: 'Reviewer' },
  { status: 'LOCKED', label: 'Locked' },
];

const ACTION_LABEL: Record<string, string> = {
  SUBMITTED: 'Submitted',
  MANAGER_APPROVED: 'Approved by manager',
  REVIEWER_APPROVED: 'Approved by reviewer',
  SENT_BACK: 'Sent back',
  REVISION_STARTED: 'Revision started',
};

const fmtDateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/** Dialog asking for a comment / reason before an action. */
export const ReasonDialog: React.FC<{
  title: string;
  label: string;
  confirmLabel: string;
  required?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (text: string) => Promise<void>;
}> = ({ title, label, confirmLabel, required, danger, onCancel, onConfirm }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (required && !text.trim()) return;
          setBusy(true);
          setError(null);
          try {
            await onConfirm(text.trim());
          } catch (err: any) {
            setError(err?.message || 'Something went wrong.');
            setBusy(false);
          }
        }}
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div>
          <label htmlFor="reason-text" className="block text-xs font-semibold text-slate-700">
            {label} {required && '*'}
          </label>
          <textarea
            id="reason-text"
            autoFocus
            rows={3}
            required={required}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>
        {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || (required && !text.trim())}
            className={`px-4 py-2 text-xs font-bold text-white rounded-lg cursor-pointer disabled:opacity-50 ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#023b77] hover:bg-[#012a52]'
            }`}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

// ------------------------------------------------------------------ editing model

interface EditLine {
  key: string;
  _id?: string;
  libraryId?: string | null;
  kra: string;
  kpi: string;
  unit: string;
  direction: Direction;
  weight: string;
  target: string;
}

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

const toEdit = (l: GoalLine): EditLine => ({
  key: l._id || newKey(),
  _id: l._id,
  libraryId: l.libraryId,
  kra: l.kra,
  kpi: l.kpi,
  unit: l.unit,
  direction: l.direction,
  weight: l.weight == null ? '' : String(l.weight),
  target: l.target == null ? '' : String(l.target),
});

const parseNum = (s: string): number | null => (s.trim() === '' || isNaN(Number(s)) ? null : Number(s));

const toLine = (e: EditLine): GoalLine => ({
  _id: e._id,
  libraryId: e.libraryId,
  kra: e.kra.trim(),
  kpi: e.kpi.trim(),
  unit: e.unit.trim(),
  direction: e.direction,
  weight: parseNum(e.weight),
  target: parseNum(e.target),
});

/** Same rules as the server (sheet 1_Overview), so problems show while typing. */
const checkLines = (lines: EditLine[], rules: PmsRules): string[] => {
  const errors: string[] = [];
  if (lines.length < rules.minLines || lines.length > rules.maxLines)
    errors.push(`Add between ${rules.minLines} and ${rules.maxLines} KPIs (currently ${lines.length}).`);
  lines.forEach((l, i) => {
    const name = l.kpi.trim() || `KPI ${i + 1}`;
    if (!l.kra.trim() || !l.kpi.trim() || !l.unit.trim()) errors.push(`${name}: KRA, KPI and unit are required.`);
    const t = parseNum(l.target);
    if (t === null || t <= 0) errors.push(`${name}: target must be a number above 0.`);
    const w = parseNum(l.weight);
    if (w === null || w < rules.minWeight || w > rules.maxWeight)
      errors.push(`${name}: weight must be between ${rules.minWeight}% and ${rules.maxWeight}%.`);
  });
  const total = lines.reduce((s, l) => s + (parseNum(l.weight) ?? 0), 0);
  if (lines.length && Math.abs(total - 100) > 1e-6) errors.push(`Weights must add up to 100% (currently ${total}%).`);
  const compliance = lines
    .filter((l) => l.kra.trim().toLowerCase() === rules.complianceKra.toLowerCase())
    .reduce((s, l) => s + (parseNum(l.weight) ?? 0), 0);
  if (compliance < rules.complianceMinWeight)
    errors.push(`Every goal sheet needs the "${rules.complianceKra}" KRA at ${rules.complianceMinWeight}% or more.`);
  return errors;
};

// ------------------------------------------------------------------ KPI picker

const KpiPicker: React.FC<{
  library: KpiLibraryItem[];
  department?: string;
  onPick: (k: KpiLibraryItem) => void;
  onClose: () => void;
}> = ({ library, department, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState<string>('ALL');
  const departments = useMemo(() => [...new Set(library.map((k) => k.department))].sort(), [library]);
  const shown = library.filter(
    (k) =>
      (dept === 'ALL' || k.department === dept) &&
      `${k.department} ${k.kra} ${k.kpi}`.toLowerCase().includes(q.trim().toLowerCase())
  );
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Add from KPI library</h3>
            {department && <p className="text-[11px] text-slate-500 mt-0.5">Employee department: {department}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-3 flex flex-col sm:flex-row gap-2 border-b border-slate-100">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search KRA or KPI..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white">
            <option value="ALL">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="overflow-y-auto p-3 space-y-1.5">
          {shown.map((k) => (
            <button
              key={k._id}
              type="button"
              onClick={() => onPick(k)}
              className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-[#039583] hover:bg-[#039583]/5 transition cursor-pointer flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900">
                  {k.kpi} {k.mandatory && <span className="ml-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Mandatory</span>}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {k.department} · {k.kra} · {k.unit}
                </p>
              </div>
              <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 shrink-0">
                {k.direction === 'HIGHER' ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />}
                {k.direction === 'HIGHER' ? 'Higher is better' : 'Lower is better'}
              </span>
            </button>
          ))}
          {shown.length === 0 && <p className="py-8 text-center text-xs text-slate-400">No KPIs match.</p>}
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ main view

interface Props {
  sheet: GoalSheet;
  rules: PmsRules;
  library: KpiLibraryItem[];
  onChange: (sheet: GoalSheet) => void;
  onBack?: () => void;
}

type Dialog = null | 'sendBack' | 'approve' | 'revise' | 'actuals';

export const GoalSheetView: React.FC<Props> = ({ sheet, rules, library, onChange, onBack }) => {
  const perms = sheet.permissions;
  const [edit, setEdit] = useState<EditLine[]>(() => sheet.lines.map(toEdit));
  const [dirty, setDirty] = useState(false);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [actualsMode, setActualsMode] = useState(false);
  const [picker, setPicker] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Reset local edits whenever the server copy changes
  useEffect(() => {
    setEdit(sheet.lines.map(toEdit));
    setDirty(false);
    setActuals(Object.fromEntries(sheet.lines.map((l) => [l._id!, l.actual == null ? '' : String(l.actual)])));
  }, [sheet]);

  const liveErrors = perms.canEdit ? checkLines(edit, rules) : sheet.validationErrors;
  const weightTotal = edit.reduce((s, l) => s + (parseNum(l.weight) ?? 0), 0);
  const hasCompliance = edit.some((l) => l.kra.trim().toLowerCase() === rules.complianceKra.toLowerCase());
  const mandatoryKpi = library.find((k) => k.mandatory);
  const hasActuals = sheet.lines.some((l) => l.actual != null);

  const run = async (fn: () => Promise<{ sheet: GoalSheet }>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      onChange(res.sheet);
      return res.sheet;
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const update = (key: string, patch: Partial<EditLine>) => {
    setEdit((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const addLine = (from?: KpiLibraryItem) => {
    setEdit((prev) => [
      ...prev,
      {
        key: newKey(),
        libraryId: from?._id ?? null,
        kra: from?.kra ?? '',
        kpi: from?.kpi ?? '',
        unit: from?.unit ?? '',
        direction: from?.direction ?? 'HIGHER',
        weight: from?.mandatory ? String(rules.complianceMinWeight) : '',
        target: '',
      },
    ]);
    setDirty(true);
  };

  const save = () => run(() => pmsService.saveLines(sheet._id, edit.map(toLine)));

  const submit = async () => {
    if (dirty && !(await save())) return;
    await run(() => pmsService.submit(sheet._id));
  };

  const currentStep = STEPS.findIndex((s) => s.status === sheet.status);
  const pct = (v?: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
  const inputCls = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#023b77]';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            {onBack && (
              <button type="button" onClick={onBack} className="text-[11px] font-semibold text-[#039583] hover:underline cursor-pointer mb-1">
                ← Back to list
              </button>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{sheet.employeeName}</h2>
              <StatusBadge status={sheet.status} />
              <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">v{sheet.version}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {[sheet.designation, sheet.department, sheet.grade ? `Grade ${sheet.grade}` : 'No grade (default template)'].filter(Boolean).join(' · ')}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Manager: {sheet.managerName || 'HR (no manager on record)'} · Reviewer: {sheet.reviewerName || 'none'} · {sheet.cycle.name}
            </p>
          </div>

          {/* Approval progress */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.status}>
                {i > 0 && <div className={`h-0.5 w-6 ${i <= currentStep ? 'bg-[#039583]' : 'bg-slate-200'}`} />}
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      i < currentStep ? 'bg-[#039583] text-white' : i === currentStep ? 'bg-[#023b77] text-white' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {i < currentStep ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.status === 'LOCKED' ? <Lock className="w-3 h-3" /> : i + 1}
                  </div>
                  <span className={`text-[10px] font-semibold ${i === currentStep ? 'text-slate-900' : 'text-slate-400'}`}>{s.label}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-slate-500">
          <span>
            Final score weights ({sheet.weights.templateName || 'template'}):{' '}
            <strong className="text-slate-800">
              KPI {sheet.weights.kpi}% · Competency {sheet.weights.competency}% · 360° {sheet.weights.feedback360}%
            </strong>
          </span>
          {sheet.kpiScore != null && (
            <span>
              KPI section score: <strong className="text-slate-900 text-sm">{sheet.kpiScore.toFixed(2)}</strong> / 5
            </span>
          )}
        </div>
      </div>

      {sheet.status === 'LOCKED' && sheet.cycle.revisionOpen && !perms.canRevise && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">HR has opened a revision window for this cycle.</div>
      )}

      {/* Rule checks */}
      {(perms.canEdit || perms.canSubmit) && (
        <div
          className={`p-4 rounded-xl border text-xs ${
            liveErrors.length ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {liveErrors.length ? (
            <>
              <p className="font-bold flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-4 h-4" /> Fix these before submitting
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                {liveErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> All goal rules are met. Ready to submit.
            </p>
          )}
        </div>
      )}

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}

      {/* Goal lines */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Goals ({edit.length} of {rules.maxLines})
          </h3>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-bold font-mono ${Math.abs(weightTotal - 100) < 1e-6 ? 'text-emerald-700' : 'text-amber-700'}`}>
              Total weight {weightTotal}%
            </span>
            {perms.canEdit && (
              <>
                {!hasCompliance && mandatoryKpi && (
                  <button type="button" onClick={() => addLine(mandatoryKpi)} className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 cursor-pointer">
                    + Compliance KRA
                  </button>
                )}
                <button
                  type="button"
                  disabled={edit.length >= rules.maxLines}
                  onClick={() => setPicker(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-[#023b77] text-white hover:bg-[#012a52] cursor-pointer disabled:opacity-40"
                >
                  <BookOpen className="w-3.5 h-3.5" /> From library
                </button>
                <button
                  type="button"
                  disabled={edit.length >= rules.maxLines}
                  onClick={() => addLine()}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" /> Custom
                </button>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3 min-w-[140px]">KRA</th>
                <th className="py-2.5 px-3 min-w-[170px]">KPI</th>
                <th className="py-2.5 px-3 w-20">Unit</th>
                <th className="py-2.5 px-3 w-32">Better when</th>
                <th className="py-2.5 px-3 w-20 text-right">Weight %</th>
                <th className="py-2.5 px-3 w-24 text-right">Target</th>
                {!perms.canEdit && (hasActuals || actualsMode) && (
                  <>
                    <th className="py-2.5 px-3 w-24 text-right">Actual</th>
                    <th className="py-2.5 px-3 w-24 text-right">Achieved</th>
                    <th className="py-2.5 px-3 w-16 text-center">Score</th>
                  </>
                )}
                {perms.canEdit && <th className="py-2.5 px-2 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {perms.canEdit
                ? edit.map((l) => (
                    <tr key={l.key} className="align-top">
                      <td className="py-2 px-3"><input aria-label="KRA" className={inputCls} value={l.kra} onChange={(e) => update(l.key, { kra: e.target.value })} /></td>
                      <td className="py-2 px-3"><input aria-label="KPI" className={inputCls} value={l.kpi} onChange={(e) => update(l.key, { kpi: e.target.value })} /></td>
                      <td className="py-2 px-3"><input aria-label="Unit" className={inputCls} value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} /></td>
                      <td className="py-2 px-3">
                        <select aria-label="Direction" className={inputCls} value={l.direction} onChange={(e) => update(l.key, { direction: e.target.value as Direction })}>
                          <option value="HIGHER">Higher</option>
                          <option value="LOWER">Lower</option>
                        </select>
                      </td>
                      <td className="py-2 px-3"><input aria-label="Weight %" type="number" min={0} max={100} className={`${inputCls} text-right font-mono`} value={l.weight} onChange={(e) => update(l.key, { weight: e.target.value })} /></td>
                      <td className="py-2 px-3"><input aria-label="Target" type="number" min={0} step="any" className={`${inputCls} text-right font-mono`} value={l.target} onChange={(e) => update(l.key, { target: e.target.value })} /></td>
                      <td className="py-2 px-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEdit((prev) => prev.filter((x) => x.key !== l.key));
                            setDirty(true);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                          aria-label={`Remove ${l.kpi || 'KPI'}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                : sheet.lines.map((l) => (
                    <tr key={l._id}>
                      <td className="py-2.5 px-3 text-slate-700">{l.kra}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{l.kpi}</td>
                      <td className="py-2.5 px-3 text-slate-600">{l.unit}</td>
                      <td className="py-2.5 px-3 text-slate-600">{l.direction === 'HIGHER' ? 'Higher' : 'Lower'}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{l.weight}%</td>
                      <td className="py-2.5 px-3 text-right font-mono">{l.target}</td>
                      {(hasActuals || actualsMode) && (
                        <>
                          <td className="py-2 px-3 text-right font-mono">
                            {actualsMode ? (
                              <input
                                aria-label={`Actual for ${l.kpi}`}
                                type="number"
                                min={0}
                                step="any"
                                className={`${inputCls} text-right font-mono`}
                                value={actuals[l._id!] ?? ''}
                                onChange={(e) => setActuals((a) => ({ ...a, [l._id!]: e.target.value }))}
                              />
                            ) : (
                              l.actual ?? '—'
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-600">{pct(l.achievement)}</td>
                          <td className="py-2.5 px-3 text-center">
                            {l.score != null ? <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-[#023b77] text-white text-[11px] font-bold">{l.score}</span> : '—'}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
              {(perms.canEdit ? edit.length : sheet.lines.length) === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-xs text-slate-400">
                    {perms.canEdit ? 'No goals yet. Add KPIs from the library or create a custom one.' : 'No goals have been added yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        {(perms.canEdit || perms.canSubmit || perms.canApprove || perms.canSendBack || perms.canRevise || perms.canRecordActuals) && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60">
            {perms.canEdit && (
              <button type="button" disabled={!dirty || busy} onClick={save} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-40">
                <Save className="w-3.5 h-3.5" /> Save draft
              </button>
            )}
            {perms.canSubmit && (
              <button type="button" disabled={busy || liveErrors.length > 0} onClick={submit} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#039583] text-white hover:bg-[#027a6b] cursor-pointer disabled:opacity-40">
                <Send className="w-3.5 h-3.5" /> Submit for approval
              </button>
            )}
            {perms.canSendBack && (
              <button type="button" disabled={busy} onClick={() => setDialog('sendBack')} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 cursor-pointer">
                <Undo2 className="w-3.5 h-3.5" /> Send back
              </button>
            )}
            {perms.canApprove && (
              <button type="button" disabled={busy} onClick={() => setDialog('approve')} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#039583] text-white hover:bg-[#027a6b] cursor-pointer">
                <CheckCircle2 className="w-3.5 h-3.5" /> {sheet.status === 'APPROVED' || !sheet.reviewerName ? 'Approve & lock' : 'Approve'}
              </button>
            )}
            {perms.canRevise && (
              <button type="button" disabled={busy} onClick={() => setDialog('revise')} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer">
                <RotateCcw className="w-3.5 h-3.5" /> Revise goals
              </button>
            )}
            {perms.canRecordActuals &&
              (actualsMode ? (
                <>
                  <button type="button" onClick={() => setActualsMode(false)} className="px-3.5 py-2 text-xs font-semibold rounded-lg text-slate-600 bg-slate-100 cursor-pointer">
                    Cancel
                  </button>
                  <button type="button" disabled={busy} onClick={() => setDialog('actuals')} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#023b77] text-white hover:bg-[#012a52] cursor-pointer">
                    <Save className="w-3.5 h-3.5" /> Save actuals
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setActualsMode(true)} className="px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer">
                  Record actuals
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Activity & versions */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs">
        <button type="button" onClick={() => setShowHistory((v) => !v)} className="w-full flex items-center justify-between px-5 py-3 cursor-pointer">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <History className="w-3.5 h-3.5" /> Activity & versions ({sheet.trail.length} steps, {sheet.history.length} locked versions)
          </span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
        </button>
        {showHistory && (
          <div className="px-5 pb-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ol className="space-y-3 border-l-2 border-slate-100 pl-4">
              {[...sheet.trail].reverse().map((t, i) => (
                <li key={i} className="text-xs">
                  <p className="font-bold text-slate-800">
                    {ACTION_LABEL[t.action] || t.action} <span className="font-normal text-slate-500">by {t.byName}</span>
                  </p>
                  <p className="text-[11px] text-slate-400">{fmtDateTime(t.at)}</p>
                  {t.comment && <p className="mt-1 text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5">“{t.comment}”</p>}
                </li>
              ))}
              {sheet.trail.length === 0 && <li className="text-xs text-slate-400">Nothing has happened yet.</li>}
            </ol>
            <div className="space-y-3">
              {[...sheet.history].reverse().map((h) => (
                <div key={h.version} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-bold text-slate-800">
                    Version {h.version} <span className="font-normal text-slate-500">locked {fmtDateTime(h.lockedOn)} by {h.lockedBy}</span>
                  </p>
                  <ul className="mt-2 space-y-0.5 text-[11px] text-slate-600">
                    {h.lines.map((l) => (
                      <li key={l._id} className="flex justify-between gap-2">
                        <span className="truncate">{l.kpi}</span>
                        <span className="font-mono shrink-0">{l.weight}% · target {l.target}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {sheet.history.length === 0 && <p className="text-xs text-slate-400">No locked versions yet.</p>}
            </div>
          </div>
        )}
      </div>

      {picker && (
        <KpiPicker
          library={library}
          department={sheet.department}
          onClose={() => setPicker(false)}
          onPick={(k) => {
            addLine(k);
            setPicker(false);
          }}
        />
      )}
      {dialog === 'sendBack' && (
        <ReasonDialog
          title="Send goals back"
          label={sheet.status === 'SUBMITTED' ? 'What should the employee change?' : 'What should the manager change?'}
          confirmLabel="Send back"
          required
          onCancel={() => setDialog(null)}
          onConfirm={async (c) => {
            if (await run(() => pmsService.sendBack(sheet._id, c))) setDialog(null);
          }}
        />
      )}
      {dialog === 'approve' && (
        <ReasonDialog
          title={sheet.status === 'APPROVED' || !sheet.reviewerName ? 'Approve and lock goals' : 'Approve goals'}
          label="Comment (optional)"
          confirmLabel="Approve"
          onCancel={() => setDialog(null)}
          onConfirm={async (c) => {
            if (await run(() => pmsService.approve(sheet._id, c))) setDialog(null);
          }}
        />
      )}
      {dialog === 'revise' && (
        <ReasonDialog
          title="Revise locked goals"
          label="Why do these goals need to change?"
          confirmLabel="Start revision"
          required
          onCancel={() => setDialog(null)}
          onConfirm={async (r) => {
            if (await run(() => pmsService.revise(sheet._id, r))) setDialog(null);
          }}
        />
      )}
      {dialog === 'actuals' && (
        <ReasonDialog
          title="Save KPI actuals"
          label="Source or note (optional), e.g. Q2 MIS report"
          confirmLabel="Save actuals"
          onCancel={() => setDialog(null)}
          onConfirm={async (r) => {
            const values = Object.fromEntries(Object.entries(actuals).map(([id, v]) => [id, parseNum(v)]));
            if (await run(() => pmsService.recordActuals(sheet._id, values, r))) {
              setDialog(null);
              setActualsMode(false);
            }
          }}
        />
      )}
    </div>
  );
};
