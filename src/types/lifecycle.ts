export type LifecycleEventType =
  | 'PROMOTION'
  | 'TRANSFER'
  | 'DESIGNATION_CHANGE'
  | 'MANAGER_CHANGE'
  | 'SALARY_REVISION'
  | 'CONFIRMATION'
  | 'STATUS_CHANGE';

export interface LifecycleEvent {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  eventType: LifecycleEventType;
  effectiveDate: string;
  previousValue: string;
  newValue: string;
  reason: string;
  initiatedBy: string;
  initiatedAt: string;
  approvalStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
  notes?: string;
}
