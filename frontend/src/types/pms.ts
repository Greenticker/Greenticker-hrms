// Performance Management System (PMS) – phase 1: setup and goal sheets.

export type Direction = 'HIGHER' | 'LOWER';
export type CycleStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';
export type GoalSheetStatus = 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'LOCKED';

interface Stamped {
  createdBy?: string;
  createdOn?: string;
  updatedBy?: string;
  updatedOn?: string;
}

export interface CyclePhase {
  key: string;
  label: string;
  start: string;
  end: string;
}

export interface RevisionWindow {
  open: boolean;
  closesOn: string;
  reason: string;
  openedBy: string;
  openedOn: string;
}

export interface PmsCycle extends Stamped {
  _id: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
  phases: CyclePhase[];
  status: CycleStatus;
  revisionWindow: RevisionWindow | null;
  feedback360?: Feedback360State;
}

export interface PmsTemplate extends Stamped {
  _id: string;
  name: string;
  grades: string[];
  isDefault: boolean;
  kpiWeight: number;
  competencyWeight: number;
  feedback360Weight: number;
}

export interface KpiLibraryItem extends Stamped {
  _id: string;
  department: string;
  kra: string;
  kpi: string;
  unit: string;
  direction: Direction;
  mandatory: boolean;
}

export interface Competency extends Stamped {
  _id: string;
  name: string;
  description: string;
  appliesTo: 'ALL' | 'MANAGERS';
}

export interface GoalLine {
  _id?: string;
  libraryId?: string | null;
  kra: string;
  kpi: string;
  unit: string;
  direction: Direction;
  /** Percent, e.g. 30 = 30% */
  weight: number | null;
  target: number | null;
  actual?: number | null;
  achievement?: number | null;
  score?: number | null;
}

export interface TrailEntry {
  at: string;
  byName: string;
  action: string;
  fromStatus: GoalSheetStatus;
  toStatus: GoalSheetStatus;
  comment: string;
}

export interface SheetPermissions {
  canView: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canSendBack: boolean;
  canRevise: boolean;
  canRecordActuals: boolean;
}

export interface GoalSheetSummary {
  sheetId: string | null;
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  department?: string;
  designation?: string;
  grade: string | null;
  managerName: string;
  status: GoalSheetStatus;
  version: number | null;
  lineCount: number;
  weightTotal: number;
  kpiScore: number | null;
  updatedOn?: string;
}

export interface GoalSheet extends Omit<GoalSheetSummary, 'sheetId'>, Stamped {
  _id: string;
  cycleId: string;
  managerId: string | null;
  reviewerId: string | null;
  reviewerName: string;
  lines: GoalLine[];
  history: { version: number; lines: GoalLine[]; lockedOn: string; lockedBy: string }[];
  trail: TrailEntry[];
  cycle: { _id: string; name: string; status: CycleStatus; revisionOpen: boolean };
  weights: { templateId: string | null; templateName: string | null; kpi: number; competency: number; feedback360: number };
  validationErrors: string[];
  permissions: SheetPermissions;
}

export interface PmsRules {
  minLines: number;
  maxLines: number;
  minWeight: number;
  maxWeight: number;
  complianceKra: string;
  complianceMinWeight: number;
}

export interface PmsContext {
  activeCycle: PmsCycle | null;
  revisionOpen: boolean;
  isHR: boolean;
  canViewAll: boolean;
  employeeId: string | null;
  hasTeam: boolean;
  hasReviewees: boolean;
  pendingFeedback: number;
  rules: PmsRules;
}

// ------------------------------------------------------------ phase 2

export type CheckinPeriod = 'Q1' | 'Q2' | 'MID_YEAR' | 'Q3';
export type CheckinStatus = 'OPEN' | 'WITH_MANAGER' | 'DONE';

export interface CheckinLine {
  lineId: string;
  kpi: string;
  unit: string;
  direction: Direction;
  weight: number;
  target: number;
  value: number | null;
  achievement: number | null;
  score: number | null;
}

