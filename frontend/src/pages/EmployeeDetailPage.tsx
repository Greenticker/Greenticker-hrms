import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Employee, Department, Grade, Location } from '../types/employee';
import { apiErrorMessages } from '../utils/access';
import { employeeService } from '../services/employeeService';
import { documentService } from '../services/documentService';
import { lifecycleService } from '../services/lifecycleService';
import { attendanceService } from '../services/attendanceService';
import { DocumentItem } from '../types/documents';
import { LifecycleEvent } from '../types/lifecycle';
import { AttendanceRecord, Shift } from '../types/attendance';
import {
  ArrowLeft,
  User,
  Briefcase,
  Building,
  CreditCard,
  Clock,
  CalendarDays,
  Banknote,
  FileCheck,
  Edit3,
  Phone,
  Mail,
  MapPin,
  Shield,
  CheckCircle2,
  AlertCircle,
  X,
  Save,
  Check,
  TrendingUp,
  Upload,
  Download,
} from 'lucide-react';

interface EmployeeDetailPageProps {
  employeeId: string;
  onBack: () => void;
}

export const EmployeeDetailPage: React.FC<EmployeeDetailPageProps> = ({ employeeId, onBack }) => {
  const { user } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [empDocs, setEmpDocs] = useState<DocumentItem[]>([]);
  const [empLifecycle, setEmpLifecycle] = useState<LifecycleEvent[]>([]);
  const [empAttendance, setEmpAttendance] = useState<AttendanceRecord[]>([]);
  const [shiftOptions, setShiftOptions] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'personal' | 'employment' | 'bank_statutory' | 'documents'
  >('personal');

  // What the signed-in user may do with this record (decided by the server)
  const [access, setAccess] = useState<{
    level: string;
    canEdit: boolean;
    canEditMaster: boolean;
    canEditSalary: boolean;
    canRequestBankChange: boolean;
    canReviewBankChange: boolean;
  }>({ level: 'SELF', canEdit: false, canEditMaster: false, canEditSalary: false, canRequestBankChange: false, canReviewBankChange: false });

  // Bank change (maker-checker)
  const emptyBank = { bankName: '', accountHolder: '', accountNumber: '', confirmAccountNumber: '', ifsc: '', branch: '', reason: '' };
  const [bankForm, setBankForm] = useState<typeof emptyBank | null>(null);
  const [bankErrors, setBankErrors] = useState<string[]>([]);
  const [bankBusy, setBankBusy] = useState(false);
  const [bankMessage, setBankMessage] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [showReject, setShowReject] = useState(false);

  // Edit Modal State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editErrors, setEditErrors] = useState<string[]>([]);
  const [editFormData, setEditFormData] = useState<Partial<Employee> & { panNumber?: string; aadhaarNumber?: string }>({});

  // Masters for HR edits
  const [departmentOptions, setDepartmentOptions] = useState<Department[]>([]);
  const [gradeOptions, setGradeOptions] = useState<Grade[]>([]);
  const [locationOptions, setLocationOptions] = useState<Location[]>([]);
  const [managerOptions, setManagerOptions] = useState<Employee[]>([]);

  // Document upload (HR / admin roles)
  const [docForm, setDocForm] = useState<{ title: string; category: string; file: File | null }>({
    title: '',
    category: 'EMPLOYMENT',
    file: null,
  });
  const [docUploading, setDocUploading] = useState(false);
  const [docMessage, setDocMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetchEmployeeDetail();
  }, [employeeId]);

  const fetchEmployeeDetail = async () => {
    setLoading(true);
    try {
      attendanceService
        .getShifts()
        .then((r) => setShiftOptions(r.shifts.filter((s) => s.isActive !== false)))
        .catch(() => setShiftOptions([]));
      const [empRes, docsRes, lcRes, attRes] = await Promise.all([
        employeeService.getEmployeeById(employeeId),
        documentService.getDocuments({ employeeId }),
        lifecycleService.getEvents({ employeeId }),
        attendanceService.getAttendance({ employeeId }),
      ]);
      setEmployee(empRes.employee);
      setAccess({
        level: empRes.accessLevel,
        canEdit: !!empRes.canEdit,
        canEditMaster: !!empRes.canEditMaster,
        canEditSalary: !!empRes.canEditSalary,
        canRequestBankChange: !!empRes.canRequestBankChange,
        canReviewBankChange: !!empRes.canReviewBankChange,
      });
      setEmpDocs(docsRes.documents);
      setEmpLifecycle(lcRes.events);
      setEmpAttendance(attRes.records);
      if (empRes.canEditMaster) {
        Promise.all([
          employeeService.getDepartments().catch(() => ({ departments: [] as Department[] })),
          employeeService.getGrades().catch(() => ({ grades: [] as Grade[] })),
          employeeService.getLocations().catch(() => ({ locations: [] as Location[] })),
          employeeService.getEmployees().catch(() => ({ employees: [] as Employee[] })),
        ]).then(([d, g, l, e]) => {
          setDepartmentOptions(d.departments);
          setGradeOptions(g.grades);
          setLocationOptions(l.locations);
          setManagerOptions(e.employees.filter((x: Employee) => x._id !== empRes.employee._id));
        });
      }
    } catch (err: any) {
      console.error('Failed to load employee details', err);
    } finally {
      setLoading(false);
    }
  };

  const openEdit = () => {
    if (!employee) return;
    setEditErrors([]);
    setEditFormData({
      personalEmail: employee.personalEmail,
      phone: employee.phone,
      alternatePhone: employee.alternatePhone,
      currentAddress: employee.currentAddress,
      emergencyContact: employee.emergencyContact,
      department: employee.department,
      designation: employee.designation,
      grade: employee.grade || '',
      reportingManagerId: employee.reportingManagerId || '',
      shift: employee.shift,
      location: employee.location,
      extension: employee.extension || '',
      annualSalary: employee.annualSalary,
      panNumber: employee.statutory?.panNumber || '',
      aadhaarNumber: employee.statutory?.aadhaarNumber || '',
    });
    setIsEditOpen(true);
  };

  const submitBankChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee || !bankForm) return;
    if (bankForm.accountNumber.replace(/\s+/g, '') !== bankForm.confirmAccountNumber.replace(/\s+/g, '')) {
      setBankErrors(['The account numbers do not match.']);
      return;
    }
    setBankBusy(true);
    setBankErrors([]);
    try {
      const res = await employeeService.requestBankChange(employee._id, bankForm);
      setBankForm(null);
      setBankMessage(res.message);
      await fetchEmployeeDetail();
    } catch (err: any) {
      setBankErrors(apiErrorMessages(err));
    } finally {
      setBankBusy(false);
    }
  };

  const reviewBank = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!employee) return;
    setBankBusy(true);
    setBankErrors([]);
    try {
      await employeeService.reviewBankChange(employee._id, decision, rejectComment.trim() || undefined);
      setShowReject(false);
      setRejectComment('');
      setBankMessage(decision === 'APPROVED' ? 'Bank change verified. Payroll will use the new account.' : 'Bank change rejected.');
      await fetchEmployeeDetail();
    } catch (err: any) {
      setBankErrors(apiErrorMessages(err));
    } finally {
      setBankBusy(false);
    }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee || !docForm.file) return;
    const allowed = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'];
    const ext = (docForm.file.name.split('.').pop() || '').toLowerCase();
    if (!allowed.includes(ext)) {
      setDocMessage({ ok: false, text: 'Only PDF, JPG, PNG, DOC or DOCX files can be uploaded.' });
      return;
    }
    if (docForm.file.size > 4 * 1024 * 1024) {
      setDocMessage({ ok: false, text: 'The file is larger than the 4 MB limit.' });
      return;
    }
    setDocUploading(true);
    setDocMessage(null);
    try {
      await documentService.uploadDocument({
        employeeId: employee._id,
        category: docForm.category,
        title: docForm.title.trim() || docForm.file.name.replace(/\.[^/.]+$/, ''),
        file: docForm.file,
      });
      setDocForm({ title: '', category: docForm.category, file: null });
      setDocMessage({ ok: true, text: 'Document uploaded. It is visible to HR and to this employee only.' });
      const docsRes = await documentService.getDocuments({ employeeId });
      setEmpDocs(docsRes.documents);
    } catch (err: any) {
      setDocMessage({ ok: false, text: err.message || 'Upload failed.' });
    } finally {
      setDocUploading(false);
    }
  };

  const handleVerifyDoc = async (docId: string) => {
    try {
      await documentService.verifyDocument(docId);
      const docsRes = await documentService.getDocuments({ employeeId });
      setEmpDocs(docsRes.documents);
    } catch (err) {
      console.error('Failed to verify doc:', err);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setIsSaving(true);
    setEditErrors([]);
    // Send only the fields this user may change: the employee their own contact details,
    // HR / admins the employment and statutory fields as well.
    const selfKeys = ['personalEmail', 'phone', 'alternatePhone', 'currentAddress', 'emergencyContact'] as const;
    const masterKeys = [
      'department', 'designation', 'grade', 'reportingManagerId', 'shift', 'location', 'extension',
      'annualSalary', 'panNumber', 'aadhaarNumber',
    ] as const;
    const payload: Record<string, any> = {};
    for (const k of selfKeys) payload[k] = (editFormData as any)[k];
    if (access.canEditMaster) {
      for (const k of masterKeys) payload[k] = (editFormData as any)[k];
      // Unchanged masked / empty identifiers are not sent
      if (!payload.panNumber || payload.panNumber === employee.statutory?.panNumber) delete payload.panNumber;
      if (!payload.aadhaarNumber || payload.aadhaarNumber === employee.statutory?.aadhaarNumber) delete payload.aadhaarNumber;
      if (!access.canEditSalary) delete payload.annualSalary; // salary is changed by payroll roles only
    }
    try {
      await employeeService.updateEmployee(employee._id, payload);
      setIsEditOpen(false);
      await fetchEmployeeDetail();
    } catch (err: any) {
      setEditErrors(apiErrorMessages(err, 'Error updating employee record'));
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-xs text-slate-500">
        <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        Loading employee profile...
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm font-bold text-slate-800">Employee record not found</p>
        <button
          onClick={onBack}
          className="mt-3 text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
        >
          ← Return to Directory
        </button>
      </div>
    );
  }

  const isSelf = access.level === 'SELF';
  const canEdit = access.canEdit;
  const isMaster = access.canEditMaster;
  const sensitive = employee.sensitiveAccess || (isSelf ? 'FULL' : 'NONE');
  const notProvided = 'Not provided';
  const bank = employee.bankInfo;
  const st = employee.statutory;
  const shown = (full?: string, masked?: string) =>
    (sensitive === 'FULL' && full) || masked || full || notProvided;

  const tabs = [
    { id: 'personal', label: 'Personal Information', icon: User },
    { id: 'employment', label: 'Employment & Org', icon: Briefcase },
    // Managers looking at a reportee get no bank / statutory data at all
    ...(sensitive !== 'NONE' ? [{ id: 'bank_statutory', label: 'Bank & Statutory', icon: CreditCard }] : []),
    { id: 'documents', label: 'Documents & Lifecycle', icon: FileCheck },
  ];

  return (
    <div className="space-y-6">
      {/* Top Navigation & Profile Summary Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900 mb-4 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Directory</span>
        </button>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 text-white font-bold text-xl flex items-center justify-center shadow-sm shrink-0">
              {employee.firstName[0]}
              {employee.lastName[0]}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-slate-900">
                  {employee.firstName} {employee.lastName}
                </h1>
                <span className="font-mono text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                  {employee.employeeCode}
                </span>
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                  {employee.status}
                </span>
              </div>
              <p className="text-xs font-medium text-slate-600 mt-1">
                {employee.designation} · {employee.department}
              </p>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  {employee.workEmail}
                </span>
                <span className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  {employee.phone || 'Phone pending'}
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  {employee.location}
                </span>
              </div>
            </div>
          </div>

          {canEdit && (
            <button
              onClick={openEdit}
              className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer self-start md:self-auto"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isMaster ? 'Edit Employee Record' : 'Edit Personal Info'}</span>
            </button>
          )}
        </div>

        {/* Section Tabs Navigation (No single endless page!) */}
        <div className="mt-8 border-t border-slate-100 pt-4 flex flex-wrap gap-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 1: Personal Details */}
      {activeTab === 'personal' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
              Personal & Identification Profile
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Date of Birth</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">{employee.dob || notProvided}</p>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Gender</span>
                <p className="text-xs font-bold text-slate-900 mt-1">{employee.gender}</p>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Blood Group</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">{employee.bloodGroup}</p>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Personal Email</span>
                <p className="text-xs font-bold text-slate-900 mt-1">{employee.personalEmail}</p>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Primary Contact</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">{employee.phone}</p>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Alternate Contact</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">
                  {employee.alternatePhone || 'None Provided'}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
              Addresses & Domicile
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <span className="text-[10px] uppercase font-bold text-slate-400">Current Residential Address</span>
                <p className="text-xs font-medium text-slate-800 mt-1 leading-relaxed">
                  {employee.currentAddress?.line ? (
                    <>
                      {employee.currentAddress.line}<br />
                      {[employee.currentAddress.city, employee.currentAddress.state, employee.currentAddress.postalCode].filter(Boolean).join(', ')}<br />
                      {employee.currentAddress.country}
                    </>
                  ) : (
                    notProvided
                  )}
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <span className="text-[10px] uppercase font-bold text-slate-400">Permanent Legal Address</span>
                <p className="text-xs font-medium text-slate-800 mt-1 leading-relaxed">
                  {employee.permanentAddress?.line ? (
                    <>
                      {employee.permanentAddress.line}<br />
                      {[employee.permanentAddress.city, employee.permanentAddress.state, employee.permanentAddress.postalCode].filter(Boolean).join(', ')}<br />
                      {employee.permanentAddress.country}
                    </>
                  ) : (
                    notProvided
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
              Emergency Contact
            </h3>
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Contact Person</span>
                <p className="text-xs font-bold text-slate-900 mt-0.5">
                  {employee.emergencyContact?.name || notProvided}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Relationship</span>
                <p className="text-xs font-bold text-slate-900 mt-0.5">
                  {employee.emergencyContact?.relationship || notProvided}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Emergency Phone</span>
                <p className="text-xs font-bold text-slate-900 mt-0.5 font-mono">
                  {employee.emergencyContact?.phone || notProvided}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Employment & Organization */}
      {activeTab === 'employment' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Organizational Alignment & Position
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Department</span>
              <p className="text-xs font-bold text-slate-900 mt-1">{employee.department}</p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Designation</span>
              <p className="text-xs font-bold text-slate-900 mt-1">{employee.designation}</p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Reporting Line</span>
              <p className="text-xs font-bold text-slate-900 mt-1">
                {employee.reportingManagerName || 'Executive Committee (Direct)'}
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Joining Date</span>
              <p className="text-xs font-bold text-slate-900 mt-1 font-mono">{employee.joiningDate}</p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Employment Type</span>
              <p className="text-xs font-bold text-slate-900 mt-1">{employee.employmentType}</p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Current Status</span>
              <p className="text-xs font-bold text-emerald-700 mt-1">{employee.status}</p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Assigned Shift</span>
              <p className="text-xs font-bold text-slate-900 mt-1">{employee.shift}</p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Work Location</span>
              <p className="text-xs font-bold text-slate-900 mt-1">{employee.location}</p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Grade</span>
              <p className="text-xs font-bold text-slate-900 mt-1 font-mono">{employee.grade || 'Not assigned'}</p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Desk Extension</span>
              <p className="text-xs font-bold text-slate-900 mt-1 font-mono">{employee.extension || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Bank & Statutory */}
      {activeTab === 'bank_statutory' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Bank & Direct Deposit Information
              </h3>
              {sensitive === 'FULL' ? (
                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-mono font-bold">
                  {isSelf ? 'Your details' : 'Full access'}
                </span>
              ) : (
                <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded font-mono font-bold">
                  Masked · read-only
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Depository Institution</span>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {bank?.bankName || notProvided}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Account Holder Name</span>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {bank?.accountHolder || notProvided}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Account Number</span>
                <p className={`text-xs font-bold text-slate-900 mt-1 font-mono ${sensitive === 'FULL' ? 'select-all' : 'select-none'}`}>
                  {shown(bank?.accountNumber, bank?.accountNumberMasked)}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">IFSC / Routing Code</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">
                  {bank?.ifsc || notProvided}
                </p>
              </div>
            </div>
          </div>

          {/* Bank account change: requested by the employee (or HR), verified by another HR user */}
          <div className="space-y-3">
            {bankMessage && (
              <p role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold">
                {bankMessage}
              </p>
            )}
            {bankErrors.length > 0 && !bankForm && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {bankErrors.join(' ')}
              </div>
            )}
            {employee.pendingBankChange?.status === 'PENDING' ? (
              <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-xs space-y-2">
                <p className="font-bold text-amber-950">Bank change awaiting HR verification</p>
                <p className="text-amber-900">
                  New account: <b>{employee.pendingBankChange.bankName}</b> · {employee.pendingBankChange.accountHolder} ·{' '}
                  <span className="font-mono">
                    {employee.pendingBankChange.accountNumber || employee.pendingBankChange.accountNumberMasked}
                  </span>{' '}
                  · IFSC <span className="font-mono">{employee.pendingBankChange.ifsc}</span>
                </p>
                <p className="text-amber-800">
                  Requested by {employee.pendingBankChange.requestedByName} on{' '}
                  {new Date(employee.pendingBankChange.requestedAt).toLocaleString()}
                  {employee.pendingBankChange.reason ? ` · Reason: ${employee.pendingBankChange.reason}` : ''}
                </p>
                <p className="text-amber-800">Payroll keeps paying into the current account until this is verified.</p>
                {access.canReviewBankChange ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      onClick={() => reviewBank('APPROVED')}
                      disabled={bankBusy}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      Verify & apply
                    </button>
                    {showReject ? (
                      <>
                        <input
                          value={rejectComment}
                          onChange={(e) => setRejectComment(e.target.value)}
                          placeholder="Reason for rejection"
                          aria-label="Reason for rejection"
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                        />
                        <button
                          onClick={() => reviewBank('REJECTED')}
                          disabled={bankBusy || !rejectComment.trim()}
                          className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setShowReject(true)}
                        className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold cursor-pointer"
                      >
                        Reject...
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-700 italic">
                    Maker-checker: it must be verified by an HR user other than the employee and the requester.
                  </p>
                )}
              </div>
            ) : (
              access.canRequestBankChange && (
                <button
                  onClick={() => {
                    setBankErrors([]);
                    setBankMessage(null);
                    setBankForm({ ...emptyBank, accountHolder: `${employee.firstName} ${employee.lastName}` });
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Request bank account change
                </button>
              )
            )}
            {(employee.bankChangeHistory || []).length > 0 && (
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold">Bank change history ({employee.bankChangeHistory!.length})</summary>
                <ul className="mt-2 space-y-1">
                  {employee.bankChangeHistory!
                    .slice()
                    .reverse()
                    .map((h, i) => (
                      <li key={i}>
                        {h.status === 'APPROVED' ? 'Verified' : 'Rejected'}: {h.bankName} {h.accountNumberMasked} · requested by{' '}
                        {h.requestedByName}, {h.status === 'APPROVED' ? 'verified' : 'rejected'} by {h.reviewedByName}
                        {h.reviewComment ? ` ("${h.reviewComment}")` : ''}
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
              Statutory Identifiers (Aadhaar, PAN, UAN & ESI)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Aadhaar Card Number</span>
                <p className={`text-xs font-bold text-slate-900 mt-1 font-mono ${sensitive === 'FULL' ? 'select-all' : 'select-none'}`}>
                  {shown(st?.aadhaarNumber, st?.aadhaarMasked)}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Permanent Account Number (PAN)</span>
                <p className={`text-xs font-bold text-slate-900 mt-1 font-mono ${sensitive === 'FULL' ? 'select-all' : 'select-none'}`}>
                  {shown(st?.panNumber, st?.panMasked)}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Universal Account Number (UAN)</span>
                <p className={`text-xs font-bold text-slate-900 mt-1 font-mono ${sensitive === 'FULL' ? 'select-all' : 'select-none'}`}>
                  {shown(st?.uanNumber, st?.uanMasked)}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">ESI Insurance Number</span>
                <p className={`text-xs font-bold text-slate-900 mt-1 font-mono ${sensitive === 'FULL' ? 'select-all' : 'select-none'}`}>
                  {shown(st?.esiNumber, st?.esiMasked)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* Tab 7: Documents & Lifecycle */}
      {activeTab === 'documents' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Compliance Documents Repository
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Authentic copies of legal, academic, and employment credentials.
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-500">
              {empDocs.length} Total Records
            </span>
          </div>

          {isMaster && (
            <form onSubmit={handleUploadDoc} className="p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 space-y-3 text-xs">
              <div className="flex items-center gap-2 font-bold text-slate-800">
                <Upload className="w-4 h-4 text-indigo-600" />
                Upload a document for {employee.firstName}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={docForm.title}
                  onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                  placeholder="Title, e.g. Offer Letter"
                  aria-label="Document title"
                  className="rounded-lg border border-slate-300 px-3 py-2 bg-white"
                />
                <select
                  value={docForm.category}
                  onChange={(e) => setDocForm({ ...docForm, category: e.target.value })}
                  aria-label="Document category"
                  className="rounded-lg border border-slate-300 px-3 py-2 bg-white"
                >
                  <option value="EMPLOYMENT">Employment (offer / appointment letter)</option>
                  <option value="IDENTITY">Identity proof</option>
                  <option value="EDUCATION">Education</option>
                  <option value="FINANCIAL">Financial</option>
                  <option value="OTHER">Other</option>
                </select>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  aria-label="Document file"
                  onChange={(e) => {
                    setDocForm({ ...docForm, file: e.target.files?.[0] || null });
                    setDocMessage(null);
                  }}
                  className="text-xs file:mr-2 file:px-2.5 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:cursor-pointer"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500">PDF, JPG, PNG, DOC or DOCX · max 4 MB</span>
                <button
                  type="submit"
                  disabled={!docForm.file || docUploading}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {docUploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
              {docMessage && (
                <p role="status" className={docMessage.ok ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                  {docMessage.text}
                </p>
              )}
            </form>
          )}

          {empDocs.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500">
              No documents currently on file for this employee.
            </div>
          ) : (
            <div className="space-y-3">
              {empDocs.map((doc) => (
                <div
                  key={doc._id}
                  className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <FileCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900">{doc.title}</p>
                        <span className="text-[10px] font-mono text-slate-400 uppercase">
                          {doc.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {doc.fileName} · {doc.fileSize} · Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase border ${
                        doc.status === 'VERIFIED'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : doc.status === 'REJECTED'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {doc.status}
                    </span>

                    {isMaster && doc.status !== 'VERIFIED' && (
                      <button
                        onClick={() => handleVerifyDoc(doc._id)}
                        className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 shadow-xs"
                      >
                        <Check className="w-3 h-3 text-emerald-400" />
                        Verify
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-6">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-purple-600" />
              Career Lifecycle & Transitions
            </h4>

            {empLifecycle.length === 0 ? (
              <div className="border-l-2 border-slate-200 ml-3 pl-4 space-y-4 text-xs">
                <div>
                  <span className="font-mono text-[10px] text-slate-400">{employee.joiningDate}</span>
                  <p className="font-bold text-slate-900">Joined vetan.ai</p>
                  <p className="text-[11px] text-slate-500">Initial appointment as {employee.designation}</p>
                </div>
              </div>
            ) : (
              <div className="border-l-2 border-slate-200 ml-3 pl-4 space-y-4 text-xs">
                {empLifecycle.map((ev) => (
                  <div key={ev._id} className="relative">
                    <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-slate-900 border-2 border-white" />
                    <span className="font-mono text-[10px] text-slate-400">
                      {ev.effectiveDate} · {ev.eventType}
                    </span>
                    <p className="font-bold text-slate-900">
                      {ev.previousValue} → <span className="text-blue-700">{ev.newValue}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{ev.reason}</p>
                  </div>
                ))}
                <div>
                  <span className="font-mono text-[10px] text-slate-400">{employee.joiningDate}</span>
                  <p className="font-bold text-slate-900">Joined vetan.ai</p>
                  <p className="text-[11px] text-slate-500">Initial appointment as {employee.designation}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bank change request modal */}
      {bankForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">Request bank account change</h3>
              <button onClick={() => setBankForm(null)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitBankChange} className="p-6 space-y-3 text-xs">
              <p className="text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                HR verifies the new account before it is used. Until then salary keeps going to the current account.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['bankName', 'Bank name *', 'text'],
                    ['accountHolder', 'Account holder name *', 'text'],
                    ['accountNumber', 'Account number *', 'password'],
                    ['confirmAccountNumber', 'Re-enter account number *', 'text'],
                    ['ifsc', 'IFSC *', 'text'],
                    ['branch', 'Branch', 'text'],
                  ] as const
                ).map(([key, label, type]) => (
                  <div key={key}>
                    <label className="block font-semibold text-slate-700">{label}</label>
                    <input
                      type={type}
                      required={label.endsWith('*')}
                      autoComplete="off"
                      value={bankForm[key]}
                      onChange={(e) => setBankForm({ ...bankForm, [key]: key === 'ifsc' ? e.target.value.toUpperCase() : e.target.value })}
                      className={`mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 ${key.includes('ccount') || key === 'ifsc' ? 'font-mono' : ''}`}
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Reason</label>
                <input
                  value={bankForm.reason}
                  onChange={(e) => setBankForm({ ...bankForm, reason: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="e.g. Salary account moved to another bank"
                />
              </div>
              {bankErrors.length > 0 && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg">
                  <ul className="list-disc pl-4">
                    {bankErrors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setBankForm(null)} className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={bankBusy} className="px-5 py-2 font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer">
                  {bankBusy ? 'Submitting...' : 'Submit for verification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {isEditOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">
                {isMaster ? 'Edit Employee Information' : 'Update Personal Contact Details'}
              </h3>
              <button
                onClick={() => setIsEditOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {editErrors.length > 0 && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  <ul className="list-disc pl-4 space-y-0.5">
                    {editErrors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Personal Phone</label>
                  <input
                    type="tel"
                    value={editFormData.phone || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Alternate Phone</label>
                  <input
                    type="tel"
                    value={editFormData.alternatePhone || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, alternatePhone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Personal Email</label>
                <input
                  type="email"
                  value={editFormData.personalEmail || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, personalEmail: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Current Address</p>
                <input
                  type="text"
                  placeholder="House / street"
                  aria-label="Address line"
                  value={editFormData.currentAddress?.line || ''}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, currentAddress: { ...(editFormData.currentAddress || ({} as any)), line: e.target.value } })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['city', 'state', 'postalCode', 'country'] as const).map((k) => (
                    <input
                      key={k}
                      type="text"
                      placeholder={k === 'postalCode' ? 'PIN code' : k[0].toUpperCase() + k.slice(1)}
                      aria-label={k}
                      value={(editFormData.currentAddress as any)?.[k] || ''}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, currentAddress: { ...(editFormData.currentAddress || ({} as any)), [k]: e.target.value } })
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Emergency Contact</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['name', 'relationship', 'phone'] as const).map((k) => (
                    <input
                      key={k}
                      type={k === 'phone' ? 'tel' : 'text'}
                      placeholder={k[0].toUpperCase() + k.slice(1)}
                      aria-label={`Emergency contact ${k}`}
                      value={(editFormData.emergencyContact as any)?.[k] || ''}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, emergencyContact: { ...(editFormData.emergencyContact || ({} as any)), [k]: e.target.value } })
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  ))}
                </div>
              </div>

              {!isMaster && (
                <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  Date of joining, designation, grade, salary and PAN / Aadhaar can only be changed by HR.
                </p>
              )}

              {/* HR / admin only editable fields */}
              {isMaster && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Department</label>
                    <select
                      value={editFormData.department || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                    >
                      {!departmentOptions.some((d) => d.name === editFormData.department) && editFormData.department && (
                        <option value={editFormData.department}>{editFormData.department}</option>
                      )}
                      {departmentOptions.map((d) => (
                        <option key={d._id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Reporting Manager</label>
                    <select
                      value={editFormData.reportingManagerId || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, reportingManagerId: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                    >
                      <option value="">None (top of the organisation)</option>
                      {managerOptions.map((m) => (
                        <option key={m._id} value={m._id}>
                          {m.firstName} {m.lastName} ({m.employeeCode})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Grade</label>
                    <select
                      value={editFormData.grade || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, grade: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                    >
                      <option value="">Not assigned</option>
                      {gradeOptions.map((g) => (
                        <option key={g._id} value={g.code}>
                          {g.code} · {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Work Location</label>
                    <select
                      value={editFormData.location || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, location: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                    >
                      {!locationOptions.some((l) => l.name === editFormData.location) && editFormData.location && (
                        <option value={editFormData.location}>{editFormData.location}</option>
                      )}
                      {locationOptions.map((l) => (
                        <option key={l._id} value={l.name}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">PAN</label>
                    <input
                      type="text"
                      maxLength={10}
                      value={editFormData.panNumber || ''}
                      placeholder={employee.statutory?.panMasked || 'ABCDE1234F'}
                      onChange={(e) => setEditFormData({ ...editFormData, panNumber: e.target.value.toUpperCase() })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Aadhaar</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={14}
                      value={editFormData.aadhaarNumber || ''}
                      placeholder={employee.statutory?.aadhaarMasked || '12-digit number'}
                      onChange={(e) => setEditFormData({ ...editFormData, aadhaarNumber: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  <div hidden={!access.canEditSalary}>
                    <label className="block text-xs font-semibold text-slate-700">Annual CTC (₹)</label>
                    <input
                      type="number"
                      min="0"
                      value={editFormData.annualSalary ?? ''}
                      onChange={(e) => setEditFormData({ ...editFormData, annualSalary: e.target.value === '' ? undefined : Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Desk Extension</label>
                    <input
                      type="text"
                      value={editFormData.extension || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, extension: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Designation</label>
                    <input
                      type="text"
                      value={editFormData.designation || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, designation: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Work Shift</label>
                    <select
                      value={editFormData.shift || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, shift: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono bg-white"
                    >
                      {editFormData.shift &&
                        !shiftOptions.some((s) => `${s.name} (${s.startTime} - ${s.endTime})` === editFormData.shift) && (
                          <option value={editFormData.shift}>{editFormData.shift}</option>
                        )}
                      {shiftOptions.map((s) => {
                        const label = `${s.name} (${s.startTime} - ${s.endTime})`;
                        return (
                          <option key={s._id} value={label}>
                            {s.isNightShift ? '🌙 ' : ''}
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer shadow-xs"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};