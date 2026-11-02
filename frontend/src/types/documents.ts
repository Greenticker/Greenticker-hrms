export type DocumentCategory =
  | 'IDENTITY'
  | 'EDUCATION'
  | 'EMPLOYMENT'
  | 'CERTIFICATION'
  | 'TAX'
  | 'LEGAL'
  | 'OTHER';

export interface DocumentItem {
  _id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  category: DocumentCategory;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: string;
  fileUrl?: string;
  expiryDate?: string;
  uploadedBy: string;
  uploadedAt: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verifiedBy?: string;
  verifiedAt?: string;
  rejectionReason?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
}
