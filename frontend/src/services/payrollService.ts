import { request, API_BASE, getAuthToken, ApiError, api } from './api';

export interface PayLine {
  code: string;
  name: string;
  amount: number;
  full?: number;
  wage?: number;
}

export interface PayslipFull {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation?: string;
  department?: string;
  panNumber?: string;
  pfUan?: string;
  bankName?: string;
  bankAccountNumber?: string;
  month: string;
  monthName: string;
  structure?: string;
  annualCtc?: number;
  daysInMonth?: number;
  employedDays?: number;
  workedDays: number;
  lopDays: number;
  earnings?: PayLine[];
  deductions?: PayLine[];
  employerContributions?: PayLine[];
  grossSalary: number;
  totalDeductions: number;
  netSalary: number;
  tds?: number;
  providentFund?: number;
  status: string;
  variancePct?: number;
  previousNet?: number;
  payDate?: string;
  // legacy fields on older payslips
  basicSalary?: number;
  hra?: number;
  specialAllowance?: number;
  conveyanceAllowance?: number;
  professionalTax?: number;
  otherDeductions?: number;
}

export interface PayrollException {
  employeeId: string;
  employeeName: string;
  type: string;
  blocking: boolean;
  message: string;
}

export interface PayrollRun {
  _id: string;
  monthName?: string;
  status: 'NONE' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID' | 'REJECTED' | 'REOPENED';
  totals?: Record<string, number>;
  preparedBy?: string;
  approvedBy?: string;
  releasedBy?: string;
  rejectionComment?: string;
  paymentReference?: string;
  locked?: boolean;
  unlockRequest?: { reason: string; by: string; at: string } | null;
  conflicts?: string[];
  canApprove?: boolean;
  history?: { action: string; by: string; at: string; comment?: string; reason?: string }[];
}

export interface SalaryRevision {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  effectiveFrom: string;
  oldSalary: number;
  newSalary: number;
  status: string;
  reason?: string;
  source?: string;
  proposedBy?: string;
  approvedBy?: string;
  canDecide?: boolean;
}

export interface StructureComponent {
  code: string;
  name: string;
  basis: 'PCT_CTC' | 'PCT_BASIC' | 'FIXED' | 'BALANCE';
  value: number;
}

export interface SalaryStructureDef {
  _id: string;
  name: string;
  components: StructureComponent[];
  grades: string[];
  employerPfInCtc: boolean;
  active: boolean;
}

export interface DeclarationView {
  employeeId: string;
  employeeName?: string;
  fy: string;
  regime: 'OLD' | 'NEW';
  npsOptIn: boolean;
  sections: {
    section: string;
    label: string;
    cap: number | null;
    applies: boolean;
    declared: number;
    proofs: { _id: string; amount: number; fileName: string; status: string; verifiedAmount?: number; comment?: string }[];
  }[];
  declarationOpen: boolean;
  proofOpen: boolean;
  windows: { declaration: { open: boolean; until: string | null }; proof: { open: boolean; until: string | null } };
}

