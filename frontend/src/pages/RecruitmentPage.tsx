import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { recruitmentService, OfferInput } from '../services/recruitmentService';
import { employeeService } from '../services/employeeService';
import {
  JobCandidate,
  JobOpening,
  MyInterview,
  OfferVersion,
  Referral,
  ReferralStatus,
  Requisition,
} from '../types/modules';
import { Department, Employee } from '../types/employee';
import { canRead, canWrite, canWriteMaster, apiErrorMessages, isReadOnlyRole } from '../utils/access';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '../utils/uploadLimits';
import {
  AlertTriangle,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  Globe,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Send,
  Star,
  UserCheck,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';

// ------------------------------------------------------------------ constants

type Tab = 'requisitions' | 'candidates' | 'interviews' | 'approvals' | 'referrals';

const STAGES: JobCandidate['stage'][] = [
  'APPLIED',
  'SCREENING',
  'SHORTLISTED',
  'TECHNICAL_INTERVIEW',
  'HR_INTERVIEW',
  'OFFERED',
  'HIRED',
  'REJECTED',
];

const STAGE_LABEL: Record<string, string> = {
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  SHORTLISTED: 'Shortlisted',
  TECHNICAL_INTERVIEW: 'Interviewing',
  HR_INTERVIEW: 'Cleared interviews',
  OFFERED: 'Offered',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
};

const REQ_STATUS: Record<string, { label: string; style: string }> = {
  PENDING_APPROVAL: { label: 'Awaiting finance approval', style: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Approved · ready to publish', style: 'bg-blue-100 text-blue-800' },
  REJECTED: { label: 'Rejected', style: 'bg-rose-100 text-rose-800' },
  PUBLISHED: { label: 'Published', style: 'bg-emerald-100 text-emerald-800' },
};

const OFFER_STATUS: Record<string, { label: string; style: string }> = {
  PENDING_APPROVAL: { label: 'Awaiting approval (above band)', style: 'bg-amber-100 text-amber-800' },
  SENT: { label: 'Sent', style: 'bg-blue-100 text-blue-800' },
  ACCEPTED: { label: 'Accepted', style: 'bg-emerald-100 text-emerald-800' },
  DECLINED: { label: 'Declined', style: 'bg-rose-100 text-rose-800' },
  SUPERSEDED: { label: 'Superseded by revision', style: 'bg-slate-100 text-slate-600' },
  APPROVAL_REJECTED: { label: 'Approval rejected', style: 'bg-rose-100 text-rose-800' },
  WITHDRAWN: { label: 'Withdrawn', style: 'bg-slate-100 text-slate-600' },
  JOINED: { label: 'Joined', style: 'bg-emerald-100 text-emerald-800' },
};

const REF_LABEL: Record<ReferralStatus, string> = {
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  SHORTLISTED: 'Shortlisted',
  HIRED: 'Hired',
  NOT_SELECTED: 'Not selected',
};
const REF_STYLE: Record<ReferralStatus, string> = {
  SUBMITTED: 'bg-slate-100 text-slate-700',
  IN_REVIEW: 'bg-amber-100 text-amber-800',
  SHORTLISTED: 'bg-indigo-100 text-indigo-800',
  HIRED: 'bg-emerald-100 text-emerald-800',
  NOT_SELECTED: 'bg-rose-100 text-rose-800',
};

const RECOMMENDATIONS = [
  { value: 'STRONG_HIRE', label: 'Strong hire' },
  { value: 'HIRE', label: 'Hire' },
  { value: 'NO_HIRE', label: 'No hire' },
  { value: 'STRONG_NO_HIRE', label: 'Strong no hire' },
];

const CHANNELS = [
  { value: 'CAREERS_PAGE', label: 'Company careers page' },
  { value: 'LINKEDIN', label: 'LinkedIn' },
  { value: 'NAUKRI', label: 'Naukri' },
  { value: 'INDEED', label: 'Indeed' },
  { value: 'INTERNAL', label: 'Internal job board' },
];

const inr = (n?: number) => (n || n === 0 ? `₹${Math.round(n).toLocaleString('en-IN')}` : '—');
const dayOffset = (days: number) => new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

const inputCls =
  'w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/25';
const btnPrimary =
  'px-4 py-2 font-semibold text-white bg-slate-900 hover:bg-primary-hover rounded-xl shadow-xs disabled:opacity-50 cursor-pointer text-xs';
const btnGhost = 'px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer text-xs';
const chip = 'px-2 py-0.5 rounded text-[10px] font-bold uppercase';
const actionBtn = (tone: string) =>
  `px-3 py-1.5 rounded-lg font-semibold text-xs cursor-pointer flex items-center gap-1 ${tone}`;

// ------------------------------------------------------------------ small parts

const Modal: React.FC<{ title: string; subtitle?: string; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({
  title,
  subtitle,
  onClose,
  wide,
  children,
}) => (
  <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div
      className={`bg-white rounded-2xl ${wide ? 'max-w-2xl' : 'max-w-lg'} w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[92vh] overflow-y-auto`}
    >
      <div className="flex items-start justify-between border-b border-slate-100 pb-3 gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <div>
    <label className="block font-semibold text-slate-700 mb-1 text-xs">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
  </div>
);

const Errors: React.FC<{ errors: string[] }> = ({ errors }) =>
  errors.length === 0 ? null : (
    <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
      {errors.length === 1 ? (
        errors[0]
      ) : (
        <ul className="list-disc pl-4 space-y-0.5">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );

const Footer: React.FC<{ onCancel: () => void; busy: boolean; label: string; danger?: boolean }> = ({ onCancel, busy, label, danger }) => (
  <div className="flex justify-end gap-2 pt-2">
    <button type="button" onClick={onCancel} className={btnGhost}>
      Cancel
    </button>
    <button
      type="submit"
      disabled={busy}
      className={danger ? btnPrimary.replace('bg-slate-900 hover:bg-primary-hover', 'bg-rose-600 hover:bg-rose-700') : btnPrimary}
    >
      {busy ? 'Working...' : label}
    </button>
  </div>
);

// ------------------------------------------------------------------ page

export const RecruitmentPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role;
  const isRecruiter = canWrite(role, 'recruitment'); // HR, Admin 1/2, Super Admin, Admin
  const canSeePipeline = canRead(role, 'recruitment'); // + Finance, Auditors (read only)
  const isManager = role === 'MANAGER';
  const isApprover = ['FINANCE', 'SUPER_ADMIN', 'ADMIN'].includes(role || '');
  const canHire = canWriteMaster(role);
  const canRaise = isRecruiter || isManager;
  const seesRequisitions = canRaise || isApprover || role === 'AUDITORS';
  const seesCandidates = canSeePipeline || isManager;

  const [tab, setTab] = useState<Tab>(seesRequisitions ? 'requisitions' : 'referrals');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = (text: string, ok = true) => {
    setNotice({ ok, text });
    window.setTimeout(() => setNotice(null), 8000);
  };

  // Data
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [jobs, setJobs] = useState<JobOpening[]>([]);
  const [candidates, setCandidates] = useState<JobCandidate[]>([]);
  const [myInterviews, setMyInterviews] = useState<MyInterview[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);

  // Candidate filters
  const [jobFilter, setJobFilter] = useState('ALL');
  const [stageFilter, setStageFilter] = useState<'ALL' | JobCandidate['stage']>('ALL');
  const [search, setSearch] = useState('');

  const loadRequisitions = () =>
    seesRequisitions ? recruitmentService.getRequisitions().then((r) => setRequisitions(r.requisitions)).catch(() => {}) : Promise.resolve();
  const loadJobs = () => recruitmentService.getJobs().then((r) => setJobs(r.jobs)).catch(() => {});
  const loadCandidates = () =>
    seesCandidates
      ? recruitmentService
          .getCandidates({ includeArchived })
          .then((r) => setCandidates(r.candidates))
          .catch(() => {})
      : Promise.resolve();
  const loadInterviews = () => recruitmentService.getMyInterviews().then((r) => setMyInterviews(r.interviews)).catch(() => {});
  const loadReferrals = () => modulesService.getReferrals().then((r) => setReferrals(r.referrals)).catch(() => {});
  const reloadAll = () => Promise.all([loadRequisitions(), loadJobs(), loadCandidates(), loadInterviews(), loadReferrals()]);

  useEffect(() => {
    setLoading(true);
    reloadAll().finally(() => setLoading(false));
    employeeService
      .getDepartments()
      .then((r) => setDepartments(r.departments))
      .catch(() => {});
    if (isRecruiter) {
      employeeService
        .getEmployees()
        .then((r) => setEmployees(r.employees.filter((e) => !['TERMINATED', 'EXITED'].includes(e.status as string))))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeArchived]);

  const pendingOfferApprovals = candidates.filter((c) => c.offer?.status === 'PENDING_APPROVAL');
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'requisitions', label: `Requisitions (${requisitions.length})`, show: seesRequisitions },
    { id: 'candidates', label: `Candidates (${candidates.length})`, show: seesCandidates },
    { id: 'interviews', label: `My Interviews (${myInterviews.length})`, show: isManager || isRecruiter || myInterviews.length > 0 },
    { id: 'approvals', label: `Offer Approvals (${pendingOfferApprovals.length})`, show: isApprover },
    { id: 'referrals', label: isRecruiter ? `Referrals (${referrals.length})` : `My Referrals (${referrals.length})`, show: true },
  ];

  // ---------------------------------------------------------------- modals state
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fail = (err: any) => setErrors(apiErrorMessages(err));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErrors([]);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // Requisition
  const emptyReq = {
    title: '',
    department: '',
    positions: '1',
    budgetMin: '',
    budgetMax: '',
    description: '',
    justification: '',
    experienceRequired: '',
    skillsRequired: '',
    employmentType: 'FULL_TIME',
    priority: 'MEDIUM',
    location: '',
    expectedJoiningDate: '',
    hiringManagerId: '',
  };
  const [reqForm, setReqForm] = useState<typeof emptyReq | null>(null);
  const [reviewing, setReviewing] = useState<{ req: Requisition; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [publishing, setPublishing] = useState<Requisition | null>(null);
  const [channels, setChannels] = useState<string[]>(['CAREERS_PAGE']);

  // Candidate add / edit / duplicate
  const emptyCand = { jobId: '', fullName: '', email: '', phone: '', experienceYears: '', currentCompany: '', notes: '' };
  const [candForm, setCandForm] = useState<typeof emptyCand | null>(null);
  const [candResume, setCandResume] = useState<File | null>(null);
  const [duplicate, setDuplicate] = useState<any | null>(null);
  const [editing, setEditing] = useState<JobCandidate | null>(null);
  const [editForm, setEditForm] = useState({ fullName: '', email: '', phone: '', currentCompany: '' });

  // Interview, decision, panel feedback
  const [scheduling, setScheduling] = useState<JobCandidate | null>(null);
  const [schedForm, setSchedForm] = useState({
    roundName: '',
    date: dayOffset(2),
    time: '11:00',
    durationMinutes: 45,
    mode: 'VIDEO',
    locationOrLink: '',
    notes: '',
    panel: [] as string[],
  });
  const [panelSearch, setPanelSearch] = useState('');
  const [deciding, setDeciding] = useState<JobCandidate | null>(null);
  const [decision, setDecision] = useState({ justification: '', comments: '', recommendation: 'NEXT_ROUND' });
  const [giving, setGiving] = useState<MyInterview | null>(null);
  const [panelFb, setPanelFb] = useState({ rating: 4, comments: '', recommendation: 'HIRE' });

  // Offers, hire, reject
  const [offering, setOffering] = useState<JobCandidate | null>(null);
  const [offerForm, setOfferForm] = useState<OfferInput>({
    annualCtc: 0,
    designation: '',
    joiningDate: dayOffset(30),
    validTill: dayOffset(7),
    location: '',
    reportingTo: '',
    notes: '',
    revisionReason: '',
  });
  const [approving, setApproving] = useState<{ cand: JobCandidate; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [approveComment, setApproveComment] = useState('');
  const [converting, setConverting] = useState<JobCandidate | null>(null);
  const [convertForm, setConvertForm] = useState({ workEmail: '', panNumber: '', aadhaarNumber: '', department: '', joiningDate: '', phone: '' });
  const [rejecting, setRejecting] = useState<JobCandidate | null>(null);
  const [rejectForm, setRejectForm] = useState({ reason: '', notifyCandidate: true });

  // Referral
  const emptyRef = { fullName: '', email: '', phone: '', city: '', experienceYears: '', jobId: '', relationship: '', notes: '' };
  const [refForm, setRefForm] = useState<typeof emptyRef | null>(null);
  const [refResume, setRefResume] = useState<File | null>(null);

  const closeAll = () => {
    setErrors([]);
    setReqForm(null);
    setReviewing(null);
    setPublishing(null);
    setCandForm(null);
    setEditing(null);
    setScheduling(null);
    setDeciding(null);
    setGiving(null);
    setOffering(null);
    setApproving(null);
    setConverting(null);
    setRejecting(null);
    setRefForm(null);
  };

  const jobOf = (c: JobCandidate) => jobs.find((j) => j._id === c.jobId);
  // Maker-checker: nobody approves a requisition they raised or are the hiring manager of
  const myEmpId = user?.employee?._id || user?.employeeId;
  const isOwnRequisition = (r: Requisition) =>
    r.requestedByUserId === user?.id || (!!myEmpId && (r.requestedById === myEmpId || r.hiringManagerId === myEmpId));

  // ---------------------------------------------------------------- actions
  const submitRequisition = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqForm) return;
    run(async () => {
      const res = await recruitmentService.createRequisition({
        ...reqForm,
        positions: Number(reqForm.positions),
        budgetMin: Number(reqForm.budgetMin),
        budgetMax: Number(reqForm.budgetMax),
        hiringManagerId: reqForm.hiringManagerId || undefined,
      });
      closeAll();
      flash(res.message);
      setTab('requisitions');
      await loadRequisitions();
    });
  };

  const submitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewing) return;
    run(async () => {
      await recruitmentService.reviewRequisition(reviewing.req._id, reviewing.decision, reviewComment.trim() || undefined);
      closeAll();
      flash(`Requisition ${reviewing.decision.toLowerCase()}. ${reviewing.req.requestedByName} has been notified.`);
      await loadRequisitions();
    });
  };

  const submitPublish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!publishing) return;
    run(async () => {
      const res = await recruitmentService.publishRequisition(publishing._id, channels);
      closeAll();
      flash(`"${res.job.title}" published to ${channels.length} channel(s). It is now open for candidates.`);
      await Promise.all([loadRequisitions(), loadJobs()]);
    });
  };

  const submitCandidate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!candForm) return;
    if (candResume && (!/\.(pdf|doc|docx)$/i.test(candResume.name) || candResume.size > MAX_UPLOAD_BYTES)) {
      setErrors([`Resume must be a PDF, DOC or DOCX file up to ${MAX_UPLOAD_LABEL}.`]);
      return;
    }
    setBusy(true);
    setErrors([]);
    recruitmentService
      .addCandidate(candForm, candResume)
      .then(async (res) => {
        closeAll();
        flash(`${res.candidate.fullName} added to ${res.candidate.jobTitle}.`);
        await loadCandidates();
      })
      .catch((err) => {
        if (err?.status === 409 && err?.data?.duplicate) setDuplicate({ ...err.data.duplicate, message: err.message });
        else fail(err);
      })
      .finally(() => setBusy(false));
  };

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    run(async () => {
      await recruitmentService.updateCandidate(editing._id, editForm);
      closeAll();
      flash('Candidate details updated.');
      await loadCandidates();
    }).catch(() => {});
  };

  const submitSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduling) return;
    run(async () => {
      const res = await recruitmentService.scheduleInterview(scheduling._id, {
        ...schedForm,
        roundNumber: (scheduling.interviewRounds?.length || 0) + 1,
      });
      closeAll();
      flash(`${res.message} Sent from ${res.sentFrom}.`);
      await Promise.all([loadCandidates(), loadInterviews()]);
    });
  };

  const submitDecision = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deciding) return;
    const rounds = deciding.interviewRounds || [];
    const last = rounds[rounds.length - 1];
    run(async () => {
      await recruitmentService.recordDecision(deciding._id, {
        ...decision,
        round: last?.roundName,
        roundNumber: last?.roundNumber,
      });
      closeAll();
      flash('Round decision recorded.');
      await loadCandidates();
    });
  };

  const submitPanelFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!giving) return;
    run(async () => {
      await recruitmentService.submitPanelFeedback(giving.candidateId, giving.roundNumber, panelFb);
      closeAll();
      flash('Feedback submitted. It is now locked and shared with HR.');
      await Promise.all([loadInterviews(), loadCandidates()]);
    });
  };

  const openOffer = (c: JobCandidate) => {
    const job = jobOf(c);
    const current = c.offer;
    setErrors([]);
    setOfferForm({
      annualCtc: current?.annualCtc || job?.salaryBandMin || 0,
      designation: current?.designation || c.jobTitle || job?.title || '',
      joiningDate: current?.joiningDate || dayOffset(30),
      validTill: current?.validTill || dayOffset(7),
      location: current?.location || job?.location || '',
      reportingTo: current?.reportingTo || job?.hiringManagerName || '',
      notes: current?.notes || '',
      revisionReason: '',
    });
    setOffering(c);
  };

  const submitOffer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!offering) return;
    run(async () => {
      const res = await recruitmentService.extendOffer(offering._id, { ...offerForm, annualCtc: Number(offerForm.annualCtc) });
      closeAll();
      flash(res.message, !res.requiresApproval);
      await loadCandidates();
    });
  };

  const submitApproval = (e: React.FormEvent) => {
    e.preventDefault();
    if (!approving) return;
    run(async () => {
      const res = await recruitmentService.approveOffer(approving.cand._id, approving.decision, approveComment.trim() || undefined);
      closeAll();
      flash(
        approving.decision === 'APPROVED'
          ? `Offer approved and e-mailed from ${res.offer.sentFrom} to ${res.offer.sentTo}.`
          : 'Offer approval rejected. HR has been notified.'
      );
      await loadCandidates();
    });
  };

  const respond = async (c: JobCandidate, response: 'ACCEPTED' | 'DECLINED') => {
    if (!window.confirm(`Record that ${c.fullName} has ${response.toLowerCase()} the offer?`)) return;
    try {
      await recruitmentService.recordOfferResponse(c._id, response);
      flash(`Offer marked as ${response.toLowerCase()}.`);
      await loadCandidates();
    } catch (err: any) {
      flash(err.message, false);
    }
  };

  const submitConvert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!converting) return;
    run(async () => {
      const res = await recruitmentService.convertToEmployee(converting._id, convertForm);
      closeAll();
      flash(res.message);
      await loadCandidates();
    });
  };

  const submitReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejecting) return;
    run(async () => {
      const res = await recruitmentService.reject(rejecting._id, rejectForm.reason, rejectForm.notifyCandidate);
      closeAll();
      flash(res.message);
      await loadCandidates();
    });
  };

  const submitReferral = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refForm) return;
    if (!refResume) return setErrors(["Please attach the candidate's resume."]);
    if (!/\.(pdf|doc|docx)$/i.test(refResume.name) || refResume.size > MAX_UPLOAD_BYTES) {
      return setErrors([`Resume must be a PDF, DOC or DOCX file up to ${MAX_UPLOAD_LABEL}.`]);
    }
    run(async () => {
      await modulesService.submitReferral({ ...refForm, resume: refResume });
      closeAll();
      setTab('referrals');
      flash(`Thanks! ${refForm.fullName} has been referred. You can follow the status here.`);
      await loadReferrals();
    });
  };

  const moveReferralToPipeline = async (r: Referral) => {
    try {
      await modulesService.convertReferralToCandidate(r._id);
      flash(`${r.fullName} moved into the candidate pipeline.`);
      await Promise.all([loadReferrals(), loadCandidates()]);
    } catch (err: any) {
      if (err?.data?.duplicate) setDuplicate({ ...err.data.duplicate, message: err.message });
      else flash(err.message, false);
    }
  };

  // ---------------------------------------------------------------- derived
  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter(
      (c) =>
        (jobFilter === 'ALL' || c.jobId === jobFilter) &&
        (stageFilter === 'ALL' || c.stage === stageFilter) &&
        (!q || [c.fullName, c.email, c.phone, c.jobTitle].some((v) => (v || '').toLowerCase().includes(q)))
    );
  }, [candidates, jobFilter, stageFilter, search]);

  const panelOptions = useMemo(() => {
    const q = panelSearch.trim().toLowerCase();
    return employees
      .filter((e) => !q || `${e.firstName} ${e.lastName} ${e.designation} ${e.department}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [employees, panelSearch]);

  const selectedJob = offering ? jobOf(offering) : undefined;
  const offerAboveBand = !!selectedJob?.salaryBandMax && Number(offerForm.annualCtc) > selectedJob.salaryBandMax;

  // ---------------------------------------------------------------- render pieces
  const renderOfferHistory = (c: JobCandidate) => {
    const list: OfferVersion[] = c.offers?.length ? c.offers : c.offer ? [c.offer] : [];
    if (!list.length) return null;
    return (
      <div className="mt-2 bg-white rounded-xl border border-slate-200 p-2.5 space-y-1.5">
        <p className="text-[10px] font-bold uppercase text-slate-500">Offer history</p>
        {list
          .slice()
          .reverse()
          .map((o, i) => (
            <div key={`${o.version}-${i}`} className="text-[11px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono font-bold text-slate-700">v{o.version || 1}</span>
              <span className="font-semibold text-slate-900">{inr(o.annualCtc)}</span>
              <span className="text-slate-500">{o.designation}</span>
              <span className={`${chip} ${(OFFER_STATUS[o.status || 'SENT'] || OFFER_STATUS.SENT).style}`}>
                {(OFFER_STATUS[o.status || 'SENT'] || OFFER_STATUS.SENT).label}
              </span>
              {o.aboveBand && <span className="text-amber-700 font-semibold">above band (max {inr(o.salaryBandMax)})</span>}
              {o.sentTo && (
                <span className="text-slate-500">
                  e-mailed {o.sentFrom ? `from ${o.sentFrom} ` : ''}to <b>{o.sentTo}</b>
                  {o.emailStatus === 'SIMULATED' ? ' (simulated)' : ''}
                </span>
              )}
              {o.revisionReason && <span className="text-slate-500 italic">Reason: {o.revisionReason}</span>}
              {o.approval && (
                <span className="text-slate-500">
                  {o.approval.decision.toLowerCase()} by {o.approval.by}
                  {o.approval.comment ? `: "${o.approval.comment}"` : ''}
                </span>
              )}
            </div>
          ))}
      </div>
    );
  };

  const renderRounds = (c: JobCandidate) =>
    (c.interviewRounds || []).length > 0 && (
      <div className="mt-2 space-y-1.5">
        {(c.interviewRounds || []).map((r) => {
          const fbs = Object.values(r.panelFeedback || {});
          return (
            <div key={r.roundNumber} className="bg-white p-2.5 rounded-xl border border-slate-200 text-[11px] space-y-1">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <span className="font-bold text-primary">
                  {r.roundName} · {r.date} {r.time} IST · {r.mode.replace('_', ' ').toLowerCase()}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`${chip} ${r.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'}`}>
                    {r.status}
                  </span>
                  {r.calendarUid && (
                    <button
                      onClick={() => recruitmentService.downloadCalendar(c._id, r.roundNumber).catch((e) => flash(e.message, false))}
                      className="text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Calendar className="w-3 h-3" /> .ics
                    </button>
                  )}
                </span>
              </div>
              <p className="text-slate-500">Panel: {(r.panel || []).map((p) => p.name).join(', ') || r.interviewer}</p>
              {fbs.map((fb) => (
                <p key={fb.employeeId} className="text-slate-700 flex items-start gap-1.5">
                  <Lock className="w-3 h-3 mt-0.5 text-slate-400 shrink-0" />
                  <span>
                    <b>{fb.submittedBy}</b>: {fb.rating}/5 · {fb.recommendation.replace(/_/g, ' ').toLowerCase()} — {fb.comments}
                  </span>
                </p>
              ))}
            </div>
          );
        })}
      </div>
    );

  const renderCandidate = (c: JobCandidate) => {
    const offerStatus = c.offer?.status;
    const inInterviews = ['SHORTLISTED', 'TECHNICAL_INTERVIEW', 'HR_INTERVIEW'].includes(c.stage);
    const job = jobOf(c);
    return (
      <div key={c._id} className={`p-4 rounded-xl border text-xs ${c.archived ? 'bg-slate-50/60 border-dashed border-slate-300' : 'bg-slate-50 border-slate-200/80'}`}>
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-slate-900 text-sm">{c.fullName}</h4>
              <span
                className={`${chip} ${
                  c.stage === 'REJECTED' ? 'bg-rose-100 text-rose-800' : c.stage === 'HIRED' || c.stage === 'OFFERED' ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'
                }`}
              >
                {STAGE_LABEL[c.stage] || c.stage}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white border border-slate-200 text-slate-600">{c.jobTitle}</span>
              {c.source && <span className="text-[10px] text-slate-400">via {c.source.replace('_', ' ').toLowerCase()}</span>}
              {c.archived && <span className={`${chip} bg-slate-200 text-slate-700`}>Archived until {c.retainUntil}</span>}
            </div>
            <p className="text-slate-500 text-[11px] mt-0.5 flex flex-wrap gap-x-3">
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" /> {c.email}
              </span>
              {c.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {c.phone}
                </span>
              )}
              <span>{c.experienceYears} yrs exp</span>
              {c.currentCompany && <span>{c.currentCompany}</span>}
              {job?.hiringManagerName && <span>Hiring manager: {job.hiringManagerName}</span>}
            </p>
            {c.rejectionReason && <p className="text-[11px] text-rose-700 mt-1">Rejected: {c.rejectionReason}{c.rejectedBy ? ` (by ${c.rejectedBy})` : ''}</p>}
            {c.employeeCode && <p className="text-[11px] text-emerald-700 mt-1 font-semibold">Joined as employee {c.employeeCode}</p>}
            {renderRounds(c)}
            {renderOfferHistory(c)}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap lg:justify-end lg:max-w-[46%]">
            {c.hasResume && (
              <button onClick={() => recruitmentService.downloadResume(c._id, c.resumeFileName).catch((e) => flash(e.message, false))} className={actionBtn('bg-white border border-slate-300 text-slate-800 hover:bg-slate-50')}>
                <Download className="w-3.5 h-3.5" /> Resume
              </button>
            )}
            {isRecruiter && !c.archived && c.stage !== 'HIRED' && (
              <>
                {(c.stage === 'APPLIED' || c.stage === 'SCREENING') && (
                  <button
                    onClick={() =>
                      recruitmentService
                        .shortlist(c._id)
                        .then(() => {
                          flash(`${c.fullName} shortlisted. Schedule the interview next.`);
                          return loadCandidates();
                        })
                        .catch((e) => flash(e.message, false))
                    }
                    className={actionBtn('bg-indigo-600 hover:bg-indigo-700 text-white')}
                  >
                    <Star className="w-3.5 h-3.5" /> Shortlist
                  </button>
                )}
                {inInterviews && (
                  <button
                    onClick={() => {
                      setErrors([]);
                      const n = (c.interviewRounds?.length || 0) + 1;
                      setSchedForm({ roundName: `Round ${n}: ${n === 1 ? 'Technical Interview' : 'Interview'}`, date: dayOffset(2), time: '11:00', durationMinutes: 45, mode: 'VIDEO', locationOrLink: '', notes: '', panel: job?.hiringManagerId ? [job.hiringManagerId] : [] });
                      setPanelSearch('');
                      setScheduling(c);
                    }}
                    className={actionBtn('bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50')}
                  >
                    <Calendar className="w-3.5 h-3.5" /> Schedule interview
                  </button>
                )}
                {(c.interviewRounds?.length || 0) > 0 && inInterviews && (
                  <button
                    onClick={() => {
                      setErrors([]);
                      setDecision({ justification: '', comments: '', recommendation: 'NEXT_ROUND' });
                      setDeciding(c);
                    }}
                    className={actionBtn('bg-white border border-slate-300 text-slate-800 hover:bg-slate-50')}
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" /> Round decision
                  </button>
                )}
                {(inInterviews || c.stage === 'OFFERED') && offerStatus !== 'ACCEPTED' && offerStatus !== 'PENDING_APPROVAL' && (
                  <button onClick={() => openOffer(c)} className={actionBtn('bg-emerald-600 hover:bg-emerald-700 text-white')}>
                    <FileText className="w-3.5 h-3.5" /> {c.offer && ['SENT', 'DECLINED', 'APPROVAL_REJECTED'].includes(offerStatus || '') ? 'Revise offer' : 'Generate offer'}
                  </button>
                )}
                {offerStatus === 'SENT' && (
                  <>
                    <button onClick={() => respond(c, 'ACCEPTED')} className={actionBtn('bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100')}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Offer accepted
                    </button>
                    <button onClick={() => respond(c, 'DECLINED')} className={actionBtn('bg-white border border-slate-300 text-slate-700 hover:bg-slate-50')}>
                      Declined
                    </button>
                  </>
                )}
                {offerStatus === 'ACCEPTED' && canHire && (
                  <button
                    onClick={() => {
                      setErrors([]);
                      setConvertForm({ workEmail: '', panNumber: '', aadhaarNumber: '', department: job?.department || '', joiningDate: c.offer?.joiningDate || '', phone: c.phone || '' });
                      setConverting(c);
                    }}
                    className={actionBtn('bg-primary hover:bg-primary-hover text-white')}
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Convert to employee
                  </button>
                )}
                <button
                  onClick={() => {
                    setErrors([]);
                    setEditForm({ fullName: c.fullName, email: c.email, phone: c.phone || '', currentCompany: c.currentCompany || '' });
                    setEditing(c);
                  }}
                  className={actionBtn('bg-white border border-slate-300 text-slate-700 hover:bg-slate-50')}
                  title="Edit name, e-mail or mobile"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  onClick={() => {
                    setErrors([]);
                    setRejectForm({ reason: '', notifyCandidate: true });
                    setRejecting(c);
                  }}
                  className={actionBtn('bg-white border border-rose-200 text-rose-700 hover:bg-rose-50')}
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              </>
            )}
            {isApprover && offerStatus === 'PENDING_APPROVAL' && c.offer?.extendedByUserId === user?.id && (
              <span className="text-[11px] text-slate-500 italic">You generated this offer: another approver must approve it</span>
            )}
            {isApprover && offerStatus === 'PENDING_APPROVAL' && c.offer?.extendedByUserId !== user?.id && (
              <>
                <button onClick={() => { setErrors([]); setApproveComment(''); setApproving({ cand: c, decision: 'APPROVED' }); }} className={actionBtn('bg-emerald-600 hover:bg-emerald-700 text-white')}>
                  Approve offer
                </button>
                <button onClick={() => { setErrors([]); setApproveComment(''); setApproving({ cand: c, decision: 'REJECTED' }); }} className={actionBtn('bg-white border border-rose-200 text-rose-700 hover:bg-rose-50')}>
                  Reject offer
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------- page
  return (
    <div className="space-y-6">
      <div className="bg-primary text-white p-6 rounded-2xl border border-accent/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Recruitment & Hiring</h1>
          <p className="text-xs text-slate-300 mt-1">
            Requisition → budget approval → publish → interview → offer → hire
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRaise && (
            <button
              onClick={() => {
                setErrors([]);
                setReqForm({ ...emptyReq, department: user?.employee?.department || '' });
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold text-xs cursor-pointer"
            >
              <Briefcase className="w-4 h-4" /> Raise requisition
            </button>
          )}
          {isRecruiter && (
            <button
              onClick={() => {
                setErrors([]);
                setCandResume(null);
                setCandForm({ ...emptyCand, jobId: jobs.find((j) => j.status === 'OPEN')?._id || '' });
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold text-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Add candidate
            </button>
          )}
          <button
            hidden={isReadOnlyRole(role)}
            onClick={() => {
              setErrors([]);
              setRefResume(null);
              setRefForm(emptyRef);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs cursor-pointer border border-accent"
          >
            <UserPlus className="w-4 h-4" /> Refer a candidate
          </button>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-sm font-medium flex items-center justify-between gap-3 ${
            notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                tab === t.id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {loading && <p className="text-xs text-slate-500">Loading recruitment data...</p>}

      {/* ---------------------------------------------------------- requisitions */}
      {tab === 'requisitions' && seesRequisitions && (
        <div className="space-y-3">
          {requisitions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-400">
              No requisitions yet.{canRaise ? ' Use "Raise requisition" to request a new position.' : ''}
            </div>
          ) : (
            requisitions.map((r) => (
              <div key={r._id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs text-xs flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-slate-900 text-sm">{r.title}</h4>
                    <span className={`${chip} ${(REQ_STATUS[r.status] || REQ_STATUS.PENDING_APPROVAL).style}`}>
                      {(REQ_STATUS[r.status] || REQ_STATUS.PENDING_APPROVAL).label}
                    </span>
                    {r.priority && <span className="text-[10px] font-bold text-slate-500">{r.priority}</span>}
                  </div>
                  <p className="text-slate-600">
                    {r.department} · {r.positions} position{r.positions === 1 ? '' : 's'} · Budget{' '}
                    <b>{r.budgetMin ? `${inr(r.budgetMin)} – ${inr(r.budgetMax)}` : r.budgetRange || '—'}</b> per year
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Raised by {r.requestedByName}
                    {r.hiringManagerName && r.hiringManagerName !== r.requestedByName ? ` for ${r.hiringManagerName}` : ''} on {r.createdAt?.split('T')[0]}
                  </p>
                  {(r.description || r.justification) && <p className="text-slate-600 line-clamp-3">{r.description || r.justification}</p>}
                  {r.reviewedBy && (
                    <p className="text-[11px] text-slate-500">
                      {r.status === 'REJECTED' ? 'Rejected' : 'Approved'} by {r.reviewedBy}
                      {r.reviewNote ? `: "${r.reviewNote}"` : ''}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {isApprover && r.status === 'PENDING_APPROVAL' && isOwnRequisition(r) && (
                    <span className="text-[11px] text-slate-500 italic self-center">Raised by you: another approver must review it</span>
                  )}
                  {isApprover && r.status === 'PENDING_APPROVAL' && !isOwnRequisition(r) && (
                    <>
                      <button onClick={() => { setErrors([]); setReviewComment(''); setReviewing({ req: r, decision: 'APPROVED' }); }} className={actionBtn('bg-emerald-600 hover:bg-emerald-700 text-white')}>
                        Approve
                      </button>
                      <button onClick={() => { setErrors([]); setReviewComment(''); setReviewing({ req: r, decision: 'REJECTED' }); }} className={actionBtn('bg-white border border-rose-200 text-rose-700 hover:bg-rose-50')}>
                        Reject
                      </button>
                    </>
                  )}
                  {isRecruiter && r.status === 'APPROVED' && (
                    <button onClick={() => { setErrors([]); setChannels(['CAREERS_PAGE']); setPublishing(r); }} className={actionBtn('bg-indigo-600 hover:bg-indigo-700 text-white')}>
                      <Globe className="w-3.5 h-3.5" /> Publish job
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- candidates */}
      {tab === 'candidates' && seesCandidates && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-3 md:items-center justify-between">
            <div className="relative md:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, e-mail, mobile, job..." aria-label="Search candidates" className={`${inputCls} pl-9`} />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} aria-label="Job" className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <option value="ALL">All jobs</option>
                {jobs.map((j) => (
                  <option key={j._id} value={j._id}>
                    {j.title}
                  </option>
                ))}
              </select>
              <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as any)} aria-label="Stage" className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <option value="ALL">All stages</option>
                {STAGES.map((st) => (
                  <option key={st} value={st}>
                    {STAGE_LABEL[st]}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
                Show archived
              </label>
            </div>
          </div>
          {isManager && !canSeePipeline && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> You see candidates for your own requisitions and interviews you are on.
            </p>
          )}
          {filteredCandidates.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-400">No candidates match.</div>
          ) : (
            <div className="space-y-3">{filteredCandidates.map(renderCandidate)}</div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- my interviews */}
      {tab === 'interviews' && (
        <div className="space-y-3">
          {myInterviews.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-400">
              You are not on any interview panel yet.
            </div>
          ) : (
            myInterviews.map((i) => (
              <div key={`${i.candidateId}-${i.roundNumber}`} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs text-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 text-sm">
                    {i.candidateName} <span className="font-normal text-slate-500">· {i.jobTitle}</span>
                  </p>
                  <p className="text-slate-600">
                    {i.roundName} · {i.date} at {i.time} IST ({i.durationMinutes} min, {i.mode.replace('_', ' ').toLowerCase()})
                  </p>
                  <p className="text-slate-500 break-all">{i.locationOrLink}</p>
                  <p className="text-[11px] text-slate-400">Panel: {i.panel.join(', ')}</p>
                  {i.myFeedback && (
                    <p className="text-[11px] text-slate-700 flex items-start gap-1.5">
                      <Lock className="w-3 h-3 mt-0.5 text-slate-400" /> Your feedback ({i.myFeedback.rating}/5,{' '}
                      {i.myFeedback.recommendation.replace(/_/g, ' ').toLowerCase()}): {i.myFeedback.comments}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap">
                  {i.hasResume && (
                    <button onClick={() => recruitmentService.downloadResume(i.candidateId).catch((e) => flash(e.message, false))} className={actionBtn('bg-white border border-slate-300 text-slate-800 hover:bg-slate-50')}>
                      <Download className="w-3.5 h-3.5" /> Resume
                    </button>
                  )}
                  <button onClick={() => recruitmentService.downloadCalendar(i.candidateId, i.roundNumber).catch((e) => flash(e.message, false))} className={actionBtn('bg-white border border-slate-300 text-slate-800 hover:bg-slate-50')}>
                    <Calendar className="w-3.5 h-3.5" /> Add to calendar
                  </button>
                  {i.feedbackLocked ? (
                    <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 font-semibold flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" /> Feedback submitted
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setErrors([]);
                        setPanelFb({ rating: 4, comments: '', recommendation: 'HIRE' });
                        setGiving(i);
                      }}
                      className={actionBtn('bg-indigo-600 hover:bg-indigo-700 text-white')}
                    >
                      <Star className="w-3.5 h-3.5" /> Give feedback
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- offer approvals */}
      {tab === 'approvals' && isApprover && (
        <div className="space-y-3">
          {pendingOfferApprovals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-400">No offers are waiting for approval.</div>
          ) : (
            pendingOfferApprovals.map(renderCandidate)
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- referrals */}
      {tab === 'referrals' && (
        <div className="space-y-3">
          {!isRecruiter && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> You see only the people you referred and their status. Interview details stay with HR.
            </p>
          )}
          {referrals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-400">No referrals yet.</div>
          ) : (
            referrals.map((r) => (
              <div key={r._id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs text-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-slate-900 text-sm">{r.fullName}</h4>
                    <span className={`${chip} ${REF_STYLE[r.status]}`}>{REF_LABEL[r.status]}</span>
                  </div>
                  <p className="text-slate-500 flex flex-wrap gap-x-3">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {r.city}
                    </span>
                    <span>{r.experienceYears} yrs experience</span>
                    <span>For: {r.jobTitle || 'General referral'}</span>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {isRecruiter ? `Referred by ${r.referredByName} on ` : 'Referred on '}
                    {r.createdAt.split('T')[0]}
                  </p>
                  {isRecruiter && (
                    <p className="text-[11px] text-slate-500">
                      {r.email}
                      {r.phone ? ` · ${r.phone}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.hasResume && (
                    <button onClick={() => modulesService.downloadReferralResume(r._id, r.resumeFileName || 'resume').catch((e) => flash(e.message, false))} className={actionBtn('bg-white border border-slate-300 text-slate-800 hover:bg-slate-50')}>
                      <Download className="w-3.5 h-3.5" /> Resume
                    </button>
                  )}
                  {isRecruiter && (r.status === 'SUBMITTED' || r.status === 'IN_REVIEW') && (
                    <button onClick={() => moveReferralToPipeline(r)} className={actionBtn('bg-indigo-600 hover:bg-indigo-700 text-white')}>
                      <Send className="w-3.5 h-3.5" /> Move to pipeline
                    </button>
                  )}
                  {isRecruiter && (
                    <select
                      value={r.status}
                      aria-label="Referral status"
                      onChange={(e) =>
                        modulesService
                          .updateReferralStatus(r._id, e.target.value as ReferralStatus)
                          .then(loadReferrals)
                          .catch((err) => flash(err.message, false))
                      }
                      className="text-xs p-1.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
                    >
                      {(Object.keys(REF_LABEL) as ReferralStatus[]).map((k) => (
                        <option key={k} value={k}>
                          {REF_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ================================================================ modals */}

      {reqForm && (
        <Modal title="Raise job requisition" subtitle="Goes to Finance for budget approval, then HR publishes it." onClose={closeAll} wide>
          <form onSubmit={submitRequisition} className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Position / job title *">
                <input required value={reqForm.title} onChange={(e) => setReqForm({ ...reqForm, title: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Department *">
                <select required value={reqForm.department} onChange={(e) => setReqForm({ ...reqForm, department: e.target.value })} className={inputCls}>
                  <option value="">Select...</option>
                  {departments.map((d) => (
                    <option key={d._id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Number of positions *">
                <input required type="number" min={1} max={100} value={reqForm.positions} onChange={(e) => setReqForm({ ...reqForm, positions: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Employment type">
                <select value={reqForm.employmentType} onChange={(e) => setReqForm({ ...reqForm, employmentType: e.target.value })} className={inputCls}>
                  <option value="FULL_TIME">Full time</option>
                  <option value="PART_TIME">Part time</option>
                  <option value="CONTRACT">Contract</option>
                </select>
              </Field>
              <Field label="Budget: min annual CTC (₹) *">
                <input required type="number" min={1} value={reqForm.budgetMin} onChange={(e) => setReqForm({ ...reqForm, budgetMin: e.target.value })} className={inputCls} placeholder="1200000" />
              </Field>
              <Field label="Budget: max annual CTC (₹) *" hint="Offers above this need Finance approval.">
                <input required type="number" min={1} value={reqForm.budgetMax} onChange={(e) => setReqForm({ ...reqForm, budgetMax: e.target.value })} className={inputCls} placeholder="1800000" />
              </Field>
              <Field label="Experience required">
                <input value={reqForm.experienceRequired} onChange={(e) => setReqForm({ ...reqForm, experienceRequired: e.target.value })} className={inputCls} placeholder="3-5 years" />
              </Field>
              <Field label="Location">
                <input value={reqForm.location} onChange={(e) => setReqForm({ ...reqForm, location: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Priority">
                <select value={reqForm.priority} onChange={(e) => setReqForm({ ...reqForm, priority: e.target.value })} className={inputCls}>
                  {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
                    <option key={p} value={p}>
                      {p[0] + p.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              {isRecruiter ? (
                <Field label="Hiring manager" hint="Sees this requisition's candidates and joins the interview panel.">
                  <select value={reqForm.hiringManagerId} onChange={(e) => setReqForm({ ...reqForm, hiringManagerId: e.target.value })} className={inputCls}>
                    <option value="">Me</option>
                    {employees.map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.firstName} {m.lastName} ({m.designation})
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Expected joining date">
                  <input type="date" value={reqForm.expectedJoiningDate} onChange={(e) => setReqForm({ ...reqForm, expectedJoiningDate: e.target.value })} className={inputCls} />
                </Field>
              )}
            </div>
            <Field label="Key skills (comma separated)">
              <input value={reqForm.skillsRequired} onChange={(e) => setReqForm({ ...reqForm, skillsRequired: e.target.value })} className={inputCls} placeholder="Python, FastAPI, SQL" />
            </Field>
            <Field label="Job description (JD) *">
              <textarea required rows={4} value={reqForm.description} onChange={(e) => setReqForm({ ...reqForm, description: e.target.value })} className={inputCls} placeholder="Responsibilities, must-haves, nice-to-haves..." />
            </Field>
            <Field label="Business justification">
              <textarea rows={2} value={reqForm.justification} onChange={(e) => setReqForm({ ...reqForm, justification: e.target.value })} className={inputCls} />
            </Field>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Submit for approval" />
          </form>
        </Modal>
      )}

      {reviewing && (
        <Modal title={`${reviewing.decision === 'APPROVED' ? 'Approve' : 'Reject'} requisition`} subtitle={`${reviewing.req.title} · ${reviewing.req.budgetRange || ''}`} onClose={closeAll}>
          <form onSubmit={submitReview} className="space-y-3">
            <Field label={reviewing.decision === 'REJECTED' ? 'Comment (required) *' : 'Comment'}>
              <textarea rows={3} required={reviewing.decision === 'REJECTED'} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} className={inputCls} />
            </Field>
            <p className="text-[11px] text-slate-500">The requester is notified of your decision and comment.</p>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label={reviewing.decision === 'APPROVED' ? 'Approve budget' : 'Reject'} danger={reviewing.decision === 'REJECTED'} />
          </form>
        </Modal>
      )}

      {publishing && (
        <Modal title="Publish job" subtitle={publishing.title} onClose={closeAll}>
          <form onSubmit={submitPublish} className="space-y-3 text-xs">
            <p className="text-slate-600">Choose where to publish this approved requisition:</p>
            {CHANNELS.map((ch) => (
              <label key={ch.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={channels.includes(ch.value)}
                  onChange={(e) => setChannels(e.target.checked ? [...channels, ch.value] : channels.filter((x) => x !== ch.value))}
                />
                {ch.label}
              </label>
            ))}
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Publish" />
          </form>
        </Modal>
      )}

      {candForm && (
        <Modal title="Add candidate" subtitle="Enter details manually, optionally with the resume." onClose={closeAll} wide>
          <form onSubmit={submitCandidate} className="space-y-3 text-xs">
            <Field label="Job *">
              <select required value={candForm.jobId} onChange={(e) => setCandForm({ ...candForm, jobId: e.target.value })} className={inputCls}>
                <option value="">Select a job...</option>
                {jobs
                  .filter((j) => j.status === 'OPEN')
                  .map((j) => (
                    <option key={j._id} value={j._id}>
                      {j.title} — {j.department}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Full name *">
                <input required value={candForm.fullName} onChange={(e) => setCandForm({ ...candForm, fullName: e.target.value })} className={inputCls} />
              </Field>
              <Field label="E-mail *">
                <input required type="email" value={candForm.email} onChange={(e) => setCandForm({ ...candForm, email: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Mobile *">
                <input required value={candForm.phone} onChange={(e) => setCandForm({ ...candForm, phone: e.target.value })} className={inputCls} placeholder="98765 43210" />
              </Field>
              <Field label="Years of experience">
                <input type="number" min={0} max={60} step="0.5" value={candForm.experienceYears} onChange={(e) => setCandForm({ ...candForm, experienceYears: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Current company">
                <input value={candForm.currentCompany} onChange={(e) => setCandForm({ ...candForm, currentCompany: e.target.value })} className={inputCls} />
              </Field>
              <Field label={`Resume (PDF, DOC, DOCX · max ${MAX_UPLOAD_LABEL})`}>
                <input type="file" accept=".pdf,.doc,.docx" aria-label="Resume" onChange={(e) => setCandResume(e.target.files?.[0] || null)} className="text-xs file:mr-2 file:px-2.5 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary file:text-white file:cursor-pointer" />
              </Field>
            </div>
            <Field label="Notes">
              <textarea rows={2} value={candForm.notes} onChange={(e) => setCandForm({ ...candForm, notes: e.target.value })} className={inputCls} />
            </Field>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Add candidate" />
          </form>
        </Modal>
      )}

      {duplicate && (
        <Modal title="Duplicate candidate" onClose={() => setDuplicate(null)}>
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>A candidate with the same {(duplicate.matchedOn || []).join(' and ')} already exists. The new record was not created.</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <p className="font-bold text-slate-900">{duplicate.fullName}</p>
              <p className="text-slate-600">
                {duplicate.email}
                {duplicate.phone ? ` · ${duplicate.phone}` : ''}
              </p>
              <p className="text-slate-500">
                {duplicate.jobTitle} · {STAGE_LABEL[duplicate.stage] || duplicate.stage}
                {duplicate.archived ? ' · archived' : ''}
              </p>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setDuplicate(null)} className={btnPrimary}>
                OK
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title="Edit candidate" subtitle="Changes are recorded in the audit log." onClose={closeAll}>
          <form onSubmit={submitEdit} className="space-y-3 text-xs">
            <Field label="Full name">
              <input required value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} className={inputCls} />
            </Field>
            <Field label="E-mail" hint="Offer and interview e-mails go to this address.">
              <input required type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Mobile">
              <input required value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Current company">
              <input value={editForm.currentCompany} onChange={(e) => setEditForm({ ...editForm, currentCompany: e.target.value })} className={inputCls} />
            </Field>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Save" />
          </form>
        </Modal>
      )}

      {scheduling && (
        <Modal title="Schedule interview" subtitle={`${scheduling.fullName} · ${scheduling.jobTitle}`} onClose={closeAll} wide>
          <form onSubmit={submitSchedule} className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Round name *">
                <input required value={schedForm.roundName} onChange={(e) => setSchedForm({ ...schedForm, roundName: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Mode *">
                <select value={schedForm.mode} onChange={(e) => setSchedForm({ ...schedForm, mode: e.target.value })} className={inputCls}>
                  <option value="VIDEO">Video call</option>
                  <option value="IN_PERSON">In person</option>
                  <option value="PHONE">Phone</option>
                </select>
              </Field>
              <Field label="Date *">
                <input required type="date" min={dayOffset(0)} value={schedForm.date} onChange={(e) => setSchedForm({ ...schedForm, date: e.target.value })} className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Time (IST) *">
                  <input required type="time" value={schedForm.time} onChange={(e) => setSchedForm({ ...schedForm, time: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Duration">
                  <select value={schedForm.durationMinutes} onChange={(e) => setSchedForm({ ...schedForm, durationMinutes: Number(e.target.value) })} className={inputCls}>
                    {[30, 45, 60, 90].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            <Field label={schedForm.mode === 'IN_PERSON' ? 'Venue *' : schedForm.mode === 'VIDEO' ? 'Meeting link *' : 'Phone number *'}>
              <input required value={schedForm.locationOrLink} onChange={(e) => setSchedForm({ ...schedForm, locationOrLink: e.target.value })} className={inputCls} />
            </Field>
            <Field label={`Interview panel * (${schedForm.panel.length} selected)`} hint="Each panel member gets the invite with a calendar entry and can give feedback.">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {schedForm.panel.map((id) => {
                  const e = employees.find((x) => x._id === id);
                  return (
                    <span key={id} className="px-2 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 font-semibold flex items-center gap-1">
                      {e ? `${e.firstName} ${e.lastName}` : id}
                      <button type="button" aria-label="Remove" onClick={() => setSchedForm({ ...schedForm, panel: schedForm.panel.filter((x) => x !== id) })} className="cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
              <input value={panelSearch} onChange={(e) => setPanelSearch(e.target.value)} placeholder="Search employees to add..." className={inputCls} />
              <div className="mt-1 max-h-36 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {panelOptions
                  .filter((e) => !schedForm.panel.includes(e._id))
                  .map((e) => (
                    <button
                      type="button"
                      key={e._id}
                      onClick={() => setSchedForm({ ...schedForm, panel: [...schedForm.panel, e._id] })}
                      className="w-full text-left px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
                    >
                      <b>
                        {e.firstName} {e.lastName}
                      </b>{' '}
                      <span className="text-slate-500">
                        · {e.designation} · {e.department}
                      </span>
                    </button>
                  ))}
              </div>
            </Field>
            <Field label="Notes for candidate">
              <textarea rows={2} value={schedForm.notes} onChange={(e) => setSchedForm({ ...schedForm, notes: e.target.value })} className={inputCls} />
            </Field>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Send invites" />
          </form>
        </Modal>
      )}

      {deciding && (
        <Modal title="Round decision" subtitle={`${deciding.fullName} · ${deciding.interviewRounds?.[deciding.interviewRounds.length - 1]?.roundName || ''}`} onClose={closeAll}>
          <form onSubmit={submitDecision} className="space-y-3 text-xs">
            <Field label="Decision *">
              <select value={decision.recommendation} onChange={(e) => setDecision({ ...decision, recommendation: e.target.value })} className={inputCls}>
                <option value="NEXT_ROUND">Move to next round</option>
                <option value="READY_FOR_OFFER">Cleared — ready for offer</option>
                <option value="REJECT">Reject (archives the candidate and e-mails them)</option>
              </select>
            </Field>
            <Field label="Justification *">
              <textarea required rows={2} value={decision.justification} onChange={(e) => setDecision({ ...decision, justification: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Confidential HR comments">
              <textarea rows={2} value={decision.comments} onChange={(e) => setDecision({ ...decision, comments: e.target.value })} className={inputCls} />
            </Field>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Save decision" danger={decision.recommendation === 'REJECT'} />
          </form>
        </Modal>
      )}

      {giving && (
        <Modal title="Interview feedback" subtitle={`${giving.candidateName} · ${giving.roundName}`} onClose={closeAll}>
          <form onSubmit={submitPanelFeedback} className="space-y-3 text-xs">
            <Field label="Rating *">
              <div className="flex gap-1.5" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    role="radio"
                    aria-checked={panelFb.rating === n}
                    onClick={() => setPanelFb({ ...panelFb, rating: n })}
                    className={`w-10 h-10 rounded-xl border font-bold cursor-pointer ${panelFb.rating >= n ? 'bg-amber-400 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-400'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Recommendation *">
              <select value={panelFb.recommendation} onChange={(e) => setPanelFb({ ...panelFb, recommendation: e.target.value })} className={inputCls}>
                {RECOMMENDATIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Comments *">
              <textarea required minLength={10} rows={4} value={panelFb.comments} onChange={(e) => setPanelFb({ ...panelFb, comments: e.target.value })} className={inputCls} placeholder="Strengths, gaps, evidence..." />
            </Field>
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Feedback is locked once submitted and cannot be edited.
            </p>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Submit & lock" />
          </form>
        </Modal>
      )}

      {offering && (
        <Modal title={offering.offer && offering.offer.status !== 'APPROVAL_REJECTED' ? 'Revise offer' : 'Generate offer letter'} subtitle={`${offering.fullName} · sent to ${offering.email}`} onClose={closeAll} wide>
          <form onSubmit={submitOffer} className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600">
              Approved salary band:{' '}
              <b>{selectedJob?.salaryBandMax ? `${inr(selectedJob.salaryBandMin)} – ${inr(selectedJob.salaryBandMax)}` : 'not set for this job'}</b>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Annual CTC (₹) *">
                <input required type="number" min={100000} value={offerForm.annualCtc || ''} onChange={(e) => setOfferForm({ ...offerForm, annualCtc: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Designation *">
                <input required value={offerForm.designation} onChange={(e) => setOfferForm({ ...offerForm, designation: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Date of joining *">
                <input required type="date" value={offerForm.joiningDate} onChange={(e) => setOfferForm({ ...offerForm, joiningDate: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Offer valid till *">
                <input required type="date" value={offerForm.validTill} onChange={(e) => setOfferForm({ ...offerForm, validTill: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Work location *">
                <input required value={offerForm.location} onChange={(e) => setOfferForm({ ...offerForm, location: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Reporting to">
                <input value={offerForm.reportingTo} onChange={(e) => setOfferForm({ ...offerForm, reportingTo: e.target.value })} className={inputCls} />
              </Field>
            </div>
            {offering.offer && ['SENT', 'DECLINED'].includes(offering.offer.status || '') && (
              <Field label="Reason for revision *" hint="The earlier offer is kept in the offer history as superseded.">
                <input required value={offerForm.revisionReason} onChange={(e) => setOfferForm({ ...offerForm, revisionReason: e.target.value })} className={inputCls} />
              </Field>
            )}
            <Field label="Additional terms">
              <textarea rows={2} value={offerForm.notes} onChange={(e) => setOfferForm({ ...offerForm, notes: e.target.value })} className={inputCls} />
            </Field>
            {offerAboveBand && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                Above the band maximum. The offer will go to Finance / Super Admin for approval and is e-mailed only after approval.
              </div>
            )}
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label={offerAboveBand ? 'Send for approval' : 'Generate & e-mail offer'} />
          </form>
        </Modal>
      )}

      {approving && (
        <Modal
          title={approving.decision === 'APPROVED' ? 'Approve above-band offer' : 'Reject above-band offer'}
          subtitle={`${approving.cand.fullName}: ${inr(approving.cand.offer?.annualCtc)} vs band max ${inr(approving.cand.offer?.salaryBandMax)}`}
          onClose={closeAll}
        >
          <form onSubmit={submitApproval} className="space-y-3 text-xs">
            <Field label={approving.decision === 'REJECTED' ? 'Comment (required) *' : 'Comment'}>
              <textarea rows={3} required={approving.decision === 'REJECTED'} value={approveComment} onChange={(e) => setApproveComment(e.target.value)} className={inputCls} />
            </Field>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label={approving.decision === 'APPROVED' ? 'Approve & send offer' : 'Reject'} danger={approving.decision === 'REJECTED'} />
          </form>
        </Modal>
      )}

      {converting && (
        <Modal title="Convert to employee" subtitle="Creates the Core HR record from the candidate and offer details." onClose={closeAll} wide>
          <form onSubmit={submitConvert} className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
              <span>Name: <b>{converting.fullName}</b></span>
              <span>Personal e-mail: <b>{converting.email}</b></span>
              <span>Designation: <b>{converting.offer?.designation}</b></span>
              <span>CTC: <b>{inr(converting.offer?.annualCtc)}</b></span>
              <span>Reporting to: <b>{jobOf(converting)?.hiringManagerName || converting.offer?.reportingTo || '—'}</b></span>
              <span>Offer: <b>v{converting.offer?.version || 1} accepted</b></span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Work e-mail (login) *">
                <input required type="email" value={convertForm.workEmail} onChange={(e) => setConvertForm({ ...convertForm, workEmail: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Date of joining *">
                <input required type="date" value={convertForm.joiningDate} onChange={(e) => setConvertForm({ ...convertForm, joiningDate: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Department *">
                <select required value={convertForm.department} onChange={(e) => setConvertForm({ ...convertForm, department: e.target.value })} className={inputCls}>
                  <option value="">Select...</option>
                  {departments.map((d) => (
                    <option key={d._id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Mobile *">
                <input required value={convertForm.phone} onChange={(e) => setConvertForm({ ...convertForm, phone: e.target.value })} className={inputCls} />
              </Field>
              <Field label="PAN *">
                <input required maxLength={10} value={convertForm.panNumber} onChange={(e) => setConvertForm({ ...convertForm, panNumber: e.target.value.toUpperCase() })} className={`${inputCls} font-mono uppercase`} placeholder="ABCDE1234F" />
              </Field>
              <Field label="Aadhaar *">
                <input required inputMode="numeric" maxLength={14} value={convertForm.aadhaarNumber} onChange={(e) => setConvertForm({ ...convertForm, aadhaarNumber: e.target.value })} className={`${inputCls} font-mono`} />
              </Field>
            </div>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Create employee" />
          </form>
        </Modal>
      )}

      {rejecting && (
        <Modal title="Reject candidate" subtitle={`${rejecting.fullName} · ${rejecting.jobTitle}`} onClose={closeAll}>
          <form onSubmit={submitReject} className="space-y-3 text-xs">
            <Field label="Reason for rejection *" hint="Kept on the candidate record and in the audit log (not sent to the candidate).">
              <textarea required minLength={5} rows={3} value={rejectForm.reason} onChange={(e) => setRejectForm({ ...rejectForm, reason: e.target.value })} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={rejectForm.notifyCandidate} onChange={(e) => setRejectForm({ ...rejectForm, notifyCandidate: e.target.checked })} />
              E-mail the candidate a polite rejection
            </label>
            <p className="text-[11px] text-slate-500">
              The candidate is archived (hidden from the active pipeline) and kept for 180 days under the data-retention policy.
            </p>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Reject & archive" danger />
          </form>
        </Modal>
      )}

      {refForm && (
        <Modal title="Refer a candidate" onClose={closeAll}>
          <form onSubmit={submitReferral} className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Candidate name *">
                <input required value={refForm.fullName} onChange={(e) => setRefForm({ ...refForm, fullName: e.target.value })} className={inputCls} />
              </Field>
              <Field label="City *">
                <input required value={refForm.city} onChange={(e) => setRefForm({ ...refForm, city: e.target.value })} className={inputCls} />
              </Field>
              <Field label="E-mail *">
                <input required type="email" value={refForm.email} onChange={(e) => setRefForm({ ...refForm, email: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Mobile">
                <input value={refForm.phone} onChange={(e) => setRefForm({ ...refForm, phone: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Years of experience *">
                <input required type="number" min={0} max={60} step="0.5" value={refForm.experienceYears} onChange={(e) => setRefForm({ ...refForm, experienceYears: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Your relationship">
                <input value={refForm.relationship} onChange={(e) => setRefForm({ ...refForm, relationship: e.target.value })} className={inputCls} placeholder="Ex-colleague, friend..." />
              </Field>
            </div>
            <Field label="Referring for">
              <select value={refForm.jobId} onChange={(e) => setRefForm({ ...refForm, jobId: e.target.value })} className={inputCls}>
                <option value="">General referral</option>
                {jobs
                  .filter((j) => j.status === 'OPEN')
                  .map((j) => (
                    <option key={j._id} value={j._id}>
                      {j.title} — {j.department}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={`Resume * (PDF, DOC, DOCX · max ${MAX_UPLOAD_LABEL})`}>
              <input type="file" accept=".pdf,.doc,.docx" aria-label="Resume" onChange={(e) => setRefResume(e.target.files?.[0] || null)} className="text-xs file:mr-2 file:px-2.5 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary file:text-white file:cursor-pointer" />
            </Field>
            <Field label="Why are they a good fit?">
              <textarea rows={2} value={refForm.notes} onChange={(e) => setRefForm({ ...refForm, notes: e.target.value })} className={inputCls} />
            </Field>
            <Errors errors={errors} />
            <Footer onCancel={closeAll} busy={busy} label="Submit referral" />
          </form>
        </Modal>
      )}
    </div>
  );
};
