export type AttendanceStatus =
  | 'PRESENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'ON_LEAVE'
  | 'WORK_FROM_HOME';

export interface AttendanceRecord {
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
  overtimeMinutes: number;
  overtimeHours: number;
  isNightShift?: boolean;
  /** Extra salary days earned for this shift: 0, 0.5, 1 or 1.5 */
  extraDayCredit?: number;
  extraPayTier?: 'NONE' | 'HALF_DAY' | 'FULL_DAY' | 'ONE_AND_HALF_DAY';
  status: AttendanceStatus;
  isRegularized?: boolean;
  regularizationReason?: string;
  regularizedBy?: string;
  location?: string;
  ipAddress?: string;
  notes?: string;
}

export interface AttendanceStats {
  totalRecords: number;
  todayPresent: number;
  todayCheckedInNow: number;
  todayLate: number;
  totalOvertimeHours: number;
  totalExtraDayCredit: number;
  totalWorkedHours: number;
}

export interface Shift {
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