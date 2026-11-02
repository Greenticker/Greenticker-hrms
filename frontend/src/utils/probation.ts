import { Employee } from '../types/employee';

export interface ProbationInfo {
  months: number;
  startDate: string;
  endDate: string;
  daysRemaining: number;
  isExpiringSoon: boolean;
  isOverdue: boolean;
}

export function getProbationDetails(emp: Employee): ProbationInfo {
  const months = emp.probationMonths ?? 6;
  const startDate = emp.joiningDate || new Date().toISOString().split('T')[0];

  let endDateStr = emp.probationEndDate;
  if (!endDateStr) {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + months);
    endDateStr = d.toISOString().split('T')[0];
  }

  const end = new Date(endDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const diffMs = end.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return {
    months,
    startDate,
    endDate: endDateStr,
    daysRemaining,
    isExpiringSoon: emp.status === 'PROBATION' && daysRemaining <= 30 && daysRemaining >= 0,
    isOverdue: emp.status === 'PROBATION' && daysRemaining < 0,
  };
}

export function formatProbationDate(isoDate: string): string {
  if (!isoDate) return '—';
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return isoDate;
  }
}
