import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, RotateCcw, UserCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { payrollCalculatorsService } from '../services/payrollCalculatorsService';
import {
  IncomeTaxInputs,
  IncomeTaxOptions,
  IncomeTaxResult,
  TaxLine,
  TaxRow,
} from '../types/payrollCalculators';

const inr = (n: number | undefined) =>
  `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

type Section = 'employee' | 'ctc' | 'exemptions' | 'perquisites' | 'deductions' | 'computation';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'employee', label: '1. Employee & Regime' },
  { id: 'ctc', label: '2. CTC Structure' },
  { id: 'exemptions', label: '3. Exemptions (Sec 10)' },
  { id: 'perquisites', label: '4. Perquisites (17(2))' },
  { id: 'deductions', label: '5. Deductions (Ch. VI-A)' },
  { id: 'computation', label: '6. Tax Computation' },
];

type Group = 'root' | 'otherIncome' | 'retirement' | 'exemptions' | 'perquisites' | 'deductions';
type FieldDef =
  | { kind: 'number'; group: Group; key: string; label: string; step?: number; hint?: string }
  | { kind: 'bool'; group: Group; key: string; label: string }
  | { kind: 'select'; group: Group; key: string; label: string; options: { value: string; label: string }[] };

const num = (group: Group, key: string, label: string, hint?: string, step?: number): FieldDef => ({ kind: 'number', group, key, label, hint, step });
const bool = (group: Group, key: string, label: string): FieldDef => ({ kind: 'bool', group, key, label });
const sel = (group: Group, key: string, label: string, options: [string, string][]): FieldDef => ({
  kind: 'select', group, key, label, options: options.map(([value, l]) => ({ value, label: l })),
});

const EMPLOYEE_FIELDS: FieldDef[] = [
  sel('root', 'ageCategory', 'Age category', [['BELOW_60', 'Below 60'], ['SENIOR', '60 to 79 (Senior)'], ['SUPER_SENIOR', '80 & above (Super Senior)']]),
  sel('root', 'employerType', 'Employer type', [['NON_GOVT', 'Non-Government'], ['GOVT', 'Government']]),
  num('root', 'monthsEmployed', 'Months of employment in tax year', 'Caps monthly exemption limits'),
  num('root', 'monthsRemaining', 'Months remaining for TDS (incl. current)'),
  num('root', 'tdsDeducted', 'TDS already deducted this year', 'Incl. previous employer (Form 130)'),
  num('root', 'professionalTax', 'Professional tax paid (annual)', 'Old regime only'),
];
const OTHER_INCOME_FIELDS: FieldDef[] = [
  num('otherIncome', 'savingsInterest', 'Interest on savings bank account'),
  num('otherIncome', 'depositInterest', 'Interest on fixed / recurring deposits'),
  num('otherIncome', 'otherSources', 'Any other income (other sources)'),
  num('otherIncome', 'houseProperty', 'Net income / (loss) from let-out house property', 'Negative = loss'),
  num('otherIncome', 'previousEmployerSalary', 'Taxable salary from previous employer'),
];
const RETIREMENT_FIELDS: FieldDef[] = [
  num('retirement', 'gratuityReceived', 'Gratuity received'),
  num('retirement', 'gratuityExemptFormula', 'Gratuity exempt as per statutory formula'),
  num('retirement', 'leaveEncashment', 'Leave encashment received'),
  num('retirement', 'leaveEncashmentExemptFormula', 'Leave encashment exempt as per formula'),
  num('retirement', 'profitsInLieu', 'Profits in lieu of salary'),
];
const EXEMPTION_FIELDS: FieldDef[] = [
  num('exemptions', 'rentPaid', 'Rent paid by employee (annual)'),
  num('exemptions', 'rentMonths', 'Months for which rent paid / HRA received'),
  num('exemptions', 'ltaFare', 'LTA – eligible travel fare actually incurred'),
  num('exemptions', 'ceaChildren', 'No. of children for Children Education Allowance'),
  num('exemptions', 'hostelChildren', 'No. of children in hostel'),
  bool('exemptions', 'isDivyang', 'Employee is blind / deaf & dumb / orthopaedically handicapped'),
  bool('exemptions', 'transportDailyAllowance', 'Transport-system employee receiving daily allowance'),
  num('exemptions', 'otherPrescribedMonthlyLimit', 'Other 10(14)(ii) allowance – exempt limit per month'),
  num('exemptions', 'spendConveyance', 'Actual spend – conveyance for official duties'),
  num('exemptions', 'spendTravel', 'Actual spend – travel / tour / transfer'),
  num('exemptions', 'spendDailyAllowance', 'Actual spend – daily allowance on tour'),
  num('exemptions', 'spendBooks', 'Actual spend – books & periodicals'),
  num('exemptions', 'spendUniform', 'Actual spend – uniform'),
  num('exemptions', 'spendHelper', 'Actual spend – helper'),
  num('exemptions', 'spendAcademic', 'Actual spend – academic research / training'),
];
const PERQUISITE_FIELDS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'A. Rent-free / concessional accommodation',
    fields: [
      sel('perquisites', 'accommodation', 'Accommodation provided', [['NONE', 'None'], ['OWNED', 'Employer-owned'], ['LEASED', 'Employer-leased']]),
      sel('perquisites', 'cityPopulation', 'City population (2011 census)', [['ABOVE_40L', 'Above 40 lakh'], ['15_TO_40L', '15 to 40 lakh'], ['BELOW_15L', 'Below 15 lakh']]),
      num('perquisites', 'leaseRent', 'Lease rent paid by employer (annual)'),
      num('perquisites', 'accommodationMonths', 'Months occupied'),
      num('perquisites', 'furnitureCost', 'Cost of furniture provided'),
      num('perquisites', 'furnitureHire', 'Hire charges of furniture'),
      num('perquisites', 'rentRecovered', 'Rent recovered from employee (annual)'),
    ],
  },
  {
    title: 'B. Motor car',
    fields: [
      sel('perquisites', 'carProvidedBy', 'Car owned / hired by', [['NONE', 'None'], ['EMPLOYER', 'Employer'], ['EMPLOYEE', 'Employee']]),
      sel('perquisites', 'carEngine', 'Engine capacity', [['SMALL', 'Up to 1.6L / EV'], ['LARGE', 'Above 1.6L']]),
      sel('perquisites', 'carUsage', 'Usage', [['OFFICIAL', 'Official only (logbook)'], ['MIXED', 'Mixed (official + personal)'], ['PERSONAL', 'Personal only']]),
      sel('perquisites', 'carRunningBorneBy', 'Running & maintenance borne by', [['EMPLOYER', 'Employer'], ['EMPLOYEE', 'Employee']]),
      bool('perquisites', 'chauffeur', 'Chauffeur provided / reimbursed'),
      num('perquisites', 'carMonths', 'Months car provided'),
      num('perquisites', 'carCost', 'Actual cost of car / annual hire charges'),
      num('perquisites', 'carRunningExpense', 'Running, maintenance & driver expense by employer'),
      num('perquisites', 'carRecovered', 'Amount recovered from employee'),
    ],
  },
  {
    title: 'C–G. Telephone, meals, loans, education, ESOP',
    fields: [
      num('perquisites', 'telephoneBills', 'Telephone bills submitted (annual)'),
      num('perquisites', 'meals', 'Number of meals provided in the year'),
      num('perquisites', 'loanAmount', 'Interest-free loan – aggregate amount'),
      num('perquisites', 'loanAvgOutstanding', 'Loan – average monthly outstanding'),
      num('perquisites', 'loanSbiRate', 'SBI benchmark rate (e.g. 0.09)', undefined, 0.0025),
      num('perquisites', 'loanChargedRate', 'Interest rate charged (e.g. 0.04)', undefined, 0.0025),
      bool('perquisites', 'loanMedical', 'Loan for specified medical treatment'),
      num('perquisites', 'loanMonths', 'Months loan outstanding'),
      num('perquisites', 'educationCostPerChild', 'Free education – cost per child per month'),
      num('perquisites', 'educationChildren', 'Free education – no. of children'),
      num('perquisites', 'educationMonths', 'Free education – months'),
      num('perquisites', 'esopShares', 'ESOP – shares allotted'),
      num('perquisites', 'esopFmv', 'ESOP – FMV per share on exercise'),
      num('perquisites', 'esopExercisePrice', 'ESOP – exercise price per share'),
    ],
  },
  {
    title: 'H. Other perquisites (taxable value per Rule 15)',
    fields: [
      num('perquisites', 'club', 'Club membership / expenses'),
      num('perquisites', 'creditCard', 'Credit card expenses (personal)'),
      num('perquisites', 'servants', 'Domestic servants, gas, electricity, water'),
      num('perquisites', 'assets', 'Use / transfer of movable assets'),
      num('perquisites', 'medicalAbroad', 'Medical treatment abroad (taxable portion)'),
      num('perquisites', 'otherPerquisite', 'Any other perquisite'),
    ],
  },
];
const DISABILITY: [string, string][] = [['NONE', 'None'], ['DISABILITY', 'Disability (40%+)'], ['SEVERE', 'Severe (80%+)']];
const DEDUCTION_FIELDS = (sec80c: { key: string; label: string }[]): { title: string; fields: FieldDef[] }[] => [
  {
    title: '80C / 80CCC / 80CCD(1) — combined ₹1.5 lakh',
    fields: [
      ...sec80c.map((i) => num('deductions', i.key, i.label)),
      num('deductions', 'pension80CCC', 'Pension fund contribution (80CCC)'),
      num('deductions', 'nps80CCD1', 'Employee NPS Tier I (80CCD(1))'),
    ],
  },
  {
    title: 'NPS & Agniveer',
    fields: [
      num('deductions', 'nps80CCD1B', 'Additional own NPS (80CCD(1B))'),
      num('deductions', 'agniveerOwn', 'Agniveer – own contribution (80CCH(1))'),
    ],
  },
  {
    title: 'Health (80D / 80DD / 80DDB / 80U)',
    fields: [
      bool('deductions', 'selfSenior', 'Self / spouse / children – any senior citizen'),
      num('deductions', 'healthSelf', 'Health insurance – self / family'),
      num('deductions', 'checkupSelf', 'Preventive check-up – self / family'),
      bool('deductions', 'parentsSenior', 'Parents – senior citizen'),
      num('deductions', 'healthParents', 'Health insurance / medical exp. – parents'),
      num('deductions', 'checkupParents', 'Preventive check-up – parents'),
      sel('deductions', 'disabledDependant', 'Disabled dependant (80DD)', DISABILITY),
      num('deductions', 'ddbAmount', 'Specified disease treatment – amount spent'),
      num('deductions', 'ddbReimbursed', 'Less: insurance / employer reimbursement'),
      bool('deductions', 'ddbSenior', 'Patient is senior citizen'),
      sel('deductions', 'selfDisability', 'Self disability (80U)', DISABILITY),
    ],
  },
  {
    title: 'Loans, interest, rent & donations',
    fields: [
      num('deductions', 'educationLoanInterest', 'Interest on education loan (80E)'),
      num('deductions', 'homeLoan80EE', 'Home loan interest – first-time buyer (80EE)'),
      num('deductions', 'homeLoan80EEA', 'Home loan interest – affordable housing (80EEA)'),
      num('deductions', 'evLoan', 'Electric vehicle loan interest (80EEB)'),
      num('deductions', 'politicalDonation', 'Political party contribution (80GGC)'),
      num('deductions', 'rentNoHra', 'Rent paid – no HRA received (80GG)'),
      num('deductions', 'donation100', 'Donations – 100% without limit'),
      num('deductions', 'donation50', 'Donations – 50% without limit'),
      num('deductions', 'donation100Limited', 'Donations – 100% subject to limit'),
      num('deductions', 'donation50Limited', 'Donations – 50% subject to limit'),
      num('deductions', 'homeLoanInterest24b', 'Home loan interest – self-occupied (Sec 24(b))'),
    ],
  },
];

const inputCls =
  'w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#039583]/30 focus:border-[#039583]';

export const IncomeTaxCalculatorPage: React.FC = () => {
  const [options, setOptions] = useState<IncomeTaxOptions | null>(null);
  const [inputs, setInputs] = useState<IncomeTaxInputs | null>(null);
  const [result, setResult] = useState<IncomeTaxResult | null>(null);
  const [section, setSection] = useState<Section>('employee');
  const [employeeId, setEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const opts = await payrollCalculatorsService.getIncomeTaxOptions();
        setOptions(opts);
        // Start from the logged-in employee's own CTC; fall back to the workbook example.
        try {
          const pre = await payrollCalculatorsService.prefillIncomeTax();
          setInputs(pre.inputs);
          setResult(pre.result);
        } catch {
          setInputs(opts.defaults);
        }
      } catch (err: any) {
        setError(err?.message || 'Could not load the income tax calculator.');
      }
    })();
  }, []);

  // Recalculate (debounced) whenever an input changes.
  useEffect(() => {
    if (!inputs) return;
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await payrollCalculatorsService.calculateIncomeTax(inputs);
        if (seq === requestSeq.current) {
          setResult(res);
          setError(null);
        }
      } catch (err: any) {
        if (seq === requestSeq.current) setError(err?.message || 'Calculation failed.');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [inputs]);

  const setValue = useCallback((group: Group, key: string, value: any) => {
    setInputs((prev) => {
      if (!prev) return prev;
      if (group === 'root') return { ...prev, [key]: value };
      return { ...prev, [group]: { ...(prev as any)[group], [key]: value } };
    });
  }, []);

  const getValue = (group: Group, key: string): any =>
    inputs ? (group === 'root' ? (inputs as any)[key] : (inputs as any)[group][key]) : undefined;

  const loadEmployee = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const pre = await payrollCalculatorsService.prefillIncomeTax(employeeId || undefined);
      setInputs(pre.inputs);
      setResult(pre.result);
      setNotice(
        pre.annualCtc > 0
          ? `Loaded ${pre.inputs.employee.name}'s CTC of ${inr(pre.annualCtc)}${pre.hasDeclaration ? ' and saved tax declaration' : ''}.`
          : `${pre.inputs.employee.name} has no annual CTC on file; enter the CTC components manually.`
      );
    } catch (err: any) {
      setError(err?.message || 'Could not load employee data.');
    } finally {
      setBusy(false);
    }
  };

  const renderField = (f: FieldDef) => {
    const value = getValue(f.group, f.key);
    return (
      <label key={`${f.group}.${f.key}`} className="block space-y-1">
        <span className="text-[11px] font-medium text-slate-600">{f.label}</span>
        {f.kind === 'number' && (
          <input
            type="number"
            step={f.step ?? 1}
            className={inputCls}
            value={value ?? 0}
            onChange={(e) => setValue(f.group, f.key, e.target.value === '' ? 0 : Number(e.target.value))}
          />
        )}
        {f.kind === 'bool' && (
          <select className={inputCls} value={value ? 'Yes' : 'No'} onChange={(e) => setValue(f.group, f.key, e.target.value === 'Yes')}>
            <option>No</option>
            <option>Yes</option>
          </select>
        )}
        {f.kind === 'select' && (
          <select className={inputCls} value={value} onChange={(e) => setValue(f.group, f.key, e.target.value)}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
        {f.kind === 'number' && f.hint && <span className="block text-[10px] text-slate-400">{f.hint}</span>}
      </label>
    );
  };

  const fieldGrid = (fields: FieldDef[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{fields.map(renderField)}</div>
  );

  const card = (title: string, children: React.ReactNode, subtitle?: string) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );

  const regime = inputs?.regime ?? 'NEW';

  const rowsTable = (rows: TaxRow[], totals: { old: number; new: number; amount?: number }, withAmount = true) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
            <th className="py-2 pr-3">Item</th>
            {withAmount && <th className="py-2 px-2 text-right">Amount</th>}
            <th className="py-2 px-2 text-right">Old regime</th>
            <th className="py-2 px-2 text-right">New regime</th>
            <th className="py-2 px-2 text-right">Applied ({regime === 'NEW' ? 'New' : 'Old'})</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const inactive = r.status === 'Inactive – New regime';
            return (
              <tr key={r.key} className={`border-b border-slate-50 ${inactive ? 'text-slate-400' : 'text-slate-700'}`}>
                <td className="py-1.5 pr-3">
                  <div className={`font-medium ${inactive ? 'line-through' : ''}`}>{r.label}</div>
                  <div className="text-[10px] text-slate-400">
                    {r.act1961} → {r.act2025}
                    {r.allowedInNew === false && ' • Old regime only'}
                  </div>
                </td>
                {withAmount && <td className="py-1.5 px-2 text-right font-mono">{inr(r.amount)}</td>}
                <td className="py-1.5 px-2 text-right font-mono">{inr(r.old)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{inr(r.new)}</td>
                <td className="py-1.5 px-2 text-right font-mono font-semibold">{inr(r.applied)}</td>
              </tr>
            );
          })}
          <tr className="bg-emerald-50 font-bold text-slate-900">
            <td className="py-2 pr-3">Total</td>
            {withAmount && <td className="py-2 px-2 text-right font-mono">{inr(totals.amount)}</td>}
            <td className="py-2 px-2 text-right font-mono">{inr(totals.old)}</td>
            <td className="py-2 px-2 text-right font-mono">{inr(totals.new)}</td>
            <td className="py-2 px-2 text-right font-mono">{inr(regime === 'NEW' ? totals.new : totals.old)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  const computationTable = (lines: TaxLine[]) => {
    const strong = new Set(['grossSalary', 'salaryIncome', 'gti', 'totalIncome', 'totalTax', 'monthlyTds']);
    const fmtLine = (l: TaxLine, v: number) =>
      l.key === 'surchargeRate' || l.key === 'effectiveRate' ? `${(v * 100).toFixed(2)}%` : inr(v);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="py-2 pr-3">Particulars</th>
              <th className="py-2 px-2 text-right">Old regime</th>
              <th className="py-2 px-2 text-right">New regime</th>
              <th className="py-2 px-2 text-right">Selected ({regime === 'NEW' ? 'New' : 'Old'})</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className={`border-b border-slate-50 ${strong.has(l.key) ? 'bg-amber-50/60 font-bold text-slate-900' : 'text-slate-700'}`}>
                <td className="py-1.5 pr-3">
                  <div>{l.label}</div>
                  {(l.act1961 || l.act2025) && (
                    <div className="text-[10px] font-normal text-slate-400">
                      {l.act1961}{l.act2025 && ` → ${l.act2025}`}
                    </div>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right font-mono">{fmtLine(l, l.old)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{fmtLine(l, l.new)}</td>
                <td className="py-1.5 px-2 text-right font-mono font-semibold">{fmtLine(l, l.selected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const deductionGroups = useMemo(() => (options ? DEDUCTION_FIELDS(options.sec80cItems) : []), [options]);

  if (!inputs || !options) {
    return (
      <div className="py-12 text-center text-xs text-slate-400">
        {error ? <span className="text-rose-600">{error}</span> : 'Loading income tax calculator...'}
      </div>
    );
  }

  const s = result?.summary;
  const summaryTiles = s
    ? [
        { label: 'Old regime tax', value: inr(s.oldTax), tone: s.beneficialRegime === 'OLD' ? 'text-emerald-700' : 'text-slate-900' },
        { label: 'New regime tax', value: inr(s.newTax), tone: s.beneficialRegime === 'NEW' ? 'text-emerald-700' : 'text-slate-900' },
        { label: `Monthly TDS (${regime === 'NEW' ? 'New' : 'Old'})`, value: inr(s.selectedMonthlyTds), tone: 'text-[#023b77]' },
        { label: 'Monthly take-home (approx.)', value: inr(s.monthlyTakeHome), tone: 'text-slate-900' },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Income Tax Calculator</h1>
            <p className="text-xs text-slate-200 mt-1">
              Tax Year 2026-27 (FY 2026-27 / AY 2027-28) — Old vs New regime, Income-tax Act 2025 with IT Act 1961 references.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {options.employees && (
            <select
              className="px-3 py-2 rounded-xl text-xs text-slate-900 bg-white border border-white/20 max-w-[220px]"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">My own CTC</option>
              {options.employees.map((e) => (
                <option key={e._id} value={e._id}>{e.name} ({e.employeeCode})</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={loadEmployee}
            disabled={busy}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-[#039583] hover:bg-[#027a6b] flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
          >
            <UserCheck className="w-4 h-4" /> {busy ? 'Loading...' : 'Load employee'}
          </button>
          <button
            type="button"
            onClick={() => { setInputs(options.defaults); setNotice('Loaded the example employee from the workbook.'); }}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" /> Example
          </button>
        </div>
      </div>

      {notice && <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-xs">{notice}</div>}
      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}

      {/* Regime + summary */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Tax regime selected</span>
          <div className="grid grid-cols-2 gap-2">
            {(['OLD', 'NEW'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setValue('root', 'regime', r)}
                className={`py-2 rounded-xl text-xs font-bold border cursor-pointer transition ${
                  regime === r ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {r === 'OLD' ? 'Old Regime' : 'New Regime'}
              </button>
            ))}
          </div>
          {s && (
            <div
              className={`p-3 rounded-xl text-[11px] flex items-start gap-2 ${
                s.selectedIsBeneficial ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {s.selectedIsBeneficial ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>
                {s.beneficialRegime === 'EQUAL'
                  ? 'Both regimes give the same tax.'
                  : `${s.beneficialRegime === 'NEW' ? 'New' : 'Old'} regime is cheaper by ${inr(Math.abs(s.savingWithNew))}.`}
                {!s.selectedIsBeneficial && ' Consider switching.'}
              </span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summaryTiles.map((t) => (
            <div key={t.label} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-xs font-semibold text-slate-500">{t.label}</span>
              <p className={`text-xl font-black mt-2 font-mono tabular-nums ${t.tone}`}>{t.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              section === t.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === 'employee' && (
        <div className="space-y-4">
          {card('Employee details', (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(['name', 'code', 'pan'] as const).map((k) => (
                <label key={k} className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-600">{{ name: 'Employee name', code: 'Employee code', pan: 'PAN' }[k]}</span>
                  <input
                    className={inputCls}
                    value={inputs.employee[k]}
                    onChange={(e) => setInputs((p) => (p ? { ...p, employee: { ...p.employee, [k]: e.target.value } } : p))}
                  />
                </label>
              ))}
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-600">City of residence / posting</span>
                <select className={inputCls} value={inputs.city} onChange={(e) => setValue('root', 'city', e.target.value)}>
                  {options.cities.map((c) => <option key={c}>{c}</option>)}
                </select>
                <span className="block text-[10px] text-slate-400">
                  Metro for HRA: {result?.metroCity ? 'Yes (50%)' : 'No (40%)'}
                </span>
              </label>
              {EMPLOYEE_FIELDS.map(renderField)}
            </div>
          ))}
          {card('Other income declared by employee (Form 124 / old 12BB)', fieldGrid(OTHER_INCOME_FIELDS))}
          {card('Retirement / full & final receipts (not part of CTC)', fieldGrid(RETIREMENT_FIELDS))}
        </div>
      )}

      {section === 'ctc' && card('CTC structure (annual ₹)', (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-3">Component</th>
                <th className="py-2 px-2 w-40">Annual amount</th>
                <th className="py-2 px-2 text-right">Monthly</th>
                <th className="py-2 px-2">Tax treatment</th>
              </tr>
            </thead>
            <tbody>
              {options.ctcComponents.map((c) => (
                <tr key={c.key} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 text-slate-700">{c.label}</td>
                  <td className="py-1 px-2">
                    <input
                      type="number"
                      className={inputCls}
                      value={inputs.ctc[c.key] ?? 0}
                      onChange={(e) => setInputs((p) => (p ? { ...p, ctc: { ...p.ctc, [c.key]: Number(e.target.value) || 0 } } : p))}
                    />
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-500">{inr((inputs.ctc[c.key] || 0) / 12)}</td>
                  <td className="py-1.5 px-2 text-[11px] text-slate-500">{c.treatment}</td>
                </tr>
              ))}
              <tr className="bg-emerald-50 font-bold text-slate-900">
                <td className="py-2 pr-3">TOTAL CTC</td>
                <td className="py-2 px-2 font-mono">{inr(result?.totalCtc)}</td>
                <td className="py-2 px-2 text-right font-mono">{inr((result?.totalCtc || 0) / 12)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      ), 'Exemptions and perquisites come from these CTC components. Chapter VI-A deductions are declarations, not part of CTC.')}

      {section === 'exemptions' && (
        <div className="space-y-4">
          {card('Supporting inputs for exemptions', fieldGrid(EXEMPTION_FIELDS))}
          {result && card('Exemptions u/s 10 → Schedule II/III & Sec 19', rowsTable(result.exemptions.rows, {
            old: result.exemptions.totalOld, new: result.exemptions.totalNew, amount: result.exemptions.totalAmount,
          }), 'Struck-through rows are not allowed in the New regime and apply ₹0 there.')}
        </div>
      )}

      {section === 'perquisites' && (
        <div className="space-y-4">
          {PERQUISITE_FIELDS.map((g) => <React.Fragment key={g.title}>{card(g.title, fieldGrid(g.fields))}</React.Fragment>)}
          {result && card('Perquisites u/s 17(2) → Sec 17 r/w Rule 15', rowsTable(result.perquisites.rows, {
            old: result.perquisites.totalOld, new: result.perquisites.totalNew,
          }, false), 'Valuation applies in both regimes; only rent-free accommodation differs.')}
        </div>
      )}

      {section === 'deductions' && (
        <div className="space-y-4">
          {deductionGroups.map((g) => <React.Fragment key={g.title}>{card(g.title, fieldGrid(g.fields))}</React.Fragment>)}
          {result && card('Deductions — Chapter VI-A → Sec 122-154', rowsTable(result.deductions.rows, {
            old: result.deductions.totalOld, new: result.deductions.totalNew,
          }), 'Only 80CCD(2) employer NPS and 80CCH(2) Agniveer stay active in the New regime.')}
        </div>
      )}

      {section === 'computation' && result && card(
        'Income tax computation — Old vs New regime',
        computationTable(result.computation),
        'Total income and tax rounded to the nearest ₹10 (Sec 288A/288B). Surcharge includes marginal relief; New regime capped at 25%.'
      )}
    </div>
  );
};
