/**
 * Salary structure calculator (FY 2026-27)
 * Mirrors the Greenticker "Salary Structure" sheet:
 *
 * WAGES (must be >= 50% of CTC)
 *   Basic                  = 23.9% of CTC
 *   Education Allowance    = fixed Rs. 1,000 / month
 *   PPF Allowance          = 12% of Basic
 *   Medical Insurance      = fixed Rs. 1,000 / month
 *   BFAA                   = 6% of CTC
 *   Special Allowance      = balancing amount (Total Wages - all of the above)
 *   Total Wages            = 50% of CTC
 *
 * ALLOWANCES (not forming part of wages)
 *   HRA                    = 50% of Basic
 *   LTA                    = 40% of Basic
 *   Conveyance Allowance   = balancing amount (CTC - Total Wages - HRA - LTA)
 *
 * Deductions: Professional Tax Rs. 200 / month (Rs. 2,500 / year), PF (employee) = PPF allowance
 * Annual one-time payments: PPF Allowance, PPF-Employee, Medical Insurance, BFAA
 */

export interface SalaryLine {
  key: string;
  label: string;
  monthly: number;
  yearly: number;
  /** Human readable rule shown in the "Proposed by" column */
  rule: string;
  /** Share of CTC in % */
  percentOfCtc: number;
}

export interface SalaryStructure {
  annualCtc: number;
  wages: SalaryLine[];
  totalWages: SalaryLine;
  allowances: SalaryLine[];
  totalAllowances: SalaryLine;
  totalGross: SalaryLine;
  totalCtc: SalaryLine;
  deductions: SalaryLine[];
  totalDeduction: SalaryLine;
  netPay: {
    monthlyGross: number;
    professionalTax: number;
    pfEmployee: number;
    netPayPerMonth: number;
  };
  annualPayments: {
    ppfAllowance: number;
    ppfEmployee: number;
    medicalInsurance: number;
    bfaa: number;
    total: number;
  };
  wagesMeetMinimum: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const EDUCATION_ALLOWANCE_MONTHLY = 1000;
export const MEDICAL_INSURANCE_MONTHLY = 1000;
export const PROFESSIONAL_TAX_MONTHLY = 200;
export const PROFESSIONAL_TAX_YEARLY = 2500; // 11 x 200 + 300 (Maharashtra, Feb)
export const PROFESSIONAL_TAX_FEBRUARY = 300;

/** Professional Tax for a payroll month ('YYYY-MM'): Rs. 200, except Rs. 300 in February (= Rs. 2,500 / year). */
export function professionalTaxForMonth(monthStr: string): number {
  return /-0?2$/.test(monthStr) ? PROFESSIONAL_TAX_FEBRUARY : PROFESSIONAL_TAX_MONTHLY;
}

export function computeSalaryStructure(annualCtcInput: number): SalaryStructure {
  const ctc = r2(Math.max(0, Number(annualCtcInput) || 0));
  const pct = (v: number) => (ctc > 0 ? r2((v / ctc) * 100) : 0);

  const line = (key: string, label: string, yearly: number, rule: string): SalaryLine => ({
    key,
    label,
    yearly: r2(yearly),
    monthly: r2(yearly / 12),
    rule,
    percentOfCtc: pct(yearly),
  });

  // ---- Wages ----
  const basicY = r2(ctc * 0.239);
  const educationY = EDUCATION_ALLOWANCE_MONTHLY * 12;
  const ppfY = r2(basicY * 0.12);
  const medicalY = MEDICAL_INSURANCE_MONTHLY * 12;
  const bfaaY = r2(ctc * 0.06);
  const totalWagesY = r2(ctc * 0.5);
  const specialY = r2(totalWagesY - (basicY + educationY + ppfY + medicalY + bfaaY));

  const wages: SalaryLine[] = [
    line('basic', 'Basic', basicY, '23.9% of CTC'),
    line('education', 'Education Allowance', educationY, 'Fixed Rs. 1,000 / month'),
    line('ppf', 'PPF Allowance', ppfY, '12% of Basic'),
    line('medical', 'Medical Insurance', medicalY, 'Fixed Rs. 1,000 / month'),
    line('bfaa', 'BFAA', bfaaY, '6% of CTC'),
    line('special', 'Special Allowance / Other Allowance', specialY, 'Balancing amount (Total Wages less others)'),
  ];
  const totalWages = line('totalWages', 'TOTAL WAGES', totalWagesY, 'This should be minimum 50% of total gross salary');

  // ---- Allowances ----
  const hraY = r2(basicY * 0.5);
  const ltaY = r2(basicY * 0.4);
  const totalAllowancesY = r2(ctc - totalWagesY);
  const conveyanceY = r2(totalAllowancesY - hraY - ltaY);

  const allowances: SalaryLine[] = [
    line('hra', 'H.R.A', hraY, '50% of Basic'),
    line('lta', 'LTA', ltaY, '40% of Basic'),
    line('conveyance', 'Conveyance Allowance', conveyanceY, 'Balancing amount (Total CTC less Total Wages less HRA less LTA)'),
  ];
  const totalAllowances = line('totalAllowances', 'TOTAL ALLOWANCES', totalAllowancesY, '');
  const totalGross = line('totalGross', 'TOTAL GROSS SALARY', r2(totalWagesY + totalAllowancesY), '');
  const totalCtc = line('totalCtc', 'TOTAL CTC', ctc, '');

  // ---- Deductions ----
  const ptY = ctc > 0 ? PROFESSIONAL_TAX_YEARLY : 0;
  const ptMonthly = ctc > 0 ? PROFESSIONAL_TAX_MONTHLY : 0;
  const deductions: SalaryLine[] = [
    { key: 'pt', label: 'PT', monthly: ptMonthly, yearly: ptY, rule: 'Professional Tax', percentOfCtc: pct(ptY) },
  ];
  const totalDeduction: SalaryLine = {
    key: 'totalDeduction',
    label: 'TOTAL DEDUCTION',
    monthly: ptMonthly,
    yearly: ptY,
    rule: '',
    percentOfCtc: pct(ptY),
  };

  // ---- Net pay per month ----
  // Monthly gross excludes the items that are paid once a year (PPF allowance, Medical Insurance, BFAA)
  const monthlyGross = r2(totalGross.monthly - wages[2].monthly - wages[3].monthly - wages[4].monthly);
  const pfEmployee = wages[2].monthly; // PF (employee) = 12% of Basic
  const netPayPerMonth = r2(monthlyGross - ptMonthly - pfEmployee);

  // ---- Annual (one-time) payments ----
  const annualPayments = {
    ppfAllowance: ppfY,
    ppfEmployee: ppfY,
    medicalInsurance: medicalY,
    bfaa: bfaaY,
    total: r2(ppfY + ppfY + medicalY + bfaaY),
  };

  return {
    annualCtc: ctc,
    wages,
    totalWages,
    allowances,
    totalAllowances,
    totalGross,
    totalCtc,
    deductions,
    totalDeduction,
    netPay: { monthlyGross, professionalTax: ptMonthly, pfEmployee, netPayPerMonth },
    annualPayments,
    wagesMeetMinimum: totalWagesY >= r2(totalGross.yearly * 0.5) - 0.01,
  };
}