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
