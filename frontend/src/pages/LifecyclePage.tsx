import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { lifecycleService } from '../services/lifecycleService';
import { employeeService } from '../services/employeeService';
import { LifecycleEvent, LifecycleEventType } from '../types/lifecycle';
import { Employee, Department, Designation } from '../types/employee';
import {
  GitBranch,
  Search,
  Filter,
  Plus,
  ArrowRight,
  TrendingUp,
  Briefcase,
  CheckCircle2,
  Calendar,
  Building,
  UserCheck,
  ShieldCheck,
  X,
  FileCheck,
  Award,
  Sparkles,
  Zap,
  Users,
  CheckSquare,
  Square,
} from 'lucide-react';

export const LifecyclePage: React.FC = () => {
  const { user } = useAuth();
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');

  // Initiate Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    employeeId: '',
    eventType: 'PROMOTION' as LifecycleEventType,
    effectiveDate: new Date().toISOString().split('T')[0],
    previousValue: '',
    newValue: '',
    reason: '',
    notes: '',
  });

  const [designations, setDesignations] = useState<Designation[]>([]);

  // Bulk Action Modal State
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkType, setBulkType] = useState<'TRANSFER' | 'PROMOTION' | 'INCREMENT'>('TRANSFER');
  const [selectedBulkEmpIds, setSelectedBulkEmpIds] = useState<string[]>([]);
  const [bulkDept, setBulkDept] = useState('');
  const [bulkSubdept, setBulkSubdept] = useState('');
  const [bulkDesignation, setBulkDesignation] = useState('');
  const [bulkIncrementType, setBulkIncrementType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [bulkIncrementVal, setBulkIncrementVal] = useState<number>(10);
  const [bulkEffectiveDate, setBulkEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkNotes, setBulkNotes] = useState('');
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [bulkFilterDept, setBulkFilterDept] = useState('ALL');

  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [eventsRes, empsRes, deptsRes, desigsRes] = await Promise.all([
        lifecycleService.getEvents({ eventType: selectedType }),
        employeeService.getEmployees(),
        employeeService.getDepartments(),
        employeeService.getDesignations(),
      ]);
      setEvents(eventsRes.events);
      setEmployees(empsRes.employees);
      setDepartments(deptsRes.departments);
      setDesignations(desigsRes.designations);
      if (empsRes.employees.length > 0 && !formData.employeeId) {
        setFormData((prev) => ({
          ...prev,
          employeeId: empsRes.employees[0]._id,
          previousValue: empsRes.employees[0].designation,
        }));
      }
      if (deptsRes.departments.length > 0 && !bulkDept) {
        setBulkDept(deptsRes.departments[0].name);
      }
      if (desigsRes.designations.length > 0 && !bulkDesignation) {
        setBulkDesignation(desigsRes.designations[0].title);
      }
    } catch (err) {
      console.error('Failed to load lifecycle events:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBulkEmpIds.length === 0 || !bulkReason.trim()) return;

    setIsBulkSubmitting(true);
    let successCount = 0;

    try {
      for (const empId of selectedBulkEmpIds) {
        const emp = employees.find((e) => e._id === empId);
        if (!emp) continue;

        let eventType: LifecycleEventType = 'TRANSFER';
        let prevVal = '';
        let newVal = '';

        if (bulkType === 'TRANSFER') {
          eventType = 'TRANSFER';
          prevVal = emp.department + (emp.subdepartment ? ` (${emp.subdepartment})` : '');
          newVal = bulkDept + (bulkSubdept ? ` (${bulkSubdept})` : '');
        } else if (bulkType === 'PROMOTION') {
          eventType = 'PROMOTION';
          prevVal = emp.designation;
          newVal = bulkDesignation;
        } else if (bulkType === 'INCREMENT') {
          eventType = 'SALARY_REVISION';
          const oldSal = emp.annualSalary || 1200000;
          let newSal = oldSal;
          if (bulkIncrementType === 'PERCENT') {
            newSal = Math.round(oldSal * (1 + Number(bulkIncrementVal) / 100));
          } else {
            newSal = oldSal + Number(bulkIncrementVal);
          }
          prevVal = `₹${oldSal.toLocaleString()}`;
          newVal = `₹${newSal.toLocaleString()}`;
        }

        const res = await lifecycleService.createEvent({
          employeeId: empId,
          eventType,
          effectiveDate: bulkEffectiveDate,
          previousValue: prevVal,
          newValue: newVal,
          reason: bulkReason,
          notes: bulkNotes,
        });

        if (res.success) successCount++;
      }

      setFeedbackMsg(`Bulk lifecycle action completed for ${successCount} employee(s)!`);
      setIsBulkModalOpen(false);
      setSelectedBulkEmpIds([]);
      setBulkReason('');
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Error executing bulk lifecycle action');
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedType]);

  const handleEmployeeChange = (empId: string) => {
    const selectedEmp = employees.find((e) => e._id === empId);
    let prevVal = '';
    if (selectedEmp) {
      if (formData.eventType === 'PROMOTION' || formData.eventType === 'DESIGNATION_CHANGE') {
        prevVal = selectedEmp.designation;
      } else if (formData.eventType === 'TRANSFER') {
        prevVal = selectedEmp.department;
      } else if (formData.eventType === 'SALARY_REVISION') {
        prevVal = selectedEmp.annualSalary ? `₹${selectedEmp.annualSalary.toLocaleString()}` : '₹1,200,000';
      } else if (formData.eventType === 'STATUS_CHANGE' || formData.eventType === 'CONFIRMATION') {
        prevVal = selectedEmp.status;
      }
    }

    setFormData((prev) => ({
      ...prev,
      employeeId: empId,
      previousValue: prevVal,
    }));
  };

  const handleEventTypeChange = (type: LifecycleEventType) => {
    const selectedEmp = employees.find((e) => e._id === formData.employeeId);
    let prevVal = '';
    if (selectedEmp) {
      if (type === 'PROMOTION' || type === 'DESIGNATION_CHANGE') {
        prevVal = selectedEmp.designation;
      } else if (type === 'TRANSFER') {
        prevVal = selectedEmp.department;
      } else if (type === 'SALARY_REVISION') {
        prevVal = selectedEmp.annualSalary ? `₹${selectedEmp.annualSalary.toLocaleString()}` : '₹1,200,000';
      } else if (type === 'STATUS_CHANGE' || type === 'CONFIRMATION') {
        prevVal = selectedEmp.status;
      }
    }

    setFormData((prev) => ({
      ...prev,
      eventType: type,
      previousValue: prevVal,
      newValue: type === 'CONFIRMATION' ? 'ACTIVE' : '',
    }));
  };

  const handleInitiateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.employeeId || !formData.newValue.trim() || !formData.reason.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await lifecycleService.createEvent({
        employeeId: formData.employeeId,
        eventType: formData.eventType,
        effectiveDate: formData.effectiveDate,
        previousValue: formData.previousValue,
        newValue: formData.newValue,
        reason: formData.reason,
        notes: formData.notes,
      });

      if (res.success) {
        setFeedbackMsg(`Career milestone (${res.event.eventType}) recorded and employee record updated!`);
        setIsModalOpen(false);
        setFormData({
          employeeId: employees[0]?._id || '',
          eventType: 'PROMOTION',
          effectiveDate: new Date().toISOString().split('T')[0],
          previousValue: '',
          newValue: '',
          reason: '',
          notes: '',
        });
        await fetchData();
        setTimeout(() => setFeedbackMsg(null), 4000);
      }
    } catch (err) {
      console.error('Failed to initiate lifecycle event:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredEvents = events.filter((ev) => {
    const q = search.toLowerCase();
    return (
      ev.employeeName.toLowerCase().includes(q) ||
      ev.employeeCode.toLowerCase().includes(q) ||
      ev.department.toLowerCase().includes(q) ||
      ev.newValue.toLowerCase().includes(q) ||
      ev.reason.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Employee Lifecycle
          </h1>
        </div>

        {(user?.role === 'ADMIN' || user?.role === 'HR') && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => {
                setIsBulkModalOpen(true);
                if (employees.length > 0 && selectedBulkEmpIds.length === 0) {
                  setSelectedBulkEmpIds(employees.map((e) => e._id));
                }
              }}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-xs cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              <span>Bulk Action (Transfer / Promotion / Increment)</span>
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2.5 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition shadow-xs border border-[#039583] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Single Action</span>
            </button>
          </div>
        )}
      </div>

      {feedbackMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{feedbackMsg}</span>
          </div>
          <button onClick={() => setFeedbackMsg(null)}>
            <X className="w-4 h-4 text-emerald-600" />
          </button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Total Workforce
          </span>
          <p className="text-2xl font-bold text-slate-900 font-mono mt-1">{employees.length}</p>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Active headcount</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-xs">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Promotions Tracked
          </span>
          <p className="text-2xl font-bold text-emerald-700 font-mono mt-1">
            {events.filter((e) => e.eventType === 'PROMOTION').length}
          </p>
          <span className="text-[10px] text-emerald-600 mt-0.5 block">Quarterly elevations</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-blue-200 bg-blue-50/20 shadow-xs">
          <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider flex items-center gap-1">
            <Building className="w-3 h-3" /> Dept Transfers
          </span>
          <p className="text-2xl font-bold text-blue-700 font-mono mt-1">
            {events.filter((e) => e.eventType === 'TRANSFER').length}
          </p>
          <span className="text-[10px] text-blue-600 mt-0.5 block">Internal mobility</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-purple-200 bg-purple-50/20 shadow-xs">
          <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider flex items-center gap-1">
            <UserCheck className="w-3 h-3" /> Confirmations
          </span>
          <p className="text-2xl font-bold text-purple-700 font-mono mt-1">
            {events.filter((e) => e.eventType === 'CONFIRMATION').length}
          </p>
          <span className="text-[10px] text-purple-600 mt-0.5 block">Probation cleared</span>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 text-xs">
          {[
            { id: 'ALL', label: 'All Milestones' },
            { id: 'PROMOTION', label: 'Promotions' },
            { id: 'TRANSFER', label: 'Transfers' },
            { id: 'DESIGNATION_CHANGE', label: 'Designations' },
            { id: 'SALARY_REVISION', label: 'Salary Band' },
            { id: 'CONFIRMATION', label: 'Confirmations' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedType(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition ${
                selectedType === tab.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search employee, new title, reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
          />
        </div>
      </div>

      {/* Lifecycle Timeline */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500 font-mono">
            Loading career milestones...
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-12 text-center">
            <GitBranch className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No Lifecycle Events Found</p>
            <p className="text-xs text-slate-400 mt-1">
              There are no career transition records matching the selected parameters.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredEvents.map((ev) => (
              <div key={ev._id} className="p-5 hover:bg-slate-50/70 transition space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono border ${
                        ev.eventType === 'PROMOTION'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : ev.eventType === 'TRANSFER'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : ev.eventType === 'CONFIRMATION'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {ev.eventType.replace('_', ' ')}
                    </span>
                    <h3 className="text-sm font-bold text-slate-900">{ev.employeeName}</h3>
                    <span className="text-xs text-slate-400 font-mono font-medium">
                      ({ev.employeeCode})
                    </span>
                    <span className="text-slate-300 hidden sm:inline">·</span>
                    <span className="text-xs text-slate-500 hidden sm:inline">{ev.department}</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Effective: {ev.effectiveDate}</span>
                  </div>
                </div>

                {/* Transition Diff Box */}
                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Previous Baseline
                      </span>
                      <span className="font-medium text-slate-700">{ev.previousValue}</span>
                    </div>

                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />

                    <div className="bg-white px-3 py-1.5 rounded-lg border border-slate-900/20 text-slate-900 font-semibold shadow-2xs">
                      <span className="text-[10px] uppercase font-bold text-blue-600 block">
                        New Approved Value
                      </span>
                      <span className="font-bold">{ev.newValue}</span>
                    </div>
                  </div>

                  <div className="text-right text-[11px] text-slate-500">
                    <span>Authorized by </span>
                    <span className="font-semibold text-slate-700">{ev.initiatedBy}</span>
                  </div>
                </div>

                {/* Justification */}
                <p className="text-xs text-slate-600 pl-1">
                  <span className="font-semibold text-slate-800">Business Justification: </span>
                  {ev.reason}
                </p>

                {ev.notes && (
                  <p className="text-[11px] text-slate-400 italic pl-1">
                    Notes: {ev.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Initiate Lifecycle Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Initiate Lifecycle Milestone</h3>
                <p className="text-xs text-slate-500">
                  Update employee designation, department transfer, or probation confirmation.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleInitiateSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Target Employee *</label>
                <select
                  value={formData.employeeId}
                  onChange={(e) => handleEmployeeChange(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                >
                  {employees.map((emp) => (
                    <option key={emp._id} value={emp._id}>
                      {emp.firstName} {emp.lastName} ({emp.employeeCode} - {emp.designation})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Lifecycle Action Type *</label>
                  <select
                    value={formData.eventType}
                    onChange={(e) => handleEventTypeChange(e.target.value as LifecycleEventType)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  >
                    <option value="PROMOTION">Promotion</option>
                    <option value="TRANSFER">Department Transfer</option>
                    <option value="DESIGNATION_CHANGE">Designation Change</option>
                    <option value="CONFIRMATION">Probation Confirmation</option>
                    <option value="SALARY_REVISION">Salary Revision</option>
                    <option value="STATUS_CHANGE">Status Change</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Effective Date *</label>
                  <input
                    type="date"
                    value={formData.effectiveDate}
                    onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Previous Baseline</label>
                  <input
                    type="text"
                    value={formData.previousValue}
                    onChange={(e) => setFormData({ ...formData, previousValue: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-600 focus:outline-none"
                    placeholder="Auto-populated"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {formData.eventType === 'TRANSFER'
                      ? 'New Department *'
                      : formData.eventType === 'CONFIRMATION'
                      ? 'Confirmation Status *'
                      : 'New Approved Value *'}
                  </label>
                  {formData.eventType === 'TRANSFER' ? (
                    <select
                      value={formData.newValue}
                      onChange={(e) => setFormData({ ...formData, newValue: e.target.value })}
                      required
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
                    >
                      <option value="">Select target department...</option>
                      {departments.map((d) => (
                        <option key={d._id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder={
                        formData.eventType === 'PROMOTION'
                          ? 'e.g. Lead Systems Architect (₹1,750,000)'
                          : formData.eventType === 'SALARY_REVISION'
                          ? 'e.g. ₹1,600,000 Annual CTC'
                          : 'Enter new title or value...'
                      }
                      value={formData.newValue}
                      onChange={(e) => setFormData({ ...formData, newValue: e.target.value })}
                      required
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Justification Reason *</label>
                <textarea
                  rows={2}
                  placeholder="State business reason, performance review notes, or committee approval..."
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  required
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Internal Reference / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Executive Board Resolution #412"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Apply & Record Milestone
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Bulk Action Modal */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-amber-50/50">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Execute Bulk Lifecycle Action
                </h3>
              </div>
              <button
                onClick={() => setIsBulkModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleBulkSubmit} className="p-6 space-y-5">
              {/* Action Type Selector Tabs */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Bulk Lifecycle Operation *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkType('TRANSFER')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      bulkType === 'TRANSFER'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Building className="w-4 h-4" />
                    <span>Bulk Transfer</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBulkType('PROMOTION')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      bulkType === 'PROMOTION'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <TrendingUp className="w-4 h-4" />
                    <span>Bulk Promotion</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBulkType('INCREMENT')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      bulkType === 'INCREMENT'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Bulk Salary Increment</span>
                  </button>
                </div>
              </div>

              {/* Action Specific Fields */}
              {bulkType === 'TRANSFER' && (
                <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Target Department *</label>
                    <select
                      value={bulkDept}
                      onChange={(e) => setBulkDept(e.target.value)}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                    >
                      {departments.map((d) => (
                        <option key={d._id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Sub-Department (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Cloud Infra, Core Platform"
                      value={bulkSubdept}
                      onChange={(e) => setBulkSubdept(e.target.value)}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                </div>
              )}

              {bulkType === 'PROMOTION' && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">New Target Designation *</label>
                  <select
                    value={bulkDesignation}
                    onChange={(e) => setBulkDesignation(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                  >
                    {designations.map((d) => (
                      <option key={d._id} value={d.title}>
                        {d.title} ({d.level})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {bulkType === 'INCREMENT' && (
                <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Increment Mode</label>
                    <select
                      value={bulkIncrementType}
                      onChange={(e) => setBulkIncrementType(e.target.value as any)}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                    >
                      <option value="PERCENT">Percentage Increase (%)</option>
                      <option value="FIXED">Fixed Amount Increase (₹)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {bulkIncrementType === 'PERCENT' ? 'Percentage Hike (%)' : 'Fixed Increment Amount (₹)'}
                    </label>
                    <input
                      type="number"
                      value={bulkIncrementVal}
                      onChange={(e) => setBulkIncrementVal(Number(e.target.value))}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                      placeholder={bulkIncrementType === 'PERCENT' ? '12' : '100000'}
                    />
                  </div>
                </div>
              )}

              {/* Employee Selection Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-500" />
                    <span>Select Target Employees ({selectedBulkEmpIds.length} / {employees.length} selected)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={bulkFilterDept}
                      onChange={(e) => setBulkFilterDept(e.target.value)}
                      className="text-[11px] bg-slate-100 border border-slate-200 rounded px-2 py-0.5"
                    >
                      <option value="ALL">All Departments</option>
                      {departments.map((d) => (
                        <option key={d._id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const filtered = bulkFilterDept === 'ALL'
                          ? employees
                          : employees.filter((e) => e.department === bulkFilterDept);
                        if (selectedBulkEmpIds.length === filtered.length) {
                          setSelectedBulkEmpIds([]);
                        } else {
                          setSelectedBulkEmpIds(filtered.map((e) => e._id));
                        }
                      }}
                      className="text-[11px] text-indigo-600 font-bold hover:underline cursor-pointer"
                    >
                      {selectedBulkEmpIds.length === employees.length ? 'Deselect All' : 'Select All Filtered'}
                    </button>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white">
                  {employees
                    .filter((emp) => bulkFilterDept === 'ALL' || emp.department === bulkFilterDept)
                    .map((emp) => {
                      const isSelected = selectedBulkEmpIds.includes(emp._id);
                      const currentSal = emp.annualSalary || 1200000;
                      let newSal = currentSal;
                      if (bulkIncrementType === 'PERCENT') {
                        newSal = Math.round(currentSal * (1 + Number(bulkIncrementVal) / 100));
                      } else {
                        newSal = currentSal + Number(bulkIncrementVal);
                      }

                      return (
                        <div
                          key={emp._id}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedBulkEmpIds(selectedBulkEmpIds.filter((id) => id !== emp._id));
                            } else {
                              setSelectedBulkEmpIds([...selectedBulkEmpIds, emp._id]);
                            }
                          }}
                          className={`p-2.5 flex items-center justify-between text-xs cursor-pointer transition ${
                            isSelected ? 'bg-amber-50/50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-amber-600 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-300 shrink-0" />
                            )}
                            <div>
                              <p className="font-bold text-slate-900">
                                {emp.firstName} {emp.lastName}{' '}
                                <span className="font-mono text-[10px] text-slate-400">({emp.employeeCode})</span>
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {emp.designation} · {emp.department}
                              </p>
                            </div>
                          </div>

                          <div className="text-right font-mono text-[11px]">
                            {bulkType === 'INCREMENT' ? (
                              <div>
                                <span className="text-slate-400 line-through mr-1.5">₹{currentSal.toLocaleString()}</span>
                                <span className="text-emerald-700 font-bold">₹{newSal.toLocaleString()}</span>
                              </div>
                            ) : bulkType === 'TRANSFER' ? (
                              <span className="text-slate-600">{emp.department} → {bulkDept}</span>
                            ) : (
                              <span className="text-slate-600">{emp.designation} → {bulkDesignation}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Effective Date & Justification */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Effective Date *</label>
                  <input
                    type="date"
                    value={bulkEffectiveDate}
                    onChange={(e) => setBulkEffectiveDate(e.target.value)}
                    required
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Justification / Board Resolution *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Annual Performance Appraisal Cycle 2026"
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isBulkSubmitting || selectedBulkEmpIds.length === 0}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>
                    {isBulkSubmitting
                      ? 'Processing...'
                      : `Apply Bulk ${bulkType.toLowerCase()} (${selectedBulkEmpIds.length})`}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
