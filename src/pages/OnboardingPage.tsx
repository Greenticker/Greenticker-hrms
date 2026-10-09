import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { request } from '../services/api';
import {
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  Lock,
  Upload,
  FileCheck,
  Plus,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  AddressForm,
  BankingDetails,
  CoreProfile,
  Dependent,
  DocKey,
  DocsState,
  EmergencyDetails,
  EmploymentInfo,
  IncomeTaxDetails,
  InsuranceNomineeDetails,
  PfEsiDetails,
  YesNo,
  emptyBanking,
  emptyCore,
  emptyDocs,
  emptyEmergency,
  emptyIncomeTax,
  emptyInsurance,
  emptyPfEsi,
} from '../types/onboardingForm';

interface OnboardingPageProps {
  onComplete: () => void;
}

type Errors = Record<string, string>;

const TOTAL_STEPS = 8;

const STEPS = [
  { num: 1, title: 'Core Profile' },
  { num: 2, title: 'Emergency' },
  { num: 3, title: 'Employment' },
  { num: 4, title: 'Banking' },
  { num: 5, title: 'PF / ESI' },
  { num: 6, title: 'Income Tax' },
  { num: 7, title: 'Insurance' },
  { num: 8, title: 'Documents' },
];

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  INTERN: 'Intern',
  FULL_TIME: 'Full-time',
  CONTRACT: 'Contract',
  PART_TIME: 'Part-time',
};

const EMERGENCY_RELATIONS = ['Spouse', 'Father', 'Mother', 'Brother', 'Sister', 'Son', 'Daughter', 'Friend', 'Other'];
const DEPENDENT_RELATIONS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother'];
const NOMINEE_RELATIONS = ['Spouse', 'Mother', 'Father', 'Brother', 'Sister', 'Son', 'Daughter', 'Other'];

interface DocConfig {
  key: DocKey;
  label: string;
  category: string;
  multiple?: boolean;
  minFiles?: number;
  optionalForFresher?: boolean;
  hint?: string;
}

const DOC_CONFIG: DocConfig[] = [
  { key: 'aadhaarFront', label: 'Aadhaar Card — Front', category: 'IDENTITY' },
  { key: 'aadhaarBack', label: 'Aadhaar Card — Back', category: 'IDENTITY' },
  { key: 'panCard', label: 'PAN Card', category: 'TAX' },
  { key: 'cancelledCheque', label: 'Cancelled Cheque or Passbook', category: 'BANKING', hint: 'First page of the passbook is also accepted.' },
  { key: 'payslips', label: 'Last 3 Payslips', category: 'EMPLOYMENT', multiple: true, minFiles: 3, optionalForFresher: true, hint: 'Select all 3 files together, or add them one by one.' },
  { key: 'experienceLetter', label: 'Relieving / Experience Letter (Previous Employer)', category: 'EMPLOYMENT', optionalForFresher: true },
  { key: 'education', label: 'Highest Educational Degree / Marksheet', category: 'EDUCATION' },
  { key: 'digitalSignature', label: 'Digital Signature', category: 'SIGNATURE', hint: 'A clear image of your signature on white paper (PNG/JPG).' },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// ---- Validation helpers -----------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const digitsOnly = (v: string) => v.replace(/\D/g, '');
const todayStr = () => new Date().toISOString().split('T')[0];
const isValidPhone = (v: string) => {
  const d = digitsOnly(v);
  return d.length >= 10 && d.length <= 15;
};

/** Start (April 1st) of the financial year that contains the given ISO date. */
const financialYearStart = (isoDate: string): string => {
  const [y, m] = isoDate.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
};

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const newId = () => `dep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ---- Small presentational components ---------------------------------------

const inputCls = (hasError?: boolean, extra = '') =>
  `w-full rounded-lg border px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-1 ${
    hasError ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-slate-900'
  } ${extra}`;

const Field: React.FC<{
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, required, optional, error, hint, className = '', children }) => (
  <div className={className} data-error={error ? 'true' : undefined}>
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      {required && <span className="text-rose-500"> *</span>}
      {optional && <span className="text-slate-400 font-normal"> (Optional)</span>}
    </label>
    <div className="mt-1">{children}</div>
    {hint && !error && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    {error && <p className="mt-1 text-[11px] text-rose-600 font-medium">{error}</p>}
  </div>
);

const SectionHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div className="border-b border-slate-100 pb-3">
    <h3 className="text-base font-bold text-slate-900">{title}</h3>
    <p className="text-xs text-slate-500">{subtitle}</p>
  </div>
);

const PartHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">{children}</h4>
);

const YesNoRadio: React.FC<{
  name: string;
  value: YesNo;
  onChange: (v: YesNo) => void;
}> = ({ name, value, onChange }) => (
  <div className="flex items-center gap-3">
    {(['YES', 'NO'] as const).map((opt) => (
      <label
        key={opt}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
          value === opt
            ? 'border-slate-900 bg-slate-900 text-white'
            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
        }`}
      >
        <input
          type="radio"
          name={name}
          value={opt}
          checked={value === opt}
          onChange={() => onChange(opt)}
          className="sr-only"
        />
        {opt === 'YES' ? 'Yes' : 'No'}
      </label>
    ))}
  </div>
);

const AddressFields: React.FC<{
  prefix: string;
  value: AddressForm;
  errors: Errors;
  onChange: (field: keyof AddressForm, value: string) => void;
}> = ({ prefix, value, errors, onChange }) => (
  <div className="space-y-3">
    <Field label="Street Address" required error={errors[`${prefix}.line`]}>
      <input
        type="text"
        value={value.line}
        onChange={(e) => onChange('line', e.target.value)}
        className={inputCls(!!errors[`${prefix}.line`])}
        placeholder="House / Flat No., Street, Area"
      />
    </Field>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Field label="City" required error={errors[`${prefix}.city`]}>
        <input
          type="text"
          value={value.city}
          onChange={(e) => onChange('city', e.target.value)}
          className={inputCls(!!errors[`${prefix}.city`])}
        />
      </Field>
      <Field label="State" required error={errors[`${prefix}.state`]}>
        <input
          type="text"
          value={value.state}
          onChange={(e) => onChange('state', e.target.value)}
          className={inputCls(!!errors[`${prefix}.state`])}
        />
      </Field>
      <Field label="Country" required error={errors[`${prefix}.country`]}>
        <input
          type="text"
          value={value.country}
          onChange={(e) => onChange('country', e.target.value)}
          className={inputCls(!!errors[`${prefix}.country`])}
        />
      </Field>
      <Field label="Postal Code" required error={errors[`${prefix}.postalCode`]}>
        <input
          type="text"
          value={value.postalCode}
          onChange={(e) => onChange('postalCode', e.target.value)}
          className={inputCls(!!errors[`${prefix}.postalCode`], 'font-mono')}
        />
      </Field>
    </div>
  </div>
);

