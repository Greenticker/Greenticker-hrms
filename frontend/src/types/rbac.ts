import { Role } from './auth';

export type AccessType = 'READ_WRITE' | 'READ_ONLY' | 'NO_ACCESS';

export interface ModuleAccessItem {
  id: string;
  name: string;
  category?: '18_MODULES' | 'PLATFORM_LEVEL';
  rationale: string;
  access: Record<
    | 'SUPER_ADMIN'
    | 'ADMIN_1'
    | 'ADMIN_2'
    | 'FINANCE'
    | 'HR'
    | 'ACCOUNTS'
    | 'AUDITORS',
    AccessType
  >;
}

export const HRMS_ACCESS_MATRIX: ModuleAccessItem[] = [
  {
    id: 'core_hr',
    name: 'Core HR',
    category: '18_MODULES',
    rationale: 'Employee master owned by HR; Finance needs read for cost centres/bank details',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_ONLY',
      FINANCE: 'READ_ONLY',
      HR: 'READ_WRITE',
      ACCOUNTS: 'NO_ACCESS',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'asset',
    name: 'Asset',
    category: '18_MODULES',
    rationale: 'Admin 2 handles day-to-day issue/return; Accounts reads for asset register',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_ONLY',
      HR: 'READ_WRITE',
      ACCOUNTS: 'READ_ONLY',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'employee_adv_loan',
    name: 'Employee Adv/Loan',
    category: '18_MODULES',
    rationale: 'Finance approves/disburses; Accounts posts & recovers; HR views for F&F',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_ONLY',
      FINANCE: 'READ_WRITE',
      HR: 'READ_ONLY',
      ACCOUNTS: 'READ_WRITE',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'report_analytics',
    name: 'Report and Analytics',
    category: '18_MODULES',
    rationale: 'Write = build/schedule custom reports; others consume reports in their scope',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_ONLY',
      HR: 'READ_ONLY',
      ACCOUNTS: 'READ_ONLY',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'audit_log',
    name: 'Audit Log',
    category: '18_MODULES',
    rationale: 'Logs should be immutable – Super Admin write limited to retention/config only',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_ONLY',
      ADMIN_2: 'READ_ONLY',
      FINANCE: 'NO_ACCESS',
      HR: 'READ_ONLY',
      ACCOUNTS: 'NO_ACCESS',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'ticketing',
    name: 'Ticketing',
    category: '18_MODULES',
    rationale: 'All functional teams raise & resolve tickets in their own queue',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_WRITE',
      HR: 'READ_WRITE',
      ACCOUNTS: 'READ_WRITE',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'announcements',
    name: 'Announcement/Mass Communication',
    category: '18_MODULES',
    rationale: 'HR & Admins publish; others receive',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_ONLY',
      HR: 'READ_WRITE',
      ACCOUNTS: 'READ_ONLY',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'leave',
    name: 'Leave',
    category: '18_MODULES',
    rationale: 'Finance reads LOP/encashment impact on payroll',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_ONLY',
      HR: 'READ_WRITE',
      ACCOUNTS: 'NO_ACCESS',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'attendance',
    name: 'Attendance',
    category: '18_MODULES',
    rationale: 'Finance reads for payroll inputs',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_ONLY',
      HR: 'READ_WRITE',
      ACCOUNTS: 'NO_ACCESS',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'self_onboarding',
    name: 'Self Onboarding',
    category: '18_MODULES',
    rationale: 'Contains personal docs – restrict to HR/Admins',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'NO_ACCESS',
      HR: 'READ_WRITE',
      ACCOUNTS: 'NO_ACCESS',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'payroll',
    name: 'Payroll',
    category: '18_MODULES',
    rationale: 'Finance processes payroll; HR verifies inputs; Accounts reads for JV posting',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_WRITE',
      HR: 'READ_ONLY',
      ACCOUNTS: 'READ_ONLY',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'recruitment',
    name: 'Recruitment',
    category: '18_MODULES',
    rationale: 'Finance reads for budget/headcount approval',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_ONLY',
      HR: 'READ_WRITE',
      ACCOUNTS: 'NO_ACCESS',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'performance',
    name: 'Performance Mgmt',
    category: '18_MODULES',
    rationale: 'Confidential – ratings restricted to HR/Admins',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'NO_ACCESS',
      HR: 'READ_WRITE',
      ACCOUNTS: 'NO_ACCESS',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'learning',
    name: 'L&D',
    category: '18_MODULES',
    rationale: 'Finance reads training spend',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_ONLY',
      HR: 'READ_WRITE',
      ACCOUNTS: 'NO_ACCESS',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'insurance',
    name: 'Insurance & Benefit',
    category: '18_MODULES',
    rationale: 'HR manages enrolment; Finance manages premiums/claims payment',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_WRITE',
      HR: 'READ_WRITE',
      ACCOUNTS: 'READ_ONLY',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'timesheet',
    name: 'Time Sheet',
    category: '18_MODULES',
    rationale: 'Used for project costing & billing by Finance/Accounts',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_ONLY',
      HR: 'READ_WRITE',
      ACCOUNTS: 'READ_ONLY',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'exit_mgmt',
    name: 'Exit Management',
    category: '18_MODULES',
    rationale: 'HR runs resignation/clearance; Finance does F&F settlement; Accounts reads for payout posting',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_WRITE',
      ADMIN_2: 'READ_WRITE',
      FINANCE: 'READ_WRITE',
      HR: 'READ_WRITE',
      ACCOUNTS: 'READ_ONLY',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'accounting',
    name: 'Accounting',
    category: '18_MODULES',
    rationale: 'Ledger/GL owned by Finance & Accounts',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'READ_ONLY',
      ADMIN_2: 'READ_ONLY',
      FINANCE: 'READ_ONLY',
      HR: 'NO_ACCESS',
      ACCOUNTS: 'READ_WRITE',
      AUDITORS: 'READ_ONLY',
    },
  },
  {
    id: 'system_config',
    name: 'System Config (Source Code, Tax Rules, Masters)',
    category: 'PLATFORM_LEVEL',
    rationale: 'Only Super Admin can change code, statutory/tax rules & global masters',
    access: {
      SUPER_ADMIN: 'READ_WRITE',
      ADMIN_1: 'NO_ACCESS',
      ADMIN_2: 'NO_ACCESS',
      FINANCE: 'NO_ACCESS',
      HR: 'NO_ACCESS',
      ACCOUNTS: 'NO_ACCESS',
      AUDITORS: 'NO_ACCESS',
    },
  },
];

