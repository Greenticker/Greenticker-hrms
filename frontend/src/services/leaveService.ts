import { request } from './api';

export interface LeaveType {
  _id: string;
  code: string;
  name: string;
  balanceKey: string;
  annualEntitlement: number;
  carryForwardMax: number;
  encashable: boolean;
  encashMax: number;
  allowHalfDay: boolean;
  maxBackdatedDays: number;
  gender: 'ANY' | 'FEMALE' | 'MALE';
  minServiceDays: number;
  employmentTypes: string[];
  sandwich: boolean;
  excessPolicy: 'BLOCK' | 'LOP';
  paid: boolean;
  active: boolean;
}

export interface LeaveSettings {
  slaDays: number;
  weekendDays: number[];
  lastYearEnd?: { on: string; by: string; payoutMonth: string } | null;
}

export interface BalanceRow {
  code: string;
  name: string;
  paid: boolean;
  total: number;
  used: number;
  pending: number;
  available: number | null;
  carriedForward: number;
  adjusted: number;
  credits?: { days: number; earnedOn?: string; expiresOn?: string }[];
  nextExpiry?: string | null;
}

export interface LeaveRequestItem {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  department?: string;
  leaveType: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  paidDays?: number;
  lopDays?: number;
  isHalfDay?: boolean;
  halfDaySession?: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  appliedAt: string;
  approverName?: string;
  reviewedBy?: string;
  reviewComment?: string;
  rejectionReason?: string;
  appliedOnBehalfBy?: string;
  escalated?: boolean;
  canDecide: boolean;
  canCancel: boolean;
  canEdit: boolean;
  history?: { action: string; by: string; at: string; comment?: string; as?: string }[];
}

export interface ApplyInput {
  leaveType: string;
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDaySession?: string;
  reason: string;
  convertExcessToLop?: boolean;
  targetEmployeeId?: string;
}

export interface YearEndRow {
  employeeId: string;
  employeeName: string;
  leaveType: string;
  remaining: number;
  carryForward: number;
  encash: number;
  encashAmount: number;
  lapse: number;
}

const post = <T>(path: string, body?: unknown, method = 'POST') => request<T>(path, { method, body: JSON.stringify(body ?? {}) });

export const leaveService = {
  getTypes: () => request<{ types: LeaveType[]; settings: LeaveSettings }>('/leave/types'),
  saveType: (data: Partial<LeaveType>, id?: string) =>
    post<{ type: LeaveType }>(id ? `/leave/types/${id}` : '/leave/types', data, id ? 'PUT' : 'POST'),
  saveSettings: (data: Partial<LeaveSettings>) => post<{ settings: LeaveSettings }>('/leave/settings', data, 'PUT'),

  getBalance: (employeeId?: string) =>
    request<{ balances: BalanceRow[]; employeeId: string }>(`/leave/balance${employeeId ? `?employeeId=${employeeId}` : ''}`),
  getRequests: (scope: 'mine' | 'approvals' | 'team' | 'all', status?: string) =>
    request<{ requests: LeaveRequestItem[]; balances: BalanceRow[] }>(
      `/leave/requests?scope=${scope}${status && status !== 'ALL' ? `&status=${status}` : ''}`
    ),
  apply: (data: ApplyInput) => post<{ leave: LeaveRequestItem }>('/leave/apply', data),
  edit: (id: string, data: Partial<ApplyInput>) => post<{ leave: LeaveRequestItem }>(`/leave/requests/${id}`, data, 'PUT'),
  decide: (id: string, status: 'APPROVED' | 'REJECTED' | 'CANCELLED', comment?: string) =>
    post<{ leave: LeaveRequestItem }>(`/leave/${id}/status`, { status, comment }, 'PUT'),

  getCalendar: (month: string) =>
    request<{
      month: string;
      scope: 'ALL' | 'TEAM' | 'SELF';
      people: [string, string][];
      entries: { employeeId: string; employeeName: string; leaveType: string; startDate: string; endDate: string; status: string; isHalfDay?: boolean }[];
      holidays: Record<string, string>;
    }>(`/leave/calendar?month=${month}`),

  getDelegate: () => request<{ delegate: { delegateId: string; delegateName: string; from: string; until: string } | null }>('/leave/delegate'),
  setDelegate: (data: { delegateId?: string; from?: string; until?: string }) => post<{ delegate: unknown }>('/leave/delegate', data, 'PUT'),

  adjust: (employeeId: string, data: { leaveType: string; days: number; reason: string }) =>
    post<{ balances: BalanceRow[] }>(`/leave/balance/${employeeId}/adjust`, data),
  yearEnd: (data: { dryRun: boolean; payoutMonth?: string }) =>
    post<{ dryRun: boolean; payoutMonth: string; rows: YearEndRow[]; totals: Record<string, number> }>('/leave/year-end', data),
};
