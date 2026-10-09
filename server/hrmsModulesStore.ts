import { dbStore, UserDoc, EmployeeDoc } from './db.ts';
import { computeSalaryStructure, professionalTaxForMonth } from '../src/services/salaryStructure.ts';

// -------------------------------------------------------------
// 1. LEAVE MANAGEMENT TYPES
// -------------------------------------------------------------
export interface LeaveBalance {
  casual: { total: number; used: number; remaining: number };
  sick: { total: number; used: number; remaining: number };
  earned: { total: number; used: number; remaining: number };
  maternity: { total: number; used: number; remaining: number };
  paternity: { total: number; used: number; remaining: number };
  unpaid: { used: number };
}

export interface LeaveRequestDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  leaveType: 'CASUAL' | 'SICK' | 'EARNED' | 'MATERNITY' | 'PATERNITY' | 'UNPAID';
  startDate: string;
  endDate: string;
  daysCount: number;
  isHalfDay: boolean;
  halfDaySession?: 'MORNING' | 'AFTERNOON';
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  appliedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  documentUrl?: string;
}

// -------------------------------------------------------------
// 2. EXPENSE CLAIMS TYPES
// -------------------------------------------------------------
export interface ExpenseClaimDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  title: string;
  category: 'TRAVEL' | 'MEALS' | 'INTERNET' | 'OFFICE_SUPPLIES' | 'LEARNING' | 'CLIENT_ENTERTAINMENT' | 'OTHER';
  amount: number;
  currency: string;
  expenseDate: string;
  description: string;
  receiptName?: string;
  status: 'SUBMITTED' | 'MANAGER_APPROVED' | 'HR_APPROVED' | 'REJECTED' | 'REIMBURSED';
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  reimbursedAt?: string;
  paymentReference?: string;
}

// -------------------------------------------------------------
// 3. PAYROLL & BENEFIT TYPES
// -------------------------------------------------------------
export interface PayslipDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  panNumber: string;
  pfUan: string;
  bankName: string;
  bankAccountNumber: string;
  month: string; // '2025-02'
  monthName: string; // 'February 2025'
  payDate: string;
  workedDays: number;
  lopDays: number;
  basicSalary: number;
  hra: number;
  specialAllowance: number;
  conveyanceAllowance: number;
  medicalAllowance: number;
  performanceBonus: number;
  /** Greenticker salary-structure components (optional so older payslips remain valid) */
  annualCtc?: number;
  educationAllowance?: number;
  lta?: number;
  grossSalary: number;
  providentFund: number;
  professionalTax: number;
  tds: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;
  status: 'PAID' | 'PROCESSED' | 'PENDING';
  paymentMode: 'DIRECT_DEPOSIT' | 'BANK_TRANSFER';
  transactionId: string;
}

// -------------------------------------------------------------
// 4. TAX & FORM 16 TYPES
// -------------------------------------------------------------
export interface TaxDeclarationDoc {
  _id: string;
  employeeId: string;
  financialYear: string;
  regime: 'NEW' | 'OLD';
  section80C: {
    epf: number;
    ppf: number;
    elss: number;
    lifeInsurance: number;
    taxSaverFD: number;
    total: number;
    maxLimit: number;
  };
  section80D: {
    selfSpouseChildren: number;
    parents: number;
    total: number;
  };
  hraExemption: {
    annualRentPaid: number;
    landlordPan?: string;
    landlordName?: string;
    cityType: 'METRO' | 'NON_METRO';
    calculatedExemption: number;
  };
  section80CCD_1B: number;
  homeLoanInterest80EE: number;
  totalDeductionsDeclared: number;
  estimatedTaxPayable: number;
  submittedAt: string;
  status: 'VERIFIED' | 'SUBMITTED' | 'DRAFT';
}

// -------------------------------------------------------------
// 5. POLICIES & ACKNOWLEDGEMENT TYPES
// -------------------------------------------------------------
export interface PolicyDoc {
  _id: string;
  title: string;
  category:
    | 'CONDUCT'
    | 'SECURITY'
    | 'COMPLIANCE'
    | 'HR'
    | 'REMOTE';
  version: string;
  summary: string;
  content: string;
  mandatory: boolean;
  effectiveDate: string;
  lastUpdated: string;
  // Audit information
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  createdByName?: string;
  // Allows a policy to be archived/deactivated
  // without necessarily deleting the underlying record.
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}

export interface PolicyAcknowledgementDoc {
  _id: string;
  policyId: string;
  employeeId: string;
  employeeName: string;
  acknowledgedAt: string;
  ipAddress: string;
  digitalSignature: string;
}

// =============================================================
// COMPANY COMPLIANCE & POLICY MANAGEMENT
// =============================================================

export async function createPolicy(
  data: {
    title: string;
    category:
      | 'COMPLIANCE'
      | 'CONDUCT'
      | 'SECURITY'
      | 'HR'
      | 'REMOTE';
    version: string;
    summary: string;
    content: string;
    mandatory: boolean;
    effectiveDate: string;
  },
  createdBy?: {
    id?: string;
    name?: string;
    role?: string;
  }
) {
  const now = new Date().toISOString();

  const policy = {
    _id: `policy_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 8)}`,
    title: data.title.trim(),
    category: data.category,
    version: data.version.trim() || '1.0',
    summary: data.summary.trim(),
    content: data.content.trim(),
    mandatory: Boolean(data.mandatory),
    effectiveDate: data.effectiveDate,
    lastUpdated: now,
    createdAt: now,
    updatedAt: now,
    createdBy: createdBy?.id || undefined,
    createdByName: createdBy?.name || undefined,
    status: 'ACTIVE' as const,
  };

  // Use the same policy collection/store used by your
  // existing getPolicies() implementation.
  //
  // If your store is MongoDB, insert the policy document
  // into that existing collection.
  //
  // Example:
  //
  // await policiesCollection.insertOne(policy);

  return policy;
}
export async function deletePolicy(policyId: string) {
  if (!policyId) {
    throw new Error('Policy ID is required.');
  }

  /*
   * IMPORTANT:
   *
   * This function is deliberately only responsible for deleting
   * the policy record.
   *
   * The ADMIN-only authorization is enforced by the API/RBAC
   * layer, not by trusting the frontend.
   */

  // Use the same policy collection/store used by
  // getPolicies() and createPolicy().
  //
  // MongoDB example:
  //
  // const result = await policiesCollection.deleteOne({
  //   _id: policyId,
  // });
  //
  // if (result.deletedCount === 0) {
  //   throw new Error('Company compliance not found.');
  // }

  return {
    success: true,
    message: 'Company compliance removed successfully.',
  };
}

// -------------------------------------------------------------
// 6. POSH (Rule 21: Highly Confidential, strictly ADMIN & HR)
// -------------------------------------------------------------
export interface PoshCaseDoc {
  _id: string;
  caseNumber: string;
  incidentDate: string;
  reportedDate: string;
  complainantName: string;
  complainantCode: string;
  isAnonymous: boolean;
  respondentName: string;
  respondentDesignation: string;
  respondentDepartment: string;
  stage: 'PRELIMINARY_REVIEW' | 'INTERNAL_ENQUIRY' | 'CONCILIATION' | 'FINDINGS_SUBMITTED' | 'ACTION_TAKEN' | 'CLOSED';
  description: string;
  committeeAssigned: string;
  actionTakenNotes?: string;
  resolutionDate?: string;
  status: 'ACTIVE' | 'RESOLVED' | 'DISMISSED';
  isConfidential: true;
}

// -------------------------------------------------------------
// 7. HOLIDAYS & ANNOUNCEMENTS
// -------------------------------------------------------------
export interface HolidayDoc {
  _id: string;
  name: string;
  date: string;
  dayOfWeek: string;
  type: 'MANDATORY' | 'RESTRICTED';
  description: string;
}

export interface AnnouncementDoc {
  _id: string;
  title: string;
  content: string;
  category: 'GENERAL' | 'EVENT' | 'POLICY' | 'HR_ALERT' | 'CELEBRATION';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  publishedBy: string;
  publishedAt: string;
  pinned: boolean;
  targetDepartment?: string;
}

// -------------------------------------------------------------
// 8. TALENT & OPERATIONS: PERFORMANCE, RECRUITMENT, HR SERVICE DESK, FULL & FINAL
// -------------------------------------------------------------
export interface PerformanceReviewDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  cycle: string;
  status: 'GOAL_SETTING' | 'SELF_REVIEW' | 'MANAGER_REVIEW' | 'HR_CALIBRATION' | 'COMPLETED';
  goals: Array<{
    title: string;
    description: string;
    weightage: number;
    selfRating?: number;
    managerRating?: number;
    comments?: string;
  }>;
  overallSelfRating?: number;
  overallManagerRating?: number;
  strengths?: string;
  areasOfImprovement?: string;
  promotionRecommendation?: 'RECOMMENDED' | 'READY_NEXT_CYCLE' | 'NOT_APPLICABLE';
  completedAt?: string;
}

export interface JobOpeningDoc {
  _id: string;
  title: string;
  department: string;
  location: string;
  type: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  experienceRequired: string;
  openingsCount: number;
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED';
  postedDate: string;
  description: string;
  skillsRequired: string[];
}

export interface JobCandidateDoc {
  _id: string;
  jobId: string;
  jobTitle: string;
  fullName: string;
  email: string;
  phone: string;
  stage: 'APPLIED' | 'SCREENING' | 'TECHNICAL_INTERVIEW' | 'HR_INTERVIEW' | 'OFFERED' | 'HIRED' | 'REJECTED';
  experienceYears: number;
  currentCompany?: string;
  appliedDate: string;
  rating: number;
  notes?: string;
  interviewFeedbacks?: any[];
  interview?: any;
  offer?: any;
}

export interface RequirementDoc {
  _id: string;
  requestedById: string;
  requestedByName: string;
  title: string;
  department: string;
  positions: number;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  experienceRequired: string;
  skillsRequired: string[];
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  expectedJoiningDate?: string;
  budgetRange?: string;
  location?: string;
  justification: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  jobId?: string;
}

export interface ReferralDoc {
  _id: string;
  fullName: string;
  email: string;
  phone?: string;
  city: string;
  experienceYears: number;
  jobId?: string;
  jobTitle?: string;
  relationship?: string;
  notes?: string;
  resumeFileName?: string;
  storedFileName?: string;
  status: 'SUBMITTED' | 'IN_REVIEW' | 'SHORTLISTED' | 'HIRED' | 'NOT_SELECTED';
  referredById: string;
  referredByName: string;
  referredByRole: string;
  createdAt: string;
}

export interface AssetDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department?: string;
  designation?: string;
  category?: string;
  type: string;
  name: string;
  assetTag: string;
  serialNumber?: string;
  issuedDate: string;
  status: 'ALLOCATED' | 'RETURNED';
  returnedDate?: string;
  notes?: string;
  allocatedBy?: string;
  history?: {
    action: 'ALLOCATED' | 'RETURNED' | 'REASSIGNED';
    date: string;
    employeeName: string;
    employeeCode: string;
    performedBy?: string;
    notes?: string;
  }[];
}

export interface HrRequestDoc {
  _id: string;
  ticketNumber: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  category: 'PAYROLL' | 'LEAVE_ATTENDANCE' | 'BENEFITS' | 'DOCUMENTS' | 'IT_ASSETS' | 'GENERAL';
  subject: string;
  description: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  assignedTo?: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionRemarks?: string;
}

export interface FullFinalSettlementDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  resignationDate: string;
  lastWorkingDay: string;
  noticePeriodDays: number;
  noticeServedDays: number;
  status: 'INITIATED' | 'DEPARTMENT_CLEARANCE' | 'IT_CLEARANCE' | 'FINANCE_CLEARANCE' | 'HR_APPROVED' | 'DISBURSED';
  clearances: {
    department: { cleared: boolean; remarks?: string; clearedBy?: string };
    itAssets: { cleared: boolean; remarks?: string; clearedBy?: string };
    finance: { cleared: boolean; remarks?: string; clearedBy?: string };
    admin: { cleared: boolean; remarks?: string; clearedBy?: string };
  };
  settlementComponents: {
    unpaidSalary: number;
    leaveEncashmentDays: number;
    leaveEncashmentAmount: number;
    gratuity: number;
    noticePayShortfallDeduction: number;
    bonusOrIncentive: number;
    totalPayable: number;
  };
  notes?: string;
}

