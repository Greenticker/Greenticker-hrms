import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { Department, Designation, Location, OrgTreeNode, Subdepartment } from '../types/employee';
import { employeeService } from '../services/employeeService';
import { request } from '../services/api';
import {
  Building2,
  GitFork,
  Briefcase,
  MapPin,
  Plus,
  Users,
  ChevronRight,
  Shield,
  X,
  Layers,
  Search,
} from 'lucide-react';

export const OrganizationPage: React.FC = () => {
  const { user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subdepartments, setSubdepartments] = useState<Subdepartment[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [hierarchy, setHierarchy] = useState<OrgTreeNode | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [subTab, setSubTab] = useState<
    'hierarchy' | 'departments' | 'subdepartments' | 'designations' | 'locations' | 'managers'
  >('hierarchy');

  // Managers Directory state
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});
  const [contactManagerModal, setContactManagerModal] = useState<OrgTreeNode | null>(null);
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [isSendingContact, setIsSendingContact] = useState(false);
  const [contactFeedback, setContactFeedback] = useState<string | null>(null);

  const getAllManagers = (node: OrgTreeNode | null): OrgTreeNode[] => {
    if (!node) return [];
    let list: OrgTreeNode[] = [];
    if (node.reports && node.reports.length > 0) {
      list.push(node);
      for (const child of node.reports) {
        list = list.concat(getAllManagers(child));
      }
    }
    return list;
  };

  const managersList = useMemo(() => getAllManagers(hierarchy), [hierarchy]);

  const handleSendManagerContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactManagerModal || !contactMessage.trim()) return;
    setIsSendingContact(true);
    setContactFeedback(null);
    try {
      const res = await request<{ success: boolean; message: string }>('/organization/contact-manager', {
        method: 'POST',
        body: JSON.stringify({
          managerEmail: `${contactManagerModal.name.toLowerCase().replace(/\s+/g, '.')}@vetan.ai`,
          managerName: contactManagerModal.name,
          subject: contactSubject || `Inquiry regarding vetan.ai HRMS`,
          message: contactMessage,
        }),
      });
      setContactFeedback(res.message || 'Message sent successfully!');
      setTimeout(() => {
        setContactManagerModal(null);
        setContactSubject('');
        setContactMessage('');
        setContactFeedback(null);
      }, 2000);
    } catch (err: any) {
      setContactFeedback(err.message || 'Failed to send message.');
    } finally {
      setIsSendingContact(false);
    }
  };

  // Add Department Modal
  const [isAddDeptOpen, setIsAddDeptOpen] = useState(false);
  const [deptForm, setDeptForm] = useState({ name: '', code: '', description: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Add Sub-Department Modal
  const [isAddSubdeptOpen, setIsAddSubdeptOpen] = useState(false);
  const [subdeptForm, setSubdeptForm] = useState({
    name: '',
    departmentName: '',
    code: '',
    description: '',
  });
  const [subdeptDeptFilter, setSubdeptDeptFilter] = useState<string>('ALL');
  const [subdeptSearch, setSubdeptSearch] = useState<string>('');

  const handleCreateSubdept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subdeptForm.name.trim()) return;
    const deptName =
      subdeptForm.departmentName ||
      (departments.length > 0 ? departments[0].name : 'Engineering & Technology');
    setIsSubmitting(true);
    try {
      await employeeService.createSubdepartment({
        name: subdeptForm.name.trim(),
        departmentName: deptName,
        code: subdeptForm.code.trim() || undefined,
        description: subdeptForm.description.trim() || undefined,
      });
      setIsAddSubdeptOpen(false);
      setSubdeptForm({ name: '', departmentName: '', code: '', description: '' });
      await fetchOrgData();
    } catch (err: any) {
      alert(err.message || 'Error creating sub-department');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add Designation Modal
  const [isAddDesignationOpen, setIsAddDesignationOpen] = useState(false);
  const [desigForm, setDesigForm] = useState({ title: '', code: '', level: 'L2', department: '', subdepartment: '', description: '' });

  const handleCreateDesignation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desigForm.title.trim()) return;
    setIsSubmitting(true);
    try {
      await employeeService.createDesignation(desigForm);
      setIsAddDesignationOpen(false);
      setDesigForm({ title: '', code: '', level: 'L2', department: '', subdepartment: '', description: '' });
      await fetchOrgData();
    } catch (err: any) {
      alert(err.message || 'Error creating designation');
    } finally {
      setIsSubmitting(false);
    }
  };

  // End Designation Modal
  const [desigView, setDesigView] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');
  const [endDesigModal, setEndDesigModal] = useState<Designation | null>(null);
  const [endReason, setEndReason] = useState('');
  const [isEnding, setIsEnding] = useState(false);

  const handleEndDesignation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!endDesigModal) return;
    setIsEnding(true);
    try {
      await employeeService.endDesignation(endDesigModal._id, endReason);
      setEndDesigModal(null);
      setEndReason('');
      await fetchOrgData();
    } catch (err: any) {
      alert(err.message || 'Error ending designation');
    } finally {
      setIsEnding(false);
    }
  };

  // Add Location Modal
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [locForm, setLocForm] = useState({
    name: '',
    street: '',
    city: 'Pune',
    state: 'Maharashtra',
    country: 'India',
    zipCode: '411004',
    departments: [] as string[],
    subdepartments: [] as string[],
    isHeadquarters: false,
  });

  const toggleLocDepartment = (name: string) => {
    if (locForm.departments.includes(name)) {
      // Dropping a department also drops its sub-departments
      const childNames = subdepartments.filter((s) => s.departmentName === name).map((s) => s.name);
      setLocForm({
        ...locForm,
        departments: locForm.departments.filter((d) => d !== name),
        subdepartments: locForm.subdepartments.filter((s) => !childNames.includes(s)),
      });
    } else {
      setLocForm({ ...locForm, departments: [...locForm.departments, name] });
    }
  };

  const toggleLocSubdepartment = (sub: Subdepartment) => {
    if (locForm.subdepartments.includes(sub.name)) {
      setLocForm({ ...locForm, subdepartments: locForm.subdepartments.filter((s) => s !== sub.name) });
    } else {
      setLocForm({
        ...locForm,
        subdepartments: [...locForm.subdepartments, sub.name],
        departments: locForm.departments.includes(sub.departmentName)
          ? locForm.departments
          : [...locForm.departments, sub.departmentName],
      });
    }
  };

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locForm.name.trim()) return;
    setIsSubmitting(true);
    try {
      await employeeService.createLocation(locForm);
      setIsAddLocationOpen(false);
      setLocForm({
        name: '',
        street: '',
        city: 'Pune',
        state: 'Maharashtra',
        country: 'India',
        zipCode: '411004',
        departments: [],
        subdepartments: [],
        isHeadquarters: false,
      });
      await fetchOrgData();
    } catch (err: any) {
      console.error('Failed to create location', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    fetchOrgData();
  }, []);

  const fetchOrgData = async () => {
    setLoading(true);
    try {
      const [deptRes, subdeptRes, desigRes, locRes, hierRes] = await Promise.all([
        employeeService.getDepartments(),
        employeeService.getSubdepartments().catch(() => ({ subdepartments: [] })),
        employeeService.getDesignations(),
        employeeService.getLocations(),
        employeeService.getHierarchy(),
      ]);
      setDepartments(deptRes.departments);
      if (subdeptRes?.subdepartments) setSubdepartments(subdeptRes.subdepartments);
      setDesignations(desigRes.designations);
      setLocations(locRes.locations);
      setHierarchy(hierRes.hierarchy);
    } catch (err: any) {
      console.error('Failed to load org data', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptForm.name || !deptForm.code) return;
    setIsSubmitting(true);
    try {
      await employeeService.createDepartment(deptForm);
      setIsAddDeptOpen(false);
      setDeptForm({ name: '', code: '', description: '' });
      await fetchOrgData();
    } catch (err: any) {
      alert(err.message || 'Error creating department');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderTree = (node: OrgTreeNode, level: number = 0) => {
    const isThirdRowOrDeeper = level >= 2;

    return (
      <div key={node.employeeId} className="flex flex-col items-center w-full">
        {/* Node Card */}
        {isThirdRowOrDeeper ? (
          /* Row 3+ Card: Only Employee Name (all other details removed) */
          <div className="flex items-center justify-center px-3.5 py-3 rounded-xl border border-slate-200 bg-white shadow-2xs transition-all hover:shadow-md hover:border-[#039583] hover:bg-slate-50/80 w-full min-h-[46px] text-center">
            <span className="font-semibold text-xs text-slate-900 text-center leading-snug break-words">
              {node.name}
            </span>
          </div>
        ) : (
          /* Row 1 & Row 2 Card: Full details without status / 'active' badge */
          <div
            className={`flex items-center gap-3 p-3.5 rounded-xl border bg-white shadow-xs transition-all hover:shadow-md hover:border-[#039583] w-full max-w-sm ${
              level === 0
                ? 'border-indigo-300 bg-gradient-to-r from-indigo-50/80 to-white shadow-sm ring-2 ring-indigo-500/20'
                : 'border-slate-200'
            }`}
          >
            <div className="w-9 h-9 rounded-full bg-[#023b77] text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
              {node.avatarInitials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-slate-900 truncate">{node.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">({node.employeeCode})</span>
                {level === 0 && (
                  <span className="text-[9px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded font-mono uppercase tracking-wider">
                    Root
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 truncate mt-0.5">
                {node.designation} · <strong className="font-medium text-slate-700">{node.department}</strong>
              </p>
            </div>
          </div>
        )}

        {/* Children (Flowchart Branches) */}
        {node.reports && node.reports.length > 0 && (
          <div className="flex flex-col items-center w-full relative">
            {/* Vertical stem down from parent */}
            <div className="w-0.5 h-6 bg-indigo-300" />

            {/* Sub-nodes */}
            {level === 0 ? (
              /* Row 2: Direct reports of Root (Aditya, Arjun, Rajesh) */
              <div className="flex flex-row items-start justify-center gap-8 w-full pt-4 relative">
                {node.reports.map((child, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === (node.reports?.length ?? 1) - 1;
                  const isOnly = (node.reports?.length ?? 0) <= 1;

                  return (
                    <div
                      key={child.employeeId}
                      className={`flex flex-col items-center relative ${
                        child.reports && child.reports.length > 0
                          ? 'flex-1 min-w-[340px] max-w-5xl'
                          : 'w-72 shrink-0'
                      }`}
                    >
                      {/* Flowchart horizontal connector rail */}
                      {!isOnly && (
                        <>
                          {!isFirst && <div className="absolute top-0 left-0 w-1/2 h-0.5 bg-indigo-300" />}
                          {!isLast && <div className="absolute top-0 right-0 w-1/2 h-0.5 bg-indigo-300" />}
                          <div className="w-2 h-2 rounded-full bg-indigo-400 absolute top-0 -mt-[3px] left-1/2 -ml-1 z-10" />
                        </>
                      )}
                      {/* Flowchart vertical stem into child card */}
                      <div className="w-0.5 h-5 bg-indigo-300" />
                      {renderTree(child, level + 1)}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Row 3+: Direct reports of Row 2 managers - Flowchart branched columns with connecting lines */
              (() => {
                const reports = node.reports || [];
                const numCols = reports.length > 8 ? 4 : reports.length > 4 ? 3 : reports.length > 1 ? 2 : 1;
                const columns: OrgTreeNode[][] = Array.from({ length: numCols }, () => []);
                reports.forEach((child, i) => {
                  columns[i % numCols].push(child);
                });

                return (
                  <div className="flex flex-row items-start justify-center gap-4 w-full pt-4 relative max-w-5xl">
                    {columns.map((col, colIdx) => {
                      const isFirst = colIdx === 0;
                      const isLast = colIdx === columns.length - 1;
                      const isOnly = columns.length <= 1;

                      return (
                        <div
                          key={colIdx}
                          className="flex flex-col items-center relative flex-1 min-w-[170px] max-w-[240px]"
                        >
                          {/* Flowchart horizontal distribution rail */}
                          {!isOnly && (
                            <>
                              {!isFirst && <div className="absolute top-0 left-0 w-1/2 h-0.5 bg-indigo-300" />}
                              {!isLast && <div className="absolute top-0 right-0 w-1/2 h-0.5 bg-indigo-300" />}
                              <div className="w-2 h-2 rounded-full bg-indigo-400 absolute top-0 -mt-[3px] left-1/2 -ml-1 z-10" />
                            </>
                          )}
                          {/* Flowchart vertical stem down into column */}
                          <div className="w-0.5 h-4 bg-indigo-300" />

                          {/* Stacked employee name cards in this branch, connected by vertical flowchart lines */}
                          <div className="flex flex-col items-center w-full">
                            {col.map((emp, empIdx) => (
                              <React.Fragment key={emp.employeeId}>
                                {empIdx > 0 && <div className="w-0.5 h-3 bg-indigo-300 shrink-0" />}
                                <div className="flex items-center justify-center px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-2xs transition-all hover:shadow-md hover:border-[#039583] hover:bg-slate-50 w-full min-h-[44px] text-center">
                                  <span className="font-semibold text-xs text-slate-900 text-center leading-snug break-words">
                                    {emp.name}
                                  </span>
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Department and Organization Structure
          </h1>
        </div>

        {user?.role === 'ADMIN' && subTab === 'departments' && (
          <button
            onClick={() => setIsAddDeptOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs border border-[#039583]"
          >
            <Plus className="w-4 h-4" />
            <span>Add Department</span>
          </button>
        )}

        {user?.role === 'ADMIN' && subTab === 'subdepartments' && (
          <button
            onClick={() => setIsAddSubdeptOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs border border-[#039583]"
          >
            <Plus className="w-4 h-4" />
            <span>Add Sub-Department</span>
          </button>
        )}

        {user?.role === 'ADMIN' && subTab === 'designations' && (
          <button
            onClick={() => setIsAddDesignationOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs border border-[#039583]"
          >
            <Plus className="w-4 h-4" />
            <span>Add Designation</span>
          </button>
        )}

        {user?.role === 'ADMIN' && subTab === 'locations' && (
          <button
            onClick={() => setIsAddLocationOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs border border-[#039583]"
          >
            <Plus className="w-4 h-4" />
            <span>Add Office Location</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-xs flex items-center gap-1 overflow-x-auto">
        <button
          onClick={() => setSubTab('hierarchy')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            subTab === 'hierarchy' ? 'bg-[#023b77] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <GitFork className="w-3.5 h-3.5" />
          <span>Reporting Hierarchy Tree</span>
        </button>
        <button
          onClick={() => setSubTab('departments')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            subTab === 'departments' ? 'bg-[#023b77] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>Departments ({departments.length})</span>
        </button>
        <button
          onClick={() => setSubTab('subdepartments')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            subTab === 'subdepartments' ? 'bg-[#023b77] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Sub-Departments ({subdepartments.length})</span>
        </button>
        <button
          onClick={() => setSubTab('designations')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            subTab === 'designations' ? 'bg-[#023b77] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Briefcase className="w-3.5 h-3.5" />
          <span>Designations ({designations.length})</span>
        </button>
        <button
          onClick={() => setSubTab('locations')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            subTab === 'locations' ? 'bg-[#023b77] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>Locations ({locations.length})</span>
        </button>
        <button
          onClick={() => setSubTab('managers')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            subTab === 'managers' ? 'bg-[#023b77] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Managers Directory ({managersList.length})</span>
        </button>
      </div>

      {/* Tab 1: Hierarchy Tree */}
      {subTab === 'hierarchy' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Organizational Reporting Tree</h3>
              <p className="text-xs text-slate-500">Live reporting lines calculated from employee relationships</p>
            </div>
            <span className="text-[11px] font-mono text-slate-400">Top-Down Traversal</span>
          </div>

          {loading ? (
            <p className="text-xs text-slate-500 py-8 text-center">Loading hierarchy structure...</p>
          ) : hierarchy ? (
            <div className="py-4 space-y-3 w-full overflow-x-auto">
              <div className="min-w-[1020px] mx-auto pb-4">{renderTree(hierarchy)}</div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-8 text-center">No hierarchy nodes found</p>
          )}
        </div>
      )}

      {/* Tab 2: Departments */}
      {subTab === 'departments' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Department Name</th>
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Department Head</th>
                <th className="py-3 px-4">Headcount</th>
                <th className="py-3 px-4">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {departments.map((d) => (
                <tr key={d._id} className="hover:bg-slate-50/50">
                  <td className="py-3.5 px-4 font-bold text-slate-900">{d.name}</td>
                  <td className="py-3.5 px-4 font-mono text-[11px] font-semibold text-slate-600">
                    {d.code}
                  </td>
                  <td className="py-3.5 px-4 text-slate-700">{d.headName || 'Not Assigned'}</td>
                  <td className="py-3.5 px-4 font-mono tabular-nums font-semibold text-indigo-700">
                    {d.memberCount} members
                  </td>
                  <td className="py-3.5 px-4 text-slate-500 max-w-sm truncate">{d.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Sub-Departments */}
      {subTab === 'subdepartments' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search sub-departments..."
                  value={subdeptSearch}
                  onChange={(e) => setSubdeptSearch(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl w-60 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <select
                value={subdeptDeptFilter}
                onChange={(e) => setSubdeptDeptFilter(e.target.value)}
                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900 bg-white"
              >
                <option value="ALL">All Parent Departments</option>
                {departments.map((d) => (
                  <option key={d._id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-slate-500 font-mono">
              Showing{' '}
              {
                subdepartments.filter((s) => {
                  const matchDept =
                    subdeptDeptFilter === 'ALL' || s.departmentName === subdeptDeptFilter;
                  const matchQ =
                    !subdeptSearch ||
                    s.name.toLowerCase().includes(subdeptSearch.toLowerCase()) ||
                    (s.code || '').toLowerCase().includes(subdeptSearch.toLowerCase()) ||
                    s.departmentName.toLowerCase().includes(subdeptSearch.toLowerCase());
                  return matchDept && matchQ;
                }).length
              }{' '}
              sub-departments
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Sub-Department Name</th>
                  <th className="py-3 px-4">Parent Department</th>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Active Team Members</th>
                  <th className="py-3 px-4">Purpose / Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subdepartments
                  .filter((s) => {
                    const matchDept =
                      subdeptDeptFilter === 'ALL' || s.departmentName === subdeptDeptFilter;
                    const matchQ =
                      !subdeptSearch ||
                      s.name.toLowerCase().includes(subdeptSearch.toLowerCase()) ||
                      (s.code || '').toLowerCase().includes(subdeptSearch.toLowerCase()) ||
                      s.departmentName.toLowerCase().includes(subdeptSearch.toLowerCase());
                    return matchDept && matchQ;
                  })
                  .map((s) => (
                    <tr key={s._id} className="hover:bg-slate-50/50">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        <div className="flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5 text-indigo-600" />
                          <span>{s.name}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-semibold">
                          {s.departmentName}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] font-semibold text-slate-600">
                        {s.code || '-'}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums font-semibold text-indigo-700">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold text-[10px]">
                          {s.memberCount ?? 0} members
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 max-w-sm truncate">
                        {s.description || 'Specialized functional subgroup'}
                      </td>
                    </tr>
                  ))}
                {subdepartments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No sub-departments found. Click "Add Sub-Department" to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Designations */}
      {subTab === 'designations' && (
        <div className="space-y-4">
          {/* Sub-toggle: Active vs History */}
          <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDesigView('ACTIVE')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  desigView === 'ACTIVE'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Active Designations ({designations.filter((d) => d.status !== 'ENDED').length})
              </button>
              <button
                onClick={() => setDesigView('HISTORY')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  desigView === 'HISTORY'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Ended / History Ledger ({designations.filter((d) => d.status === 'ENDED').length})
              </button>
            </div>
            <p className="text-xs text-slate-500 font-mono hidden sm:block">
              {desigView === 'ACTIVE'
                ? 'Current active job roles & titles'
                : 'Immutable audit archive of retired designations'}
            </p>
          </div>

          {desigView === 'ACTIVE' ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Designation Title</th>
                    <th className="py-3 px-4">Role Code</th>
                    <th className="py-3 px-4">Associated Department</th>
                    <th className="py-3 px-4">Band / Level</th>
                    <th className="py-3 px-4">Active Roles</th>
                    {user?.role === 'ADMIN' && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {designations
                    .filter((d) => d.status !== 'ENDED')
                    .map((desig) => (
                      <tr key={desig._id} className="hover:bg-slate-50/50">
                        <td className="py-3.5 px-4 font-bold text-slate-900">{desig.title}</td>
                        <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 font-bold uppercase">
                          {desig.code || desig.title.slice(0, 4).toUpperCase()}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {desig.departmentName || desig.department}
                          {desig.subdepartment && <span className="text-slate-400"> / {desig.subdepartment}</span>}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500">{desig.level}</td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-slate-800">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[10px]">
                            {desig.memberCount} active
                          </span>
                        </td>
                        {user?.role === 'ADMIN' && (
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() => {
                                setEndDesigModal(desig);
                                setEndReason('');
                              }}
                              className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                            >
                              End Designation
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  {designations.filter((d) => d.status !== 'ENDED').length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        No active designations found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Designation Title</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Level</th>
                    <th className="py-3 px-4">Ended Date</th>
                    <th className="py-3 px-4">Ended By</th>
                    <th className="py-3 px-4">Reason / History Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {designations
                    .filter((d) => d.status === 'ENDED')
                    .map((desig) => (
                      <tr key={desig._id} className="hover:bg-slate-50/50 bg-slate-50/30">
                        <td className="py-3.5 px-4 font-sans font-bold text-slate-800">
                          <div>
                            <span>{desig.title}</span>
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-200 text-slate-700">
                              RETIRED
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-sans text-slate-600">
                          {desig.departmentName || desig.department}
                          {desig.subdepartment && <span className="text-slate-400"> / {desig.subdepartment}</span>}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">{desig.level}</td>
                        <td className="py-3.5 px-4 text-slate-600 font-semibold">
                          {desig.endedAt ? new Date(desig.endedAt).toLocaleDateString() : 'Historical'}
                        </td>
                        <td className="py-3.5 px-4 font-sans text-slate-700">{desig.endedBy || 'System Admin'}</td>
                        <td className="py-3.5 px-4 font-sans text-slate-600 italic">{desig.endReason || 'Role restructured/retired'}</td>
                      </tr>
                    ))}
                  {designations.filter((d) => d.status === 'ENDED').length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 font-sans">
                        No ended or retired designations in history ledger.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Locations */}
      {subTab === 'locations' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {locations.map((loc) => (
              <div
                key={loc._id}
                className={`bg-white rounded-2xl border p-5 shadow-xs transition-all hover:shadow-md ${
                  loc.isHeadquarters
                    ? 'border-[#039583]/50 ring-1 ring-[#039583]/30 bg-gradient-to-br from-teal-50/20 to-white'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-100 shrink-0 text-[#039583] mt-0.5">
                      <MapPin className="w-5 h-5 text-[#039583]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 leading-snug">{loc.name}</h3>
                      {loc.street && (
                        <p className="text-xs text-slate-700 font-medium mt-1">
                          {loc.street}
                        </p>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5">
                        {loc.city}, {loc.state}{loc.zipCode ? ` - ${loc.zipCode}` : ''} · {loc.country}
                      </p>
                      {(loc.departments?.length || loc.subdepartments?.length) ? (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {loc.departments?.map((d) => (
                            <span key={d} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-semibold">
                              {d}
                            </span>
                          ))}
                          {loc.subdepartments?.map((s) => (
                            <span key={s} className="px-2 py-0.5 rounded-full bg-white text-slate-500 border border-slate-200 text-[10px]">
                              {s}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {loc.isHeadquarters && (
                    <span className="text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded font-mono shrink-0 whitespace-nowrap">
                      Head Office
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Department Modal */}
      {isAddDeptOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">Add New Department</h3>
              <button
                onClick={() => setIsAddDeptOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDept} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Department Name *</label>
                <input
                  type="text"
                  required
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  placeholder="Data Science & AI"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Department Code *</label>
                <input
                  type="text"
                  required
                  value={deptForm.code}
                  onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
                  placeholder="DSAI"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Description</label>
                <textarea
                  rows={3}
                  value={deptForm.description}
                  onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  placeholder="Focusing on enterprise predictive models and intelligence..."
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddDeptOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  {isSubmitting ? 'Creating...' : 'Create Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Sub-Department Modal */}
      {isAddSubdeptOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Add New Sub-Department</h3>
              </div>
              <button
                onClick={() => setIsAddSubdeptOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubdept} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Parent Department *
                </label>
                <select
                  value={
                    subdeptForm.departmentName ||
                    (departments.length > 0 ? departments[0].name : '')
                  }
                  onChange={(e) =>
                    setSubdeptForm({ ...subdeptForm, departmentName: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                >
                  {departments.map((d) => (
                    <option key={d._id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Sub-Department Name *
                </label>
                <input
                  type="text"
                  required
                  value={subdeptForm.name}
                  onChange={(e) => setSubdeptForm({ ...subdeptForm, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="e.g. Frontend Core, Cloud Infra, ML Ops"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Sub-Department Code (Optional)
                </label>
                <input
                  type="text"
                  value={subdeptForm.code}
                  onChange={(e) =>
                    setSubdeptForm({ ...subdeptForm, code: e.target.value.toUpperCase() })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="e.g. ENG-FE (auto-generated if empty)"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Description</label>
                <textarea
                  rows={3}
                  value={subdeptForm.description}
                  onChange={(e) =>
                    setSubdeptForm({ ...subdeptForm, description: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="Focusing on core user interface components and client apps..."
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddSubdeptOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create Sub-Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Designation Modal */}
      {isAddDesignationOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Add New Designation</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddDesignationOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDesignation} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Designation Title *</label>
                <input
                  type="text"
                  required
                  value={desigForm.title}
                  onChange={(e) => setDesigForm({ ...desigForm, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="e.g. Lead AI Research Engineer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Role Code</label>
                  <input
                    type="text"
                    value={desigForm.code}
                    onChange={(e) => setDesigForm({ ...desigForm, code: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
                    placeholder="LAIE"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Band / Level</label>
                  <select
                    value={desigForm.level}
                    onChange={(e) => setDesigForm({ ...desigForm, level: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white font-mono"
                  >
                    <option value="L1">L1 - Entry Level</option>
                    <option value="L2">L2 - Associate / Mid</option>
                    <option value="L3">L3 - Senior Staff</option>
                    <option value="L4">L4 - Lead / Principal</option>
                    <option value="L5">L5 - Director / VP</option>
                    <option value="L6">L6 - CXO / Executive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Department</label>
                <select
                  value={desigForm.department}
                  onChange={(e) => setDesigForm({ ...desigForm, department: e.target.value, subdepartment: '' })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                >
                  <option value="">Select Department (Optional)</option>
                  {departments.map((d) => (
                    <option key={d._id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Sub-Department</label>
                <select
                  value={desigForm.subdepartment}
                  onChange={(e) => {
                    const sub = subdepartments.find((s) => s.name === e.target.value);
                    setDesigForm({
                      ...desigForm,
                      subdepartment: e.target.value,
                      department: desigForm.department || sub?.departmentName || '',
                    });
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                >
                  <option value="">Select Sub-Department (Optional)</option>
                  {subdepartments
                    .filter((s) => !desigForm.department || s.departmentName === desigForm.department)
                    .map((s) => (
                      <option key={s._id} value={s.name}>
                        {desigForm.department ? s.name : `${s.name} (${s.departmentName})`}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Role Description</label>
                <textarea
                  rows={3}
                  value={desigForm.description}
                  onChange={(e) => setDesigForm({ ...desigForm, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  placeholder="Key responsibilities and domain focus..."
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddDesignationOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create Designation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* End Designation Modal */}
      {endDesigModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-amber-50/80">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-bold text-slate-900">End & Retire Designation</h3>
              </div>
              <button
                type="button"
                onClick={() => setEndDesigModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEndDesignation} className="p-6 space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-900 leading-relaxed">
                <p className="font-bold">You are ending "{endDesigModal.title}"</p>
                <p className="mt-1">
                  Ending this designation will archive it in the <strong>History Ledger</strong> instead of permanently deleting it. Past employee records, offer letters, and payroll slips using this title will remain intact.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Ending Designation *
                </label>
                <textarea
                  rows={3}
                  required
                  value={endReason}
                  onChange={(e) => setEndReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="e.g. Restructured department title into Principal AI Engineer..."
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEndDesigModal(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEnding}
                  className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {isEnding ? 'Archiving...' : 'Confirm & End Designation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Location Modal */}
      {isAddLocationOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">Add New Office Location</h3>
              <button
                onClick={() => setIsAddLocationOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateLocation} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Office / Facility Name *</label>
                <input
                  type="text"
                  required
                  value={locForm.name}
                  onChange={(e) => setLocForm({ ...locForm, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  placeholder="e.g. Pune Office (Multicon Square)"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Street Address</label>
                <input
                  type="text"
                  value={locForm.street}
                  onChange={(e) => setLocForm({ ...locForm, street: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  placeholder="Office no 402, Multicon Square, Near Mehendale Garage, Erandwane"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">City</label>
                  <input
                    type="text"
                    value={locForm.city}
                    onChange={(e) => setLocForm({ ...locForm, city: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    placeholder="Pune"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">State</label>
                  <input
                    type="text"
                    value={locForm.state}
                    onChange={(e) => setLocForm({ ...locForm, state: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    placeholder="Maharashtra"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">PIN / Postal Code</label>
                  <input
                    type="text"
                    value={locForm.zipCode}
                    onChange={(e) => setLocForm({ ...locForm, zipCode: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    placeholder="411004"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Country</label>
                  <input
                    type="text"
                    value={locForm.country}
                    onChange={(e) => setLocForm({ ...locForm, country: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    placeholder="India"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Departments (Optional)</label>
                  <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-300 px-3 py-2 space-y-1.5">
                    {departments.map((d) => (
                      <label key={d._id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={locForm.departments.includes(d.name)}
                          onChange={() => toggleLocDepartment(d.name)}
                          className="rounded border-slate-300 text-[#039583] focus:ring-[#039583]"
                        />
                        <span>{d.name}</span>
                      </label>
                    ))}
                    {departments.length === 0 && <p className="text-xs text-slate-400">No departments yet</p>}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Sub-Departments (Optional)</label>
                  <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-300 px-3 py-2 space-y-1.5">
                    {subdepartments
                      .filter((s) => locForm.departments.length === 0 || locForm.departments.includes(s.departmentName))
                      .map((s) => (
                        <label key={s._id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={locForm.subdepartments.includes(s.name)}
                            onChange={() => toggleLocSubdepartment(s)}
                            className="rounded border-slate-300 text-[#039583] focus:ring-[#039583]"
                          />
                          <span>
                            {s.name} <span className="text-slate-400">({s.departmentName})</span>
                          </span>
                        </label>
                      ))}
                    {subdepartments.length === 0 && <p className="text-xs text-slate-400">No sub-departments yet</p>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isHeadquarters"
                  checked={locForm.isHeadquarters}
                  onChange={(e) => setLocForm({ ...locForm, isHeadquarters: e.target.checked })}
                  className="rounded border-slate-300 text-[#039583] focus:ring-[#039583]"
                />
                <label htmlFor="isHeadquarters" className="text-xs text-slate-700 font-medium cursor-pointer">
                  Set as Primary Head Office
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddLocationOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  {isSubmitting ? 'Adding...' : 'Add Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {subTab === 'managers' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Managers Directory & Team Members</h3>
              <p className="text-xs text-slate-500">Explore manager profiles, expand to view all direct reportees, and send emails directly.</p>
            </div>
            <span className="text-[11px] font-mono text-slate-400">Total Managers: {managersList.length}</span>
          </div>

          {loading ? (
            <p className="text-xs text-slate-500 py-8 text-center">Loading managers directory...</p>
          ) : managersList.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No managers found</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {managersList.map((mgr: OrgTreeNode) => {
                const isExpanded = !!expandedManagers[mgr.employeeId];
                const teamCount = mgr.reports ? mgr.reports.length : 0;
                return (
                  <div key={mgr.employeeId} className="border border-slate-200 rounded-2xl p-5 bg-white shadow-xs hover:border-[#039583] transition-all space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3.5 cursor-pointer flex-1" onClick={() => setExpandedManagers(prev => ({ ...prev, [mgr.employeeId]: !prev[mgr.employeeId] }))}>
                        <div className="w-11 h-11 rounded-full bg-[#023b77] text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-sm">
                          {mgr.avatarInitials}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-sm text-slate-900">{mgr.name}</h4>
                            <span className="text-[10px] text-slate-400 font-mono">({mgr.employeeCode})</span>
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5">{mgr.designation} · <span className="font-medium text-slate-700">{mgr.department}</span></p>
                          <span className="inline-block mt-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                            {teamCount} Team Member{teamCount === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => setContactManagerModal(mgr)}
                        className="px-3 py-1.5 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-semibold transition-colors shadow-xs cursor-pointer flex items-center gap-1.5 shrink-0"
                        title="Send email message to manager"
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>Contact</span>
                      </button>
                    </div>

                    {/* Toggle Dropdown Button / Area */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <button
                        onClick={() => setExpandedManagers(prev => ({ ...prev, [mgr.employeeId]: !prev[mgr.employeeId] }))}
                        className="text-xs font-semibold text-[#023b77] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span>{isExpanded ? 'Hide Team Members' : 'Show Team Members'}</span>
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>
                      <span className="text-[11px] text-slate-400">{mgr.status}</span>
                    </div>

                    {/* Dropdown members list */}
                    {isExpanded && (
                      <div className="bg-slate-50 rounded-xl p-3 space-y-2 border border-slate-200 animate-in fade-in duration-150">
                        <h5 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">Direct Reports ({teamCount})</h5>
                        {teamCount === 0 ? (
                          <p className="text-[11px] text-slate-500 italic">No direct team members.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {mgr.reports.map((member: OrgTreeNode) => (
                              <div key={member.employeeId} className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-slate-200 text-xs">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-7 h-7 rounded-full bg-slate-800 text-white font-bold text-[10px] flex items-center justify-center shrink-0">
                                    {member.avatarInitials}
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-900">{member.name} <span className="text-[10px] text-slate-400 font-mono">({member.employeeCode})</span></p>
                                    <p className="text-[11px] text-slate-500">{member.designation}</p>
                                  </div>
                                </div>
                                <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-medium">
                                  {member.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Contact Manager Modal */}
      {contactManagerModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Contact Manager</h3>
                <p className="text-xs text-slate-500">Send an email message to <strong className="text-slate-700">{contactManagerModal.name}</strong> ({contactManagerModal.designation})</p>
              </div>
              <button
                onClick={() => setContactManagerModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendManagerContact} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={contactSubject}
                  onChange={(e) => setContactSubject(e.target.value)}
                  placeholder="e.g. Project Update / Leave Query"
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#023b77]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Message <span className="text-rose-500">*</span></label>
                <textarea
                  required
                  rows={4}
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="Write your message here..."
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#023b77]"
                />
              </div>

              {contactFeedback && (
                <div className={`p-3 rounded-xl text-xs font-medium ${contactFeedback.includes('successfully') ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                  {contactFeedback}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setContactManagerModal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSendingContact}
                  className="px-5 py-2 rounded-xl bg-[#023b77] hover:bg-[#039583] text-white text-xs font-bold transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSendingContact ? 'Sending Email...' : 'Send Message'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
