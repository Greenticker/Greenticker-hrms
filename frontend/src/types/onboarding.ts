export type OnboardingStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'VERIFIED' | 'NEEDS_CORRECTION';
export type DocumentVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface OnboardingDocumentItem {
  id: string;
  category: string;
  documentName: string;
  fileName: string;
  fileSize: string;
  fileType: string;
  uploadedAt: string;
  status: DocumentVerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  remarks?: string;
  previewUrl?: string;
}

export interface PolicyConsentRecord {
  policyId: string;
  policyTitle: string;
  version: string;
  acknowledgedAt: string;
  ipAddress: string;
  deviceInfo: string;
  acknowledged: boolean;
}

export interface OnboardingSubmission {
  _id: string;
  userId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  designation: string;
  workEmail: string;
  personalEmail: string;
  phone: string;
  currentStep: number;
  totalSteps: number;
  status: OnboardingStatus;
  submittedAt?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  rejectionRemarks?: string;
  sectionsData: Record<string, Record<string, any>>;
  documents: OnboardingDocumentItem[];
  policyAcknowledgements: PolicyConsentRecord[];
  createdAt: string;
  updatedAt: string;
}