const ReadOnlyItem: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
    <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1">
      <Lock className="w-3 h-3 text-slate-400" />
      {label}
    </span>
    <p className="text-sm font-bold text-slate-900 mt-0.5">{value || '—'}</p>
  </div>
);

// ---- Main component ---------------------------------------------------------

export const OnboardingPage: React.FC<OnboardingPageProps> = ({ onComplete }) => {
  const { user, updateOnboardingStatus } = useAuth();

  const [currentStep, setCurrentStep] = useState<number>(
    Math.min(TOTAL_STEPS, Math.max(1, user?.onboardingStep || 1))
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [correctionRemarks, setCorrectionRemarks] = useState<string | null>(null);

  const [core, setCore] = useState<CoreProfile>({
    ...emptyCore,
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
  });
  const [emergency, setEmergency] = useState<EmergencyDetails>(emptyEmergency);
  const [employment, setEmployment] = useState<EmploymentInfo | null>(null);
  const [banking, setBanking] = useState<BankingDetails>(emptyBanking);
  const [pfEsi, setPfEsi] = useState<PfEsiDetails>(emptyPfEsi);
  const [incomeTax, setIncomeTax] = useState<IncomeTaxDetails>(emptyIncomeTax);
  const [insurance, setInsurance] = useState<InsuranceNomineeDetails>(emptyInsurance);
  const [docs, setDocs] = useState<DocsState>(emptyDocs);
  const [isFresher, setIsFresher] = useState(false);

  // Load saved draft + HR-provided employment details
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await request<any>('/onboarding/me');
        if (cancelled) return;

        if (res.employment) setEmployment(res.employment);
        if (res.submissionStatus === 'NEEDS_CORRECTION' && res.rejectionRemarks) {
          setCorrectionRemarks(res.rejectionRemarks);
        }
        if (typeof res.currentStep === 'number') {
          setCurrentStep(Math.min(TOTAL_STEPS, Math.max(1, res.currentStep)));
        }

        const draft = res.draft || {};
        const emp = res.employee;

        if (draft.core) {
          setCore({
            ...emptyCore,
            ...draft.core,
            currentAddress: { ...emptyCore.currentAddress, ...(draft.core.currentAddress || {}) },
            permanentAddress: { ...emptyCore.permanentAddress, ...(draft.core.permanentAddress || {}) },
          });
        } else if (emp) {
          setCore((prev) => ({
            ...prev,
            firstName: emp.firstName || prev.firstName,
            lastName: emp.lastName || prev.lastName,
            personalEmail: emp.personalEmail || prev.personalEmail,
          }));
        }
        if (draft.emergencyDetails) setEmergency({ ...emptyEmergency, ...draft.emergencyDetails });
        if (draft.banking) {
          setBanking({
            ...emptyBanking,
            ...draft.banking,
            confirmAccountNumber: draft.banking.accountNumber || '',
          });
        }
        if (draft.pfEsi) setPfEsi({ ...emptyPfEsi, ...draft.pfEsi });
        if (draft.incomeTax) {
          setIncomeTax({
            ...emptyIncomeTax,
            ...draft.incomeTax,
            prevEmployerGrossSalary: String(draft.incomeTax.prevEmployerGrossSalary ?? ''),
            prevEmployerTds: String(draft.incomeTax.prevEmployerTds ?? ''),
          });
        }
        if (draft.insuranceNominee) {
          setInsurance({
            ...emptyInsurance,
            ...draft.insuranceNominee,
            nominee: { ...emptyInsurance.nominee, ...(draft.insuranceNominee.nominee || {}) },
          });
        }
      } catch (err) {
        console.warn('Could not load onboarding draft:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Scroll to top whenever the step changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  // ---- Derived values -------------------------------------------------------

  const showMidYear =
    !!employment?.joiningDate &&
    employment.joiningDate > financialYearStart(employment.joiningDate);

  // ---- State updaters -------------------------------------------------------

  const clearError = (key: string) =>
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const updateCore = <K extends keyof CoreProfile>(field: K, value: CoreProfile[K]) => {
    setCore((prev) => ({ ...prev, [field]: value }));
    clearError(field as string);
  };

  const updateAddress = (group: 'currentAddress' | 'permanentAddress', field: keyof AddressForm, value: string) => {
    setCore((prev) => ({ ...prev, [group]: { ...prev[group], [field]: value } }));
    clearError(`${group === 'currentAddress' ? 'current' : 'permanent'}.${field}`);
  };

  const updateEmergency = (field: keyof EmergencyDetails, value: string) => {
    setEmergency((prev) => ({ ...prev, [field]: value }));
    clearError(`emergency.${field}`);
  };

  const updateBanking = (field: keyof BankingDetails, value: string) => {
    setBanking((prev) => ({ ...prev, [field]: value }));
    clearError(`banking.${field}`);
  };

  const updatePfEsi = <K extends keyof PfEsiDetails>(field: K, value: PfEsiDetails[K]) => {
    setPfEsi((prev) => ({ ...prev, [field]: value }));
    clearError(`pf.${field as string}`);
  };

  const updateTax = <K extends keyof IncomeTaxDetails>(field: K, value: IncomeTaxDetails[K]) => {
    setIncomeTax((prev) => ({ ...prev, [field]: value }));
    clearError(`tax.${field as string}`);
  };

  const setHealthOptIn = (value: YesNo) => {
    setInsurance((prev) => ({
      ...prev,
      optHealthInsurance: value,
      dependents:
        value === 'YES' && prev.dependents.length === 0
          ? [{ id: newId(), fullName: '', relationship: '', dob: '', gender: '' }]
          : prev.dependents,
    }));
    clearError('ins.optHealthInsurance');
  };

  const addDependent = () =>
    setInsurance((prev) => ({
      ...prev,
      dependents: [...prev.dependents, { id: newId(), fullName: '', relationship: '', dob: '', gender: '' }],
    }));

  const removeDependent = (id: string) =>
    setInsurance((prev) => ({ ...prev, dependents: prev.dependents.filter((d) => d.id !== id) }));

  const updateDependent = (id: string, field: keyof Dependent, value: string) => {
    setInsurance((prev) => ({
      ...prev,
      dependents: prev.dependents.map((d) => (d.id === id ? { ...d, [field]: value } : d)),
    }));
    clearError(`dep.${id}.${field}`);
  };

  const updateNominee = (field: 'fullName' | 'relationship' | 'dob', value: string) => {
    setInsurance((prev) => ({ ...prev, nominee: { ...prev.nominee, [field]: value } }));
    clearError(`nominee.${field}`);
  };

  const toggleSameAddress = (checked: boolean) => {
    setCore((prev) => ({
      ...prev,
      sameAsCurrent: checked,
      permanentAddress: checked ? { ...prev.currentAddress } : prev.permanentAddress,
    }));
  };

  const handleFilesSelected = (cfg: DocConfig, fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const accepted: { fileName: string; fileSize: number; fileType: string }[] = [];
    let problem = '';

    Array.from(fileList).forEach((f) => {
      if (!ALLOWED_FILE_TYPES.includes(f.type)) {
        problem = `${f.name}: only PDF, JPG or PNG files are allowed.`;
      } else if (f.size > MAX_FILE_BYTES) {
        problem = `${f.name}: file is larger than 5 MB.`;
      } else {
        accepted.push({ fileName: f.name, fileSize: f.size, fileType: f.type });
      }
    });

    setDocs((prev) => ({
      ...prev,
      [cfg.key]: cfg.multiple ? [...prev[cfg.key], ...accepted].slice(0, 6) : accepted.slice(0, 1).length ? accepted.slice(0, 1) : prev[cfg.key],
    }));

    if (problem) {
      setErrors((prev) => ({ ...prev, [`doc.${cfg.key}`]: problem }));
    } else {
      clearError(`doc.${cfg.key}`);
    }
  };

  const removeDocFile = (key: DocKey, index: number) =>
    setDocs((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));

  // ---- Validation -----------------------------------------------------------

  const validateStep = (step: number): Errors => {
    const e: Errors = {};
    const need = (key: string, value: string | undefined, msg: string) => {
      if (!value || !value.trim()) e[key] = msg;
    };

    const validateAddress = (prefix: string, a: AddressForm) => {
      need(`${prefix}.line`, a.line, 'Street address is required');
      need(`${prefix}.city`, a.city, 'City is required');
      need(`${prefix}.state`, a.state, 'State is required');
      need(`${prefix}.country`, a.country, 'Country is required');
      need(`${prefix}.postalCode`, a.postalCode, 'Postal code is required');
    };

    switch (step) {
      case 1: {
        need('firstName', core.firstName, 'First name is required');
        need('lastName', core.lastName, 'Last name is required');
        if (!core.dob) e.dob = 'Date of birth is required';
        else if (core.dob > todayStr()) e.dob = 'Date of birth cannot be in the future';
        need('gender', core.gender, 'Please select a gender');

        if (!core.phone.trim()) e.phone = 'Phone number is required';
        else if (!isValidPhone(core.phone)) e.phone = 'Enter a valid phone number (10–15 digits)';

        if (core.alternatePhone.trim() && !isValidPhone(core.alternatePhone)) {
          e.alternatePhone = 'Enter a valid phone number (10–15 digits)';
        }

        if (!core.personalEmail.trim()) e.personalEmail = 'Personal email is required';
        else if (!EMAIL_RE.test(core.personalEmail.trim())) e.personalEmail = 'Enter a valid email address';

        validateAddress('current', core.currentAddress);
        if (!core.sameAsCurrent) validateAddress('permanent', core.permanentAddress);
        break;
      }
      case 2: {
        need('emergency.name', emergency.name, 'Contact name is required');
        if (!emergency.phone.trim()) e['emergency.phone'] = 'Phone number is required';
        else if (!isValidPhone(emergency.phone)) e['emergency.phone'] = 'Enter a valid phone number (10–15 digits)';
        need('emergency.relation', emergency.relation, 'Please select the relation');
        break;
      }
      case 4: {
        need('banking.accountHolder', banking.accountHolder, 'Account holder name is required');
        const acct = banking.accountNumber.trim();
        if (!acct) e['banking.accountNumber'] = 'Account number is required';
        else if (!/^\d{9,18}$/.test(acct)) e['banking.accountNumber'] = 'Account number must be 9–18 digits';
        if (!banking.confirmAccountNumber.trim()) e['banking.confirmAccountNumber'] = 'Please re-enter the account number';
        else if (banking.confirmAccountNumber.trim() !== acct) {
          e['banking.confirmAccountNumber'] = 'Account numbers do not match';
        }
        const ifsc = banking.ifsc.trim().toUpperCase();
        if (!ifsc) e['banking.ifsc'] = 'IFSC code is required';
        else if (!IFSC_RE.test(ifsc)) e['banking.ifsc'] = 'Invalid IFSC (format: ABCD0123456)';
        break;
      }
      case 5: {
        if (!pfEsi.hasUan) e['pf.hasUan'] = 'Please choose Yes or No';
        if (pfEsi.hasUan === 'YES') {
          if (!/^\d{12}$/.test(pfEsi.uan.trim())) e['pf.uan'] = 'UAN must be exactly 12 digits';
          need('pf.pfAccountNumber', pfEsi.pfAccountNumber, 'PF account number is required');
        }
        if (pfEsi.hasUan === 'NO') {
          need('pf.fatherOrSpouseName', pfEsi.fatherOrSpouseName, "Father's / Spouse's name is required");
        }
        if (!pfEsi.hasEsic) e['pf.hasEsic'] = 'Please choose Yes or No';
        if (pfEsi.hasEsic === 'YES') {
          if (!/^\d{17}$/.test(pfEsi.esicNumber.trim())) e['pf.esicNumber'] = 'ESIC number must be exactly 17 digits';
        }
        if (pfEsi.hasEsic === 'NO') {
          need('pf.esiDispensary', pfEsi.esiDispensary, 'Preferred dispensary locality / code is required');
        }
        break;
      }
      case 6: {
        if (!/^\d{12}$/.test(incomeTax.aadhaarNumber.trim())) e['tax.aadhaarNumber'] = 'Aadhaar number must be exactly 12 digits';
        const pan = incomeTax.panNumber.trim().toUpperCase();
        if (!pan) e['tax.panNumber'] = 'PAN is required';
        else if (!PAN_RE.test(pan)) e['tax.panNumber'] = 'Invalid PAN (format: ABCDE1234F)';
        if (!incomeTax.taxRegime) e['tax.taxRegime'] = 'Please choose a tax regime';
        if (showMidYear) {
          const checkAmount = (key: 'prevEmployerGrossSalary' | 'prevEmployerTds', label: string) => {
            const raw = incomeTax[key].trim();
            if (raw === '') e[`tax.${key}`] = `${label} is required (enter 0 if none)`;
            else if (isNaN(Number(raw)) || Number(raw) < 0) e[`tax.${key}`] = 'Enter a valid amount';
          };
          checkAmount('prevEmployerGrossSalary', 'Gross salary earned');
          checkAmount('prevEmployerTds', 'TDS deducted');
        }
        break;
      }
      case 7: {
        if (!insurance.optHealthInsurance) e['ins.optHealthInsurance'] = 'Please choose Yes or No';
        if (insurance.optHealthInsurance === 'YES') {
          if (insurance.dependents.length === 0) {
            e['ins.dependents'] = 'Add at least one dependent, or choose "No" above';
          }
          insurance.dependents.forEach((d) => {
            need(`dep.${d.id}.fullName`, d.fullName, 'Full name is required');
            need(`dep.${d.id}.relationship`, d.relationship, 'Select a relationship');
            if (!d.dob) e[`dep.${d.id}.dob`] = 'Date of birth is required';
            else if (d.dob > todayStr()) e[`dep.${d.id}.dob`] = 'Date cannot be in the future';
            need(`dep.${d.id}.gender`, d.gender, 'Select a gender');
          });
        }
        need('nominee.fullName', insurance.nominee.fullName, 'Nominee name is required');
        need('nominee.relationship', insurance.nominee.relationship, 'Select a relationship');
        if (!insurance.nominee.dob) e['nominee.dob'] = 'Nominee date of birth is required';
        else if (insurance.nominee.dob > todayStr()) e['nominee.dob'] = 'Date cannot be in the future';
        break;
      }
      case 8: {
        DOC_CONFIG.forEach((cfg) => {
          if (cfg.optionalForFresher && isFresher) return;
          const required = cfg.minFiles ?? 1;
          if (docs[cfg.key].length < required) {
            e[`doc.${cfg.key}`] =
              required > 1 ? `Please upload at least ${required} files` : 'This document is required';
          }
        });
        break;
      }
      default:
        break;
    }
    return e;
  };

  // ---- Submit ---------------------------------------------------------------

  const buildStepPayload = (step: number): Record<string, unknown> | undefined => {
    switch (step) {
      case 1:
        return {
          firstName: core.firstName.trim(),
          middleName: core.middleName.trim(),
          lastName: core.lastName.trim(),
          dob: core.dob,
          gender: core.gender,
          phone: core.phone.trim(),
          alternatePhone: core.alternatePhone.trim(),
          personalEmail: core.personalEmail.trim(),
          currentAddress: core.currentAddress,
          permanentAddress: core.sameAsCurrent ? { ...core.currentAddress } : core.permanentAddress,
          sameAsCurrent: core.sameAsCurrent,
        };
      case 2:
        return { ...emergency, name: emergency.name.trim(), phone: emergency.phone.trim() };
      case 4:
        return {
          accountHolder: banking.accountHolder.trim(),
          accountNumber: banking.accountNumber.trim(),
          ifsc: banking.ifsc.trim().toUpperCase(),
        };
      case 5:
        return {
          hasUan: pfEsi.hasUan,
          ...(pfEsi.hasUan === 'YES'
            ? { uan: pfEsi.uan.trim(), pfAccountNumber: pfEsi.pfAccountNumber.trim() }
            : { fatherOrSpouseName: pfEsi.fatherOrSpouseName.trim() }),
          hasEsic: pfEsi.hasEsic,
          ...(pfEsi.hasEsic === 'YES'
            ? { esicNumber: pfEsi.esicNumber.trim() }
            : { esiDispensary: pfEsi.esiDispensary.trim() }),
        };
      case 6:
        return {
          aadhaarNumber: incomeTax.aadhaarNumber.trim(),
          panNumber: incomeTax.panNumber.trim().toUpperCase(),
          taxRegime: incomeTax.taxRegime,
          ...(showMidYear
            ? {
                prevEmployerGrossSalary: Number(incomeTax.prevEmployerGrossSalary),
                prevEmployerTds: Number(incomeTax.prevEmployerTds),
              }
            : {}),
        };
      case 7:
        return {
          optHealthInsurance: insurance.optHealthInsurance,
          dependents: insurance.optHealthInsurance === 'YES' ? insurance.dependents : [],
          nominee: insurance.nominee,
        };
      default:
        return undefined; // Step 3 is read-only, nothing to save
    }
  };

  const buildDocumentsPayload = () =>
    DOC_CONFIG.flatMap((cfg) =>
      docs[cfg.key].map((f) => ({
        key: cfg.key,
        documentName: cfg.label,
        category: cfg.category,
        fileName: f.fileName,
        fileSize: formatBytes(f.fileSize),
        fileType: f.fileType,
      }))
    );

  const handleNextStep = async () => {
    setServerError(null);
    const found = validateStep(currentStep);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setTimeout(() => {
        document.querySelector('[data-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
      return;
    }

    setIsSubmitting(true);
    try {
      if (currentStep < TOTAL_STEPS) {
        await request('/onboarding/step', {
          method: 'POST',
          body: JSON.stringify({ step: currentStep, data: buildStepPayload(currentStep) }),
        });
        const next = currentStep + 1;
        setCurrentStep(next);
        updateOnboardingStatus(false, next);
      } else {
        await request('/onboarding/complete', {
          method: 'POST',
          body: JSON.stringify({ data: { documents: buildDocumentsPayload(), isFresher } }),
        });
        updateOnboardingStatus(true, TOTAL_STEPS);
        onComplete();
      }
    } catch (err) {
      console.error('Failed to save onboarding step:', err);
      setServerError(err instanceof Error ? err.message : 'Something went wrong while saving. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrevious = () => {
    setErrors({});
    setServerError(null);
    setCurrentStep((s) => Math.max(1, s - 1));
  };

  // ---- Render ---------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans">
        <p className="text-xs text-slate-500">Loading your onboarding profile…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded tracking-wide uppercase">
                  Employee Onboarding
                </span>
                {employment?.employeeCode && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="text-xs text-slate-500">Employee ID: {employment.employeeCode}</span>
                  </>
                )}
              </div>
              <h1 className="text-xl font-bold text-slate-900 mt-2">
                Welcome to Anusyuti HRMS, {user?.firstName}!
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Please complete your onboarding profile. This ensures your payroll, statutory benefits, and insurance are set up correctly.
              </p>
            </div>
            <div className="text-right sm:border-l sm:border-slate-100 sm:pl-6">
              <span className="text-2xl font-black text-indigo-600 font-mono">
                {currentStep}/{TOTAL_STEPS}
              </span>
              <p className="text-[11px] text-slate-400 font-medium">Step Progress</p>
            </div>
          </div>

          {/* Stepper Bar */}
          <div className="mt-8 grid grid-cols-4 sm:grid-cols-8 gap-1.5 border-t border-slate-100 pt-6">
            {STEPS.map((s) => {
              const isDone = s.num < currentStep;
              const isCurrent = s.num === currentStep;
              return (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => s.num < currentStep && setCurrentStep(s.num)}
                  disabled={s.num > currentStep}
                  className={`p-2 rounded-lg text-left transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-slate-900 text-white shadow-xs'
                      : isDone
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-slate-50 text-slate-400 border border-slate-200 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold font-mono">0{s.num}</span>
                    {isDone && <CheckCircle className="w-3 h-3 text-emerald-600" />}
                  </div>
                  <p className="text-[11px] font-semibold truncate mt-1">{s.title}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Banners */}
        {correctionRemarks && (
          <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-900">
              <p className="font-bold">HR requested corrections</p>
              <p className="mt-0.5">{correctionRemarks}</p>
            </div>
          </div>
        )}
        {serverError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start justify-between gap-3">
            <p className="text-xs text-rose-800 font-medium">{serverError}</p>
            <button type="button" onClick={() => setServerError(null)} className="text-rose-500 hover:text-rose-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step Content Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs">
          {/* ============ SECTION 1: CORE PROFILE ============ */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <SectionHeader
                title="Section 1 — Core Profile"
                subtitle="Your personal details and contact information."
              />

              <div className="space-y-4">
                <PartHeading>Part A: Personal Details</PartHeading>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="First Name" required error={errors.firstName}>
                    <input
                      type="text"
                      value={core.firstName}
                      onChange={(e) => updateCore('firstName', e.target.value)}
                      className={inputCls(!!errors.firstName)}
                    />
                  </Field>
                  <Field label="Middle Name" optional error={errors.middleName}>
                    <input
                      type="text"
                      value={core.middleName}
                      onChange={(e) => updateCore('middleName', e.target.value)}
                      className={inputCls(false)}
                    />
                  </Field>
                  <Field label="Last Name" required error={errors.lastName}>
                    <input
                      type="text"
                      value={core.lastName}
                      onChange={(e) => updateCore('lastName', e.target.value)}
                      className={inputCls(!!errors.lastName)}
                    />
                  </Field>
                  <Field label="Date of Birth" required error={errors.dob}>
                    <input
                      type="date"
                      max={todayStr()}
                      value={core.dob}
                      onChange={(e) => updateCore('dob', e.target.value)}
                      className={inputCls(!!errors.dob, 'font-mono')}
                    />
                  </Field>
                  <Field label="Gender" required error={errors.gender}>
                    <select
                      value={core.gender}
                      onChange={(e) => updateCore('gender', e.target.value)}
                      className={inputCls(!!errors.gender)}
                    >
                      <option value="">Select gender</option>
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                      <option value="Other">Other</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-100">
                <PartHeading>Part B: Contact Information</PartHeading>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Phone Number" required error={errors.phone}>
                    <input
                      type="tel"
                      value={core.phone}
                      onChange={(e) => updateCore('phone', e.target.value)}
                      className={inputCls(!!errors.phone, 'font-mono')}
                      placeholder="+91 98765 43210"
                    />
                  </Field>
                  <Field label="Alternate Number" optional error={errors.alternatePhone}>
                    <input
                      type="tel"
                      value={core.alternatePhone}
                      onChange={(e) => updateCore('alternatePhone', e.target.value)}
                      className={inputCls(!!errors.alternatePhone, 'font-mono')}
                    />
                  </Field>
                  <Field label="Personal Email ID" required error={errors.personalEmail} className="sm:col-span-2">
                    <input
                      type="email"
                      value={core.personalEmail}
                      onChange={(e) => updateCore('personalEmail', e.target.value)}
                      className={inputCls(!!errors.personalEmail)}
                      placeholder="name@gmail.com"
                    />
                  </Field>
                </div>

                <div className="pt-2">
                  <h5 className="text-xs font-bold text-slate-700 mb-2">Current Address</h5>
                  <AddressFields
                    prefix="current"
                    value={core.currentAddress}
                    errors={errors}
                    onChange={(f, v) => {
                      updateAddress('currentAddress', f, v);
                      if (core.sameAsCurrent) updateAddress('permanentAddress', f, v);
                    }}
                  />
                </div>

                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="checkbox"
                      id="sameAddress"
                      checked={core.sameAsCurrent}
                      onChange={(e) => toggleSameAddress(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <label htmlFor="sameAddress" className="text-xs font-semibold text-slate-700 cursor-pointer">
                      Permanent address is the same as current address
                    </label>
                  </div>
                  <h5 className="text-xs font-bold text-slate-700 mb-2">Permanent Address</h5>
                  {core.sameAsCurrent ? (
                    <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      Your permanent address will be saved as the same as your current address.
                    </p>
                  ) : (
                    <AddressFields
                      prefix="permanent"
                      value={core.permanentAddress}
                      errors={errors}
                      onChange={(f, v) => updateAddress('permanentAddress', f, v)}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============ SECTION 2: EMERGENCY ============ */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <SectionHeader
                title="Section 2 — Emergency Details"
                subtitle="Someone we can contact in case of an urgent medical or workplace emergency."
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Name" required error={errors['emergency.name']}>
                  <input
                    type="text"
                    value={emergency.name}
                    onChange={(e) => updateEmergency('name', e.target.value)}
                    className={inputCls(!!errors['emergency.name'])}
                  />
                </Field>
                <Field label="Phone Number" required error={errors['emergency.phone']}>
                  <input
                    type="tel"
                    value={emergency.phone}
                    onChange={(e) => updateEmergency('phone', e.target.value)}
                    className={inputCls(!!errors['emergency.phone'], 'font-mono')}
                  />
                </Field>
                <Field label="Relation" required error={errors['emergency.relation']}>
                  <select
                    value={emergency.relation}
                    onChange={(e) => updateEmergency('relation', e.target.value)}
                    className={inputCls(!!errors['emergency.relation'])}
                  >
                    <option value="">Select relation</option>
                    {EMERGENCY_RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          )}

          {/* ============ SECTION 3: EMPLOYMENT (READ-ONLY) ============ */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <SectionHeader
                title="Section 3 — Employment Details"
                subtitle="These details are set by HR and cannot be edited. Contact HR if anything looks incorrect."
              />
              {!employment && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  HR has not added your employment details yet. You can continue, but please confirm with HR.
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ReadOnlyItem label="Employee ID" value={employment?.employeeCode} />
                <ReadOnlyItem label="Date of Joining" value={employment?.joiningDate} />
                <ReadOnlyItem
                  label="Employee Type"
                  value={
                    employment?.employmentType
                      ? EMPLOYMENT_TYPE_LABELS[employment.employmentType] || employment.employmentType
                      : undefined
                  }
                />
                <ReadOnlyItem label="Department" value={employment?.department} />
                <ReadOnlyItem label="Designation" value={employment?.designation} />
                <ReadOnlyItem label="Work Location" value={employment?.location} />
                <ReadOnlyItem label="Reporting Manager" value={employment?.reportingManagerName} />
              </div>
            </div>
          )}

          {/* ============ SECTION 4: BANKING ============ */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <SectionHeader
                title="Section 4 — Banking Details"
                subtitle="Bank account for salary disbursement and reimbursements."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Account Holder Name" required error={errors['banking.accountHolder']} className="sm:col-span-2">
                  <input
                    type="text"
                    value={banking.accountHolder}
                    onChange={(e) => updateBanking('accountHolder', e.target.value)}
                    className={inputCls(!!errors['banking.accountHolder'])}
                    placeholder="As per bank records"
                  />
                </Field>
                <Field label="Account Number" required error={errors['banking.accountNumber']}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={banking.accountNumber}
                    onChange={(e) => updateBanking('accountNumber', digitsOnly(e.target.value).slice(0, 18))}
                    className={inputCls(!!errors['banking.accountNumber'], 'font-mono')}
                  />
                </Field>
                <Field label="Confirm Account Number" required error={errors['banking.confirmAccountNumber']}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={banking.confirmAccountNumber}
                    onChange={(e) => updateBanking('confirmAccountNumber', digitsOnly(e.target.value).slice(0, 18))}
                    onPaste={(e) => e.preventDefault()}
                    className={inputCls(!!errors['banking.confirmAccountNumber'], 'font-mono')}
                    placeholder="Type it again (pasting is disabled)"
                  />
                </Field>
                <Field label="IFSC Code" required error={errors['banking.ifsc']}>
                  <input
                    type="text"
                    value={banking.ifsc}
                    onChange={(e) => updateBanking('ifsc', e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 11))}
                    className={inputCls(!!errors['banking.ifsc'], 'font-mono uppercase')}
                    placeholder="SBIN0001234"
                  />
                </Field>
              </div>
            </div>
          )}

          {/* ============ SECTION 5: PF / ESI ============ */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <SectionHeader
                title="Section 5 — PF / ESI"
                subtitle="Provident Fund and Employee State Insurance registration."
              />

              <div className="space-y-4">
                <PartHeading>Part A: PF</PartHeading>
                <Field label="Do you have an existing UAN?" required error={errors['pf.hasUan']}>
                  <YesNoRadio name="hasUan" value={pfEsi.hasUan} onChange={(v) => updatePfEsi('hasUan', v)} />
                </Field>
                {pfEsi.hasUan === 'YES' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="UAN Number" required error={errors['pf.uan']}>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={pfEsi.uan}
                        onChange={(e) => updatePfEsi('uan', digitsOnly(e.target.value).slice(0, 12))}
                        className={inputCls(!!errors['pf.uan'], 'font-mono')}
                        placeholder="12-digit UAN"
                      />
                    </Field>
                    <Field label="PF Account Number" required error={errors['pf.pfAccountNumber']}>
                      <input
                        type="text"
                        value={pfEsi.pfAccountNumber}
                        onChange={(e) => updatePfEsi('pfAccountNumber', e.target.value)}
                        className={inputCls(!!errors['pf.pfAccountNumber'], 'font-mono')}
                      />
                    </Field>
                  </div>
                )}
                {pfEsi.hasUan === 'NO' && (
                  <Field label="Father's / Spouse's Name" required error={errors['pf.fatherOrSpouseName']}>
                    <input
                      type="text"
                      value={pfEsi.fatherOrSpouseName}
                      onChange={(e) => updatePfEsi('fatherOrSpouseName', e.target.value)}
                      className={inputCls(!!errors['pf.fatherOrSpouseName'])}
                    />
                  </Field>
                )}
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-100">
                <PartHeading>Part B: ESI</PartHeading>
                <Field label="Do you have an existing ESIC Insurance Number?" required error={errors['pf.hasEsic']}>
                  <YesNoRadio name="hasEsic" value={pfEsi.hasEsic} onChange={(v) => updatePfEsi('hasEsic', v)} />
                </Field>
                {pfEsi.hasEsic === 'YES' && (
                  <Field label="ESIC Insurance No." required error={errors['pf.esicNumber']}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={pfEsi.esicNumber}
                      onChange={(e) => updatePfEsi('esicNumber', digitsOnly(e.target.value).slice(0, 17))}
                      className={inputCls(!!errors['pf.esicNumber'], 'font-mono')}
                      placeholder="17-digit ESIC number"
                    />
                  </Field>
                )}
                {pfEsi.hasEsic === 'NO' && (
                  <Field label="Preferred ESI Dispensary Locality / Code" required error={errors['pf.esiDispensary']}>
                    <input
                      type="text"
                      value={pfEsi.esiDispensary}
                      onChange={(e) => updatePfEsi('esiDispensary', e.target.value)}
                      className={inputCls(!!errors['pf.esiDispensary'])}
                    />
                  </Field>
                )}
              </div>
            </div>
          )}

          {/* ============ SECTION 6: INCOME TAX ============ */}
          {currentStep === 6 && (
            <div className="space-y-4">
              <SectionHeader
                title="Section 6 — Income Tax Declaration"
                subtitle="Identity numbers and tax regime used for TDS calculation."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Aadhaar Card Number" required error={errors['tax.aadhaarNumber']}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={incomeTax.aadhaarNumber}
                    onChange={(e) => updateTax('aadhaarNumber', digitsOnly(e.target.value).slice(0, 12))}
                    className={inputCls(!!errors['tax.aadhaarNumber'], 'font-mono')}
                    placeholder="12-digit Aadhaar"
                  />
                </Field>
                <Field label="PAN Card Number" required error={errors['tax.panNumber']}>
                  <input
                    type="text"
                    value={incomeTax.panNumber}
                    onChange={(e) => updateTax('panNumber', e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 10))}
                    className={inputCls(!!errors['tax.panNumber'], 'font-mono uppercase')}
                    placeholder="ABCDE1234F"
                  />
                </Field>
              </div>

              <Field label="Income Tax Regime Choice" required error={errors['tax.taxRegime']}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { value: 'NEW_REGIME' as const, title: 'New Tax Regime', desc: 'Section 115BAC — default, lower slab rates, fewer deductions.' },
                    { value: 'OLD_REGIME' as const, title: 'Old Tax Regime', desc: 'Higher slab rates, with Chapter VI-A deductions (80C, HRA, etc.).' },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        incomeTax.taxRegime === opt.value
                          ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                          : 'border-slate-300 hover:border-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="taxRegime"
                          value={opt.value}
                          checked={incomeTax.taxRegime === opt.value}
                          onChange={() => updateTax('taxRegime', opt.value)}
                          className="text-slate-900"
                        />
                        <span className="text-xs font-bold text-slate-900">{opt.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 ml-5">{opt.desc}</p>
                    </label>
                  ))}
                </div>
              </Field>

              {showMidYear && (
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <PartHeading>Mid-Year Joining Declarations</PartHeading>
                  <p className="text-[11px] text-slate-500">
                    Shown because your joining date ({employment?.joiningDate}) is after April 1st of the financial year.
                    Enter 0 if you had no earnings from a previous employer this year.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label="Previous Employer Gross Salary Earned"
                      required
                      error={errors['tax.prevEmployerGrossSalary']}
                      hint="Used to avoid double-counting the standard deduction."
                    >
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={incomeTax.prevEmployerGrossSalary}
                        onChange={(e) => updateTax('prevEmployerGrossSalary', e.target.value)}
                        className={inputCls(!!errors['tax.prevEmployerGrossSalary'], 'font-mono')}
                      />
                    </Field>
                    <Field
                      label="Previous Employer TDS Deducted"
                      required
                      error={errors['tax.prevEmployerTds']}
                      hint="Credited against your annual tax liability."
                    >
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={incomeTax.prevEmployerTds}
                        onChange={(e) => updateTax('prevEmployerTds', e.target.value)}
                        className={inputCls(!!errors['tax.prevEmployerTds'], 'font-mono')}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============ SECTION 7: INSURANCE & NOMINEE ============ */}
          {currentStep === 7 && (
            <div className="space-y-6">
              <SectionHeader
                title="Section 7 — Insurance and Nominee"
                subtitle="Group health cover for you and your dependents, and your nominee for life / accident insurance."
              />

              <div className="space-y-4">
                <PartHeading>Part A: Insurance</PartHeading>
                <Field
                  label="Do you wish to opt for the Corporate Group Health Insurance?"
                  required
                  error={errors['ins.optHealthInsurance']}
                >
                  <YesNoRadio name="optHealth" value={insurance.optHealthInsurance} onChange={setHealthOptIn} />
                </Field>

                {insurance.optHealthInsurance === 'YES' && (
                  <div className="space-y-3" data-error={errors['ins.dependents'] ? 'true' : undefined}>
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-bold text-slate-700">Add Dependents</h5>
                      <button
                        type="button"
                        onClick={addDependent}
                        className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add dependent
                      </button>
                    </div>
                    {errors['ins.dependents'] && (
                      <p className="text-[11px] text-rose-600 font-medium">{errors['ins.dependents']}</p>
                    )}

                    {insurance.dependents.map((d, idx) => (
                      <div key={d.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700">Dependent {idx + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeDependent(d.id)}
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                            aria-label={`Remove dependent ${idx + 1}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label="Dependent Full Name" required error={errors[`dep.${d.id}.fullName`]}>
                            <input
                              type="text"
                              value={d.fullName}
                              onChange={(e) => updateDependent(d.id, 'fullName', e.target.value)}
                              className={inputCls(!!errors[`dep.${d.id}.fullName`])}
                            />
                          </Field>
                          <Field label="Relationship" required error={errors[`dep.${d.id}.relationship`]}>
                            <select
                              value={d.relationship}
                              onChange={(e) => updateDependent(d.id, 'relationship', e.target.value)}
                              className={inputCls(!!errors[`dep.${d.id}.relationship`])}
                            >
                              <option value="">Select</option>
                              {DEPENDENT_RELATIONS.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Dependent DOB" required error={errors[`dep.${d.id}.dob`]}>
                            <input
                              type="date"
                              max={todayStr()}
                              value={d.dob}
                              onChange={(e) => updateDependent(d.id, 'dob', e.target.value)}
                              className={inputCls(!!errors[`dep.${d.id}.dob`], 'font-mono')}
                            />
                          </Field>
                          <Field label="Dependent Gender" required error={errors[`dep.${d.id}.gender`]}>
                            <select
                              value={d.gender}
                              onChange={(e) => updateDependent(d.id, 'gender', e.target.value)}
                              className={inputCls(!!errors[`dep.${d.id}.gender`])}
                            >
                              <option value="">Select</option>
                              <option value="Male">Male</option>
                              <option value="Female">Female</option>
                              <option value="Other">Other</option>
                            </select>
                          </Field>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-100">
                <PartHeading>Part B: Nominee Details</PartHeading>
                <p className="text-[11px] text-slate-500">For Group Term Life / Accident Insurance.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Nominee Full Name" required error={errors['nominee.fullName']}>
                    <input
                      type="text"
                      value={insurance.nominee.fullName}
                      onChange={(e) => updateNominee('fullName', e.target.value)}
                      className={inputCls(!!errors['nominee.fullName'])}
                    />
                  </Field>
                  <Field label="Nominee Relationship" required error={errors['nominee.relationship']}>
                    <select
                      value={insurance.nominee.relationship}
                      onChange={(e) => updateNominee('relationship', e.target.value)}
                      className={inputCls(!!errors['nominee.relationship'])}
                    >
                      <option value="">Select</option>
                      {NOMINEE_RELATIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Nominee Date of Birth" required error={errors['nominee.dob']}>
                    <input
                      type="date"
                      max={todayStr()}
                      value={insurance.nominee.dob}
                      onChange={(e) => updateNominee('dob', e.target.value)}
                      className={inputCls(!!errors['nominee.dob'], 'font-mono')}
                    />
                  </Field>
                </div>
              </div>
            </div>
          )}

          {/* ============ SECTION 8: DOCUMENTS ============ */}
          {currentStep === 8 && (
            <div className="space-y-4">
              <SectionHeader
                title="Section 8 — Documents Upload"
                subtitle="Upload clear copies. Accepted formats: PDF, JPG, PNG (max 5 MB per file)."
              />

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFresher}
                  onChange={(e) => setIsFresher(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 cursor-pointer"
                />
                I have no previous employment (payslips and relieving letter not applicable)
              </label>

              <div className="space-y-3">
                {DOC_CONFIG.map((cfg, i) => {
                  const files = docs[cfg.key];
                  const notApplicable = cfg.optionalForFresher && isFresher;
                  const errMsg = errors[`doc.${cfg.key}`];
                  return (
                    <div
                      key={cfg.key}
                      data-error={errMsg ? 'true' : undefined}
                      className={`p-4 rounded-xl border bg-slate-50 ${errMsg ? 'border-rose-300' : 'border-slate-200'} ${
                        notApplicable ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-slate-900">
                            {i + 1}. {cfg.label}
                            {notApplicable && <span className="ml-2 text-[10px] font-medium text-slate-400">Not applicable</span>}
                          </p>
                          {cfg.hint && <p className="text-[11px] text-slate-400 mt-0.5">{cfg.hint}</p>}
                        </div>
                        {!notApplicable && (
                          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-slate-500 text-xs font-semibold text-slate-700 cursor-pointer shrink-0">
                            <Upload className="w-3.5 h-3.5" />
                            {files.length > 0 && !cfg.multiple ? 'Replace' : cfg.multiple ? 'Add files' : 'Upload'}
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.jpg,.jpeg,.png"
                              multiple={cfg.multiple}
                              onChange={(e) => {
                                handleFilesSelected(cfg, e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </div>

                      {files.length > 0 && !notApplicable && (
                        <ul className="mt-3 space-y-1.5">
                          {files.map((f, idx) => (
                            <li
                              key={`${f.fileName}-${idx}`}
                              className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-1.5"
                            >
                              <span className="flex items-center gap-2 text-xs text-slate-800 min-w-0">
                                <FileCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span className="truncate">{f.fileName}</span>
                                <span className="text-[11px] text-slate-400 font-mono shrink-0">{formatBytes(f.fileSize)}</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => removeDocFile(cfg.key, idx)}
                                className="text-slate-400 hover:text-rose-600 cursor-pointer"
                                aria-label={`Remove ${f.fileName}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {errMsg && <p className="mt-2 text-[11px] text-rose-600 font-medium">{errMsg}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={handlePrevious}
                className="flex items-center gap-1 px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous Step
              </button>
            ) : (
              <div />
            )}

            <button
              type="button"
              onClick={handleNextStep}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
            >
              {isSubmitting ? (
                'Saving…'
              ) : currentStep === TOTAL_STEPS ? (
                <>
                  <span>Submit for HR Verification</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>Save & Continue to Step {currentStep + 1}</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};