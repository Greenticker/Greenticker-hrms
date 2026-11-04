import React, { useState, useEffect } from 'react';
import { VetanLogo } from '../components/common/anusyuti_logo';
import { Building2, Image, FileText, FileCode, CheckCircle2, ArrowRight, ArrowLeft, Upload, Loader2, Printer, Eye, Trash2, Plus } from 'lucide-react';
import { api } from '../services/api';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '../utils/uploadLimits';

interface CompanySetupPageProps {
  onComplete: () => void;
}

export const CompanySetupPage: React.FC<CompanySetupPageProps> = ({ onComplete }) => {
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Step 1: Profile
  const [profile, setProfile] = useState({
    name: '',
    code: '',
    domain: '',
    contactEmail: '',
    phone: '',
    taxIdentificationNumber: '',
    address: {
      street: '',
      city: '',
      state: '',
      country: '',
      zipCode: '',
    },
  });

  // Step 2: Branding Logo
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUrl, setLogoUrl] = useState('');

  // Step 3: Policies
  const [policies, setPolicies] = useState<any[]>([]);
  const [policyForm, setPolicyForm] = useState({
    title: '',
    category: 'GENERAL',
    version: 'v1.0',
    summary: '',
    effectiveDate: new Date().toISOString().split('T')[0],
    mandatory: true,
  });
  const [policyFile, setPolicyFile] = useState<File | null>(null);

  // Step 4: Letter Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<any | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  useEffect(() => {
    loadOrganizationProfile();
    loadTemplates();
  }, []);

  const loadOrganizationProfile = async () => {
    try {
      const res = await api.get('/organization/profile');
      if (res.organization) {
        setProfile({
          name: res.organization.name || '',
          code: res.organization.code || '',
          domain: res.organization.domain || '',
          contactEmail: res.organization.contactEmail || '',
          phone: res.organization.phone || '',
          taxIdentificationNumber: res.organization.taxIdentificationNumber || '',
          address: res.organization.address || { street: '', city: '', state: '', country: '', zipCode: '' },
        });
        if (res.organization.logoUrl) {
          setLogoUrl(res.organization.logoUrl);
        }
      }
    } catch (err) {
      console.error('Failed to load organization profile', err);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await api.get('/letter-templates');
      if (res.templates) {
        setTemplates(res.templates);
        if (res.templates.length > 0 && !activeTemplate) {
          setActiveTemplate(res.templates[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load templates', err);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.put('/organization/profile', profile);
      setSuccessMsg('Organization profile saved successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Failed to save profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadLogo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logoFile) {
      setStep(3);
      return;
    }
    if (logoFile.size > 2 * 1024 * 1024) {
      setError('Logo file size must not exceed 2MB.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('logo', logoFile);
      const res = await api.upload('/organization/logo', formData);
      if (res.logoUrl) {
        setLogoUrl(res.logoUrl);
      }
      setStep(3);
    } catch (err: any) {
      setError(err.message || 'Failed to upload logo.');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policyFile) {
      setStep(4);
      return;
    }
    if (policyFile.size > MAX_UPLOAD_BYTES) {
      setError(`Policy PDF size must not exceed ${MAX_UPLOAD_LABEL}.`);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('policyPdf', policyFile);
      formData.append('title', policyForm.title || policyFile.name);
      formData.append('category', policyForm.category);
      formData.append('version', policyForm.version);
      formData.append('summary', policyForm.summary);
      formData.append('effectiveDate', policyForm.effectiveDate);
      formData.append('mandatory', String(policyForm.mandatory));

      const res = await api.upload('/policies/upload', formData);
      if (res.policy) {
        setPolicies(prev => [res.policy, ...prev]);
        setPolicyFile(null);
        setPolicyForm({ title: '', category: 'GENERAL', version: 'v1.0', summary: '', effectiveDate: new Date().toISOString().split('T')[0], mandatory: true });
        setSuccessMsg('Policy uploaded successfully.');
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload policy.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!activeTemplate) return;
    setLoading(true);
    setError('');
    try {
      if (activeTemplate._id && !activeTemplate._id.startsWith('new_')) {
        await api.put(`/letter-templates/${activeTemplate._id}`, activeTemplate);
      } else {
        const res = await api.post('/letter-templates', activeTemplate);
        if (res.template) {
          setActiveTemplate(res.template);
        }
      }
      loadTemplates();
      setSuccessMsg('Letter template saved successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save template.');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewTemplate = async () => {
    if (!activeTemplate?._id) return;
    try {
      const res = await api.post(`/letter-templates/${activeTemplate._id}/preview`, {});
      if (res.content) {
        setPreviewHtml(res.content);
        setShowPreviewModal(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate preview.');
    }
  };

  const handleCompleteSetup = async () => {
    setLoading(true);
    setError('');
    try {
      await api.post('/organization/complete-setup', {});
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to complete setup.');
    } finally {
      setLoading(false);
    }
  };

  const insertToken = (token: string) => {
    if (!activeTemplate) return;
    setActiveTemplate({
      ...activeTemplate,
      content: (activeTemplate.content || '') + ` ${token} `,
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-8 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-3xl text-center mb-6">
        <div className="flex justify-center mb-4">
          <div className="bg-white px-5 py-2.5 rounded-2xl shadow-xl border border-slate-100 transition-transform hover:scale-[1.02]">
            <VetanLogo size="md" variant="horizontal" />
          </div>
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight">Enterprise Organization Setup Wizard</h2>
        <p className="text-xs text-slate-400 mt-1">Configure your company identity, branding, compliance policies, and letter templates</p>

        {/* Wizard Progress Steps */}
        <div className="flex items-center justify-center gap-2 mt-6">
          {[
            { num: 1, label: 'Company Profile', icon: Building2 },
            { num: 2, label: 'Branding Logo', icon: Image },
            { num: 3, label: 'Company Policies', icon: FileText },
            { num: 4, label: 'Letter Templates', icon: FileCode },
          ].map(s => {
            const Icon = s.icon;
            const isCurrent = step === s.num;
            const isDone = step > s.num;
            return (
              <div key={s.num} className="flex items-center gap-2">
                <button
                  onClick={() => setStep(s.num)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-[#039583] text-white shadow-md'
                      : isDone
                      ? 'bg-slate-800 text-[#039583] border border-[#039583]/40'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{s.num}. {s.label}</span>
                </button>
                {s.num < 4 && <div className="w-4 h-[1px] bg-slate-700 hidden sm:block" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-3xl px-4">
        <div className="bg-white shadow-2xl rounded-2xl border border-slate-100 p-6 sm:p-8">
          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {successMsg}
            </div>
          )}

          {/* STEP 1: ORGANIZATION PROFILE */}
          {step === 1 && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="border-b border-slate-100 pb-3 mb-4">
                <h3 className="text-sm font-bold text-slate-900">Step 1: Company Profile & Tax Details</h3>
                <p className="text-xs text-slate-500">Provide official organizational details for statutory payroll and compliance generation.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Company Legal Name</label>
                  <input
                    type="text"
                    required
                    value={profile.name}
                    onChange={e => setProfile({ ...profile, name: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Company Code / Prefix</label>
                  <input
                    type="text"
                    required
                    value={profile.code}
                    onChange={e => setProfile({ ...profile, code: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Corporate Domain</label>
                  <input
                    type="text"
                    value={profile.domain}
                    onChange={e => setProfile({ ...profile, domain: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Official Contact Email</label>
                  <input
                    type="email"
                    required
                    value={profile.contactEmail}
                    onChange={e => setProfile({ ...profile, contactEmail: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={profile.phone}
                    onChange={e => setProfile({ ...profile, phone: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tax ID / Employer TAN</label>
                <input
                  type="text"
                  value={profile.taxIdentificationNumber}
                  onChange={e => setProfile({ ...profile, taxIdentificationNumber: e.target.value })}
                  placeholder="e.g. SFZ98412B"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                />
              </div>

              <div className="border-t border-slate-100 pt-3">
                <label className="block text-xs font-semibold text-slate-700 mb-2">Registered Address</label>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Street Address"
                    value={profile.address.street}
                    onChange={e => setProfile({ ...profile, address: { ...profile.address, street: e.target.value } })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      placeholder="City"
                      value={profile.address.city}
                      onChange={e => setProfile({ ...profile, address: { ...profile.address, city: e.target.value } })}
                      className="px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                    />
                    <input
                      type="text"
                      placeholder="State"
                      value={profile.address.state}
                      onChange={e => setProfile({ ...profile, address: { ...profile.address, state: e.target.value } })}
                      className="px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                    />
                    <input
                      type="text"
                      placeholder="Country"
                      value={profile.address.country}
                      onChange={e => setProfile({ ...profile, address: { ...profile.address, country: e.target.value } })}
                      className="px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                    />
                    <input
                      type="text"
                      placeholder="Zip Code"
                      value={profile.address.zipCode}
                      onChange={e => setProfile({ ...profile, address: { ...profile.address, zipCode: e.target.value } })}
                      className="px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 bg-[#039583] hover:bg-[#027d70] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Save & Next <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: BRANDING LOGO */}
          {step === 2 && (
            <form onSubmit={handleUploadLogo} className="space-y-6">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">Step 2: Corporate Branding & Logo Upload</h3>
                <p className="text-xs text-slate-500">Upload your company logo (PNG, JPG, SVG, max 2MB) for display across payslips, invoices, and the workspace header.</p>
              </div>

              <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50">
                {logoUrl ? (
                  <div className="mb-4 p-4 bg-white rounded-xl shadow-sm border border-slate-200 flex items-center justify-center">
                    <img src={logoUrl} alt="Company Logo" className="h-16 object-contain" />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-[#023b77]/10 text-[#023b77] flex items-center justify-center mb-3">
                    <Upload className="w-8 h-8" />
                  </div>
                )}
                <p className="text-xs font-semibold text-slate-700 mb-1">Drag and drop your logo file here, or browse</p>
                <p className="text-[10px] text-slate-400 mb-4">Maximum file size: 2MB</p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => e.target.files?.[0] && setLogoFile(e.target.files[0])}
                  className="text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-[#039583] file:text-white hover:file:bg-[#027d70] cursor-pointer"
                />
                {logoFile && <p className="text-xs font-medium text-emerald-600 mt-2">Selected: {logoFile.name}</p>}
              </div>

              <div className="flex justify-between pt-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 bg-[#039583] hover:bg-[#027d70] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Save & Next <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: COMPANY POLICIES */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Step 3: Company Policies & Handbooks</h3>
                  <p className="text-xs text-slate-500">Upload compliance PDFs (Code of Conduct, POSH, InfoSec) up to {MAX_UPLOAD_LABEL}.</p>
                </div>
              </div>

              <form onSubmit={handleUploadPolicy} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-800">Upload New Policy PDF</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Policy Title"
                    required
                    value={policyForm.title}
                    onChange={e => setPolicyForm({ ...policyForm, title: e.target.value })}
                    className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                  <select
                    value={policyForm.category}
                    onChange={e => setPolicyForm({ ...policyForm, category: e.target.value })}
                    className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  >
                    <option value="GENERAL">General</option>
                    <option value="CONDUCT">Code of Conduct</option>
                    <option value="SECURITY">Information Security</option>
                    <option value="COMPLIANCE">Compliance / POSH</option>
                    <option value="REMOTE">Remote Work</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Summary description"
                    value={policyForm.summary}
                    onChange={e => setPolicyForm({ ...policyForm, summary: e.target.value })}
                    className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                  <input
                    type="file"
                    accept=".pdf"
                    required
                    onChange={e => e.target.files?.[0] && setPolicyFile(e.target.files[0])}
                    className="text-xs text-slate-500 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#039583] file:text-white cursor-pointer"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Upload Policy
                  </button>
                </div>
              </form>

              {policies.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700">Uploaded Policies ({policies.length})</h4>
                  {policies.map((p, idx) => (
                    <div key={idx} className="p-3 bg-white border border-slate-100 rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <p className="font-bold text-slate-900">{p.title}</p>
                        <p className="text-[10px] text-slate-400">Category: {p.category} · Version: {p.version}</p>
                      </div>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold text-[10px]">Active</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between pt-4">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="px-5 py-2.5 bg-[#039583] hover:bg-[#027d70] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
                >
                  Save & Next <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: LETTER TEMPLATES */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Step 4: Letter Templates & Document Engine</h3>
                  <p className="text-xs text-slate-500">Configure HTML letter templates with dynamic mustache tokens.</p>
                </div>
                <button
                  onClick={() => {
                    const newTmpl = { _id: `new_${Date.now()}`, title: 'New Letter Template', category: 'OTHER', subject: 'Company Notice', content: '<p>Dear {{employee_name}},</p>' };
                    setTemplates([...templates, newTmpl]);
                    setActiveTemplate(newTmpl);
                  }}
                  className="px-3 py-1.5 bg-[#039583] text-white text-xs font-bold rounded-xl shadow-xs hover:bg-[#027d70] flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Template
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700">Available Templates</h4>
                  {templates.map(t => (
                    <button
                      key={t._id}
                      onClick={() => setActiveTemplate(t)}
                      className={`w-full text-left p-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                        activeTemplate?._id === t._id ? 'bg-[#023b77] text-white border-[#023b77]' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <p className="font-bold">{t.title}</p>
                      <p className={`text-[10px] ${activeTemplate?._id === t._id ? 'text-slate-200' : 'text-slate-400'}`}>Category: {t.category}</p>
                    </button>
                  ))}
                </div>

                <div className="lg:col-span-2 space-y-4">
                  {activeTemplate ? (
                    <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Template Title</label>
                        <input
                          type="text"
                          value={activeTemplate.title}
                          onChange={e => setActiveTemplate({ ...activeTemplate, title: e.target.value })}
                          className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#039583]"
                        />
                      </div>

                      <div className="flex flex-wrap gap-1.5 py-1">
                        <span className="text-[10px] font-bold text-slate-500 self-center mr-1">Insert Token:</span>
                        {['{{employee_name}}', '{{employee_code}}', '{{department}}', '{{designation}}', '{{joining_date}}', '{{company_name}}', '{{salary}}'].map(token => (
                          <button
                            key={token}
                            type="button"
                            onClick={() => insertToken(token)}
                            className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-mono font-semibold text-[#023b77] hover:bg-slate-100 cursor-pointer shadow-xs"
                          >
                            {token}
                          </button>
                        ))}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Upload Word / PDF Template Document (.doc, .docx, .pdf)</label>
                        <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-white hover:border-[#039583] transition">
                          <input
                            type="file"
                            accept=".doc,.docx,.pdf"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) {
                                setActiveTemplate({ ...activeTemplate, fileName: file.name, content: `[Uploaded Document Template: ${file.name}]` });
                              }
                            }}
                            className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-[#039583] file:text-white hover:file:bg-[#027d70] cursor-pointer"
                          />
                          <p className="text-[11px] text-slate-400 mt-2">
                            {activeTemplate.fileName ? `Selected: ${activeTemplate.fileName}` : 'Choose Word (.doc, .docx) or PDF (.pdf) letter/policy template file'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={handlePreviewTemplate}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" /> Preview & Test Merge
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveTemplate}
                          disabled={loading}
                          className="px-4 py-1.5 bg-[#039583] hover:bg-[#027d70] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                        >
                          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Template'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                      Select or create a template to edit.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between pt-6 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={handleCompleteSetup}
                  disabled={loading}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Complete Setup & Launch Dashboard <CheckCircle2 className="w-4 h-4" /></>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Letter Template Preview (Merged Data)</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1 bg-slate-900 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                <button onClick={() => setShowPreviewModal(false)} className="text-slate-400 hover:text-slate-600">
                  ✕
                </button>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      )}
    </div>
  );
};
