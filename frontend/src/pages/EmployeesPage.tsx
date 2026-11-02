import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { Employee, Department, Designation, Location, Subdepartment } from '../types/employee';
import { Shift } from '../types/attendance';
import { employeeService } from '../services/employeeService';
import { attendanceService } from '../services/attendanceService';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { ExportButtons } from '../components/common/ExportButtons';
import { getProbationDetails, formatProbationDate } from '../utils/probation';
import {
  Users,
  Search,
  Filter,
  Plus,
  ChevronRight,
  Mail,
  Phone,
  Building2,
  MapPin,
  Calendar,
  Shield,
  MoreVertical,
  CheckCircle,
  AlertCircle,
  X,
  UserPlus,
  Clock,
  Briefcase,
  Layers,
} from 'lucide-react';

interface EmployeesPageProps {
  onSelectEmployee: (employeeId: string) => void;
}

export const EmployeesPage: React.FC<EmployeesPageProps> = ({ onSelectEmployee }) => {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subdepartments, setSubdepartments] = useState<Subdepartment[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedJobType, setSelectedJobType] = useState<string>('ALL');

  const getJobTypeBadge = (type?: string) => {
    switch (type) {
      case 'INTERN':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Internship</span>;
      case 'CONTRACT':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Contract</span>;
      case 'PART_TIME':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Part Time</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">Full Time</span>;
    }
  };

  const displayedEmployees = useMemo(() => {
    if (selectedJobType === 'ALL') return employees;
    return employees.filter((e) => e.employmentType === selectedJobType);
  }, [employees, selectedJobType]);

  // Probation Custom Modal & Notice State
  const [probationModalEmp, setProbationModalEmp] = useState<Employee | null>(null);
  const [probationMonthsInput, setProbationMonthsInput] = useState<number>(6);
  const [probationNotice, setProbationNotice] = useState<string | null>(null);

  // Modal State for Add Employee
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newHireNotice, setNewHireNotice] = useState<{ name: string; email: string; personalEmail?: string } | null>(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    workEmail: '',
    personalEmail: '',
    phone: '',
    department: 'Engineering & Technology',
    subdepartment: 'Frontend Core',
    designation: 'Senior Frontend Engineer',
    reportingManagerId: '',
    joiningDate: new Date().toISOString().split('T')[0],
    employmentType: 'FULL_TIME' as const,
    status: 'PROBATION' as const,
    probationMonths: 6,
    shift: 'Standard General (09:00 - 18:00)',
    location: 'Bengaluru HQ (Prestige Tech Park)',
    annualSalary: 1200000,
  });

  // Modal State for Quick Add Department
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [isDeptSubmitting, setIsDeptSubmitting] = useState(false);
  const [deptFormError, setDeptFormError] = useState<string | null>(null);
  const [deptSuccessNotice, setDeptSuccessNotice] = useState<string | null>(null);
  const [deptFormData, setDeptFormData] = useState({
    name: '',
    code: '',
  });

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeptFormError(null);
    setIsDeptSubmitting(true);
    try {
      const code = deptFormData.code.trim().toUpperCase() || deptFormData.name.trim().slice(0, 4).toUpperCase();
      const res = await employeeService.createDepartment({
        name: deptFormData.name.trim(),
        code,
      });
      if (res.success && res.department) {
        setDepartments((prev) => [...prev, res.department]);
        setFormData((prev) => ({ ...prev, department: res.department.name }));
        setDeptSuccessNotice(`Department "${res.department.name}" created and selected!`);
        setIsDeptModalOpen(false);
        setDeptFormData({ name: '', code: '' });
        setTimeout(() => setDeptSuccessNotice(null), 4000);
      }
    } catch (err: any) {
      setDeptFormError(err.message || 'Failed to create department');
    } finally {
      setIsDeptSubmitting(false);
    }
  };

  // Modal State for Quick Add Designation
  const [isDesigModalOpen, setIsDesigModalOpen] = useState(false);
  const [isDesigSubmitting, setIsDesigSubmitting] = useState(false);
  const [desigFormError, setDesigFormError] = useState<string | null>(null);
  const [desigFormData, setDesigFormData] = useState({ title: '', code: '', level: 'L2' });

  const handleCreateDesignation = async (e: React.FormEvent) => {
    e.preventDefault();
    setDesigFormError(null);
    setIsDesigSubmitting(true);
    try {
      const code = desigFormData.code.trim().toUpperCase() || desigFormData.title.trim().slice(0, 4).toUpperCase();
      const res = await employeeService.createDesignation({
        title: desigFormData.title.trim(),
        code,
        level: desigFormData.level,
        department: formData.department,
      });
      if (res.success && res.designation) {
        setDesignations((prev) => [...prev, res.designation]);
        setFormData((prev) => ({ ...prev, designation: res.designation.title }));
        setDeptSuccessNotice(`Designation "${res.designation.title}" created and selected!`);
        setIsDesigModalOpen(false);
        setDesigFormData({ title: '', code: '', level: 'L2' });
        setTimeout(() => setDeptSuccessNotice(null), 4000);
      }
    } catch (err: any) {
      setDesigFormError(err.message || 'Failed to create designation');
    } finally {
      setIsDesigSubmitting(false);
    }
  };

  // Modal State for Quick Add Subdepartment
  const [isSubdeptModalOpen, setIsSubdeptModalOpen] = useState(false);
  const [isSubdeptSubmitting, setIsSubdeptSubmitting] = useState(false);
  const [subdeptFormError, setSubdeptFormError] = useState<string | null>(null);
  const [subdeptFormData, setSubdeptFormData] = useState({
    name: '',
    departmentName: '',
    code: '',
    description: '',
  });

  const handleCreateSubdepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubdeptFormError(null);
    setIsSubdeptSubmitting(true);
    try {
      const deptName =
        subdeptFormData.departmentName ||
        formData.department ||
        departments[0]?.name ||
        'Engineering & Technology';
      const code =
        subdeptFormData.code.trim().toUpperCase() ||
        subdeptFormData.name.trim().slice(0, 4).toUpperCase();
      const res = await employeeService.createSubdepartment({
        name: subdeptFormData.name.trim(),
        departmentName: deptName,
        code,
        description: subdeptFormData.description.trim() || undefined,
      });
      if (res.success && res.subdepartment) {
        setSubdepartments((prev) => [...prev, res.subdepartment]);
        setFormData((prev) => ({
          ...prev,
          department: deptName,
          subdepartment: res.subdepartment.name,
        }));
        setDeptSuccessNotice(
          `Sub-department "${res.subdepartment.name}" created and selected!`
        );
        setIsSubdeptModalOpen(false);
        setSubdeptFormData({
          name: '',
          departmentName: '',
          code: '',
          description: '',
        });
        setTimeout(() => setDeptSuccessNotice(null), 4000);
      }
    } catch (err: any) {
      setSubdeptFormError(err.message || 'Failed to create sub-department');
    } finally {
      setIsSubdeptSubmitting(false);
    }
  };

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const [empRes, deptRes, subdeptRes, desigRes, locRes, shiftRes] = await Promise.all([
        employeeService.getEmployees({
          search,
          department: selectedDept,
          status: selectedStatus,
        }),
        employeeService.getDepartments(),
        employeeService.getSubdepartments().catch(() => ({ subdepartments: [] })),
        employeeService.getDesignations(),
        employeeService.getLocations(),
        attendanceService.getShifts().catch(() => ({ shifts: [] })),
      ]);
      setEmployees(empRes.employees);
      setDepartments(deptRes.departments);
      if (subdeptRes?.subdepartments) setSubdepartments(subdeptRes.subdepartments);
      setDesignations(desigRes.designations);
      setLocations(locRes.locations);
      if (shiftRes?.shifts) setShifts(shiftRes.shifts.filter((s) => s.status !== 'ENDED' && s.isActive !== false));
    } catch (err: any) {
      console.error('Failed to load employees:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [search, selectedDept, selectedStatus]);

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const email = formData.workEmail.trim().toLowerCase();
      const name = `${formData.firstName} ${formData.lastName}`;
      await employeeService.createEmployee(formData);
      setIsAddModalOpen(false);
      setNewHireNotice({
        name,
        email,
        personalEmail: formData.personalEmail.trim().toLowerCase(),
      });
      setFormData({
        firstName: '',
        lastName: '',
        workEmail: '',
        personalEmail: '',
        phone: '',
        department: departments[0]?.name || 'Engineering & Technology',
        subdepartment: 'Frontend Core',
        designation: designations[0]?.title || 'Associate',
        reportingManagerId: '',
        joiningDate: new Date().toISOString().split('T')[0],
        employmentType: 'FULL_TIME',
        status: 'PROBATION',
        probationMonths: 6,
        shift: 'Standard General (09:00 - 18:00)',
        location: locations[0]?.name || 'Bengaluru HQ (Prestige Tech Park)',
        annualSalary: 1200000,
      });
      await fetchEmployees();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create employee record');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async (empId: string, currentStatus: string) => {
    if (!confirm('Are you sure you want to deactivate this employee account?')) return;
    try {
      await employeeService.setEmployeeStatus(empId, currentStatus === 'ACTIVE' ? 'TERMINATED' : 'ACTIVE', false);
      await fetchEmployees();
    } catch (err: any) {
      alert(err.message || 'Error updating status');
    }
  };

  const probationAlerts = useMemo(() => {
    return employees.filter((emp) => {
      if (emp.status !== 'PROBATION') return false;
      const info = getProbationDetails(emp);
      return info.isExpiringSoon || info.isOverdue;
    });
  }, [employees]);

  const handleConfirmPermanent = async (emp: Employee) => {
    try {
      await employeeService.updateProbation(emp._id, { status: 'PERMANENT' });
      setProbationNotice(`${emp.firstName} ${emp.lastName} confirmed as Permanent employee!`);
      await fetchEmployees();
      setTimeout(() => setProbationNotice(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error updating employee status');
    }
  };

  const handleAdjustProbationMonths = async (emp: Employee, deltaMonths: number) => {
    try {
      const current = emp.probationMonths || 6;
      const newMonths = Math.max(1, current + deltaMonths);
      await employeeService.updateProbation(emp._id, { probationMonths: newMonths });
      setProbationNotice(`Probation duration for ${emp.firstName} ${emp.lastName} adjusted to ${newMonths} months.`);
      await fetchEmployees();
      setTimeout(() => setProbationNotice(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error adjusting probation period');
    }
  };

  const handleOpenProbationModal = (emp: Employee) => {
    setProbationModalEmp(emp);
    setProbationMonthsInput(emp.probationMonths || 6);
  };

  const handleSaveCustomProbation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!probationModalEmp) return;
    try {
      await employeeService.updateProbation(probationModalEmp._id, {
        probationMonths: probationMonthsInput,
      });
      setProbationNotice(`Probation duration set to ${probationMonthsInput} months for ${probationModalEmp.firstName} ${probationModalEmp.lastName}.`);
      setProbationModalEmp(null);
      await fetchEmployees();
      setTimeout(() => setProbationNotice(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error updating probation period');
    }
  };

  const handleStatusChange = async (empId: string, newStatus: string) => {
    try {
      await employeeService.setEmployeeStatus(empId, newStatus);
      await fetchEmployees();
    } catch (err: any) {
      alert(err.message || 'Error updating status');
    }
  };

  const getStatusBadge = (emp: Employee) => {
    const status = emp.status;
    if (status === 'PERMANENT' || status === 'ACTIVE') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
          Permanent
        </span>
      );
    }
    if (status === 'PROBATION') {
      const pInfo = getProbationDetails(emp);
      return (
        <div className="space-y-1">
          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${
            pInfo.isOverdue
              ? 'text-rose-800 bg-rose-50 border-rose-300'
              : pInfo.isExpiringSoon
              ? 'text-amber-900 bg-amber-100 border-amber-300'
              : 'text-amber-800 bg-amber-50 border-amber-200'
          }`}>
            <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            Probation ({pInfo.months} mo)
          </span>
          <span className="text-[10px] text-slate-500 block font-mono">
            Ends: {formatProbationDate(pInfo.endDate)}
            {pInfo.isOverdue ? (
              <strong className="text-rose-600 ml-1 font-bold">(Overdue {Math.abs(pInfo.daysRemaining)}d)</strong>
            ) : pInfo.isExpiringSoon ? (
              <strong className="text-amber-700 ml-1 font-bold">({pInfo.daysRemaining}d left)</strong>
            ) : null}
          </span>
        </div>
      );
    }
    if (status === 'TEMPORARY' || (status as string) === 'CONTRACT') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full">
          <Calendar className="w-3.5 h-3.5 text-indigo-500" />
          Temporary
        </span>
      );
    }
    if (status === 'TERMINATED') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full">
          <X className="w-3.5 h-3.5 text-rose-500" />
          Deactivated
        </span>
      );
    }
    return <span className="text-xs text-slate-500">{status}</span>;
  };

  const handleExportExcel = () => {
    exportToExcel(
      displayedEmployees,
      'Employee_Directory_Report',
      'Employees',
      [
        { header: 'Employee Code', key: 'employeeCode' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Work Email', key: 'workEmail' },
        { header: 'Phone', key: (e) => e.phone || 'N/A' },
        { header: 'Department', key: 'department' },
        { header: 'Sub-Department', key: (e) => e.subdepartment || 'N/A' },
        { header: 'Designation', key: 'designation' },
        { header: 'Joining Date', key: 'joiningDate' },
        { header: 'Employment Type', key: 'employmentType' },
        { header: 'Status', key: 'status' },
        { header: 'Location', key: 'location' },
        { header: 'Shift', key: (e) => e.shift || 'Default' },
        { header: 'Annual Salary (₹)', key: (e) => e.annualSalary ?? 0 },
      ]
    );
  };

  const handleExportPdf = () => {
    const headers = ['Code', 'Name', 'Email', 'Department', 'Sub-Dept', 'Designation', 'Type', 'Status', 'Location'];
    const rows = displayedEmployees.map((e) => [
      e.employeeCode,
      `${e.firstName} ${e.lastName}`,
      e.workEmail,
      e.department,
      e.subdepartment || '-',
      e.designation,
      e.employmentType,
      e.status,
      e.location,
    ]);
    exportToPdf(
      'Organization Employee Master Directory Report',
      headers,
      rows,
      'Employee_Directory_Report',
      `Exported ${displayedEmployees.length} active employee records`
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Role-scoped actions */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Employees Management
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <ExportButtons
            onExportExcel={handleExportExcel}
            onExportPdf={handleExportPdf}
          />
          {user?.role === 'ADMIN' && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs whitespace-nowrap border border-[#039583]"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Employee</span>
            </button>
          )}
        </div>
      </div>

      {/* New Hire Credentials & Onboarding Notice Banner */}
      {newHireNotice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 shadow-xs animate-in fade-in space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-emerald-950">
                  Employee Created & Enrolled in Onboarding!
                </h3>
                <p className="text-xs text-emerald-700 mt-0.5">
                  <strong>{newHireNotice.name}</strong> has been added and dispatched to the Onboarding Review Queue.
                </p>
              </div>
            </div>
            <button
              onClick={() => setNewHireNotice(null)}
              className="text-emerald-700 hover:text-emerald-900 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 bg-white rounded-xl border border-emerald-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">Work Email (Login ID)</span>
              <p className="font-mono font-bold text-slate-900 select-all">{newHireNotice.email}</p>
            </div>
            {newHireNotice.personalEmail && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">Personal Email</span>
                <p className="font-mono font-semibold text-slate-800 select-all">{newHireNotice.personalEmail}</p>
              </div>
            )}
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">Password Setup</span>
              <p className="text-xs text-slate-700">Secure password setup link emailed to employee</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-500 block">Status: Awaiting First Sign-in</span>
              <span className="text-[10px] text-emerald-700 font-bold">8-Step Onboarding Enabled</span>
            </div>
          </div>
        </div>
      )}

      {/* Probation Action Success Toast Banner */}
      {probationNotice && (
        <div className="bg-amber-50 border border-amber-300 text-amber-950 p-4 rounded-xl text-xs font-semibold flex items-center justify-between shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{probationNotice}</span>
          </div>
          <button onClick={() => setProbationNotice(null)}>
            <X className="w-4 h-4 text-amber-700 hover:text-amber-900 cursor-pointer" />
          </button>
        </div>
      )}

      {/* Probation Review Expiration Alert Banner for HR & Admin */}
      {(user?.role === 'ADMIN' || user?.role === 'HR') && probationAlerts.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-300 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center shrink-0">
                <AlertCircle className="w-4 h-4 text-amber-700" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-950">
                  Probation Period Expiration Alerts ({probationAlerts.length} Employee{probationAlerts.length === 1 ? '' : 's'} Due)
                </h3>
                <p className="text-xs text-amber-800 mt-0.5">
                  Initial 6-month probation period is ending soon or overdue. Review employee performance and adjust probation or confirm as Permanent.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {probationAlerts.map((emp) => {
              const pInfo = getProbationDetails(emp);
              return (
                <div key={emp._id} className="p-3.5 bg-white rounded-xl border border-amber-200 flex flex-col justify-between gap-2 shadow-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-slate-900 text-xs block">{emp.firstName} {emp.lastName} ({emp.employeeCode})</span>
                      <span className="text-[11px] text-slate-500 block">{emp.designation} · {emp.department}</span>
                      <span className="text-[10px] text-slate-400 block font-mono mt-0.5">Joined: {emp.joiningDate} | Ends: {formatProbationDate(pInfo.endDate)}</span>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                      pInfo.isOverdue ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-100 text-amber-900 border-amber-300'
                    }`}>
                      {pInfo.isOverdue ? `Overdue (${Math.abs(pInfo.daysRemaining)}d)` : `${pInfo.daysRemaining} days left`}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => handleConfirmPermanent(emp)}
                      className="flex-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold transition cursor-pointer"
                    >
                      Confirm Permanent
                    </button>
                    <button
                      onClick={() => handleAdjustProbationMonths(emp, -1)}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-bold cursor-pointer"
                      title="Decrease probation by 1 month"
                    >
                      -1 Mo
                    </button>
                    <button
                      onClick={() => handleAdjustProbationMonths(emp, 1)}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-bold cursor-pointer"
                      title="Extend probation by 1 month"
                    >
                      +1 Mo
                    </button>
                    <button
                      onClick={() => handleOpenProbationModal(emp)}
                      className="px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded text-[11px] font-bold cursor-pointer"
                    >
                      Adjust
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter and Search Bar (Single-line controls with tabular discipline) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="w-full md:w-80 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, ID, email, or role..."
            className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 transition-colors"
          />
        </div>

        <div className="w-full md:w-auto flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold">Department:</span>
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none"
            >
              <option value="ALL">All Departments</option>
              {departments.map((d) => (
                <option key={d._id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
            {(user?.role === 'ADMIN' || user?.role === 'HR') && (
              <button
                type="button"
                onClick={() => setIsDeptModalOpen(true)}
                className="px-2 py-1 text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                title="Create New Department"
              >
                <Plus className="w-3 h-3" />
                <span>+ Dept</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-semibold">Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none font-medium"
            >
              <option value="ALL">All Statuses</option>
              <option value="PROBATION">Probation</option>
              <option value="PERMANENT">Permanent</option>
              <option value="TEMPORARY">Temporary</option>
              <option value="TERMINATED">Deactivated</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-semibold">Job Type:</span>
            <select
              value={selectedJobType}
              onChange={(e) => setSelectedJobType(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none font-medium"
            >
              <option value="ALL">All Job Types</option>
              <option value="FULL_TIME">Full Time</option>
              <option value="INTERN">Internship</option>
              <option value="PART_TIME">Part Time</option>
              <option value="CONTRACT">Contract</option>
            </select>
          </div>

          <span className="text-xs text-slate-400 font-mono tabular-nums ml-auto md:ml-2">
            {displayedEmployees.length} {displayedEmployees.length === 1 ? 'employee' : 'employees'}
          </span>
        </div>
      </div>

      {/* High-Density Data Grid */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500">
            <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading employee directory...
          </div>
        ) : displayedEmployees.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-800">No employees found</h3>
            <p className="text-xs text-slate-500 mt-1">
              Try adjusting your search criteria, department, status, or job type filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Role & Department</th>
                  <th className="py-3 px-4">Reporting Manager</th>
                  <th className="py-3 px-4">Shift & Location</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {displayedEmployees.map((emp) => (
                  <tr
                    key={emp._id}
                    onClick={() => onSelectEmployee(emp._id)}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
                          {emp.firstName[0]}
                          {emp.lastName[0]}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span>
                              {emp.firstName} {emp.lastName}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400 font-normal">
                              ({emp.employeeCode})
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500 truncate block max-w-xs">
                            {emp.workEmail}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-900">{emp.designation}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>
                          {emp.department}
                          {emp.subdepartment && <span className="text-slate-400 font-normal"> · {emp.subdepartment}</span>}
                        </span>
                        {getJobTypeBadge(emp.employmentType)}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="text-slate-700 font-medium">
                        {emp.reportingManagerName || 'Executive Committee'}
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="text-slate-900">{emp.location}</div>
                      <div className="text-[11px] text-slate-400 font-mono truncate max-w-[140px]">
                        {emp.shift}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">{getStatusBadge(emp)}</td>

                    <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1.5">
                        {emp.status === 'PROBATION' && (user?.role === 'ADMIN' || user?.role === 'HR') && (
                          <div className="flex items-center gap-1 bg-amber-50/80 p-1 rounded-lg border border-amber-200">
                            <button
                              onClick={() => handleConfirmPermanent(emp)}
                              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded transition cursor-pointer"
                              title="Promote to Permanent"
                            >
                              Make Permanent
                            </button>
                            <button
                              onClick={() => handleAdjustProbationMonths(emp, -1)}
                              className="px-1.5 py-0.5 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-bold rounded border border-slate-200 cursor-pointer"
                              title="Reduce probation by 1 month"
                            >
                              -1 Mo
                            </button>
                            <button
                              onClick={() => handleAdjustProbationMonths(emp, 1)}
                              className="px-1.5 py-0.5 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-bold rounded border border-slate-200 cursor-pointer"
                              title="Extend probation by 1 month"
                            >
                              +1 Mo
                            </button>
                          </div>
                        )}

                        <button
                          onClick={() => onSelectEmployee(emp._id)}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                        >
                          View Profile
                        </button>

                        {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                          <select
                            value={emp.status === 'ACTIVE' ? 'PERMANENT' : emp.status}
                            onChange={(e) => handleStatusChange(emp._id, e.target.value)}
                            className="text-[11px] font-semibold bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none cursor-pointer"
                          >
                            <option value="PROBATION">Probation</option>
                            <option value="PERMANENT">Permanent</option>
                            <option value="TEMPORARY">Temporary</option>
                            <option value="TERMINATED">Deactivated</option>
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Add New Employee (ADMIN ONLY) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Add New Employee Profile</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateEmployee} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">First Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="Liam"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="Morrison"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Work Email *</label>
                  <input
                    type="email"
                    required
                    value={formData.workEmail}
                    onChange={(e) => setFormData({ ...formData, workEmail: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="rohan.verma@vetan.ai"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Personal Email Address *</label>
                  <input
                    type="email"
                    required
                    value={formData.personalEmail}
                    onChange={(e) => setFormData({ ...formData, personalEmail: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="rohan.verma@gmail.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Personal Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    placeholder="+91 98452 01948"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Joining Date *</label>
                  <input
                    type="date"
                    required
                    value={formData.joiningDate}
                    onChange={(e) => setFormData({ ...formData, joiningDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {deptSuccessNotice && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 rounded-lg flex items-center justify-between">
                  <span>{deptSuccessNotice}</span>
                  <button type="button" onClick={() => setDeptSuccessNotice(null)} className="text-emerald-600 hover:text-emerald-800">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700">Department *</label>
                    <button
                      type="button"
                      onClick={() => setIsDeptModalOpen(true)}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Add Dept
                    </button>
                  </div>
                  <select
                    value={formData.department}
                    onChange={(e) => {
                      const newDept = e.target.value;
                      const matchingSub = subdepartments.find((s) => s.departmentName === newDept);
                      setFormData({
                        ...formData,
                        department: newDept,
                        subdepartment: matchingSub ? matchingSub.name : '',
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 bg-white"
                  >
                    {departments.map((d) => (
                      <option key={d._id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                    {!departments.some((d) => d.name === formData.department) && (
                      <option value={formData.department}>{formData.department}</option>
                    )}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700">Sub-Department</label>
                    <button
                      type="button"
                      onClick={() => {
                        setSubdeptFormData((prev) => ({
                          ...prev,
                          departmentName: formData.department,
                        }));
                        setIsSubdeptModalOpen(true);
                      }}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Add Subdept
                    </button>
                  </div>
                  <select
                    value={formData.subdepartment}
                    onChange={(e) => setFormData({ ...formData, subdepartment: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 bg-white"
                  >
                    <option value="">None / General</option>
                    {subdepartments
                      .filter((s) => !formData.department || s.departmentName === formData.department)
                      .map((s) => (
                        <option key={s._id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    {formData.subdepartment &&
                      !subdepartments.some((s) => s.name === formData.subdepartment) && (
                        <option value={formData.subdepartment}>{formData.subdepartment}</option>
                      )}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700">Designation *</label>
                    <button
                      type="button"
                      onClick={() => setIsDesigModalOpen(true)}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Add Designation
                    </button>
                  </div>
                  <select
                    value={formData.designation}
                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                  >
                    {designations.map((d) => (
                      <option key={d._id} value={d.title}>
                        {d.title} ({d.level})
                      </option>
                    ))}
                    {!designations.some((d) => d.title === formData.designation) && (
                      <option value={formData.designation}>{formData.designation}</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Reporting Manager</label>
                  <select
                    value={formData.reportingManagerId}
                    onChange={(e) => setFormData({ ...formData, reportingManagerId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    <option value="">Executive Committee (Direct)</option>
                    {employees.map((emp) => (
                      <option key={emp._id} value={emp._id}>
                        {emp.firstName} {emp.lastName} ({emp.designation})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Work Location</label>
                  <select
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                  >
                    {locations.map((loc) => (
                      <option key={loc._id} value={loc.name}>
                        {loc.name} ({loc.country})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Work Shift *</label>
                  <select
                    value={formData.shift}
                    onChange={(e) => setFormData({ ...formData, shift: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium bg-white"
                  >
                    {shifts.map((s) => (
                      <option key={s._id} value={`${s.name} (${s.startTime} - ${s.endTime})`}>
                        {s.name} ({s.startTime} - {s.endTime})
                      </option>
                    ))}
                    {!shifts.some(
                      (s) => `${s.name} (${s.startTime} - ${s.endTime})` === formData.shift || s.name === formData.shift
                    ) && <option value={formData.shift}>{formData.shift}</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Job Type *</label>
                  <select
                    value={formData.employmentType}
                    onChange={(e) => setFormData({ ...formData, employmentType: e.target.value as any })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                  >
                    <option value="FULL_TIME">Full time</option>
                    <option value="INTERN">Internship</option>
                    <option value="PART_TIME">Part time</option>
                    <option value="CONTRACT">Contract</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Initial Employee Status *</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold"
                  >
                    <option value="PROBATION">Probation (Default)</option>
                    <option value="PERMANENT">Permanent</option>
                    <option value="TEMPORARY">Temporary</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {formData.status === 'PROBATION' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Probation Duration (Months) *</label>
                    <input
                      type="number"
                      required
                      min="1"
                      max="24"
                      value={formData.probationMonths}
                      onChange={(e) => setFormData({ ...formData, probationMonths: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Annual CTC (₹ INR) *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1000"
                    value={formData.annualSalary}
                    onChange={(e) => setFormData({ ...formData, annualSalary: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="1200000"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Quick Add Department */}
      {isDeptModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-900">Create New Department</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDeptModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDepartment} className="p-5 space-y-3">
              {deptFormError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  {deptFormError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700">Department Name *</label>
                <input
                  type="text"
                  required
                  value={deptFormData.name}
                  onChange={(e) => setDeptFormData({ ...deptFormData, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="e.g. Quality Assurance"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Department Code (Short ID)</label>
                <input
                  type="text"
                  value={deptFormData.code}
                  onChange={(e) => setDeptFormData({ ...deptFormData, code: e.target.value.toUpperCase() })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="e.g. QA (auto-generated if empty)"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsDeptModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeptSubmitting}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isDeptSubmitting ? 'Creating...' : 'Create Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Quick Add Subdepartment */}
      {isSubdeptModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-900">Create New Sub-Department</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSubdeptModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubdepartment} className="p-5 space-y-3">
              {subdeptFormError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  {subdeptFormError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700">Parent Department *</label>
                <select
                  value={subdeptFormData.departmentName || formData.department}
                  onChange={(e) =>
                    setSubdeptFormData({ ...subdeptFormData, departmentName: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                >
                  {departments.map((d) => (
                    <option key={d._id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Sub-Department Name *</label>
                <input
                  type="text"
                  required
                  value={subdeptFormData.name}
                  onChange={(e) => setSubdeptFormData({ ...subdeptFormData, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="e.g. Frontend Core, Cloud Infra, Talent Acquisition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Sub-Department Code (Optional)</label>
                <input
                  type="text"
                  value={subdeptFormData.code}
                  onChange={(e) =>
                    setSubdeptFormData({ ...subdeptFormData, code: e.target.value.toUpperCase() })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="e.g. ENG-FE (auto-generated if empty)"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Description (Optional)</label>
                <textarea
                  rows={2}
                  value={subdeptFormData.description}
                  onChange={(e) =>
                    setSubdeptFormData({ ...subdeptFormData, description: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="Brief role or functional responsibility"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsSubdeptModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubdeptSubmitting}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubdeptSubmitting ? 'Creating...' : 'Create Sub-Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Quick Add Designation */}
      {isDesigModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-900">Create New Designation</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDesigModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDesignation} className="p-5 space-y-3">
              {desigFormError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  {desigFormError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Designation Title *</label>
                <input
                  type="text"
                  required
                  value={desigFormData.title}
                  onChange={(e) => setDesigFormData({ ...desigFormData, title: e.target.value })}
                  placeholder="e.g. Staff AI Researcher"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role Code</label>
                  <input
                    type="text"
                    value={desigFormData.code}
                    onChange={(e) => setDesigFormData({ ...desigFormData, code: e.target.value })}
                    placeholder="SAIR"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Level / Band</label>
                  <select
                    value={desigFormData.level}
                    onChange={(e) => setDesigFormData({ ...desigFormData, level: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white font-mono"
                  >
                    <option value="L1">L1 - Entry</option>
                    <option value="L2">L2 - Associate</option>
                    <option value="L3">L3 - Senior</option>
                    <option value="L4">L4 - Lead</option>
                    <option value="L5">L5 - Director</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsDesigModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDesigSubmitting}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isDesigSubmitting ? 'Creating...' : 'Create Designation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Custom Probation Adjustment */}
      {probationModalEmp && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <h3 className="text-xs font-bold text-slate-900">
                  Adjust Probation Period — {probationModalEmp.firstName} {probationModalEmp.lastName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setProbationModalEmp(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomProbation} className="p-5 space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 text-xs text-amber-900 rounded-xl space-y-1">
                <p className="font-bold">Probation Period Summary</p>
                <p className="text-[11px]">Joining Date: <strong className="font-mono">{probationModalEmp.joiningDate}</strong></p>
                <p className="text-[11px]">Current Probation: <strong className="font-mono">{probationModalEmp.probationMonths || 6} Months</strong></p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Set Probation Duration (Months) *</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    required
                    min="1"
                    max="24"
                    value={probationMonthsInput}
                    onChange={(e) => setProbationMonthsInput(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                  <span className="text-xs text-slate-500 shrink-0">Months</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Quick adjust:
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {[3, 6, 9, 12].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setProbationMonthsInput(m)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg border cursor-pointer ${
                        probationMonthsInput === m
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {m} Months
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 flex items-center justify-between border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    handleConfirmPermanent(probationModalEmp);
                    setProbationModalEmp(null);
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                >
                  Confirm as Permanent Now
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setProbationModalEmp(null)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
