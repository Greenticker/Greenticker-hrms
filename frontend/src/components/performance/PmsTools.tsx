import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { BellRing, CheckCircle2, Download, FileSpreadsheet, Send, Upload, XCircle } from 'lucide-react';
import { pmsService } from '../../services/pmsService';
import { exportToExcel } from '../../utils/exportUtils';
import { BulkActualsResult, BulkGoalsResult, ReminderItem } from '../../types/pms';

// --------------------------------------------------------------- bulk upload

type Mode = 'goals' | 'actuals';

const COLUMNS: Record<Mode, { key: string; header: string; aliases: string[] }[]> = {
  goals: [
    { key: 'employeeCode', header: 'Employee code', aliases: ['employee code', 'emp code', 'code', 'employee id'] },
    { key: 'kra', header: 'KRA', aliases: ['kra'] },
    { key: 'kpi', header: 'KPI', aliases: ['kpi'] },
    { key: 'unit', header: 'Unit', aliases: ['unit'] },
    { key: 'direction', header: 'Higher / Lower better', aliases: ['higher / lower better', 'direction', 'better when', 'higher/lower'] },
    { key: 'weight', header: 'Weight %', aliases: ['weight %', 'weight', 'weightage'] },
    { key: 'target', header: 'Target', aliases: ['target'] },
  ],
  actuals: [
    { key: 'employeeCode', header: 'Employee code', aliases: ['employee code', 'emp code', 'code', 'employee id'] },
    { key: 'kpi', header: 'KPI', aliases: ['kpi'] },
    { key: 'actual', header: 'Actual', aliases: ['actual', 'actuals', 'value'] },
  ],
};

const SAMPLE: Record<Mode, Record<string, unknown>[]> = {
  goals: [
    { employeeCode: 'EMP001', kra: 'Business growth', kpi: 'Gross sales', unit: '₹ Cr', direction: 'Higher', weight: 40, target: 500 },
    { employeeCode: 'EMP001', kra: 'Service', kpi: 'Complaints', unit: 'Count', direction: 'Lower', weight: 30, target: 4 },
    { employeeCode: 'EMP001', kra: 'Distribution', kpi: 'New active distributors', unit: 'Count', direction: 'Higher', weight: 20, target: 10 },
    { employeeCode: 'EMP001', kra: 'Compliance (mandatory)', kpi: 'Mandatory training completion', unit: '%', direction: 'Higher', weight: 10, target: 100 },
  ],
  actuals: [
    { employeeCode: 'EMP001', kpi: 'Gross sales', actual: 540 },
    { employeeCode: 'EMP001', kpi: 'Complaints', actual: 2 },
  ],
};

/** Reads the first sheet; header names are matched loosely so HR's own sheets work. */
const parseSheet = async (file: File, mode: Mode): Promise<{ rows: Record<string, unknown>[]; missing: string[] }> => {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const headers = Object.keys(raw[0] || {});
  const find = (aliases: string[]) => headers.find((h) => aliases.includes(h.trim().toLowerCase()));
  const map = COLUMNS[mode].map((c) => ({ ...c, source: find(c.aliases) }));
  const missing = map.filter((c) => !c.source).map((c) => c.header);
  const rows = raw
    .map((r, i) => ({ rowNumber: i + 2, ...Object.fromEntries(map.map((c) => [c.key, c.source ? r[c.source] : ''])) }))
    .filter((r) => map.some((c) => String((r as Record<string, unknown>)[c.key] ?? '').trim() !== ''));
  return { rows, missing };
};

