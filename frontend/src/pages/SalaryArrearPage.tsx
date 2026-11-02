import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, Plus, RotateCcw, Trash2, UserCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { payrollCalculatorsService } from '../services/payrollCalculatorsService';
import { ArrearInputs, ArrearOptions, ArrearResult, ArrearMonth } from '../types/payrollCalculators';
import { exportToExcel } from '../utils/exportUtils';

const inr = (n: number | undefined) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

const inputCls =
  'w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#039583]/30 focus:border-[#039583]';

export const SalaryArrearPage: React.FC = () => {
  const [options, setOptions] = useState<ArrearOptions | null>(null);
  const [inputs, setInputs] = useState<ArrearInputs | null>(null);
  const [result, setResult] = useState<ArrearResult | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    payrollCalculatorsService
      .getArrearOptions()
      .then((opts) => {
        setOptions(opts);
        setInputs(opts.defaults);
      })
      .catch((err) => setError(err?.message || 'Could not load the arrear calculator.'));
  }, []);

  useEffect(() => {
    if (!inputs) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await payrollCalculatorsService.calculateArrear(inputs);
        if (seq === seqRef.current) {
          setResult(res);
          setError(null);
        }
      } catch (err: any) {
        if (seq === seqRef.current) setError(err?.message || 'Calculation failed.');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [inputs]);

  const set = <K extends keyof ArrearInputs>(key: K, value: ArrearInputs[K]) =>
    setInputs((p) => (p ? { ...p, [key]: value } : p));

  const setComponent = (idx: number, patch: Partial<ArrearInputs['components'][number]>) =>
    setInputs((p) =>
      p ? { ...p, components: p.components.map((c, i) => (i === idx ? { ...c, ...patch } : c)) } : p
    );

  const loadEmployee = async () => {
    if (!employeeId) return;
    setBusy(true);
    setNotice(null);
    try {
      const pre = await payrollCalculatorsService.prefillArrear(employeeId);
      setInputs(pre.inputs);
      setResult(pre.result);
      setNotice(
        pre.annualCtc > 0
          ? `Loaded ${pre.inputs.employeeName}'s current monthly components as the old salary. Enter the revised amounts.`
          : `${pre.inputs.employeeName} has no annual CTC on file; enter the components manually.`
      );
    } catch (err: any) {
      setError(err?.message || 'Could not load employee data.');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    if (!result) return;
    const rows = result.months.map((m) => {
      const row: Record<string, any> = {
        Month: monthLabel(m.monthStart),
        'Period From': m.periodFrom,
        'Period To': m.periodTo,
        'Paid Days': m.paidDays,
        'Days in Month': m.daysInMonth,
      };
      result.structure.components.forEach((c, i) => (row[c.name] = m.earnings[i]));
      row['Gross Arrear'] = m.grossArrear;
      row['PF Arrear'] = m.pfArrear;
      row['ESIC Arrear'] = m.esicArrear;
      row['Total Arrear'] = m.totalArrear;
      return row;
    });
    const columns = Object.keys(rows[0] || { Month: '' }).map((k) => ({ header: k, key: k }));
    exportToExcel(rows, `Salary_Arrear_${result.inputs.employeeCode || 'employee'}`, 'Arrear', columns as any);
  };

  if (!inputs || !options) {
    return (
      <div className="py-12 text-center text-xs text-slate-400">
        {error ? <span className="text-rose-600">{error}</span> : 'Loading salary arrear calculator...'}
      </div>
    );
  }

  const newJoiner = inputs.arrearType === 'NEW_JOINER';
  const monthRows: { label: string; render: (m: ArrearMonth) => React.ReactNode; total?: number; strong?: boolean }[] = result
    ? [
        { label: 'Period', render: (m) => `${dayLabel(m.periodFrom)} – ${dayLabel(m.periodTo)}` },
        { label: 'Paid days / days in month', render: (m) => `${m.paidDays} / ${m.daysInMonth}`, total: result.totals.paidDays },
        { label: 'ESIC applicable (revised / old)', render: (m) => `${m.esicApplicableRevised ? 'Yes' : 'No'} / ${m.esicApplicableOld ? 'Yes' : 'No'}` },
        ...result.structure.components.map((c, i) => ({
          label: c.name,
          render: (m: ArrearMonth) => inr(m.earnings[i]),
          total: result.componentTotals[i]?.total,
        })),
        { label: 'Gross salary arrear (A)', render: (m) => inr(m.grossArrear), total: result.totals.grossArrear, strong: true },
        { label: 'Employer PF – revised / old', render: (m) => `${inr(m.pfRevised)} / ${inr(m.pfOld)}` },
        { label: 'Employer PF arrear', render: (m) => inr(m.pfArrear), total: result.totals.pfArrear },
        { label: 'Employer ESIC – revised / old', render: (m) => `${inr(m.esicRevised)} / ${inr(m.esicOld)}` },
        { label: 'Employer ESIC arrear', render: (m) => inr(m.esicArrear), total: result.totals.esicArrear },
        { label: 'Total contribution arrear (B)', render: (m) => inr(m.contributionArrear), total: result.totals.contributionArrear, strong: true },
        { label: 'Total fixed CTC arrear (A) + (B)', render: (m) => inr(m.totalArrear), total: result.totals.totalArrear, strong: true },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Salary Arrears</h1>
            <p className="text-xs text-slate-200 mt-1">
              Month-wise arrears for post cut-off joiners and back-dated salary revisions, with employer PF and ESIC.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {options.employees && (
            <select
              className="px-3 py-2 rounded-xl text-xs text-slate-900 bg-white max-w-[220px]"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Select employee...</option>
              {options.employees.map((e) => (
                <option key={e._id} value={e._id}>{e.name} ({e.employeeCode})</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={loadEmployee}
            disabled={busy || !employeeId}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-[#039583] hover:bg-[#027a6b] flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
          >
            <UserCheck className="w-4 h-4" /> {busy ? 'Loading...' : 'Load employee'}
          </button>
          <button
            type="button"
            onClick={() => { setInputs(options.defaults); setNotice('Loaded the example from the workbook.'); }}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" /> Example
          </button>
        </div>
      </div>

      {notice && <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-xs">{notice}</div>}
      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Employee & payroll */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">1. Employee & payroll details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Employee code</span>
              <input className={inputCls} value={inputs.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Employee name</span>
              <input className={inputCls} value={inputs.employeeName} onChange={(e) => set('employeeName', e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Arrear type</span>
              <select className={inputCls} value={inputs.arrearType} onChange={(e) => set('arrearType', e.target.value as ArrearInputs['arrearType'])}>
                <option value="REVISION">Salary Revision – Back Dated</option>
                <option value="NEW_JOINER">New Joiner – Post Cut-off</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Payroll processing month</span>
              <input
                type="month"
                className={inputCls}
                value={(inputs.payrollMonth || '').slice(0, 7)}
                onChange={(e) => set('payrollMonth', e.target.value ? `${e.target.value}-01` : null)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Payroll cut-off day (of month)</span>
              <input type="number" min={1} max={31} className={inputCls} value={inputs.cutoffDay} onChange={(e) => set('cutoffDay', Number(e.target.value) || 0)} />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Pay days basis</span>
              <select className={inputCls} value={inputs.payDaysBasis} onChange={(e) => set('payDaysBasis', e.target.value as ArrearInputs['payDaysBasis'])}>
                <option value="CALENDAR">Calendar days</option>
                <option value="FIXED_30">Fixed 30 days</option>
              </select>
            </label>
            {newJoiner ? (
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Date of joining</span>
                <input type="date" className={inputCls} value={inputs.dateOfJoining || ''} onChange={(e) => set('dateOfJoining', e.target.value || null)} />
              </label>
            ) : (
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Revision effective date</span>
                <input type="date" className={inputCls} value={inputs.effectiveDate || ''} onChange={(e) => set('effectiveDate', e.target.value || null)} />
              </label>
            )}
          </div>
          {result && (
            <div className={`p-3 rounded-xl text-xs flex items-start gap-2 ${result.period.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
              {result.period.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <div>
                <p className="font-semibold">{result.period.status}</p>
                <p className="text-[11px] mt-0.5">
                  Arrear period: {result.period.label} • {result.period.months} month(s)
                  {result.period.esicPeriodEnd && ` • ESIC contribution period ends ${dayLabel(result.period.esicPeriodEnd)} ${result.period.esicPeriodEnd.slice(0, 4)}`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Statutory parameters */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">3. Statutory parameters</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Employer PF rate</span>
              <input type="number" step={0.0025} className={inputCls} value={inputs.pfRate} onChange={(e) => set('pfRate', Number(e.target.value) || 0)} />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">PF wage ceiling (₹)</span>
              <input type="number" className={inputCls} value={inputs.pfWageCeiling} onChange={(e) => set('pfWageCeiling', Number(e.target.value) || 0)} />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Restrict PF to ceiling?</span>
              <select className={inputCls} value={inputs.restrictPfToCeiling ? 'Yes' : 'No'} onChange={(e) => set('restrictPfToCeiling', e.target.value === 'Yes')}>
                <option>Yes</option>
                <option>No</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Employer ESIC rate</span>
              <input type="number" step={0.0025} className={inputCls} value={inputs.esicRate} onChange={(e) => set('esicRate', Number(e.target.value) || 0)} />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">ESIC gross wage ceiling (₹)</span>
              <input type="number" className={inputCls} value={inputs.esicWageCeiling} onChange={(e) => set('esicWageCeiling', Number(e.target.value) || 0)} />
            </label>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            ESIC continuity: an employee covered on the old salary stays covered on the revised salary until the end of the
            contribution period (Apr–Sep / Oct–Mar) in which the arrear starts. New joiners above the ceiling are not covered.
          </p>
        </div>
      </div>

      {/* CTC structure */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">2. CTC structure (monthly ₹)</h3>
          <button
            type="button"
            disabled={inputs.components.length >= options.maxComponents}
            onClick={() => set('components', [...inputs.components, { name: '', old: 0, revised: 0, pfWage: false, esicWage: true }])}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 hover:bg-slate-50 flex items-center gap-1 disabled:opacity-50 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add component
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-2">Component</th>
                <th className="py-2 px-2 w-32">{newJoiner ? 'Old (ignored)' : 'Current / old'}</th>
                <th className="py-2 px-2 w-32">{newJoiner ? 'Monthly salary' : 'Revised / new'}</th>
                <th className="py-2 px-2 text-right">Difference</th>
                <th className="py-2 px-2 text-center">PF wage</th>
                <th className="py-2 px-2 text-center">ESIC wage</th>
                <th className="py-2 px-2" />
              </tr>
            </thead>
            <tbody>
              {inputs.components.map((c, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1 pr-2"><input className={inputCls} value={c.name} placeholder="Component name" onChange={(e) => setComponent(i, { name: e.target.value })} /></td>
                  <td className="py-1 px-2"><input type="number" className={inputCls} value={c.old} onChange={(e) => setComponent(i, { old: Number(e.target.value) || 0 })} /></td>
                  <td className="py-1 px-2"><input type="number" className={inputCls} value={c.revised} onChange={(e) => setComponent(i, { revised: Number(e.target.value) || 0 })} /></td>
                  <td className="py-1 px-2 text-right font-mono text-slate-600">{inr(c.revised - c.old)}</td>
                  <td className="py-1 px-2 text-center"><input type="checkbox" checked={c.pfWage} onChange={(e) => setComponent(i, { pfWage: e.target.checked })} /></td>
                  <td className="py-1 px-2 text-center"><input type="checkbox" checked={c.esicWage} onChange={(e) => setComponent(i, { esicWage: e.target.checked })} /></td>
                  <td className="py-1 px-2 text-right">
                    <button type="button" onClick={() => set('components', inputs.components.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600 cursor-pointer" aria-label="Remove component">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {result && (
                <>
                  {([
                    ['Gross salary (A)', result.structure.gross],
                    ['PF wage', result.structure.pfWage],
                    ['ESIC wage', result.structure.esicWage],
                    ['Employer PF', result.structure.employerPf],
                    ['Employer ESIC', result.structure.employerEsic],
                    ['Total contribution (B)', result.structure.contributions],
                    ['Total fixed CTC (A) + (B)', result.structure.fixedCtc],
                  ] as const).map(([label, t]) => (
                    <tr key={label} className="bg-slate-50 font-semibold text-slate-800">
                      <td className="py-1.5 pr-2">{label}</td>
                      <td className="py-1.5 px-2 font-mono">{inr(t.old)}</td>
                      <td className="py-1.5 px-2 font-mono">{inr(t.revised)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{inr(t.difference)}</td>
                      <td colSpan={3} />
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Results */}
      {result && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ['Gross salary arrear (A)', result.totals.grossArrear],
              ['Employer contribution arrear (B)', result.totals.contributionArrear],
              ['Total fixed CTC arrear (A) + (B)', result.totals.totalArrear],
            ].map(([label, value]) => (
              <div key={label as string} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                <span className="text-xs font-semibold text-slate-500">{label}</span>
                <p className="text-xl font-black mt-2 font-mono tabular-nums text-slate-900">{inr(value as number)}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Month-wise arrear calculation</h3>
              <button
                type="button"
                onClick={handleExport}
                disabled={result.months.length === 0}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                Export to Excel
              </button>
            </div>
            {result.months.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No arrear months for these inputs.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <th className="py-2 pr-3 text-left">Item</th>
                      {result.months.map((m) => (
                        <th key={m.month} className="py-2 px-2 text-right">{monthLabel(m.monthStart)}</th>
                      ))}
                      <th className="py-2 px-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthRows.map((r) => (
                      <tr key={r.label} className={`border-b border-slate-50 ${r.strong ? 'bg-emerald-50 font-bold text-slate-900' : 'text-slate-700'}`}>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{r.label}</td>
                        {result.months.map((m) => (
                          <td key={m.month} className="py-1.5 px-2 text-right font-mono whitespace-nowrap">{r.render(m)}</td>
                        ))}
                        <td className="py-1.5 px-2 text-right font-mono whitespace-nowrap">
                          {r.total === undefined ? '' : r.label.startsWith('Paid days') ? r.total : inr(r.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-slate-500">
              Earnings arrear = (Revised − Old × factor) × paid days / days in month, rounded per component per month. Covers up to {options.maxMonths} months.
            </p>
          </div>
        </>
      )}
    </div>
  );
};
