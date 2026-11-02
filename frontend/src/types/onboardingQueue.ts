export interface InviteInfo {
  email: string;
  name: string;
  department: string;
  subdepartment?: string;
  designation: string;
  token?: string;
  expiresAt?: string;
}

export type SectionReviewStatus = 'PENDING' | 'VERIFIED' | 'NEEDS_CORRECTION';

export interface SectionReview {
  status: SectionReviewStatus;
  remarks?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface OnboardingQueueItem {
  _id: string;
  userId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  subdepartment?: string;
  designation: string;
  workEmail: string;
  personalEmail: string;
  phone: string;
  currentStep: number;
  totalSteps: number;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'VERIFIED' | 'NEEDS_CORRECTION';
  submittedAt?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  rejectionRemarks?: string;
  sectionReviews?: Record<string, SectionReview>;
  sectionsData: {
    personal?: Record<string, any>;
    address?: Record<string, any>;
    emergency?: Record<string, any>;
    employment?: Record<string, any>;
    bank?: Record<string, any>;
    identityTax?: Record<string, any>;
    statutory?: Record<string, any>;
  };
  documents: Array<{
    id: string;
    category: string;
    documentName: string;
    fileName: string;
    fileSize: string;
    fileType: string;
    uploadedAt: string;
    status: 'PENDING' | 'VERIFIED' | 'REJECTED';
    remarks?: string;
  }>;
  policyAcknowledgements: Array<{
    policyId: string;
    policyTitle: string;
    version: string;
    acknowledgedAt: string;
    ipAddress: string;
    deviceInfo: string;
    acknowledged: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingQueueStats {
  total: number;
  submitted: number;
  inProgress: number;
  verified: number;
  needsCorrection: number;
}
