import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { InsurancePolicy, InsuranceEnrollment, InsuranceClaim } from '../types/modules';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { ExportButtons } from '../components/common/ExportButtons';
import {
  Shield,
  CreditCard,
  FileText,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  PhoneCall,
  Building,
  Users,
  Search,
  Check,
  X,
  FileCheck,
} from 'lucide-react';

export const InsurancePage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'HR';

  const [activeTab, setActiveTab] = useState<'policy' | 'ecard' | 'claims' | 'admin'>('policy');
  const [policy, setPolicy] = useState<InsurancePolicy | null>(null);
  const [enrollment, setEnrollment] = useState<InsuranceEnrollment | null>(null);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Claim modal state
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimForm, setClaimForm] = useState({
    patientName: '',
    relation: 'Self',
    hospitalName: '',
    admissionDate: new Date().toISOString().split('T')[0],
    dischargeDate: '',
    claimType: 'CASHLESS' as 'CASHLESS' | 'REIMBURSEMENT',
    amountRequested: '',
    diagnosis: '',
    documents: ['MedicalPrescription.pdf', 'HospitalBill.pdf'],
  });
  const [submittingClaim, setSubmittingClaim] = useState(false);

  // Admin claims review modal
  const [reviewingClaim, setReviewingClaim] = useState<InsuranceClaim | null>(null);
  const [tpaRemarks, setTpaRemarks] = useState('');
  const [amountApproved, setAmountApproved] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [polRes, enrRes, clmRes] = await Promise.all([
        modulesService.getInsurancePolicy(),
        modulesService.getInsuranceEnrollment(),
        modulesService.getInsuranceClaims(),
      ]);
      setPolicy(polRes.policy);
      setEnrollment(enrRes.enrollment);
      setClaims(clmRes.claims);
    } catch (err: any) {
      setError(err?.message || 'Failed to load insurance details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePrintECard = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups for printing');
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Insurance E-Card - ${enrollment?.employeeName}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; background: #f8fafc; color: #0f172a; }
            .card { background: #0f172a; color: white; padding: 32px; border-radius: 24px; max-width: 600px; margin: 0 auto; box-shadow: 0 10px 25px rgba(0,0,0,0.1); border: 1px solid #14b8a6; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(20, 184, 166, 0.3); padding-bottom: 16px; margin-bottom: 24px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
            .label { font-size: 11px; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px; }
            .value { font-size: 15px; font-weight: bold; }
            .highlight { color: #5eead4; font-family: monospace; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <div>
                <h2>Greenticker Financial Services LLP</h2>
                <p style="color: #5eead4; font-size: 12px; margin: 0;">Group Medical Insurance E-Card</p>
              </div>
              <div style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: bold;">
                ${enrollment?.status}
              </div>
            </div>
            <div class="grid">
              <div>
                <div class="label">Employee Name</div>
                <div class="value">${enrollment?.employeeName}</div>
              </div>
              <div>
                <div class="label">Employee Code</div>
                <div class="value highlight">${enrollment?.employeeCode}</div>
              </div>
              <div>
                <div class="label">E-Card Number</div>
                <div class="value highlight">${enrollment?.eCardNumber}</div>
              </div>
              <div>
                <div class="label">Policy Number</div>
                <div class="value highlight">${policy?.policyName}</div>
              </div>
              <div>
                <div class="label">Sum Insured</div>
                <div class="value" style="color: #34d399;">₹${enrollment?.sumInsured.toLocaleString('en-IN')}</div>
              </div>
              <div>
                <div class="label">TPA Provider</div>
                <div class="value">${policy?.tpaName}</div>
              </div>
            </div>
            <div style="border-top: 1px solid rgba(20, 184, 166, 0.3); padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center;">
              Emergency Helpline: ${policy?.emergencyHelpline} | TPA Toll-Free: 1800-425-9988
            </div>
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingClaim(true);
    try {
      await modulesService.submitInsuranceClaim({
        ...claimForm,
        amountRequested: Number(claimForm.amountRequested),
      });
      setNotice('Insurance claim submitted successfully to TPA for processing.');
      setShowClaimModal(false);
      setClaimForm({
        patientName: '',
        relation: 'Self',
        hospitalName: '',
        admissionDate: new Date().toISOString().split('T')[0],
        dischargeDate: '',
        claimType: 'CASHLESS',
        amountRequested: '',
        diagnosis: '',
        documents: ['MedicalPrescription.pdf', 'HospitalBill.pdf'],
      });
      loadData();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit claim.');
    } finally {
      setSubmittingClaim(false);
    }
  };

  const handleUpdateClaimStatus = async (claimId: string, status: string) => {
    try {
      await modulesService.updateInsuranceClaimStatus(
        claimId,
        status,
        tpaRemarks,
        amountApproved ? Number(amountApproved) : undefined
      );
      setNotice(`Claim status updated to ${status}.`);
      setReviewingClaim(null);
      setTpaRemarks('');
      setAmountApproved('');
      loadData();
    } catch (err: any) {
      setError(err?.message || 'Failed to update claim status.');
    }
  };

  const handleExportExcel = () => {
    exportToExcel(
      claims,
      'Insurance_Claims_Report',
      'InsuranceClaims',
      [
        { header: 'Claim ID', key: '_id' },
        { header: 'Employee Name', key: 'employeeName' },
        { header: 'Patient Name', key: 'patientName' },
        { header: 'Relation', key: 'relation' },
        { header: 'Hospital Name', key: 'hospitalName' },
        { header: 'Admission Date', key: 'admissionDate' },
        { header: 'Discharge Date', key: (c) => c.dischargeDate || 'N/A' },
        { header: 'Claim Type', key: 'claimType' },
        { header: 'Requested (₹)', key: 'amountRequested' },
        { header: 'Approved (₹)', key: (c) => c.amountApproved ?? 0 },
        { header: 'Status', key: 'status' },
        { header: 'TPA Remarks', key: (c) => c.tpaRemarks || '' },
      ]
    );
  };

  const handleExportPdf = () => {
    const headers = ['Claim ID', 'Employee', 'Patient', 'Hospital', 'Type', 'Requested', 'Approved', 'Status'];
    const rows = claims.map((c) => [
      c._id,
      c.employeeName,
      `${c.patientName} (${c.relation})`,
      c.hospitalName,
      c.claimType,
      `₹${c.amountRequested.toLocaleString()}`,
      c.amountApproved ? `₹${c.amountApproved.toLocaleString()}` : '-',
      c.status,
    ]);
    exportToPdf(
      'Group Medical Coverage - Insurance Claims Audit',
      headers,
      rows,
      'Insurance_Claims_Report',
      `Exported ${claims.length} insurance claims and TPA tracking records`
    );
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-xl shadow-inner">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Employee Insurance & Health Benefits
            </h1>
            <p className="text-sm font-medium text-slate-500">
              Manage Group Medical Coverage (GMC), Digital E-Cards, Payroll Deductions, & Claim Tracking
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ExportButtons
            onExportExcel={handleExportExcel}
            onExportPdf={handleExportPdf}
          />
          <button
            onClick={() => setShowClaimModal(true)}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm transition flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Submit Claim
          </button>
        </div>
      </div>

      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-emerald-600 hover:text-emerald-800 font-bold">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm font-medium">
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-rose-600" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800 font-bold">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-8">
        <button
          onClick={() => setActiveTab('policy')}
          className={`pb-3 text-sm font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === 'policy' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" /> Policy & Eligibility
        </button>
        <button
          onClick={() => setActiveTab('ecard')}
          className={`pb-3 text-sm font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === 'ecard' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <CreditCard className="w-4 h-4" /> Digital E-Card
        </button>
        <button
          onClick={() => setActiveTab('claims')}
          className={`pb-3 text-sm font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === 'claims' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileCheck className="w-4 h-4" /> Claim Tracking ({claims.length})
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('admin')}
            className={`pb-3 text-sm font-bold border-b-2 transition flex items-center gap-2 ${
              activeTab === 'admin' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="w-4 h-4" /> Admin & Payroll Deductions
          </button>
        )}
      </div>

      {/* Tab 1: Policy & Eligibility */}
      {activeTab === 'policy' && policy && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="px-3 py-1 bg-teal-50 text-teal-700 text-xs font-black rounded-full uppercase tracking-wider">
                  Active Corporate Policy
                </span>
                <span className="text-xs font-semibold text-slate-400">Valid Till: {policy.validTill}</span>
              </div>
              <h2 className="text-xl font-black text-slate-900">{policy.policyName}</h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Provided under partnership with <strong className="text-slate-900">{policy.provider}</strong>. Administered by{' '}
                <strong className="text-slate-900">{policy.tpaName}</strong>. Covers cashless hospitalization across 8,500+ network hospitals nationwide.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-xs font-semibold text-slate-400 block mb-1">TPA Name</span>
                  <span className="text-sm font-bold text-slate-900">{policy.tpaName}</span>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-xs font-semibold text-slate-400 block mb-1">24/7 Emergency Helpline</span>
                  <span className="text-sm font-bold text-teal-700 flex items-center gap-1.5">
                    <PhoneCall className="w-4 h-4" /> {policy.emergencyHelpline}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="text-base font-bold text-slate-900">Grade-Based Sum Insured Eligibility</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs font-bold text-slate-400 uppercase">
                      <th className="py-3 px-4">Grade / Designation Band</th>
                      <th className="py-3 px-4">Default Sum Insured</th>
                      <th className="py-3 px-4">Monthly Premium Deduction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-sm font-medium text-slate-700">
                    {Object.entries(policy.gradeEligibility).map(([grade, sum]) => (
                      <tr key={grade} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4 font-bold text-slate-900">{grade}</td>
                        <td className="py-3 px-4 text-teal-700 font-bold">₹{sum.toLocaleString('en-IN')}</td>
                        <td className="py-3 px-4 text-slate-600">
                          ₹{Math.round(sum * 0.0012 / 12).toLocaleString('en-IN')} / month
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 rounded-2xl shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">Your Coverage</span>
                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs font-bold rounded-md">Active</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">Assigned Grade</span>
                <span className="text-lg font-black">{enrollment?.grade || 'Staff'}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">Sum Insured</span>
                <span className="text-2xl font-black text-teal-300">₹{(enrollment?.sumInsured || 500000).toLocaleString('en-IN')}</span>
              </div>
              <div className="pt-2 border-t border-slate-700">
                <span className="text-xs text-slate-400 block mb-2">Covered Dependents ({enrollment?.dependents?.length || 0})</span>
                <ul className="space-y-1.5 text-xs font-medium text-slate-300">
                  {enrollment?.dependents?.map((d, i) => (
                    <li key={i} className="flex items-center justify-between">
                      <span>{d.name} ({d.relation})</span>
                      <span className="text-teal-400">{d.gender}</span>
                    </li>
                  ))}
                  {(!enrollment?.dependents || enrollment.dependents.length === 0) && (
                    <li className="text-slate-400 italic">No dependents added yet.</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-3">
              <h4 className="text-sm font-bold text-slate-900">Allowed Family Members</h4>
              <ul className="space-y-2 text-xs text-slate-600">
                {policy.dependentsAllowed.map((dep, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                    <span>{dep}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Digital E-Card */}
      {activeTab === 'ecard' && enrollment && policy && (
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="bg-gradient-to-br from-teal-900 via-slate-900 to-teal-950 text-white p-8 rounded-3xl shadow-xl relative overflow-hidden space-y-6 border border-teal-800/30">
            <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="flex items-center justify-between border-b border-teal-800/50 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center font-black">
                  GT
                </div>
                <div>
                  <h3 className="text-base font-black tracking-wide">Greenticker Financial Services LLP</h3>
                  <p className="text-xs text-teal-300">Group Medical Insurance E-Card</p>
                </div>
              </div>
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 text-xs font-bold rounded-full">
                {enrollment.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-xs text-slate-400 block">Employee Name</span>
                <span className="font-bold text-base">{enrollment.employeeName}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">Employee Code</span>
                <span className="font-bold font-mono text-teal-300">{enrollment.employeeCode}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">E-Card Number</span>
                <span className="font-bold font-mono text-teal-300">{enrollment.eCardNumber}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">Policy Number</span>
                <span className="font-bold font-mono text-teal-300">{policy.policyName}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">Sum Insured</span>
                <span className="font-bold text-base text-emerald-400">₹{enrollment.sumInsured.toLocaleString('en-IN')}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">TPA Provider</span>
                <span className="font-bold text-base">{policy.tpaName}</span>
              </div>
            </div>

            {enrollment.dependents.length > 0 && (
              <div className="pt-4 border-t border-teal-800/50">
                <span className="text-xs font-bold text-teal-300 uppercase tracking-widest block mb-2">Covered Dependents</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {enrollment.dependents.map((d, i) => (
                    <div key={i} className="bg-teal-900/40 p-2.5 rounded-xl border border-teal-800/40 text-xs flex justify-between">
                      <span className="font-bold">{d.name}</span>
                      <span className="text-teal-300">{d.relation}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-teal-800/50 flex items-center justify-between text-xs text-slate-400">
              <span>Show this digital card at network hospital helpdesk with valid Govt ID.</span>
              <button
                onClick={handlePrintECard}
                className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-lg transition"
              >
                Print / Download E-Card
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Claim Tracking */}
      {activeTab === 'claims' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Insurance Claims & Reimbursements History</h3>
              <button
                onClick={() => setShowClaimModal(true)}
                className="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> New Claim
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-bold text-slate-400 uppercase bg-slate-50/50">
                    <th className="py-3 px-4">Claim ID</th>
                    <th className="py-3 px-4">Patient & Relation</th>
                    <th className="py-3 px-4">Hospital & Admission</th>
                    <th className="py-3 px-4">Diagnosis</th>
                    <th className="py-3 px-4">Requested / Approved</th>
                    <th className="py-3 px-4">Status</th>
                    {isAdmin && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-sm font-medium text-slate-700">
                  {claims.map((claim) => (
                    <tr key={claim._id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">{claim._id}</td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-900 block">{claim.patientName}</span>
                        <span className="text-xs text-slate-500">{claim.relation} ({claim.employeeName})</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-800 block">{claim.hospitalName}</span>
                        <span className="text-xs text-slate-500">Admitted: {claim.admissionDate}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">{claim.diagnosis}</td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-900 block">₹{claim.amountRequested.toLocaleString('en-IN')}</span>
                        {claim.amountApproved !== undefined && (
                          <span className="text-xs font-bold text-emerald-600">Approved: ₹{claim.amountApproved.toLocaleString('en-IN')}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2.5 py-1 text-xs font-black rounded-full uppercase tracking-wider inline-block ${
                            claim.status === 'SETTLED' || claim.status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : claim.status === 'REJECTED'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {claim.status}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => setReviewingClaim(claim)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-lg transition"
                          >
                            Review / TPA Status
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {claims.length === 0 && (
                    <tr>
                      <td colSpan={isAdmin ? 7 : 6} className="py-8 text-center text-slate-400 text-sm">
                        No insurance claims recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Admin Management */}
      {activeTab === 'admin' && isAdmin && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900">Company Insurance Program Overview & Payroll Deductions</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              All employee insurance premiums are deducted monthly via payroll based on grade-level slabs. TPA settlements are automatically reconciled every month with ICICI Lombard.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-teal-50 border border-teal-100">
                <span className="text-xs font-semibold text-teal-600 block mb-1">Total Enrolled Employees</span>
                <span className="text-2xl font-black text-teal-900">42 / 45</span>
              </div>
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                <span className="text-xs font-semibold text-emerald-600 block mb-1">Total Claims Settled (FY25-26)</span>
                <span className="text-2xl font-black text-emerald-900">₹14,20,500</span>
              </div>
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
                <span className="text-xs font-semibold text-blue-600 block mb-1">Monthly Premium Payroll Collection</span>
                <span className="text-2xl font-black text-blue-900">₹38,500</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit Claim Modal */}
      {showClaimModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">Submit Corporate Insurance Claim</h3>
              <button onClick={() => setShowClaimModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleClaimSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Patient Name</label>
                  <input
                    type="text"
                    required
                    value={claimForm.patientName}
                    onChange={(e) => setClaimForm({ ...claimForm, patientName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="Full Name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Relation</label>
                  <select
                    value={claimForm.relation}
                    onChange={(e) => setClaimForm({ ...claimForm, relation: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="Self">Self</option>
                    <option value="Spouse">Spouse</option>
                    <option value="Child">Child</option>
                    <option value="Father">Father</option>
                    <option value="Mother">Mother</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Hospital Name & City</label>
                <input
                  type="text"
                  required
                  value={claimForm.hospitalName}
                  onChange={(e) => setClaimForm({ ...claimForm, hospitalName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  placeholder="e.g. Manipal Hospital, Bengaluru"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Admission Date</label>
                  <input
                    type="date"
                    required
                    value={claimForm.admissionDate}
                    onChange={(e) => setClaimForm({ ...claimForm, admissionDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Claim Type</label>
                  <select
                    value={claimForm.claimType}
                    onChange={(e) => setClaimForm({ ...claimForm, claimType: e.target.value as any })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="CASHLESS">Cashless Hospitalization</option>
                    <option value="REIMBURSEMENT">Reimbursement</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Amount Requested (₹)</label>
                  <input
                    type="number"
                    required
                    value={claimForm.amountRequested}
                    onChange={(e) => setClaimForm({ ...claimForm, amountRequested: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="25000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Upload Hospital Bills & Discharge Summary</label>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        const fileNames = Array.from(files).map((f) => f.name);
                        setClaimForm({ ...claimForm, documents: fileNames });
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 file:mr-3 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 transition cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block truncate">
                    Attached: {claimForm.documents.join(', ')}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Diagnosis / Medical Condition</label>
                <textarea
                  required
                  rows={2}
                  value={claimForm.diagnosis}
                  onChange={(e) => setClaimForm({ ...claimForm, diagnosis: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  placeholder="Brief description of illness or surgery..."
                ></textarea>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowClaimModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingClaim}
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold transition shadow-sm"
                >
                  {submittingClaim ? 'Submitting...' : 'Submit Claim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Review Claim Modal */}
      {reviewingClaim && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">Review Insurance Claim ({reviewingClaim._id})</h3>
              <button onClick={() => setReviewingClaim(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-500">Employee:</span>
                  <span className="font-bold">{reviewingClaim.employeeName} ({reviewingClaim.employeeCode})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Patient:</span>
                  <span className="font-bold">{reviewingClaim.patientName} ({reviewingClaim.relation})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Hospital:</span>
                  <span className="font-bold">{reviewingClaim.hospitalName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Requested Amount:</span>
                  <span className="font-bold text-teal-700">₹{reviewingClaim.amountRequested.toLocaleString('en-IN')}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Approved Amount (₹)</label>
                <input
                  type="number"
                  value={amountApproved || reviewingClaim.amountRequested}
                  onChange={(e) => setAmountApproved(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">TPA / Reviewer Remarks</label>
                <textarea
                  rows={2}
                  value={tpaRemarks}
                  onChange={(e) => setTpaRemarks(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  placeholder="Enter remarks or query..."
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  onClick={() => handleUpdateClaimStatus(reviewingClaim._id, 'REJECTED')}
                  className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl transition"
                >
                  Reject Claim
                </button>
                <button
                  onClick={() => handleUpdateClaimStatus(reviewingClaim._id, 'APPROVED')}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl transition"
                >
                  Approve TPA Review
                </button>
                <button
                  onClick={() => handleUpdateClaimStatus(reviewingClaim._id, 'SETTLED')}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition"
                >
                  Settle Claim
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
