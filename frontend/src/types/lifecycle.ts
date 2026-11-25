export type LifecycleEventType =
  | 'PROMOTION'
  | 'TRANSFER'
  | 'DESIGNATION_CHANGE'
  | 'MANAGER_CHANGE'
  | 'SALARY_REVISION'
  | 'CONFIRMATION'
  | 'STATUS_CHANGE'
  /** Written automatically by the resignation / exit flow */
  | 'SEPARATION';

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
  /** Resignation or exit record this event came from */
  sourceId?: string;
}
