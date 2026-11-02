export type LetterTemplateCategory =
  | 'OFFER'
  | 'PROMOTION'
  | 'EXPERIENCE'
  | 'INCREMENT'
  | 'ADDRESS_PROOF'
  | 'APPOINTMENT'
  | 'CONFIRMATION'
  | 'DEPARTMENT_TRANSFER'
  | 'LOCATION_TRANSFER'
  | 'PROBATION_EXTENSION'
  | 'REDESIGNATION'
  | 'RELIEVING'
  | 'TERMINATION'
  | 'OTHER';

/** An organisation's own, editable letter template. */
export interface LetterTemplate {
  _id: string;
  organizationId: string;
  title: string;
  category: LetterTemplateCategory;
  subject: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** A built-in, read-only template from the Template Gallery. */
export interface GalleryLetterTemplate {
  key: string;
  title: string;
  description: string;
  category: LetterTemplateCategory;
  subject: string;
  content: string;
}

export interface LetterPreview {
  success: boolean;
  title: string;
  content: string;
}