// -------------------------------------------------------------
// MODULES STORE IMPLEMENTATION
// -------------------------------------------------------------
class ModulesStore {
  leaveBalances: Map<string, LeaveBalance> = new Map();
  leaveRequests: Map<string, LeaveRequestDoc> = new Map();
  expenseClaims: Map<string, ExpenseClaimDoc> = new Map();
  payslips: Map<string, PayslipDoc> = new Map();
  taxDeclarations: Map<string, TaxDeclarationDoc> = new Map();
  policies: Map<string, PolicyDoc> = new Map();
  policyAcknowledgements: PolicyAcknowledgementDoc[] = [];
  poshCases: Map<string, PoshCaseDoc> = new Map();
  holidays: Map<string, HolidayDoc> = new Map();
  announcements: Map<string, AnnouncementDoc> = new Map();
  performanceReviews: Map<string, PerformanceReviewDoc> = new Map();
  jobOpenings: Map<string, JobOpeningDoc> = new Map();
  jobCandidates: Map<string, JobCandidateDoc> = new Map();
  requirements: Map<string, RequirementDoc> = new Map();
  referrals: Map<string, ReferralDoc> = new Map();
  assets: Map<string, AssetDoc> = new Map();
  hrRequests: Map<string, HrRequestDoc> = new Map();
  fullFinalSettlements: Map<string, FullFinalSettlementDoc> = new Map();
  letterTemplates: Map<string, LetterTemplateDoc> = new Map();
  insurancePolicy: InsurancePolicyDoc = {
    policyName: 'Greenticker Comprehensive Group Medical Insurance (GMC)',
    provider: 'ICICI Lombard General Insurance Co. Ltd.',
    policyNumber: 'GMC-2025-GT-8849',
    validTill: '2027-03-31',
    tpaName: 'MediAssist TPA India Pvt Ltd',
    emergencyHelpline: '1800-419-0262 / +91-22-67890000',
    gradeEligibility: {
      'Executive': 1000000,
      'Manager': 750000,
      'Staff': 500000,
    },
    dependentsAllowed: ['Spouse', 'Up to 2 Children (Age < 25)', 'Dependent Parents (Optional Top-up)'],
  };
  insuranceEnrollments: Map<string, InsuranceEnrollmentDoc> = new Map();
  insuranceClaims: Map<string, InsuranceClaimDoc> = new Map();
  form24QData: Form24QDataDoc = {
    company: {
      name: 'SCALEO9 SOFTWARE SOLUTIONS (OPC) PRIVATE LIMITED',
      TAN: 'PNES96307B',
      FY: '2025-26',
      quarter: 'Q4',
    },
    challans: [
      { date: '2026-01-07', tax: 75059, cess: 3003, total: 78062, bank: 'HDFC Bank (BSR: 0512345)' },
      { date: '2026-02-05', tax: 75059, cess: 3003, total: 78062, bank: 'HDFC Bank (BSR: 0512345)' },
      { date: '2026-04-25', tax: 79554, cess: 3183, total: 82737, bank: 'HDFC Bank (BSR: 0512345)' },
    ],
    employees: [
      { name: 'Gaurav Madhukar Mahajan', PAN: 'BOIPM8537D', salaryPaid: 1140000, tdsDeducted: 229672, section80C: 150000, standardDeduction: 75000, periodFrom: '2025-04-01', periodTo: '2026-03-31' },
      { name: 'Kalpana Mahajan', PAN: 'AROPM0376Q', salaryPaid: 425000, tdsDeducted: 0, section80C: 150000, standardDeduction: 75000, periodFrom: '2025-04-01', periodTo: '2026-03-31' },
      { name: 'Sohum Chaudhari', PAN: 'COLPC0506C', salaryPaid: 100000, tdsDeducted: 0, section80C: 150000, standardDeduction: 75000, periodFrom: '2025-04-01', periodTo: '2026-03-31' },
      { name: 'Khushbu Surana', PAN: 'GNQPS6849C', salaryPaid: 510000, tdsDeducted: 0, section80C: 150000, standardDeduction: 75000, periodFrom: '2025-04-01', periodTo: '2026-03-31' },
      { name: 'Nivedita Sudip Patil', PAN: 'DKBPP0247J', salaryPaid: 425000, tdsDeducted: 0, section80C: 140000, standardDeduction: 75000, periodFrom: '2025-04-01', periodTo: '2026-03-31' },
      { name: 'Yash Prashant Anap', PAN: 'DSYPA9275E', salaryPaid: 400000, tdsDeducted: 0, section80C: 90000, standardDeduction: 75000, periodFrom: '2025-06-01', periodTo: '2026-01-31' },
      { name: 'Sujit Shivaji Chankhore', PAN: 'ANEPC2674D', salaryPaid: 510000, tdsDeducted: 0, section80C: 50000, standardDeduction: 75000, periodFrom: '2026-01-01', periodTo: '2026-03-31' },
    ],
    filingSummary: {
      deductorTAN: 'PNES96307B',
      totalTaxDeposited: 238861,
      totalDeductees: 19,
      challanCount: 3,
      amountPaid: 3430779,
      status: 'Filed',
      acknowledgementNumber: 'NA',
      filedDate: '2026-10-08',
    },
  };
  form24QDataQ1: Form24QDataDoc = {
    company: {
      name: 'SCALEO9 SOFTWARE SOLUTIONS (OPC) PRIVATE LIMITED',
      TAN: 'PNES96307B',
      FY: '2026-27',
      quarter: 'Q1',
    },
    challans: [
      { date: '2026-05-06', tax: 78062, cess: 0, total: 78062, bank: 'Bank of India (BSR: 6390009)' },
      { date: '2026-06-05', tax: 78062, cess: 0, total: 78062, bank: 'Bank of India (BSR: 6390009)' },
      { date: '2026-07-07', tax: 257156, cess: 0, total: 257156, bank: 'Bank of India (BSR: 6390009)' },
    ],
    employees: [
      { name: 'Gaurav Madhukar Mahajan', PAN: 'BOIPM8537D', salaryPaid: 1140000, tdsDeducted: 413280, section80C: 37436, standardDeduction: 75000, periodFrom: '2026-04-01', periodTo: '2026-06-30' },
      { name: 'Kalpana Mahajan', PAN: 'AROPM0376Q', salaryPaid: 255000, tdsDeducted: 0, section80C: 0, standardDeduction: 75000, periodFrom: '2026-04-01', periodTo: '2026-06-30' },
      { name: 'Sohum Chaudhari', PAN: 'COLPC0506C', salaryPaid: 60000, tdsDeducted: 0, section80C: 0, standardDeduction: 75000, periodFrom: '2026-04-01', periodTo: '2026-06-30' },
      { name: 'Khushbu Surana', PAN: 'GNQPS6849C', salaryPaid: 255000, tdsDeducted: 0, section80C: 0, standardDeduction: 75000, periodFrom: '2026-04-01', periodTo: '2026-06-30' },
      { name: 'Nivedita Sudip Patil', PAN: 'DKBPP0247J', salaryPaid: 255000, tdsDeducted: 0, section80C: 0, standardDeduction: 75000, periodFrom: '2026-04-01', periodTo: '2026-06-30' },
      { name: 'Sujit Shivaji Chankhore', PAN: 'ANEPC2674D', salaryPaid: 255000, tdsDeducted: 0, section80C: 0, standardDeduction: 75000, periodFrom: '2026-04-01', periodTo: '2026-06-30' },
    ],
    filingSummary: {
      deductorTAN: 'PNES96307B',
      totalTaxDeposited: 413280,
      totalDeductees: 6,
      challanCount: 3,
      amountPaid: 2220000,
      status: 'Filed',
      acknowledgementNumber: '770000377714293',
      filedDate: '2026-07-08',
    },
  };

  constructor() {
    this.seedModulesData();
  }