export const BulkUpload: React.FC = () => {
  const [mode, setMode] = useState<Mode>('goals');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [result, setResult] = useState<BulkGoalsResult | BulkActualsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = (m: Mode = mode) => {
    setMode(m);
    setFile(null);
    setRows([]);
    setResult(null);
    setError(null);
    if (input.current) input.current.value = '';
  };

  const run = async (commit: boolean, data = rows) => {
    setBusy(true);
    setError(null);
    try {
      setResult(mode === 'goals' ? await pmsService.bulkGoals(data, commit) : await pmsService.bulkActuals(data, commit));
    } catch (err: any) {
      setError(err?.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    reset(mode);
    setFile(f);
    try {
      const parsed = await parseSheet(f, mode);
      if (parsed.missing.length) {
        setError(`These columns are missing: ${parsed.missing.join(', ')}. Download the template to see the expected layout.`);
        return;
      }
      if (!parsed.rows.length) {
        setError('The sheet has no data rows.');
        return;
      }
      setRows(parsed.rows);
      await run(false, parsed.rows);
    } catch {
      setError('Could not read that file. Upload an .xlsx or .csv file.');
    }
  };

  const goals = mode === 'goals' ? (result as BulkGoalsResult | null) : null;
  const okRows = result?.rows.filter((r) => r.ok).length ?? 0;
  const badRows = (result?.rows.length ?? 0) - okRows;
  const importable = goals ? goals.employees.filter((e) => e.ok).length : okRows;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Bulk upload</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Load goal sheets or KPI actuals from Excel. The file is checked first and nothing is saved until you confirm.
        </p>
      </div>

      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {([
          ['goals', 'Goals'],
          ['actuals', 'KPI actuals'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => reset(id)} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${mode === id ? 'bg-white text-[#023b77] shadow-xs' : 'text-slate-600'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <ul className="text-xs text-slate-600 list-disc pl-5 space-y-0.5">
          {mode === 'goals' ? (
            <>
              <li>One row per KPI. Columns: {COLUMNS.goals.map((c) => c.header).join(', ')}.</li>
              <li>An employee's goals load only if all their rows are valid and the sheet meets the goal rules (3–8 KPIs, 5–40% each, 100% total, Compliance KRA ≥ 10%).</li>
              <li>Goals load into draft sheets only. Submitted or locked sheets are left alone.</li>
            </>
          ) : (
            <>
              <li>One row per KPI. Columns: {COLUMNS.actuals.map((c) => c.header).join(', ')}.</li>
              <li>The KPI is matched by name on the employee's locked goal sheet. Valid rows are saved even if other rows have errors.</li>
            </>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportToExcel(SAMPLE[mode], mode === 'goals' ? 'PMS_Goals_Template' : 'PMS_Actuals_Template', mode === 'goals' ? 'Goals' : 'Actuals', COLUMNS[mode].map((c) => ({ header: c.header, key: c.key })))}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Download template
          </button>
          <label className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#023b77] text-white hover:bg-[#012a52] cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> {file ? 'Choose another file' : 'Upload Excel file'}
            <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {file && <span className="self-center text-xs text-slate-500 flex items-center gap-1"><FileSpreadsheet className="w-3.5 h-3.5" /> {file.name} · {rows.length} rows</span>}
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
      {busy && <div className="py-6 text-center text-xs text-slate-400">Checking...</div>}

      {result && !busy && (
        <div className="space-y-3">
          {result.commit ? (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
              {goals ? `Imported goals for ${goals.imported} employee(s).` : `Saved ${(result as BulkActualsResult).applied} actual(s).`} Errors below were skipped.
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-white border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <p className="text-xs text-slate-700">
                <strong className="text-emerald-700">{okRows} rows OK</strong> · <strong className={badRows ? 'text-rose-700' : 'text-slate-500'}>{badRows} with errors</strong>
                {goals && <> · {importable} of {goals.employees.length} employees can be imported</>}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => exportToExcel(result.rows, 'PMS_Upload_Error_Report', 'Errors', [
                    { header: 'Row', key: 'rowNumber' },
                    { header: 'Employee code', key: 'employeeCode' },
                    { header: 'KPI', key: 'kpi' },
                    { header: 'Status', key: (r) => (r.ok ? 'OK' : 'Error') },
                    { header: 'Problem', key: 'message' },
                  ])}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Error report
                </button>
                <button type="button" disabled={!importable} onClick={() => run(true)} className="px-3.5 py-2 text-xs font-bold rounded-lg bg-[#039583] text-white hover:bg-[#027a6b] cursor-pointer disabled:opacity-40">
                  {goals ? `Import ${importable} employee(s)` : `Save ${okRows} actual(s)`}
                </button>
              </div>
            </div>
          )}

          {goals && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                  <tr><th className="py-2 px-4">Employee</th><th className="py-2 px-3 text-right">KPIs</th><th className="py-2 px-3 text-right">Weight</th><th className="py-2 px-3">Result</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {goals.employees.map((e) => (
                    <tr key={e.employeeCode}>
                      <td className="py-2 px-4"><span className="font-semibold text-slate-900">{e.employeeName}</span> <span className="text-slate-400">{e.employeeCode}</span></td>
                      <td className="py-2 px-3 text-right font-mono">{e.lines}</td>
                      <td className="py-2 px-3 text-right font-mono">{e.weightTotal}%</td>
                      <td className="py-2 px-3">
                        {e.ok ? <span className="text-emerald-700 font-semibold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Ready</span> : <span className="text-rose-700">{e.issues.join(' ')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200 sticky top-0">
                <tr><th className="py-2 px-4 w-14">Row</th><th className="py-2 px-3">Employee</th><th className="py-2 px-3">KPI</th><th className="py-2 px-3">Result</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.map((r) => (
                  <tr key={r.rowNumber} className={r.ok ? '' : 'bg-rose-50/40'}>
                    <td className="py-2 px-4 font-mono text-slate-500">{r.rowNumber}</td>
                    <td className="py-2 px-3 font-mono">{r.employeeCode}</td>
                    <td className="py-2 px-3">{r.kpi}</td>
                    <td className="py-2 px-3">
                      {r.ok ? (
                        <span className="text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> OK{r.new != null && r.old !== undefined && ` (${r.old ?? '—'} → ${r.new})`}</span>
                      ) : (
                        <span className="text-rose-700 flex items-start gap-1"><XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {r.message}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------------------- reminders

const KIND_LABEL: Record<ReminderItem['kind'], { label: string; cls: string }> = {
  REMIND_3: { label: '3 days before', cls: 'bg-blue-50 text-blue-800' },
  REMIND_1: { label: '1 day before', cls: 'bg-amber-50 text-amber-800' },
  ESCALATE: { label: 'Overdue → next level', cls: 'bg-rose-50 text-rose-800' },
};

export const RemindersPanel: React.FC = () => {
  const [data, setData] = useState<{ enabled: boolean; plan: ReminderItem[]; pendingTasks: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => pmsService.getReminders().then(setData).catch((err) => setError(err?.message || 'Could not load reminders.'));
  useEffect(() => {
    load();
  }, []);
  if (!data) return error ? <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div> : <div className="py-10 text-center text-xs text-slate-400">Loading...</div>;

  const toSend = data.plan.filter((p) => !p.alreadySent && p.recipients.length);
  const people = new Set(toSend.flatMap((p) => p.recipients.map((r) => r.userId))).size;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Reminders</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          In-app notification and email 3 days and 1 day before each deadline. When a task is 3 or more days overdue, the next level is alerted
          (the employee's manager, the manager's manager, or HR). Each reminder is sent once.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <BellRing className="w-4 h-4 text-[#039583]" /> Automatic reminders are {data.enabled ? 'on' : 'off'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {data.enabled ? 'Due reminders are sent every 6 hours.' : 'Nothing is sent automatically. Check the list below before switching them on.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              if (!data.enabled && !window.confirm(`Switch on automatic reminders? ${toSend.length} reminder(s) to ${people} people are due now and will go out within minutes.`)) return;
              await pmsService.setRemindersEnabled(!data.enabled);
              load();
            }}
            className={`px-4 py-2 text-xs font-bold rounded-lg cursor-pointer ${data.enabled ? 'border border-slate-300 bg-white text-slate-700' : 'bg-[#039583] text-white'}`}
          >
            {data.enabled ? 'Switch off' : 'Switch on'}
          </button>
          <button
            type="button"
            disabled={!toSend.length}
            onClick={async () => {
              if (!window.confirm(`Send ${toSend.length} reminder(s) to ${people} people now?`)) return;
              setError(null);
              try {
                const r = await pmsService.runReminders();
                setMsg(`Sent ${r.sent} reminder(s): ${r.notifications} notification(s), ${r.emails} email(s).`);
                load();
              } catch (err: any) {
                setError(err?.message || 'Could not send reminders.');
              }
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-[#023b77] text-white cursor-pointer disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" /> Send due reminders now
          </button>
        </div>
      </div>
      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{msg}</div>}

      <p className="text-xs text-slate-600">
        {data.pendingTasks} open tasks in this cycle · <strong>{toSend.length}</strong> reminder(s) due today
      </p>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
            <tr><th className="py-2.5 px-4">Task</th><th className="py-2.5 px-3">Due</th><th className="py-2.5 px-3">Type</th><th className="py-2.5 px-3">Goes to</th><th className="py-2.5 px-3">Sent</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.plan.map((p) => (
              <tr key={`${p.key}-${p.kind}`} className={p.alreadySent ? 'opacity-50' : ''}>
                <td className="py-2.5 px-4 text-slate-800">{p.label}</td>
                <td className="py-2.5 px-3 font-mono text-slate-600">{new Date(`${p.due}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                <td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${KIND_LABEL[p.kind].cls}`}>{KIND_LABEL[p.kind].label}</span></td>
                <td className="py-2.5 px-3 text-slate-600">{p.recipients.map((r) => r.name).join(', ') || <span className="text-slate-400">nobody with a login</span>}</td>
                <td className="py-2.5 px-3 text-slate-500">{p.alreadySent ? 'Yes' : '—'}</td>
              </tr>
            ))}
            {data.plan.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-slate-400">No reminders are due today.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
