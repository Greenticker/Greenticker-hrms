import bcrypt from 'bcryptjs';
import { computeShiftCredit, grossMinutesBetween, type ExtraPayTier } from './overtime.js';
import { distanceFromOffice, isWithinOffice, isValidFix, type GeoFix } from './geofence.js';

export interface UserDoc {
  _id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'EMPLOYEE';
  organizationId: string;
  employeeId?: string;
  onboardingCompleted: boolean;
  onboardingStep: number;
  orgSetupCompleted?: boolean;
  orgSetupStep?: number;
  isActive: boolean;
  passwordPending?: boolean;
  passwordSetAt?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export const INVITE_TTL_HOURS = 48;

export interface OrganizationDoc {
  _id: string;
  name: string;
  code: string;
  domain: string;
  logoUrl?: string;
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
  createdAt: string;
}

export interface DepartmentDoc {
  _id: string;
  name: string;
  code: string;
  headEmployeeId?: string;
  headName?: string;
  description: string;
  createdAt: string;
}

export interface DesignationDoc {
  _id: string;
  title: string;
  departmentName: string;
  level: string;
}

export interface LocationDoc {
  _id: string;
  name: string;
  street?: string;
  city: string;
  state: string;
  country: string;
  zipCode?: string;
  isHeadquarters: boolean;
}

export interface EmployeeDoc {
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
  designation: string;
  reportingManagerId?: string;
  reportingManagerName?: string;
  joiningDate: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
  status: 'ACTIVE' | 'PROBATION' | 'NOTICE' | 'TERMINATED' | 'ON_LEAVE';
  shift: string;
  location: string;
  annualSalary?: number;
  bio?: string;
  currentAddress?: {
    line: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
  permanentAddress?: {
    line: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
    alternatePhone?: string;
    address?: string;
  };
  bankInfo?: {
    bankName: string;
    accountHolder: string;
    accountNumberMasked: string;
    accountNumber?: string;
    ifsc: string;
    branch: string;
  };
  statutory?: {
    panMasked: string;
    panNumber?: string;
    uanMasked: string;
    uanNumber?: string;
    esiMasked?: string;
    esiNumber?: string;
  };
}

export interface AuditLogDoc {
  _id: string;
  userId: string;
  userEmail: string;
  role: string;
  action: string;
  module: string;
  entity: string;
  entityId: string;
  details?: Record<string, any>;
  ipAddress?: string;
  timestamp: string;
}

export interface NotificationDoc {
  _id: string;
  recipientUserId: string;
  title: string;
  message: string;
  type: 'LEAVE' | 'EXPENSE' | 'ONBOARDING' | 'POLICY' | 'PAYROLL' | 'ANNOUNCEMENT' | 'SYSTEM';
  isRead: boolean;
  linkUrl?: string;
  createdAt: string;
}

export interface OnboardingDocumentDoc {
  id: string;
  category: string;
  documentName: string;
  fileName: string;
  fileSize: string;
  fileType: string;
  uploadedAt: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REVISION_REQUESTED';
  verifiedBy?: string;
  verifiedAt?: string;
  remarks?: string;
}

export interface PolicyConsentDoc {
  policyId: string;
  policyTitle: string;
  version: string;
  acknowledgedAt: string;
  ipAddress: string;
  deviceInfo: string;
  acknowledged: boolean;
}

export interface OnboardingSubmissionDoc {
  _id: string;
  userId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  designation: string;
  workEmail: string;
  personalEmail: string;
  phone: string;
  currentStep: number;
  totalSteps: number;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'VERIFIED' | 'NEEDS_CORRECTION';
  submittedAt?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  rejectionRemarks?: string;
  sectionsData: Record<string, Record<string, any>>;
  documents: OnboardingDocumentDoc[];
  policyAcknowledgements: PolicyConsentDoc[];
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  category: 'IDENTITY' | 'EDUCATION' | 'EMPLOYMENT' | 'CERTIFICATION' | 'TAX' | 'LEGAL';
  title: string;
  fileName: string;
  fileType: string;
  fileSize: string;
  fileUrl?: string;
  expiryDate?: string;
  uploadedBy: string;
  uploadedAt: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REVISION_REQUESTED';
  verifiedBy?: string;
  verifiedAt?: string;
  rejectionReason?: string;
}

export interface LifecycleEventDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  eventType: 'PROMOTION' | 'TRANSFER' | 'DESIGNATION_CHANGE' | 'MANAGER_CHANGE' | 'SALARY_REVISION' | 'CONFIRMATION' | 'STATUS_CHANGE';
  effectiveDate: string;
  previousValue: string;
  newValue: string;
  reason: string;
  initiatedBy: string;
  initiatedAt: string;
  approvalStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
  notes?: string;
}

export interface ShiftDoc {
  _id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  expectedHours: number;
  breakMinutes: number;
  gracePeriodMinutes: number;
  isNightShift: boolean;
  departments: string[];
  isActive: boolean;
  createdAt: string;
}

export interface AttendanceRecordDoc {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  date: string;
  shiftName: string;
  shiftExpectedHours: number;
  checkInTime?: string;
  checkOutTime?: string;
  totalMinutesWorked: number;
  breakMinutes: number;
  effectiveWorkingHours: number;
  /** Minutes beyond the 8h shift. Informational only - pay comes from extraDayCredit. */
  overtimeMinutes: number;
  overtimeHours: number;
  isNightShift?: boolean;
  /** Extra salary days earned for this shift: 0, 0.5, 1 or 1.5 */
  extraDayCredit?: number;
  extraPayTier?: ExtraPayTier;
  status: 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'WORK_FROM_HOME';
  workMode?: 'WORK_FROM_OFFICE' | 'WORK_FROM_HOME';
  checkInDistanceKm?: number;
  checkOutDistanceKm?: number;
  isRegularized?: boolean;
  regularizationReason?: string;
  regularizedBy?: string;
  location?: string;
  checkOutLocation?: string;
  ipAddress?: string;
  notes?: string;
}

class InMemoryMongoStore {
  users: Map<string, UserDoc> = new Map();
  employees: Map<string, EmployeeDoc> = new Map();
  organizations: Map<string, OrganizationDoc> = new Map();
  departments: Map<string, DepartmentDoc> = new Map();
  designations: Map<string, DesignationDoc> = new Map();
  locations: Map<string, LocationDoc> = new Map();
  onboardingSubmissions: Map<string, OnboardingSubmissionDoc> = new Map();
  documents: Map<string, DocumentDoc> = new Map();
  lifecycleEvents: LifecycleEventDoc[] = [];
  shifts: Map<string, ShiftDoc> = new Map();
  attendanceRecords: Map<string, AttendanceRecordDoc> = new Map();
  auditLogs: AuditLogDoc[] = [];
  notifications: NotificationDoc[] = [];

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData() {
    const orgId = 'org_zenith_hq';
    const org: OrganizationDoc = {
      _id: orgId,
      name: 'Greenticker Financial Services LLP',
      code: 'GREENTICKER-HQ',
      domain: 'greenticker.in',
      address: {
        street: 'Office no 402, Multicon Square, Near Mehendale Garage, Erandwane, Karvenagar',
        city: 'Pune',
        state: 'Maharashtra',
        country: 'India',
        zipCode: '411004',
      },
      contactEmail: 'omkar@greenticker.in',
      phone: '+91 80 4123 4567',
      taxIdentificationNumber: 'GSTIN: 29AABCR1234F1Z5',
      createdAt: new Date().toISOString(),
    };
    this.organizations.set(orgId, org);

    // Departments
    const depts: DepartmentDoc[] = [
      {
        _id: 'dept_exec',
        name: 'Executive Board',
        code: 'EXEC',
        headEmployeeId: 'emp_admin_01',
        headName: 'Ananya Mehta',
        description: 'Strategic leadership, corporate governance, and executive decisions.',
        createdAt: '2020-01-01T00:00:00Z',
      },
      {
        _id: 'dept_eng',
        name: 'Engineering & Technology',
        code: 'ENG',
        headEmployeeId: 'emp_mgr_01',
        headName: 'Arjun Khanna',
        description: 'Core software platform, cloud infrastructure, and security engineering.',
        createdAt: '2020-01-01T00:00:00Z',
      },
      {
        _id: 'dept_prod',
        name: 'Product & Design',
        code: 'PROD',
        headEmployeeId: 'emp_prod_head',
        headName: 'Kavita Menon',
        description: 'Product lifecycle, UX research, UI design, and design systems.',
        createdAt: '2020-01-01T00:00:00Z',
      },
      {
        _id: 'dept_hr',
        name: 'People Operations & HR',
        code: 'HR',
        headEmployeeId: 'emp_hr_01',
        headName: 'Aditya Kapoor',
        description: 'Talent acquisition, employee experience, benefits, and statutory compliance.',
        createdAt: '2020-01-01T00:00:00Z',
      },
      {
        _id: 'dept_fin',
        name: 'Finance & Compliance',
        code: 'FIN',
        headEmployeeId: 'emp_fin_head',
        headName: 'Rajesh Singhania',
        description: 'Corporate payroll, accounting, tax planning, and statutory audit.',
        createdAt: '2020-01-01T00:00:00Z',
      },
    ];
    depts.forEach((d) => this.departments.set(d._id, d));

    // Designations
    const desigs: DesignationDoc[] = [
      { _id: 'desig_01', title: 'Chief Executive Officer', departmentName: 'Executive Board', level: 'L8 - Executive' },
      { _id: 'desig_02', title: 'Director of Platform Engineering', departmentName: 'Engineering & Technology', level: 'L7 - Director' },
      { _id: 'desig_03', title: 'Senior HR Operations Lead', departmentName: 'People Operations & HR', level: 'L5 - Lead' },
      { _id: 'desig_04', title: 'Senior Frontend Engineer', departmentName: 'Engineering & Technology', level: 'L4 - Senior' },
      { _id: 'desig_05', title: 'Product Designer', departmentName: 'Product & Design', level: 'L3 - Mid' },
      { _id: 'desig_06', title: 'DevOps & Cloud Engineer', departmentName: 'Engineering & Technology', level: 'L4 - Senior' },
      { _id: 'desig_07', title: 'Technical Recruiter', departmentName: 'People Operations & HR', level: 'L3 - Mid' },
      { _id: 'desig_08', title: 'Payroll & Tax Specialist', departmentName: 'Finance & Compliance', level: 'L4 - Senior' },
    ];
    desigs.forEach((d) => this.designations.set(d._id, d));

    // Locations (Indian Locations)
    const locs: LocationDoc[] = [
      {
        _id: 'loc_pune_office',
        name: 'Office no 402, Multicon Square, Near Mehendale Garage, Erandwane, Karvenagar, Pune, Maharashtra 411004',
        street: 'Office no 402, Multicon Square, Near Mehendale Garage, Erandwane, Karvenagar',
        city: 'Pune',
        state: 'Maharashtra',
        country: 'India',
        zipCode: '411004',
        isHeadquarters: true,
      },
      { _id: 'loc_pune', name: 'Pune Innovation Hub (Hinjawadi)', city: 'Pune', state: 'Maharashtra', country: 'India', isHeadquarters: false },
      { _id: 'loc_blr', name: 'Bengaluru Tech Center (Prestige Tech Park)', city: 'Bengaluru', state: 'Karnataka', country: 'India', isHeadquarters: false },
      { _id: 'loc_mum', name: 'Mumbai Financial Hub (BKC)', city: 'Mumbai', state: 'Maharashtra', country: 'India', isHeadquarters: false },
      { _id: 'loc_del', name: 'Delhi NCR Cyber City', city: 'Gurugram', state: 'Haryana', country: 'India', isHeadquarters: false },
      { _id: 'loc_hyd', name: 'Hyderabad Tech Center (HITEC City)', city: 'Hyderabad', state: 'Telangana', country: 'India', isHeadquarters: false },
      { _id: 'loc_rem', name: 'Remote - India', city: 'Remote', state: 'All India', country: 'India', isHeadquarters: false },
    ];
    locs.forEach((l) => this.locations.set(l._id, l));

    const salt = bcrypt.genSaltSync(10);

    // 1. Admin - Omkar Despande (CEO)
    const adminUser: UserDoc = {
      _id: 'usr_admin_01',
      email: 'omkar@greenticker.in',
      passwordHash: bcrypt.hashSync('Admin@12345', salt),
      firstName: 'Omkar',
      lastName: 'Despande',
      role: 'ADMIN',
      organizationId: orgId,
      employeeId: 'emp_admin_01',
      onboardingCompleted: true,
      onboardingStep: 9,
      orgSetupCompleted: true,
      orgSetupStep: 4,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(adminUser._id, adminUser);
    this.employees.set('emp_admin_01', {
      _id: 'emp_admin_01',
      userId: adminUser._id,
      organizationId: orgId,
      employeeCode: 'RHA-001',
      firstName: 'Omkar',
      lastName: 'Despande',
      gender: 'Male',
      dob: '1985-04-12',
      bloodGroup: 'O+',
      personalEmail: 'omkar@greenticker.in',
      workEmail: 'omkar@greenticker.in',
      phone: '+91 98450 12345',
      alternatePhone: '+91 98450 98711',
      department: 'Executive Board',
      designation: 'Chief Executive Officer',
      joiningDate: '2020-01-15',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      shift: 'Standard General (09:00 - 18:00)',
      location: 'Office no 402, Multicon Square, Near Mehendale Garage, Erandwane, Karvenagar, Pune, Maharashtra 411004',
      annualSalary: 3200000,
      bio: 'Visionary leadership orchestrating enterprise technology and Indian operations.',
      currentAddress: {
        line: '14, Koramangala 4th Block',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560034',
      },
      permanentAddress: {
        line: '14, Koramangala 4th Block',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560034',
      },
      emergencyContact: {
        name: 'Kabir Mehta',
        relationship: 'Spouse',
        phone: '+91 98450 99999',
      },
      bankInfo: {
        bankName: 'HDFC Bank',
        accountHolder: 'Ananya Mehta',
        accountNumberMasked: '••••••••4819',
        ifsc: 'HDFC0000184',
        branch: 'Indiranagar Branch',
      },
      statutory: {
        panMasked: 'ABCDE••••F',
        uanMasked: '1009••••8192',
      },
    });

    // 2. HR Specialist - Aditya Kapoor
    const hrUser: UserDoc = {
      _id: 'usr_hr_01',
      email: 'hr@anusyuti.com',
      passwordHash: bcrypt.hashSync('HR@12345', salt),
      firstName: 'Aditya',
      lastName: 'Kapoor',
      role: 'ADMIN',
      organizationId: orgId,
      employeeId: 'emp_hr_01',
      onboardingCompleted: true,
      onboardingStep: 9,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(hrUser._id, hrUser);
    this.employees.set('emp_hr_01', {
      _id: 'emp_hr_01',
      userId: hrUser._id,
      organizationId: orgId,
      employeeCode: 'RHA-008',
      firstName: 'Aditya',
      lastName: 'Kapoor',
      gender: 'Male',
      dob: '1990-08-22',
      bloodGroup: 'A+',
      personalEmail: 'aditya.kapoor@gmail.com',
      workEmail: 'hr@anusyuti.com',
      phone: '+91 98451 23456',
      department: 'People Operations & HR',
      designation: 'Senior HR Operations Lead',
      reportingManagerId: 'emp_admin_01',
      reportingManagerName: 'Ananya Mehta (CEO)',
      joiningDate: '2021-03-01',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      shift: 'Standard General (09:00 - 18:00)',
      location: 'Bengaluru HQ (Prestige Tech Park)',
      annualSalary: 1450000,
      bio: 'Leading talent acquisition, employee experience, and HR policy workflows.',
      currentAddress: {
        line: '402, 100 Feet Road, Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560038',
      },
      permanentAddress: {
        line: '402, 100 Feet Road, Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560038',
      },
      emergencyContact: {
        name: 'Meera Kapoor',
        relationship: 'Spouse',
        phone: '+91 98451 99999',
      },
      bankInfo: {
        bankName: 'ICICI Bank',
        accountHolder: 'Aditya Kapoor',
        accountNumberMasked: '••••••••7721',
        ifsc: 'ICIC0000047',
        branch: 'Koramangala Branch',
      },
      statutory: {
        panMasked: 'FGHIJ••••K',
        uanMasked: '1008••••3319',
      },
    });

    // 3. Manager - Arjun Khanna (Director of Platform Engineering)
    const managerUser: UserDoc = {
      _id: 'usr_mgr_01',
      email: 'manager@anusyuti.com',
      passwordHash: bcrypt.hashSync('Manager@12345', salt),
      firstName: 'Arjun',
      lastName: 'Khanna',
      role: 'ADMIN',
      organizationId: orgId,
      employeeId: 'emp_mgr_01',
      onboardingCompleted: true,
      onboardingStep: 9,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(managerUser._id, managerUser);
    this.employees.set('emp_mgr_01', {
      _id: 'emp_mgr_01',
      userId: managerUser._id,
      organizationId: orgId,
      employeeCode: 'RHA-015',
      firstName: 'Arjun',
      lastName: 'Khanna',
      gender: 'Male',
      dob: '1988-11-05',
      bloodGroup: 'B+',
      personalEmail: 'arjun.khanna@gmail.com',
      workEmail: 'manager@anusyuti.com',
      phone: '+91 98452 34567',
      department: 'Engineering & Technology',
      designation: 'Director of Platform Engineering',
      reportingManagerId: 'emp_admin_01',
      reportingManagerName: 'Ananya Mehta (CEO)',
      joiningDate: '2021-06-15',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      shift: 'Engineering Shift (10:00 - 19:00)',
      location: 'Bengaluru HQ (Prestige Tech Park)',
      annualSalary: 2150000,
      bio: 'Leading distributed platforms, architecture resilience, and high-performance teams.',
      currentAddress: {
        line: '205, HSR Layout Sector 2',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560102',
      },
      permanentAddress: {
        line: '205, HSR Layout Sector 2',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560102',
      },
      emergencyContact: {
        name: 'Vikram Khanna',
        relationship: 'Brother',
        phone: '+91 98452 88888',
      },
      bankInfo: {
        bankName: 'State Bank of India',
        accountHolder: 'Arjun Khanna',
        accountNumberMasked: '••••••••9032',
        ifsc: 'SBIN0011542',
        branch: 'HSR Layout Branch',
      },
      statutory: {
        panMasked: 'KLMNO••••P',
        uanMasked: '1007••••6642',
      },
    });

    // 4. Employee - Rohan Verma (Reports to Arjun Khanna)
    const empUser: UserDoc = {
      _id: 'usr_emp_01',
      email: 'employee@anusyuti.com',
      passwordHash: bcrypt.hashSync('Employee@12345', salt),
      firstName: 'Rohan',
      lastName: 'Verma',
      role: 'EMPLOYEE',
      organizationId: orgId,
      employeeId: 'emp_emp_01',
      onboardingCompleted: true,
      onboardingStep: 9,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(empUser._id, empUser);
    this.employees.set('emp_emp_01', {
      _id: 'emp_emp_01',
      userId: empUser._id,
      organizationId: orgId,
      employeeCode: 'RHA-042',
      firstName: 'Rohan',
      lastName: 'Verma',
      gender: 'Male',
      dob: '1995-02-18',
      bloodGroup: 'AB+',
      personalEmail: 'rohan.verma@gmail.com',
      workEmail: 'employee@anusyuti.com',
      phone: '+91 98453 45678',
      department: 'Engineering & Technology',
      designation: 'Senior Frontend Engineer',
      reportingManagerId: 'emp_mgr_01',
      reportingManagerName: 'Arjun Khanna (Director)',
      joiningDate: '2022-09-01',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      shift: 'Engineering Shift (10:00 - 19:00)',
      location: 'Bengaluru HQ (Prestige Tech Park)',
      annualSalary: 1550000,
      bio: 'Crafting responsive UI, enterprise design tokens, and modular frontend architectures.',
      currentAddress: {
        line: '88, Whitefield Main Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560066',
      },
      permanentAddress: {
        line: '88, Whitefield Main Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560066',
      },
      emergencyContact: {
        name: 'Sunita Verma',
        relationship: 'Mother',
        phone: '+91 98453 00999',
      },
      bankInfo: {
        bankName: 'Kotak Mahindra Bank',
        accountHolder: 'Rohan Verma',
        accountNumberMasked: '••••••••3102',
        ifsc: 'KKBK0008064',
        branch: 'Whitefield Branch',
      },
      statutory: {
        panMasked: 'PQRST••••U',
        uanMasked: '1006••••9901',
      },
    });

    // 5. New Hire - Sneha Patel (Reports to Arjun Khanna)
    const newHireUser: UserDoc = {
      _id: 'usr_new_01',
      email: 'newhire@anusyuti.com',
      passwordHash: bcrypt.hashSync('NewHire@12345', salt),
      firstName: 'Sneha',
      lastName: 'Patel',
      role: 'EMPLOYEE',
      organizationId: orgId,
      employeeId: 'emp_new_01',
      onboardingCompleted: false,
      onboardingStep: 1,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(newHireUser._id, newHireUser);
    this.employees.set('emp_new_01', {
      _id: 'emp_new_01',
      userId: newHireUser._id,
      organizationId: orgId,
      employeeCode: 'RHA-099',
      firstName: 'Sneha',
      lastName: 'Patel',
      gender: 'Female',
      dob: '1998-07-14',
      bloodGroup: 'B+',
      personalEmail: 'sneha.patel@gmail.com',
      workEmail: 'newhire@anusyuti.com',
      phone: '+91 98200 56789',
      department: 'Product & Design',
      designation: 'Product Designer',
      reportingManagerId: 'emp_mgr_01',
      reportingManagerName: 'Arjun Khanna (Director)',
      joiningDate: '2026-09-20',
      employmentType: 'FULL_TIME',
      status: 'PROBATION',
      shift: 'Standard General (09:00 - 18:00)',
      location: 'Mumbai Financial Hub (BKC)',
      annualSalary: 1250000,
      bio: 'User research advocate, prototyping intuitive digital product experiences.',
    });

    // 6. Additional team employee - Vikramaditya Rao (DevOps, Reports to Arjun Khanna)
    const devopsUser: UserDoc = {
      _id: 'usr_devops_01',
      email: 'vikram.rao@anusyuti.com',
      passwordHash: bcrypt.hashSync('Wilson@12345', salt),
      firstName: 'Vikramaditya',
      lastName: 'Rao',
      role: 'EMPLOYEE',
      organizationId: orgId,
      employeeId: 'emp_devops_01',
      onboardingCompleted: true,
      onboardingStep: 9,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(devopsUser._id, devopsUser);
    this.employees.set('emp_devops_01', {
      _id: 'emp_devops_01',
      userId: devopsUser._id,
      organizationId: orgId,
      employeeCode: 'RHA-055',
      firstName: 'Vikramaditya',
      lastName: 'Rao',
      gender: 'Male',
      dob: '1993-05-30',
      bloodGroup: 'O-',
      personalEmail: 'vikram.rao@gmail.com',
      workEmail: 'vikram.rao@anusyuti.com',
      phone: '+91 98490 67890',
      department: 'Engineering & Technology',
      designation: 'DevOps & Cloud Engineer',
      reportingManagerId: 'emp_mgr_01',
      reportingManagerName: 'Arjun Khanna (Director)',
      joiningDate: '2023-01-10',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      shift: 'Engineering Shift (10:00 - 19:00)',
      location: 'Hyderabad Tech Center (HITEC City)',
      annualSalary: 1600000,
      bio: 'Managing Kubernetes clusters, CI/CD automated deployment pipelines, and observability.',
      currentAddress: {
        line: '12, Madhapur, Cyberabad',
        city: 'Hyderabad',
        state: 'Telangana',
        country: 'India',
        postalCode: '500081',
      },
    });

    // 7. Finance Specialist - Rajesh Singhania (Reports to Ananya Mehta)
    const finUser: UserDoc = {
      _id: 'usr_fin_01',
      email: 'rajesh.singhania@anusyuti.com',
      passwordHash: bcrypt.hashSync('Arthur@12345', salt),
      firstName: 'Rajesh',
      lastName: 'Singhania',
      role: 'EMPLOYEE',
      organizationId: orgId,
      employeeId: 'emp_fin_head',
      onboardingCompleted: true,
      onboardingStep: 9,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(finUser._id, finUser);
    this.employees.set('emp_fin_head', {
      _id: 'emp_fin_head',
      userId: finUser._id,
      organizationId: orgId,
      employeeCode: 'RHA-012',
      firstName: 'Rajesh',
      lastName: 'Singhania',
      gender: 'Male',
      dob: '1987-09-14',
      bloodGroup: 'A-',
      personalEmail: 'rajesh.singhania@gmail.com',
      workEmail: 'rajesh.singhania@anusyuti.com',
      phone: '+91 98100 78901',
      department: 'Finance & Compliance',
      designation: 'Payroll & Tax Specialist',
      reportingManagerId: 'emp_admin_01',
      reportingManagerName: 'Ananya Mehta (CEO)',
      joiningDate: '2021-04-18',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      shift: 'Standard General (09:00 - 18:00)',
      location: 'Delhi NCR Cyber City',
      annualSalary: 1500000,
      bio: 'Specialist in corporate payroll runs, statutory filings, and TDS Form 16 accounting.',
    });

    // Additional 15+ Indian Employees
    const extraEmployees = [
      { id: 'emp_ind_01', code: 'RHA-101', fn: 'Deepika', ln: 'Sharma', gender: 'Female', dept: 'Engineering & Technology', desig: 'Backend Engineer', salary: 1400000, loc: 'Bengaluru HQ', bank: 'HDFC Bank', ifsc: 'HDFC0000184', acc: '••••••••1101', phone: '+91 98210 11101', city: 'Bengaluru' },
      { id: 'emp_ind_02', code: 'RHA-102', fn: 'Nikhil', ln: 'Joshi', gender: 'Male', dept: 'Product & Design', desig: 'UI/UX Lead', salary: 1650000, loc: 'Mumbai Financial Hub', bank: 'ICICI Bank', ifsc: 'ICIC0000047', acc: '••••••••2202', phone: '+91 98210 22202', city: 'Mumbai' },
      { id: 'emp_ind_03', code: 'RHA-103', fn: 'Pooja', ln: 'Iyer', gender: 'Female', dept: 'People Operations & HR', desig: 'HR Business Partner', salary: 1150000, loc: 'Chennai Tech Park', bank: 'State Bank of India', ifsc: 'SBIN0001234', acc: '••••••••3303', phone: '+91 98210 33303', city: 'Chennai' },
      { id: 'emp_ind_04', code: 'RHA-104', fn: 'K. R.', ln: 'Nambiar', gender: 'Male', dept: 'Engineering & Technology', desig: 'Principal Architect', salary: 2800000, loc: 'Bengaluru HQ', bank: 'Axis Bank', ifsc: 'UTIB0000123', acc: '••••••••4404', phone: '+91 98210 44404', city: 'Bengaluru' },
      { id: 'emp_ind_05', code: 'RHA-105', fn: 'Neha', ln: 'Deshmukh', gender: 'Female', dept: 'Finance & Compliance', desig: 'Senior Accountant', salary: 1050000, loc: 'Pune Hinjawadi', bank: 'Kotak Mahindra Bank', ifsc: 'KKBK0008064', acc: '••••••••5505', phone: '+91 98210 55505', city: 'Pune' },
      { id: 'emp_ind_06', code: 'RHA-106', fn: 'Manish', ln: 'Malhotra', gender: 'Male', dept: 'Sales & Growth', desig: 'Enterprise Account Executive', salary: 1900000, loc: 'Delhi NCR Cyber City', bank: 'HDFC Bank', ifsc: 'HDFC0000201', acc: '••••••••6606', phone: '+91 98210 66606', city: 'Delhi' },
      { id: 'emp_ind_07', code: 'RHA-107', fn: 'Swati', ln: 'Pillai', gender: 'Female', dept: 'Customer Success', desig: 'Success Manager', salary: 1200000, loc: 'Bengaluru HQ', bank: 'ICICI Bank', ifsc: 'ICIC0000111', acc: '••••••••7707', phone: '+91 98210 77707', city: 'Bengaluru' },
      { id: 'emp_ind_08', code: 'RHA-108', fn: 'Vinay', ln: 'Choudhury', gender: 'Male', dept: 'Engineering & Technology', desig: 'QA Automation Engineer', salary: 1100000, loc: 'Hyderabad Tech Center', bank: 'State Bank of India', ifsc: 'SBIN0005678', acc: '••••••••8808', phone: '+91 98210 88808', city: 'Hyderabad' },
      { id: 'emp_ind_09', code: 'RHA-109', fn: 'Tanvi', ln: 'Agarwal', gender: 'Female', dept: 'Legal & Governance', desig: 'Corporate Legal Counsel', salary: 1750000, loc: 'Mumbai Financial Hub', bank: 'Axis Bank', ifsc: 'UTIB0000456', acc: '••••••••9909', phone: '+91 98210 99909', city: 'Mumbai' },
      { id: 'emp_ind_10', code: 'RHA-110', fn: 'Siddharth', ln: 'Mukherjee', gender: 'Male', dept: 'Engineering & Technology', desig: 'Security Operations Lead', salary: 2100000, loc: 'Kolkata Sector V', bank: 'HDFC Bank', ifsc: 'HDFC0000302', acc: '••••••••1010', phone: '+91 98210 10101', city: 'Kolkata' },
      { id: 'emp_ind_11', code: 'RHA-111', fn: 'Aarti', ln: 'Sen', gender: 'Female', dept: 'Product & Design', desig: 'Product Manager', salary: 1800000, loc: 'Bengaluru HQ', bank: 'ICICI Bank', ifsc: 'ICIC0000222', acc: '••••••••1212', phone: '+91 98210 12121', city: 'Bengaluru' },
      { id: 'emp_ind_12', code: 'RHA-112', fn: 'Rahul', ln: 'Namboodiri', gender: 'Male', dept: 'Engineering & Technology', desig: 'Full Stack Engineer', salary: 1350000, loc: 'Kochi Infopark', bank: 'State Bank of India', ifsc: 'SBIN0009999', acc: '••••••••1313', phone: '+91 98210 13131', city: 'Kochi' },
      { id: 'emp_ind_13', code: 'RHA-113', fn: 'Kavitha', ln: 'Swaminathan', gender: 'Female', dept: 'People Operations & HR', desig: 'Talent Acquisition Recruiter', salary: 950000, loc: 'Chennai Tech Park', bank: 'Axis Bank', ifsc: 'UTIB0000789', acc: '••••••••1414', phone: '+91 98210 14141', city: 'Chennai' },
      { id: 'emp_ind_14', code: 'RHA-114', fn: 'Abhinav', ln: 'Roy', gender: 'Male', dept: 'Sales & Growth', desig: 'Growth Marketing Manager', salary: 1450000, loc: 'Delhi NCR Cyber City', bank: 'HDFC Bank', ifsc: 'HDFC0000404', acc: '••••••••1515', phone: '+91 98210 15151', city: 'Delhi' },
      { id: 'emp_ind_15', code: 'RHA-115', fn: 'Shreya', ln: 'Banerjee', gender: 'Female', dept: 'Finance & Compliance', desig: 'Financial Analyst', salary: 1150000, loc: 'Kolkata Sector V', bank: 'Kotak Mahindra Bank', ifsc: 'KKBK0009101', acc: '••••••••1616', phone: '+91 98210 16161', city: 'Kolkata' },
    ];

    for (const item of extraEmployees) {
      const uId = `usr_${item.id}`;
      const userDoc: UserDoc = {
        _id: uId,
        email: `${item.fn.toLowerCase()}.${item.ln.toLowerCase()}@anusyuti.com`,
        passwordHash: bcrypt.hashSync('Password@123', salt),
        firstName: item.fn,
        lastName: item.ln,
        role: 'EMPLOYEE',
        organizationId: orgId,
        employeeId: item.id,
        onboardingCompleted: true,
        onboardingStep: 9,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.users.set(uId, userDoc);
      this.employees.set(item.id, {
        _id: item.id,
        userId: uId,
        organizationId: orgId,
        employeeCode: item.code,
        firstName: item.fn,
        lastName: item.ln,
        gender: item.gender,
        dob: '1992-05-15',
        bloodGroup: 'B+',
        personalEmail: `${item.fn.toLowerCase()}.${item.ln.toLowerCase()}@gmail.com`,
        workEmail: userDoc.email,
        phone: item.phone,
        department: item.dept,
        designation: item.desig,
        reportingManagerId: 'emp_mgr_01',
        reportingManagerName: 'Arjun Khanna (Director)',
        joiningDate: '2023-05-01',
        employmentType: 'FULL_TIME',
        status: 'ACTIVE',
        shift: 'Standard General (09:00 - 18:00)',
        location: item.loc,
        annualSalary: item.salary,
        bio: `Dedicated professional in ${item.dept} at Anusyuti.`,
        currentAddress: {
          line: '12, MG Road',
          city: item.city,
          state: 'India',
          country: 'India',
          postalCode: '560001',
        },
        permanentAddress: {
          line: '12, MG Road',
          city: item.city,
          state: 'India',
          country: 'India',
          postalCode: '560001',
        },
        bankInfo: {
          bankName: item.bank,
          accountHolder: `${item.fn} ${item.ln}`,
          accountNumberMasked: item.acc,
          ifsc: item.ifsc,
          branch: `${item.city} Main Branch`,
        },
        statutory: {
          panMasked: 'ABCDE••••F',
          uanMasked: '1000••••1234',
        },
      });
    }

    // 8. Seed Documents Repository
    const seedDocs: Omit<DocumentDoc, '_id'>[] = [
      {
        employeeId: 'emp_emp_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        category: 'IDENTITY',
        title: 'Aadhaar Card & PAN Verification',
        fileName: 'rohan_verma_aadhaar_pan.pdf',
        fileType: 'application/pdf',
        fileSize: '2.4 MB',
        expiryDate: '2031-10-14',
        uploadedBy: 'Rohan Verma',
        uploadedAt: '2022-09-02T10:15:00Z',
        status: 'VERIFIED',
        verifiedBy: 'Aditya Kapoor (HR Lead)',
        verifiedAt: '2022-09-03T14:20:00Z',
      },
      {
        employeeId: 'emp_emp_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        category: 'EMPLOYMENT',
        title: 'Anusyuti Signed Employment Agreement',
        fileName: 'rohan_verma_offer_countersigned.pdf',
        fileType: 'application/pdf',
        fileSize: '1.8 MB',
        uploadedBy: 'Aditya Kapoor (HR Lead)',
        uploadedAt: '2022-08-25T11:00:00Z',
        status: 'VERIFIED',
        verifiedBy: 'Aditya Kapoor (HR Lead)',
        verifiedAt: '2022-08-26T09:30:00Z',
      },
      {
        employeeId: 'emp_emp_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        category: 'EDUCATION',
        title: 'B.Tech Computer Science Degree & Transcript',
        fileName: 'iit_degree_rohan_verma.pdf',
        fileType: 'application/pdf',
        fileSize: '3.1 MB',
        uploadedBy: 'Rohan Verma',
        uploadedAt: '2022-09-02T10:20:00Z',
        status: 'VERIFIED',
        verifiedBy: 'Aditya Kapoor (HR Lead)',
        verifiedAt: '2022-09-03T14:22:00Z',
      },
      {
        employeeId: 'emp_emp_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        category: 'CERTIFICATION',
        title: 'Cloud Native Architect 2024',
        fileName: 'cloud_architect_cert_2024.pdf',
        fileType: 'application/pdf',
        fileSize: '950 KB',
        expiryDate: '2026-12-31',
        uploadedBy: 'Rohan Verma',
        uploadedAt: '2024-03-10T16:00:00Z',
        status: 'VERIFIED',
        verifiedBy: 'Aditya Kapoor (HR Lead)',
        verifiedAt: '2024-03-11T10:00:00Z',
      },
      {
        employeeId: 'emp_new_hire',
        employeeName: 'Pooja Iyer',
        employeeCode: 'RHA-089',
        department: 'Product & Design',
        category: 'IDENTITY',
        title: 'Passport & Aadhaar Verification',
        fileName: 'pooja_iyer_id_verification.pdf',
        fileType: 'application/pdf',
        fileSize: '1.6 MB',
        expiryDate: '2028-04-20',
        uploadedBy: 'Pooja Iyer',
        uploadedAt: '2026-09-21T09:40:00Z',
        status: 'PENDING',
      },
      {
        employeeId: 'emp_new_hire',
        employeeName: 'Pooja Iyer',
        employeeCode: 'RHA-089',
        department: 'Product & Design',
        category: 'EDUCATION',
        title: 'M.Des Interaction Design Certificate',
        fileName: 'nid_master_degree_pooja_iyer.pdf',
        fileType: 'application/pdf',
        fileSize: '2.8 MB',
        uploadedBy: 'Pooja Iyer',
        uploadedAt: '2026-09-21T09:45:00Z',
        status: 'PENDING',
      },
      {
        employeeId: 'emp_new_hire',
        employeeName: 'Pooja Iyer',
        employeeCode: 'RHA-089',
        department: 'Product & Design',
        category: 'EMPLOYMENT',
        title: 'Relieving & Experience Letter - Previous Employer',
        fileName: 'design_relieving_letter.pdf',
        fileType: 'application/pdf',
        fileSize: '1.2 MB',
        uploadedBy: 'Pooja Iyer',
        uploadedAt: '2026-09-21T09:50:00Z',
        status: 'PENDING',
      },
      {
        employeeId: 'emp_devops_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-055',
        department: 'Engineering & Technology',
        category: 'CERTIFICATION',
        title: 'AWS Certified Solutions Architect - Professional',
        fileName: 'aws_sap_c02_vikram_rao.pdf',
        fileType: 'application/pdf',
        fileSize: '1.1 MB',
        expiryDate: '2026-05-15',
        uploadedBy: 'Vikramaditya Rao',
        uploadedAt: '2023-05-20T14:10:00Z',
        status: 'VERIFIED',
        verifiedBy: 'Aditya Kapoor (HR Lead)',
        verifiedAt: '2023-05-21T11:00:00Z',
      },
      {
        employeeId: 'emp_mgr_01',
        employeeName: 'Arjun Khanna',
        employeeCode: 'RHA-015',
        department: 'Engineering & Technology',
        category: 'EMPLOYMENT',
        title: 'Executive Non-Disclosure & Intellectual Property Agreement',
        fileName: 'arjun_khanna_nda_ip_signed.pdf',
        fileType: 'application/pdf',
        fileSize: '3.4 MB',
        uploadedBy: 'Aditya Kapoor (HR Lead)',
        uploadedAt: '2021-06-15T09:00:00Z',
        status: 'VERIFIED',
        verifiedBy: 'Ananya Mehta (CEO)',
        verifiedAt: '2021-06-16T12:00:00Z',
      },
    ];

    seedDocs.forEach((d, idx) => {
      const id = `doc_${String(idx + 1).padStart(3, '0')}`;
      this.documents.set(id, { ...d, _id: id });
    });

    // 9. Seed Lifecycle Events
    this.lifecycleEvents = [
      {
        _id: 'lc_001',
        employeeId: 'emp_emp_01',
        employeeName: 'Rohan Verma',
        employeeCode: 'RHA-042',
        department: 'Engineering & Technology',
        eventType: 'PROMOTION',
        effectiveDate: '2024-01-15',
        previousValue: 'Frontend Engineer (₹1,350,000)',
        newValue: 'Senior Frontend Engineer (₹1,550,000)',
        reason: 'Outstanding performance leading the design system overhaul and component library architecture.',
        initiatedBy: 'Arjun Khanna (Director of Engineering)',
        initiatedAt: '2024-01-05T10:00:00Z',
        approvalStatus: 'APPROVED',
        notes: 'Approved during annual Q4 executive performance calibration.',
      },
      {
        _id: 'lc_002',
        employeeId: 'emp_mgr_01',
        employeeName: 'Arjun Khanna',
        employeeCode: 'RHA-015',
        department: 'Engineering & Technology',
        eventType: 'PROMOTION',
        effectiveDate: '2023-08-01',
        previousValue: 'Engineering Manager (₹1,850,000)',
        newValue: 'Director of Engineering (₹2,150,000)',
        reason: 'Promoted to lead all core engineering divisions, infrastructure, and distributed platforms.',
        initiatedBy: 'Ananya Mehta (CEO)',
        initiatedAt: '2023-07-20T14:30:00Z',
        approvalStatus: 'APPROVED',
        notes: 'Board-approved executive promotion.',
      },
      {
        _id: 'lc_003',
        employeeId: 'emp_devops_01',
        employeeName: 'Vikramaditya Rao',
        employeeCode: 'RHA-055',
        department: 'Engineering & Technology',
        eventType: 'CONFIRMATION',
        effectiveDate: '2023-07-10',
        previousValue: 'PROBATION',
        newValue: 'CONFIRMED / ACTIVE',
        reason: 'Successful completion of 6-month probation period with exemplary uptime record.',
        initiatedBy: 'Arjun Khanna (Director of Engineering)',
        initiatedAt: '2023-07-08T09:15:00Z',
        approvalStatus: 'APPROVED',
      },
      {
        _id: 'lc_004',
        employeeId: 'emp_fin_head',
        employeeName: 'Rajesh Singhania',
        employeeCode: 'RHA-012',
        department: 'Finance & Compliance',
        eventType: 'SALARY_REVISION',
        effectiveDate: '2024-04-01',
        previousValue: 'Annual CTC: ₹1,380,000',
        newValue: 'Annual CTC: ₹1,500,000',
        reason: 'Market band correction & statutory payroll compliance achievement bonus.',
        initiatedBy: 'Ananya Mehta (CEO)',
        initiatedAt: '2024-03-25T11:20:00Z',
        approvalStatus: 'APPROVED',
      },
    ];

    // 10. Seed Onboarding Queue Submissions
    const mayaSub: OnboardingSubmissionDoc = {
      _id: 'sub_maya_lin',
      userId: 'usr_new_hire',
      employeeId: 'emp_new_hire',
      employeeCode: 'ZEN-089',
      employeeName: 'Ishita Iyer',
      department: 'Product & Design',
      designation: 'Product Designer',
      workEmail: 'newhire@zenithhrms.com',
      personalEmail: 'ishita.iyer.design@gmail.com',
      phone: '+1 (555) 678-9012',
      currentStep: 8,
      totalSteps: 8,
      status: 'SUBMITTED',
      submittedAt: '2026-09-22T14:30:00Z',
      sectionsData: {
        core: {
          firstName: 'Maya',
          lastName: 'Lin',
          dob: '1998-07-14',
          gender: 'Female',
          phone: '+1 (555) 678-9012',
          alternatePhone: '+1 (555) 678-9013',
          personalEmail: 'ishita.iyer.design@gmail.com',
          currentAddress: {
            line: '742 Evergreen Terrace',
            city: 'Springfield',
            state: 'CA',
            country: 'USA',
            postalCode: '97477',
          },
          permanentAddress: {
            line: '742 Evergreen Terrace',
            city: 'Springfield',
            state: 'CA',
            country: 'USA',
            postalCode: '97477',
          },
          sameAsCurrent: true,
        },
        emergencyDetails: {
          name: 'Priya Patel',
          phone: '+1 (555) 678-9999',
          relation: 'Sister',
        },
        employmentDetails: {
          employeeCode: 'ZEN-089',
          joiningDate: '2026-10-01',
          employmentType: 'FULL_TIME',
          department: 'Product & Design',
          designation: 'Product Designer',
          location: 'San Francisco HQ',
          reportingManagerName: 'Riya Kapoor',
          filledBy: 'Neha Sharma (HR)',
        },
        banking: {
          accountHolder: 'Ishita Iyer',
          accountNumber: '4421889901',
          ifsc: 'CHAS0001234',
        },
        pfEsi: {
          hasUan: 'YES',
          uan: '100988776655',
          pfAccountNumber: 'MH/BAN/0012345/000/0044218',
          fatherOrSpouseName: 'Mahesh Iyer',
          hasEsic: 'NO',
          esicNumber: '',
          esiDispensary: 'Central SOMA Dispensary',
        },
        incomeTax: {
          aadhaarNumber: '998877665544',
          panNumber: 'ABCDE1234F',
          taxRegime: 'NEW_REGIME',
          prevEmployerGrossSalary: '450000',
          prevEmployerTds: '35000',
        },
        insuranceNominee: {
          optHealthInsurance: 'YES',
          dependents: [
            {
              id: 'dep_maya_01',
              fullName: 'Mahesh Iyer',
              relationship: 'Father',
              dob: '1968-05-12',
              gender: 'Male',
            },
          ],
          nominee: {
            fullName: 'Priya Patel',
            relationship: 'Sister',
            dob: '1995-09-20',
          },
        },
      },
      documents: [
        {
          id: 'doc_maya_01',
          category: 'IDENTITY',
          documentName: 'Aadhaar Card — Front',
          fileName: 'ishita_iyer_id.pdf',
          fileSize: '1.6 MB',
          fileType: 'application/pdf',
          uploadedAt: '2026-09-21T09:40:00Z',
          status: 'PENDING',
        },
        {
          id: 'doc_maya_02',
          category: 'EDUCATION',
          documentName: 'Highest Educational Degree',
          fileName: 'risd_degree.pdf',
          fileSize: '2.8 MB',
          fileType: 'application/pdf',
          uploadedAt: '2026-09-21T09:45:00Z',
          status: 'PENDING',
        },
      ],
      policyAcknowledgements: [
        {
          policyId: 'pol_it_security',
          policyTitle: 'Acceptable IT & Data Security Policy 2026',
          version: '3.1',
          acknowledgedAt: '2026-09-22T14:28:00Z',
          ipAddress: '198.51.100.45',
          deviceInfo: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          acknowledged: true,
        },
        {
          policyId: 'pol_posh',
          policyTitle: 'Prevention of Sexual Harassment (POSH) Charter',
          version: '2.0',
          acknowledgedAt: '2026-09-22T14:29:00Z',
          ipAddress: '198.51.100.45',
          deviceInfo: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          acknowledged: true,
        },
      ],
      createdAt: '2026-09-20T10:00:00Z',
      updatedAt: '2026-09-22T14:30:00Z',
    };
    this.onboardingSubmissions.set(mayaSub._id, mayaSub);

    // Second applicant: Nikhil Joshi (In Progress)
    const ethanSub: OnboardingSubmissionDoc = {
      _id: 'sub_ethan_cole',
      userId: 'usr_ethan',
      employeeId: 'emp_ethan',
      employeeCode: 'ZEN-092',
      employeeName: 'Nikhil Joshi',
      department: 'Engineering & Technology',
      designation: 'Backend Go Engineer',
      workEmail: 'nikhil.joshi@zenithhrms.com',
      personalEmail: 'nikhil.joshi@gmail.com',
      phone: '+1 (555) 321-4567',
      currentStep: 4,
      totalSteps: 8,
      status: 'IN_PROGRESS',
      sectionsData: {
        core: {
          firstName: 'Ethan',
          lastName: 'Cole',
          dob: '1996-11-04',
          gender: 'Male',
          phone: '+1 (555) 321-4567',
          alternatePhone: '',
          personalEmail: 'nikhil.joshi@gmail.com',
          currentAddress: {
            line: '102 Market St',
            city: 'San Francisco',
            state: 'CA',
            country: 'USA',
            postalCode: '94105',
          },
          permanentAddress: {
            line: '102 Market St',
            city: 'San Francisco',
            state: 'CA',
            country: 'USA',
            postalCode: '94105',
          },
          sameAsCurrent: true,
        },
        emergencyDetails: {
          name: 'Kavita Joshi',
          phone: '+1 (555) 321-9999',
          relation: 'Spouse',
        },
        employmentDetails: {
          employeeCode: 'ZEN-092',
          joiningDate: '2026-10-15',
          employmentType: 'FULL_TIME',
          department: 'Engineering & Technology',
          designation: 'Backend Go Engineer',
          location: 'San Francisco HQ',
          reportingManagerName: 'Saurabh Kulkarni',
          filledBy: 'Neha Sharma (HR)',
        },
      },
      documents: [],
      policyAcknowledgements: [],
      createdAt: '2026-09-24T11:00:00Z',
      updatedAt: '2026-09-25T16:20:00Z',
    };
    this.onboardingSubmissions.set(ethanSub._id, ethanSub);

    // Third applicant: Aditi Deshmukh (Needs Correction)
    const samanthaSub: OnboardingSubmissionDoc = {
      _id: 'sub_samantha_vance',
      userId: 'usr_samantha',
      employeeId: 'emp_samantha',
      employeeCode: 'ZEN-090',
      employeeName: 'Aditi Deshmukh',
      department: 'Finance & Compliance',
      designation: 'Junior Financial Analyst',
      workEmail: 'aditi.deshmukh@zenithhrms.com',
      personalEmail: 'aditi.deshmukh@gmail.com',
      phone: '+1 (555) 432-8765',
      currentStep: 6,
      totalSteps: 8,
      status: 'NEEDS_CORRECTION',
      submittedAt: '2026-09-21T18:00:00Z',
      rejectionRemarks: 'Please re-upload a clean, non-blurry scanned copy of your Degree Certificate and verify your PAN Number in Section 6.',
      sectionsData: {
        core: {
          firstName: 'Samantha',
          lastName: 'Vance',
          dob: '2000-03-22',
          gender: 'Female',
          phone: '+1 (555) 432-8765',
          alternatePhone: '',
          personalEmail: 'aditi.deshmukh@gmail.com',
          currentAddress: {
            line: '445 Bush Street',
            city: 'San Francisco',
            state: 'CA',
            country: 'USA',
            postalCode: '94108',
          },
          permanentAddress: {
            line: '445 Bush Street',
            city: 'San Francisco',
            state: 'CA',
            country: 'USA',
            postalCode: '94108',
          },
          sameAsCurrent: true,
        },
        emergencyDetails: {
          name: 'Sanjay Deshmukh',
          phone: '+1 (555) 432-1111',
          relation: 'Father',
        },
        employmentDetails: {
          employeeCode: 'ZEN-090',
          joiningDate: '2026-09-15',
          employmentType: 'FULL_TIME',
          department: 'Finance & Compliance',
          designation: 'Junior Financial Analyst',
          location: 'San Francisco HQ',
          reportingManagerName: 'Amit Deshpande',
          filledBy: 'Neha Sharma (HR)',
        },
        banking: {
          accountHolder: 'Aditi Deshmukh',
          accountNumber: '9900112233',
          ifsc: 'WELL0009876',
        },
        pfEsi: {
          hasUan: 'NO',
          uan: '',
          pfAccountNumber: '',
          fatherOrSpouseName: 'Sanjay Deshmukh',
          hasEsic: 'NO',
          esicNumber: '',
          esiDispensary: 'Financial District Clinic',
        },
        incomeTax: {
          aadhaarNumber: '112233445566',
          panNumber: 'VANCE9900K',
          taxRegime: 'NEW_REGIME',
          prevEmployerGrossSalary: '0',
          prevEmployerTds: '0',
        },
        insuranceNominee: {
          optHealthInsurance: 'NO',
          dependents: [],
          nominee: {
            fullName: 'Sanjay Deshmukh',
            relationship: 'Father',
            dob: '1965-02-10',
          },
        },
      },
      documents: [
        {
          id: 'doc_sam_01',
          category: 'EDUCATION',
          documentName: 'Highest Educational Degree',
          fileName: 'degree_scan_blurred.pdf',
          fileSize: '450 KB',
          fileType: 'application/pdf',
          uploadedAt: '2026-09-21T17:50:00Z',
          status: 'REJECTED',
          remarks: 'Scan resolution too low to read university seal.',
        },
      ],
      policyAcknowledgements: [],
      createdAt: '2026-09-19T09:00:00Z',
      updatedAt: '2026-09-22T10:15:00Z',
    };
    this.onboardingSubmissions.set(samanthaSub._id, samanthaSub);

    // 11. Seed Work Shifts
    const seedShifts: ShiftDoc[] = [
      {
        _id: 'shift_gen',
        name: 'Standard Corporate Shift',
        code: 'GEN-01',
        startTime: '09:00',
        endTime: '18:00',
        expectedHours: 8,
        breakMinutes: 60,
        gracePeriodMinutes: 15,
        isNightShift: false,
        departments: ['Human Resources', 'Finance & Compliance', 'Operations & Logistics', 'Product & Design'],
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        _id: 'shift_eng',
        name: 'Engineering Flexible Shift',
        code: 'ENG-02',
        startTime: '10:00',
        endTime: '19:00',
        expectedHours: 8,
        breakMinutes: 60,
        gracePeriodMinutes: 30,
        isNightShift: false,
        departments: ['Engineering & Technology', 'Product & Design'],
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        _id: 'shift_fin',
        name: 'Financial Markets Shift',
        code: 'FIN-03',
        startTime: '08:30',
        endTime: '17:30',
        expectedHours: 8,
        breakMinutes: 60,
        gracePeriodMinutes: 15,
        isNightShift: false,
        departments: ['Finance & Compliance'],
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        _id: 'shift_noc',
        name: '24/7 Cloud NOC & On-Call Shift',
        code: 'NOC-04',
        startTime: '20:00',
        endTime: '05:00',
        expectedHours: 8,
        breakMinutes: 60,
        gracePeriodMinutes: 15,
        isNightShift: true,
        departments: ['Engineering & Technology'],
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        _id: 'shift_night',
        name: 'Night Shift',
        code: 'NGT-05',
        startTime: '22:00',
        endTime: '06:00',
        expectedHours: 8,
        breakMinutes: 60,
        gracePeriodMinutes: 15,
        isNightShift: true,
        departments: [],
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    seedShifts.forEach((s) => this.shifts.set(s._id, s));

    // 12. Seed Attendance Records with Automatic Overtime
    const todayStr = '2026-09-28';
    const seedAttendance: AttendanceRecordDoc[] = [
      // Amit Deshpande
      {
        _id: 'att_dc_today',
        employeeId: 'emp_emp_01',
        employeeName: 'Amit Deshpande',
        employeeCode: 'ZEN-042',
        department: 'Engineering & Technology',
        date: todayStr,
        shiftName: 'Engineering Shift (10:00 - 19:00)',
        shiftExpectedHours: 8,
        checkInTime: '08:45',
        totalMinutesWorked: 570, // 9h 30m
        breakMinutes: 60,
        effectiveWorkingHours: 8.5,
        overtimeMinutes: 30,
        overtimeHours: 0.5,
        status: 'PRESENT',
        location: 'San Francisco HQ (Floor 4 WiFi)',
        ipAddress: '198.51.100.42',
      },
      {
        _id: 'att_dc_1',
        employeeId: 'emp_emp_01',
        employeeName: 'Amit Deshpande',
        employeeCode: 'ZEN-042',
        department: 'Engineering & Technology',
        date: '2026-09-25',
        shiftName: 'Engineering Shift (10:00 - 19:00)',
        shiftExpectedHours: 8,
        checkInTime: '08:50',
        checkOutTime: '19:30',
        totalMinutesWorked: 640,
        breakMinutes: 60,
        effectiveWorkingHours: 9.67,
        overtimeMinutes: 100,
        overtimeHours: 1.67,
        status: 'PRESENT',
        location: 'San Francisco HQ',
        notes: 'Sprint release deployment verification.',
      },
      {
        _id: 'att_dc_2',
        employeeId: 'emp_emp_01',
        employeeName: 'Amit Deshpande',
        employeeCode: 'ZEN-042',
        department: 'Engineering & Technology',
        date: '2026-09-24',
        shiftName: 'Engineering Shift (10:00 - 19:00)',
        shiftExpectedHours: 8,
        checkInTime: '09:00',
        checkOutTime: '18:30',
        totalMinutesWorked: 570,
        breakMinutes: 60,
        effectiveWorkingHours: 8.5,
        overtimeMinutes: 30,
        overtimeHours: 0.5,
        status: 'PRESENT',
        location: 'San Francisco HQ',
      },
      {
        _id: 'att_dc_3',
        employeeId: 'emp_emp_01',
        employeeName: 'Amit Deshpande',
        employeeCode: 'ZEN-042',
        department: 'Engineering & Technology',
        date: '2026-09-23',
        shiftName: 'Engineering Shift (10:00 - 19:00)',
        shiftExpectedHours: 8,
        checkInTime: '10:45',
        checkOutTime: '19:00',
        totalMinutesWorked: 495,
        breakMinutes: 60,
        effectiveWorkingHours: 7.25,
        overtimeMinutes: 0,
        overtimeHours: 0,
        status: 'LATE',
        location: 'San Francisco HQ',
        notes: 'Late arrival due to transit delay.',
      },
      {
        _id: 'att_dc_4',
        employeeId: 'emp_emp_01',
        employeeName: 'Amit Deshpande',
        employeeCode: 'ZEN-042',
        department: 'Engineering & Technology',
        date: '2026-09-22',
        shiftName: 'Engineering Shift (10:00 - 19:00)',
        shiftExpectedHours: 8,
        checkInTime: '08:55',
        checkOutTime: '20:00',
        totalMinutesWorked: 665,
        breakMinutes: 60,
        effectiveWorkingHours: 10.08,
        overtimeMinutes: 125,
        overtimeHours: 2.08,
        status: 'PRESENT',
        location: 'San Francisco HQ',
        notes: 'Extended hours for quarterly security audit remediation.',
      },
      {
        _id: 'att_dc_5',
        employeeId: 'emp_emp_01',
        employeeName: 'Amit Deshpande',
        employeeCode: 'ZEN-042',
        department: 'Engineering & Technology',
        date: '2026-09-21',
        shiftName: 'Engineering Shift (10:00 - 19:00)',
        shiftExpectedHours: 8,
        checkInTime: '09:00',
        checkOutTime: '18:00',
        totalMinutesWorked: 540,
        breakMinutes: 60,
        effectiveWorkingHours: 8.0,
        overtimeMinutes: 0,
        overtimeHours: 0,
        status: 'WORK_FROM_HOME',
        location: 'Remote (Home Office)',
      },
      // Karan Malhotra
      {
        _id: 'att_jw_today',
        employeeId: 'emp_devops_01',
        employeeName: 'Karan Malhotra',
        employeeCode: 'ZEN-055',
        department: 'Engineering & Technology',
        date: todayStr,
        shiftName: 'Engineering Shift (10:00 - 19:00)',
        shiftExpectedHours: 8,
        checkInTime: '09:40',
        totalMinutesWorked: 510,
        breakMinutes: 60,
        effectiveWorkingHours: 7.5,
        overtimeMinutes: 0,
        overtimeHours: 0,
        status: 'PRESENT',
        location: 'San Francisco HQ',
      },
      {
        _id: 'att_jw_1',
        employeeId: 'emp_devops_01',
        employeeName: 'Karan Malhotra',
        employeeCode: 'ZEN-055',
        department: 'Engineering & Technology',
        date: '2026-09-25',
        shiftName: 'Engineering Shift (10:00 - 19:00)',
        shiftExpectedHours: 8,
        checkInTime: '10:00',
        checkOutTime: '21:00',
        totalMinutesWorked: 660,
        breakMinutes: 60,
        effectiveWorkingHours: 10.0,
        overtimeMinutes: 120,
        overtimeHours: 2.0,
        status: 'PRESENT',
        location: 'San Francisco HQ',
        notes: 'Kubernetes cluster database maintenance window.',
      },
      // Riya Kapoor
      {
        _id: 'att_er_today',
        employeeId: 'emp_mgr_01',
        employeeName: 'Riya Kapoor',
        employeeCode: 'ZEN-028',
        department: 'Engineering & Technology',
        date: todayStr,
        shiftName: 'Engineering Shift (10:00 - 19:00)',
        shiftExpectedHours: 8,
        checkInTime: '08:30',
        totalMinutesWorked: 580,
        breakMinutes: 60,
        effectiveWorkingHours: 8.67,
        overtimeMinutes: 40,
        overtimeHours: 0.67,
        status: 'PRESENT',
        location: 'San Francisco HQ Executive Suite',
      },
      // Anil Menon
      {
        _id: 'att_ap_today',
        employeeId: 'emp_fin_head',
        employeeName: 'Anil Menon',
        employeeCode: 'ZEN-012',
        department: 'Finance & Compliance',
        date: todayStr,
        shiftName: 'Standard Corporate Shift',
        shiftExpectedHours: 8,
        checkInTime: '08:30',
        totalMinutesWorked: 570,
        breakMinutes: 60,
        effectiveWorkingHours: 8.5,
        overtimeMinutes: 30,
        overtimeHours: 0.5,
        status: 'PRESENT',
        location: 'New York Innovation Lab',
      },
      // Rohit Bansal
      {
        _id: 'att_mb_today',
        employeeId: 'emp_hr_01',
        employeeName: 'Rohit Bansal',
        employeeCode: 'ZEN-003',
        department: 'Human Resources',
        date: todayStr,
        shiftName: 'Standard Corporate Shift',
        shiftExpectedHours: 8,
        checkInTime: '08:55',
        totalMinutesWorked: 550,
        breakMinutes: 60,
        effectiveWorkingHours: 8.17,
        overtimeMinutes: 10,
        overtimeHours: 0.17,
        status: 'PRESENT',
        location: 'San Francisco HQ (HR Floor)',
      },
      // Ishita Iyer
      {
        _id: 'att_ml_1',
        employeeId: 'emp_new_hire',
        employeeName: 'Ishita Iyer',
        employeeCode: 'ZEN-089',
        department: 'Product & Design',
        date: '2026-09-25',
        shiftName: 'Standard Corporate Shift',
        shiftExpectedHours: 8,
        checkInTime: '09:00',
        checkOutTime: '18:00',
        totalMinutesWorked: 540,
        breakMinutes: 60,
        effectiveWorkingHours: 8.0,
        overtimeMinutes: 0,
        overtimeHours: 0,
        status: 'PRESENT',
        location: 'San Francisco HQ',
      },
    ];

    // Night-shift example: checked in 22:00, checked out 10:30 next morning (12.5h => +1 day)
    seedAttendance.push({
      _id: 'att_night_demo',
      employeeId: 'emp_emp_01',
      employeeName: 'Amit Deshpande',
      employeeCode: 'ZEN-042',
      department: 'Engineering & Technology',
      date: '2026-09-22',
      shiftName: 'Night Shift (22:00 - 06:00)',
      shiftExpectedHours: 8,
      checkInTime: '22:00',
      checkOutTime: '10:30',
      totalMinutesWorked: 0,
      breakMinutes: 60,
      effectiveWorkingHours: 0,
      overtimeMinutes: 0,
      overtimeHours: 0,
      status: 'PRESENT',
      location: 'San Francisco HQ',
      notes: 'Night shift - production incident bridge.',
    });

    seedAttendance.forEach((att) => {
      this.applyShiftHours(att);
      this.attendanceRecords.set(att._id, att);
    });

    // Audit seed
    this.auditLogs.push({
      _id: 'aud_seed_01',
      userId: adminUser._id,
      userEmail: adminUser.email,
      role: adminUser.role,
      action: 'WORKFORCE_SEEDED',
      module: 'EMPLOYEE',
      entity: 'Workforce',
      entityId: orgId,
      details: { totalEmployees: this.employees.size, departments: this.departments.size },
      timestamp: new Date().toISOString(),
    });
  }

  // Helper querying methods
  findUserByEmail(email: string): UserDoc | undefined {
    if (!email) return undefined;
    const clean = email.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.email && u.email.trim().toLowerCase() === clean) {
        return u;
      }
    }

    // Auto-provision demo accounts if missing from store/MongoDB
    const salt = bcrypt.genSaltSync(10);
    const orgId = this.organizations.keys().next().value || 'org_zenith_hq';
    
    const demoConfigs: Record<string, { role: UserDoc['role']; firstName: string; lastName: string; pass: string; empCode: string; dept: string; desig: string }> = {
      'omkar@greenticker.in': { role: 'ADMIN', firstName: 'Omkar', lastName: 'Despande', pass: 'Admin@12345', empCode: 'RHA-001', dept: 'Executive Board', desig: 'Chief Executive Officer' },
      'hr@anusyuti.com': { role: 'ADMIN', firstName: 'Aditya', lastName: 'Kapoor', pass: 'HR@12345', empCode: 'RHA-008', dept: 'People Operations & HR', desig: 'Senior HR Operations Lead' },
      'manager@anusyuti.com': { role: 'ADMIN', firstName: 'Arjun', lastName: 'Khanna', pass: 'Manager@12345', empCode: 'RHA-012', dept: 'Engineering & Technology', desig: 'Engineering Manager' },
      'employee@anusyuti.com': { role: 'EMPLOYEE', firstName: 'Rohan', lastName: 'Verma', pass: 'Employee@12345', empCode: 'RHA-101', dept: 'Engineering & Technology', desig: 'Senior Software Engineer' },
      'newhire@anusyuti.com': { role: 'EMPLOYEE', firstName: 'Ishita', lastName: 'Iyer', pass: 'NewHire@12345', empCode: 'RHA-201', dept: 'Product & Design', desig: 'Product Designer' },
    };

    const cfg = demoConfigs[clean];
    if (cfg) {
      const userId = `usr_${cfg.role.toLowerCase()}_auto`;
      const empId = `emp_${cfg.role.toLowerCase()}_auto`;
      const newUser: UserDoc = {
        _id: userId,
        email: clean,
        passwordHash: bcrypt.hashSync(cfg.pass, salt),
        firstName: cfg.firstName,
        lastName: cfg.lastName,
        role: cfg.role,
        organizationId: orgId,
        employeeId: empId,
        onboardingCompleted: cfg.role !== 'EMPLOYEE' || clean !== 'newhire@anusyuti.com',
        onboardingStep: cfg.role !== 'EMPLOYEE' || clean !== 'newhire@anusyuti.com' ? 9 : 1,
        orgSetupCompleted: true,
        orgSetupStep: 4,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.users.set(userId, newUser);
      
      if (!this.employees.has(empId)) {
        this.employees.set(empId, {
          _id: empId,
          userId,
          organizationId: orgId,
          employeeCode: cfg.empCode,
          firstName: cfg.firstName,
          lastName: cfg.lastName,
          gender: 'Other',
          dob: '1990-01-01',
          bloodGroup: 'B+',
          personalEmail: `${cfg.firstName.toLowerCase()}.${cfg.lastName.toLowerCase()}@gmail.com`,
          workEmail: clean,
          phone: '+91 98450 11111',
          department: cfg.dept,
          designation: cfg.desig,
          joiningDate: '2023-01-01',
          employmentType: 'FULL_TIME',
          status: 'ACTIVE',
          shift: 'Standard General (09:00 - 18:00)',
          location: 'Bengaluru HQ (Prestige Tech Park)',
          annualSalary: 1500000,
        });
      }
      return newUser;
    }

    return undefined;
  }

  findUserById(id: string): UserDoc | undefined {
    return this.users.get(id);
  }

  findEmployeeByUserId(userId: string): EmployeeDoc | undefined {
    for (const emp of this.employees.values()) {
      if (emp.userId === userId) {
        return emp;
      }
    }
    return undefined;
  }

  getEmployeeById(id: string): EmployeeDoc | undefined {
    return this.employees.get(id);
  }

  // Role-Enforced Employee Listing (Rules 1, 2, 3, 4)
  getEmployeesForUser(user: UserDoc, options: { search?: string; department?: string; status?: string } = {}): EmployeeDoc[] {
    let list: EmployeeDoc[] = [];

    if (user.role === 'ADMIN') {
      // Admin & HR see all employees
      list = Array.from(this.employees.values());
    } else if (false) {
      // Manager sees self + direct reporting employees (Rule 3)
      const empId = user.employeeId;
      const managerEmp = empId ? this.employees.get(empId!) : undefined;
      const managerEmpId = managerEmp?._id;

      list = Array.from(this.employees.values()).filter(
        (emp) => emp.userId === user._id || (managerEmpId && emp.reportingManagerId === managerEmpId)
      );
    } else {
      // Employee sees only self (Rule 4)
      list = Array.from(this.employees.values()).filter((emp) => emp.userId === user._id);
    }

    // Apply filters
    if (options.department && options.department !== 'ALL') {
      list = list.filter((emp) => emp.department.toLowerCase().includes(options.department!.toLowerCase()));
    }

    if (options.status && options.status !== 'ALL') {
      list = list.filter((emp) => emp.status === options.status);
    }

    if (options.search) {
      const q = options.search.toLowerCase();
      list = list.filter(
        (emp) =>
          emp.firstName.toLowerCase().includes(q) ||
          emp.lastName.toLowerCase().includes(q) ||
          emp.employeeCode.toLowerCase().includes(q) ||
          emp.workEmail.toLowerCase().includes(q) ||
          emp.designation.toLowerCase().includes(q)
      );
    }

    return list;
  }

  createUser(user: Omit<UserDoc, '_id' | 'createdAt' | 'updatedAt'>): UserDoc {
    const id = `usr_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();
    const newUser: UserDoc = {
      orgSetupCompleted: true,
      orgSetupStep: 4,
      ...user,
      _id: id,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(id, newUser);
    return newUser;
  }

  createEmployee(emp: Omit<EmployeeDoc, '_id'>): EmployeeDoc {
    const id = `emp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newEmp: EmployeeDoc = {
      ...emp,
      _id: id,
    };
    this.employees.set(id, newEmp);
    return newEmp;
  }

  updateEmployee(id: string, partial: Partial<EmployeeDoc>): EmployeeDoc | undefined {
    const emp = this.employees.get(id);
    if (!emp) return undefined;
    const updated = {
      ...emp,
      ...partial,
    };
    this.employees.set(id, updated);
    return updated;
  }

  updateUser(id: string, partial: Partial<UserDoc>): UserDoc | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = {
      ...user,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    this.users.set(id, updated);
    return updated;
  }

  logAudit(entry: Omit<AuditLogDoc, '_id' | 'timestamp'>): void {
    this.auditLogs.unshift({
      ...entry,
      _id: `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
    });
  }

  // Documents Methods (Role Scoped: Rule 1, 2, 3, 4)
  getDocumentsForUser(
    user: UserDoc,
    options: { category?: string; status?: string; employeeId?: string } = {}
  ): DocumentDoc[] {
    let docs = Array.from(this.documents.values());

    if (user.role === 'ADMIN') {
      // Admin and HR can see all documents
      if (options.employeeId) {
        docs = docs.filter((d) => d.employeeId === options.employeeId);
      }
    } else if (false) {
      // Manager can see their own documents and their direct reports' documents
      const directReports = Array.from(this.employees.values())
        .filter((e) => e.reportingManagerId === user.employeeId)
        .map((e) => e._id);
      const allowedIds = new Set([user.employeeId, ...directReports]);
      docs = docs.filter((d) => allowedIds.has(d.employeeId));

      if (options.employeeId) {
        if (!allowedIds.has(options.employeeId)) return [];
        docs = docs.filter((d) => d.employeeId === options.employeeId);
      }
    } else {
      // Employee sees only their own documents
      docs = docs.filter((d) => d.employeeId === user.employeeId);
    }

    if (options.category && options.category !== 'ALL') {
      docs = docs.filter((d) => d.category === options.category);
    }

    if (options.status && options.status !== 'ALL') {
      if (options.status === 'REVISION_REQUESTED') {
        docs = docs.filter((d) => d.status === 'REVISION_REQUESTED' || d.status === 'REJECTED');
      } else {
        docs = docs.filter((d) => d.status === options.status);
      }
    }

    // Sort newest first
    return docs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }

  createDocument(doc: Omit<DocumentDoc, '_id'>): DocumentDoc {
    const id = `doc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newDoc: DocumentDoc = {
      ...doc,
      _id: id,
    };
    this.documents.set(id, newDoc);
    return newDoc;
  }

  updateDocument(id: string, partial: Partial<DocumentDoc>): DocumentDoc | undefined {
    const doc = this.documents.get(id);
    if (!doc) return undefined;
    const updated = { ...doc, ...partial };
    this.documents.set(id, updated);
    return updated;
  }

  deleteDocument(id: string): boolean {
    return this.documents.delete(id);
  }

  // Lifecycle Events Methods (Role Scoped)
  getLifecycleEventsForUser(
    user: UserDoc,
    options: { eventType?: string; employeeId?: string } = {}
  ): LifecycleEventDoc[] {
    let events = [...this.lifecycleEvents];

    if (user.role === 'ADMIN') {
      if (options.employeeId) {
        events = events.filter((e) => e.employeeId === options.employeeId);
      }
    } else if (false) {
      const directReports = Array.from(this.employees.values())
        .filter((e) => e.reportingManagerId === user.employeeId)
        .map((e) => e._id);
      const allowedIds = new Set([user.employeeId, ...directReports]);
      events = events.filter((e) => allowedIds.has(e.employeeId));

      if (options.employeeId) {
        if (!allowedIds.has(options.employeeId)) return [];
        events = events.filter((e) => e.employeeId === options.employeeId);
      }
    } else {
      events = events.filter((e) => e.employeeId === user.employeeId);
    }

    if (options.eventType && options.eventType !== 'ALL') {
      events = events.filter((e) => e.eventType === options.eventType);
    }

    return events.sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime());
  }

  createLifecycleEvent(event: Omit<LifecycleEventDoc, '_id' | 'initiatedAt'>): LifecycleEventDoc {
    const id = `lc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newEvent: LifecycleEventDoc = {
      ...event,
      _id: id,
      initiatedAt: new Date().toISOString(),
    };
    this.lifecycleEvents.unshift(newEvent);
    return newEvent;
  }

  // Onboarding Queue Methods
  getOnboardingSubmissions(): OnboardingSubmissionDoc[] {
    return Array.from(this.onboardingSubmissions.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  getOnboardingSubmissionById(id: string): OnboardingSubmissionDoc | undefined {
    return this.onboardingSubmissions.get(id);
  }

  updateOnboardingSubmission(
    id: string,
    partial: Partial<OnboardingSubmissionDoc>
  ): OnboardingSubmissionDoc | undefined {
    const sub = this.onboardingSubmissions.get(id);
    if (!sub) return undefined;
    const updated = {
      ...sub,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    this.onboardingSubmissions.set(id, updated);
    return updated;
  }

  // ---- Shift resolution & extra-day credit --------------------------------

  /** Employee shift strings ("Standard General (09:00 - 18:00)") don't always equal ShiftDoc names,
   *  so match by name/code first, then by the time window in brackets. */
  resolveShift(shiftName?: string): ShiftDoc | undefined {
    if (!shiftName) return undefined;
    const n = shiftName.trim().toLowerCase();
    const all = Array.from(this.shifts.values());

    const exact = all.find((x) => x.name.toLowerCase() === n || x.code.toLowerCase() === n);
    if (exact) return exact;

    const window = shiftName.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
    if (window) {
      const byTime = all.find((x) => x.startTime === window[1] && x.endTime === window[2]);
      if (byTime) return byTime;
    }

    return all.find((x) => n.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(n));
  }

  isNightShiftByName(shiftName?: string): boolean {
    const shift = this.resolveShift(shiftName);
    if (shift) return shift.isNightShift;
    // Unknown shift: treat a window that ends before it starts (e.g. 22:00 - 06:00) as night.
    const window = shiftName?.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
    return window ? window[2] < window[1] : false;
  }

  /** Single place that turns check-in/out times into hours + extra-day credit. */
  applyShiftHours(record: AttendanceRecordDoc): void {
    record.isNightShift = this.isNightShiftByName(record.shiftName);

    if (!record.checkInTime || !record.checkOutTime) {
      record.extraDayCredit = record.extraDayCredit ?? 0;
      record.extraPayTier = record.extraPayTier ?? 'NONE';
      return;
    }

    const grossMinutes = grossMinutesBetween(record.checkInTime, record.checkOutTime);
    record.totalMinutesWorked = grossMinutes;

    // Effective hours = time actually worked, i.e. gross minus the break.
    const netMinutes = Math.max(0, grossMinutes - (record.breakMinutes || 60));
    record.effectiveWorkingHours = Math.round((netMinutes / 60) * 100) / 100;

    // The 8h shift includes the break, so pay tiers use gross time.
    const credit = computeShiftCredit(grossMinutes, record.isNightShift);
    record.overtimeMinutes = credit.extraMinutes;
    record.overtimeHours = Math.round((credit.extraMinutes / 60) * 100) / 100;
    record.extraDayCredit = credit.extraDayCredit;
    record.extraPayTier = credit.tier;
  }

  // Attendance & Overtime Methods (Role-Scoped)
  getAttendanceForUser(
    user: UserDoc,
    options: { date?: string; month?: string; employeeId?: string; status?: string } = {}
  ): AttendanceRecordDoc[] {
    let records = Array.from(this.attendanceRecords.values());

    if (user.role === 'ADMIN') {
      if (options.employeeId) {
        records = records.filter((r) => r.employeeId === options.employeeId);
      }
    } else if (false) {
      const directReports = Array.from(this.employees.values())
        .filter((e) => e.reportingManagerId === user.employeeId)
        .map((e) => e._id);
      const allowedIds = new Set([user.employeeId, ...directReports]);
      records = records.filter((r) => allowedIds.has(r.employeeId));

      if (options.employeeId) {
        if (!allowedIds.has(options.employeeId)) return [];
        records = records.filter((r) => r.employeeId === options.employeeId);
      }
    } else {
      records = records.filter((r) => r.employeeId === user.employeeId);
    }

    if (options.date) {
      records = records.filter((r) => r.date === options.date);
    }

    if (options.month) {
      records = records.filter((r) => r.date.startsWith(options.month!));
    }

    if (options.status && options.status !== 'ALL') {
      records = records.filter((r) => r.status === options.status);
    }

    return records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  checkIn(employeeId: string, location?: string, ipAddress?: string, geo?: GeoFix, clientTime?: string): AttendanceRecordDoc {
    const emp = this.employees.get(employeeId);
    if (!emp) throw new Error('Employee not found');

    const todayStr = new Date().toISOString().split('T')[0];
    const nowTimeStr = clientTime || new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    let workMode: 'WORK_FROM_OFFICE' | 'WORK_FROM_HOME' = 'WORK_FROM_HOME';
    let checkInDistanceKm: number | undefined = undefined;
    if (geo && isValidFix(geo)) {
      const d = distanceFromOffice(geo, emp.location);
      checkInDistanceKm = d.km;
      if (isWithinOffice(d.km)) {
        workMode = 'WORK_FROM_OFFICE';
      }
    }

    // Check if already checked in today
    let existing = Array.from(this.attendanceRecords.values()).find(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    if (existing) {
      existing.checkInTime = nowTimeStr;
      existing.status = 'PRESENT';
      existing.workMode = workMode;
      existing.checkInDistanceKm = checkInDistanceKm;
      if (location) existing.location = location;
      return existing;
    }

    const id = `att_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newRecord: AttendanceRecordDoc = {
      _id: id,
      employeeId: emp._id,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      employeeCode: emp.employeeCode,
      department: emp.department,
      date: todayStr,
      shiftName: emp.shift || 'Standard Corporate Shift',
      shiftExpectedHours: 8,
      checkInTime: nowTimeStr,
      totalMinutesWorked: 0,
      breakMinutes: 60,
      effectiveWorkingHours: 0,
      overtimeMinutes: 0,
      overtimeHours: 0,
      isNightShift: this.isNightShiftByName(emp.shift),
      extraDayCredit: 0,
      extraPayTier: 'NONE',
      status: 'PRESENT',
      workMode,
      checkInDistanceKm,
      location: location || 'Headquarters WiFi',
      ipAddress: ipAddress || '198.51.100.1',
    };

    this.attendanceRecords.set(id, newRecord);
    return newRecord;
  }

  checkOut(employeeId: string, location?: string, geo?: GeoFix, clientTime?: string): AttendanceRecordDoc {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const yesterdayStr = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const nowTimeStr = clientTime || now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const all = Array.from(this.attendanceRecords.values());
    let record = all.find((r) => r.employeeId === employeeId && r.date === todayStr);

    // Night shifts: the person checked in yesterday and is checking out after midnight.
    if (!record || !record.checkInTime || record.checkOutTime) {
      const openFromYesterday = all.find(
        (r) =>
          r.employeeId === employeeId &&
          r.date === yesterdayStr &&
          r.isNightShift === true &&
          Boolean(r.checkInTime) &&
          !r.checkOutTime
      );
      if (openFromYesterday) record = openFromYesterday;
    }

    if (!record) {
      record = this.checkIn(employeeId);
      record.checkInTime = '09:00';
    }

    record.checkOutTime = nowTimeStr;
    if (location) {
      record.checkOutLocation = location;
    }

    if (geo && isValidFix(geo)) {
      const emp = this.employees.get(record.employeeId);
      const d = distanceFromOffice(geo, emp?.location);
      record.checkOutDistanceKm = d.km;
      if (record.workMode === 'WORK_FROM_OFFICE' && isWithinOffice(d.km)) {
        record.workMode = 'WORK_FROM_OFFICE';
      } else {
        record.workMode = 'WORK_FROM_HOME';
      }
    }

    this.applyShiftHours(record);
    return record;
  }

  regularizeAttendance(
    id: string,
    updates: Partial<AttendanceRecordDoc>,
    regularizedBy: string
  ): AttendanceRecordDoc | undefined {
    const record = this.attendanceRecords.get(id);
    if (!record) return undefined;

    Object.assign(record, updates, {
      isRegularized: true,
      regularizedBy,
    });

    // Recalculate hours and shift credit if checkIn / checkOut provided
    this.applyShiftHours(record);

    return record;
  }

  // Shifts Methods
  getShifts(): ShiftDoc[] {
    return Array.from(this.shifts.values());
  }

  createShift(shift: Omit<ShiftDoc, '_id' | 'createdAt'>): ShiftDoc {
    const id = `shift_${Date.now()}`;
    const newShift: ShiftDoc = {
      ...shift,
      // A shift that ends before it starts crosses midnight, so it is a night shift.
      isNightShift: shift.isNightShift || shift.endTime < shift.startTime,
      _id: id,
      createdAt: new Date().toISOString(),
    };
    this.shifts.set(id, newShift);
    return newShift;
  }

  updateShift(id: string, updates: Partial<ShiftDoc>): ShiftDoc | undefined {
    const shift = this.shifts.get(id);
    if (!shift) return undefined;
    const updated = { ...shift, ...updates };
    if (updated.endTime < updated.startTime) updated.isNightShift = true;
    this.shifts.set(id, updated);
    return updated;
  }

  deleteShift(id: string): boolean {
    return this.shifts.delete(id);
  }
}

export const dbStore = new InMemoryMongoStore();