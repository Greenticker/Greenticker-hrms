// -------------------------------------------------------------
// LEAVE MANAGEMENT TYPES
// -------------------------------------------------------------
export type LeaveType = 'CASUAL' | 'SICK' | 'EARNED' | 'MATERNITY' | 'PATERNITY' | 'UNPAID';

export interface LeaveBalance {
  casual: { total: number; used: number; remaining: number };
  sick: { total: number; used: number; remaining: number };
  earned: { total: number; used: number; remaining: number };
  maternity: { total: number; used: number; remaining: number };
  paternity: { total: number; used: number; remaining: number };
  unpaid: { used: number };
}

export interface LeaveRequest {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  leaveType: LeaveType;
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
// EXPENSE CLAIMS TYPES
// -------------------------------------------------------------
export type ExpenseCategory =
  | 'TRAVEL'
  | 'MEALS'
  | 'INTERNET'
  | 'OFFICE_SUPPLIES'
  | 'LEARNING'
  | 'CLIENT_ENTERTAINMENT'
  | 'OTHER';

export interface ExpenseClaim {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  title: string;
  category: ExpenseCategory;
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
// PAYROLL TYPES
// -------------------------------------------------------------
export interface Payslip {
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
  month: string;
  monthName: string;
  payDate: string;
  workedDays: number;
  lopDays: number;
  basicSalary: number;
  hra: number;
  specialAllowance: number;
  conveyanceAllowance: number;
  medicalAllowance: number;
  performanceBonus: number;
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
// TAX DECLARATION TYPES
// -------------------------------------------------------------
export interface TaxDeclaration {
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
// POLICY TYPES
// -------------------------------------------------------------
export type PolicyCategory =
  | 'COMPLIANCE'
  | 'CONDUCT'
  | 'SECURITY'
  | 'HR'
  | 'REMOTE';

export interface PolicyItem {
  _id: string;
  title: string;
  category: PolicyCategory;
  version: string;
  summary: string;
  content: string;
  mandatory: boolean;
  effectiveDate: string;
  lastUpdated: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  createdByName?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}

export interface PolicyAcknowledgement {
  _id: string;
  policyId: string;
  employeeId?: string;
  employeeName?: string;
  userId?: string;
  acknowledgedAt: string;
  acknowledgedBy?: string;
  acknowledgedByName?: string;
  ipAddress?: string;
  digitalSignature?: string;
  userAgent?: string;
}

// -------------------------------------------------------------
// POSH CASE TYPES (Rule 21 strictly confidential)
// -------------------------------------------------------------
export interface PoshCase {
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
// HOLIDAYS & ANNOUNCEMENTS
// -------------------------------------------------------------
export interface HolidayItem {
  _id: string;
  name: string;
  date: string;
  dayOfWeek: string;
  type: 'MANDATORY' | 'RESTRICTED';
  description: string;
}

export interface AnnouncementItem {
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
// PERFORMANCE, RECRUITMENT, HR SERVICE DESK, FULL & FINAL
// -------------------------------------------------------------
export interface PerformanceReview {
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

export interface JobOpening {
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

export interface JobCandidate {
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
  interviewFeedbacks?: {
    round: 'TECHNICAL_INTERVIEW' | 'HR_INTERVIEW';
    rating: number;
    comments: string;
    recommendation: 'NEXT_ROUND' | 'REJECT';
    submittedAt: string;
    submittedBy: string;
  }[];
  interview?: {
    date: string;
    time: string;
    durationMinutes: number;
    mode: 'IN_PERSON' | 'VIDEO' | 'PHONE';
    locationOrLink: string;
    interviewer: string;
    notes?: string;
    emailSentAt?: string;
    emailStatus: 'SENT' | 'SIMULATED' | 'FAILED';
    scheduledBy: string;
  };
  offer?: {
    annualCtc: number;
    designation: string;
    joiningDate: string;
    validTill: string;
    location: string;
    reportingTo?: string;
    notes?: string;
    emailSentAt?: string;
    emailStatus: 'SENT' | 'SIMULATED' | 'FAILED';
    extendedBy: string;
  };
}

export interface EmailResult {
  delivered: boolean;
  simulated: boolean;
  messageId?: string;
  error?: string;
}

export interface InterviewInput {
  date: string;
  time: string;
  durationMinutes: number;
  mode: 'IN_PERSON' | 'VIDEO' | 'PHONE';
  locationOrLink: string;
  interviewer: string;
  notes?: string;
}

export interface OfferInput {
  annualCtc: number;
  designation: string;
  joiningDate: string;
  validTill: string;
  location?: string;
  reportingTo?: string;
  notes?: string;
}

export interface Requirement {
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

export interface RequirementInput {
  title: string;
  department?: string;
  positions: number;
  employmentType: Requirement['employmentType'];
  experienceRequired: string;
  skillsRequired: string;
  priority: Requirement['priority'];
  expectedJoiningDate?: string;
  budgetRange?: string;
  location?: string;
  justification: string;
}

export type AssetCategory = 'ELECTRONICS' | 'FURNITURE' | 'SOFTWARE_LICENSES' | 'VEHICLES' | 'OTHER';

export type AssetType =
  | 'LAPTOP'
  | 'CHARGER'
  | 'PHONE'
  | 'TABLET'
  | 'HEADSET'
  | 'CHAIR'
  | 'DESK'
  | 'CABINET'
  | 'SOFTWARE_LICENSE'
  | 'SUBSCRIPTION'
  | 'CAR'
  | 'BIKE'
  | 'OTHER';

export interface AllocatedAsset {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  designation: string;
  category: AssetCategory;
  type: AssetType;
  name: string;
  assetTag: string;
  serialNumber?: string;
  issuedDate: string;
  status: 'ALLOCATED' | 'RETURNED';
  returnedDate?: string;
  notes?: string;
  allocatedBy: string;
  history?: {
    action: 'ALLOCATED' | 'RETURNED' | 'REASSIGNED';
    date: string;
    employeeName: string;
    employeeCode: string;
    performedBy?: string;
    notes?: string;
  }[];
}

export interface SalaryStructureResponse {
  employee: {
    _id: string;
    name: string;
    employeeCode: string;
    designation: string;
    department: string;
  };
  annualCtc: number;
  employees?: { _id: string; name: string; employeeCode: string; annualCtc: number }[];
  canEditCtc: boolean;
}

export type ReferralStatus = 'SUBMITTED' | 'IN_REVIEW' | 'SHORTLISTED' | 'HIRED' | 'NOT_SELECTED';

export interface Referral {
  _id: string;
  fullName: string;
  email: string; // empty unless canViewPrivate
  phone?: string;
  city: string;
  experienceYears: number;
  jobId?: string;
  jobTitle?: string;
  relationship?: string;
  notes?: string;
  resumeFileName?: string;
  hasResume: boolean;
  status: ReferralStatus;
  referredByName: string;
  referredByRole: string;
  createdAt: string;
  canViewPrivate: boolean;
  isMine: boolean;
}

export interface HrRequest {
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

export interface FullFinalSettlement {
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
// CORPORATE EMPLOYEE INSURANCE MANAGEMENT TYPES
// -------------------------------------------------------------
export interface InsuranceDependent {
  name: string;
  relation: 'Spouse' | 'Child' | 'Father' | 'Mother';
  dob: string;
  gender: string;
}

export interface InsurancePolicy {
  policyName: string;
  provider: string;
  policyNumber: string;
  validTill: string;
  tpaName: string;
  emergencyHelpline: string;
  gradeEligibility: Record<string, number>;
  dependentsAllowed: string[];
}

export interface InsuranceEnrollment {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  grade: string;
  sumInsured: number;
  premiumAnnual: number;
  monthlyPayrollDeduction: number;
  dependents: InsuranceDependent[];
  eCardNumber: string;
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED';
}

export type InsuranceClaimStatus = 'SUBMITTED' | 'TPA_REVIEW' | 'QUERY_RAISED' | 'APPROVED' | 'SETTLED' | 'REJECTED';

export interface InsuranceClaim {
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
  status: InsuranceClaimStatus;
  diagnosis: string;
  submittedAt: string;
  tpaRemarks?: string;
  documents: string[];
}

export interface Form24QFilingSummary {
  deductorTAN: string;
  totalTaxDeposited: number;
  totalDeductees: number;
  challanCount: number;
  amountPaid: number;
  status: 'Draft' | 'Filed' | 'Acknowledged';
  acknowledgementNumber?: string;
  filedDate?: string;
}

export interface Form24QChallan {
  date: string;
  tax: number;
  cess: number;
  total: number;
  bank: string;
}

export interface Form24QEmployee {
  name: string;
  PAN: string;
  salaryPaid: number;
  tdsDeducted: number;
  section80C: number;
  standardDeduction: number;
  periodFrom: string;
  periodTo: string;
}

export interface Form24QData {
  company: {
    name: string;
    TAN: string;
    FY: string;
    quarter: string;
  };
  challans: Form24QChallan[];
  employees: Form24QEmployee[];
  filingSummary: Form24QFilingSummary;
}