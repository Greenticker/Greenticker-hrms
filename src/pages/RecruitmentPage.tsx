import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { JobOpening, JobCandidate, Referral, ReferralStatus } from '../types/modules';
import {
  Briefcase,
  Users,
  Search,
  MapPin,
  CheckCircle2,
  X,
  UserPlus,
  FileText,
  Download,
  Mail,
  Phone,
  Calendar,
  DollarSign,
  Clock,
  Building,
} from 'lucide-react';

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const STATUS_LABEL: Record<ReferralStatus, string> = {
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  SHORTLISTED: 'Shortlisted',
  HIRED: 'Hired',
  NOT_SELECTED: 'Not selected',
};

const STATUS_STYLE: Record<ReferralStatus, string> = {
  SUBMITTED: 'bg-slate-100 text-slate-700',
  IN_REVIEW: 'bg-amber-100 text-amber-800',
  SHORTLISTED: 'bg-indigo-100 text-indigo-800',
  HIRED: 'bg-emerald-100 text-emerald-800',
  NOT_SELECTED: 'bg-rose-100 text-rose-800',
};

const emptyForm = {
  fullName: '',
  email: '',
  phone: '',
  city: '',
  experienceYears: '',
  jobId: '',
  relationship: '',
  notes: '',
};

export const RecruitmentPage: React.FC = () => {
  const { user } = useAuth();
  const isHr = user?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<'pipeline' | 'referrals' | 'openings' | 'candidates'>(isHr ? 'pipeline' : 'referrals');
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [refSearch, setRefSearch] = useState('');
  const [refStatusFilter, setRefStatusFilter] = useState<'ALL' | ReferralStatus>('ALL');
  const [isReferOpen, setIsReferOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [jobs, setJobs] = useState<JobOpening[]>([]);
  const [candidates, setCandidates] = useState<JobCandidate[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  // "All Candidates" tab (HR/Admin): every candidate across all openings
  const [allCandidates, setAllCandidates] = useState<JobCandidate[]>([]);
  const [candSearch, setCandSearch] = useState('');
  const [candStageFilter, setCandStageFilter] = useState<'ALL' | JobCandidate['stage']>('ALL');
  const [loading, setLoading] = useState(true);

  // Interview modal state
  const [interviewCand, setInterviewCand] = useState<JobCandidate | null>(null);
  const [interviewForm, setInterviewForm] = useState({
    date: new Date().toISOString().split('T')[0],
    time: '10:00',
    durationMinutes: 45,
    mode: 'VIDEO' as 'IN_PERSON' | 'VIDEO' | 'PHONE',
    locationOrLink: 'https://meet.google.com/anusyuti-hr-interview',
    interviewer: 'Aditya Kapoor (HR Lead)',
    notes: 'Please review portfolio and resume before the call.',
  });

  // Offer modal state
  const [offerCand, setOfferCand] = useState<JobCandidate | null>(null);
  const [offerForm, setOfferForm] = useState({
    annualCtc: 1800000,
    designation: '',
    location: 'Bengaluru HQ (Prestige Tech Park)',
    joiningDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    validTill: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    reportingTo: 'Ananya Mehta (CEO)',
    notes: 'Standard enterprise employment terms apply.',
  });

  // Feedback modal state
  const [feedbackCand, setFeedbackCand] = useState<JobCandidate | null>(null);
  const [feedbackRound, setFeedbackRound] = useState<'TECHNICAL_INTERVIEW' | 'HR_INTERVIEW'>('TECHNICAL_INTERVIEW');
  const [feedbackForm, setFeedbackForm] = useState({
    rating: 5,
    comments: '',
    recommendation: 'NEXT_ROUND' as 'NEXT_ROUND' | 'REJECT',
  });

  const handleOpenFeedback = (cand: JobCandidate, round: 'TECHNICAL_INTERVIEW' | 'HR_INTERVIEW') => {
    setFeedbackCand(cand);
    setFeedbackRound(round);
    setFeedbackForm({
      rating: 5,
      comments: '',
      recommendation: 'NEXT_ROUND',
    });
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackCand) return;
    try {
      const res = await modulesService.submitFeedback(feedbackCand._id, {
        round: feedbackRound,
        ...feedbackForm,
      });
      setFeedbackCand(null);
      setNotice(res.message || 'Interview feedback submitted successfully.');
      setTimeout(() => setNotice(null), 6000);
      await reloadCandidates();
    } catch (err: any) {
      alert(err?.message || 'Failed to submit interview feedback.');
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const jRes = await modulesService.getJobOpenings();
        const fetchedJobs = jRes?.jobs || [];
        setJobs(fetchedJobs);
        await loadReferrals();
        if (isHr) await loadAllCandidates();
        if (isHr && fetchedJobs.length > 0) {
          const firstJobId = fetchedJobs[0]?._id;
          if (firstJobId) {
            setSelectedJobId(firstJobId);
            const cRes = await modulesService.getJobCandidates(firstJobId);
            setCandidates(cRes?.candidates || []);
          }
        }
      } catch (err) {
        console.error('Failed to load recruitment data', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const loadReferrals = async () => {
    try {
      const res = await modulesService.getReferrals();
      setReferrals(res.referrals);
    } catch (err) {
      console.error('Failed to load referrals', err);
    }
  };

  // Every candidate across all job openings (server returns all when no jobId is given)
  const loadAllCandidates = async () => {
    try {
      const res = await modulesService.getJobCandidates();
      setAllCandidates(res?.candidates || []);
    } catch (err) {
      console.error('Failed to load candidates', err);
    }
  };

  // Refresh both the selected job's pipeline and the All Candidates list
  const reloadCandidates = async () => {
    if (selectedJobId) {
      const cRes = await modulesService.getJobCandidates(selectedJobId);
      setCandidates(cRes.candidates);
    }
    await loadAllCandidates();
  };

  const openReferForm = () => {
    setForm(emptyForm);
    setResumeFile(null);
    setFormError(null);
    setIsReferOpen(true);
  };

  const handleResumePick = (file: File | null) => {
    setFormError(null);
    if (!file) return setResumeFile(null);
    const ok = /\.(pdf|doc|docx)$/i.test(file.name);
    if (!ok) {
      setResumeFile(null);
      return setFormError('Resume must be a PDF, DOC or DOCX file.');
    }
    if (file.size > MAX_RESUME_BYTES) {
      setResumeFile(null);
      return setFormError('Resume must be 5 MB or smaller.');
    }
    setResumeFile(file);
  };

  const handleSubmitReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!resumeFile) return setFormError("Please attach the candidate's resume.");
    const years = Number(form.experienceYears);
    if (form.experienceYears === '' || !Number.isFinite(years) || years < 0 || years > 60) {
      return setFormError('Enter years of experience as a number (0 for freshers).');
    }

    setIsSubmitting(true);
    try {
      await modulesService.submitReferral({ ...form, resume: resumeFile });
      setIsReferOpen(false);
      setActiveTab('referrals');
      setNotice(`Thanks! ${form.fullName} has been referred and is now visible in the Referrals list.`);
      await loadReferrals();
      setTimeout(() => setNotice(null), 6000);
    } catch (err: any) {
      setFormError(err?.message || 'Could not submit the referral. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReferralStatus = async (id: string, status: ReferralStatus) => {
    try {
      await modulesService.updateReferralStatus(id, status);
      await loadReferrals();
    } catch (err) {
      console.error(err);
    }
  };

  const handleResumeDownload = async (r: Referral) => {
    try {
      await modulesService.downloadReferralResume(r._id, r.resumeFileName || 'resume');
    } catch (err: any) {
      setNotice(err?.message || 'Could not download resume.');
      setTimeout(() => setNotice(null), 5000);
    }
  };

  const filteredReferrals = referrals.filter((r) => {
    const q = refSearch.toLowerCase();
    const matches =
      !q ||
      r.fullName.toLowerCase().includes(q) ||
      r.city.toLowerCase().includes(q) ||
      (r.jobTitle || '').toLowerCase().includes(q) ||
      r.referredByName.toLowerCase().includes(q);
    return matches && (refStatusFilter === 'ALL' || r.status === refStatusFilter);
  });

  const handleSelectJob = async (jobId: string) => {
    setSelectedJobId(jobId);
    try {
      const cRes = await modulesService.getJobCandidates(jobId);
      setCandidates(cRes.candidates);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenInterview = (cand: JobCandidate) => {
    setInterviewCand(cand);
    setInterviewForm({
      date: new Date().toISOString().split('T')[0],
      time: '10:00',
      durationMinutes: 45,
      mode: 'VIDEO',
      locationOrLink: 'https://meet.google.com/anusyuti-hr-interview',
      interviewer: user ? `${user.firstName} ${user.lastName}` : 'HR Team',
      notes: 'Please review portfolio and resume before the call.',
    });
  };

  const handleSubmitInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interviewCand) return;
    try {
      const res = await modulesService.scheduleInterview(interviewCand._id, interviewForm);
      setInterviewCand(null);
      setNotice(res.message || 'Interview scheduled and invitation e-mailed successfully.');
      setTimeout(() => setNotice(null), 6000);
      await reloadCandidates();
    } catch (err: any) {
      alert(err?.message || 'Failed to schedule interview.');
    }
  };

  const handleOpenOffer = (cand: JobCandidate) => {
    setOfferCand(cand);
    const j = (jobs || []).find((job) => job._id === cand.jobId);
    setOfferForm({
      annualCtc: cand.offer?.annualCtc || 1800000,
      designation: cand.jobTitle || j?.title || 'Software Engineer',
      location: j?.location || 'Bengaluru HQ (Prestige Tech Park)',
      joiningDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      validTill: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      reportingTo: 'Ananya Mehta (CEO)',
      notes: 'Standard enterprise employment terms apply.',
    });
  };

  const handleSubmitOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offerCand) return;
    try {
      const res = await modulesService.extendOffer(offerCand._id, offerForm);
      setOfferCand(null);
      setNotice(res.message || 'Offer letter e-mailed successfully.');
      setTimeout(() => setNotice(null), 6000);
      await reloadCandidates();
    } catch (err: any) {
      alert(err?.message || 'Failed to extend offer.');
    }
  };

  const handleRejectCandidate = async (cand: JobCandidate) => {
    try {
      await modulesService.rejectCandidate(cand._id);
      setNotice(`Candidate ${cand.fullName} has been rejected and notified via e-mail.`);
      setTimeout(() => setNotice(null), 6000);
      await reloadCandidates();
    } catch (err: any) {
      alert(err?.message || 'Failed to reject candidate.');
    }
  };

  const stageStyle = (stage: JobCandidate['stage']) =>
    stage === 'OFFERED' || stage === 'HIRED'
      ? 'bg-emerald-100 text-emerald-800'
      : stage === 'TECHNICAL_INTERVIEW' || stage === 'HR_INTERVIEW'
      ? 'bg-indigo-100 text-indigo-800'
      : stage === 'REJECTED'
      ? 'bg-rose-100 text-rose-800'
      : 'bg-amber-100 text-amber-800';

  // One candidate row, shared by the Job Pipeline and All Candidates tabs
  const renderCandidateCard = (cand: JobCandidate, showJobTitle: boolean) => (
    <div
      key={cand._id}
      className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
    >
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-bold text-slate-900 text-sm">{cand.fullName}</h4>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${stageStyle(cand.stage)}`}>
            {cand.stage.replace('_', ' ')}
          </span>
          {showJobTitle && (
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white border border-slate-200 text-slate-600">
              {cand.jobTitle || 'General'}
            </span>
          )}
        </div>
        <p className="text-slate-500 text-[11px] mt-0.5">
          {cand.currentCompany || 'Freelance'} • {cand.experienceYears} Years Exp • {cand.email}
          {cand.phone ? ` • ${cand.phone}` : ''}
        </p>
        {cand.notes && <p className="text-[11px] text-slate-600 mt-1 italic">"{cand.notes}"</p>}
        {cand.interview && (cand.stage === 'TECHNICAL_INTERVIEW' || cand.stage === 'HR_INTERVIEW') && (
          <p className="text-[11px] text-indigo-700 mt-1 font-mono">
            📅 Interview: {cand.interview.date} at {cand.interview.time} ({cand.interview.mode}) with {cand.interview.interviewer}
          </p>
        )}
        {cand.interviewFeedbacks && cand.interviewFeedbacks.length > 0 && (
          <div className="mt-2 space-y-1">
            {cand.interviewFeedbacks.map((fb: any, idx: number) => (
              <p key={idx} className="text-[11px] text-slate-700 bg-white p-2 rounded-lg border border-slate-200">
                <span className="font-bold text-[#023b77]">{fb.round === 'TECHNICAL_INTERVIEW' ? 'Technical Feedback' : 'HR Feedback'}:</span> {fb.comments} (Rating: {fb.rating}/5, Recommendation: <span className="font-semibold">{fb.recommendation === 'NEXT_ROUND' ? 'Next Round / Pass' : 'Reject'}</span>)
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {cand.stage === 'SCREENING' && (
          <button
            onClick={() => handleOpenInterview(cand)}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs cursor-pointer flex items-center gap-1"
          >
            <Calendar className="w-3.5 h-3.5" /> Schedule Technical Interview
          </button>
        )}
        {cand.stage === 'TECHNICAL_INTERVIEW' && (
          <button
            onClick={() => handleOpenFeedback(cand, 'TECHNICAL_INTERVIEW')}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs cursor-pointer flex items-center gap-1"
          >
            <FileText className="w-3.5 h-3.5" /> Technical Feedback & Next Round
          </button>
        )}
        {cand.stage === 'HR_INTERVIEW' && (
          <button
            onClick={() => handleOpenFeedback(cand, 'HR_INTERVIEW')}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs cursor-pointer flex items-center gap-1"
          >
            <FileText className="w-3.5 h-3.5" /> HR Feedback & Offer
          </button>
        )}
        {cand.stage === 'OFFERED' && (
          <button
            onClick={() => handleOpenOffer(cand)}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs cursor-pointer flex items-center gap-1"
          >
            <FileText className="w-3.5 h-3.5" /> Extend Offer
          </button>
        )}
        {cand.stage !== 'REJECTED' && cand.stage !== 'HIRED' && (
          <button
            onClick={() => handleRejectCandidate(cand)}
            className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold text-xs cursor-pointer"
          >
            Reject
          </button>
        )}
        {cand.stage === 'OFFERED' && (
          <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> Offer Extended
          </span>
        )}
        {cand.stage === 'REJECTED' && (
          <span className="text-xs font-bold text-rose-600">Rejected & Notified</span>
        )}
      </div>
    </div>
  );

  const filteredAllCandidates = allCandidates.filter((c) => {
    const q = candSearch.toLowerCase();
    const matches =
      !q ||
      c.fullName.toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.jobTitle || '').toLowerCase().includes(q) ||
      (c.currentCompany || '').toLowerCase().includes(q);
    return matches && (candStageFilter === 'ALL' || c.stage === candStageFilter);
  });

  const CANDIDATE_STAGES: JobCandidate['stage'][] = [
    'APPLIED',
    'SCREENING',
    'TECHNICAL_INTERVIEW',
    'HR_INTERVIEW',
    'OFFERED',
    'HIRED',
    'REJECTED',
  ];

  const selectedJob = (jobs || []).find((j) => j._id === selectedJobId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Recruitment, Jobs & Candidate Pipeline
          </h1>
          <p className="text-xs text-slate-300 mt-1">Manage employee referrals, interview schedules, offer letters & rejections</p>
        </div>
        <button
          onClick={openReferForm}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm transition-all shrink-0 border border-[#039583] cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          Refer a Candidate
        </button>
      </div>

      {notice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isHr && (
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { id: 'pipeline', label: 'Job Pipeline & Interviews' },
            { id: 'referrals', label: `Referrals (${referrals.length})` },
            { id: 'openings', label: `Openings (${jobs.length})` },
            { id: 'candidates', label: `Candidates (${allCandidates.length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as 'pipeline' | 'referrals' | 'openings' | 'candidates')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                activeTab === t.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Referrals list */}
      {activeTab === 'referrals' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <div className="relative sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search name, city, role, referrer..."
                value={refSearch}
                onChange={(e) => setRefSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <select
              value={refStatusFilter}
              onChange={(e) => setRefStatusFilter(e.target.value as 'ALL' | ReferralStatus)}
              className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl"
            >
              <option value="ALL">All statuses</option>
              {(Object.keys(STATUS_LABEL) as ReferralStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          {filteredReferrals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-400">
              No referrals yet. Use "Refer a Candidate" to add the first one.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredReferrals.map((r) => (
                <div
                  key={r._id}
                  className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-slate-900 text-sm">{r.fullName}</h4>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${STATUS_STYLE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.isMine && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Your referral
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {r.city}
                      </span>
                      <span>
                        {r.experienceYears} {r.experienceYears === 1 ? 'year' : 'years'} experience
                      </span>
                      <span>For: {r.jobTitle || 'General referral'}</span>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Referred by <span className="font-semibold text-slate-600">{r.referredByName}</span> on{' '}
                      {r.createdAt.split('T')[0]}
                      {r.relationship ? ` • ${r.relationship}` : ''}
                    </p>
                    {r.canViewPrivate && (
                      <p className="text-[11px] text-slate-500 flex items-center gap-3 flex-wrap pt-0.5">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {r.email}
                        </span>
                        {r.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {r.phone}
                          </span>
                        )}
                      </p>
                    )}
                    {r.canViewPrivate && r.notes && (
                      <p className="text-[11px] text-slate-600 italic">"{r.notes}"</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {r.canViewPrivate && r.hasResume && (
                      <button
                        onClick={() => handleResumeDownload(r)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-semibold cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" /> Resume
                      </button>
                    )}
                    {isHr && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            try {
                              const res = await modulesService.convertReferralToCandidate(r._id);
                              setActiveTab('pipeline');
                              setSelectedJobId(res.candidate.jobId);
                              const cRes = await modulesService.getJobCandidates(res.candidate.jobId);
                              setCandidates(cRes.candidates);
                              await loadAllCandidates();
                              const targetCand = cRes.candidates.find((c) => c._id === res.candidate._id) || res.candidate;
                              handleOpenInterview(targetCand);
                              setNotice(`Converted ${r.fullName} to pipeline! Please schedule the interview below.`);
                              setTimeout(() => setNotice(null), 5000);
                            } catch (err: any) {
                              setNotice(err?.message || 'Failed to convert referral.');
                              setTimeout(() => setNotice(null), 5000);
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs cursor-pointer flex items-center gap-1"
                        >
                          <Calendar className="w-3.5 h-3.5" /> Schedule Interview
                        </button>
                        <select
                          value={r.status}
                          onChange={(e) => handleReferralStatus(r._id, e.target.value as ReferralStatus)}
                          className="text-xs p-1.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
                        >
                          {(Object.keys(STATUS_LABEL) as ReferralStatus[]).map((k) => (
                            <option key={k} value={k}>
                              {STATUS_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Openings (HR/Admin): job openings grid */}
      {isHr && activeTab === 'openings' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <div key={job._id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                      {job.department}
                    </span>
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
                      {job.openingsCount} Open
                    </span>
                  </div>
                  <h3 className="font-bold text-sm text-slate-900">{job.title}</h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-3">{job.description}</p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {job.location}
                  </span>
                  <span className="font-mono text-[11px]">{job.experienceRequired}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Candidates (HR/Admin): all candidates with filters */}
      {isHr && activeTab === 'candidates' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <div className="relative sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search name, email, role, company..."
                value={candSearch}
                onChange={(e) => setCandSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <select
              value={candStageFilter}
              onChange={(e) => setCandStageFilter(e.target.value as 'ALL' | JobCandidate['stage'])}
              className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl"
            >
              <option value="ALL">All stages</option>
              {CANDIDATE_STAGES.map((st) => (
                <option key={st} value={st}>
                  {st.replace('_', ' ').charAt(0) + st.replace('_', ' ').slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Stage summary */}
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            {CANDIDATE_STAGES.map((st) => (
              <span key={st} className={`px-2.5 py-1 rounded-lg font-semibold ${stageStyle(st)}`}>
                {st.replace('_', ' ')}: {allCandidates.filter((c) => c.stage === st).length}
              </span>
            ))}
          </div>

          {filteredAllCandidates.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-400">
              {allCandidates.length === 0
                ? 'No candidates yet. Convert a referral to add the first one to the pipeline.'
                : 'No candidates match your search or filter.'}
            </div>
          ) : (
            <div className="space-y-3">{filteredAllCandidates.map((cand) => renderCandidateCard(cand, true))}</div>
          )}
        </div>
      )}

      {/* Main Grid: Jobs list on left, Candidate pipeline on right (HR/Admin) */}
      {isHr && activeTab === 'pipeline' && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Requisitions (4 cols) */}
        <div className="lg:col-span-4 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Active Job Requisitions ({jobs.length})
          </h2>
          {jobs.map((job) => {
            const isSelected = job._id === selectedJobId;
            return (
              <div
                key={job._id}
                onClick={() => handleSelectJob(job._id)}
                className={`p-5 rounded-2xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                    : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-[10px] font-bold uppercase ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                    {job.department}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
                    {job.openingsCount} Open
                  </span>
                </div>
                <h3 className={`font-bold text-sm tracking-tight ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                  {job.title}
                </h3>
                <div className={`mt-2 flex items-center gap-3 text-xs ${isSelected ? 'text-slate-400' : 'text-slate-500'}`}>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {job.location}
                  </span>
                  <span>{job.experienceRequired}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Candidate Stage Pipeline (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {selectedJob && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{selectedJob.title}</h3>
                  <p className="text-xs text-slate-500 font-mono">Posted: {selectedJob.postedDate} • {selectedJob.type}</p>
                </div>
                <span className="text-xs font-bold text-slate-400 font-mono">
                  {candidates.length} Applicants
                </span>
              </div>

              <div className="space-y-3">
                {candidates.length === 0 ? (
                  <p className="text-xs text-slate-400 py-8 text-center">No candidates currently in pipeline for this position.</p>
                ) : (
                  candidates.map((cand) => renderCandidateCard(cand, false))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Refer a Candidate modal */}
      {isReferOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">Refer a Candidate</h3>
              <button onClick={() => setIsReferOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitReferral} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Candidate name *</label>
                  <input
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">City *</label>
                  <input
                    required
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    placeholder="e.g. Pune"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Years of experience *</label>
                  <input
                    required
                    type="number"
                    min={0}
                    max={60}
                    step="0.5"
                    value={form.experienceYears}
                    onChange={(e) => setForm({ ...form, experienceYears: e.target.value })}
                    placeholder="0 for freshers"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email *</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Your relationship</label>
                  <input
                    value={form.relationship}
                    onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                    placeholder="Friend, ex-colleague..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Referring for (optional)</label>
                <select
                  value={form.jobId}
                  onChange={(e) => setForm({ ...form, jobId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <option value="">General referral (no specific opening)</option>
                  {jobs
                    .filter((j) => j.status === 'OPEN')
                    .map((j) => (
                      <option key={j._id} value={j._id}>
                        {j.title} — {j.department}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Resume * (PDF, DOC or DOCX, max 5 MB)</label>
                <label className="flex items-center gap-2 p-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl cursor-pointer hover:bg-slate-100">
                  <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="truncate text-slate-600">{resumeFile ? resumeFile.name : 'Choose a file...'}</span>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    className="hidden"
                    onChange={(e) => handleResumePick(e.target.files?.[0] || null)}
                  />
                </label>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Why are they a good fit?</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              {formError && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">{formError}</div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsReferOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Referral'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Schedule Interview Modal */}
      {interviewCand && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Schedule Interview</h3>
                <p className="text-xs text-slate-500">Candidate: {interviewCand.fullName} ({interviewCand.jobTitle})</p>
              </div>
              <button onClick={() => setInterviewCand(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitInterview} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Interview Date *</label>
                  <input
                    type="date"
                    required
                    value={interviewForm.date}
                    onChange={(e) => setInterviewForm({ ...interviewForm, date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Time (HH:MM) *</label>
                  <input
                    type="text"
                    required
                    placeholder="10:00"
                    value={interviewForm.time}
                    onChange={(e) => setInterviewForm({ ...interviewForm, time: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Duration (Minutes)</label>
                  <select
                    value={interviewForm.durationMinutes}
                    onChange={(e) => setInterviewForm({ ...interviewForm, durationMinutes: Number(e.target.value) })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value={30}>30 mins</option>
                    <option value={45}>45 mins</option>
                    <option value={60}>60 mins</option>
                    <option value={90}>90 mins</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Interview Mode *</label>
                  <select
                    value={interviewForm.mode}
                    onChange={(e) => setInterviewForm({ ...interviewForm, mode: e.target.value as any })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="VIDEO">Video Call</option>
                    <option value="IN_PERSON">In Person</option>
                    <option value="PHONE">Phone Call</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Meeting Link / Venue / Phone *</label>
                <input
                  required
                  value={interviewForm.locationOrLink}
                  onChange={(e) => setInterviewForm({ ...interviewForm, locationOrLink: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Interviewer Name *</label>
                  <input
                    required
                    value={interviewForm.interviewer}
                    onChange={(e) => setInterviewForm({ ...interviewForm, interviewer: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Interview Instructions / Notes</label>
                <textarea
                  rows={2}
                  value={interviewForm.notes}
                  onChange={(e) => setInterviewForm({ ...interviewForm, notes: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setInterviewCand(null)}
                  className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Mail className="w-4 h-4" /> Send Interview Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Extend Offer Modal */}
      {offerCand && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Extend Formal Offer Letter</h3>
                <p className="text-xs text-slate-500">Candidate: {offerCand.fullName}</p>
              </div>
              <button onClick={() => setOfferCand(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitOffer} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Annual CTC (INR) *</label>
                  <input
                    type="number"
                    required
                    min={100000}
                    max={100000000}
                    step={50000}
                    value={offerForm.annualCtc}
                    onChange={(e) => setOfferForm({ ...offerForm, annualCtc: Number(e.target.value) })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Designation *</label>
                  <input
                    required
                    value={offerForm.designation}
                    onChange={(e) => setOfferForm({ ...offerForm, designation: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Work Location *</label>
                  <input
                    required
                    value={offerForm.location}
                    onChange={(e) => setOfferForm({ ...offerForm, location: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Reporting To</label>
                  <input
                    value={offerForm.reportingTo}
                    onChange={(e) => setOfferForm({ ...offerForm, reportingTo: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Date of Joining *</label>
                  <input
                    type="date"
                    required
                    value={offerForm.joiningDate}
                    onChange={(e) => setOfferForm({ ...offerForm, joiningDate: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Offer Valid Till *</label>
                  <input
                    type="date"
                    required
                    value={offerForm.validTill}
                    onChange={(e) => setOfferForm({ ...offerForm, validTill: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Additional Offer Terms / Notes</label>
                <textarea
                  rows={2}
                  value={offerForm.notes}
                  onChange={(e) => setOfferForm({ ...offerForm, notes: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOfferCand(null)}
                  className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <FileText className="w-4 h-4" /> Send Offer Letter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Interview Feedback Modal */}
      {feedbackCand && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {feedbackRound === 'TECHNICAL_INTERVIEW' ? 'Technical Interview Feedback' : 'HR Interview Feedback'}
                </h3>
                <p className="text-xs text-slate-500">Candidate: {feedbackCand.fullName}</p>
              </div>
              <button onClick={() => setFeedbackCand(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitFeedback} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Candidate Rating (1 - 5) *</label>
                <select
                  value={feedbackForm.rating}
                  onChange={(e) => setFeedbackForm({ ...feedbackForm, rating: Number(e.target.value) })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <option value={5}>5.0 — Outstanding / Exceptional</option>
                  <option value={4}>4.0 — Strong / Above Average</option>
                  <option value={3}>3.0 — Competent / Meets Bar</option>
                  <option value={2}>2.0 — Below Expectations</option>
                  <option value={1}>1.0 — Poor Fit</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Feedback Comments & Notes *</label>
                <textarea
                  required
                  rows={3}
                  value={feedbackForm.comments}
                  onChange={(e) => setFeedbackForm({ ...feedbackForm, comments: e.target.value })}
                  placeholder="Summarize technical strength, problem solving, communication..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Recommendation *</label>
                <select
                  value={feedbackForm.recommendation}
                  onChange={(e) => setFeedbackForm({ ...feedbackForm, recommendation: e.target.value as any })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                >
                  <option value="NEXT_ROUND">✅ Advance to Next Round / Offer</option>
                  <option value="REJECT">❌ Reject Candidate (Sends Rejection Email)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFeedbackCand(null)}
                  className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" /> Submit Feedback
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};