export interface Checkin {
  period: CheckinPeriod;
  label: string;
  start?: string;
  due?: string;
  overdue: boolean;
  status: CheckinStatus;
  employeeComment: string;
  managerComment: string;
  submittedOn?: string;
  completedOn?: string;
  completedBy?: string;
  lines: CheckinLine[];
  permissions: { canEdit: boolean; canSubmit: boolean; canComplete: boolean };
}

export type Group360 = 'MANAGER' | 'PEER' | 'TEAM' | 'OTHER_DEPT';

export interface Feedback360State {
  closed: boolean;
  released: boolean;
  closedOn?: string;
  releasedOn?: string;
}

export interface RaterRow {
  employeeId: string;
  name: string;
  designation?: string;
  department?: string;
  group: Group360;
}

export interface Question360 {
  _id: string;
  competencyId: string;
  competencyName?: string;
  appliesTo?: 'ALL' | 'MANAGERS';
  text: string;
  order: number;
}

export interface Nomination360View {
  feedback360: Feedback360State;
  nominationDue?: string;
  feedbackDue?: string;
  manager: RaterRow | null;
  nomination: { status: 'DRAFT' | 'SUBMITTED' | 'APPROVED'; raters: RaterRow[]; trail: TrailEntry[] };
  permissions: { canEdit: boolean; canSubmit: boolean; canApprove: boolean; canSendBack: boolean; canSeeReport: boolean };
  progress: {
    total: { assigned: number; submitted: number };
    groups: Record<Group360, { assigned: number; submitted: number }> | null;
  };
  minPerGroup: number;
}

export interface Report360 {
  feedback360: Feedback360State;
  score360: number | null;
  groups: { group: Group360; label: string; weight: number; counted: boolean; responses: number | null; average: number | null }[];
  competencies: { competencyId: string; name: string; score: number | null; byGroup: Partial<Record<Group360, number>> }[];
  comments: string[];
  minPerGroup: number;
}

export interface Assignment360 {
  _id: string;
  rateeId: string;
  rateeName: string;
  rateeDesignation?: string;
  rateeDepartment?: string;
  group: Group360;
  status: 'PENDING' | 'SUBMITTED';
}

// ------------------------------------------------------------ phase 3

export type AppraisalStatus = 'SELF' | 'MANAGER' | 'REVIEWER' | 'CALIBRATION' | 'FINAL' | 'PUBLISHED' | 'APPEAL' | 'CLOSED';

export interface AppraisalScores {
  kpiScoreSystem: number | null;
  kpiScore: number | null;
  competencyScore: number | null;
  score360: number | null;
  weights: { templateName: string | null; kpi: number; competency: number; feedback360: number };
  finalScore: number | null;
  computedRating?: number | null;
  proposedRating?: number | null;
  calibratedRating?: number | null;
  finalRating: number | null;
}

export interface Appraisal {
  _id: string;
  employeeId: string;
  employeeName: string;
  designation?: string;
  department?: string;
  managerName: string;
  reviewerName: string;
  status: AppraisalStatus;
  competencies: { _id: string; name: string; appliesTo: 'ALL' | 'MANAGERS' }[];
  self: { competencyRatings?: Record<string, number>; comments?: string };
  manager?: { competencyRatings?: Record<string, number>; kpiOverride?: number | null; kpiOverrideReason?: string; comments?: string };
  reviewer?: { adjustedRating?: number | null; reason?: string };
  calibration?: { rating?: number; reason?: string; by?: string; on?: string };
  appeal?: { reason?: string; raisedOn?: string; resolvedRating?: number | null; resolution?: string; resolvedBy?: string; resolvedOn?: string };
  scores?: AppraisalScores;
  trail: TrailEntry[];
  publishedOn?: string;
  acceptance?: { auto: boolean; on: string };
  autoAcceptDays: number;
  permissions: {
    canEditSelf: boolean;
    canEditManager: boolean;
    canReview: boolean;
    canSendBack: boolean;
    canCalibrate: boolean;
    canAccept: boolean;
    canResolveAppeal: boolean;
  };
}

