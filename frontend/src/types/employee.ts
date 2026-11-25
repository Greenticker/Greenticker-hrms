export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
export type EmploymentStatus = 'PERMANENT' | 'PROBATION' | 'TEMPORARY' | 'ACTIVE' | 'NOTICE' | 'TERMINATED' | 'ON_LEAVE';

export interface Address {
  line: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  alternatePhone?: string;
  address?: string;
}

export interface BankInformation {
  bankName: string;
  accountHolder: string;
  accountNumberMasked: string;
  accountNumber?: string;
  ifsc: string;
  branch: string;
}

export interface StatutoryInformation {
  panMasked: string;
  panNumber?: string;
  uanMasked: string;
  uanNumber?: string;
  esiMasked?: string;
  esiNumber?: string;
  aadhaarMasked?: string;
  aadhaarNumber?: string;
}

export interface Employee {
  _id: string;
  userId: string;
  organizationId: string;
  employeeCode: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: string;
  dob: string;
  bloodGroup: string;
  personalEmail: string;
  workEmail: string;
  phone: string;
  alternatePhone?: string;
  department: string;
  departmentId?: string;
  subdepartment?: string;
  designation: string;
  designationId?: string;
  reportingManagerId?: string;
  reportingManagerName?: string;
  joiningDate: string;
  employmentType: EmploymentType;
  status: EmploymentStatus;
  probationMonths?: number;
  probationEndDate?: string;
  shift: string;
  location: string;
  locationId?: string;
  currentAddress?: Address;
  permanentAddress?: Address;
  emergencyContact?: EmergencyContact;
  bankInfo?: BankInformation;
  statutory?: StatutoryInformation;
  avatarUrl?: string;
  bio?: string;
  annualSalary?: number;
  grade?: string;
  extension?: string;
  /** How much bank / statutory data the viewer gets: FULL, MASKED (e.g. auditors) or NONE (manager viewing a reportee). */
  sensitiveAccess?: 'FULL' | 'MASKED' | 'NONE';
  /** For a manager's team list: whether this person reports directly or further down the line. */
  teamRelation?: 'DIRECT' | 'INDIRECT';
  /** Salary account change waiting for HR verification (maker-checker); payroll keeps using bankInfo until then. */
  pendingBankChange?: BankChangeRequest;
  bankChangeHistory?: BankChangeRequest[];
  createdByName?: string;
}

export interface BankChangeRequest {
  bankName: string;
  accountHolder: string;
  accountNumber?: string;
  accountNumberMasked?: string;
  ifsc: string;
  branch?: string;
  reason?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedByName: string;
  requestedAt: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewComment?: string;
}

/** Public directory entry: what every employee may see about a colleague. */
export interface DirectoryEntry {
  _id: string;
  employeeCode?: string;
  firstName: string;
  lastName: string;
  department?: string;
  designation?: string;
  workEmail?: string;
  extension?: string;
  location?: string;
}

export interface Grade {
  _id: string;
  code: string;
  name: string;
  rank?: number;
  description?: string;
  memberCount?: number;
}

export interface ImportRowResult {
  row: number;
  name: string;
  workEmail?: string;
  status: 'IMPORTED' | 'FAILED' | 'VALID';
  employeeCode?: string;
  errors?: string[];
}

export interface ImportResponse {
  success: boolean;
  summary: { totalRows: number; imported: number; valid: number; failed: number; dryRun: boolean };
  results: ImportRowResult[];
}

export interface Subdepartment {
  _id: string;
  name: string;
  code?: string;
  departmentId?: string;
  departmentName: string;
  description?: string;
  memberCount?: number;
}

export interface Department {
  _id: string;
  name: string;
  code: string;
  headEmployeeId?: string;
  headName?: string;
  memberCount: number;
  description?: string;
  subdepartments?: string[];
}

export interface Designation {
  _id: string;
  title: string;
  code?: string;
  departmentName?: string;
  department?: string;
  subdepartment?: string;
  level: string;
  memberCount: number;
  description?: string;
  status?: 'ACTIVE' | 'ENDED';
  endedAt?: string;
  endedBy?: string;
  endReason?: string;
  createdAt?: string;
}

export interface Location {
  _id: string;
  name: string;
  street?: string;
  city: string;
  state: string;
  country: string;
  zipCode?: string;
  departments?: string[];
  subdepartments?: string[];
  isHeadquarters: boolean;
}

export interface OrgTreeNode {
  employeeId: string;
  employeeCode: string;
  name: string;
  designation: string;
  department: string;
  subdepartment?: string;
  status: EmploymentStatus;
  avatarInitials: string;
  reports: OrgTreeNode[];
}
