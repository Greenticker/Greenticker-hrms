import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Employee } from '../types/employee';
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
    'personal' | 'employment' | 'bank_statutory' | 'attendance' | 'leave' | 'payroll' | 'documents'
  >('personal');

  // Edit Modal State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<Employee>>({});

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
      setEmpDocs(docsRes.documents);
      setEmpLifecycle(lcRes.events);
      setEmpAttendance(attRes.records);
      setEditFormData({
        personalEmail: empRes.employee.personalEmail,
        phone: empRes.employee.phone,
        alternatePhone: empRes.employee.alternatePhone,
        bio: empRes.employee.bio,
        currentAddress: empRes.employee.currentAddress,
        emergencyContact: empRes.employee.emergencyContact,
        department: empRes.employee.department,
        designation: empRes.employee.designation,
        shift: empRes.employee.shift,
        location: empRes.employee.location,
      });
    } catch (err: any) {
      console.error('Failed to load employee details', err);
    } finally {
      setLoading(false);
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
    try {
      await employeeService.updateEmployee(employee._id, editFormData);
      setIsEditOpen(false);
      await fetchEmployeeDetail();
    } catch (err: any) {
      alert(err.message || 'Error updating employee record');
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

  const isSelf = employee.userId === user?.id;
  const canEdit = user?.role === 'ADMIN' || isSelf;

  const tabs = [
    { id: 'personal', label: 'Personal Information', icon: User },
    { id: 'employment', label: 'Employment & Org', icon: Briefcase },
    { id: 'bank_statutory', label: 'Bank & Statutory', icon: CreditCard },
    { id: 'attendance', label: 'Attendance & Extra Pay', icon: Clock },
    { id: 'leave', label: 'Leave Balances', icon: CalendarDays },
    { id: 'payroll', label: 'Payroll & Compensation', icon: Banknote },
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
              onClick={() => setIsEditOpen(true)}
              className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer self-start md:self-auto"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isSelf && user?.role === 'EMPLOYEE' ? 'Edit Personal Info' : 'Edit Employee Record'}</span>
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
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">{employee.dob}</p>
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
                  {employee.currentAddress?.line || '205, Prestige Tech Park, Marathahalli-Sarjapur Outer Ring Road'}<br />
                  {employee.currentAddress?.city || 'Bengaluru'}, {employee.currentAddress?.state || 'Karnataka'}{' '}
                  {employee.currentAddress?.postalCode || '560103'}<br />
                  {employee.currentAddress?.country || 'India'}
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <span className="text-[10px] uppercase font-bold text-slate-400">Permanent Legal Address</span>
                <p className="text-xs font-medium text-slate-800 mt-1 leading-relaxed">
                  {employee.permanentAddress?.line || employee.currentAddress?.line || '205, Prestige Tech Park, Marathahalli-Sarjapur Outer Ring Road'}<br />
                  {employee.permanentAddress?.city || employee.currentAddress?.city || 'Bengaluru'},{' '}
                  {employee.permanentAddress?.state || employee.currentAddress?.state || 'Karnataka'}{' '}
                  {employee.permanentAddress?.postalCode || employee.currentAddress?.postalCode || '560103'}<br />
                  {employee.permanentAddress?.country || employee.currentAddress?.country || 'India'}
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
                  {employee.emergencyContact?.name || 'Vikram Verma'}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Relationship</span>
                <p className="text-xs font-bold text-slate-900 mt-0.5">
                  {employee.emergencyContact?.relationship || 'Spouse / Family'}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Emergency Phone</span>
                <p className="text-xs font-bold text-slate-900 mt-0.5 font-mono">
                  {employee.emergencyContact?.phone || '+91 98452 99999'}
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
              <span className="text-[10px] uppercase font-bold text-slate-400">Organization Code</span>
              <p className="text-xs font-bold text-slate-900 mt-1 font-mono">ZEN-HQ</p>
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
              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono font-semibold">
                Masked for Security
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Depository Institution</span>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {employee.bankInfo?.bankName || 'Silicon Valley National Bank'}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Account Holder Name</span>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {employee.bankInfo?.accountHolder || `${employee.firstName} ${employee.lastName}`}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Account Number</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">
                  {employee.bankInfo?.accountNumberMasked || '••••••••8492'}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">IFSC / Routing Code</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">
                  {employee.bankInfo?.ifsc || 'SVNB0004921'}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
              Statutory Identifiers (PF, UAN, ESI & PAN)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Permanent Account Number (PAN)</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">
                  {employee.statutory?.panMasked || 'ABCDE••••F'}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Universal Account Number (UAN)</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">
                  {employee.statutory?.uanMasked || '1009••••8192'}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">ESI Insurance Number</span>
                <p className="text-xs font-bold text-slate-900 mt-1 font-mono">
                  {employee.statutory?.esiMasked || '3192••••001'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Attendance & Extra Pay Summary */}
      {activeTab === 'attendance' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Attendance & Shift Hours
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Shift is 8h including break. Up to 10h earns nothing extra; above that is paid in day-credits.
              </p>
            </div>
            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
              Shift-Based Extra Pay
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Scheduled Daily Shift</span>
              <p className="text-sm font-bold text-slate-900 mt-1 font-mono">8h 00m</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Avg. Daily Attendance</span>
              <p className="text-sm font-bold text-slate-900 mt-1 font-mono">8h 45m</p>
            </div>
            <div className="p-4 bg-indigo-50/60 rounded-xl border border-indigo-200">
              <span className="text-[10px] uppercase font-bold text-indigo-700">Extra Days Earned (Sep)</span>
              <p className="text-sm font-bold text-indigo-900 mt-1 font-mono">+2.5 days</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400">Attendance Reliability</span>
              <p className="text-sm font-bold text-emerald-700 mt-1 font-mono">98.5%</p>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-xs font-bold text-slate-700 mb-2">Shift Attendance Punches</h4>
            {empAttendance.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">No attendance punches recorded yet.</p>
            ) : (
              <div className="space-y-1.5 text-xs">
                {empAttendance.map((row) => (
                  <div
                    key={row._id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-100 font-mono text-[11px] gap-2"
                  >
                    <span className="font-semibold text-slate-900 w-32">{row.date}</span>
                    <span className="text-slate-500">
                      In: {row.checkInTime || '--:--'} · Out: {row.checkOutTime || 'Active'}
                    </span>
                    <span className="text-slate-700">Net: {row.effectiveWorkingHours}h</span>
                    {(row.extraDayCredit ?? 0) > 0 ? (
                      <span className="text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                        Extra pay: +{row.extraDayCredit} day
                      </span>
                    ) : (
                      <span className="text-slate-400">Extra pay: none</span>
                    )}
                    <span
                      className={`font-semibold px-2 py-0.5 rounded text-[10px] uppercase border ${
                        row.status === 'PRESENT'
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : row.status === 'LATE'
                          ? 'text-amber-700 bg-amber-50 border-amber-200'
                          : 'text-slate-700 bg-slate-100 border-slate-200'
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Leave Balances */}
      {activeTab === 'leave' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Annual Leave Entitlement & Balances (Calendar 2026)
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-900">Casual Leave (CL)</span>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">8.0 / 12</p>
              <p className="text-[11px] text-slate-500 mt-1">4.0 days utilized</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-900">Sick Leave (SL)</span>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">7.5 / 10</p>
              <p className="text-[11px] text-slate-500 mt-1">2.5 days utilized</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-900">Earned / Privilege Leave</span>
              <p className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">11.0 / 15</p>
              <p className="text-[11px] text-slate-500 mt-1">Accrued quarterly</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Payroll & Compensation */}
      {activeTab === 'payroll' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Annual Compensation & Salary Structure
            </h3>
            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono font-semibold">
              Confidential (RBAC Controlled)
            </span>
          </div>

          <div className="p-5 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-[11px] text-slate-500 font-semibold uppercase">Cost to Company (Annual Gross CTC)</span>
            <p className="text-2xl font-black text-slate-900 mt-1 font-mono tabular-nums">
              ₹{(employee.annualSalary || 1400000).toLocaleString()} INR / yr
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 space-y-2">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Monthly Earnings</h4>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Basic Salary (50%)</span>
                  <span className="font-mono text-slate-900 tabular-nums">
                    ₹{Math.round(((employee.annualSalary || 1400000) * 0.5) / 12).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">House Rent Allowance (HRA 30%)</span>
                  <span className="font-mono text-slate-900 tabular-nums">
                    ₹{Math.round(((employee.annualSalary || 1400000) * 0.3) / 12).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-600">Special Allowances (20%)</span>
                  <span className="font-mono text-slate-900 tabular-nums">
                    ₹{Math.round(((employee.annualSalary || 1400000) * 0.2) / 12).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 space-y-2">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Statutory Deductions</h4>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Employee Provident Fund (PF 12%)</span>
                  <span className="font-mono text-rose-600 tabular-nums">-$650</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Health Insurance & ESI</span>
                  <span className="font-mono text-rose-600 tabular-nums">-$180</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-600">Estimated Monthly TDS</span>
                  <span className="font-mono text-rose-600 tabular-nums">-$1,240</span>
                </div>
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

                    {(user?.role === 'ADMIN') && doc.status !== 'VERIFIED' && (
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
                  <p className="font-bold text-slate-900">Joined Anusyuti</p>
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
                  <p className="font-bold text-slate-900">Joined Anusyuti</p>
                  <p className="text-[11px] text-slate-500">Initial appointment as {employee.designation}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {isEditOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">
                {isSelf && user?.role === 'EMPLOYEE' ? 'Update Personal Contact Details' : 'Edit Employee Information'}
              </h3>
              <button
                onClick={() => setIsEditOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
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

              {/* Admin/HR only editable fields */}
              {(user?.role === 'ADMIN') && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
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