export interface CalibrationRow extends AppraisalScores {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  department?: string;
  grade: string | null;
  managerName: string;
  status: AppraisalStatus;
  calibration: { rating?: number; reason?: string };
  appeal: { reason?: string };
  payrollSentOn?: string;
}

export interface IncrementRow {
  rating: number;
  incrementPct: number;
  bonusMultiplier: number;
}

export interface PayrollRow {
  appraisalId: string;
  employeeId: string;
  employeeCode?: string;
  employeeName: string;
  department?: string;
  rating: number;
  incrementPct: number;
  bonusMultiplier: number;
  currentAnnualSalary: number | null;
  newAnnualSalary: number | null;
  payrollSentOn?: string;
}

export type PipProgress = 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK';

export interface Pip {
  _id: string;
  employeeId: string;
  employeeName: string;
  managerName: string;
  status: 'ACTIVE' | 'CLOSED';
  startDate: string;
  endDate: string;
  objectives: string[];
  reviews: { day: number; date: string; notes: string; progress: PipProgress | null }[];
  outcome: { result: string; notes: string; by: string; on: string } | null;
  extensions?: { on: string; notes: string; by: string }[];
  permissions: { canEdit: boolean; canClose: boolean };
}

// ------------------------------------------------------------ phase 4

export interface BulkRowResult {
  rowNumber: number;
  employeeCode: string;
  kpi: string;
  ok: boolean;
  message: string;
  old?: number | null;
  new?: number | null;
}

export interface BulkGoalsResult {
  commit: boolean;
  rows: BulkRowResult[];
  employees: { employeeCode: string; employeeName: string; lines: number; weightTotal: number; ok: boolean; issues: string[] }[];
  imported: number;
}

export interface BulkActualsResult {
  commit: boolean;
  rows: BulkRowResult[];
  applied: number;
}

export interface ReminderItem {
  key: string;
  label: string;
  due: string;
  kind: 'REMIND_3' | 'REMIND_1' | 'ESCALATE';
  title: string;
  message: string;
  recipients: { userId: string; email?: string; name: string }[];
  alreadySent: boolean;
}

export interface PmsReportRow {
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  department: string;
  grade: string | null;
  managerName: string;
}

export interface PmsReports {
  cycle: { _id: string; name: string };
  scope: 'all' | 'team';
  headcount: number;
  status: {
    goals: Record<string, number>;
    nominations: Record<string, number>;
    appraisal: Record<string, number>;
    checkins: Record<string, Record<string, number>>;
    feedback: { assigned: number; given: number };
  };
  departments: { department: string; employees: number; goalsLocked: number; appraisalsDone: number; ratings: Record<string, number> }[];
  ratingSpread: Record<string, { count: number; pct: number }>;
  finalRatings: (PmsReportRow & {
    status: AppraisalStatus;
    kpiScore: number | null;
    competencyScore: number | null;
    score360: number | null;
    finalScore: number | null;
    finalRating: number | null;
    publishedOn?: string;
  })[];
  report360: (PmsReportRow & { score360: number | null; responses: number; groupsShown: number; competencies: Record<string, number | null> })[];
  feedback360Closed: boolean;
  trainingNeeds: (PmsReportRow & { competency: string; score: number; source: string })[];
}

export interface PersonRow {
  employeeId: string;
  name: string;
  designation?: string;
  department?: string;
}

export interface FeedbackNote {
  _id: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  fromName: string;
  toName: string;
  kind: 'PRAISE' | 'SUGGESTION';
  text: string;
  createdOn: string;
}

export interface Overview360Row {
  employeeId: string;
  employeeName: string;
  department?: string;
  nominationStatus: 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'APPROVED';
  nominated: number;
  assigned: number;
  submitted: number;
}
