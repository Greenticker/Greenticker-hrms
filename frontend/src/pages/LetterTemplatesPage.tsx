import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { letterTemplateService } from '../services/letterTemplateService';
import { employeeService } from '../services/employeeService';
import { Employee } from '../types/employee';
import { GalleryLetterTemplate, LetterTemplate, LetterTemplateCategory } from '../types/letterTemplates';
import { Mail, Eye, Printer, Save, Trash2, Loader2, CopyPlus, FileText, X } from 'lucide-react';
import { canWrite } from '../utils/access';

type TabId = 'templates' | 'gallery';

const CATEGORIES: LetterTemplateCategory[] = [
  'OFFER',
  'APPOINTMENT',
  'CONFIRMATION',
  'PROMOTION',
  'INCREMENT',
  'REDESIGNATION',
  'DEPARTMENT_TRANSFER',
  'LOCATION_TRANSFER',
  'PROBATION_EXTENSION',
  'ADDRESS_PROOF',
  'EXPERIENCE',
  'RELIEVING',
  'TERMINATION',
  'OTHER',
];

const MERGE_TOKENS = [
  '{{employee_name}}',
  '{{employee_first_name}}',
  '{{employee_code}}',
  '{{department}}',
  '{{designation}}',
  '{{joining_date}}',
  '{{location}}',
  '{{reporting_manager}}',
  '{{probation_end_date}}',
  '{{employee_address}}',
  '{{salary}}',
  '{{letter_date}}',
  '{{company_name}}',
  '{{company_address}}',
];

