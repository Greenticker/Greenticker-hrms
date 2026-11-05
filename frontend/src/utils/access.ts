import { HRMS_ACCESS_MATRIX } from '../types/rbac';

// Official role matrix (Roles PDF). Must match backend/app/auth/module_access.py.
// The legacy ADMIN role is not in the matrix and keeps full access everywhere.
export type ModuleId =
  | 'core_hr' | 'asset' | 'employee_adv_loan' | 'report_analytics' | 'audit_log' | 'ticketing'
  | 'announcements' | 'leave' | 'attendance' | 'self_onboarding' | 'payroll' | 'recruitment'
  | 'performance' | 'learning' | 'insurance' | 'timesheet' | 'exit_mgmt' | 'accounting' | 'system_config';

const accessOf = (role: string | undefined, module: ModuleId): string => {
  if (!role) return 'NO_ACCESS';
  if (role === 'ADMIN') return 'READ_WRITE';
  const item = HRMS_ACCESS_MATRIX.find((m) => m.id === module);
  return (item?.access as Record<string, string> | undefined)?.[role] ?? 'NO_ACCESS';
};

/** May this role change data in the module? */
export const canWrite = (role: string | undefined, module: ModuleId) => accessOf(role, module) === 'READ_WRITE';

/** May this role view the module? */
export const canRead = (role: string | undefined, module: ModuleId) => accessOf(role, module) !== 'NO_ACCESS';
