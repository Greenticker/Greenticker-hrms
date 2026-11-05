import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { onboardingQueueService } from '../services/onboardingQueueService';
import { employeeService } from '../services/employeeService';
import { attendanceService } from '../services/attendanceService';
import { request } from '../services/api';
import { canWrite } from '../utils/access';
import { OnboardingQueueItem, OnboardingQueueStats, SectionReview } from '../types/onboardingQueue';
import { Department, Designation } from '../types/employee';
import { Shift } from '../types/attendance';
import {
  UserPlus,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Eye,
  X,
  FileText,
  Building,
  Briefcase,
  Mail,
  Phone,
  Send,
  Sparkles,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  CreditCard,
  FileCheck,
  RotateCcw,
  Plus,
  Users,
  Check,
} from 'lucide-react';

const ALL_SECTION_KEYS = [
  'core',
  'emergencyDetails',
  'employmentDetails',
  'banking',
  'pfEsi',
  'incomeTax',
  'insuranceNominee',
  'documents',
];

const SECTION_TITLES_MAP: Record<string, string> = {
  core: 'Section 1: Core Profile',
  emergencyDetails: 'Section 2: Emergency Details',
  employmentDetails: 'Section 3: Employment Details',
  banking: 'Section 4: Banking & Statutory',
  pfEsi: 'Section 5: Provident Fund (PF)',
  incomeTax: 'Section 6: Income Tax Declaration',
  insuranceNominee: 'Section 7: Insurance & Nominee',
  documents: 'Section 8: Documents Upload',
};

const getClearedSectionCount = (item?: OnboardingQueueItem | null): number => {
  if (!item) return 0;
  if (item.status === 'VERIFIED') return 8;
  if (!item.sectionReviews) return 0;
  return ALL_SECTION_KEYS.filter((key) => item.sectionReviews?.[key]?.status === 'VERIFIED').length;
};

const getSectionsNeedingCorrection = (item?: OnboardingQueueItem | null) => {
  if (!item?.sectionReviews) return [];
  return ALL_SECTION_KEYS.filter(
    (key) => item.sectionReviews?.[key]?.status === 'NEEDS_CORRECTION'
  ).map((key) => ({
    sectionKey: key,
    title: SECTION_TITLES_MAP[key] || key,
    remarks: item.sectionReviews?.[key]?.remarks || '',
  }));
};

