import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { PoshCase } from '../types/modules';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { ExportButtons } from '../components/common/ExportButtons';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  User,
  Users,
  Building,
  Calendar,
  X,
  Scale,
} from 'lucide-react';

export const PoshPage: React.FC = () => {
  const { user } = useAuth();
  const [cases, setCases] = useState<PoshCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<PoshCase | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // New Case Intake Form
  const [formData, setFormData] = useState({
    respondentName: '',
    respondentDesignation: '',
    respondentDepartment: 'Engineering & Technology',
    description: '',
    committeeAssigned: 'Internal Complaints Committee Panel 1',
    isAnonymous: true,
    incidentDate: new Date().toISOString().split('T')[0],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stage update
  const [stageNotes, setStageNotes] = useState('');

  // Enforce Rule 21: Highly confidential, not visible to managers or employees
  if (user?.role !== 'ADMIN' && user?.role !== 'HR') {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center p-8 bg-white rounded-2xl border border-slate-200 text-center">
        <Lock className="w-12 h-12 text-rose-500 mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Restricted Confidential Access</h2>
        <p className="text-xs text-slate-500 max-w-md mt-1">
          Rule 21: Prevention of Sexual Harassment (POSH) proceedings and records are strictly classified. Access is restricted exclusively to authorized Executive Administration and the Internal Complaints Committee (ICC).
        </p>
      </div>
    );
  }

  const fetchCases = async () => {
    setLoading(true);
    try {
      const res = await modulesService.getPoshCases();
      setCases(res.cases);
      if (res.cases.length > 0 && !selectedCase) {
        setSelectedCase(res.cases[0]);
      }
    } catch (err) {
      console.error('Failed to load POSH cases', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, []);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await modulesService.createPoshCase(formData);
      if (res.success) {
        setFeedback(`Confidential inquiry ${res.case.caseNumber} initiated under Internal Committee jurisdiction.`);
        setIsLogOpen(false);
        fetchCases();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error recording case'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAdvanceStage = async (id: string, nextStage: PoshCase['stage'], markResolved = false) => {
    try {
      const res = await modulesService.updatePoshStage(
        id,
        nextStage,
        stageNotes,
        markResolved ? 'RESOLVED' : 'ACTIVE'
      );
      if (res.success) {
        setFeedback(`Case stage advanced to ${nextStage}.`);
        setStageNotes('');
        fetchCases();
        if (selectedCase && selectedCase._id === id) {
          setSelectedCase(res.case);
        }
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error updating stage'}`);
    }
  };

  const stagesOrder: PoshCase['stage'][] = [
    'PRELIMINARY_REVIEW',
    'INTERNAL_ENQUIRY',
    'CONCILIATION',
    'FINDINGS_SUBMITTED',
    'ACTION_TAKEN',
    'CLOSED',
  ];

  const handleExportExcel = () => {
    exportToExcel(
      cases,
      'POSH_Governance_Report',
      'POSHCases',
      [
        { header: 'Case Number', key: 'caseNumber' },
        { header: 'Complainant', key: 'complainantName' },
        { header: 'Respondent', key: 'respondentName' },
        { header: 'Stage', key: 'stage' },
        { header: 'Incident Date', key: 'incidentDate' },
        { header: 'Reported Date', key: 'reportedDate' },
        { header: 'Status', key: 'status' },
      ]
    );
  };

  const handleExportPdf = () => {
    const headers = ['Case No', 'Complainant', 'Respondent', 'Stage', 'Incident Date', 'Reported Date', 'Status'];
    const rows = cases.map((c) => [
      c.caseNumber,
      c.complainantName,
      c.respondentName,
      c.stage,
      c.incidentDate,
      c.reportedDate,
      c.status,
    ]);
    exportToPdf(
      'Internal Complaints Committee (ICC) & POSH Cases Governance Audit Report',
      headers,
      rows,
      'POSH_Governance_Report',
      `Exported ${cases.length} confidential ICC grievance case dossiers`
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 text-white p-6 rounded-2xl shadow-md">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Rule 21: Strictly Confidential • Admin & HR Only
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Internal Complaints Committee (ICC) & POSH Governance
          </h1>
          <p className="text-xs text-slate-300 max-w-2xl mt-1">
            Statutory registry enforcing zero-tolerance workplace harassment protocols, non-retaliation guarantees, and formal 90-day inquiry timelines.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ExportButtons
            onExportExcel={handleExportExcel}
            onExportPdf={handleExportPdf}
          />
          <button
            onClick={() => setIsLogOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-slate-900 hover:bg-slate-100 font-semibold text-xs shadow-sm transition-all shrink-0 cursor-pointer rounded-xl"
          >
            <Plus className="w-4 h-4" />
            Log Grievance
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-emerald-600 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Internal Committee Panel Directory */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Statutory Internal Complaints Committee (ICC) Members
            </h3>
          </div>
          <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-bold">
            Quorum Active & Compliant
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0">
              AS
            </div>
            <div>
              <p className="font-semibold text-xs text-slate-900">Dr. Aruna Swaminathan</p>
              <p className="text-[11px] text-slate-500 font-medium">Presiding Officer (Senior Woman Executive)</p>
              <p className="text-[10px] text-slate-400 font-mono">Appointed under Section 4(2)(a)</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-700 font-bold flex items-center justify-center shrink-0">
              MB
            </div>
            <div>
              <p className="font-semibold text-xs text-slate-900">Marcus Brody</p>
              <p className="text-[11px] text-slate-500 font-medium">Internal Member (Human Resources Lead)</p>
              <p className="text-[10px] text-slate-400 font-mono">Employee Advocacy & Mediation</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center shrink-0">
              RL
            </div>
            <div>
              <p className="font-semibold text-xs text-slate-900">Advocate Rachel Levin</p>
              <p className="text-[11px] text-slate-500 font-medium">External Member (Civil Rights / NGO Legal)</p>
              <p className="text-[10px] text-slate-400 font-mono">Independent Statutory Oversight</p>
            </div>
          </div>
        </div>
      </div>

      {/* Case Management Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Cases List (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Confidential Docket</h3>
            <span className="text-xs text-slate-400 font-mono">{cases.length} Registered</span>
          </div>

          <div className="space-y-3">
            {cases.map((c) => {
              const isSelected = selectedCase?._id === c._id;
              return (
                <div
                  key={c._id}
                  onClick={() => setSelectedCase(c)}
                  className={`p-5 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 shadow-xs'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider ${
                      isSelected ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {c.caseNumber}
                    </span>

                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                      c.status === 'RESOLVED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {c.status}
                    </span>
                  </div>

                  <p className={`font-semibold text-xs ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                    Respondent: {c.respondentName} ({c.respondentDesignation})
                  </p>
                  <p className={`text-[11px] mt-1 line-clamp-2 ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                    {c.description}
                  </p>

                  <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-slate-400 border-t border-slate-200/40 pt-2">
                    <span>Incident: {c.incidentDate}</span>
                    <span className="uppercase text-indigo-400 font-bold">{c.stage.replace('_', ' ')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Case Detail & Enquiry Stage Timeline (7 cols) */}
        <div className="lg:col-span-7">
          {selectedCase ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-5 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded">
                      {selectedCase.caseNumber}
                    </span>
                    <span className="text-[10px] font-bold uppercase bg-rose-100 text-rose-800 px-2 py-0.5 rounded">
                      Classified
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Formal Inquiry: {selectedCase.respondentName}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Assigned: {selectedCase.committeeAssigned}
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Current Phase</span>
                  <p className="text-sm font-bold text-slate-900 uppercase font-mono">
                    {selectedCase.stage.replace('_', ' ')}
                  </p>
                </div>
              </div>

              {/* Inquiry Stepper */}
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Statutory 90-Day Inquiry Progression
                </span>
                <div className="grid grid-cols-6 gap-1 bg-slate-100 p-1.5 rounded-xl text-center">
                  {stagesOrder.map((st, i) => {
                    const currentIndex = stagesOrder.indexOf(selectedCase.stage);
                    const isDone = i <= currentIndex;
                    return (
                      <div
                        key={st}
                        className={`p-2 rounded-lg text-[9px] font-bold tracking-tighter uppercase transition-all ${
                          isDone
                            ? 'bg-slate-900 text-white shadow-xs'
                            : 'text-slate-400'
                        }`}
                      >
                        {st.replace('_', ' ')}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Case Details Card */}
              <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Incident Grievance Statement</span>
                  <p className="text-slate-800 mt-1 leading-relaxed">{selectedCase.description}</p>
                </div>

                {selectedCase.actionTakenNotes && (
                  <div className="border-t border-slate-200/80 pt-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Committee Findings & Action Notes</span>
                    <p className="text-slate-800 mt-1 italic">{selectedCase.actionTakenNotes}</p>
                  </div>
                )}
              </div>

              {/* Advance Stage Control */}
              {selectedCase.status !== 'RESOLVED' && (
                <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Advance Inquiry Proceeding
                  </h4>
                  <textarea
                    rows={2}
                    placeholder="Enter formal findings, witness recording references, or committee recommendations..."
                    value={stageNotes}
                    onChange={(e) => setStageNotes(e.target.value)}
                    className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <div className="flex justify-end gap-2">
                    {selectedCase.stage !== 'ACTION_TAKEN' && (
                      <button
                        onClick={() => {
                          const nextIdx = stagesOrder.indexOf(selectedCase.stage) + 1;
                          if (nextIdx < stagesOrder.length) {
                            handleAdvanceStage(selectedCase._id, stagesOrder[nextIdx]);
                          }
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs"
                      >
                        Advance to Next Stage
                      </button>
                    )}
                    <button
                      onClick={() => handleAdvanceStage(selectedCase._id, 'CLOSED', true)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs"
                    >
                      Resolve & Close Case
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center text-center">
              <ShieldAlert className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-sm font-semibold text-slate-600">Select a POSH case to inspect enquiry dossier.</p>
            </div>
          )}
        </div>
      </div>

      {/* New Grievance Intake Modal */}
      {isLogOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Initiate POSH Grievance Intake</h2>
              <button onClick={() => setIsLogOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCase} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Respondent Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Full name of person"
                    value={formData.respondentName}
                    onChange={(e) => setFormData({ ...formData, respondentName: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Respondent Title</label>
                  <input
                    type="text"
                    required
                    placeholder="Designation"
                    value={formData.respondentDesignation}
                    onChange={(e) => setFormData({ ...formData, respondentDesignation: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Department</label>
                <select
                  value={formData.respondentDepartment}
                  onChange={(e) => setFormData({ ...formData, respondentDepartment: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <option value="Engineering & Technology">Engineering & Technology</option>
                  <option value="Product & Design">Product & Design</option>
                  <option value="Finance & Compliance">Finance & Compliance</option>
                  <option value="Human Resources">Human Resources</option>
                  <option value="Sales & Business Development">Sales & Business Development</option>
                  <option value="Operations & Facilities">Operations & Facilities</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Incident Grievance Statement</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Provide precise details of the occurrence, date, location, and nature of unwelcome conduct..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="anonCheck"
                  checked={formData.isAnonymous}
                  onChange={(e) => setFormData({ ...formData, isAnonymous: e.target.checked })}
                  className="rounded text-slate-900"
                />
                <label htmlFor="anonCheck" className="text-xs text-slate-700 cursor-pointer">
                  Protect Complainant Anonymity in General Internal Committee Minutes
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsLogOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Recording...' : 'Register Formal Grievance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