export const Permissions = {
  // Employee Management
  EMPLOYEE_VIEW_ALL: 'employee:view_all',
  EMPLOYEE_VIEW_TEAM: 'employee:view_team',
  EMPLOYEE_VIEW_SELF: 'employee:view_self',
  EMPLOYEE_CREATE: 'employee:create',
  EMPLOYEE_EDIT_ALL: 'employee:edit_all',
  EMPLOYEE_EDIT_HR: 'employee:edit_hr',
  EMPLOYEE_EDIT_SELF: 'employee:edit_self',
  EMPLOYEE_DELETE: 'employee:delete',
  EMPLOYEE_DEACTIVATE: 'employee:deactivate',

  // Organization & Settings
  ORG_CONFIG: 'org:configure',
  DEPARTMENT_MANAGE: 'department:manage',
  DESIGNATION_MANAGE: 'designation:manage',
  LOCATION_MANAGE: 'location:manage',

  // Policies
  POLICY_CREATE: 'policy:create',
  POLICY_EDIT: 'policy:edit',
  POLICY_DELETE: 'policy:delete',
  POLICY_VIEW: 'policy:view',
  POLICY_ACKNOWLEDGE: 'policy:acknowledge',

  // Attendance & Overtime
  ATTENDANCE_CHECKIN_OUT: 'attendance:checkin_out',
  ATTENDANCE_VIEW_SELF: 'attendance:view_self',
  ATTENDANCE_VIEW_TEAM: 'attendance:view_team',
  ATTENDANCE_VIEW_ALL: 'attendance:view_all',
  ATTENDANCE_MANAGE: 'attendance:manage',

  // Leave Management
  LEAVE_APPLY: 'leave:apply',
  LEAVE_VIEW_SELF: 'leave:view_self',
  LEAVE_VIEW_TEAM: 'leave:view_team',
  LEAVE_VIEW_ALL: 'leave:view_all',
  LEAVE_APPROVE_TEAM: 'leave:approve_team',
  LEAVE_APPROVE_ALL: 'leave:approve_all',
  LEAVE_CONFIG: 'leave:configure',

  // Expense Management
  EXPENSE_APPLY: 'expense:apply',
  EXPENSE_VIEW_SELF: 'expense:view_self',
  EXPENSE_VIEW_TEAM: 'expense:view_team',
  EXPENSE_VIEW_ALL: 'expense:view_all',
  EXPENSE_APPROVE_TEAM: 'expense:approve_team',
  EXPENSE_APPROVE_ALL: 'expense:approve_all',
  EXPENSE_CONFIG: 'expense:configure',

  // Payroll & Tax
  PAYROLL_VIEW_SELF: 'payroll:view_self',
  PAYROLL_VIEW_ALL: 'payroll:view_all',
  PAYROLL_PROCESS: 'payroll:process',
  PAYROLL_CONFIG: 'payroll:configure',
  TAX_VIEW_SELF: 'tax:view_self',
  TAX_MANAGE_ALL: 'tax:manage_all',
  FORM16_VIEW_SELF: 'form16:view_self',
  FORM16_GENERATE: 'form16:generate',

  // Documents & HR Letters
  DOCUMENT_VIEW_SELF: 'document:view_self',
  DOCUMENT_VIEW_ALL: 'document:view_all',
  DOCUMENT_VERIFY: 'document:verify',
  DOCUMENT_GENERATE_LETTERS: 'document:generate_letters',

  // POSH & Compliance
  POSH_VIEW_CASES: 'posh:view_cases',
  POSH_MANAGE: 'posh:manage',

  // AI Assistant
  AI_USE: 'ai:use',
  AI_CONFIG: 'ai:configure',

  // Audit & Reports
  AUDIT_VIEW: 'audit:view',
  REPORT_VIEW_ALL: 'report:view_all',
  REPORT_VIEW_TEAM: 'report:view_team',
  REPORT_VIEW_SELF: 'report:view_self',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export function canAccess(userPermissions: string[] | undefined, permission: string): boolean {
  if (!userPermissions) return false;
  return userPermissions.includes(permission);
}

/** Check module access for a role based on PDF matrix */
export function getRoleModuleAccess(role: Role, moduleId: string): AccessType {
  // Normalize mapped roles
  let targetRole: keyof ModuleAccessItem['access'] = 'HR';
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') targetRole = 'SUPER_ADMIN';
  else if (role === 'ADMIN_1') targetRole = 'ADMIN_1';
  else if (role === 'ADMIN_2') targetRole = 'ADMIN_2';
  else if (role === 'FINANCE') targetRole = 'FINANCE';
  else if (role === 'HR') targetRole = 'HR';
  else if (role === 'ACCOUNTS') targetRole = 'ACCOUNTS';
  else if (role === 'AUDITORS') targetRole = 'AUDITORS';
  else if (role === 'MANAGER' || role === 'EMPLOYEE') {
    // Basic employee/manager permissions fall into general scope
    if (['leave', 'attendance', 'expenses', 'ticketing', 'announcements'].includes(moduleId)) {
      return 'READ_WRITE';
    }
    return 'READ_ONLY';
  }

  const moduleItem = HRMS_ACCESS_MATRIX.find((m) => m.id === moduleId);
  if (!moduleItem) return 'READ_ONLY';
  return moduleItem.access[targetRole] || 'NO_ACCESS';
}