const categoryLabel = (c: string) =>
  c
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** Opens the merged letter in a new window and prints just the letter. */
function printLetter(title: string, html: string) {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

interface PreviewState {
  title: string;
  /** Gallery key or organisation template id that the preview was generated from. */
  source: { kind: 'gallery'; key: string } | { kind: 'template'; id: string };
  content: string;
}

export const LetterTemplatesPage: React.FC = () => {
  const { user } = useAuth();
  // Add / edit / delete follow the role matrix (Core HR: read & write)
  const isAdmin = canWrite(user?.role, 'core_hr');

  const [tab, setTab] = useState<TabId>('templates');
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [gallery, setGallery] = useState<GalleryLetterTemplate[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [active, setActive] = useState<LetterTemplate | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewEmployeeId, setPreviewEmployeeId] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  };

  const loadTemplates = async (selectId?: string) => {
    const res = await letterTemplateService.getTemplates();
    setTemplates(res.templates);
    const next = res.templates.find((t) => t._id === (selectId ?? active?._id)) ?? res.templates[0] ?? null;
    setActive(next ? { ...next } : null);
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [, galleryRes] = await Promise.all([loadTemplates(), letterTemplateService.getGallery()]);
        setGallery(galleryRes.templates);
      } catch (err: any) {
        setError(err.message || 'Failed to load letter templates.');
      } finally {
        setLoading(false);
      }
      // Employee picker for previews; roles without directory access just preview with sample data.
      try {
        const res = await employeeService.getEmployees();
        setEmployees(res.employees);
      } catch {
        setEmployees([]);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPreview = async (source: PreviewState['source'], employeeId: string) => {
    setPreviewLoading(true);
    setError('');
    try {
      const res =
        source.kind === 'gallery'
          ? await letterTemplateService.previewGalleryTemplate(source.key, employeeId || undefined)
          : await letterTemplateService.previewTemplate(source.id, employeeId || undefined);
      setPreview({ title: res.title, source, content: res.content });
    } catch (err: any) {
      setError(err.message || 'Failed to generate preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const openPreview = (source: PreviewState['source']) => fetchPreview(source, previewEmployeeId);

  const handleUseGalleryTemplate = async (key: string) => {
    setSaving(true);
    setError('');
    try {
      const res = await letterTemplateService.useGalleryTemplate(key);
      await loadTemplates(res.template._id);
      setPreview(null);
      setTab('templates');
      flash(`"${res.template.title}" added to your letter templates.`);
    } catch (err: any) {
      setError(err.message || 'Failed to add template.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!active) return;
    setSaving(true);
    setError('');
    try {
      const { title, category, subject, content } = active;
      await letterTemplateService.updateTemplate(active._id, { title, category, subject, content });
      await loadTemplates(active._id);
      flash('Letter template saved.');
    } catch (err: any) {
      setError(err.message || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!active || !window.confirm(`Delete "${active.title}"? This cannot be undone.`)) return;
    setSaving(true);
    setError('');
    try {
      await letterTemplateService.deleteTemplate(active._id);
      setActive(null);
      await loadTemplates('');
      flash('Letter template deleted.');
    } catch (err: any) {
      setError(err.message || 'Failed to delete template.');
    } finally {
      setSaving(false);
    }
  };

  const insertToken = (token: string) => {
    if (!active) return;
    setActive({ ...active, content: `${active.content}${token}` });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <h1 className="text-2xl font-bold tracking-tight text-white">Letter Templates</h1>
        <p className="text-xs text-slate-300 mt-1">
          Generate offer, appointment, transfer, relieving and other HR letters with employee data merged in
        </p>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs px-4 flex gap-6">
        {([
          { id: 'templates', label: 'Letter Template' },
          { id: 'gallery', label: 'Template Gallery' },
        ] as { id: TabId; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              tab === t.id ? 'border-[#039583] text-[#023b77]' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">{error}</div>}
      {notice && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">{notice}</div>}

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading letter templates...</div>
      ) : tab === 'gallery' ? (
        /* Template Gallery */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {gallery.map((g) => (
            <div key={g.key} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-slate-100 text-[#023b77] flex items-center justify-center">
                    <Mail className="w-4 h-4" />
                  </span>
                  <h3 className="text-sm font-semibold text-slate-900 truncate">{g.title}</h3>
                </div>
                <button
                  onClick={() => openPreview({ kind: 'gallery', key: g.key })}
                  className="shrink-0 text-xs font-semibold text-[#039583] hover:text-[#027d70] cursor-pointer"
                >
                  Preview Template
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-3 leading-relaxed">{g.description}</p>
            </div>
          ))}
        </div>
      ) : (
        /* Organisation letter templates */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Your Templates ({templates.length})</h4>
            {templates.length === 0 && (
              <div className="p-4 text-xs text-slate-500 bg-white rounded-xl border border-slate-200">
                No letter templates yet.{' '}
                <button onClick={() => setTab('gallery')} className="font-semibold text-[#039583] cursor-pointer">
                  Browse the Template Gallery
                </button>{' '}
                to add one.
              </div>
            )}
            {templates.map((t) => (
              <button
                key={t._id}
                onClick={() => setActive({ ...t })}
                className={`w-full text-left p-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                  active?._id === t._id ? 'bg-[#023b77] text-white border-[#023b77]' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <p className="font-bold">{t.title}</p>
                <p className={`text-[10px] ${active?._id === t._id ? 'text-slate-200' : 'text-slate-400'}`}>{categoryLabel(t.category)}</p>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            {active ? (
              <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Template Title</label>
                    <input
                      type="text"
                      value={active.title}
                      disabled={!isAdmin}
                      onChange={(e) => setActive({ ...active, title: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#039583]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                    <select
                      value={active.category}
                      disabled={!isAdmin}
                      onChange={(e) => setActive({ ...active, category: e.target.value as LetterTemplateCategory })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#039583]"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {categoryLabel(c)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">E-mail Subject</label>
                  <input
                    type="text"
                    value={active.subject}
                    disabled={!isAdmin}
                    onChange={(e) => setActive({ ...active, subject: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                </div>

                {isAdmin && (
                  <div className="flex flex-wrap gap-1.5 py-1">
                    <span className="text-[10px] font-bold text-slate-500 self-center mr-1">Insert Token:</span>
                    {MERGE_TOKENS.map((token) => (
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
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Letter Content (HTML) <span className="font-normal text-slate-400">— text in [brackets] is filled in manually</span>
                  </label>
                  <textarea
                    value={active.content}
                    readOnly={!isAdmin}
                    onChange={(e) => setActive({ ...active, content: e.target.value })}
                    rows={16}
                    className="w-full px-3 py-2 text-[11px] font-mono border border-slate-200 rounded-xl bg-white read-only:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => openPreview({ kind: 'template', id: active._id })}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview & Test Merge
                  </button>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={saving}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-1.5 bg-[#039583] hover:bg-[#027d70] text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Template
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              templates.length > 0 && (
                <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
                  <FileText className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                  Select a template to view or edit.
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">{preview.title}</h3>
              <div className="flex items-center gap-2">
                {preview.source.kind === 'gallery' && isAdmin && (
                  <button
                    onClick={() => handleUseGalleryTemplate((preview.source as { key: string }).key)}
                    disabled={saving}
                    className="px-3 py-1 bg-[#039583] hover:bg-[#027d70] text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CopyPlus className="w-3.5 h-3.5" />} Use this Template
                  </button>
                )}
                <button
                  onClick={() => printLetter(preview.title, preview.content)}
                  className="px-3 py-1 bg-slate-900 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Close preview">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {employees.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-600">Merge data for:</label>
                <select
                  value={previewEmployeeId}
                  onChange={(e) => {
                    setPreviewEmployeeId(e.target.value);
                    fetchPreview(preview.source, e.target.value);
                  }}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#039583]"
                >
                  <option value="">Sample employee</option>
                  {employees.map((emp) => (
                    <option key={emp._id} value={emp._id}>
                      {emp.firstName} {emp.lastName} ({emp.employeeCode})
                    </option>
                  ))}
                </select>
                {previewLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
              </div>
            )}

            <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl" dangerouslySetInnerHTML={{ __html: preview.content }} />
          </div>
        </div>
      )}
    </div>
  );
};