const send = <T>(path: string, method: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'Download failed.', res.status, data);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const payrollService = {
  myPayslips: () => request<{ payslips: PayslipFull[] }>('/payroll/payslips'),
  payslipsFor: (month: string) => request<{ payslips: PayslipFull[] }>(`/payroll/payslips?month=${month}`),
  payslip: (id: string) => request<{ payslip: PayslipFull; pdfPassword?: string; pdfPasswordHint: string }>(`/payroll/payslips/${id}`),

  runs: () => request<{ runs: PayrollRun[] }>('/payroll/runs'),
  preview: (month: string) =>
    send<{ rows: PayslipFull[]; exceptions: PayrollException[]; totals: Record<string, number>; run: PayrollRun; locked: boolean }>('/payroll/preview', 'POST', { month }),
  prepare: (month: string) => send<{ message: string; exceptions: PayrollException[] }>('/payroll/run', 'POST', { month }),
  approve: (month: string) => send<{ message: string }>('/payroll/approve', 'POST', { month }),
  reject: (month: string, comment: string) => send('/payroll/reject', 'POST', { month, comment }),
  requestUnlock: (month: string, reason: string) => send('/payroll/unlock-request', 'POST', { month, reason }),
  approveUnlock: (month: string) => send(`/payroll/unlock/${month}/approve`, 'POST', {}),
  release: (month: string, reference: string) => send('/payroll/release', 'POST', { month, reference }),
  register: (month: string) => request<any>(`/payroll/register?month=${month}`),
  bankAdvice: (month: string) => downloadFile(`/payroll/bank-advice?month=${month}`, `salary_bank_advice_${month}.csv`),
  statutoryFile: (kind: string, month: string) => downloadFile(`/payroll/statutory/${kind}?month=${month}`, `${kind}_${month}`),

  inputs: (month: string) => request<{ inputs: any[]; locked: boolean; manualKinds: string[]; kinds: Record<string, { label: string; earning: boolean }> }>(`/payroll/inputs?month=${month}`),
  addInput: (data: { employeeId: string; month: string; kind: string; amount: number; label?: string }) => send('/payroll/inputs', 'POST', data),
  removeInput: (id: string) => send(`/payroll/inputs/${id}`, 'DELETE'),

  revisions: (status?: string) => request<{ revisions: SalaryRevision[] }>(`/payroll/salary-revisions${status ? `?status=${status}` : ''}`),
  proposeRevision: (data: { employeeId: string; newAnnualSalary: number; effectiveFrom: string; reason: string }) =>
    send('/payroll/salary-revisions', 'POST', data),
  decideRevision: (employeeId: string, id: string, decision: 'APPROVED' | 'REJECTED', comment?: string) =>
    send(`/payroll/salary-revisions/${employeeId}/${id}/decide`, 'POST', { decision, comment }),

  settings: () => request<{ settings: any; defaults: any }>('/payroll/settings'),
  saveSettings: (data: any) => send('/payroll/settings', 'PUT', data),
  structures: () => request<{ structures: SalaryStructureDef[] }>('/payroll/structures'),
  saveStructure: (data: Partial<SalaryStructureDef>, id?: string) =>
    send<{ structure: SalaryStructureDef }>(id ? `/payroll/structures/${id}` : '/payroll/structures', id ? 'PUT' : 'POST', data),
  assignStructure: (id: string, data: { employeeIds?: string[]; grades?: string[] }) => send(`/payroll/structures/${id}/assign`, 'PUT', data),
  previewStructure: (ctc: number, structureId?: string) =>
    request<{ payslip: PayslipFull }>(`/payroll/structures/preview?ctc=${ctc}${structureId ? `&structureId=${structureId}` : ''}`),

  form16: (fy?: string, employeeId?: string) =>
    request<any>(`/payroll/form16?${fy ? `fy=${fy}&` : ''}${employeeId ? `employeeId=${employeeId}` : ''}`),

  myDeclaration: () => request<{ declaration: DeclarationView }>('/tax/declarations/me'),
  saveDeclaration: (data: { regime: string; npsOptIn: boolean; items: Record<string, number> }) =>
    send<{ declaration: DeclarationView }>('/tax/declarations/me', 'PUT', data),
  uploadProof: (section: string, amount: number, file: File) => {
    const fd = new FormData();
    fd.append('section', section);
    fd.append('amount', String(amount));
    fd.append('file', file);
    return api.upload<{ declaration: DeclarationView }>('/tax/declarations/me/proofs', fd);
  },
  allDeclarations: () => request<{ declarations: DeclarationView[] }>('/tax/declarations'),
  verifyProof: (employeeId: string, proofId: string, decision: 'VERIFIED' | 'REJECTED', verifiedAmount?: number, comment?: string) =>
    send(`/tax/declarations/${employeeId}/proofs/${proofId}/verify`, 'POST', { decision, verifiedAmount, comment }),
  proofFile: (employeeId: string, proofId: string) => downloadFile(`/tax/declarations/${employeeId}/proofs/${proofId}/file`, 'proof'),
  setWindows: (data: any) => send('/tax/windows', 'PUT', data),
};
