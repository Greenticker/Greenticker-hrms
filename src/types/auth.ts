export type Role = 'ADMIN' | 'EMPLOYEE' | 'HR' | 'MANAGER';

export interface EmployeeProfile {
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
  department: string;
  designation: string;
  reportingManagerId?: string;
  joiningDate: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
  status: 'ACTIVE' | 'PROBATION' | 'NOTICE' | 'TERMINATED' | 'ON_LEAVE';
  shift: string;
  location: string;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  organizationId: string;
  employeeId?: string;
  onboardingCompleted: boolean;
  onboardingStep: number;
  orgSetupCompleted: boolean;
  orgSetupStep: number;
  orgLogoUrl?: string;
  permissions: string[];
  employee?: EmployeeProfile;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user: User;
}

export interface Organization {
  _id: string;
  name: string;
  code: string;
  domain: string;
  address: {
    street: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
  };
  contactEmail: string;
  phone: string;
  taxIdentificationNumber: string;
}
