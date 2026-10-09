import { Role } from './auth';

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
