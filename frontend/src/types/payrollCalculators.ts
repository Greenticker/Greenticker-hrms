// -------------------------------------------------------------
// INCOME TAX CALCULATOR (TY 2026-27) — mirrors backend app/utils/income_tax.py
// -------------------------------------------------------------
export type TaxRegime = 'OLD' | 'NEW';
export type AgeCategory = 'BELOW_60' | 'SENIOR' | 'SUPER_SENIOR';
export type EmployerType = 'NON_GOVT' | 'GOVT';

export interface IncomeTaxInputs {
  employee: { name: string; code: string; pan: string };
  regime: TaxRegime;
  ageCategory: AgeCategory;
  employerType: EmployerType;
  city: string;
  monthsEmployed: number;
  monthsRemaining: number;
  tdsDeducted: number;
  professionalTax: number;
  otherIncome: Record<string, number>;
  ctc: Record<string, number>;
  retirement: Record<string, number>;
  exemptions: Record<string, number | boolean>;
  perquisites: Record<string, number | boolean | string>;
  deductions: Record<string, number | boolean | string>;
}

export interface TaxRow {
  key: string;
  label: string;
  act1961: string;
  act2025: string;
  amount?: number;
  old: number;
  new: number;
  applied: number;
  allowedInNew?: boolean;
  status?: string;
  logic: string;
}

export interface TaxLine {
  key: string;
  label: string;
  act1961: string;
  act2025: string;
  old: number;
  new: number;
  selected: number;
}

export interface IncomeTaxResult {
  inputs: IncomeTaxInputs;
  metroCity: boolean;
  totalCtc: number;
  exemptions: { rows: TaxRow[]; totalAmount: number; totalOld: number; totalNew: number };
  perquisites: { rows: TaxRow[]; totalOld: number; totalNew: number };
  deductions: { rows: TaxRow[]; totalOld: number; totalNew: number; interest24b: number };
  computation: TaxLine[];
  summary: {
    regime: TaxRegime;
    oldTax: number;
    newTax: number;
    selectedTax: number;
    selectedMonthlyTds: number;
    savingWithNew: number;
    beneficialRegime: 'OLD' | 'NEW' | 'EQUAL';
    selectedIsBeneficial: boolean;
    monthlyTakeHome: number;
  };
}

export interface EmployeeOption {
  _id: string;
  name: string;
  employeeCode: string;
}

export interface IncomeTaxOptions {
  ctcComponents: { key: string; label: string; treatment: string }[];
  sec80cItems: { key: string; label: string }[];
  cities: string[];
  metroCities: string[];
  defaults: IncomeTaxInputs;
  employees: EmployeeOption[] | null;
}

// -------------------------------------------------------------
// SALARY ARREAR CALCULATOR — mirrors backend app/utils/salary_arrear.py
// -------------------------------------------------------------
export interface ArrearComponent {
  name: string;
  old: number;
  revised: number;
  pfWage: boolean;
  esicWage: boolean;
}

export interface ArrearInputs {
  employeeCode: string;
  employeeName: string;
  arrearType: 'NEW_JOINER' | 'REVISION';
  payrollMonth: string | null;
  cutoffDay: number;
  dateOfJoining: string | null;
  effectiveDate: string | null;
  payDaysBasis: 'CALENDAR' | 'FIXED_30';
  pfRate: number;
  pfWageCeiling: number;
  restrictPfToCeiling: boolean;
  esicRate: number;
  esicWageCeiling: number;
  components: ArrearComponent[];
}

export interface ArrearTriple {
  old: number;
  revised: number;
  difference: number;
}

export interface ArrearMonth {
  month: number;
  monthStart: string;
  periodFrom: string;
  periodTo: string;
  daysInMonth: number;
  paidDays: number;
  prorationFactor: number;
  esicApplicableRevised: boolean;
  esicApplicableOld: boolean;
  earnings: number[];
  grossArrear: number;
  pfWageRevised: number;
  pfWageOld: number;
  pfRevised: number;
  pfOld: number;
  pfArrear: number;
  esicWageRevised: number;
  esicWageOld: number;
  esicRevised: number;
  esicOld: number;
  esicArrear: number;
  contributionArrear: number;
  totalArrear: number;
}

export interface ArrearResult {
  inputs: ArrearInputs;
  period: {
    start: string | null;
    end: string | null;
    months: number;
    monthsCovered: number;
    label: string;
    oldSalaryFactor: number;
    esicPeriodEnd: string | null;
    status: string;
    ok: boolean;
  };
  structure: {
    components: (ArrearComponent & { difference: number })[];
    gross: ArrearTriple;
    pfWage: ArrearTriple;
    esicWage: ArrearTriple;
    employerPf: ArrearTriple;
    employerEsic: ArrearTriple;
    contributions: ArrearTriple;
    fixedCtc: ArrearTriple;
  };
  months: ArrearMonth[];
  componentTotals: { name: string; total: number }[];
  totals: {
    paidDays: number;
    grossArrear: number;
    pfArrear: number;
    esicArrear: number;
    contributionArrear: number;
    totalArrear: number;
  };
}

export interface ArrearOptions {
  defaults: ArrearInputs;
  employees: EmployeeOption[] | null;
  maxMonths: number;
  maxComponents: number;
}