export const OnboardingQueuePage: React.FC = () => {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState<OnboardingQueueItem[]>([]);
  const [stats, setStats] = useState<OnboardingQueueStats>({
    total: 0,
    submitted: 0,
    inProgress: 0,
    verified: 0,
    needsCorrection: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Selected Submission for Review Drawer
  const [selectedSub, setSelectedSub] = useState<OnboardingQueueItem | null>(null);
  const [activeDossierTab, setActiveDossierTab] = useState<'all' | 'profile' | 'documents'>('all');
  const [sectionActionLoading, setSectionActionLoading] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [createdNotice, setCreatedNotice] = useState<{ name: string; email: string; personalEmail?: string } | null>(null);

  // Approval Confirmation Box state (when all 8 sections are cleared)
  const [confirmApproveSub, setConfirmApproveSub] = useState<OnboardingQueueItem | null>(null);

  // Consolidated Revision Modal state (sends exactly 1 email with all review points)
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  const [revisionGeneralNote, setRevisionGeneralNote] = useState('');
  const [isSendingRevisions, setIsSendingRevisions] = useState(false);

  // Add Joiner Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [addFormData, setAddFormData] = useState({
    firstName: '',
    lastName: '',
    workEmail: '',
    personalEmail: '',
    phone: '',
    employeeCode: `ZEN-${Math.floor(100 + Math.random() * 900)}`,
    joiningDate: new Date().toISOString().split('T')[0],
    employmentType: 'FULL_TIME' as const,
    department: 'Engineering & Technology',
    designation: 'Software Engineer',
    shift: 'Standard General (09:00 - 18:00)',
    location: 'Bengaluru HQ (Prestige Tech Park)',
    annualSalary: 1200000,
  });

  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  // Modal State for Quick Add Department
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [isDeptSubmitting, setIsDeptSubmitting] = useState(false);
  const [deptFormError, setDeptFormError] = useState<string | null>(null);
  const [deptFormData, setDeptFormData] = useState({ name: '', code: '' });

  // Modal State for Quick Add Designation
  const [isDesigModalOpen, setIsDesigModalOpen] = useState(false);
  const [isDesigSubmitting, setIsDesigSubmitting] = useState(false);
  const [desigFormError, setDesigFormError] = useState<string | null>(null);
  const [desigFormData, setDesigFormData] = useState({ title: '', code: '', level: 'L2' });

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
        setAddFormData((prev) => ({ ...prev, department: res.department.name }));
        setIsDeptModalOpen(false);
        setDeptFormData({ name: '', code: '' });
      }
    } catch (err: any) {
      setDeptFormError(err.message || 'Failed to create department');
    } finally {
      setIsDeptSubmitting(false);
    }
  };

  const handleCreateQuickDesignation = async (e: React.FormEvent) => {
    e.preventDefault();
    setDesigFormError(null);
    setIsDesigSubmitting(true);
    try {
      const code = desigFormData.code.trim().toUpperCase() || desigFormData.title.trim().slice(0, 4).toUpperCase();
      const res = await employeeService.createDesignation({
        title: desigFormData.title.trim(),
        code,
        level: desigFormData.level,
        department: addFormData.department,
      });
      if (res.success && res.designation) {
        setDesignations((prev) => [...prev, res.designation]);
        setAddFormData((prev) => ({ ...prev, designation: res.designation.title }));
        setIsDesigModalOpen(false);
        setDesigFormData({ title: '', code: '', level: 'L2' });
      }
    } catch (err: any) {
      setDesigFormError(err.message || 'Failed to create designation');
    } finally {
      setIsDesigSubmitting(false);
    }
  };

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const [res, deptRes, desigRes, shiftRes] = await Promise.all([
        onboardingQueueService.getQueue(),
        employeeService.getDepartments().catch(() => ({ departments: [] })),
        employeeService.getDesignations().catch(() => ({ designations: [] })),
        attendanceService.getShifts().catch(() => ({ shifts: [] })),
      ]);
      setSubmissions(res.submissions || []);
      if (deptRes?.departments) setDepartments(deptRes.departments);
      if (desigRes?.designations) setDesignations(desigRes.designations);
      if (shiftRes?.shifts) setShifts(shiftRes.shifts.filter((s) => s.status !== 'ENDED' && s.isActive !== false));
      setStats(
        res.stats || {
          total: 0,
          submitted: 0,
          inProgress: 0,
          verified: 0,
          needsCorrection: 0,
        }
      );
    } catch (err) {
      console.error('Failed to fetch onboarding queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleApproveSection = async (subId: string, sectionKey: string) => {
    setSectionActionLoading(sectionKey);
    try {
      const res = await onboardingQueueService.reviewSection(subId, sectionKey, 'VERIFIED');
      if (res.success && res.submission) {
        setSelectedSub(res.submission);
        const sectionTitle = SECTION_TITLES_MAP[sectionKey] || sectionKey;
        if (res.allCleared) {
          setActionSuccessMsg(`All 8 sections cleared! Click "Approve" to confirm final approval.`);
        } else {
          setActionSuccessMsg(`${sectionTitle} approved & cleared!`);
        }
        await fetchQueue();
        setTimeout(() => setActionSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      console.error('Failed to approve section:', err);
    } finally {
      setSectionActionLoading(null);
    }
  };

  const handleRequestSectionRevision = async (subId: string, sectionKey: string, remarks: string, sendNow = false) => {
    if (!remarks.trim()) return;
    setSectionActionLoading(sectionKey);
    try {
      const res = await onboardingQueueService.reviewSection(subId, sectionKey, 'NEEDS_CORRECTION', remarks);
      if (res.success && res.submission) {
        setSelectedSub(res.submission);
        const sectionTitle = SECTION_TITLES_MAP[sectionKey] || sectionKey;
        if (sendNow) {
          await handleSendConsolidatedRevisions(subId);
        } else {
          setActionSuccessMsg(`Review point recorded for ${sectionTitle}. Click "Send Revision Notice (1 Email)" when ready.`);
          await fetchQueue();
          setTimeout(() => setActionSuccessMsg(null), 5000);
        }
      }
    } catch (err: any) {
      console.error('Failed to request section revision:', err);
    } finally {
      setSectionActionLoading(null);
    }
  };

  const handleSendConsolidatedRevisions = async (subId: string) => {
    setIsSendingRevisions(true);
    try {
      const res = await onboardingQueueService.sendConsolidatedRevisions(subId, undefined, revisionGeneralNote);
      if (res.success && res.submission) {
        setSelectedSub(res.submission);
        setIsRevisionModalOpen(false);
        setRevisionGeneralNote('');
        setActionSuccessMsg(
          `Consolidated revision email with ${res.revisionsCount} review point(s) sent to ${res.recipientEmail}! The employee can now edit and resubmit their details.`
        );
        await fetchQueue();
        setTimeout(() => setActionSuccessMsg(null), 6000);
      }
    } catch (err: any) {
      console.error('Failed to send consolidated revisions:', err);
    } finally {
      setIsSendingRevisions(false);
    }
  };

  const handleConfirmFinalApproval = async () => {
    if (!confirmApproveSub) return;
    setIsVerifying(true);
    try {
      const res = await onboardingQueueService.verifySubmission(confirmApproveSub._id);
      if (res.success && res.submission) {
        setSelectedSub(res.submission);
        setConfirmApproveSub(null);
        setActionSuccessMsg(`Candidate ${res.submission.employeeName} (${res.submission.employeeCode}) onboarding approved & profile activated!`);
        await fetchQueue();
        setTimeout(() => setActionSuccessMsg(null), 5000);
      }
    } catch (err) {
      console.error('Failed to verify all sections:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleApproveAllSections = async (subId: string) => {
    const sub = submissions.find((s) => s._id === subId) || selectedSub;
    if (sub) {
      setConfirmApproveSub(sub);
    }
  };

  const handleCreateQueueJoiner = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddFormError(null);
    setIsSubmitting(true);
    try {
      await request<any>('/onboarding/queue', {
        method: 'POST',
        body: JSON.stringify(addFormData),
      });
      setIsAddModalOpen(false);
      setCreatedNotice({
        name: `${addFormData.firstName} ${addFormData.lastName}`,
        email: addFormData.workEmail.trim().toLowerCase(),
        personalEmail: addFormData.personalEmail.trim().toLowerCase(),
      });
      setAddFormData({
        firstName: '',
        lastName: '',
        workEmail: '',
        personalEmail: '',
        phone: '',
        employeeCode: `ZEN-${Math.floor(100 + Math.random() * 900)}`,
        joiningDate: new Date().toISOString().split('T')[0],
        employmentType: 'FULL_TIME',
        department: 'Engineering & Technology',
        designation: 'Software Engineer',
        shift: 'Standard General (09:00 - 18:00)',
        location: 'Bengaluru HQ (Prestige Tech Park)',
        annualSalary: 1200000,
      });
      await fetchQueue();
    } catch (err: any) {
      setAddFormError(err.message || 'Failed to add employee');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredList = submissions.filter((item) => {
    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      (item.employeeName && item.employeeName.toLowerCase().includes(q)) ||
      (item.employeeCode && item.employeeCode.toLowerCase().includes(q)) ||
      (item.department && item.department.toLowerCase().includes(q)) ||
      (item.workEmail && item.workEmail.toLowerCase().includes(q));
    return matchesStatus && matchesSearch;
  });



  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Employee Onboarding Review Queue
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {canWrite(user?.role, 'self_onboarding') && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add Employee
            </button>
          )}
          <button
            onClick={fetchQueue}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#012a52] hover:bg-[#023b77] text-white rounded-xl text-xs font-semibold transition border border-[#039583]/50 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Refresh Queue
          </button>
        </div>
      </div>

      {actionSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{actionSuccessMsg}</span>
          </div>
          <button onClick={() => setActionSuccessMsg(null)}>
            <X className="w-4 h-4 text-emerald-600" />
          </button>
        </div>
      )}

      {/* New Hire Credentials Banner */}
      {createdNotice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 shadow-xs animate-in fade-in space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-emerald-950">
                  New Employee Account Created & Added to Queue!
                </h3>
                <p className="text-xs text-emerald-700 mt-0.5">
                  <strong>{createdNotice.name}</strong> is now registered. Share these login credentials with the employee so they can sign in:
                </p>
              </div>
            </div>
            <button
              onClick={() => setCreatedNotice(null)}
              className="text-emerald-700 hover:text-emerald-900 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 bg-white rounded-xl border border-emerald-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">Work Email (Login ID)</span>
              <p className="font-mono font-bold text-slate-900 select-all">{createdNotice.email}</p>
            </div>
            {createdNotice.personalEmail && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">Personal Email</span>
                <p className="font-mono font-semibold text-slate-800 select-all">{createdNotice.personalEmail}</p>
              </div>
            )}
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">Password Setup</span>
              <p className="text-xs text-slate-700">Secure password setup link emailed to employee</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-500 block">Status: In Progress</span>
              <span className="text-[10px] text-emerald-700 font-bold">8-Step Onboarding Enabled</span>
            </div>
          </div>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">All Employees</span>
          <p className="text-2xl font-bold text-slate-900 font-mono mt-1">{stats.total}</p>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Total pipeline count</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-amber-200 bg-amber-50/20 shadow-xs">
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3" /> Submitted (Review)
          </span>
          <p className="text-2xl font-bold text-amber-700 font-mono mt-1">{stats.submitted}</p>
          <span className="text-[10px] text-amber-600 mt-0.5 block">Awaiting HR action</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-xs">
          <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">In Progress</span>
          <p className="text-2xl font-bold text-blue-700 font-mono mt-1">{stats.inProgress}</p>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Filling out steps</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-200 bg-rose-50/20 shadow-xs">
          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Needs Correction
          </span>
          <p className="text-2xl font-bold text-rose-700 font-mono mt-1">{stats.needsCorrection}</p>
          <span className="text-[10px] text-rose-600 mt-0.5 block">Returned with notes</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-xs">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Verified & Active
          </span>
          <p className="text-2xl font-bold text-emerald-700 font-mono mt-1">{stats.verified}</p>
          <span className="text-[10px] text-emerald-600 mt-0.5 block">Profile cleared</span>
        </div>
      </div>
      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Status Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 text-xs">
          {[
            { id: 'ALL', label: `All (${stats.total})` },
            { id: 'SUBMITTED', label: `Pending Review (${stats.submitted})` },
            { id: 'IN_PROGRESS', label: `In Progress (${stats.inProgress})` },
            { id: 'NEEDS_CORRECTION', label: `Corrections (${stats.needsCorrection})` },
            { id: 'VERIFIED', label: `Verified (${stats.verified})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${statusFilter === tab.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search candidate, code, or dept..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
          />
        </div>
      </div>

      {/* Applications List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500 font-mono">
            Loading onboarding submissions...
          </div>
        ) : filteredList.length === 0 ? (
          <div className="p-12 text-center">
            <UserPlus className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No Onboarding Applications Found</p>
            <p className="text-xs text-slate-400 mt-1">
              There are currently no candidates matching the active filter.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredList.map((item) => (
              <div
                key={item._id}
                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/70 transition"
              >
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800 font-bold font-mono text-sm shrink-0">
                    {item.employeeName
                      ? item.employeeName
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                      : 'EM'}
                  </div>

                  <div>
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-sm font-bold text-slate-900">{item.employeeName}</h3>
                      <span className="text-[11px] font-mono text-slate-500 font-semibold">
                        {item.employeeCode}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono uppercase border ${item.status === 'VERIFIED'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : item.status === 'SUBMITTED'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : item.status === 'NEEDS_CORRECTION'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                      >
                        {item.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-xs text-slate-500 mt-1">
                      <span>{item.designation}</span>
                      <span>·</span>
                      <span>{item.department}</span>
                      <span>·</span>
                      <span className="font-mono">{item.workEmail}</span>
                    </div>

                    {item.rejectionRemarks && item.status === 'NEEDS_CORRECTION' && (
                      <div className="mt-2 text-xs bg-rose-50 text-rose-700 p-2 rounded-lg border border-rose-200 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Remarks: {item.rejectionRemarks}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Section Clearance Progress */}
                  {(() => {
                    const cleared = getClearedSectionCount(item);
                    return (
                      <div className="text-right mr-2 hidden sm:block">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Sections Cleared</span>
                        <p className="text-xs font-bold text-slate-800 font-mono">
                          {cleared} / 8 Cleared
                        </p>
                        <div className="w-24 bg-slate-100 rounded-full h-1.5 mt-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              cleared === 8 ? 'bg-emerald-600' : 'bg-slate-900'
                            }`}
                            style={{ width: `${(cleared / 8) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {getClearedSectionCount(item) === 8 && item.status !== 'VERIFIED' && (
                    <button
                      onClick={() => setConfirmApproveSub(item)}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setSelectedSub(item);
                      setActiveDossierTab('all');
                    }}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-indigo-300" />
                    Review & Clear Sections
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review Dossier Drawer / Modal */}
      {selectedSub && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-end">
          <div className="bg-white w-full max-w-3xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-200 flex items-start justify-between bg-slate-50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded font-mono uppercase bg-slate-200 text-slate-700">
                    DOSSIER AUDIT
                  </span>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-xs font-mono font-semibold text-slate-600">
                    {selectedSub.employeeCode}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono uppercase border ${
                      selectedSub.status === 'VERIFIED'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : selectedSub.status === 'NEEDS_CORRECTION'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {selectedSub.status.replace('_', ' ')}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-slate-900 mt-1">{selectedSub.employeeName}</h2>
                <p className="text-xs text-slate-500">
                  {selectedSub.designation} · {selectedSub.department}
                </p>

                {/* Overall Section Clearance Bar */}
                {(() => {
                  const cleared = getClearedSectionCount(selectedSub);
                  return (
                    <div className="mt-3 flex items-center gap-2.5">
                      <div className="w-48 bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            cleared === 8 ? 'bg-emerald-600' : 'bg-slate-900'
                          }`}
                          style={{ width: `${(cleared / 8) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono font-bold text-slate-800">
                        {cleared} / 8 Sections Cleared
                      </span>
                    </div>
                  );
                })()}
              </div>

              <button
                onClick={() => setSelectedSub(null)}
                className="p-2 hover:bg-slate-200 rounded-xl text-slate-500 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dossier Navigation Tabs */}
            <div className="flex border-b border-slate-200 px-6 gap-6 bg-white text-xs font-semibold">
              <button
                onClick={() => setActiveDossierTab('all')}
                className={`py-3 border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                  activeDossierTab === 'all'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                All Sections (1–8)
                <span className="w-4 h-4 rounded-full bg-slate-100 text-[10px] flex items-center justify-center font-mono font-bold text-slate-700">
                  8
                </span>
              </button>

              <button
                onClick={() => setActiveDossierTab('profile')}
                className={`py-3 border-b-2 transition cursor-pointer ${
                  activeDossierTab === 'profile'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Profile Data (Sections 1–7)
              </button>

              <button
                onClick={() => setActiveDossierTab('documents')}
                className={`py-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
                  activeDossierTab === 'documents'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Documents (Section 8)
                <span className="w-4 h-4 rounded-full bg-slate-100 text-[10px] flex items-center justify-center font-mono font-bold text-slate-700">
                  {selectedSub.documents?.length || 0}
                </span>
              </button>
            </div>

            {/* Drawer Body with Per-Section Review Dossier */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* If All 8 sections cleared, show prominent Approve banner */}
              {getClearedSectionCount(selectedSub) === 8 && selectedSub.status !== 'VERIFIED' && (
                <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs animate-in fade-in">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-emerald-950 text-sm">
                        All 8 Sections Audited & Cleared!
                      </p>
                      <p className="text-emerald-700 text-xs mt-0.5">
                        Candidate dossier has passed all section reviews. Click Approve to finalize.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setConfirmApproveSub(selectedSub)}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-2 cursor-pointer shrink-0"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve
                  </button>
                </div>
              )}

              {/* If any sections have review points, show 1 Consolidated Email banner */}
              {getSectionsNeedingCorrection(selectedSub).length > 0 && (
                <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs animate-in fade-in">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-rose-950 text-sm">
                        {getSectionsNeedingCorrection(selectedSub).length} Section(s) Marked for Revision
                      </p>
                      <p className="text-rose-700 text-xs mt-0.5">
                        Only 1 consolidated email will be sent containing all section review points.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsRevisionModalOpen(true)}
                    className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-2 cursor-pointer shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send Revision Notice (1 Email)
                  </button>
                </div>
              )}

              <ProfileDossier
                sub={selectedSub}
                activeTab={activeDossierTab}
                onApprove={(secKey) => handleApproveSection(selectedSub._id, secKey)}
                onRequestRevision={(secKey, remarks, sendNow) => handleRequestSectionRevision(selectedSub._id, secKey, remarks, sendNow)}
                loadingKey={sectionActionLoading}
              />
            </div>

            {/* Drawer Footer: Section Clearance Summary */}
            <div className="p-4 px-6 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {(() => {
                const cleared = getClearedSectionCount(selectedSub);
                const needsCorr = getSectionsNeedingCorrection(selectedSub).length;
                return (
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center font-mono font-bold text-xs ${
                        cleared === 8 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-800'
                      }`}
                    >
                      {cleared === 8 ? <Check className="w-4 h-4 text-emerald-600" /> : `${cleared}/8`}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        {cleared === 8 ? 'All 8 Sections Approved & Cleared!' : `${cleared} of 8 Sections Cleared`}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {cleared === 8
                          ? 'Ready for final confirmation approval'
                          : needsCorr > 0
                          ? `${needsCorr} section(s) require candidate revision`
                          : `${8 - cleared} section${8 - cleared === 1 ? '' : 's'} remaining to audit`}
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center gap-2 flex-wrap">
                {getSectionsNeedingCorrection(selectedSub).length > 0 && (
                  <button
                    onClick={() => setIsRevisionModalOpen(true)}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send Revisions ({getSectionsNeedingCorrection(selectedSub).length}) — 1 Email
                  </button>
                )}

                {getClearedSectionCount(selectedSub) === 8 && selectedSub.status !== 'VERIFIED' ? (
                  <button
                    onClick={() => setConfirmApproveSub(selectedSub)}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-xs cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve
                  </button>
                ) : getClearedSectionCount(selectedSub) < 8 ? (
                  <button
                    onClick={() => handleApproveAllSections(selectedSub._id)}
                    disabled={isVerifying}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer disabled:opacity-50"
                    title="Approve and clear all remaining sections at once"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Clear All Remaining ({8 - getClearedSectionCount(selectedSub)})
                  </button>
                ) : null}

                <button
                  onClick={() => setSelectedSub(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Close Dossier
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Joiner Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Add Employee to Onboarding Queue</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateQueueJoiner} className="p-6 space-y-4">
              {addFormError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  {addFormError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">First Name *</label>
                  <input
                    type="text"
                    required
                    value={addFormData.firstName}
                    onChange={(e) => setAddFormData({ ...addFormData, firstName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="Ananya"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={addFormData.lastName}
                    onChange={(e) => setAddFormData({ ...addFormData, lastName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="Sharma"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Work Email *</label>
                  <input
                    type="email"
                    required
                    value={addFormData.workEmail}
                    onChange={(e) => setAddFormData({ ...addFormData, workEmail: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="ananya.sharma@vetan.ai"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Personal Email Address *</label>
                  <input
                    type="email"
                    required
                    value={addFormData.personalEmail}
                    onChange={(e) => setAddFormData({ ...addFormData, personalEmail: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="ananya.sharma@gmail.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Phone Number</label>
                  <input
                    type="tel"
                    value={addFormData.phone}
                    onChange={(e) => setAddFormData({ ...addFormData, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    placeholder="+91 98765 43210"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Employee ID / Code *</label>
                  <input
                    type="text"
                    required
                    value={addFormData.employeeCode}
                    onChange={(e) => setAddFormData({ ...addFormData, employeeCode: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
                    placeholder="ZEN-204"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700">Department *</label>
                    <button
                      type="button"
                      onClick={() => setIsDeptModalOpen(true)}
                      className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Add Dept
                    </button>
                  </div>
                  <select
                    value={addFormData.department}
                    onChange={(e) => setAddFormData({ ...addFormData, department: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  >
                    {departments.map((d) => (
                      <option key={d._id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                    {!departments.some((d) => d.name === addFormData.department) && (
                      <option value={addFormData.department}>{addFormData.department}</option>
                    )}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700">Designation *</label>
                    <button
                      type="button"
                      onClick={() => setIsDesigModalOpen(true)}
                      className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Add Designation
                    </button>
                  </div>
                  <select
                    value={addFormData.designation}
                    onChange={(e) => setAddFormData({ ...addFormData, designation: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 bg-white"
                  >
                    {designations.map((d) => (
                      <option key={d._id} value={d.title}>
                        {d.title} ({d.level})
                      </option>
                    ))}
                    {!designations.some((d) => d.title === addFormData.designation) && (
                      <option value={addFormData.designation}>{addFormData.designation}</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Work Shift *</label>
                  <select
                    value={addFormData.shift}
                    onChange={(e) => setAddFormData({ ...addFormData, shift: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium bg-white"
                  >
                    {shifts.map((s) => (
                      <option key={s._id} value={`${s.name} (${s.startTime} - ${s.endTime})`}>
                        {s.name} ({s.startTime} - {s.endTime})
                      </option>
                    ))}
                    {!shifts.some(
                      (s) => `${s.name} (${s.startTime} - ${s.endTime})` === addFormData.shift || s.name === addFormData.shift
                    ) && <option value={addFormData.shift}>{addFormData.shift}</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Work Location *</label>
                  <input
                    type="text"
                    required
                    value={addFormData.location}
                    onChange={(e) => setAddFormData({ ...addFormData, location: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Date of Joining *</label>
                  <input
                    type="date"
                    required
                    value={addFormData.joiningDate}
                    onChange={(e) => setAddFormData({ ...addFormData, joiningDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Job Type *</label>
                  <select
                    value={addFormData.employmentType}
                    onChange={(e) => setAddFormData({ ...addFormData, employmentType: e.target.value as any })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                  >
                    <option value="FULL_TIME">Full time</option>
                    <option value="INTERN">Internship</option>
                    <option value="PART_TIME">Part time</option>
                    <option value="CONTRACT">Contract</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Annual CTC (₹ INR) *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1000"
                    value={addFormData.annualSalary}
                    onChange={(e) => setAddFormData({ ...addFormData, annualSalary: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-900"
                    placeholder="1200000"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
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
                <Building className="w-4 h-4 text-emerald-600" />
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

      {/* Modal: Quick Add Designation */}
      {isDesigModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-600" />
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

            <form onSubmit={handleCreateQuickDesignation} className="p-5 space-y-3">
              {desigFormError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
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
                  placeholder="e.g. Lead AI Engineer"
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
                    placeholder="LAIE"
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
                  className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isDesigSubmitting ? 'Creating...' : 'Create Designation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Box when approving candidate with all sections cleared */}
      {confirmApproveSub && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Confirm Onboarding Approval</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {confirmApproveSub.employeeName} · {confirmApproveSub.employeeCode} · {confirmApproveSub.designation}
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>All <strong>8 of 8 sections</strong> have been audited and cleared.</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Are you sure you want to approve this candidate&apos;s onboarding dossier? This will officially verify all their records, activate their employee profile in the company directory, and finalize their onboarding process.
              </p>
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-50 p-3 rounded-xl border border-slate-200 text-slate-700">
                {ALL_SECTION_KEYS.map((k) => (
                  <div key={k} className="flex items-center gap-1.5 font-medium">
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{SECTION_TITLES_MAP[k]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmApproveSub(null)}
                disabled={isVerifying}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmFinalApproval}
                disabled={isVerifying}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isVerifying ? (
                  <span>Approving...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirm &amp; Approve Dossier</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Consolidated Revision Notice Modal (Sends 1 Email with all review points) */}
      {isRevisionModalOpen && selectedSub && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-6 bg-rose-50/70 border-b border-rose-100 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Send Consolidated Revision Notice</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Candidate: <strong>{selectedSub.employeeName}</strong> ({selectedSub.employeeCode})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRevisionModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Single Email Notification Guarantee:</p>
                  <p className="mt-0.5">
                    <strong>Only 1 email</strong> will be sent to <strong>{selectedSub.personalEmail || selectedSub.workEmail}</strong> containing all review points across all flagged sections. Once sent, the employee will be unlocked to edit the required sections.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Review Points by Section ({getSectionsNeedingCorrection(selectedSub).length}):
                </h4>
                {getSectionsNeedingCorrection(selectedSub).map((sec, idx) => (
                  <div key={sec.sectionKey} className="p-3.5 bg-rose-50/50 rounded-xl border border-rose-200 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-rose-950 flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-rose-200 text-rose-800 text-[10px] flex items-center justify-center font-bold">
                          {idx + 1}
                        </span>
                        {sec.title}
                      </span>
                      <span className="text-[10px] font-mono font-bold uppercase text-rose-600">Needs Revision</span>
                    </div>
                    <p className="text-rose-900 font-medium pl-6 leading-relaxed bg-white p-2.5 rounded-lg border border-rose-100">
                      {sec.remarks || 'Corrections requested.'}
                    </p>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Additional General Instructions (Optional):
                </label>
                <textarea
                  rows={2}
                  value={revisionGeneralNote}
                  onChange={(e) => setRevisionGeneralNote(e.target.value)}
                  placeholder="e.g. Please update your details and resubmit as soon as possible..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500">
                Will notify {selectedSub.personalEmail || selectedSub.workEmail}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsRevisionModalOpen(false)}
                  disabled={isSendingRevisions}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSendConsolidatedRevisions(selectedSub._id)}
                  disabled={isSendingRevisions}
                  className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSendingRevisions ? (
                    <span>Sending Revision Email...</span>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Send 1 Revision Email &amp; Unlock Editing</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dossier: read-only view of everything the employee (and HR) filled in
// ---------------------------------------------------------------------------

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  INTERN: 'Intern',
  FULL_TIME: 'Full-time',
  CONTRACT: 'Contract',
  PART_TIME: 'Part-time',
};

const mask = (value?: string | number, keep = 4) => {
  const v = value === undefined || value === null ? '' : String(value);
  if (!v) return '—';
  if (v.includes('•')) return v; // already masked (legacy seed data)
  return '•'.repeat(Math.max(0, v.length - keep)) + v.slice(-keep);
};

const fmtAddress = (a?: any) =>
  a && typeof a === 'object' ? [a.line, a.city, a.state, a.country, a.postalCode].filter(Boolean).join(', ') : '';

const fmtMoney = (v?: number | string) =>
  v === undefined || v === null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN')}`;

const DossierItem: React.FC<{ label: string; value?: React.ReactNode; mono?: boolean; wide?: boolean }> = ({
  label,
  value,
  mono,
  wide,
}) => (
  <div className={wide ? 'col-span-2' : ''}>
    <span className="text-slate-400 block text-[10px]">{label}</span>
    <span className={`font-medium text-slate-800 ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
  </div>
);

interface SectionCardProps {
  sectionKey: string;
  title: string;
  icon: React.ReactNode;
  review?: SectionReview;
  onApprove: (sectionKey: string) => void;
  onRequestRevision: (sectionKey: string, remarks: string, sendNow?: boolean) => void;
  isLoading?: boolean;
  children: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({
  sectionKey,
  title,
  icon,
  review,
  onApprove,
  onRequestRevision,
  isLoading,
  children,
}) => {
  const [isEditingRemarks, setIsEditingRemarks] = useState(false);
  const [remarksText, setRemarksText] = useState(review?.remarks || '');

  const isVerified = review?.status === 'VERIFIED';
  const isNeedsCorrection = review?.status === 'NEEDS_CORRECTION';

  return (
    <div
      className={`rounded-2xl p-5 border transition-all duration-200 shadow-xs space-y-4 ${
        isVerified
          ? 'bg-emerald-50/20 border-emerald-300/80 shadow-emerald-500/5'
          : isNeedsCorrection
          ? 'bg-rose-50/20 border-rose-300 shadow-rose-500/5'
          : 'bg-white border-slate-200 shadow-slate-900/5'
      }`}
    >
      {/* Section Header with Status and Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                isVerified
                  ? 'bg-emerald-100 text-emerald-700'
                  : isNeedsCorrection
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {icon}
            </div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{title}</h4>
          </div>

          {/* Section Clearance Status Pill */}
          {isVerified ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Approved & Cleared
            </span>
          ) : isNeedsCorrection ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              Revision Requested
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Pending Review
            </span>
          )}
        </div>

        {/* Action Buttons for this Section */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => {
              setIsEditingRemarks(!isEditingRemarks);
              if (!isEditingRemarks && review?.remarks) {
                setRemarksText(review.remarks);
              }
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition flex items-center gap-1.5 cursor-pointer ${
              isNeedsCorrection
                ? 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 shadow-2xs'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            {isNeedsCorrection ? 'Update Remarks' : 'Request Revision'}
          </button>

          <button
            type="button"
            onClick={() => onApprove(sectionKey)}
            disabled={isLoading || isVerified}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 cursor-pointer ${
              isVerified
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 opacity-90 cursor-default font-bold'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs disabled:opacity-50'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-white" />
            {isVerified ? 'Approved & Cleared ✓' : 'Approve & Clear'}
          </button>
        </div>
      </div>

      {/* Revision Notice Banner */}
      {isNeedsCorrection && review?.remarks && !isEditingRemarks && (
        <div className="p-3.5 rounded-xl bg-rose-50/90 border border-rose-200 text-xs text-rose-900 flex items-start gap-2.5 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-bold text-rose-950">Revision Instructions:</span>
              {review.reviewedBy && (
                <span className="text-[10px] text-rose-600 font-mono">
                  Requested by {review.reviewedBy}{' '}
                  {review.reviewedAt ? `on ${new Date(review.reviewedAt).toLocaleDateString()}` : ''}
                </span>
              )}
            </div>
            <p className="mt-1 text-rose-800 leading-relaxed font-medium">{review.remarks}</p>
          </div>
        </div>
      )}

      {/* Inline Revision Form */}
      {isEditingRemarks && (
        <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-300 text-xs space-y-2.5 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-950 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              Specify Revision Remarks for {title}
            </span>
            <button
              type="button"
              onClick={() => setIsEditingRemarks(false)}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <textarea
            rows={2}
            autoFocus
            value={remarksText}
            onChange={(e) => setRemarksText(e.target.value)}
            placeholder={`Explain what the candidate needs to fix in ${title}...`}
            className="w-full p-2.5 bg-white border border-amber-300 rounded-xl text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:outline-none"
          />
          <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
            <button
              type="button"
              onClick={() => setIsEditingRemarks(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isLoading || !remarksText.trim()}
              onClick={() => {
                onRequestRevision(sectionKey, remarksText, false);
                setIsEditingRemarks(false);
              }}
              className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50 cursor-pointer shadow-xs flex items-center gap-1"
            >
              <Check className="w-3 h-3" />
              Save Review Point
            </button>
            <button
              type="button"
              disabled={isLoading || !remarksText.trim()}
              onClick={() => {
                onRequestRevision(sectionKey, remarksText, true);
                setIsEditingRemarks(false);
              }}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition disabled:opacity-50 cursor-pointer shadow-xs flex items-center gap-1"
            >
              <Send className="w-3 h-3" />
              Save &amp; Send 1 Email
            </button>
          </div>
        </div>
      )}

      {/* Section Fields Grid */}
      <div className="grid grid-cols-2 gap-3.5 text-xs pt-1">{children}</div>
    </div>
  );
};

const ProfileDossier: React.FC<{
  sub: OnboardingQueueItem;
  activeTab: 'all' | 'profile' | 'documents';
  onApprove: (sectionKey: string) => void;
  onRequestRevision: (sectionKey: string, remarks: string, sendNow?: boolean) => void;
  loadingKey: string | null;
}> = ({ sub, activeTab, onApprove, onRequestRevision, loadingKey }) => {
  const sd: Record<string, any> = sub.sectionsData || {};
  const core = sd.core || {};
  const emergency = sd.emergencyDetails || sd.emergency || {};
  const emp = sd.employmentDetails || {};
  const bank = sd.banking || sd.bank || {};
  const pf = sd.pfEsi || {};
  const legacyStat = sd.statutory || {};
  const tax = sd.incomeTax || sd.identityTax || {};
  const ins = sd.insuranceNominee || {};
  const dependents: any[] = Array.isArray(ins.dependents) ? ins.dependents : [];
  const icon = 'w-4 h-4 text-slate-700';

  const reviews = sub.sectionReviews || {};
  const showProfile = activeTab === 'all' || activeTab === 'profile';
  const showDocuments = activeTab === 'all' || activeTab === 'documents';

  return (
    <div className="space-y-6">
      {showProfile && (
        <>
          {/* 1. Core Profile */}
          <SectionCard
            sectionKey="core"
            title="1. Core Profile"
            icon={<ShieldCheck className={icon} />}
            review={reviews.core}
            onApprove={onApprove}
            onRequestRevision={onRequestRevision}
            isLoading={loadingKey === 'core'}
          >
            <DossierItem label="First Name" value={core.firstName} />
            <DossierItem label="Middle Name" value={core.middleName} />
            <DossierItem label="Last Name" value={core.lastName} />
            <DossierItem
              label="Full Name"
              value={[core.firstName, core.middleName, core.lastName].filter(Boolean).join(' ') || sub.employeeName}
            />
            <DossierItem
              label="Date of Birth / Gender"
              value={`${core.dob || sd.personal?.dob || '—'} / ${core.gender || sd.personal?.gender || '—'}`}
            />
            <DossierItem label="Phone Number" value={core.phone || sub.phone} mono />
            <DossierItem label="Alternate Number" value={core.alternatePhone} mono />
            <DossierItem label="Personal Email" value={core.personalEmail || sub.personalEmail} mono />
            <DossierItem label="Work Email" value={sub.workEmail} mono />
            <DossierItem label="Current Address" value={fmtAddress(core.currentAddress) || sd.address?.current} wide />
            <DossierItem
              label="Permanent Address"
              value={
                core.sameAsCurrent
                  ? 'Same as current address'
                  : fmtAddress(core.permanentAddress) || sd.address?.permanent
              }
              wide
            />
          </SectionCard>

          {/* 2. Emergency Details */}
          <SectionCard
            sectionKey="emergencyDetails"
            title="2. Emergency Details"
            icon={<Phone className={icon} />}
            review={reviews.emergencyDetails}
            onApprove={onApprove}
            onRequestRevision={onRequestRevision}
            isLoading={loadingKey === 'emergencyDetails'}
          >
            <DossierItem label="Name" value={emergency.name} />
            <DossierItem label="Relation" value={emergency.relation || emergency.relationship} />
            <DossierItem label="Phone Number" value={emergency.phone} mono />
          </SectionCard>

          {/* 3. Employment Details */}
          <SectionCard
            sectionKey="employmentDetails"
            title="3. Employment Details (set by HR)"
            icon={<Building className={icon} />}
            review={reviews.employmentDetails}
            onApprove={onApprove}
            onRequestRevision={onRequestRevision}
            isLoading={loadingKey === 'employmentDetails'}
          >
            <DossierItem label="Employee ID" value={emp.employeeCode || sub.employeeCode} mono />
            <DossierItem label="Date of Joining" value={emp.joiningDate} />
            <DossierItem
              label="Employee Type"
              value={emp.employmentType ? EMPLOYMENT_TYPE_LABELS[emp.employmentType] || emp.employmentType : undefined}
            />
            <DossierItem label="Department" value={emp.department || sub.department} />
            <DossierItem label="Designation" value={emp.designation || sub.designation} />
            <DossierItem label="Work Location" value={emp.location} />
            <DossierItem label="Reporting Manager" value={emp.reportingManagerName} />
            <DossierItem label="Filled By" value={emp.filledBy} />
          </SectionCard>

          {/* 4. Banking & Statutory Identifiers */}
          <SectionCard
            sectionKey="banking"
            title="4. Banking & Statutory Identifiers"
            icon={<CreditCard className={icon} />}
            review={reviews.banking}
            onApprove={onApprove}
            onRequestRevision={onRequestRevision}
            isLoading={loadingKey === 'banking'}
          >
            <DossierItem label="Account Holder" value={bank.accountHolder || sub.employeeName} />
            <DossierItem label="Account Number" value={bank.accountNumber || bank.accountNumberMasked || '—'} mono />
            <DossierItem label="IFSC Code" value={bank.ifsc} mono />
            <DossierItem label="Aadhaar Card Number" value={tax.aadhaarNumber || '—'} mono />
            <DossierItem label="PAN Card Number" value={tax.panNumber || tax.panMasked || '—'} mono />
          </SectionCard>

          {/* 5. Provident Fund (PF) */}
          <SectionCard
            sectionKey="pfEsi"
            title="5. Provident Fund (PF)"
            icon={<FileCheck className={icon} />}
            review={reviews.pfEsi}
            onApprove={onApprove}
            onRequestRevision={onRequestRevision}
            isLoading={loadingKey === 'pfEsi'}
          >
            <DossierItem
              label="Existing UAN?"
              value={pf.hasUan === 'YES' ? 'Yes' : pf.hasUan === 'NO' ? 'No' : legacyStat.uan ? 'Yes' : undefined}
            />
            {pf.hasUan === 'NO' ? (
              <DossierItem label="Father's / Spouse's Name" value={pf.fatherOrSpouseName} />
            ) : (
              <>
                <DossierItem label="UAN" value={pf.uan || legacyStat.uan || legacyStat.uanMasked} mono />
                {pf.pfAccountNumber && <DossierItem label="PF Account Number" value={pf.pfAccountNumber} mono />}
              </>
            )}
            {pf.hasEsic && (
              <>
                <DossierItem label="Existing ESIC Number?" value={pf.hasEsic === 'YES' ? 'Yes' : 'No'} />
                {pf.hasEsic === 'NO' ? (
                  <DossierItem label="Preferred ESI Dispensary" value={pf.esiDispensary} />
                ) : (
                  <DossierItem label="ESIC Insurance No." value={pf.esicNumber || legacyStat.esiNumber} mono />
                )}
              </>
            )}
          </SectionCard>

          {/* 6. Income Tax Declaration */}
          <SectionCard
            sectionKey="incomeTax"
            title="6. Income Tax Declaration"
            icon={<FileText className={icon} />}
            review={reviews.incomeTax}
            onApprove={onApprove}
            onRequestRevision={onRequestRevision}
            isLoading={loadingKey === 'incomeTax'}
          >
            <DossierItem label="Aadhaar Number" value={tax.aadhaarNumber || '—'} mono />
            <DossierItem label="PAN Number" value={tax.panNumber || tax.panMasked} mono />
            {tax.taxRegime && (
              <DossierItem
                label="Tax Regime"
                value={
                  tax.taxRegime === 'OLD_REGIME'
                    ? 'Old Tax Regime'
                    : 'New Tax Regime (115BAC)'
                }
              />
            )}
            {tax.prevEmployerGrossSalary !== undefined && (
              <>
                <DossierItem label="Prev. Employer Gross Salary" value={fmtMoney(tax.prevEmployerGrossSalary)} mono />
                <DossierItem label="Prev. Employer TDS Deducted" value={fmtMoney(tax.prevEmployerTds)} mono />
              </>
            )}
          </SectionCard>

          {/* 7. Insurance and Nominee */}
          <SectionCard
            sectionKey="insuranceNominee"
            title="7. Insurance and Nominee"
            icon={<Users className={icon} />}
            review={reviews.insuranceNominee}
            onApprove={onApprove}
            onRequestRevision={onRequestRevision}
            isLoading={loadingKey === 'insuranceNominee'}
          >
            <DossierItem
              label="Corporate Group Health Insurance"
              value={ins.optHealthInsurance === 'YES' ? 'Opted in' : ins.optHealthInsurance === 'NO' ? 'Opted out' : undefined}
              wide
            />
            {dependents.map((d, i) => (
              <DossierItem
                key={d.id || i}
                label={`Dependent ${i + 1}`}
                value={`${d.fullName} · ${d.relationship} · ${d.gender} · DOB ${d.dob}`}
                wide
              />
            ))}
            <DossierItem label="Nominee" value={ins.nominee?.fullName} />
            <DossierItem
              label="Nominee Relationship / DOB"
              value={ins.nominee ? `${ins.nominee.relationship} · ${ins.nominee.dob}` : undefined}
            />
          </SectionCard>
        </>
      )}

      {showDocuments && (
        /* 8. Documents Upload */
        <SectionCard
          sectionKey="documents"
          title="8. Documents Upload"
          icon={<FileText className={icon} />}
          review={reviews.documents}
          onApprove={onApprove}
          onRequestRevision={onRequestRevision}
          isLoading={loadingKey === 'documents'}
        >
          <div className="col-span-2 space-y-2.5">
            {sub.documents && sub.documents.length > 0 ? (
              sub.documents.map((doc, idx) => (
                <div
                  key={doc.id || idx}
                  className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">{doc.documentName}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                        <span className="uppercase px-1.5 py-0.2 bg-slate-200/70 text-slate-700 rounded font-semibold">
                          {doc.category}
                        </span>
                        <span>{doc.fileSize || 'PDF'}</span>
                        <span>·</span>
                        <span>{doc.fileType || 'application/pdf'}</span>
                        <span>·</span>
                        <span>Uploaded {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                      doc.status === 'VERIFIED'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : doc.status === 'REJECTED'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {doc.status}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-xs text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                Standard employment records (Govt Photo ID, Address Proof, Degree Certificate) uploaded and verified.
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
};

