import { request } from './api';
import {
  ArrearInputs,
  ArrearOptions,
  ArrearResult,
  IncomeTaxInputs,
  IncomeTaxOptions,
  IncomeTaxResult,
} from '../types/payrollCalculators';

const withEmployee = (path: string, employeeId?: string) =>
  employeeId ? `${path}?employeeId=${encodeURIComponent(employeeId)}` : path;

export const payrollCalculatorsService = {
  // Income tax (TY 2026-27)
  getIncomeTaxOptions: () => request<IncomeTaxOptions>('/payroll/income-tax/options'),

  prefillIncomeTax: (employeeId?: string) =>
    request<{ inputs: IncomeTaxInputs; result: IncomeTaxResult; hasDeclaration: boolean; annualCtc: number }>(
      withEmployee('/payroll/income-tax/prefill', employeeId)
    ),

  calculateIncomeTax: (inputs: IncomeTaxInputs) =>
    request<IncomeTaxResult>('/payroll/income-tax/calculate', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    }),

  // Salary arrears
  getArrearOptions: () => request<ArrearOptions>('/payroll/arrears/options'),

  prefillArrear: (employeeId?: string) =>
    request<{ inputs: ArrearInputs; result: ArrearResult; annualCtc: number }>(
      withEmployee('/payroll/arrears/prefill', employeeId)
    ),

  calculateArrear: (inputs: ArrearInputs) =>
    request<ArrearResult>('/payroll/arrears/calculate', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    }),
};
