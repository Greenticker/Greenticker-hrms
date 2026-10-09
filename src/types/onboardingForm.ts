// Types + empty defaults for the 8-section employee onboarding form.

export interface AddressForm {
  line: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export type YesNo = 'YES' | 'NO' | '';

// Section 1: Core Profile
export interface CoreProfile {
  // Part A: Personal details
  firstName: string;
  middleName: string; // optional
  lastName: string;
  dob: string;
  gender: string;
  // Part B: Contact information
  phone: string;
  alternatePhone: string; // optional
  personalEmail: string;
  currentAddress: AddressForm;
  permanentAddress: AddressForm;
  sameAsCurrent: boolean;
}

// Section 2: Emergency Details
export interface EmergencyDetails {
  name: string;
  phone: string;
  relation: string;
}

// Section 3: Employment Details (filled by HR, read-only for the employee)
export interface EmploymentInfo {
  employeeCode: string;
  joiningDate: string;
  employmentType: string;
  department: string;
  designation: string;
  location: string;
  reportingManagerName: string;
}

// Section 4: Banking Details
export interface BankingDetails {
  accountHolder: string;
  accountNumber: string;
  confirmAccountNumber: string; // UI only, never sent to the server
  ifsc: string;
}

// Section 5: PF / ESI
export interface PfEsiDetails {
  hasUan: YesNo;
  uan: string;
  pfAccountNumber: string;
  fatherOrSpouseName: string;
  hasEsic: YesNo;
  esicNumber: string;
  esiDispensary: string;
}

// Section 6: Income Tax Declaration
export interface IncomeTaxDetails {
  aadhaarNumber: string;
  panNumber: string;
  taxRegime: 'NEW_REGIME' | 'OLD_REGIME' | '';
  // Only collected when DOJ is after April 1st of the financial year
  prevEmployerGrossSalary: string;
  prevEmployerTds: string;
}

// Section 7: Insurance and Nominee
export interface Dependent {
  id: string;
  fullName: string;
  relationship: string;
  dob: string;
  gender: string;
}

export interface NomineeDetails {
  fullName: string;
  relationship: string;
  dob: string;
}

export interface InsuranceNomineeDetails {
  optHealthInsurance: YesNo;
  dependents: Dependent[];
  nominee: NomineeDetails;
}

// Section 8: Documents
export type DocKey =
  | 'aadhaarFront'
  | 'aadhaarBack'
  | 'panCard'
  | 'cancelledCheque'
  | 'payslips'
  | 'experienceLetter'
  | 'education'
  | 'digitalSignature';

export interface UploadedDocMeta {
  fileName: string;
  fileSize: number; // bytes
  fileType: string;
}

export type DocsState = Record<DocKey, UploadedDocMeta[]>;

export const emptyAddress: AddressForm = {
  line: '',
  city: '',
  state: '',
  country: 'India',
  postalCode: '',
};

export const emptyCore: CoreProfile = {
  firstName: '',
  middleName: '',
  lastName: '',
  dob: '',
  gender: '',
  phone: '',
  alternatePhone: '',
  personalEmail: '',
  currentAddress: { ...emptyAddress },
  permanentAddress: { ...emptyAddress },
  sameAsCurrent: false,
};

export const emptyEmergency: EmergencyDetails = { name: '', phone: '', relation: '' };

export const emptyBanking: BankingDetails = {
  accountHolder: '',
  accountNumber: '',
  confirmAccountNumber: '',
  ifsc: '',
};

export const emptyPfEsi: PfEsiDetails = {
  hasUan: '',
  uan: '',
  pfAccountNumber: '',
  fatherOrSpouseName: '',
  hasEsic: '',
  esicNumber: '',
  esiDispensary: '',
};

export const emptyIncomeTax: IncomeTaxDetails = {
  aadhaarNumber: '',
  panNumber: '',
  taxRegime: '',
  prevEmployerGrossSalary: '',
  prevEmployerTds: '',
};

export const emptyInsurance: InsuranceNomineeDetails = {
  optHealthInsurance: '',
  dependents: [],
  nominee: { fullName: '', relationship: '', dob: '' },
};

export const emptyDocs: DocsState = {
  aadhaarFront: [],
  aadhaarBack: [],
  panCard: [],
  cancelledCheque: [],
  payslips: [],
  experienceLetter: [],
  education: [],
  digitalSignature: [],
};
