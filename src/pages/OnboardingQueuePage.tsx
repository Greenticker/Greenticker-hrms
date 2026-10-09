import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { onboardingQueueService } from '../services/onboardingQueueService';
import { request } from '../services/api';
import { OnboardingQueueItem, OnboardingQueueStats } from '../types/onboardingQueue';
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
} from 'lucide-react';

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
  const [activeDossierTab, setActiveDossierTab] = useState<'profile' | 'documents'>('profile');
  const [isVerifying, setIsVerifying] = useState(false);
  const [revisionRemarks, setRevisionRemarks] = useState('');
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [createdNotice, setCreatedNotice] = useState<{ name: string; email: string } | null>(null);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await onboardingQueueService.getQueue();
      setSubmissions(res.submissions || []);
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

  const handleVerify = async (id: string) => {
    setIsVerifying(true);
    try {
      const res = await onboardingQueueService.verifySubmission(id);
      if (res.success) {
        setActionSuccessMsg(`Candidate profile for ${res.submission.employeeName} approved and activated!`);
        setSelectedSub(res.submission);
        await fetchQueue();
        setTimeout(() => setActionSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error('Failed to verify submission:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRequestRevision = async (id: string) => {
    if (!revisionRemarks.trim()) return;
    setIsVerifying(true);
    try {
      const res = await onboardingQueueService.requestChanges(id, revisionRemarks);
      if (res.success) {
        setActionSuccessMsg(`Revision request sent to candidate ${res.submission.employeeName}.`);
        setSelectedSub(res.submission);
        setShowRevisionForm(false);
        setRevisionRemarks('');
        await fetchQueue();
        setTimeout(() => setActionSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error('Failed to request changes:', err);
    } finally {
      setIsVerifying(false);
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
          <button
            onClick={fetchQueue}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#012a52] hover:bg-[#023b77] text-white rounded-xl text-xs font-semibold transition border border-[#039583]/50"
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
                  New Joiner Account Created & Added to Queue!
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
              <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">Login ID (Work Email)</span>
              <p className="font-mono font-bold text-slate-900 select-all">{createdNotice.email}</p>
            </div>
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
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">All Joiners</span>
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
                  {/* Step Completion Indicator */}
                  <div className="text-right mr-2 hidden sm:block">
                    <span className="text-[10px] font-bold uppercase text-slate-400">Step Progress</span>
                    <p className="text-xs font-bold text-slate-800 font-mono">
                      {item.currentStep} / {item.totalSteps || 9} Completed
                    </p>
                    <div className="w-24 bg-slate-100 rounded-full h-1.5 mt-1 overflow-hidden">
                      <div
                        className="bg-slate-900 h-full rounded-full transition-all"
                        style={{ width: `${(item.currentStep / (item.totalSteps || 8)) * 100}%` }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedSub(item);
                      setActiveDossierTab('profile');
                      setShowRevisionForm(false);
                    }}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Review Dossier
                  </button>

                  {item.status === 'SUBMITTED' && (
                    <button
                      onClick={() => handleVerify(item._id)}
                      disabled={isVerifying}
                      className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Approve & Clear
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Review Dossier Drawer / Modal */}
      {selectedSub && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-end">
          <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded font-mono uppercase bg-slate-200 text-slate-700">
                    DOSSIER AUDIT
                  </span>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-xs font-mono font-semibold text-slate-600">
                    {selectedSub.employeeCode}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-slate-900 mt-1">{selectedSub.employeeName}</h2>
                <p className="text-xs text-slate-500">
                  {selectedSub.designation} · {selectedSub.department}
                </p>
              </div>

              <button
                onClick={() => setSelectedSub(null)}
                className="p-2 hover:bg-slate-200 rounded-xl text-slate-500 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dossier Tabs */}
            <div className="flex border-b border-slate-200 px-6 gap-6 bg-white text-xs font-semibold">
              <button
                onClick={() => setActiveDossierTab('profile')}
                className={`py-3 border-b-2 transition cursor-pointer ${
                  activeDossierTab === 'profile'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Profile (Sections 1–7)
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
                <span className="w-4 h-4 rounded-full bg-slate-100 text-[10px] flex items-center justify-center font-mono">
                  {selectedSub.documents?.length || 0}
                </span>
              </button>
            </div>
            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {activeDossierTab === 'profile' && <ProfileDossier sub={selectedSub} />}

              {activeDossierTab === 'documents' && (
                <div className="space-y-3">
                  {selectedSub.documents && selectedSub.documents.length > 0 ? (
                    selectedSub.documents.map((doc, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-indigo-600" />
                          <div>
                            <p className="text-xs font-bold text-slate-900">{doc.documentName}</p>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {doc.fileSize} · {doc.fileType} · Uploaded {doc.uploadedAt}
                            </span>
                          </div>
                        </div>

                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase">
                          {doc.status}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-xs text-slate-400">
                      Standard employment records (Govt Photo ID, Address Proof, Degree Certificate) uploaded and verified.
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Drawer Footer with Actions */}
            <div className="p-6 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              {showRevisionForm ? (
                <div className="w-full space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">Specify Correction Remarks</span>
                    <button
                      onClick={() => setShowRevisionForm(false)}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={revisionRemarks}
                    onChange={(e) => setRevisionRemarks(e.target.value)}
                    placeholder="e.g. Please re-upload clearer PAN card copy and address proof..."
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                  />
                  <button
                    onClick={() => handleRequestRevision(selectedSub._id)}
                    disabled={isVerifying || !revisionRemarks.trim()}
                    className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition disabled:opacity-50"
                  >
                    Submit Revision Request
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setShowRevisionForm(true)}
                    className="px-4 py-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Request Revisions
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedSub(null)}
                      className="px-4 py-2.5 text-slate-600 hover:bg-slate-200 rounded-xl text-xs font-semibold transition cursor-pointer"
                    >
                      Close Dossier
                    </button>

                    <button
                      onClick={() => handleVerify(selectedSub._id)}
                      disabled={isVerifying || selectedSub.status === 'VERIFIED'}
                      className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      {selectedSub.status === 'VERIFIED' ? 'Already Verified' : 'Approve & Activate Profile'}
                    </button>
                  </div>
                </>
              )}
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

const DossierCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  children,
}) => (
  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
      {icon}
      {title}
    </h4>
    <div className="grid grid-cols-2 gap-3 text-xs">{children}</div>
  </div>
);

const ProfileDossier: React.FC<{ sub: OnboardingQueueItem }> = ({ sub }) => {
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

  const hasSavedData = Object.keys(sd).length > 0;

  return (
    <div className="space-y-6">
      {!hasSavedData && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          The employee has not saved any sections yet.
        </div>
      )}

      <DossierCard title="1. Core Profile" icon={<ShieldCheck className={icon} />}>
        <DossierItem label="First Name" value={core.firstName} />
        <DossierItem label="Middle Name" value={core.middleName} />
        <DossierItem label="Last Name" value={core.lastName} />
        <DossierItem
          label="Full Name"
          value={[core.firstName, core.middleName, core.lastName].filter(Boolean).join(' ') || sub.employeeName}
        />
        <DossierItem label="Date of Birth / Gender" value={`${core.dob || sd.personal?.dob || '—'} / ${core.gender || sd.personal?.gender || '—'}`} />
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
      </DossierCard>

      <DossierCard title="2. Emergency Details" icon={<Phone className={icon} />}>
        <DossierItem label="Name" value={emergency.name} />
        <DossierItem label="Relation" value={emergency.relation || emergency.relationship} />
        <DossierItem label="Phone Number" value={emergency.phone} mono />
      </DossierCard>

      <DossierCard title="3. Employment Details (set by HR)" icon={<Building className={icon} />}>
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
      </DossierCard>

      <DossierCard title="4. Banking Details" icon={<CreditCard className={icon} />}>
        <DossierItem label="Account Holder" value={bank.accountHolder || sub.employeeName} />
        <DossierItem label="IFSC Code" value={bank.ifsc} mono />
        <DossierItem label="Account Number" value={mask(bank.accountNumber ?? bank.accountNumberMasked)} mono />
      </DossierCard>

      <DossierCard title="5. PF / ESI" icon={<FileCheck className={icon} />}>
        <DossierItem label="Existing UAN?" value={pf.hasUan === 'YES' ? 'Yes' : pf.hasUan === 'NO' ? 'No' : legacyStat.uan ? 'Yes' : undefined} />
        {pf.hasUan === 'NO' ? (
          <DossierItem label="Father's / Spouse's Name" value={pf.fatherOrSpouseName} />
        ) : (
          <>
            <DossierItem label="UAN" value={pf.uan || legacyStat.uan || legacyStat.uanMasked} mono />
            <DossierItem label="PF Account Number" value={pf.pfAccountNumber} mono />
          </>
        )}
        <DossierItem label="Existing ESIC Number?" value={pf.hasEsic === 'YES' ? 'Yes' : pf.hasEsic === 'NO' ? 'No' : undefined} />
        {pf.hasEsic === 'NO' ? (
          <DossierItem label="Preferred ESI Dispensary" value={pf.esiDispensary} />
        ) : (
          <DossierItem label="ESIC Insurance No." value={pf.esicNumber || legacyStat.esiNumber} mono />
        )}
      </DossierCard>

      <DossierCard title="6. Income Tax Declaration" icon={<FileText className={icon} />}>
        <DossierItem label="Aadhaar Number" value={mask(tax.aadhaarNumber)} mono />
        <DossierItem label="PAN Number" value={tax.panNumber || tax.panMasked} mono />
        <DossierItem
          label="Tax Regime"
          value={
            tax.taxRegime === 'OLD_REGIME'
              ? 'Old Tax Regime'
              : tax.taxRegime
              ? 'New Tax Regime (115BAC)'
              : undefined
          }
        />
        {tax.prevEmployerGrossSalary !== undefined && (
          <>
            <DossierItem label="Prev. Employer Gross Salary" value={fmtMoney(tax.prevEmployerGrossSalary)} mono />
            <DossierItem label="Prev. Employer TDS Deducted" value={fmtMoney(tax.prevEmployerTds)} mono />
          </>
        )}
      </DossierCard>

      <DossierCard title="7. Insurance and Nominee" icon={<Users className={icon} />}>
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
      </DossierCard>
    </div>
  );
};

