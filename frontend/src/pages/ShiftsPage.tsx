import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { attendanceService } from '../services/attendanceService';
import { employeeService } from '../services/employeeService';
import { Shift } from '../types/attendance';
import { Department, Employee } from '../types/employee';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { ExportButtons } from '../components/common/ExportButtons';
import {
  Calendar,
  Clock,
  Plus,
  Building,
  CheckCircle2,
  Moon,
  Sun,
  Coffee,
  AlertCircle,
  AlertTriangle,
  X,
  Edit2,
  Search,
  RotateCcw,
  Check,
  History,
  Users,
  PowerOff,
  UserCheck,
  ArrowRight,
  Shield,
} from 'lucide-react';

export const ShiftsPage: React.FC = () => {
  const { user } = useAuth();
  const canManageShifts = user?.role === 'ADMIN';

  const [activeMainTab, setActiveMainTab] = useState<'ACTIVE' | 'HISTORY' | 'ROSTER'>('ACTIVE');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'DAY' | 'NIGHT'>('ALL');

  // Modal State for Add & Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // End Shift Modal State (replacing delete)
  const [endConfirmShift, setEndConfirmShift] = useState<Shift | null>(null);
  const [endReason, setEndReason] = useState('');
  const [isEnding, setIsEnding] = useState(false);

  // Quick Employee Shift Assignment Modal State
  const [assignModalShift, setAssignModalShift] = useState<Shift | null>(null);
  const [selectedEmpIds, setSelectedEmpIds] = useState<string[]>([]);
  const [empSearch, setEmpSearch] = useState('');

  const initialFormData = {
    name: '',
    code: '',
    startTime: '09:00',
    endTime: '18:00',
    expectedHours: 8,
    breakMinutes: 60,
    gracePeriodMinutes: 15,
    isNightShift: false,
    departments: [] as string[],
    assignedEmployeeIds: [] as string[],
    isActive: true,
  };

  const [formData, setFormData] = useState(initialFormData);

  const fetchShiftsAndEmployees = async () => {
    setLoading(true);
    try {
      const [shiftsRes, deptsRes, empRes] = await Promise.all([
        attendanceService.getShifts(),
        employeeService.getDepartments(),
        employeeService.getEmployees(),
      ]);
      setShifts(shiftsRes.shifts);
      setDepartments(deptsRes.departments);
      setEmployees(empRes.employees);
    } catch (err) {
      console.error('Failed to load shifts or employees:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShiftsAndEmployees();
  }, []);

  const activeShifts = shifts.filter((s) => s.status !== 'ENDED' && s.isActive !== false);
  const endedShifts = shifts.filter((s) => s.status === 'ENDED' || s.isActive === false);

  const handleOpenCreateModal = () => {
    setEditingShift(null);
    setFormData(initialFormData);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (shift: Shift) => {
    setEditingShift(shift);
    setFormData({
      name: shift.name,
      code: shift.code,
      startTime: shift.startTime,
      endTime: shift.endTime,
      expectedHours: shift.expectedHours ?? 8,
      breakMinutes: shift.breakMinutes ?? 60,
      gracePeriodMinutes: shift.gracePeriodMinutes ?? 15,
      isNightShift: Boolean(shift.isNightShift),
      departments: shift.departments ? [...shift.departments] : [],
      assignedEmployeeIds: shift.assignedEmployeeIds ? [...shift.assignedEmployeeIds] : [],
      isActive: shift.isActive !== false,
    });
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) return;

    setIsSubmitting(true);
    try {
      // Find employee names for assigned IDs
      const assignedEmployeeNames = formData.assignedEmployeeIds
        .map((id) => {
          const emp = employees.find((e) => e._id === id);
          return emp ? `${emp.firstName} ${emp.lastName}` : null;
        })
        .filter(Boolean) as string[];

      const payload = {
        ...formData,
        isNightShift: formData.isNightShift || formData.endTime < formData.startTime,
        assignedEmployees: assignedEmployeeNames,
        status: 'ACTIVE' as const,
      };

      if (editingShift) {
        const res = await attendanceService.updateShift(editingShift._id, payload);
        if (res.success) {
          setFeedbackMsg({
            type: 'success',
            text: `Shift "${res.shift.name}" updated successfully!`,
          });
          setIsModalOpen(false);
          await fetchShiftsAndEmployees();
          setTimeout(() => setFeedbackMsg(null), 4000);
        }
      } else {
        const res = await attendanceService.createShift(payload);
        if (res.success) {
          setFeedbackMsg({
            type: 'success',
            text: `Shift "${res.shift.name}" created and assigned successfully!`,
          });
          setIsModalOpen(false);
          setFormData(initialFormData);
          await fetchShiftsAndEmployees();
          setTimeout(() => setFeedbackMsg(null), 4000);
        }
      }
    } catch (err: any) {
      console.error('Failed to save shift:', err);
      setFeedbackMsg({
        type: 'error',
        text: err?.message || 'Failed to save shift policy. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEndShiftConfirm = async () => {
    if (!endConfirmShift) return;

    setIsEnding(true);
    try {
      const res = await attendanceService.endShift(
        endConfirmShift._id,
        endReason || 'Ended by Administrator'
      );
      if (res.success) {
        setFeedbackMsg({
          type: 'success',
          text: `Shift "${endConfirmShift.name}" has been ended and stored in Shift History.`,
        });
        setEndConfirmShift(null);
        setEndReason('');
        await fetchShiftsAndEmployees();
        setTimeout(() => setFeedbackMsg(null), 4000);
      }
    } catch (err: any) {
      console.error('Failed to end shift:', err);
      setFeedbackMsg({
        type: 'error',
        text: err?.message || 'Failed to end shift. Please try again.',
      });
    } finally {
      setIsEnding(false);
    }
  };

  const handleQuickEmployeeShiftChange = async (employeeId: string, newShiftName: string) => {
    try {
      await employeeService.updateEmployee(employeeId, { shift: newShiftName });
      setFeedbackMsg({
        type: 'success',
        text: `Employee shift updated to "${newShiftName}".`,
      });
      await fetchShiftsAndEmployees();
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err: any) {
      setFeedbackMsg({
        type: 'error',
        text: err?.message || 'Failed to update employee shift.',
      });
    }
  };

  const toggleEmpSelection = (empId: string) => {
    setFormData((prev) => ({
      ...prev,
      assignedEmployeeIds: prev.assignedEmployeeIds.includes(empId)
        ? prev.assignedEmployeeIds.filter((id) => id !== empId)
        : [...prev.assignedEmployeeIds, empId],
    }));
  };

  const toggleDeptSelection = (deptName: string) => {
    setFormData((prev) => ({
      ...prev,
      departments: prev.departments.includes(deptName)
        ? prev.departments.filter((d) => d !== deptName)
        : [...prev.departments, deptName],
    }));
  };

  const filteredActiveShifts = activeShifts.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code.toLowerCase().includes(search.toLowerCase()) ||
      s.assignedEmployees?.some((emp) => emp.toLowerCase().includes(search.toLowerCase())) ||
      s.departments?.some((d) => d.toLowerCase().includes(search.toLowerCase()));

    if (filterType === 'DAY') return matchesSearch && !s.isNightShift;
    if (filterType === 'NIGHT') return matchesSearch && s.isNightShift;
    return matchesSearch;
  });

  const filteredEndedShifts = endedShifts.filter((s) => {
    return (
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code.toLowerCase().includes(search.toLowerCase()) ||
      s.endReason?.toLowerCase().includes(search.toLowerCase())
    );
  });

  const filteredEmployeesForRoster = employees.filter((emp) => {
    const full = `${emp.firstName} ${emp.lastName} ${emp.employeeCode} ${emp.department} ${emp.shift}`.toLowerCase();
    return full.includes(search.toLowerCase());
  });

  const handleExportExcel = () => {
    if (activeMainTab === 'ROSTER') {
      exportToExcel(
        filteredEmployeesForRoster,
        'Employee_Shift_Roster_Report',
        'Roster',
        [
          { header: 'Employee Code', key: 'employeeCode' },
          { header: 'Employee Name', key: (e) => `${e.firstName} ${e.lastName}` },
          { header: 'Department', key: 'department' },
          { header: 'Designation', key: 'designation' },
          { header: 'Assigned Shift', key: (e) => e.shift || 'Default' },
        ]
      );
    } else if (activeMainTab === 'HISTORY') {
      exportToExcel(
        filteredEndedShifts,
        'Shift_History_Report',
        'ShiftHistory',
        [
          { header: 'Shift Code', key: 'code' },
          { header: 'Shift Name', key: 'name' },
          { header: 'Start Time', key: 'startTime' },
          { header: 'End Time', key: 'endTime' },
          { header: 'Ended At', key: (s) => s.endedAt ? new Date(s.endedAt).toLocaleDateString() : 'N/A' },
          { header: 'Ended By', key: (s) => s.endedBy || 'Admin' },
          { header: 'Reason', key: (s) => s.endReason || 'Ended' },
        ]
      );
    } else {
      exportToExcel(
        filteredActiveShifts,
        'Active_Work_Shifts_Report',
        'Shifts',
        [
          { header: 'Shift Code', key: 'code' },
          { header: 'Shift Name', key: 'name' },
          { header: 'Start Time', key: 'startTime' },
          { header: 'End Time', key: 'endTime' },
          { header: 'Expected Hours', key: 'expectedHours' },
          { header: 'Night Shift', key: (s) => s.isNightShift ? 'Yes' : 'No' },
          { header: 'Assigned Employees', key: (s) => s.assignedEmployees?.join(', ') || 'General' },
        ]
      );
    }
  };

  const handleExportPdf = () => {
    if (activeMainTab === 'ROSTER') {
      const headers = ['Code', 'Employee', 'Department', 'Designation', 'Assigned Shift'];
      const rows = filteredEmployeesForRoster.map((e) => [
        e.employeeCode,
        `${e.firstName} ${e.lastName}`,
        e.department,
        e.designation,
        e.shift || 'Default',
      ]);
      exportToPdf('Employee Shift Allocation Roster Report', headers, rows, 'Employee_Shift_Roster_Report');
    } else if (activeMainTab === 'HISTORY') {
      const headers = ['Code', 'Shift Name', 'Timing', 'Ended Date', 'Ended By', 'End Reason'];
      const rows = filteredEndedShifts.map((s) => [
        s.code,
        s.name,
        `${s.startTime} - ${s.endTime}`,
        s.endedAt ? new Date(s.endedAt).toLocaleDateString() : 'N/A',
        s.endedBy || 'Admin',
        s.endReason || 'Ended',
      ]);
      exportToPdf('Historical Ended Work Shifts Policy Audit Report', headers, rows, 'Shift_History_Report');
    } else {
      const headers = ['Code', 'Shift Name', 'Hours', 'Type', 'Break', 'Grace', 'Assigned Count'];
      const rows = filteredActiveShifts.map((s) => [
        s.code,
        s.name,
        `${s.startTime} - ${s.endTime}`,
        s.isNightShift ? 'Night' : 'Day',
        `${s.breakMinutes}m`,
        `${s.gracePeriodMinutes}m`,
        `${s.assignedEmployees?.length || 0} employees`,
      ]);
      exportToPdf('Active Work Shifts & Roster Policies Report', headers, rows, 'Active_Work_Shifts_Report');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Clock className="w-6 h-6 text-[#039583]" />
            Work Shifts & Employee Rosters
          </h1>
          <p className="text-xs text-blue-100/80 mt-1">
            Configure employee-specific work shifts, manage active rosters, and review historical shift records.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <ExportButtons
            onExportExcel={handleExportExcel}
            onExportPdf={handleExportPdf}
          />
          <button
            onClick={fetchShiftsAndEmployees}
            className="p-2.5 bg-[#012a52] hover:bg-[#023b77] text-white rounded-xl transition cursor-pointer border border-[#039583]/50"
            title="Refresh rosters"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {canManageShifts && (
            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2.5 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition shadow-xs cursor-pointer border border-[#039583]"
            >
              <Plus className="w-4 h-4" />
              Configure New Shift
            </button>
          )}
        </div>
      </div>

      {/* Role Notice */}
      {canManageShifts && (
        <div className="bg-indigo-50/60 border border-indigo-200/80 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-indigo-900">
            <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>
              <strong>HR Operational Authority:</strong> Shifts are assigned on an <strong>employee-specific</strong> basis. Ending a shift preserves full historical record in Shift History.
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase font-bold">
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
              {activeShifts.length} Active
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700">
              {endedShifts.length} Historical
            </span>
          </div>
        </div>
      )}

      {/* Feedback Alert */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-xl text-xs flex items-center justify-between shadow-2xs border ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-semibold">{feedbackMsg.text}</span>
          </div>
          <button onClick={() => setFeedbackMsg(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Tab Navigation */}
      <div className="flex border-b border-slate-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveMainTab('ACTIVE')}
          className={`pb-3 flex items-center gap-2 cursor-pointer border-b-2 transition-colors ${
            activeMainTab === 'ACTIVE'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Active Work Shifts ({activeShifts.length})</span>
        </button>

        <button
          onClick={() => setActiveMainTab('ROSTER')}
          className={`pb-3 flex items-center gap-2 cursor-pointer border-b-2 transition-colors ${
            activeMainTab === 'ROSTER'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Employee Shift Allocation Roster ({employees.length})</span>
        </button>

        <button
          onClick={() => setActiveMainTab('HISTORY')}
          className={`pb-3 flex items-center gap-2 cursor-pointer border-b-2 transition-colors ${
            activeMainTab === 'HISTORY'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Shift History & Ended Shifts ({endedShifts.length})</span>
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={
              activeMainTab === 'ROSTER'
                ? 'Search employees by name, code, department, or shift...'
                : 'Search shift by name, code, or assigned employees...'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {activeMainTab === 'ACTIVE' && (
          <div className="flex items-center gap-1.5 self-start sm:self-auto">
            {(
              [
                { id: 'ALL', label: `All (${activeShifts.length})` },
                { id: 'DAY', label: `Day Shifts (${activeShifts.filter((s) => !s.isNightShift).length})` },
                { id: 'NIGHT', label: `Night Shifts (${activeShifts.filter((s) => s.isNightShift).length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterType === tab.id
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content Rendering based on Tab */}
      {loading ? (
        <div className="p-16 text-center text-xs text-slate-400 font-mono bg-white rounded-2xl border border-slate-200">
          Loading work shift policies and employee roster...
        </div>
      ) : activeMainTab === 'ACTIVE' ? (
        /* TAB 1: ACTIVE SHIFTS GRID */
        filteredActiveShifts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
            <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No Active Shifts Found</p>
            <p className="text-xs text-slate-400 mt-1">
              {search ? 'No active shifts match your query.' : 'Configure new employee work shifts.'}
            </p>
            {canManageShifts && (
              <button
                onClick={handleOpenCreateModal}
                className="mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Configure New Shift
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredActiveShifts.map((s) => {
              // Count employees assigned to this shift name or ID
              const assignedEmpList = employees.filter(
                (emp) =>
                  s.assignedEmployeeIds?.includes(emp._id) ||
                  (emp.shift && emp.shift.toLowerCase().includes(s.name.toLowerCase()))
              );

              return (
                <div
                  key={s._id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 hover:shadow-sm transition flex flex-col justify-between space-y-4"
                >
                  <div>
                    {/* Header Strip with Code, Night/Day, and Action Buttons */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                          {s.code}
                        </span>

                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1 border ${
                            s.isNightShift
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}
                        >
                          {s.isNightShift ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                          {s.isNightShift ? 'Night Shift' : 'Day Shift'}
                        </span>
                      </div>

                      {canManageShifts && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleOpenEditModal(s)}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition cursor-pointer"
                            title="Edit Shift"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEndConfirmShift(s)}
                            className="p-1.5 hover:bg-amber-50 rounded-lg text-slate-400 hover:text-amber-700 transition cursor-pointer"
                            title="End Shift"
                          >
                            <PowerOff className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-slate-900 mt-3">{s.name}</h3>

                    {/* Timing strip */}
                    <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block font-mono">
                          Shift Hours
                        </span>
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {s.startTime} – {s.endTime}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block font-mono">
                          Target Duty
                        </span>
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {s.expectedHours} hrs/day
                        </span>
                      </div>
                    </div>

                    {/* Employee-Specific Assignment Banner */}
                    <div className="mt-4 pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                          <Users className="w-3 h-3 text-slate-400" />
                          Assigned Employees ({assignedEmpList.length})
                        </span>
                      </div>

                      {assignedEmpList.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                          {assignedEmpList.map((emp) => (
                            <span
                              key={emp._id}
                              className="text-[10px] bg-slate-100 text-slate-800 px-2 py-0.5 rounded-md font-medium border border-slate-200 flex items-center gap-1"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              {emp.firstName} {emp.lastName}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic block">
                          No employees assigned yet. Edit shift to assign specific employees.
                        </span>
                      )}
                    </div>

                    {/* Rules List */}
                    <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                      <div className="flex items-center justify-between py-1 border-b border-slate-100">
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <Coffee className="w-3.5 h-3.5 text-slate-400" />
                          Break Deduction
                        </span>
                        <span className="font-mono font-semibold text-slate-800">{s.breakMinutes} mins</span>
                      </div>

                      <div className="flex items-center justify-between py-1 border-b border-slate-100">
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          Grace Period
                        </span>
                        <span className="font-mono font-semibold text-slate-800">
                          {s.gracePeriodMinutes} mins
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer Actions */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active Roster Policy
                    </span>

                    {canManageShifts ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleOpenEditModal(s)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition cursor-pointer"
                        >
                          <Edit2 className="w-3 h-3 text-slate-500" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => setEndConfirmShift(s)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[11px] font-semibold transition cursor-pointer"
                        >
                          <PowerOff className="w-3 h-3 text-amber-600" />
                          <span>End Shift</span>
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-[10px] font-mono">View Only</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : activeMainTab === 'ROSTER' ? (
        /* TAB 2: EMPLOYEE SHIFT ALLOCATION ROSTER */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Employee Shift Allocation Roster</h3>
              <p className="text-xs text-slate-500">
                View and reassign work shifts specifically per employee. Changes are saved immediately.
              </p>
            </div>
            <span className="text-xs font-bold text-slate-700 bg-white px-3 py-1 rounded-lg border border-slate-200">
              {filteredEmployeesForRoster.length} Employees
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Designation</th>
                  <th className="py-3 px-4">Current Assigned Shift</th>
                  <th className="py-3 px-4 text-right">Action / Shift Reassignment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredEmployeesForRoster.map((emp) => {
                  const matchingActiveShift = activeShifts.find(
                    (s) => emp.shift && emp.shift.toLowerCase().includes(s.name.toLowerCase())
                  );

                  return (
                    <tr key={emp._id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">
                          {emp.firstName} {emp.lastName}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">{emp.employeeCode}</div>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700">{emp.department}</td>
                      <td className="py-3 px-4 text-slate-600">{emp.designation}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-mono text-[11px] font-semibold border border-slate-200">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {emp.shift || 'Standard General (09:00 - 18:00)'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {canManageShifts ? (
                          <select
                            value={
                              matchingActiveShift
                                ? `${matchingActiveShift.name} (${matchingActiveShift.startTime} - ${matchingActiveShift.endTime})`
                                : emp.shift || ''
                            }
                            onChange={(e) => handleQuickEmployeeShiftChange(emp._id, e.target.value)}
                            className="p-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:ring-1 focus:ring-slate-900 focus:outline-none"
                          >
                            {activeShifts.map((s) => (
                              <option key={s._id} value={`${s.name} (${s.startTime} - ${s.endTime})`}>
                                {s.name} ({s.startTime} - {s.endTime})
                              </option>
                            ))}
                            {!activeShifts.some(
                              (s) =>
                                `${s.name} (${s.startTime} - ${s.endTime})` === emp.shift ||
                                s.name === emp.shift
                            ) && <option value={emp.shift}>{emp.shift}</option>}
                          </select>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-mono">Assigned</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* TAB 3: SHIFT HISTORY / ENDED SHIFTS */
        filteredEndedShifts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
            <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No Shift History Found</p>
            <p className="text-xs text-slate-400 mt-1">
              Ended shifts will appear here automatically and remain stored as permanent historical records.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">Shift History & Terminated Policies</h3>
              <p className="text-xs text-slate-500">
                All ended work shifts are preserved here for compliance, audit logs, and attendance history tracking.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200 text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Shift Code & Name</th>
                    <th className="py-3 px-4">Shift Hours</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Ended At</th>
                    <th className="py-3 px-4">Ended By</th>
                    <th className="py-3 px-4">End Reason</th>
                    <th className="py-3 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredEndedShifts.map((s) => (
                    <tr key={s._id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 uppercase mr-2">
                          {s.code}
                        </span>
                        {s.name}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-700">
                        {s.startTime} – {s.endTime} ({s.expectedHours}h)
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                            s.isNightShift
                              ? 'bg-purple-50 text-purple-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {s.isNightShift ? 'Night' : 'Day'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">
                        {s.endedAt ? new Date(s.endedAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-700">{s.endedBy || 'Admin'}</td>
                      <td className="py-3.5 px-4 text-slate-600 italic">{s.endReason || 'Policy Ended'}</td>
                      <td className="py-3.5 px-4 text-right">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 uppercase font-mono">
                          <PowerOff className="w-3 h-3 text-amber-600" />
                          Ended / History
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Create / Edit Shift Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingShift ? 'Edit Work Shift Schedule' : 'Configure New Work Shift'}
                </h3>
                <p className="text-xs text-slate-500">
                  Establish shift parameters and assign specific employees to this roster schedule.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shift Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Afternoon Support Shift"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shift Code *</label>
                  <input
                    type="text"
                    placeholder="e.g. AFT-03"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono uppercase text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Start Time (24h) *</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">End Time (24h) *</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Expected Hours</label>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={formData.expectedHours}
                    onChange={(e) =>
                      setFormData({ ...formData, expectedHours: Number(e.target.value) })
                    }
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Break (Mins)</label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    value={formData.breakMinutes}
                    onChange={(e) =>
                      setFormData({ ...formData, breakMinutes: Number(e.target.value) })
                    }
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Grace (Mins)</label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={formData.gracePeriodMinutes}
                    onChange={(e) =>
                      setFormData({ ...formData, gracePeriodMinutes: Number(e.target.value) })
                    }
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>
              </div>

              {/* Employee-Specific Assignment Section */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-[#039583]" />
                    Assign Specific Employees ({formData.assignedEmployeeIds.length} Selected)
                  </label>
                  <span className="text-[10px] text-slate-400">Employee Specific Assignment</span>
                </div>

                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {employees.map((emp) => {
                    const isSelected = formData.assignedEmployeeIds.includes(emp._id);
                    return (
                      <label
                        key={emp._id}
                        className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition ${
                          isSelected
                            ? 'bg-emerald-50/70 border-emerald-300 text-slate-900'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleEmpSelection(emp._id)}
                            className="rounded text-slate-900 focus:ring-slate-900 cursor-pointer"
                          />
                          <div>
                            <span className="font-bold">
                              {emp.firstName} {emp.lastName}
                            </span>
                            <span className="text-[10px] text-slate-400 ml-2 font-mono">
                              ({emp.employeeCode} · {emp.department})
                            </span>
                          </div>
                        </div>

                        <span className="text-[10px] text-slate-500 font-mono">
                          Current: {emp.shift || 'Default'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Night Shift Checkbox */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="nightShift"
                    checked={formData.isNightShift}
                    onChange={(e) => setFormData({ ...formData, isNightShift: e.target.checked })}
                    className="rounded text-slate-900 focus:ring-slate-900 cursor-pointer"
                  />
                  <label htmlFor="nightShift" className="font-semibold text-slate-700 cursor-pointer">
                    Classify as Night / Overnight Shift (crosses midnight)
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {editingShift ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Update Work Shift Policy
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Save & Assign Work Shift
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* End Shift Confirmation Modal (Replacing Delete Modal) */}
      {endConfirmShift && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
              <PowerOff className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">End Work Shift Schedule?</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Ending <strong className="text-slate-900">{endConfirmShift.name}</strong> ({endConfirmShift.code}) will set its status to <strong>ENDED</strong> and move it into <strong>Shift History</strong>.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <label className="block font-semibold text-slate-700">Reason for Ending Shift</label>
              <input
                type="text"
                placeholder="e.g. Annual schedule restructuring, shift deprecated"
                value={endReason}
                onChange={(e) => setEndReason(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-800">
              <strong>Note:</strong> Shift details will be preserved in Shift History for audit logs and historical attendance records.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setEndConfirmShift(null);
                  setEndReason('');
                }}
                disabled={isEnding}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndShiftConfirm}
                disabled={isEnding}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <PowerOff className="w-3.5 h-3.5" />
                {isEnding ? 'Ending Shift...' : 'End Shift & Store in History'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};