import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { PolicyItem, PolicyAcknowledgement, PolicyCategory } from '../types/modules';
import {
  FileCheck,
  Shield,
  CheckCircle2,
  Clock,
  Search,
  ExternalLink,
  Lock,
  FileText,
  AlertCircle,
  X,
  Sparkles,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';

export const PoliciesPage: React.FC = () => {
  const { user } = useAuth();
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [acks, setAcks] = useState<PolicyAcknowledgement[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPolicy, setSelectedPolicy] = useState<PolicyItem | null>(null);
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  // Create / delete policy state
  const canCreate = user?.role === 'ADMIN';
  const canDelete = user?.role === 'ADMIN';
  const emptyForm = {
    title: '',
    category: 'HR' as PolicyCategory,
    version: '1.0',
    summary: '',
    content: '',
    mandatory: true,
    effectiveDate: new Date().toISOString().split('T')[0],
  };
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [policyToDelete, setPolicyToDelete] = useState<PolicyItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Upload PDF Policy state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    category: 'HR' as PolicyCategory,
    version: '1.0',
    summary: '',
    mandatory: true,
    effectiveDate: new Date().toISOString().split('T')[0],
  });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const fetchPolicies = async () => {
    setLoading(true);
    try {
      const res = await modulesService.getPolicies();
      setPolicies(res.policies);
      setAcks(res.acknowledgements);
      if (res.policies.length > 0 && !selectedPolicy) {
        setSelectedPolicy(res.policies[0]);
      }
    } catch (err) {
      console.error('Failed to load policies', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const handleAcknowledge = async (id: string) => {
    setIsAcknowledging(true);
    try {
      const res = await modulesService.acknowledgePolicy(id);
      if (res.success) {
        setFeedback('Policy officially acknowledged and digitally signed.');
        fetchPolicies();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error acknowledging policy'}`);
    } finally {
      setIsAcknowledging(false);
    }
  };

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.title.trim() || !form.content.trim()) {
      setFormError('Title and policy content are required.');
      return;
    }
    setIsSaving(true);
    try {
      const res = await modulesService.createPolicy({
        ...form,
        title: form.title.trim(),
        summary: form.summary.trim(),
        content: form.content.trim(),
      });
      if (res.success) {
        setFeedback(`Policy "${res.policy.title}" created successfully.`);
        setShowCreateForm(false);
        setForm(emptyForm);
        await fetchPolicies();
        setSelectedPolicy(res.policy);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to create policy.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    if (!uploadFile) {
      setUploadError('Please select a policy PDF file to upload.');
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('policyPdf', uploadFile);
      fd.append('title', uploadForm.title || uploadFile.name.replace(/\.[^/.]+$/, ''));
      fd.append('category', uploadForm.category);
      fd.append('version', uploadForm.version);
      fd.append('summary', uploadForm.summary || `Official policy document integrated from PDF: ${uploadFile.name}`);
      fd.append('mandatory', String(uploadForm.mandatory));
      fd.append('effectiveDate', uploadForm.effectiveDate);

      const res = await modulesService.uploadPolicy(fd);
      if (res.success) {
        setFeedback(`Policy PDF "${res.policy.title}" uploaded & integrated successfully.`);
        setShowUploadModal(false);
        setUploadFile(null);
        setUploadForm({
          title: '',
          category: 'HR',
          version: '1.0',
          summary: '',
          mandatory: true,
          effectiveDate: new Date().toISOString().split('T')[0],
        });
        await fetchPolicies();
        setSelectedPolicy(res.policy);
      }
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload policy PDF.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletePolicy = async () => {
    if (!policyToDelete) return;
    setIsDeleting(true);
    try {
      const res = await modulesService.deletePolicy(policyToDelete._id);
      if (res.success) {
        setFeedback(`Policy "${policyToDelete.title}" deleted.`);
        if (selectedPolicy?._id === policyToDelete._id) setSelectedPolicy(null);
        setPolicyToDelete(null);
        const fresh = await modulesService.getPolicies();
        setPolicies(fresh.policies);
        setAcks(fresh.acknowledgements);
        setSelectedPolicy((cur) => cur ?? fresh.policies[0] ?? null);
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error deleting policy'}`);
      setPolicyToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const isPolicyAcknowledged = (polId: string) => {
    return acks.some((a) => a.policyId === polId);
  };

  const acknowledgedCount = policies.filter((p) => isPolicyAcknowledged(p._id)).length;
  const complianceRate = policies.length > 0 ? Math.round((acknowledgedCount / policies.length) * 100) : 100;

  const filteredPolicies = policies.filter((p) => {
    const s = search.toLowerCase();
    return p.title.toLowerCase().includes(s) || p.summary.toLowerCase().includes(s);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Company Policies & Employee Handbooks
          </h1>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
        {canCreate && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setUploadForm({
                  title: '',
                  category: 'HR',
                  version: '1.0',
                  summary: '',
                  mandatory: true,
                  effectiveDate: new Date().toISOString().split('T')[0],
                });
                setUploadFile(null);
                setUploadError(null);
                setShowUploadModal(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition-all"
            >
              <Upload className="w-4 h-4" />
              Upload Policy PDF
            </button>
            <button
              onClick={() => {
                setForm(emptyForm);
                setFormError(null);
                setShowCreateForm(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm transition-all border border-[#039583]"
            >
              <Plus className="w-4 h-4" />
              Create Policy
            </button>
          </div>
        )}
        <div className="flex items-center gap-3 bg-[#012a52] border border-[#039583]/50 p-3 rounded-2xl">
          <div className="w-10 h-10 rounded-xl bg-[#039583] text-white flex items-center justify-center font-black">
            {complianceRate}%
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-300">My Compliance Status</span>
            <p className="text-xs font-semibold text-white">
              {acknowledgedCount} of {policies.length} Policies Signed
            </p>
          </div>
        </div>
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

      {/* Main Grid: Policy Browser + Detail Reader */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Policies Directory (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search policies & handbooks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
            {filteredPolicies.map((pol) => {
              const isSelected = selectedPolicy?._id === pol._id;
              const isSigned = isPolicyAcknowledged(pol._id);

              return (
                <div
                  key={pol._id}
                  onClick={() => setSelectedPolicy(pol)}
                  className={`p-5 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 shadow-xs'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      isSelected ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {pol.category} • {pol.version}
                    </span>

                    {isSigned ? (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        isSelected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        <CheckCircle2 className="w-3 h-3" />
                        Signed
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        isSelected ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-800'
                      }`}>
                        <Clock className="w-3 h-3" />
                        Pending
                      </span>
                    )}
                  </div>

                  <h3 className={`font-bold text-sm tracking-tight ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                    {pol.title}
                  </h3>
                  <p className={`text-xs mt-1 line-clamp-2 ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                    {pol.summary}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Full Policy Reader (7 cols) */}
        <div className="lg:col-span-7">
          {selectedPolicy ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-8 space-y-6">
              <div className="border-b border-slate-200 pb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 font-mono">
                    {selectedPolicy.category} • Version {selectedPolicy.version}
                  </span>
                  {selectedPolicy.mandatory && (
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-800">
                      Mandatory Acknowledgment
                    </span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                    {selectedPolicy.title}
                  </h2>
                  {canDelete && (
                    <button
                      onClick={() => setPolicyToDelete(selectedPolicy)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 font-mono mt-1">
                  Effective Date: {selectedPolicy.effectiveDate} • Last Updated: {selectedPolicy.lastUpdated}
                </p>
              </div>

              {/* Policy Content */}
              <div className="p-5 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700 leading-relaxed font-sans whitespace-pre-line max-h-96 overflow-y-auto">
                {selectedPolicy.content}
              </div>

              {/* Digital Signature & Acknowledgment Action */}
              <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {isPolicyAcknowledged(selectedPolicy._id) ? (
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">Policy Digitally Signed & Recorded</p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        Authenticated by {user?.firstName} {user?.lastName}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-bold text-slate-900">Consent & Digital Signature</p>
                    <p className="text-[11px] text-slate-500">
                      By clicking below, you confirm having read and agreed to adhere to this charter.
                    </p>
                  </div>
                )}

                {!isPolicyAcknowledged(selectedPolicy._id) && (
                  <button
                    onClick={() => handleAcknowledge(selectedPolicy._id)}
                    disabled={isAcknowledging}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-sm transition-all shrink-0 disabled:opacity-50"
                  >
                    <FileCheck className="w-4 h-4" />
                    {isAcknowledging ? 'Recording Signature...' : 'Acknowledge & Sign Policy'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center text-center">
              <FileCheck className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-sm font-semibold text-slate-600">Select a policy to view full legal text.</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Policy Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreatePolicy}
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Create New Policy</h3>
              <button type="button" onClick={() => setShowCreateForm(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                {formError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Policy Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="e.g. Work From Home Policy"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as PolicyCategory })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="HR">HR</option>
                  <option value="COMPLIANCE">Compliance</option>
                  <option value="CONDUCT">Conduct</option>
                  <option value="SECURITY">Security</option>
                  <option value="REMOTE">Remote</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Version</label>
                <input
                  type="text"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Effective Date</label>
                <input
                  type="date"
                  value={form.effectiveDate}
                  onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Short Summary</label>
              <input
                type="text"
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="One-line description shown in the policy list"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Policy Content *</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={8}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="Full policy text..."
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.mandatory}
                onChange={(e) => setForm({ ...form, mandatory: e.target.checked })}
                className="rounded border-slate-300"
              />
              Mandatory acknowledgment for all employees
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Create Policy'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {policyToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete this policy?</h3>
                <p className="text-xs text-slate-500 mt-1">
                  "{policyToDelete.title}" will be permanently removed for all employees. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPolicyToDelete(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePolicy}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete Policy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};