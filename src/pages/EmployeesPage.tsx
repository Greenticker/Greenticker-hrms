import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Employee, Department, Designation, Location } from '../types/employee';
import { employeeService } from '../services/employeeService';
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
} from 'lucide-react';

interface EmployeesPageProps {
  onSelectEmployee: (employeeId: string) => void;
}

export const EmployeesPage: React.FC<EmployeesPageProps> = ({ onSelectEmployee }) => {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // Modal State for Add Employee
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newHireNotice, setNewHireNotice] = useState<{ name: string; email: string } | null>(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    workEmail: '',
    personalEmail: '',
    phone: '',
    department: 'Engineering & Technology',
    designation: 'Senior Frontend Engineer',
    reportingManagerId: '',
    joiningDate: new Date().toISOString().split('T')[0],
    employmentType: 'FULL_TIME' as const,
    shift: 'Standard General (09:00 - 18:00)',
    location: 'Bengaluru HQ (Prestige Tech Park)',
    annualSalary: 1200000,
  });

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const [empRes, deptRes, desigRes, locRes] = await Promise.all([
        employeeService.getEmployees({
          search,
          department: selectedDept,
          status: selectedStatus,
        }),
        employeeService.getDepartments(),
        employeeService.getDesignations(),
        employeeService.getLocations(),
      ]);
      setEmployees(empRes.employees);
      setDepartments(deptRes.departments);
      setDesignations(desigRes.designations);
      setLocations(locRes.locations);
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
      });
      setFormData({
        firstName: '',
        lastName: '',
        workEmail: '',
        personalEmail: '',
        phone: '',
        department: departments[0]?.name || 'Engineering & Technology',
        designation: designations[0]?.title || 'Associate',
        reportingManagerId: '',
        joiningDate: new Date().toISOString().split('T')[0],
        employmentType: 'FULL_TIME',
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Active
          </span>
        );
      case 'PROBATION':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Probation
          </span>
        );
      case 'ON_LEAVE':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            On Leave
          </span>
        );
      case 'TERMINATED':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Deactivated
          </span>
        );
      default:
        return <span className="text-xs text-slate-500">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Role-scoped actions */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {false ? 'My Team Directory' : 'Employees Management'}
          </h1>
        </div>

        {/* Admin and HR: Add Employee Button */}
        {(user?.role === 'ADMIN') && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs whitespace-nowrap border border-[#039583]"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Employee</span>
          </button>
        )}
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
              <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">Login ID (Work Email)</span>
              <p className="font-mono font-bold text-slate-900 select-all">{newHireNotice.email}</p>
            </div>
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
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-semibold">Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PROBATION">Probation</option>
              <option value="ON_LEAVE">On Leave</option>
              <option value="TERMINATED">Deactivated</option>
            </select>
          </div>

          <span className="text-xs text-slate-400 font-mono tabular-nums ml-auto md:ml-2">
            {employees.length} {employees.length === 1 ? 'employee' : 'employees'}
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
        ) : employees.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-800">No employees found</h3>
            <p className="text-xs text-slate-500 mt-1">
              Try adjusting your search criteria or role filters.
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
                {employees.map((emp) => (
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
                      <div className="text-[11px] text-slate-500">{emp.department}</div>
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

                    <td className="py-3.5 px-4">{getStatusBadge(emp.status)}</td>

                    <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onSelectEmployee(emp._id)}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                        >
                          View Profile
                        </button>

                        {user?.role === 'ADMIN' && (
                          <button
                            onClick={() => handleDeactivate(emp._id, emp.status)}
                            className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                              emp.status === 'ACTIVE'
                                ? 'text-rose-600 hover:bg-rose-50'
                                : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                          >
                            {emp.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </button>
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
                <h3 className="text-sm font-bold text-slate-900">Provision New Employee Profile</h3>
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
                    placeholder="rohan.verma@anusyuti.com"
                  />
                </div>
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Department *</label>
                  <select
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    {departments.map((d) => (
                      <option key={d._id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Designation *</label>
                  <select
                    value={formData.designation}
                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    {designations.map((d) => (
                      <option key={d._id} value={d.title}>
                        {d.title} ({d.level})
                      </option>
                    ))}
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
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    {locations.map((loc) => (
                      <option key={loc._id} value={loc.name}>
                        {loc.name} ({loc.country})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Annual Salary (₹ INR)</label>
                <input
                  type="number"
                  value={formData.annualSalary}
                  onChange={(e) => setFormData({ ...formData, annualSalary: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums"
                />
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
                  {isSubmitting ? 'Provisioning...' : 'Provision Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
