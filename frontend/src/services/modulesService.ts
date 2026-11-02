import { request, API_BASE, getAuthToken } from './api';
import {
  LeaveBalance,
  LeaveRequest,
  ExpenseClaim,
  Payslip,
  TaxDeclaration,
  PolicyItem,
  PolicyAcknowledgement,
  PoshCase,
  HolidayItem,
  HolidayInput,
  AnnouncementItem,
  PerformanceReview,
  JobOpening,
  JobCandidate,
  Referral,
  ReferralStatus,
  HrRequest,
  FullFinalSettlement,
  AllocatedAsset,
  InsurancePolicy,
  InsuranceEnrollment,
  InsuranceClaim,
  Form24QData,
} from '../types/modules';

export const modulesService = {
  // =============================================================
  // LEAVE
  // =============================================================

  getLeaveBalance: async (
    employeeId?: string
  ): Promise<{ balance: LeaveBalance }> => {
    return request<{ balance: LeaveBalance }>(
      employeeId
        ? `/leave/balance?employeeId=${employeeId}`
        : '/leave/balance'
    );
  },

  getLeaveRequests: async (params?: {
    status?: string;
    employeeId?: string;
  }): Promise<{
    requests: LeaveRequest[];
    balance: LeaveBalance | null;
  }> => {
    const query = new URLSearchParams();

    if (params?.status) {
      query.append('status', params.status);
    }

    if (params?.employeeId) {
      query.append('employeeId', params.employeeId);
    }

    return request<{
      requests: LeaveRequest[];
      balance: LeaveBalance | null;
    }>(`/leave/requests?${query.toString()}`);
  },

  applyLeave: async (data: {
    targetEmployeeId?: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    daysCount: number;
    isHalfDay?: boolean;
    halfDaySession?: string;
    reason: string;
    documentUrl?: string;
  }): Promise<{
    success: boolean;
    leave: LeaveRequest;
  }> => {
    return request<{
      success: boolean;
      leave: LeaveRequest;
    }>('/leave/apply', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateLeaveStatus: async (
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    rejectionReason?: string
  ): Promise<{
    success: boolean;
    leave: LeaveRequest;
  }> => {
    return request<{
      success: boolean;
      leave: LeaveRequest;
    }>(`/leave/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        rejectionReason,
      }),
    });
  },

  // =============================================================
  // EXPENSES
  // =============================================================

  getExpenses: async (params?: {
    status?: string;
    category?: string;
    employeeId?: string;
  }): Promise<{
    claims: ExpenseClaim[];
  }> => {
    const query = new URLSearchParams();

    if (params?.status) {
      query.append('status', params.status);
    }

    if (params?.category) {
      query.append('category', params.category);
    }

    if (params?.employeeId) {
      query.append('employeeId', params.employeeId);
    }

    return request<{ claims: ExpenseClaim[] }>(
      `/expenses?${query.toString()}`
    );
  },

  submitExpense: async (data: {
    targetEmployeeId?: string;
    title: string;
    category: string;
    amount: number;
    currency?: string;
    expenseDate: string;
    description: string;
    receiptName?: string;
  }): Promise<{
    success: boolean;
    claim: ExpenseClaim;
  }> => {
    return request<{
      success: boolean;
      claim: ExpenseClaim;
    }>('/expenses', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateExpenseStatus: async (
    id: string,
    status:
      | 'MANAGER_APPROVED'
      | 'HR_APPROVED'
      | 'REJECTED'
      | 'REIMBURSED',
    options?: {
      rejectionReason?: string;
      paymentReference?: string;
    }
  ): Promise<{
    success: boolean;
    claim: ExpenseClaim;
  }> => {
    return request<{
      success: boolean;
      claim: ExpenseClaim;
    }>(`/expenses/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        ...options,
      }),
    });
  },

  // =============================================================
  // PAYROLL
  // =============================================================

  getPayslips: async (params?: {
    month?: string;
    employeeId?: string;
  }): Promise<{
    payslips: Payslip[];
    summary: {
      totalSlips: number;
      totalDisbursed: number;
      totalDeductions: number;
      netPayout: number;
    };
  }> => {
    const query = new URLSearchParams();

    if (params?.month) {
      query.append('month', params.month);
    }

    if (params?.employeeId) {
      query.append('employeeId', params.employeeId);
    }

    return request<{
      payslips: Payslip[];
      summary: {
        totalSlips: number;
        totalDisbursed: number;
        totalDeductions: number;
        netPayout: number;
      };
    }>(`/payroll/payslips?${query.toString()}`);
  },

  runPayroll: async (
    month: string,
    monthName: string
  ): Promise<{
    success: boolean;
    message: string;
    generatedCount: number;
  }> => {
    return request<{
      success: boolean;
      message: string;
      generatedCount: number;
    }>('/payroll/run', {
      method: 'POST',
      body: JSON.stringify({
        month,
        monthName,
      }),
    });
  },

  executeBulkSalaryRevision: async (data: {
    revisions: Array<{ employeeId: string; newAnnualSalary: number }>;
    effectiveDate: string;
    reason: string;
  }): Promise<{
    success: boolean;
    message: string;
    updatedEmployees: Array<{ id: string; name: string; oldSalary: number; newSalary: number }>;
  }> => {
    return request<{
      success: boolean;
      message: string;
      updatedEmployees: Array<{ id: string; name: string; oldSalary: number; newSalary: number }>;
    }>('/payroll/bulk-revision', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // =============================================================
  // TAX
  // =============================================================

  getTaxDeclaration: async (
    employeeId?: string
  ): Promise<{
    declaration: TaxDeclaration | null;
  }> => {
    return request<{
      declaration: TaxDeclaration | null;
    }>(
      employeeId
        ? `/tax/declaration?employeeId=${employeeId}`
        : '/tax/declaration'
    );
  },

  saveTaxDeclaration: async (
    data: Partial<TaxDeclaration>
  ): Promise<{
    success: boolean;
    declaration: TaxDeclaration;
  }> => {
    return request<{
      success: boolean;
      declaration: TaxDeclaration;
    }>('/tax/declaration', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // =============================================================
  // POLICIES & COMPANY COMPLIANCE
  // =============================================================

  /**
   * Fetch all company policies and the current user's
   * acknowledgements.
   *
   * Accessible to all authenticated roles.
   */
  getPolicies: async (): Promise<{
    policies: PolicyItem[];
    acknowledgements: PolicyAcknowledgement[];
  }> => {
    return request<{
      policies: PolicyItem[];
      acknowledgements: PolicyAcknowledgement[];
    }>('/policies');
  },

  /**
   * Add a new company compliance / policy.
   *
   * Frontend permission:
   * - ADMIN: allowed
   * - HR: allowed
   *
   * The backend MUST enforce the same permission.
   */
  createPolicy: async (data: {
    title: string;
    category: PolicyItem['category'];
    version: string;
    summary: string;
    content: string;
    mandatory: boolean;
    effectiveDate: string;
  }): Promise<{
    success: boolean;
    policy: PolicyItem;
  }> => {
    return request<{
      success: boolean;
      policy: PolicyItem;
    }>('/policies', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Remove an existing company compliance / policy.
   *
   * Frontend permission:
   * - ADMIN: allowed
   * - HR: NOT allowed
   * - MANAGER: NOT allowed
   * - EMPLOYEE: NOT allowed
   *
   * The backend MUST enforce Admin-only access.
   */
  deletePolicy: async (
    id: string
  ): Promise<{
    success: boolean;
    message: string;
  }> => {
    return request<{
      success: boolean;
      message: string;
    }>(`/policies/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Acknowledge a company policy.
   *
   * Accessible to authenticated users according to backend policy.
   */
  acknowledgePolicy: async (
    id: string
  ): Promise<{
    success: boolean;
    acknowledgement: PolicyAcknowledgement;
  }> => {
    return request<{
      success: boolean;
      acknowledgement: PolicyAcknowledgement;
    }>(`/policies/${id}/acknowledge`, {
      method: 'POST',
    });
  },

  // =============================================================
  // POSH
  // Strictly Admin & HR
  // =============================================================

  getPoshCases: async (): Promise<{
    cases: PoshCase[];
  }> => {
    return request<{ cases: PoshCase[] }>('/posh/cases');
  },

  createPoshCase: async (
    data: Partial<PoshCase>
  ): Promise<{
    success: boolean;
    case: PoshCase;
  }> => {
    return request<{
      success: boolean;
      case: PoshCase;
    }>('/posh/cases', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updatePoshStage: async (
    id: string,
    stage: PoshCase['stage'],
    notes?: string,
    status?: PoshCase['status']
  ): Promise<{
    success: boolean;
    case: PoshCase;
  }> => {
    return request<{
      success: boolean;
      case: PoshCase;
    }>(`/posh/cases/${id}/stage`, {
      method: 'PUT',
      body: JSON.stringify({
        stage,
        notes,
        status,
      }),
    });
  },

  // =============================================================
  // HOLIDAYS & ANNOUNCEMENTS
  // =============================================================

  getHolidays: async (): Promise<{
    holidays: HolidayItem[];
  }> => {
    return request<{
      holidays: HolidayItem[];
    }>('/holidays');
  },

  createHoliday: async (data: HolidayInput): Promise<{ success: boolean; holiday: HolidayItem }> => {
    return request<{ success: boolean; holiday: HolidayItem }>('/holidays', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateHoliday: async (id: string, data: HolidayInput): Promise<{ success: boolean; holiday: HolidayItem }> => {
    return request<{ success: boolean; holiday: HolidayItem }>(`/holidays/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteHoliday: async (id: string): Promise<{ success: boolean }> => {
    return request<{ success: boolean }>(`/holidays/${id}`, { method: 'DELETE' });
  },

  getAnnouncements: async (): Promise<{
    announcements: AnnouncementItem[];
  }> => {
    return request<{
      announcements: AnnouncementItem[];
    }>('/announcements');
  },

  publishAnnouncement: async (data: {
    title: string;
    content: string;
    category?: string;
    priority?: string;
    pinned?: boolean;
    targetDepartment?: string;
    poll?: { question: string; options: string[] };
  }): Promise<{
    success: boolean;
    announcement: AnnouncementItem;
  }> => {
    return request<{
      success: boolean;
      announcement: AnnouncementItem;
    }>('/announcements', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  voteAnnouncementPoll: async (
    announcementId: string,
    optionId: string
  ): Promise<{ success: boolean; announcement: AnnouncementItem }> => {
    return request<{ success: boolean; announcement: AnnouncementItem }>(
      `/announcements/${announcementId}/vote`,
      {
        method: 'POST',
        body: JSON.stringify({ optionId }),
      }
    );
  },

  // =============================================================
  // PERFORMANCE
  // =============================================================

  getPerformanceReviews: async (
    employeeId?: string
  ): Promise<{
    reviews: PerformanceReview[];
  }> => {
    return request<{
      reviews: PerformanceReview[];
    }>(
      employeeId
        ? `/performance/reviews?employeeId=${employeeId}`
        : '/performance/reviews'
    );
  },

  // =============================================================
  // RECRUITMENT
  // =============================================================

  getJobOpenings: async (): Promise<{
    jobs: JobOpening[];
  }> => {
    return request<{
      jobs: JobOpening[];
    }>('/recruitment/jobs');
  },

  getJobCandidates: async (
    jobId?: string
  ): Promise<{
    candidates: JobCandidate[];
  }> => {
    return request<{
      candidates: JobCandidate[];
    }>(
      jobId
        ? `/recruitment/candidates?jobId=${jobId}`
        : '/recruitment/candidates'
    );
  },

  getReferrals: async (): Promise<{ referrals: Referral[] }> => {
    return request<{ referrals: Referral[] }>('/recruitment/referrals');
  },

  submitReferral: async (data: {
    fullName: string;
    email: string;
    phone?: string;
    city: string;
    experienceYears: string;
    jobId?: string;
    relationship?: string;
    notes?: string;
    resume: File;
  }): Promise<{ success: boolean }> => {
    const form = new FormData();
    form.append('fullName', data.fullName);
    form.append('email', data.email);
    form.append('city', data.city);
    form.append('experienceYears', data.experienceYears);
    if (data.phone) form.append('phone', data.phone);
    if (data.jobId) form.append('jobId', data.jobId);
    if (data.relationship) form.append('relationship', data.relationship);
    if (data.notes) form.append('notes', data.notes);
    form.append('resume', data.resume);

    const token = getAuthToken();
    const response = await fetch(`${API_BASE}/recruitment/referrals`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Failed to submit referral');
    return body;
  },

  updateReferralStatus: async (id: string, status: ReferralStatus): Promise<{ success: boolean }> => {
    return request<{ success: boolean }>(`/recruitment/referrals/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  },

  convertReferralToCandidate: async (id: string): Promise<{ success: boolean; candidate: JobCandidate }> => {
    return request<{ success: boolean; candidate: JobCandidate }>(`/recruitment/referrals/${id}/convert`, {
      method: 'POST',
    });
  },

  downloadReferralResume: async (id: string, fileName: string): Promise<void> => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}/recruitment/referrals/${id}/resume`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || 'Could not download resume');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'resume';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  updateCandidateStage: async (
    id: string,
    stage: JobCandidate['stage']
  ): Promise<{
    success: boolean;
    candidate: JobCandidate;
  }> => {
    return request<{
      success: boolean;
      candidate: JobCandidate;
    }>(`/recruitment/candidates/${id}/stage`, {
      method: 'PUT',
      body: JSON.stringify({
        stage,
      }),
    });
  },

  scheduleInterview: async (
    id: string,
    data: {
      date: string;
      time: string;
      durationMinutes: number;
      mode: 'IN_PERSON' | 'VIDEO' | 'PHONE';
      locationOrLink: string;
      interviewer: string;
      roundName?: string;
      roundNumber?: number;
      notes?: string;
    }
  ) => {
    return request<any>(`/recruitment/candidates/${id}/schedule-interview`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  extendOffer: async (
    id: string,
    data: {
      annualCtc: number;
      joiningDate: string;
      validTill: string;
      designation: string;
      location: string;
      reportingTo?: string;
      notes?: string;
    }
  ) => {
    return request<any>(`/recruitment/candidates/${id}/extend-offer`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  rejectCandidate: async (id: string) => {
    return request<any>(`/recruitment/candidates/${id}/reject`, {
      method: 'POST',
    });
  },

  submitFeedback: async (
    id: string,
    data: {
      round: string;
      roundNumber?: number;
      rating: number;
      justification?: string;
      comments: string;
      notes?: string;
      recommendation: string;
    }
  ) => {
    return request<any>(`/recruitment/candidates/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // =============================================================
  // HR HELP DESK
  // =============================================================

  getHrRequests: async (
    status?: string
  ): Promise<{
    requests: HrRequest[];
  }> => {
    return request<{
      requests: HrRequest[];
    }>(
      status
        ? `/hr-requests?status=${status}`
        : '/hr-requests'
    );
  },

  createHrRequest: async (data: {
    category?: string;
    subject: string;
    description: string;
    priority?: string;
  }): Promise<{
    success: boolean;
    request: HrRequest;
  }> => {
    return request<{
      success: boolean;
      request: HrRequest;
    }>('/hr-requests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  resolveHrRequest: async (
    id: string,
    remarks: string
  ): Promise<{
    success: boolean;
    request: HrRequest;
  }> => {
    return request<{
      success: boolean;
      request: HrRequest;
    }>(`/hr-requests/${id}/resolve`, {
      method: 'PUT',
      body: JSON.stringify({
        remarks,
      }),
    });
  },

  // =============================================================
  // FULL & FINAL SETTLEMENT
  // =============================================================

  getFullFinalSettlements: async (): Promise<{
    settlements: FullFinalSettlement[];
  }> => {
    return request<{
      settlements: FullFinalSettlement[];
    }>('/full-final');
  },

  getAssets: async (employeeId?: string): Promise<{ assets: AllocatedAsset[]; canManage: boolean }> => {
    const q = employeeId ? `?employeeId=${employeeId}` : '';
    return request<{ assets: AllocatedAsset[]; canManage: boolean }>(`/assets${q}`);
  },

  allocateAsset: async (data: any): Promise<{ success: boolean; asset: AllocatedAsset }> => {
    return request<{ success: boolean; asset: AllocatedAsset }>('/assets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  returnAsset: async (id: string): Promise<{ success: boolean; asset: AllocatedAsset }> => {
    return request<{ success: boolean; asset: AllocatedAsset }>(`/assets/${id}/return`, {
      method: 'PUT',
    });
  },

  getInsurancePolicy: async (): Promise<{ policy: InsurancePolicy }> => {
    return request<{ policy: InsurancePolicy }>('/insurance/policy');
  },

  getInsuranceEnrollment: async (employeeId?: string): Promise<{ enrollment: InsuranceEnrollment | null }> => {
    const q = employeeId ? `?employeeId=${employeeId}` : '';
    return request<{ enrollment: InsuranceEnrollment | null }>(`/insurance/enrollment${q}`);
  },

  enrollInsurance: async (data: { employeeId?: string; sumInsured?: number; dependents?: any[]; status?: string }): Promise<{ success: boolean; enrollment: InsuranceEnrollment }> => {
    return request<{ success: boolean; enrollment: InsuranceEnrollment }>('/insurance/enroll', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getInsuranceClaims: async (params?: { status?: string; employeeId?: string }): Promise<{ claims: InsuranceClaim[] }> => {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.employeeId) query.append('employeeId', params.employeeId);
    return request<{ claims: InsuranceClaim[] }>(`/insurance/claims?${query.toString()}`);
  },

  submitInsuranceClaim: async (data: any): Promise<{ success: boolean; claim: InsuranceClaim }> => {
    return request<{ success: boolean; claim: InsuranceClaim }>('/insurance/claims', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateInsuranceClaimStatus: async (id: string, status: string, tpaRemarks?: string, amountApproved?: number): Promise<{ success: boolean; claim: InsuranceClaim }> => {
    return request<{ success: boolean; claim: InsuranceClaim }>(`/insurance/claims/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, tpaRemarks, amountApproved }),
    });
  },

  getForm24QData: async (): Promise<{ success: boolean; data: Form24QData }> => {
    return request<{ success: boolean; data: Form24QData }>('/tax/form24q');
  },

  updateForm24QStatus: async (status: 'Draft' | 'Filed' | 'Acknowledged', acknowledgementNumber?: string): Promise<{ success: boolean; form24q: Form24QData }> => {
    return request<{ success: boolean; form24q: Form24QData }>('/tax/form24q/status', {
      method: 'PUT',
      body: JSON.stringify({ status, acknowledgementNumber }),
    });
  },

  updateForm24QSummary: async (summary: any): Promise<{ success: boolean; form24q: Form24QData }> => {
    return request<{ success: boolean; form24q: Form24QData }>('/tax/form24q/summary', {
      method: 'PUT',
      body: JSON.stringify(summary),
    });
  },

  validateForm24Q: async (): Promise<{ success: boolean; validation: { isValid: boolean; totalEmployeeTds: number; totalChallanDeposited: number; totalDeductees: number; challanCount: number; discrepancy: number; messages: string[] } }> => {
    return request('/tax/form24q/validate', {
      method: 'POST',
    });
  },

  getForm24QDataQ1: async (): Promise<{ success: boolean; data: Form24QData }> => {
    return request<{ success: boolean; data: Form24QData }>('/tax/form24q/q1');
  },

  getNewEmployeesQ1: async (): Promise<{ success: boolean; newEmployees: any[]; count: number; instruction: string }> => {
    return request('/tax/form24q/new-employees');
  },

  addEmployeeToQ1: async (emp: any): Promise<{ success: boolean; data: Form24QData }> => {
    return request('/tax/form24q/q1/employees', {
      method: 'POST',
      body: JSON.stringify(emp),
    });
  },

  compareTdsQuarters: async (): Promise<{ success: boolean; comparisons: any[]; anomaliesCount: number; anomalies: any[]; message: string }> => {
    return request('/tax/form24q/comparison');
  },

  getEmployeeFullYearHistory: async (pan: string): Promise<{ success: boolean; history: any }> => {
    return request(`/tax/employee-history/${pan}`);
  },

  getProjectedAnnualTds: async (pan: string): Promise<{ success: boolean; projection: any }> => {
    return request(`/tax/projected-tds/${pan}`);
  },

  uploadPolicy: async (formData: FormData): Promise<{ success: boolean; policy: any }> => {
    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    const res = await fetch('/api/policies', {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to upload policy');
    }
    return res.json();
  },
};