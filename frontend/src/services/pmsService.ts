import { request } from './api';
import {
  BulkActualsResult,
  BulkGoalsResult,
  FeedbackNote,
  PersonRow,
  PmsReports,
  ReminderItem,
  Appraisal,
  CalibrationRow,
  IncrementRow,
  PayrollRow,
  Pip,
  PipProgress,
  Assignment360,
  Checkin,
  CheckinPeriod,
  Feedback360State,
  Group360,
  Nomination360View,
  Overview360Row,
  Question360,
  RaterRow,
  Report360,
  Competency,
  CyclePhase,
  GoalLine,
  GoalSheet,
  GoalSheetSummary,
  KpiLibraryItem,
  PmsContext,
  PmsCycle,
  PmsTemplate,
} from '../types/pms';

const BASE = '/performance';

const send = <T>(path: string, method: string, body?: unknown) =>
  request<T>(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export type CycleInput = Pick<PmsCycle, 'name' | 'year' | 'startDate' | 'endDate' | 'phases'>;
export type TemplateInput = Omit<PmsTemplate, '_id' | 'createdBy' | 'createdOn' | 'updatedBy' | 'updatedOn'>;
export type KpiInput = Omit<KpiLibraryItem, '_id' | 'createdBy' | 'createdOn' | 'updatedBy' | 'updatedOn'>;
export type CompetencyInput = Pick<Competency, 'name' | 'description' | 'appliesTo'>;

export const pmsService = {
  getContext: () => request<PmsContext>(`${BASE}/context`),

  // Cycles
  getCycles: () => request<{ cycles: PmsCycle[] }>(`${BASE}/cycles`),
  getDefaultPhases: (year: number) => request<{ phases: CyclePhase[] }>(`${BASE}/cycles/default-phases?year=${year}`),
  createCycle: (data: CycleInput) => send<{ cycle: PmsCycle }>('/cycles', 'POST', data),
  updateCycle: (id: string, data: CycleInput) => send<{ cycle: PmsCycle }>(`/cycles/${id}`, 'PUT', data),
  activateCycle: (id: string) => send<{ cycle: PmsCycle }>(`/cycles/${id}/activate`, 'POST', {}),
  closeCycle: (id: string, reason: string) => send<{ cycle: PmsCycle }>(`/cycles/${id}/close`, 'POST', { reason }),
  setRevisionWindow: (id: string, data: { open: boolean; closesOn?: string; reason?: string }) =>
    send<{ cycle: PmsCycle }>(`/cycles/${id}/revision-window`, 'POST', data),

  // Templates
  getTemplates: () => request<{ templates: PmsTemplate[] }>(`${BASE}/templates`),
  createTemplate: (data: TemplateInput) => send<{ template: PmsTemplate }>('/templates', 'POST', data),
  updateTemplate: (id: string, data: TemplateInput) => send<{ template: PmsTemplate }>(`/templates/${id}`, 'PUT', data),
  deleteTemplate: (id: string) => send<{ success: boolean }>(`/templates/${id}`, 'DELETE'),

  // KPI library
  getKpiLibrary: () => request<{ kpis: KpiLibraryItem[] }>(`${BASE}/kpi-library`),
  createKpi: (data: KpiInput) => send<{ kpi: KpiLibraryItem }>('/kpi-library', 'POST', data),
  updateKpi: (id: string, data: KpiInput) => send<{ kpi: KpiLibraryItem }>(`/kpi-library/${id}`, 'PUT', data),
  deleteKpi: (id: string) => send<{ success: boolean }>(`/kpi-library/${id}`, 'DELETE'),

  // Competencies
  getCompetencies: () => request<{ competencies: Competency[] }>(`${BASE}/competencies`),
  createCompetency: (data: CompetencyInput) => send<{ competency: Competency }>('/competencies', 'POST', data),
  updateCompetency: (id: string, data: CompetencyInput) =>
    send<{ competency: Competency }>(`/competencies/${id}`, 'PUT', data),
  deleteCompetency: (id: string) => send<{ success: boolean }>(`/competencies/${id}`, 'DELETE'),

  // Goal sheets
  listSheets: (scope: 'team' | 'review' | 'all') =>
    request<{ cycle: PmsCycle | null; rows: GoalSheetSummary[] }>(`${BASE}/goal-sheets?scope=${scope}`),
  getSheetForEmployee: (employeeId: string, create = false) =>
    request<{ sheet: GoalSheet | null }>(`${BASE}/goal-sheets/employee/${employeeId}${create ? '?create=true' : ''}`),
  getSheet: (id: string) => request<{ sheet: GoalSheet }>(`${BASE}/goal-sheets/${id}`),
  saveLines: (id: string, lines: GoalLine[]) => send<{ sheet: GoalSheet }>(`/goal-sheets/${id}/lines`, 'PUT', { lines }),
  submit: (id: string, comment = '') => send<{ sheet: GoalSheet }>(`/goal-sheets/${id}/submit`, 'POST', { comment }),
  approve: (id: string, comment = '') => send<{ sheet: GoalSheet }>(`/goal-sheets/${id}/approve`, 'POST', { comment }),
  sendBack: (id: string, comment: string) => send<{ sheet: GoalSheet }>(`/goal-sheets/${id}/send-back`, 'POST', { comment }),
  revise: (id: string, reason: string) => send<{ sheet: GoalSheet }>(`/goal-sheets/${id}/revise`, 'POST', { reason }),
  recordActuals: (id: string, actuals: Record<string, number | null>, reason = '') =>
    send<{ sheet: GoalSheet }>(`/goal-sheets/${id}/actuals`, 'PUT', { actuals, reason }),

  // Check-ins & mid-year review
  getCheckins: (employeeId: string) =>
    request<{ goalsLocked: boolean; checkins: Checkin[] }>(`${BASE}/checkins/${employeeId}`),
  saveCheckin: (employeeId: string, period: CheckinPeriod, data: { progress: Record<string, number | null>; employeeComment: string }) =>
    send<{ checkin: Checkin }>(`/checkins/${employeeId}/${period}`, 'PUT', data),
  submitCheckin: (employeeId: string, period: CheckinPeriod) =>
    send<{ checkin: Checkin }>(`/checkins/${employeeId}/${period}/submit`, 'POST', {}),
  completeCheckin: (employeeId: string, period: CheckinPeriod, managerComment: string) =>
    send<{ checkin: Checkin }>(`/checkins/${employeeId}/${period}/complete`, 'POST', { managerComment }),

  // 360° feedback
  get360: (employeeId: string) => request<Nomination360View>(`${BASE}/360/${employeeId}`),
  getCandidates: (employeeId: string) => request<{ candidates: RaterRow[] }>(`${BASE}/360/${employeeId}/candidates`),
  saveNominations: (employeeId: string, raterIds: string[]) =>
    send<Nomination360View>(`/360/${employeeId}/nominations`, 'PUT', { raterIds }),
  submitNominations: (employeeId: string) => send<Nomination360View>(`/360/${employeeId}/nominations/submit`, 'POST', {}),
  approveNominations: (employeeId: string, comment = '') =>
    send<Nomination360View>(`/360/${employeeId}/nominations/approve`, 'POST', { comment }),
  sendBackNominations: (employeeId: string, comment: string) =>
    send<Nomination360View>(`/360/${employeeId}/nominations/send-back`, 'POST', { comment }),
  getReport360: (employeeId: string) => request<Report360>(`${BASE}/360/${employeeId}/report`),
  getOverview360: () =>
    request<{ cycle: PmsCycle | null; feedback360?: Feedback360State; rows: Overview360Row[] }>(`${BASE}/360/overview`),
  myAssignments: () => request<{ assignments: Assignment360[]; closed: boolean; due?: string }>(`${BASE}/360/assignments/mine`),
  getFeedbackForm: (assignmentId: string) =>
    request<{ assignmentId: string; rateeName: string; group: Group360; questions: { _id: string; text: string; competencyName: string }[] }>(
      `${BASE}/360/assignments/${assignmentId}/form`
    ),
  submitFeedback: (assignmentId: string, answers: Record<string, number>, comment: string) =>
    send<{ success: boolean }>(`/360/assignments/${assignmentId}/submit`, 'POST', { answers, comment }),
  getQuestions: () => request<{ questions: Question360[] }>(`${BASE}/360/questions`),
  createQuestion: (data: { text: string; competencyId: string; order?: number }) =>
    send<{ question: Question360 }>('/360/questions', 'POST', data),
  updateQuestion: (id: string, data: { text: string; competencyId: string; order?: number }) =>
    send<{ question: Question360 }>(`/360/questions/${id}`, 'PUT', data),
  deleteQuestion: (id: string) => send<{ success: boolean }>(`/360/questions/${id}`, 'DELETE'),
  close360: (cycleId: string) => send<{ cycle: PmsCycle }>(`/cycles/${cycleId}/360-close`, 'POST', {}),
  release360: (cycleId: string) => send<{ cycle: PmsCycle }>(`/cycles/${cycleId}/360-release`, 'POST', {}),

  // Year-end appraisal
  getAppraisal: (employeeId: string, create = false) =>
    request<{ appraisal: Appraisal | null; goalsLocked?: boolean }>(`${BASE}/appraisals/employee/${employeeId}${create ? '?create=true' : ''}`),
  saveSelf: (id: string, data: { competencyRatings: Record<string, number>; comments: string }) =>
    send<{ appraisal: Appraisal }>(`/appraisals/${id}/self`, 'PUT', data),
  submitSelf: (id: string) => send<{ appraisal: Appraisal }>(`/appraisals/${id}/self/submit`, 'POST', {}),
  saveManager: (
    id: string,
    data: { competencyRatings: Record<string, number>; kpiOverride: number | null; kpiOverrideReason: string; comments: string }
  ) => send<{ appraisal: Appraisal }>(`/appraisals/${id}/manager`, 'PUT', data),
  submitManager: (id: string) => send<{ appraisal: Appraisal }>(`/appraisals/${id}/manager/submit`, 'POST', {}),
  sendBackAppraisal: (id: string, comment: string) => send<{ appraisal: Appraisal }>(`/appraisals/${id}/send-back`, 'POST', { comment }),
  reviewerApprove: (id: string, adjustedRating: number | null, reason: string) =>
    send<{ appraisal: Appraisal }>(`/appraisals/${id}/reviewer/approve`, 'POST', { adjustedRating, reason }),
  calibrate: (id: string, rating: number, reason: string) => send<{ appraisal: Appraisal }>(`/appraisals/${id}/calibrate`, 'POST', { rating, reason }),
  acceptRating: (id: string) => send<{ appraisal: Appraisal }>(`/appraisals/${id}/accept`, 'POST', {}),
  appealRating: (id: string, reason: string) => send<{ appraisal: Appraisal }>(`/appraisals/${id}/appeal`, 'POST', { reason }),
  resolveAppeal: (id: string, rating: number, reason: string) =>
    send<{ appraisal: Appraisal }>(`/appraisals/${id}/resolve-appeal`, 'POST', { rating, reason }),
  getCalibration: () =>
    request<{
      cycle: PmsCycle | null;
      rows: CalibrationRow[];
      notStarted: { employeeId: string; employeeName: string; department?: string }[];
      distribution: Record<string, { count: number; pct: number }>;
    }>(`${BASE}/appraisals/calibration`),
  lockCalibration: () => send<{ locked: number }>('/appraisals/calibration/lock', 'POST', {}),
  publishRatings: () => send<{ published: number }>('/appraisals/publish', 'POST', {}),
  getIncrementTable: () => request<{ rows: IncrementRow[] }>(`${BASE}/appraisals/increment-table`),
  saveIncrementTable: (rows: IncrementRow[]) => send<{ rows: IncrementRow[] }>('/appraisals/increment-table', 'PUT', { rows }),
  getPayrollExport: () =>
    request<{ cycle: { _id: string; name: string }; rows: PayrollRow[]; notReady: number }>(`${BASE}/appraisals/payroll-export`),
  markPayrollSent: () => send<{ sent: number }>('/appraisals/payroll-sent', 'POST', {}),

  // Improvement plans
  getPips: (employeeId?: string) =>
    request<{ pips: Pip[]; eligible: { appraisalId: string; employeeId: string; employeeName: string }[] }>(
      `${BASE}/pips${employeeId ? `?employeeId=${employeeId}` : ''}`
    ),
  startPips: () => send<{ started: number }>('/pips/start', 'POST', {}),
  updatePip: (id: string, data: { objectives: string[]; reviews: { day: number; notes: string; progress: PipProgress | null }[] }) =>
    send<{ pip: Pip }>(`/pips/${id}`, 'PUT', data),
  closePip: (id: string, outcome: 'SUCCESSFUL' | 'UNSUCCESSFUL' | 'EXTENDED', notes: string) =>
    send<{ pip: Pip }>(`/pips/${id}/close`, 'POST', { outcome, notes }),

  // Bulk upload (dry run unless commit)
  bulkGoals: (rows: Record<string, unknown>[], commit: boolean) => send<BulkGoalsResult>('/bulk/goals', 'POST', { rows, commit }),
  bulkActuals: (rows: Record<string, unknown>[], commit: boolean) => send<BulkActualsResult>('/bulk/actuals', 'POST', { rows, commit }),

  // Reminders
  getReminders: () => request<{ enabled: boolean; plan: ReminderItem[]; pendingTasks: number }>(`${BASE}/reminders`),
  setRemindersEnabled: (enabled: boolean) => send<{ enabled: boolean }>('/reminders/settings', 'PUT', { enabled }),
  runReminders: () => send<{ sent: number; notifications: number; emails: number }>('/reminders/run', 'POST', {}),

  // Reports
  getReports: () => request<PmsReports>(`${BASE}/reports`),

  // Continuous feedback notes
  getPeople: () => request<{ people: PersonRow[] }>(`${BASE}/people`),
  sendNote: (toEmployeeId: string, kind: FeedbackNote['kind'], text: string) =>
    send<{ note: FeedbackNote }>('/notes', 'POST', { toEmployeeId, kind, text }),
  getNotes: (employeeId?: string) =>
    request<{ received: FeedbackNote[]; sent: FeedbackNote[] }>(`${BASE}/notes${employeeId ? `?employeeId=${employeeId}` : ''}`),
};