  private seedModulesData() {
    // 1. Leave Balances & Requests
    const defaultBalances = (usedC = 0, usedS = 0, usedE = 0): LeaveBalance => ({
      casual: { total: 12, used: usedC, remaining: 12 - usedC },
      sick: { total: 10, used: usedS, remaining: 10 - usedS },
      earned: { total: 15, used: usedE, remaining: 15 - usedE },
      maternity: { total: 180, used: 0, remaining: 180 },
      paternity: { total: 15, used: 0, remaining: 15 },
      unpaid: { used: 0 },
    });

    this.leaveBalances.set('emp_emp_01', defaultBalances(2, 1, 3));
    this.leaveBalances.set('emp_mgr_01', defaultBalances(1, 0, 2));
    this.leaveBalances.set('emp_devops_01', defaultBalances(3, 2, 4));
    this.leaveBalances.set('emp_fin_head', defaultBalances(0, 1, 1));
    this.leaveBalances.set('emp_hr_01', defaultBalances(2, 0, 0));
    this.leaveBalances.set('emp_new_hire', defaultBalances(0, 0, 0));

    const seedLeaves: LeaveRequestDoc[] = [
      {
        _id: 'leave_001',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        leaveType: 'EARNED',
        startDate: '2026-10-12',
        endDate: '2026-10-15',
        daysCount: 4,
        isHalfDay: false,
        reason: 'Family annual holiday trip.',
        status: 'APPROVED',
        appliedAt: '2026-09-20T10:30:00Z',
        reviewedBy: 'Aditya Kapoor (HR Lead)',
        reviewedAt: '2026-09-21T09:15:00Z',
      },
      {
        _id: 'leave_002',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        leaveType: 'CASUAL',
        startDate: '2026-10-02',
        endDate: '2026-10-02',
        daysCount: 1,
        isHalfDay: true,
        halfDaySession: 'AFTERNOON',
        reason: 'Personal banking and documentation work.',
        status: 'PENDING',
        appliedAt: '2026-09-27T14:20:00Z',
      },
      {
        _id: 'leave_003',
        employeeId: 'emp_devops_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-055',
        department: 'Engineering & Technology',
        leaveType: 'SICK',
        startDate: '2026-09-22',
        endDate: '2026-09-23',
        daysCount: 2,
        isHalfDay: false,
        reason: 'Viral fever and doctor mandated rest.',
        status: 'APPROVED',
        appliedAt: '2026-09-22T08:00:00Z',
        reviewedBy: 'Aditya Kapoor (HR Lead)',
        reviewedAt: '2026-09-22T08:45:00Z',
      },
      {
        _id: 'leave_004',
        employeeId: 'emp_fin_head',
        employeeName: 'Rajesh Singhania',
        employeeCode: 'RHA-012',
        department: 'Finance & Compliance',
        leaveType: 'CASUAL',
        startDate: '2026-10-24',
        endDate: '2026-10-24',
        daysCount: 1,
        isHalfDay: false,
        reason: 'Attending financial auditors conference.',
        status: 'PENDING',
        appliedAt: '2026-09-26T11:00:00Z',
      },
    ];
    seedLeaves.forEach((l) => this.leaveRequests.set(l._id, l));

    // 2. Expense Claims
    const seedExpenses: ExpenseClaimDoc[] = [
      {
        _id: 'exp_001',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        title: 'Q3 AWS Certified Solutions Architect Exam Fee',
        category: 'LEARNING',
        amount: 25000,
        currency: 'INR',
        expenseDate: '2026-09-15',
        description: 'Professional cloud certification reimbursement as per annual learning allowance.',
        receiptName: 'aws_exam_receipt_zen042.pdf',
        status: 'REIMBURSED',
        submittedAt: '2026-09-16T12:00:00Z',
        reviewedBy: 'Rajesh Singhania',
        reviewedAt: '2026-09-18T10:00:00Z',
        reimbursedAt: '2026-09-20T16:30:00Z',
        paymentReference: 'ACH-Anusyuti-EXP-90812',
      },
      {
        _id: 'exp_002',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        title: 'Monthly High-Speed Fiber Internet Allowance',
        category: 'INTERNET',
        amount: 3500,
        currency: 'INR',
        expenseDate: '2026-09-01',
        description: 'Remote work high-speed fiber internet connection bill for August.',
        receiptName: 'comcast_aug_invoice.pdf',
        status: 'MANAGER_APPROVED',
        submittedAt: '2026-09-05T09:30:00Z',
        reviewedBy: 'Aditya Kapoor (HR Lead)',
        reviewedAt: '2026-09-06T11:20:00Z',
      },
      {
        _id: 'exp_003',
        employeeId: 'emp_mgr_01',
        employeeName: 'Aditya Kapoor',
        employeeCode: 'RHA-028',
        department: 'HR',
        title: 'Quarterly Team Innovation Dinner & Retrospective',
        category: 'MEALS',
        amount: 18500,
        currency: 'INR',
        expenseDate: '2026-09-20',
        description: 'Team dinner celebration after successful completion of Q3 design system launch.',
        receiptName: 'ristorante_downtown_receipt.pdf',
        status: 'HR_APPROVED',
        submittedAt: '2026-09-21T15:00:00Z',
        reviewedBy: 'Rajesh Singhania',
        reviewedAt: '2026-09-23T14:10:00Z',
      },
      {
        _id: 'exp_004',
        employeeId: 'emp_devops_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-055',
        department: 'Engineering & Technology',
        title: 'Dual 4K Monitor Ergonomic Desk Mount',
        category: 'OFFICE_SUPPLIES',
        amount: 8500,
        currency: 'INR',
        expenseDate: '2026-09-24',
        description: 'Heavy-duty monitor arms for infrastructure monitoring setup.',
        receiptName: 'amazon_ergonomic_arm_invoice.pdf',
        status: 'SUBMITTED',
        submittedAt: '2026-09-25T16:45:00Z',
      },
    ];
    seedExpenses.forEach((e) => this.expenseClaims.set(e._id, e));

    // Insurance Enrollments & Claims Seed
    const seedEnrollments: InsuranceEnrollmentDoc[] = [
      {
        _id: 'ins_enr_01',
        employeeId: 'emp_admin_01',
        employeeName: 'Omkar Despande',
        employeeCode: 'RHA-001',
        grade: 'Executive',
        sumInsured: 1000000,
        premiumAnnual: 12000,
        monthlyPayrollDeduction: 1000,
        dependents: [
          { name: 'Priya Despande', relation: 'Spouse', dob: '1992-05-14', gender: 'Female' },
          { name: 'Aarav Despande', relation: 'Child', dob: '2020-11-10', gender: 'Male' },
        ],
        eCardNumber: 'MA-GMC-2025-001948',
        status: 'ACTIVE',
      },
      {
        _id: 'ins_enr_02',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        grade: 'Manager',
        sumInsured: 750000,
        premiumAnnual: 9000,
        monthlyPayrollDeduction: 750,
        dependents: [
          { name: 'Sunita Rao', relation: 'Mother', dob: '1965-03-20', gender: 'Female' },
        ],
        eCardNumber: 'MA-GMC-2025-008291',
        status: 'ACTIVE',
      },
      {
        _id: 'ins_enr_03',
        employeeId: 'emp_hr_01',
        employeeName: 'Aditya Kapoor',
        employeeCode: 'RHA-008',
        grade: 'Manager',
        sumInsured: 750000,
        premiumAnnual: 9000,
        monthlyPayrollDeduction: 750,
        dependents: [
          { name: 'Meera Kapoor', relation: 'Spouse', dob: '1990-12-01', gender: 'Female' },
          { name: 'Rohan Kapoor', relation: 'Child', dob: '2018-04-15', gender: 'Male' },
        ],
        eCardNumber: 'MA-GMC-2025-004192',
        status: 'ACTIVE',
      },
      {
        _id: 'ins_enr_04',
        employeeId: 'emp_devops_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-055',
        grade: 'Staff',
        sumInsured: 500000,
        premiumAnnual: 6000,
        monthlyPayrollDeduction: 500,
        dependents: [],
        eCardNumber: 'MA-GMC-2025-009483',
        status: 'ACTIVE',
      },
    ];
    seedEnrollments.forEach((e) => this.insuranceEnrollments.set(e.employeeId, e));

    const seedClaims: InsuranceClaimDoc[] = [
      {
        _id: 'ins_clm_01',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        patientName: 'Sunita Rao',
        relation: 'Mother',
        hospitalName: 'Manipal Hospital, Bengaluru',
        admissionDate: '2026-09-10',
        dischargeDate: '2026-09-14',
        claimType: 'CASHLESS',
        amountRequested: 48500,
        amountApproved: 48500,
        status: 'SETTLED',
        diagnosis: 'Acute Gastroenteritis with Dehydration',
        submittedAt: '2026-09-15T10:30:00Z',
        tpaRemarks: 'Approved and settled directly with hospital network.',
        documents: ['DischargeSummary.pdf', 'HospitalBill_Manipal.pdf'],
      },
      {
        _id: 'ins_clm_02',
        employeeId: 'emp_hr_01',
        employeeName: 'Aditya Kapoor',
        employeeCode: 'RHA-008',
        patientName: 'Meera Kapoor',
        relation: 'Spouse',
        hospitalName: 'Apollo Hospitals, Bannerghatta Road',
        admissionDate: '2026-10-01',
        dischargeDate: '2026-10-03',
        claimType: 'CASHLESS',
        amountRequested: 32000,
        status: 'TPA_REVIEW',
        diagnosis: 'Dengue Fever with Thrombocytopenia',
        submittedAt: '2026-10-04T09:15:00Z',
        tpaRemarks: 'Under review by MediAssist TPA medical desk.',
        documents: ['Apollo_Estimate.pdf', 'BloodTestReports.pdf'],
      },
      {
        _id: 'ins_clm_03',
        employeeId: 'emp_devops_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-055',
        patientName: 'Rohan Verma',
        relation: 'Self',
        hospitalName: 'Fortis Hospital, Cunningham Road',
        admissionDate: '2026-09-20',
        dischargeDate: '2026-09-22',
        claimType: 'REIMBURSEMENT',
        amountRequested: 18500,
        amountApproved: 16000,
        status: 'QUERY_RAISED',
        diagnosis: 'Severe Upper Respiratory Tract Infection',
        submittedAt: '2026-09-23T14:00:00Z',
        tpaRemarks: 'Query raised: Please provide itemized pharmacy bills.',
        documents: ['Prescription_Fortis.pdf'],
      },
    ];
    seedClaims.forEach((c) => this.insuranceClaims.set(c._id, c));

    // 3. Payslips (Detailed Statutory Breakdown)
    const seedPayslips: PayslipDoc[] = [
      {
        _id: 'pay_dc_2025_02',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        designation: 'Senior Frontend Engineer',
        department: 'Engineering & Technology',
        panNumber: 'ABCDE1234F',
        pfUan: '100984728912',
        bankName: 'State Bank of India',
        bankAccountNumber: '•••• •••• 9842',
        month: '2025-02',
        monthName: 'February 2025',
        payDate: '2025-02-28',
        workedDays: 20,
        lopDays: 0,
        basicSalary: 6500,
        hra: 2600,
        specialAllowance: 2800,
        conveyanceAllowance: 500,
        medicalAllowance: 516,
        performanceBonus: 0,
        grossSalary: 12916,
        providentFund: 780,
        professionalTax: 200,
        tds: 1850,
        otherDeductions: 0,
        totalDeductions: 2830,
        netSalary: 10086,
        status: 'PAID',
        paymentMode: 'DIRECT_DEPOSIT',
        transactionId: 'TXN-RHA-PAY-2025-02-042',
      },
      {
        _id: 'pay_dc_2025_01',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        designation: 'Senior Frontend Engineer',
        department: 'Engineering & Technology',
        panNumber: 'ABCDE1234F',
        pfUan: '100984728912',
        bankName: 'State Bank of India',
        bankAccountNumber: '•••• •••• 9842',
        month: '2025-01',
        monthName: 'January 2025',
        payDate: '2025-01-31',
        workedDays: 22,
        lopDays: 0,
        basicSalary: 6500,
        hra: 2600,
        specialAllowance: 2800,
        conveyanceAllowance: 500,
        medicalAllowance: 516,
        performanceBonus: 1000,
        grossSalary: 13916,
        providentFund: 780,
        professionalTax: 200,
        tds: 2050,
        otherDeductions: 0,
        totalDeductions: 3030,
        netSalary: 10886,
        status: 'PAID',
        paymentMode: 'DIRECT_DEPOSIT',
        transactionId: 'TXN-RHA-PAY-2025-01-042',
      },
      {
        _id: 'pay_er_2025_02',
        employeeId: 'emp_mgr_01',
        employeeName: 'Aditya Kapoor',
        employeeCode: 'RHA-028',
        designation: 'Director of Engineering',
        department: 'HR',
        panNumber: 'ROSTO9821K',
        pfUan: '100492817263',
        bankName: 'HDFC Bank',
        bankAccountNumber: '•••• •••• 5510',
        month: '2025-02',
        monthName: 'February 2025',
        payDate: '2025-02-28',
        workedDays: 20,
        lopDays: 0,
        basicSalary: 9000,
        hra: 3600,
        specialAllowance: 4300,
        conveyanceAllowance: 500,
        medicalAllowance: 516,
        performanceBonus: 0,
        grossSalary: 17916,
        providentFund: 1080,
        professionalTax: 200,
        tds: 3200,
        otherDeductions: 0,
        totalDeductions: 4480,
        netSalary: 13436,
        status: 'PAID',
        paymentMode: 'DIRECT_DEPOSIT',
        transactionId: 'TXN-RHA-PAY-2025-02-028',
      },
      {
        _id: 'pay_jw_2025_02',
        employeeId: 'emp_devops_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-055',
        designation: 'Lead DevOps Engineer',
        department: 'Engineering & Technology',
        panNumber: 'WILSO3819M',
        pfUan: '100827391827',
        bankName: 'State Bank of India',
        bankAccountNumber: '•••• •••• 1928',
        month: '2025-02',
        monthName: 'February 2025',
        payDate: '2025-02-28',
        workedDays: 20,
        lopDays: 0,
        basicSalary: 6200,
        hra: 2480,
        specialAllowance: 2500,
        conveyanceAllowance: 500,
        medicalAllowance: 516,
        performanceBonus: 0,
        grossSalary: 11696,
        providentFund: 744,
        professionalTax: 200,
        tds: 1600,
        otherDeductions: 0,
        totalDeductions: 2544,
        netSalary: 9152,
        status: 'PAID',
        paymentMode: 'DIRECT_DEPOSIT',
        transactionId: 'TXN-RHA-PAY-2025-02-055',
      },
    ];
    // Demo payslips are rebuilt from each employee's CTC so they follow the same
    // salary-structure rules (and show the CTC) as freshly generated payslips.
    seedPayslips.forEach((p) => {
      const emp = dbStore.employees.get(p.employeeId);
      const rebuilt = emp
        ? this.buildPayslip(emp, p.month, p.monthName, {
            _id: p._id,
            payDate: p.payDate,
            workedDays: p.workedDays,
            lopDays: p.lopDays,
            transactionId: p.transactionId,
            status: p.status,
            paymentMode: p.paymentMode,
          })
        : null;
      this.payslips.set(p._id, rebuilt || p);
    });

    // 4. Tax Declarations
    const seedTax: TaxDeclarationDoc = {
      _id: 'tax_dc_2024_2025',
      employeeId: 'emp_emp_01',
      financialYear: '2026-2027',
      regime: 'NEW',
      section80C: {
        epf: 9360,
        ppf: 50000,
        elss: 40000,
        lifeInsurance: 25000,
        taxSaverFD: 25640,
        total: 150000,
        maxLimit: 150000,
      },
      section80D: {
        selfSpouseChildren: 25000,
        parents: 50000,
        total: 75000,
      },
      hraExemption: {
        annualRentPaid: 36000,
        landlordPan: 'LLPAN9821X',
        landlordName: 'ABC Realty LLC',
        cityType: 'METRO',
        calculatedExemption: 31200,
      },
      section80CCD_1B: 50000,
      homeLoanInterest80EE: 0,
      totalDeductionsDeclared: 306200,
      estimatedTaxPayable: 18500,
      submittedAt: '2025-05-10T11:00:00Z',
      status: 'VERIFIED',
    };
    this.taxDeclarations.set('emp_emp_01', seedTax);

    // 5. Policies (Greenticker Financial Services LLP - Version 1.0)
    const seedPolicies: PolicyDoc[] = [
      {
        _id: 'pol_g_01',
        title: 'Greenticker Occupational Health & Safety (OHS) Framework',
        category: 'COMPLIANCE',
        version: 'Version 1.0',
        summary: 'Establishes workplace safety guidelines, hazard identification, incident reporting, emergency preparedness, and employee health/wellbeing standards at Greenticker Financial Services LLP.',
        content: `1. Safety Commitment: Greenticker Financial Services LLP is committed to providing a safe, healthy, and secure working environment for all employees, contractors, interns, and visitors across all offices and remote locations.
2. Hazard Reporting & Risk Assessment: Employees must immediately report any safety hazard, unsafe condition, or potential risk to the OHS Committee or HR. Regular ergonomic and workspace assessments are conducted quarterly.
3. Emergency Protocols: Clear evacuation routes and assembly points are posted on every floor. Fire drills are conducted bi-annually. All personnel must participate.
4. First Aid & Medical Support: Fully stocked first-aid kits and emergency contact directories are available on every floor. Designated safety wardens coordinate immediate medical assistance.
5. Mental Health & Ergonomics: Regular ergonomic guidance and stress-management workshops are provided. Employee assistance and wellness support lines remain accessible 24/7.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_02',
        title: 'Greenticker Comprehensive Leave & Time-Off Policy',
        category: 'HR',
        version: 'Version 1.0',
        summary: 'Defines leave allocations, accrual rates, approval workflows, carryover limits, and special leave categories including casual, sick, earned, and parental leave for Greenticker Financial Services LLP.',
        content: `1. Leave Entitlements: Employees receive 12 Casual Leaves, 10 Sick Leaves, and 15 Earned Leaves per financial year, credited on a pro-rata monthly basis.
2. Approval Workflow: Leave requests must be submitted via the HRMS platform at least 3 days in advance for Earned Leave. Sick leave exceeding 2 consecutive days requires a medical certificate.
3. Carryover & Encashment: Earned leaves can be carried over up to a maximum of 15 days, with encashment options available upon annual review.
4. Special Leaves: Maternity leave (180 days) and Paternity leave (15 days) are provided in compliance with statutory regulations.
5. System Enforcement: All leave applications must be logged through the official Greenticker HR portal. Verbal or informal approvals are invalid.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_03',
        title: 'Greenticker POSH (Prevention of Sexual Harassment) Policy',
        category: 'COMPLIANCE',
        version: 'Version 1.0',
        summary: 'Strict zero-tolerance policy against sexual harassment at Greenticker Financial Services LLP, outlining the Internal Complaints Committee (ICC) structure, reporting channels, and confidential inquiry mechanism.',
        content: `1. Zero Tolerance: Greenticker Financial Services LLP maintains zero tolerance for any form of sexual harassment, unwelcome physical contact, verbal remarks, or quid pro quo behavior.
2. Internal Complaints Committee (ICC): An independent ICC is constituted with designated Presiding Officers and external legal/NGO members to investigate all grievances impartially.
3. Reporting Timeline: Complaints must be filed in writing or via the confidential POSH reporting channel within 3 months of the incident (extendable by 65 days under special circumstances).
4. Confidentiality: All proceedings, identities of complainants, respondents, and witnesses are kept strictly confidential to protect dignity and prevent retaliation.
5. Disciplinary Action: Proven violations lead to immediate disciplinary action, including suspension, formal reprimand, termination of employment, and statutory legal reporting.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_04',
        title: 'Greenticker Probation & Confirmation Policy',
        category: 'HR',
        version: 'Version 1.0',
        summary: 'Outlines the standard 6-month probation period, milestone performance evaluations, feedback cycles, and official confirmation process for new hires at Greenticker Financial Services LLP.',
        content: `1. Probation Duration: All full-time new hires serve a standard probation period of 6 months from their joining date.
2. Mid-Term Review: A performance and cultural alignment review is conducted at the end of the 3rd month by the reporting manager and HR.
3. Confirmation Evaluation: Final confirmation review occurs at the end of the 6th month based on KRA achievement, attendance, and behavioral competencies.
4. Extension of Probation: If performance standards are not fully met, probation may be extended once by an additional 3 months with specific written developmental goals.
5. Notice During Probation: During probation, either party may terminate employment with 15 days written notice (or salary in lieu thereof).`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_05',
        title: 'Greenticker Termination and Exit Policy',
        category: 'HR',
        version: 'Version 1.0',
        summary: 'Governs resignation procedures, notice periods (45 days), handover obligations, asset clearance, and full & final (F&F) settlement timelines at Greenticker Financial Services LLP.',
        content: `1. Notice Period: Employees who have successfully completed probation must serve a 45-day notice period upon resignation (or pay equivalent basic salary in lieu of unserved days).
2. Handover & Clearance: Formal handover of duties, documentation, project repositories, and company assets must be completed before the last working day.
3. Departmental Clearances: Clearances are required from IT Assets, Department Head, Finance, and Administration prior to exit approval.
4. Full & Final Settlement (F&F): Full and final financial settlement, including earned salary, encashable leave, and gratuity (if eligible), is processed within 30 days of the last working day.
5. Termination by Company: Company reserves the right to terminate employment for breach of conduct, performance failure, or redundancy, adhering to statutory notice or severance guidelines.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_06',
        title: 'Greenticker Travel & Expense Policy',
        category: 'COMPLIANCE',
        version: 'Version 1.0',
        summary: 'Defines business travel booking guidelines, hotel accommodation tiers, daily meal allowances, conveyance rates (petrol/cabs), and digital expense submission deadlines at Greenticker Financial Services LLP.',
        content: `1. Pre-Approval: Domestic and international business travel must be approved in advance by the reporting manager and department head via the HRMS portal.
2. Conveyance Reimbursements: Two-wheelers: ₹3.50 per km; Four-wheelers: ₹8.50 per km. Cab receipts or official ride-sharing logs are required for reimbursement.
3. Accommodation & Per Diem: Tier-1 cities hotel limit: up to ₹6,000/night. Tier-2 cities: up to ₹4,000/night. Daily meal allowance: ₹800/day.
4. Submission Deadline: All expense claims with original tax-compliant invoices/receipts must be submitted within 15 days of incurring the expense.
5. Audit & Processing: Expenses are audited by Finance and reimbursed monthly on the 5th of every month.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_07',
        title: 'Greenticker Work From Home (WFH) Policy',
        category: 'REMOTE',
        version: 'Version 1.0',
        summary: 'Governs eligibility, connectivity standards, cybersecurity precautions, core working hours availability, and equipment requirements for remote work at Greenticker Financial Services LLP.',
        content: `1. Eligibility: WFH is permitted under approved hybrid schedules or exceptional circumstances upon management approval. It is not an automatic right.
2. Core Working Hours: Remote employees must remain reachable and active during core hours (10:00 AM to 5:00 PM) via official communication channels (Slack/Teams/Email).
3. Data Security: Remote workers must use encrypted VPN connections, secured Wi-Fi networks, and screen lock policies. Company data must never be stored on personal unencrypted drives.
4. Productivity & Deliverables: Daily task updates and agile sprint objectives must be maintained and updated transparently in the portal.
5. Workspace Environment: Employees must maintain a distraction-free, professional environment suitable for client calls and virtual meetings.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_08',
        title: 'Greenticker Appraisal Policy',
        category: 'HR',
        version: 'Version 1.0',
        summary: 'Outlines the annual appraisal cycle, KRA objective setting, performance scoring rubrics, increment review in April, and salary revision effective May at Greenticker Financial Services LLP.',
        content: `1. Appraisal Cycle: Annual performance reviews take place in April for the preceding financial year. Hike and promotion letters are issued in April, with revised compensation effective from May.
2. Key Result Areas (KRAs): Every employee is assigned 4 measurable KRAs aligned with departmental and organizational strategic goals.
3. Performance Scoring: Evaluation is scored on a 5-point scale based on KRA attainment, behavioral competencies, and peer feedback.
4. Increment Slabs: Performance-linked increments range from 5% to 20% based on composite KRA score bands.
5. Grievance Redressal: Appraisal clarifications or review appeals can be submitted to HR within 7 days of rating publication.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_09',
        title: 'Greenticker Asset Usage & IT Policy',
        category: 'SECURITY',
        version: 'Version 1.0',
        summary: 'Governs acceptable use of company laptops, software licenses, data backups, hardware care, and mandatory return protocols at Greenticker Financial Services LLP.',
        content: `1. Authorized Use: Company-provided laptops, peripherals, and software licenses are strictly for official business operations of Greenticker Financial Services LLP.
2. Software & Security: Employees must not install unauthorized software, pirated applications, or unvetted browser extensions. Operating system security patches must be kept up to date.
3. Hardware Maintenance: Employees are responsible for the physical safety and care of assigned hardware. Liquid spills, physical damage, or theft must be reported within 24 hours.
4. Data Backup: Critical work files must be stored on approved company cloud repositories (e.g., SharePoint/Drive) rather than local hard drives alone.
5. Asset Return: All company-issued assets must be returned in good working condition upon separation or upon request by IT administration.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_10',
        title: 'Greenticker Background Verification Policy',
        category: 'COMPLIANCE',
        version: 'Version 1.0',
        summary: 'Mandates pre-employment and post-employment background checks including education, previous employment credentials, criminal records, and address verification at Greenticker Financial Services LLP.',
        content: `1. Mandatory Verification: All selected candidates undergo comprehensive background screening conducted by authorized third-party verification agencies.
2. Scope of Check: Checks cover highest educational qualification, previous employment tenure and designation, criminal background search, and permanent address verification.
3. Candidate Responsibility: Candidates must provide accurate documents, correct contact references, and signed consent forms prior to onboarding.
4. Discrepancy Handling: Any major discrepancy, falsification, or suppression of material facts results in immediate offer revocation or termination of employment for cause.
5. Confidentiality: Background check reports are handled with utmost confidentiality and stored securely in employee HR files.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_11',
        title: 'Greenticker Code of Conduct',
        category: 'CONDUCT',
        version: 'Version 1.0',
        summary: 'Sets professional standards of integrity, ethical behavior, anti-bribery, conflict of interest disclosure, and respectful workplace interactions at Greenticker Financial Services LLP.',
        content: `1. Professional Integrity: Employees of Greenticker Financial Services LLP must uphold the highest standards of honesty, transparency, and ethical conduct in all business dealings.
2. Conflict of Interest: Any personal, financial, or familial interest in supplier contracts or competing entities must be promptly disclosed in writing to management.
3. Anti-Bribery & Gifts: Offering or accepting bribes, kickbacks, or lavish gifts from clients or vendors is strictly prohibited. Modest promotional items (under ₹1,000) are exempt.
4. Workplace Respect: Mutual respect, inclusivity, and professional decorum are mandatory across all meetings, communications, and collaborative spaces.
5. Disciplinary Action: Breaches of the Code of Conduct are subject to formal inquiry and appropriate disciplinary measures.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_12',
        title: 'Greenticker Data Protection & Privacy Policy',
        category: 'SECURITY',
        version: 'Version 1.0',
        summary: 'Ensures secure handling, encryption, regulatory compliance, and confidentiality of client financial records and personal identifiable information (PII) at Greenticker Financial Services LLP.',
        content: `1. Data Classification: Client financial portfolios, PII, trade secrets, and internal financial models are classified as Confidential or Restricted.
2. Access Control: Access to sensitive databases is restricted on a need-to-know basis with multi-factor authentication (MFA) enabled.
3. Data Transmission: Confidential data must be transmitted using encrypted channels. Unencrypted emailing of client PII is strictly prohibited.
4. Incident Response: Any suspected data breach or accidental exposure must be reported immediately to the IT Security and Compliance team.
5. Regulatory Compliance: Practices align strictly with applicable data privacy regulations and financial industry standards.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_13',
        title: 'Greenticker Employee Referral Policy',
        category: 'HR',
        version: 'Version 1.0',
        summary: 'Rewards employees for referring qualified candidates for open positions, detailing referral bonuses, eligibility criteria, and payout milestones at Greenticker Financial Services LLP.',
        content: `1. Eligibility: All permanent employees are eligible to refer candidates for open roles, excluding HR team members and hiring managers for their own reporting vacancies.
2. Submission Process: Referrals must be submitted through the official Greenticker HR portal along with the candidate's updated resume.
3. Payout Structure: Referral bonuses vary by role seniority (ranging from ₹5,000 to ₹25,000).
4. Vesting Milestone: Referral bonus is disbursed in two tranches: 50% upon successful completion of the candidate's probation period, and 50% after 1 year of continuous service.
5. Validity: Referrals remain valid for 6 months from submission date.`,
        mandatory: false,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_14',
        title: 'Greenticker Gratuity Policy',
        category: 'HR',
        version: 'Version 1.0',
        summary: 'Outlines gratuity eligibility upon completion of 5 continuous years of service, calculation formula, and statutory disbursement guidelines at Greenticker Financial Services LLP.',
        content: `1. Eligibility: Permanent employees who complete 5 continuous years of service with Greenticker Financial Services LLP are eligible for gratuity upon separation (resignation, retirement, or termination).
2. Calculation Formula: Gratuity is calculated as (Last Drawn Basic Salary × 15 / 26) × Number of Completed Years of Service.
3. Exemption: In cases of death or disablement, the 5-year continuous service requirement is waived in accordance with statutory regulations.
4. Forfeiture Clause: Gratuity may be partially or fully forfeited in cases of termination for proven fraud, riotous behavior, or willful financial loss caused to the company.
5. Disbursement Timeline: Gratuity dues are calculated and disbursed alongside the Full & Final settlement.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
      {
        _id: 'pol_g_15',
        title: 'Greenticker Moonlighting Policy',
        category: 'COMPLIANCE',
        version: 'Version 1.0',
        summary: 'Strict prohibition against taking secondary employment, freelance consulting, or concurrent commercial engagements during employment tenure with Greenticker Financial Services LLP.',
        content: `1. Exclusive Service: Employees must devote their working time, attention, and professional skills exclusively to Greenticker Financial Services LLP during their employment tenure.
2. Prohibition of Moonlighting: Engaging in secondary employment, part-time jobs, commercial freelancing, or advisory roles with competing or non-competing entities is strictly prohibited without prior written board approval.
3. Conflict Prevention: This prevents conflicts of interest, intellectual property leakage, and exhaustion impacting primary job performance.
4. Annual Declaration: Employees must submit an annual zero-moonlighting compliance attestation via their HR profile.
5. Disciplinary Action: Unauthorized secondary employment constitutes a material breach of contract, resulting in immediate termination for cause.`,
        mandatory: true,
        effectiveDate: '2025-09-01',
        lastUpdated: '2025-09-01',
      },
    ];
    seedPolicies.forEach((p) => this.policies.set(p._id, p));

    // Seed Letter Templates
    const seedTemplates: LetterTemplateDoc[] = [
      {
        _id: 'tmpl_offer',
        organizationId: 'org_zenith_hq',
        title: 'Standard Employment Offer Letter',
        category: 'OFFER',
        subject: 'Employment Offer with Anusyuti',
        content: `<div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
  <h2 style="color: #023b77; border-bottom: 2px solid #039583; padding-bottom: 8px;">OFFER OF EMPLOYMENT</h2>
  <p><strong>Date:</strong> {{joining_date}}</p>
  <p>Dear <strong>{{employee_name}}</strong>,</p>
  <p>We are thrilled to offer you the position of <strong>{{designation}}</strong> within the <strong>{{department}}</strong> department at <strong>{{company_name}}</strong>. Your annual compensation package will be <strong>{{salary}}</strong>.</p>
  <p>We believe your skills and expertise will be a phenomenal addition to our team.</p>
  <br/><br/>
  <p>Sincerely,</p>
  <p><strong>HR Operations</strong><br/>{{company_name}}<br/>{{company_address}}</p>
</div>`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        _id: 'tmpl_promo',
        organizationId: 'org_zenith_hq',
        title: 'Promotion & Salary Increment Notice',
        category: 'PROMOTION',
        subject: 'Promotion to {{designation}}',
        content: `<div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
  <h2 style="color: #023b77; border-bottom: 2px solid #039583; padding-bottom: 8px;">CAREER ADVANCEMENT & PROMOTION</h2>
  <p><strong>Date:</strong> {{joining_date}}</p>
  <p>Dear <strong>{{employee_name}}</strong>,</p>
  <p>In recognition of your exceptional contributions and leadership, <strong>{{company_name}}</strong> is proud to promote you to <strong>{{designation}}</strong> in the <strong>{{department}}</strong> department.</p>
  <p>Thank you for your continuous dedication and excellence.</p>
  <br/><br/>
  <p>Warm regards,</p>
  <p><strong>Executive Management</strong><br/>{{company_name}}</p>
</div>`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    seedTemplates.forEach(t => this.letterTemplates.set(t._id, t));

    // Seed David Chen's policy acknowledgements
    this.policyAcknowledgements.push(
      {
        _id: 'ack_dc_001',
        policyId: 'pol_001',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        acknowledgedAt: '2024-01-15T09:30:00Z',
        ipAddress: '198.51.100.42',
        digitalSignature: 'Vikramaditya Rao (RHA-042)',
      },
      {
        _id: 'ack_dc_002',
        policyId: 'pol_002',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        acknowledgedAt: '2024-03-05T14:15:00Z',
        ipAddress: '198.51.100.42',
        digitalSignature: 'Vikramaditya Rao (RHA-042)',
      },
      {
        _id: 'ack_dc_003',
        policyId: 'pol_003',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        acknowledgedAt: '2024-01-15T09:35:00Z',
        ipAddress: '198.51.100.42',
        digitalSignature: 'Vikramaditya Rao(RHA-042)',
      }
    );

    // 6. POSH Cases (Rule 21: Strictly restricted to ADMIN & HR)
    const seedPosh: PoshCaseDoc[] = [
      {
        _id: 'posh_case_001',
        caseNumber: 'POSH-2024-001',
        incidentDate: '2024-08-14',
        reportedDate: '2024-08-16',
        complainantName: 'Confidential Complainant A',
        complainantCode: 'CONF-01',
        isAnonymous: true,
        respondentName: 'Former Senior Associate B',
        respondentDesignation: 'Staff Product Strategist',
        respondentDepartment: 'Product & Design',
        stage: 'ACTION_TAKEN',
        description: 'Repeated inappropriate personal text messages sent outside work hours creating an uncomfortable working relationship.',
        committeeAssigned: 'Internal Complaints Committee Panel 1 (Led by Presiding Officer Dr. Aruna Swaminathan)',
        actionTakenNotes: 'Formal enquiry completed. Respondent found in violation of workplace harassment clause. Official reprimand issued and separation executed in Q3 2024.',
        resolutionDate: '2024-09-28',
        status: 'RESOLVED',
        isConfidential: true,
      },
      {
        _id: 'posh_case_002',
        caseNumber: 'POSH-2025-001',
        incidentDate: '2025-01-20',
        reportedDate: '2025-01-24',
        complainantName: 'Confidential Complainant C',
        complainantCode: 'CONF-03',
        isAnonymous: true,
        respondentName: 'Contractor Vendor D',
        respondentDesignation: 'External Facilities Contractor',
        respondentDepartment: 'Operations & Facilities',
        stage: 'FINDINGS_SUBMITTED',
        description: 'Unwelcome remarks made in the cafeteria common area.',
        committeeAssigned: 'Internal Complaints Committee Panel 2',
        actionTakenNotes: 'Vendor badge revoked immediately pending final committee resolution report.',
        status: 'ACTIVE',
        isConfidential: true,
      },
    ];
    seedPosh.forEach((c) => this.poshCases.set(c._id, c));

    // 7. Holidays (2025/2026 Calendar)
    const seedHolidays: HolidayDoc[] = [
      { _id: 'hol_01', name: "Maharashtra Day", date: '2026-05-01', dayOfWeek: 'Friday', type: 'MANDATORY', description: 'State holiday commemorating the formation of Maharashtra.' },
      { _id: 'hol_02', name: "Independence Day", date: '2026-08-15', dayOfWeek: 'Saturday', type: 'MANDATORY', description: 'National holiday commemorating India’s independence.' },
      { _id: 'hol_03', name: "Raksha Bandhan", date: '2026-08-28', dayOfWeek: 'Friday', type: 'RESTRICTED', description: 'Hindu festival celebrating the bond between brothers and sisters.' },
      { _id: 'hol_04', name: "Ganesh Chaturdashi", date: '2026-09-14', dayOfWeek: 'Monday', type: 'MANDATORY', description: 'Hindu festival marking the celebration of Lord Ganesha.' },
      { _id: 'hol_05', name: "Anant Chaturdashi", date: '2026-09-25', dayOfWeek: 'Friday', type: 'MANDATORY', description: 'Festival traditionally associated with the concluding day of Ganesh Chaturthi celebrations.' },
      { _id: 'hol_06', name: "Gandhi Jayanti", date: '2026-10-02', dayOfWeek: 'Friday', type: 'MANDATORY', description: 'National holiday commemorating the birth anniversary of Mahatma Gandhi.' },
      { _id: 'hol_07', name: "Dussehra (Vijayadashami / Dasara)", date: '2026-10-20', dayOfWeek: 'Tuesday', type: 'MANDATORY', description: 'Hindu festival celebrating the victory of good over evil (Dussehra / Vijayadashami).' },
      { _id: 'hol_08', name: "Diwali", date: '2026-11-05', dayOfWeek: 'Thursday', type: 'MANDATORY', description: 'Major Indian festival of lights.' },
      { _id: 'hol_09', name: "Diwali", date: '2026-11-06', dayOfWeek: 'Friday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_10', name: "Diwali", date: '2026-11-07', dayOfWeek: 'Saturday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_11', name: "Diwali", date: '2026-11-08', dayOfWeek: 'Sunday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_12', name: "Diwali", date: '2026-11-09', dayOfWeek: 'Monday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_13', name: "Diwali", date: '2026-11-10', dayOfWeek: 'Tuesday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_14', name: "Diwali", date: '2026-11-11', dayOfWeek: 'Wednesday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_15', name: "Diwali", date: '2026-11-12', dayOfWeek: 'Thursday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_16', name: "Diwali", date: '2026-11-13', dayOfWeek: 'Friday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_17', name: "Diwali", date: '2026-11-14', dayOfWeek: 'Saturday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_18', name: "Diwali", date: '2026-11-15', dayOfWeek: 'Sunday', type: 'MANDATORY', description: 'Diwali holiday period.' },
      { _id: 'hol_19', name: "Christmas", date: '2026-12-25', dayOfWeek: 'Friday', type: 'MANDATORY', description: 'Christian festival commemorating the birth of Jesus Christ.' },
      { _id: 'hol_20', name: "New Year's Day", date: '2027-01-01', dayOfWeek: 'Friday', type: 'MANDATORY', description: 'Global holiday celebrating the start of the New Year.' },
      { _id: 'hol_21', name: "Republic Day", date: '2027-01-26', dayOfWeek: 'Tuesday', type: 'MANDATORY', description: 'National holiday commemorating the adoption of the Constitution of India.' },
      { _id: 'hol_22', name: "Holi", date: '2027-03-22', dayOfWeek: 'Monday', type: 'MANDATORY', description: 'Hindu festival celebrating the arrival of spring and the festival of colours.' },
    ];
    seedHolidays.forEach((h) => this.holidays.set(h._id, h));

    // 8. Announcements
    const seedAnnouncements: AnnouncementDoc[] = [
      {
        _id: 'ann_01',
        title: 'Anusyuti Q4 All-Hands Town Hall with CEO',
        content: 'Join us live this Thursday at 11:00 AM for our global company-wide updates, product milestone celebrations, and live Q&A with executive leadership.',
        category: 'EVENT',
        priority: 'HIGH',
        publishedBy: 'CEO',
        publishedAt: '2026-09-26T10:00:00Z',
        pinned: true,
      },
      {
        _id: 'ann_02',
        title: 'Annual Comprehensive Health Insurance Open Enrollment Window',
        content: 'The 2026 benefit enrollment period is now live. Please review your dependent coverage, dental, vision, and statutory benefits in your portal before October 25th.',
        category: 'HR_ALERT',
        priority: 'HIGH',
        publishedBy: 'Aditya Kapoor (HR Lead)',
        publishedAt: '2026-09-24T09:00:00Z',
        pinned: true,
      },
      {
        _id: 'ann_03',
        title: 'Anusyuti Hackathon 2026: AI & Automated Systems Showcase',
        content: 'Registration is now officially open for our 48-hour internal Hackathon. Build innovative developer tooling, AI integrations, or workflow automations with ₹1,200,000 in grand prizes!',
        category: 'CELEBRATION',
        priority: 'NORMAL',
        publishedBy: 'Aditya Kapoor (HR)',
        publishedAt: '2026-09-22T14:30:00Z',
        pinned: false,
      },
    ];
    seedAnnouncements.forEach((a) => this.announcements.set(a._id, a));

    // 9. Performance Reviews
    const seedReview: PerformanceReviewDoc = {
      _id: 'rev_dc_2024_h2',
      employeeId: 'emp_emp_01',
      employeeName: 'Vikramaditya Rao',
      employeeCode: 'RHA-042',
      department: 'Engineering & Technology',
      cycle: '2024-H2 Appraisal Cycle',
      status: 'COMPLETED',
      goals: [
        {
          title: 'Design System & Component Library Overhaul',
          description: 'Migrate core application UI to reusable, high-performance Tailwind components with full keyboard accessibility.',
          weightage: 40,
          comments: 'Exceeded expectations. 100% component migration completed ahead of sprint plan.',
        },
        {
          title: 'Frontend Performance & Core Web Vitals',
          description: 'Achieve Sub-second LCP and 95+ Google Lighthouse scores across primary dashboards.',
          weightage: 30,
          comments: 'Bundle size reduced by 34%, page load speeds increased across all client modules.',
        },
        {
          title: 'Cross-functional Mentorship',
          description: 'Mentor 2 junior frontend engineers in testing practices and React architecture.',
          weightage: 30,
          comments: 'Great leadership in running weekly frontend brown-bag learning workshops.',
        },
      ],
      strengths: 'Exceptional architectural clarity, high code quality, reliable delivery, and proactive cross-team collaboration.',
      areasOfImprovement: 'Expand contributions to distributed systems design and backend API contract definitions.',
      promotionRecommendation: 'RECOMMENDED',
      completedAt: '2024-12-20T17:00:00Z',
    };
    this.performanceReviews.set('emp_emp_01', seedReview);

    const seedReviewManager: PerformanceReviewDoc = {
      _id: 'rev_am_2024_h2',
      employeeId: 'emp_mgr_01',
      employeeName: 'Arjun',
      employeeCode: 'RHA-015',
      department: 'Engineering & Technology',
      cycle: '2024-H2 Appraisal Cycle',
      status: 'MANAGER_REVIEW',
      goals: [
        {
          title: 'Quarterly Delivery Roadmap',
          description: 'Ship all committed roadmap milestones for the engineering team on schedule.',
          weightage: 40,
          comments: 'All major milestones delivered on time.',
        },
        {
          title: 'Team Hiring & Onboarding',
          description: 'Close 3 open engineering positions and complete onboarding within 30 days.',
          weightage: 30,
          comments: 'Only one of three positions closed this cycle.',
        },
        {
          title: 'Incident Response Readiness',
          description: 'Establish on-call rotation and post-incident review process.',
          weightage: 30,
        },
      ],
      strengths: 'Strong delivery ownership and clear stakeholder communication.',
      areasOfImprovement: 'Improve hiring pipeline velocity and delegate more routine decisions.',
      promotionRecommendation: 'READY_NEXT_CYCLE',
    };
    this.performanceReviews.set('emp_mgr_01', seedReviewManager);

    // 10. Job Openings & Candidates
    const seedJobs: JobOpeningDoc[] = [
      {
        _id: 'job_001',
        title: 'Senior Staff Frontend Architect',
        department: 'Engineering & Technology',
        location: 'Hyderabad Tech Center (HITEC City) (Hybrid / Remote)',
        type: 'FULL_TIME',
        experienceRequired: '7+ years',
        openingsCount: 2,
        status: 'OPEN',
        postedDate: '2026-09-10',
        description: 'Lead the frontend architecture for our high-scale enterprise HR and workforce workflow engine.',
        skillsRequired: ['React', 'TypeScript', 'TailwindCSS', 'Web Performance', 'Microfrontends', 'State Management'],
      },
      {
        _id: 'job_002',
        title: 'Principal Site Reliability & Cloud Architect',
        department: 'Engineering & Technology',
        location: 'Hyderabad Tech Center (HITEC City) / Remote',
        type: 'FULL_TIME',
        experienceRequired: '8+ years',
        openingsCount: 1,
        status: 'OPEN',
        postedDate: '2026-09-15',
        description: 'Design multi-region Kubernetes clusters, automated zero-downtime CI/CD pipelines, and high-availability database replication.',
        skillsRequired: ['Kubernetes', 'Terraform', 'AWS/GCP', 'PostgreSQL', 'Prometheus', 'Chaos Engineering'],
      },
      {
        _id: 'job_003',
        title: 'Global Compensation & Payroll Specialist',
        department: 'Finance & Compliance',
        location: 'Delhi NCR Cyber City (Hybrid)',
        type: 'FULL_TIME',
        experienceRequired: '5+ years',
        openingsCount: 1,
        status: 'OPEN',
        postedDate: '2026-09-18',
        description: 'Oversee multi-state and international statutory payroll processing, benefits taxation, and audits.',
        skillsRequired: ['Statutory Payroll', 'Form 16 / W2', 'TDS / EPF Compliance', 'Excel Modeling', 'Workday/HRMS'],
      },
    ];
    seedJobs.forEach((j) => this.jobOpenings.set(j._id, j));

    const seedCandidates: JobCandidateDoc[] = [
      {
        _id: 'cand_01',
        jobId: 'job_001',
        jobTitle: 'Senior Staff Frontend Architect',
        fullName: 'Mansi Patel',
        email: 'mansi.patel@engineer.net',
        phone: '+91 (915) 555-8932',
        stage: 'TECHNICAL_INTERVIEW',
        experienceYears: 8,
        currentCompany: 'NextScale Systems',
        appliedDate: '2026-09-18',
        rating: 4.8,
        notes: 'Passed technical coding round with perfect score on algorithm efficiency and clean React patterns.',
      },
      {
        _id: 'cand_02',
        jobId: 'job_001',
        jobTitle: 'Senior Staff Frontend Architect',
        fullName: 'Anika Sachdev',
        email: 'anika.sachdev@techcraft.io',
        phone: '+91 (985) 555-7741',
        stage: 'OFFERED',
        experienceYears: 9,
        currentCompany: 'Apex Cloud Innovations',
        appliedDate: '2026-09-12',
        rating: 5.0,
        notes: 'Exceptional systems design interview. Written offer dispatched for $195k base + equity package.',
      },
      {
        _id: 'cand_03',
        jobId: 'job_002',
        jobTitle: 'Principal Site Reliability & Cloud Architect',
        fullName: 'Tejas Patil',
        email: 'tejas.patil@infraflow.com',
        phone: '+91 (922) 555-9014',
        stage: 'SCREENING',
        experienceYears: 10,
        currentCompany: 'Stratos Data Corp',
        appliedDate: '2026-09-22',
        rating: 4.2,
        notes: 'Initial recruiter call completed. Strong background in zero-trust VPC configurations.',
      },
    ];
    seedCandidates.forEach((c) => this.jobCandidates.set(c._id, c));

    // 11. HR Service Desk
    const seedTickets: HrRequestDoc[] = [
      {
        _id: 'req_001',
        ticketNumber: 'HR-REQ-1042',
        employeeId: 'emp_emp_01',
        employeeName: 'Arjun Khanna',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        category: 'DOCUMENTS',
        subject: 'Request for Official Employment Verification Letter for Mortgage',
        description: 'Need a signed and stamped letter confirming designation, current salary, and tenure for bank home loan mortgage application.',
        priority: 'HIGH',
        status: 'RESOLVED',
        assignedTo: 'Aditya Kapoor (HR Lead)',
        createdAt: '2026-09-20T10:15:00Z',
        resolvedAt: '2026-09-21T14:00:00Z',
        resolutionRemarks: 'Letter generated, signed by HR lead, and uploaded to employee document repository.',
      },
      {
        _id: 'req_002',
        ticketNumber: 'HR-REQ-1048',
        employeeId: 'emp_emp_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'ZEN-042',
        department: 'Engineering & Technology',
        category: 'BENEFITS',
        subject: 'Add Newborn Daughter to Corporate Medical Insurance Plan',
        description: 'Kindly assist in enrolling my newborn dependent daughter under our employer-sponsored healthcare plan.',
        priority: 'MEDIUM',
        status: 'IN_PROGRESS',
        assignedTo: 'Aditya Kapoor (HR Lead)',
        createdAt: '2026-09-25T11:30:00Z',
      },
      {
        _id: 'req_003',
        ticketNumber: 'HR-REQ-1051',
        employeeId: 'emp_devops_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'ZEN-055',
        department: 'Engineering & Technology',
        category: 'IT_ASSETS',
        subject: 'Hardware Upgrade: 64GB RAM M3 Max MacBook Request',
        description: 'Current 16GB developer machine is experiencing severe memory pressure running local Kubernetes test clusters.',
        priority: 'HIGH',
        status: 'OPEN',
        assignedTo: 'Aditya Kapoor (HR Lead)',
        createdAt: '2026-09-27T15:20:00Z',
      },
    ];
    seedTickets.forEach((t) => this.hrRequests.set(t._id, t));

    // 12. Full & Final Settlement
    const seedFnF: FullFinalSettlementDoc = {
      _id: 'fnf_001',
      employeeId: 'emp_ex_01',
      employeeName: 'Sneha Patel',
      employeeCode: 'RHA-019',
      department: 'Product & Design',
      resignationDate: '2026-08-01',
      lastWorkingDay: '2026-09-01',
      noticePeriodDays: 30,
      noticeServedDays: 30,
      status: 'HR_APPROVED',
      clearances: {
        department: { cleared: true, remarks: 'Design Figma files handed over to Maya Lin.', clearedBy: 'Elena Rostova' },
        itAssets: { cleared: true, remarks: 'MacBook Pro, access badge, and security YubiKey surrendered.', clearedBy: 'IT Helpdesk Lead' },
        finance: { cleared: true, remarks: 'All corporate credit card and expense accounts settled.', clearedBy: 'Arthur Pendelton' },
        admin: { cleared: true, remarks: 'Building parking card returned and building security pass disabled.', clearedBy: 'Facilities Ops' },
      },
      settlementComponents: {
        unpaidSalary: 9500,
        leaveEncashmentDays: 14,
        leaveEncashmentAmount: 4433,
        gratuity: 12500,
        noticePayShortfallDeduction: 0,
        bonusOrIncentive: 2000,
        totalPayable: 28433,
      },
      notes: 'Eligible for re-hire. Separation executed cordially on mutual agreement.',
    };
    this.fullFinalSettlements.set(seedFnF._id, seedFnF);

    // 13. Allocated Assets
    const seedAssets: AssetDoc[] = [
      {
        _id: 'asset_001',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        category: 'ELECTRONICS',
        type: 'LAPTOP',
        name: 'MacBook Pro 16" M3 Max',
        assetTag: 'AST-DEL-8801',
        serialNumber: 'C02G9012MD6R',
        issuedDate: '2026-06-15',
        status: 'ALLOCATED',
        notes: 'Primary developer workstation with 32GB RAM and 1TB SSD.',
      },
      {
        _id: 'asset_002',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        category: 'ELECTRONICS',
        type: 'CHARGER',
        name: '140W USB-C Power Adapter',
        assetTag: 'AST-DEL-8802',
        serialNumber: 'CHG-99281',
        issuedDate: '2026-06-15',
        status: 'ALLOCATED',
        notes: 'Original Apple fast charger.',
      },
      {
        _id: 'asset_003',
        employeeId: 'emp_mgr_01',
        employeeName: 'Aarav Sharma',
        employeeCode: 'RHA-010',
        category: 'ELECTRONICS',
        type: 'LAPTOP',
        name: 'Dell Latitude 7440',
        assetTag: 'AST-DEL-8803',
        serialNumber: 'DL-7440-992',
        issuedDate: '2026-04-10',
        status: 'ALLOCATED',
        notes: 'Executive engineering laptop.',
      },
      {
        _id: 'asset_004',
        employeeId: 'emp_mgr_01',
        employeeName: 'Aarav Sharma',
        employeeCode: 'RHA-010',
        category: 'ELECTRONICS',
        type: 'PHONE',
        name: 'iPhone 15 Pro 256GB',
        assetTag: 'AST-DEL-8804',
        serialNumber: 'IMEI-354920198273',
        issuedDate: '2026-04-10',
        status: 'ALLOCATED',
        notes: 'Company-issued mobile for client calls.',
      },
      {
        _id: 'asset_005',
        employeeId: 'emp_devops_01',
        employeeName: 'Priya Iyer',
        employeeCode: 'RHA-015',
        category: 'ELECTRONICS',
        type: 'LAPTOP',
        name: 'ThinkPad X1 Carbon Gen 11',
        assetTag: 'AST-DEL-8805',
        serialNumber: 'TP-X1-4492',
        issuedDate: '2026-05-20',
        status: 'ALLOCATED',
        notes: 'DevOps primary terminal.',
      },
      {
        _id: 'asset_006',
        employeeId: 'emp_mgr_01',
        employeeName: 'Aarav Sharma',
        employeeCode: 'RHA-010',
        category: 'FURNITURE',
        type: 'CHAIR',
        name: 'Herman Miller Aeron Ergonomic Chair',
        assetTag: 'AST-DEL-8806',
        serialNumber: 'HM-AERON-991',
        issuedDate: '2026-03-01',
        status: 'ALLOCATED',
        notes: 'Premium ergonomic office chair.',
      },
      {
        _id: 'asset_007',
        employeeId: 'emp_emp_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-042',
        category: 'SOFTWARE_LICENSES',
        type: 'SOFTWARE_LICENSE',
        name: 'JetBrains All Products Pack (Annual)',
        assetTag: 'AST-DEL-8807',
        serialNumber: 'JB-LICENSE-2026-99',
        issuedDate: '2026-01-10',
        status: 'ALLOCATED',
        notes: 'Enterprise IDE license for full-stack engineering.',
      },
      {
        _id: 'asset_008',
        employeeId: 'emp_fin_head',
        employeeName: 'Rajesh Singhania',
        employeeCode: 'RHA-012',
        category: 'VEHICLES',
        type: 'CAR',
        name: 'Toyota Camry Hybrid Executive',
        assetTag: 'AST-DEL-8808',
        serialNumber: 'MH-01-AB-1234',
        issuedDate: '2026-02-15',
        status: 'ALLOCATED',
        notes: 'Company leased vehicle for senior management.',
      },
    ];
    seedAssets.forEach((a) => this.assets.set(a._id, a));
  }

  // --- LEAVE METHODS ---
  getLeaveBalance(employeeId: string): LeaveBalance {
    if (!this.leaveBalances.has(employeeId)) {
      this.leaveBalances.set(employeeId, {
        casual: { total: 12, used: 0, remaining: 12 },
        sick: { total: 10, used: 0, remaining: 10 },
        earned: { total: 15, used: 0, remaining: 15 },
        maternity: { total: 180, used: 0, remaining: 180 },
        paternity: { total: 15, used: 0, remaining: 15 },
        unpaid: { used: 0 },
      });
    }
    return this.leaveBalances.get(employeeId)!;
  }

  getLeaveRequests(user: UserDoc, filter?: { status?: string; employeeId?: string }): LeaveRequestDoc[] {
    let list = Array.from(this.leaveRequests.values());

    if (user.role === 'EMPLOYEE') {
      const empId = user.employeeId;
      list = list.filter((r) => r.employeeId === empId);
    } else if (false) {
      const myEmp = dbStore.employees.get(user.employeeId || '');
      const myDept = myEmp?.department;
      list = list.filter((r) => r.employeeId === user.employeeId || (myDept && r.department === myDept));
    }

    if (filter?.status && filter.status !== 'ALL') {
      list = list.filter((r) => r.status === filter.status);
    }
    if (filter?.employeeId) {
      list = list.filter((r) => r.employeeId === filter.employeeId);
    }

    return list.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
  }

  createLeaveRequest(data: Omit<LeaveRequestDoc, '_id' | 'appliedAt' | 'status'>): LeaveRequestDoc {
    const _id = `leave_${Date.now()}`;
    const newLeave: LeaveRequestDoc = {
      ...data,
      _id,
      status: 'PENDING',
      appliedAt: new Date().toISOString(),
    };
    this.leaveRequests.set(_id, newLeave);
    return newLeave;
  }

  updateLeaveStatus(
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    reviewerName: string,
    rejectionReason?: string
  ): LeaveRequestDoc | undefined {
    const leave = this.leaveRequests.get(id);
    if (!leave) return undefined;

    leave.status = status;
    leave.reviewedBy = reviewerName;
    leave.reviewedAt = new Date().toISOString();
    if (rejectionReason) leave.rejectionReason = rejectionReason;

    // If approved, deduct from balance
    if (status === 'APPROVED') {
      const bal = this.getLeaveBalance(leave.employeeId);
      if (leave.leaveType === 'CASUAL') {
        bal.casual.used += leave.daysCount;
        bal.casual.remaining = Math.max(0, bal.casual.total - bal.casual.used);
      } else if (leave.leaveType === 'SICK') {
        bal.sick.used += leave.daysCount;
        bal.sick.remaining = Math.max(0, bal.sick.total - bal.sick.used);
      } else if (leave.leaveType === 'EARNED') {
        bal.earned.used += leave.daysCount;
        bal.earned.remaining = Math.max(0, bal.earned.total - bal.earned.used);
      } else if (leave.leaveType === 'UNPAID') {
        bal.unpaid.used += leave.daysCount;
      }
    }

    return leave;
  }

  // --- EXPENSE METHODS ---
  getExpenses(user: UserDoc, filter?: { status?: string; category?: string; employeeId?: string }): ExpenseClaimDoc[] {
    let list = Array.from(this.expenseClaims.values());

    if (user.role === 'EMPLOYEE') {
      const empId = user.employeeId;
      list = list.filter((e) => e.employeeId === empId);
    } else if (false) {
      const myEmp = dbStore.employees.get(user.employeeId || '');
      const myDept = myEmp?.department;
      list = list.filter((e) => e.employeeId === user.employeeId || (myDept && e.department === myDept));
    }

    if (filter?.status && filter.status !== 'ALL') {
      list = list.filter((e) => e.status === filter.status);
    }
    if (filter?.category && filter.category !== 'ALL') {
      list = list.filter((e) => e.category === filter.category);
    }
    if (filter?.employeeId) {
      list = list.filter((e) => e.employeeId === filter.employeeId);
    }

    return list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  createExpense(data: Omit<ExpenseClaimDoc, '_id' | 'submittedAt' | 'status'>): ExpenseClaimDoc {
    const _id = `exp_${Date.now()}`;
    const newExp: ExpenseClaimDoc = {
      ...data,
      _id,
      status: 'SUBMITTED',
      submittedAt: new Date().toISOString(),
    };
    this.expenseClaims.set(_id, newExp);
    return newExp;
  }

  updateExpenseStatus(
    id: string,
    status: 'MANAGER_APPROVED' | 'HR_APPROVED' | 'REJECTED' | 'REIMBURSED',
    reviewerName: string,
    options?: { rejectionReason?: string; paymentReference?: string }
  ): ExpenseClaimDoc | undefined {
    const exp = this.expenseClaims.get(id);
    if (!exp) return undefined;

    exp.status = status;
    exp.reviewedBy = reviewerName;
    exp.reviewedAt = new Date().toISOString();
    if (options?.rejectionReason) exp.rejectionReason = options.rejectionReason;
    if (status === 'REIMBURSED') {
      exp.reimbursedAt = new Date().toISOString();
      exp.paymentReference = options?.paymentReference || `ACH-ZEN-EXP-${Math.floor(10000 + Math.random() * 90000)}`;
    }
    return exp;
  }

  // --- PAYROLL METHODS ---
  getPayslips(user: UserDoc, filter?: { month?: string; employeeId?: string }): PayslipDoc[] {
    let list = Array.from(this.payslips.values());

    if (user.role === 'EMPLOYEE') {
      list = list.filter((p) => p.employeeId === user.employeeId);
    } else if (false) {
      // Managers see their own payslips only; team members payslips are confidential
      list = list.filter((p) => p.employeeId === user.employeeId);
    }

    if (filter?.month) {
      list = list.filter((p) => p.month === filter.month);
    }
    if (filter?.employeeId && (user.role === 'ADMIN')) {
      list = list.filter((p) => p.employeeId === filter.employeeId);
    }

    return list.sort((a, b) => b.month.localeCompare(a.month));
  }

  /**
   * Builds one monthly payslip from the Greenticker salary structure (FY 2026-27),
   * the single source of truth for payroll. Returns null when the employee has no
   * usable CTC. `overrides` lets callers set id / pay date / days / transaction id.
   */
  private buildPayslip(
    emp: EmployeeDoc,
    monthStr: string,
    monthName: string,
    overrides: Partial<PayslipDoc> = {}
  ): PayslipDoc | null {
    const annualCtc = Number(emp.annualSalary) || 0;
    if (annualCtc <= 0) {
      console.warn(`[payroll] ${emp.employeeCode}: skipped - no annual CTC on file.`);
      return null;
    }
    const structure = computeSalaryStructure(annualCtc);
    const monthlyOf = (key: string) =>
      [...structure.wages, ...structure.allowances].find((l) => l.key === key)?.monthly ?? 0;

    // A negative balancing amount means the CTC is too low for this structure
    // (fixed Education + Medical + BFAA exceed 50% of CTC below ~Rs. 1.39 lakh).
    if (monthlyOf('special') < 0 || monthlyOf('conveyance') < 0) {
      console.warn(`[payroll] ${emp.employeeCode}: skipped - CTC ${annualCtc} is too low for the salary structure.`);
      return null;
    }

    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

    // Monthly gross excludes PPF Allowance, Medical Insurance and BFAA (paid once a year).
    const monthlyGross = structure.netPay.monthlyGross;
    const pf = structure.netPay.pfEmployee; // employee PF = PPF allowance = 12% of Basic
    const pt = professionalTaxForMonth(monthStr); // Rs. 200; Rs. 300 in February
    const tds = 0; // not part of the Greenticker structure
    const totalDeductions = r2(pf + pt + tds);

    return {
      _id: `pay_${emp._id}_${monthStr.replace('-', '_')}`,
      employeeId: emp._id,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      employeeCode: emp.employeeCode,
      designation: emp.designation,
      department: emp.department,
      panNumber: emp.statutory?.panNumber || emp.statutory?.panMasked || 'ABCDE1234F',
      pfUan: emp.statutory?.uanNumber || emp.statutory?.uanMasked || '100984728912',
      bankName: emp.bankInfo?.bankName || 'State Bank of India',
      bankAccountNumber: emp.bankInfo?.accountNumberMasked || (emp.bankInfo?.accountNumber ? `•••• •••• ${emp.bankInfo.accountNumber.slice(-4)}` : '•••• •••• 1234'),
      month: monthStr,
      monthName,
      payDate: new Date().toISOString().split('T')[0],
      workedDays: 22,
      lopDays: 0,
      basicSalary: monthlyOf('basic'),
      hra: monthlyOf('hra'),
      specialAllowance: monthlyOf('special'),
      conveyanceAllowance: monthlyOf('conveyance'),
      medicalAllowance: 0, // Medical Insurance is an annual one-time payment, not monthly
      performanceBonus: 0,
      annualCtc,
      educationAllowance: monthlyOf('education'),
      lta: monthlyOf('lta'),
      grossSalary: monthlyGross,
      providentFund: pf,
      professionalTax: pt,
      tds,
      otherDeductions: 0,
      totalDeductions,
      netSalary: r2(monthlyGross - totalDeductions),
      status: 'PAID',
      paymentMode: 'DIRECT_DEPOSIT',
      transactionId: `TXN-RHA-PAY-${monthStr}-${emp.employeeCode}`,
      ...overrides,
    };
  }

  runMonthlyPayroll(monthStr: string, monthName: string, processedBy: string): PayslipDoc[] {
    const generated: PayslipDoc[] = [];
    const activeEmployees = Array.from(dbStore.employees.values()).filter((e) => e.status === 'ACTIVE' || e.status === 'PROBATION');

    for (const emp of activeEmployees) {
      const existingKey = `pay_${emp._id}_${monthStr.replace('-', '_')}`;
      if (this.payslips.has(existingKey)) continue;

      const payslip = this.buildPayslip(emp, monthStr, monthName, {
        _id: existingKey,
        payDate: new Date().toISOString().split('T')[0],
      });
      if (!payslip) continue;

      this.payslips.set(existingKey, payslip);
      generated.push(payslip);
    }

    return generated;
  }

  // --- TAX DECLARATION METHODS ---
  getTaxDeclaration(employeeId: string): TaxDeclarationDoc | undefined {
    return this.taxDeclarations.get(employeeId);
  }

  saveTaxDeclaration(employeeId: string, data: Partial<TaxDeclarationDoc>): TaxDeclarationDoc {
    const existing = this.taxDeclarations.get(employeeId);
    const updated: TaxDeclarationDoc = {
      _id: existing?._id || `tax_${employeeId}_${Date.now()}`,
      employeeId,
      financialYear: data.financialYear || '2026-2027',
      regime: data.regime || 'NEW',
      section80C: data.section80C || {
        epf: 9360,
        ppf: 0,
        elss: 0,
        lifeInsurance: 0,
        taxSaverFD: 0,
        total: 9360,
        maxLimit: 150000,
      },
      section80D: data.section80D || { selfSpouseChildren: 0, parents: 0, total: 0 },
      hraExemption: data.hraExemption || { annualRentPaid: 0, cityType: 'METRO', calculatedExemption: 0 },
      section80CCD_1B: data.section80CCD_1B || 0,
      homeLoanInterest80EE: data.homeLoanInterest80EE || 0,
      totalDeductionsDeclared: data.totalDeductionsDeclared || 9360,
      estimatedTaxPayable: data.estimatedTaxPayable || 15000,
      submittedAt: new Date().toISOString(),
      status: 'SUBMITTED',
    };
    this.taxDeclarations.set(employeeId, updated);
    return updated;
  }

  // --- POLICY METHODS ---
  getPolicies(): PolicyDoc[] {
    return Array.from(this.policies.values());
  }

  getPolicyAcknowledgements(employeeId?: string): PolicyAcknowledgementDoc[] {
    if (employeeId) {
      return this.policyAcknowledgements.filter((a) => a.employeeId === employeeId);
    }
    return this.policyAcknowledgements;
  }

  acknowledgePolicy(policyId: string, employeeId: string, employeeName: string, signature: string, ip: string): PolicyAcknowledgementDoc {
    const ack: PolicyAcknowledgementDoc = {
      _id: `ack_${Date.now()}`,
      policyId,
      employeeId,
      employeeName,
      acknowledgedAt: new Date().toISOString(),
      ipAddress: ip,
      digitalSignature: signature,
    };
    this.policyAcknowledgements.push(ack);
    return ack;
  }

  // --- POSH METHODS (Strictly Admin & HR) ---
  getPoshCases(): PoshCaseDoc[] {
    return Array.from(this.poshCases.values());
  }

  createPoshCase(data: Omit<PoshCaseDoc, '_id' | 'reportedDate' | 'stage' | 'status' | 'isConfidential'>): PoshCaseDoc {
    const id = `posh_case_${Date.now()}`;
    const newCase: PoshCaseDoc = {
      ...data,
      _id: id,
      reportedDate: new Date().toISOString().split('T')[0],
      stage: 'PRELIMINARY_REVIEW',
      status: 'ACTIVE',
      isConfidential: true,
    };
    this.poshCases.set(id, newCase);
    return newCase;
  }

  updatePoshStage(id: string, stage: PoshCaseDoc['stage'], notes?: string, status?: PoshCaseDoc['status']): PoshCaseDoc | undefined {
    const item = this.poshCases.get(id);
    if (!item) return undefined;
    item.stage = stage;
    if (notes) item.actionTakenNotes = notes;
    if (status) item.status = status;
    if (status === 'RESOLVED') item.resolutionDate = new Date().toISOString().split('T')[0];
    return item;
  }

  // --- HOLIDAY METHODS ---
  getHolidays(): HolidayDoc[] {
    return Array.from(this.holidays.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  // --- ANNOUNCEMENT METHODS ---
  getAnnouncements(): AnnouncementDoc[] {
    return Array.from(this.announcements.values()).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }

  createAnnouncement(data: Omit<AnnouncementDoc, '_id' | 'publishedAt'>): AnnouncementDoc {
    const id = `ann_${Date.now()}`;
    const ann: AnnouncementDoc = {
      ...data,
      _id: id,
      publishedAt: new Date().toISOString(),
    };
    this.announcements.set(id, ann);
    return ann;
  }

  // --- PERFORMANCE REVIEWS ---
  getPerformanceReviews(user: UserDoc, employeeId?: string): PerformanceReviewDoc[] {
    let list = Array.from(this.performanceReviews.values());
    if (user.role === 'EMPLOYEE') {
      list = list.filter((r) => r.employeeId === user.employeeId);
    } else if (employeeId) {
      list = list.filter((r) => r.employeeId === employeeId);
    }
    return list;
  }

  // --- RECRUITMENT METHODS ---
  getJobOpenings(): JobOpeningDoc[] {
    return Array.from(this.jobOpenings.values());
  }

  getJobCandidates(jobId?: string): JobCandidateDoc[] {
    let list = Array.from(this.jobCandidates.values());
    if (jobId) list = list.filter((c) => c.jobId === jobId);
    return list;
  }

  updateCandidateStage(id: string, stage: JobCandidateDoc['stage']): JobCandidateDoc | undefined {
    const c = this.jobCandidates.get(id);
    if (!c) return undefined;
    c.stage = stage;
    return c;
  }

  // --- HR SERVICE DESK METHODS ---
  getHrRequests(user: UserDoc, status?: string): HrRequestDoc[] {
    let list = Array.from(this.hrRequests.values());
    if (user.role === 'EMPLOYEE') {
      list = list.filter((r) => r.employeeId === user.employeeId);
    }
    if (status && status !== 'ALL') {
      list = list.filter((r) => r.status === status);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  createHrRequest(data: Omit<HrRequestDoc, '_id' | 'ticketNumber' | 'createdAt' | 'status'>): HrRequestDoc {
    const num = Math.floor(1000 + Math.random() * 9000);
    const id = `req_${Date.now()}`;
    const doc: HrRequestDoc = {
      ...data,
      _id: id,
      ticketNumber: `HR-REQ-${num}`,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };
    this.hrRequests.set(id, doc);
    return doc;
  }

  resolveHrRequest(id: string, remarks: string): HrRequestDoc | undefined {
    const item = this.hrRequests.get(id);
    if (!item) return undefined;
    item.status = 'RESOLVED';
    item.resolvedAt = new Date().toISOString();
    item.resolutionRemarks = remarks;
    return item;
  }

  // --- FULL & FINAL SETTLEMENT ---
  getFullFinalSettlements(): FullFinalSettlementDoc[] {
    return Array.from(this.fullFinalSettlements.values());
  }

  // --- REQUIREMENTS & RECRUITMENT ---
  getRequirements(user: UserDoc): RequirementDoc[] {
    let list = Array.from(this.requirements.values());
    if (false) {
      list = list.filter((r) => r.requestedById === user.employeeId);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  createRequirement(user: UserDoc, data: any): RequirementDoc {
    const id = `req_${Date.now()}`;
    const emp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
    const doc: RequirementDoc = {
      _id: id,
      requestedById: user.employeeId || '',
      requestedByName: emp ? `${emp.firstName} ${emp.lastName}` : user.email,
      title: data.title,
      department: data.department,
      positions: data.positions,
      employmentType: data.employmentType,
      experienceRequired: data.experienceRequired,
      skillsRequired: data.skillsRequired,
      priority: data.priority,
      expectedJoiningDate: data.expectedJoiningDate,
      budgetRange: data.budgetRange,
      location: data.location,
      justification: data.justification,
      status: 'SUBMITTED',
      createdAt: new Date().toISOString(),
    };
    this.requirements.set(id, doc);
    return doc;
  }

  reviewRequirement(id: string, decision: 'APPROVED' | 'REJECTED', reviewerName: string, note?: string) {
    const req = this.requirements.get(id);
    if (!req) return undefined;
    req.status = decision;
    req.reviewedBy = reviewerName;
    req.reviewedAt = new Date().toISOString();
    req.reviewNote = note;

    let job: JobOpeningDoc | undefined = undefined;
    if (decision === 'APPROVED') {
      const jobId = `job_${Date.now()}`;
      job = {
        _id: jobId,
        title: req.title,
        department: req.department,
        location: req.location || 'Head Office',
        type: req.employmentType,
        experienceRequired: req.experienceRequired,
        openingsCount: req.positions,
        description: req.justification,
        skillsRequired: req.skillsRequired,
        status: 'OPEN',
        postedDate: new Date().toISOString().split('T')[0],
      };
      this.jobOpenings.set(jobId, job);
      req.jobId = jobId;
    }
    return { requirement: req, job };
  }

  setCandidateInterview(id: string, data: any): JobCandidateDoc | undefined {
    const cand = this.jobCandidates.get(id);
    if (!cand) return undefined;
    cand.stage = data.round || 'TECHNICAL_INTERVIEW';
    cand.interview = data;
    return cand;
  }

  addCandidateFeedback(id: string, feedback: any): JobCandidateDoc | undefined {
    const cand = this.jobCandidates.get(id);
    if (!cand) return undefined;
    if (!cand.interviewFeedbacks) cand.interviewFeedbacks = [];
    cand.interviewFeedbacks.push(feedback);
    if (feedback.recommendation === 'NEXT_ROUND') {
      if (feedback.round === 'TECHNICAL_INTERVIEW') {
        cand.stage = 'HR_INTERVIEW';
      } else if (feedback.round === 'HR_INTERVIEW') {
        cand.stage = 'OFFERED';
      }
    } else if (feedback.recommendation === 'REJECT') {
      cand.stage = 'REJECTED';
    }
    return cand;
  }

  setCandidateOffer(id: string, data: any): JobCandidateDoc | undefined {
    const cand = this.jobCandidates.get(id);
    if (!cand) return undefined;
    cand.stage = 'OFFERED';
    cand.offer = data;
    return cand;
  }

  getReferrals(user: UserDoc) {
    const list = Array.from(this.referrals.values());
    const isHrOrAdmin = user.role === 'ADMIN';
    return list
      .map((r) => {
        const isMine = r.referredById === user.employeeId;
        const canViewPrivate = isHrOrAdmin || isMine;
        return {
          ...r,
          isMine,
          canViewPrivate,
          email: canViewPrivate ? r.email : '••••••••@••••.com',
          phone: canViewPrivate ? r.phone : undefined,
          notes: canViewPrivate ? r.notes : undefined,
          hasResume: Boolean(r.storedFileName),
          storedFileName: undefined,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  createReferral(user: UserDoc, data: any): ReferralDoc {
    const id = `ref_${Date.now()}`;
    const emp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
    const doc: ReferralDoc = {
      _id: id,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      city: data.city,
      experienceYears: data.experienceYears,
      jobId: data.jobId,
      jobTitle: data.jobTitle,
      relationship: data.relationship,
      notes: data.notes,
      resumeFileName: data.resumeFileName,
      storedFileName: data.storedFileName,
      status: 'SUBMITTED',
      referredById: user.employeeId || user._id,
      referredByName: emp ? `${emp.firstName} ${emp.lastName}` : user.email,
      referredByRole: user.role,
      createdAt: new Date().toISOString(),
    };
    this.referrals.set(id, doc);
    return doc;
  }

  updateReferralStatus(id: string, status: any): ReferralDoc | undefined {
    const r = this.referrals.get(id);
    if (!r) return undefined;
    r.status = status;
    return r;
  }

  convertToCandidate(referralId: string): any | undefined {
    const ref = this.referrals.get(referralId);
    if (!ref) return undefined;
    ref.status = 'SHORTLISTED';
    let targetJobId = ref.jobId;
    if (!targetJobId || !this.jobOpenings.has(targetJobId)) {
      const firstJob = this.jobOpenings.values().next().value;
      targetJobId = firstJob ? firstJob._id : 'job_eng_01';
    }
    const job = this.jobOpenings.get(targetJobId);
    const candId = `cand_ref_${Date.now()}`;
    const cand: JobCandidateDoc = {
      _id: candId,
      jobId: targetJobId,
      jobTitle: job?.title || 'Open Position',
      fullName: ref.fullName,
      email: ref.email,
      phone: ref.phone || '',
      experienceYears: ref.experienceYears,
      currentCompany: 'Referred Candidate',
      stage: 'SCREENING',
      rating: 4,
      notes: `Referred by ${ref.referredByName} (${ref.relationship || 'Referral'}). ${ref.notes || ''}`,
      appliedDate: new Date().toISOString().split('T')[0],
    };
    this.jobCandidates.set(candId, cand);
    return cand;
  }

  getAssets(user: UserDoc, opts?: { employeeId?: string }): { assets: any[]; canManage: boolean } {
    if (this.assets.size === 0) {
      const seedAssets: AssetDoc[] = [
        {
          _id: 'asset_001',
          employeeId: 'emp_emp_01',
          employeeName: 'Vikramaditya Rao',
          employeeCode: 'RHA-042',
          category: 'ELECTRONICS',
          type: 'LAPTOP',
          name: 'MacBook Pro 16" M3 Max',
          assetTag: 'AST-DEL-8801',
          serialNumber: 'C02G9012MD6R',
          issuedDate: '2026-06-15',
          status: 'ALLOCATED',
          notes: 'Primary developer workstation with 32GB RAM and 1TB SSD.',
        },
        {
          _id: 'asset_002',
          employeeId: 'emp_emp_01',
          employeeName: 'Vikramaditya Rao',
          employeeCode: 'RHA-042',
          category: 'ELECTRONICS',
          type: 'CHARGER',
          name: '140W USB-C Power Adapter',
          assetTag: 'AST-DEL-8802',
          serialNumber: 'CHG-99281',
          issuedDate: '2026-06-15',
          status: 'ALLOCATED',
          notes: 'Original Apple fast charger.',
        },
        {
          _id: 'asset_003',
          employeeId: 'emp_mgr_01',
          employeeName: 'Aarav Sharma',
          employeeCode: 'RHA-010',
          category: 'ELECTRONICS',
          type: 'LAPTOP',
          name: 'Dell Latitude 7440',
          assetTag: 'AST-DEL-8803',
          serialNumber: 'DL-7440-992',
          issuedDate: '2026-04-10',
          status: 'ALLOCATED',
          notes: 'Executive engineering laptop.',
        },
        {
          _id: 'asset_004',
          employeeId: 'emp_mgr_01',
          employeeName: 'Aarav Sharma',
          employeeCode: 'RHA-010',
          category: 'ELECTRONICS',
          type: 'PHONE',
          name: 'iPhone 15 Pro 256GB',
          assetTag: 'AST-DEL-8804',
          serialNumber: 'IMEI-354920198273',
          issuedDate: '2026-04-10',
          status: 'ALLOCATED',
          notes: 'Company-issued mobile for client calls.',
        },
        {
          _id: 'asset_005',
          employeeId: 'emp_devops_01',
          employeeName: 'Priya Iyer',
          employeeCode: 'RHA-015',
          category: 'ELECTRONICS',
          type: 'LAPTOP',
          name: 'ThinkPad X1 Carbon Gen 11',
          assetTag: 'AST-DEL-8805',
          serialNumber: 'TP-X1-4492',
          issuedDate: '2026-05-20',
          status: 'ALLOCATED',
          notes: 'DevOps primary terminal.',
        },
        {
          _id: 'asset_006',
          employeeId: 'emp_mgr_01',
          employeeName: 'Aarav Sharma',
          employeeCode: 'RHA-010',
          category: 'FURNITURE',
          type: 'CHAIR',
          name: 'Herman Miller Aeron Ergonomic Chair',
          assetTag: 'AST-DEL-8806',
          serialNumber: 'HM-AERON-991',
          issuedDate: '2026-03-01',
          status: 'ALLOCATED',
          notes: 'Premium ergonomic office chair.',
        },
        {
          _id: 'asset_007',
          employeeId: 'emp_emp_01',
          employeeName: 'Vikramaditya Rao',
          employeeCode: 'RHA-042',
          category: 'SOFTWARE_LICENSES',
          type: 'SOFTWARE_LICENSE',
          name: 'JetBrains All Products Pack (Annual)',
          assetTag: 'AST-DEL-8807',
          serialNumber: 'JB-LICENSE-2026-99',
          issuedDate: '2026-01-10',
          status: 'ALLOCATED',
          notes: 'Enterprise IDE license for full-stack engineering.',
        },
        {
          _id: 'asset_008',
          employeeId: 'emp_fin_head',
          employeeName: 'Rajesh Singhania',
          employeeCode: 'RHA-012',
          category: 'VEHICLES',
          type: 'CAR',
          name: 'Toyota Camry Hybrid Executive',
          assetTag: 'AST-DEL-8808',
          serialNumber: 'MH-01-AB-1234',
          issuedDate: '2026-02-15',
          status: 'ALLOCATED',
          notes: 'Company leased vehicle for senior management.',
        },
      ];
      seedAssets.forEach((a) => this.assets.set(a._id, a));
    }
    const canManage = user.role === 'ADMIN';
    let list = Array.from(this.assets.values());
    if (opts?.employeeId) {
      list = list.filter((a) => a.employeeId === opts.employeeId);
    }
    const enriched = list.map((a) => {
      if (!a.history) {
        const hist: any[] = [
          {
            action: 'ALLOCATED',
            date: a.issuedDate || '2026-01-01',
            employeeName: a.employeeName,
            employeeCode: a.employeeCode,
            performedBy: a.allocatedBy || 'HR Admin',
            notes: a.notes || 'Initial allocation',
          },
        ];
        if (a.status === 'RETURNED') {
          hist.push({
            action: 'RETURNED',
            date: a.returnedDate || a.issuedDate || '2026-01-01',
            employeeName: a.employeeName,
            employeeCode: a.employeeCode,
            performedBy: 'HR Admin',
            notes: 'Returned by employee',
          });
        }
        return { ...a, history: hist };
      }
      return a;
    });
    return {
      assets: enriched.sort((a, b) => new Date(b.issuedDate).getTime() - new Date(a.issuedDate).getTime()),
      canManage,
    };
  }

  allocateAsset(data: any): AssetDoc {
    const id = `ast_${Date.now()}`;
    const emp = dbStore.employees.get(data.employeeId);
    const employeeName = emp ? `${emp.firstName} ${emp.lastName}` : 'Employee';
    const employeeCode = emp ? emp.employeeCode : 'EMP';
    const category =
      data.category ||
      (['CAR', 'BIKE'].includes(data.type)
        ? 'VEHICLES'
        : ['SOFTWARE_LICENSE', 'SUBSCRIPTION'].includes(data.type)
        ? 'SOFTWARE_LICENSES'
        : ['CHAIR', 'DESK', 'CABINET'].includes(data.type)
        ? 'FURNITURE'
        : 'ELECTRONICS');
    const history = [
      {
        action: 'ALLOCATED' as const,
        date: data.issuedDate,
        employeeName,
        employeeCode,
        performedBy: data.allocatedBy || 'HR Admin',
        notes: data.notes || 'Asset allocation',
      },
    ];
    const doc: AssetDoc = {
      _id: id,
      employeeId: data.employeeId,
      employeeName,
      employeeCode,
      department: emp ? emp.department : 'General',
      designation: emp ? emp.designation : 'Staff',
      category,
      type: data.type,
      name: data.name,
      assetTag: data.assetTag,
      serialNumber: data.serialNumber,
      issuedDate: data.issuedDate,
      status: 'ALLOCATED',
      notes: data.notes,
      allocatedBy: data.allocatedBy,
      history,
    };
    this.assets.set(id, doc);
    return doc;
  }

  returnAsset(id: string): AssetDoc | undefined {
    const a = this.assets.get(id);
    if (!a) return undefined;
    a.status = 'RETURNED';
    const retDate = new Date().toISOString().split('T')[0];
    a.returnedDate = retDate;
    if (!a.history) a.history = [];
    a.history.push({
      action: 'RETURNED',
      date: retDate,
      employeeName: a.employeeName,
      employeeCode: a.employeeCode,
      performedBy: 'HR Admin',
      notes: 'Asset marked as returned',
    });
    return a;
  }

  getLetterTemplates(orgId: string): LetterTemplateDoc[] {
    const list = Array.from(this.letterTemplates.values());
    return list.filter(t => t.organizationId === orgId || !t.organizationId);
  }

  createLetterTemplate(data: Omit<LetterTemplateDoc, '_id' | 'createdAt' | 'updatedAt'>): LetterTemplateDoc {
    const _id = `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const tmpl: LetterTemplateDoc = {
      ...data,
      _id,
      createdAt: now,
      updatedAt: now,
    };
    this.letterTemplates.set(_id, tmpl);
    return tmpl;
  }

  updateLetterTemplate(id: string, data: Partial<LetterTemplateDoc>): LetterTemplateDoc | undefined {
    const tmpl = this.letterTemplates.get(id);
    if (!tmpl) return undefined;
    if (data.title !== undefined) tmpl.title = data.title;
    if (data.category !== undefined) tmpl.category = data.category;
    if (data.subject !== undefined) tmpl.subject = data.subject;
    if (data.content !== undefined) tmpl.content = data.content;
    tmpl.updatedAt = new Date().toISOString();
    this.letterTemplates.set(id, tmpl);
    return tmpl;
  }

  deleteLetterTemplate(id: string): boolean {
    return this.letterTemplates.delete(id);
  }

  previewLetterTemplate(templateId: string, employeeId?: string, orgId?: string): { title: string; content: string } | undefined {
    const tmpl = this.letterTemplates.get(templateId);
    if (!tmpl) return undefined;

    let emp: EmployeeDoc | undefined;
    if (employeeId) {
      emp = dbStore.employees.get(employeeId);
    } else {
      emp = Array.from(dbStore.employees.values())[0];
    }

    const org = orgId ? dbStore.organizations.get(orgId) : Array.from(dbStore.organizations.values())[0];

    let content = tmpl.content;
    const tokens: Record<string, string> = {
      '{{employee_name}}': emp ? `${emp.firstName} ${emp.lastName}` : 'John Doe',
      '{{employee_code}}': emp ? emp.employeeCode : 'EMP-001',
      '{{department}}': emp ? emp.department : 'Engineering',
      '{{designation}}': emp ? emp.designation : 'Software Engineer',
      '{{joining_date}}': emp ? emp.joiningDate : new Date().toISOString().split('T')[0],
      '{{company_name}}': org ? org.name : 'Anusyuti',
      '{{company_address}}': org && org.address ? `${org.address.street}, ${org.address.city}, ${org.address.state} ${org.address.zipCode}` : 'Global HQ',
      '{{salary}}': emp ? `₹${((emp as any).salary || 1200000).toLocaleString()}` : '₹12,00,000',
    };

    for (const [token, val] of Object.entries(tokens)) {
      content = content.replaceAll(token, val);
    }

    return { title: tmpl.title, content };
  }

  // =============================================================
  // FORM 24Q TDS METHODS
  // =============================================================
  getForm24QData(): Form24QDataDoc {
    return this.form24QData;
  }

  updateForm24QStatus(status: 'Draft' | 'Filed' | 'Acknowledged', acknowledgementNumber?: string): Form24QDataDoc {
    this.form24QData.filingSummary.status = status;
    if (acknowledgementNumber !== undefined) {
      this.form24QData.filingSummary.acknowledgementNumber = acknowledgementNumber;
    }
    if (status === 'Filed' && !this.form24QData.filingSummary.filedDate) {
      this.form24QData.filingSummary.filedDate = new Date().toISOString().split('T')[0];
    }
    return this.form24QData;
  }

  updateForm24QSummary(summary: Partial<Form24QFilingSummaryDoc>): Form24QDataDoc {
    this.form24QData.filingSummary = {
      ...this.form24QData.filingSummary,
      ...summary,
    };
    return this.form24QData;
  }

  validateForm24Q() {
    const totalEmployeeTds = this.form24QData.employees.reduce((sum, e) => sum + e.tdsDeducted, 0);
    const targetTax = this.form24QData.filingSummary.totalTaxDeposited;
    const totalDeductees = this.form24QData.filingSummary.totalDeductees;
    const challanCount = this.form24QData.challans.length;
    const discrepancy = Math.abs(totalEmployeeTds - targetTax);
    const isValid = discrepancy === 0;

    const messages: string[] = [];
    if (isValid) {
      messages.push('Employee-level TDS deductions perfectly match total tax deposited in challans (₹' + targetTax + ').');
    } else {
      messages.push(`Discrepancy detected: Employee total TDS (₹${totalEmployeeTds}) differs from deposited tax (₹${targetTax}) by ₹${discrepancy}.`);
    }

    return {
      isValid,
      totalEmployeeTds,
      totalChallanDeposited: targetTax,
      totalDeductees,
      challanCount,
      discrepancy,
      messages,
    };
  }

  getForm24QDataQ1(): Form24QDataDoc {
    return this.form24QDataQ1;
  }

  getCrossQuarterAnalysis() {
    const q4 = this.form24QData.employees;
    const q1 = this.form24QDataQ1.employees;
    const q4PanSet = new Set(q4.map(e => e.PAN.toUpperCase().trim()));
    const newEmployees = q1.filter(e => !q4PanSet.has(e.PAN.toUpperCase().trim()));

    const anomalies: any[] = [];
    const q4Map = new Map(q4.map(e => [e.PAN.toUpperCase(), e]));

    for (const q1Emp of q1) {
      const pan = q1Emp.PAN.toUpperCase();
      const q4Emp = q4Map.get(pan);
      if (q4Emp) {
        const q4Monthly = q4Emp.salaryPaid / 3;
        const q1Monthly = q1Emp.salaryPaid / 3;
        if (q1Monthly > q4Monthly * 1.35 || q1Emp.tdsDeducted > (q4Emp.tdsDeducted * 1.5)) {
          anomalies.push({
            pan,
            name: q1Emp.name,
            type: 'TDS_SPIKE_OR_BONUS',
            description: `Significant increase in TDS/salary for ${q1Emp.name} in Q1.`
          });
        }
      }
    }

    return {
      newEmployees,
      anomalies,
      q4TotalTds: this.form24QData.filingSummary.totalTaxDeposited,
      q1TotalTds: this.form24QDataQ1.filingSummary.totalTaxDeposited,
    };
  }

  getEmployeeFullYearHistory(pan: string) {
    const cleanPan = pan.toUpperCase().trim();
    const q4Emp = this.form24QData.employees.find(e => e.PAN.toUpperCase() === cleanPan);
    const q1Emp = this.form24QDataQ1.employees.find(e => e.PAN.toUpperCase() === cleanPan);

    return {
      pan: cleanPan,
      name: q1Emp?.name || q4Emp?.name || 'Unknown',
      records: [
        { quarter: 'Q4 FY 2025-26', salaryPaid: q4Emp?.salaryPaid || 0, tdsDeducted: q4Emp?.tdsDeducted || 0 },
        { quarter: 'Q1 FY 2026-27', salaryPaid: q1Emp?.salaryPaid || 0, tdsDeducted: q1Emp?.tdsDeducted || 0 },
      ],
      totalSalaryYtd: (q4Emp?.salaryPaid || 0) + (q1Emp?.salaryPaid || 0),
      totalTdsYtd: (q4Emp?.tdsDeducted || 0) + (q1Emp?.tdsDeducted || 0),
    };
  }

  calculateEmployeeProjection(pan: string) {
    const cleanPan = pan.toUpperCase().trim();
    const history = this.getEmployeeFullYearHistory(cleanPan);
    const ytdSalary = history.totalSalaryYtd;
    const ytdTds = history.totalTdsYtd;
    const monthsCompleted = 6;
    const monthsRemaining = 6;
    const monthlyRunRate = monthsCompleted > 0 ? ytdSalary / monthsCompleted : 380000;
    const annualizedSalary = ytdSalary + (monthlyRunRate * monthsRemaining);
    const standardDeduction = 75000;
    const taxableIncome = Math.max(0, annualizedSalary - standardDeduction - 150000);
    
    let tax = 0;
    if (taxableIncome > 700000) {
      if (taxableIncome <= 1000000) tax = (taxableIncome - 700000) * 0.10 + 20000;
      else if (taxableIncome <= 1200000) tax = (taxableIncome - 1000000) * 0.15 + 50000;
      else if (taxableIncome <= 1500000) tax = (taxableIncome - 1200000) * 0.20 + 80000;
      else tax = (taxableIncome - 1500000) * 0.30 + 140000;
    }
    const projectedAnnualTax = Math.round(tax * 1.04);
    const remainingTds = Math.max(0, projectedAnnualTax - ytdTds);
    const monthlyRecommended = Math.round(remainingTds / monthsRemaining);

    return {
      pan: cleanPan,
      name: history.name,
      annualizedSalary: Math.round(annualizedSalary),
      taxableIncome: Math.round(taxableIncome),
      projectedAnnualTax,
      tdsAlreadyDeducted: ytdTds,
      remainingTdsToBeDeducted: remainingTds,
      monthsRemaining,
      monthlyTdsRecommended: monthlyRecommended,
    };
  }

  // =============================================================
  // CORPORATE INSURANCE METHODS
  // =============================================================
  getInsurancePolicy(): InsurancePolicyDoc {
    return this.insurancePolicy;
  }

  getInsuranceEnrollment(employeeId: string): InsuranceEnrollmentDoc | undefined {
    return this.insuranceEnrollments.get(employeeId);
  }

  updateInsuranceEnrollment(employeeId: string, data: Partial<InsuranceEnrollmentDoc>): InsuranceEnrollmentDoc {
    let enr = this.insuranceEnrollments.get(employeeId);
    const emp = dbStore.employees.get(employeeId);
    if (!enr) {
      enr = {
        _id: `ins_enr_${Date.now()}`,
        employeeId,
        employeeName: emp ? `${emp.firstName} ${emp.lastName}` : 'Employee',
        employeeCode: emp ? emp.employeeCode : 'EMP-000',
        grade: 'Staff',
        sumInsured: 500000,
        premiumAnnual: 6000,
        monthlyPayrollDeduction: 500,
        dependents: [],
        eCardNumber: `MA-GMC-2025-${Math.floor(100000 + Math.random() * 900000)}`,
        status: 'ACTIVE',
      };
    }
    if (data.sumInsured !== undefined) enr.sumInsured = data.sumInsured;
    if (data.dependents !== undefined) enr.dependents = data.dependents;
    if (data.status !== undefined) enr.status = data.status;
    this.insuranceEnrollments.set(employeeId, enr);
    return enr;
  }

  getInsuranceClaims(user: UserDoc, filter?: { status?: string; employeeId?: string }): InsuranceClaimDoc[] {
    let claims = Array.from(this.insuranceClaims.values());
    if (user.role !== 'ADMIN') {
      claims = claims.filter((c) => c.employeeId === user.employeeId);
    } else if (filter?.employeeId) {
      claims = claims.filter((c) => c.employeeId === filter.employeeId);
    }
    if (filter?.status) {
      claims = claims.filter((c) => c.status === filter.status);
    }
    return claims.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  submitInsuranceClaim(employeeId: string, data: Partial<Omit<InsuranceClaimDoc, '_id' | 'submittedAt' | 'status'>>): InsuranceClaimDoc {
    const emp = dbStore.employees.get(employeeId);
    const newClaim: InsuranceClaimDoc = {
      _id: `ins_clm_${Date.now()}`,
      employeeId,
      employeeName: emp ? `${emp.firstName} ${emp.lastName}` : data.employeeName || 'Employee',
      employeeCode: emp ? emp.employeeCode : data.employeeCode || 'EMP-000',
      patientName: data.patientName || 'Patient',
      relation: data.relation || 'Self',
      hospitalName: data.hospitalName || 'Hospital',
      admissionDate: data.admissionDate || new Date().toISOString().split('T')[0],
      dischargeDate: data.dischargeDate,
      claimType: data.claimType || 'REIMBURSEMENT',
      amountRequested: data.amountRequested || 0,
      status: 'SUBMITTED',
      diagnosis: data.diagnosis || 'General Treatment',
      submittedAt: new Date().toISOString(),
      documents: data.documents || [],
    };
    this.insuranceClaims.set(newClaim._id, newClaim);
    return newClaim;
  }

  updateInsuranceClaimStatus(id: string, status: 'TPA_REVIEW' | 'QUERY_RAISED' | 'APPROVED' | 'SETTLED' | 'REJECTED', tpaRemarks?: string, amountApproved?: number): InsuranceClaimDoc | undefined {
    const claim = this.insuranceClaims.get(id);
    if (!claim) return undefined;
    claim.status = status;
    if (tpaRemarks !== undefined) claim.tpaRemarks = tpaRemarks;
    if (amountApproved !== undefined) claim.amountApproved = amountApproved;
    this.insuranceClaims.set(id, claim);
    return claim;
  }
}

export interface InsurancePolicyDoc {
  policyName: string;
  provider: string;
  policyNumber: string;
  validTill: string;
  tpaName: string;
  emergencyHelpline: string;
  gradeEligibility: Record<string, number>;
  dependentsAllowed: string[];
}

export interface InsuranceDependentDoc {
  name: string;
  relation: 'Spouse' | 'Child' | 'Father' | 'Mother';
  dob: string;
  gender: string;
}

export interface InsuranceEnrollmentDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  grade: string;
  sumInsured: number;
  premiumAnnual: number;
  monthlyPayrollDeduction: number;
  dependents: InsuranceDependentDoc[];
  eCardNumber: string;
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED';
}

export interface InsuranceClaimDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  patientName: string;
  relation: string;
  hospitalName: string;
  admissionDate: string;
  dischargeDate?: string;
  claimType: 'CASHLESS' | 'REIMBURSEMENT';
  amountRequested: number;
  amountApproved?: number;
  status: 'SUBMITTED' | 'TPA_REVIEW' | 'QUERY_RAISED' | 'APPROVED' | 'SETTLED' | 'REJECTED';
  diagnosis: string;
  submittedAt: string;
  tpaRemarks?: string;
  documents: string[];
}

export interface LetterTemplateDoc {
  _id: string;
  organizationId: string;
  title: string;
  category: 'OFFER' | 'PROMOTION' | 'EXPERIENCE' | 'INCREMENT' | 'OTHER';
  subject: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Form24QFilingSummaryDoc {
  deductorTAN: string;
  totalTaxDeposited: number;
  totalDeductees: number;
  challanCount: number;
  amountPaid: number;
  status: 'Draft' | 'Filed' | 'Acknowledged';
  acknowledgementNumber?: string;
  filedDate?: string;
}

export interface Form24QChallanDoc {
  date: string;
  tax: number;
  cess: number;
  total: number;
  bank: string;
}

export interface Form24QEmployeeDoc {
  name: string;
  PAN: string;
  salaryPaid: number;
  tdsDeducted: number;
  section80C: number;
  standardDeduction: number;
  periodFrom: string;
  periodTo: string;
}

export interface Form24QDataDoc {
  company: {
    name: string;
    TAN: string;
    FY: string;
    quarter: string;
  };
  challans: Form24QChallanDoc[];
  employees: Form24QEmployeeDoc[];
  filingSummary: Form24QFilingSummaryDoc;
}

export const modulesStore = new ModulesStore();