import { HRMS_ACCESS_MATRIX } from '../types/rbac';

// Official role matrix (Roles PDF). Must match backend/app/auth/module_access.py.
// The legacy ADMIN role is not in the matrix and keeps full access everywhere.
export type ModuleId =
  | 'core_hr' | 'asset' | 'employee_adv_loan' | 'report_analytics' | 'audit_log' | 'ticketing'
  | 'announcements' | 'leave' | 'attendance' | 'self_onboarding' | 'payroll' | 'recruitment'
  | 'performance' | 'learning' | 'insurance' | 'timesheet' | 'exit_mgmt' | 'accounting' | 'system_config';

const accessOf = (role: string | undefined, module: ModuleId): string => {
  if (!role) return 'NO_ACCESS';
  if (role === 'ADMIN') return module === 'payroll' ? 'NO_ACCESS' : 'READ_WRITE';
  const item = HRMS_ACCESS_MATRIX.find((m) => m.id === module);
  return (item?.access as Record<string, string> | undefined)?.[role] ?? 'NO_ACCESS';
};

/** May this role change data in the module? */
export const canWrite = (role: string | undefined, module: ModuleId) => accessOf(role, module) === 'READ_WRITE';

/** May this role view the module? */
export const canRead = (role: string | undefined, module: ModuleId) => accessOf(role, module) !== 'NO_ACCESS';

/** Roles that create / edit employee master data, org masters and employee documents. Mirrors MASTER_WRITE_ROLES in backend/app/auth/employee_access.py. */
export const MASTER_WRITE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'ADMIN_1', 'HR'];

/** Roles that see the whole employee master (employee:view_all). */
export const VIEW_ALL_EMPLOYEE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'ADMIN_1', 'ADMIN_2', 'FINANCE', 'HR', 'ACCOUNTS', 'AUDITORS'];

export const canWriteMaster = (role: string | undefined) => !!role && MASTER_WRITE_ROLES.includes(role);

/** Roles that may only look, never change anything (auditors). The API enforces this too. */
export const isReadOnlyRole = (role: string | undefined) => role === 'AUDITORS';
export const canViewAllEmployees = (role: string | undefined) => !!role && VIEW_ALL_EMPLOYEE_ROLES.includes(role);

/** Readable message from an API error, including the per-field list the backend sends as `errors`. */
export const apiErrorMessages = (err: any, fallback = 'Something went wrong.'): string[] => {
  const list = err?.data?.errors;
  if (Array.isArray(list) && list.length > 0) return list.map(String);
  return [err?.message || fallback];
};
