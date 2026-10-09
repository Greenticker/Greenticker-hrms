import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { AnnouncementItem } from '../types/modules';
import { Megaphone, Pin, Plus, Calendar, User, AlertCircle, X, Sparkles } from 'lucide-react';

export const AnnouncementsPage: React.FC = () => {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: 'GENERAL',
    priority: 'NORMAL',
    pinned: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchAnnouncements = async () => {
    setLoading(true);
    try {
      const res = await modulesService.getAnnouncements();
      setAnnouncements(res.announcements);
    } catch (err) {
      console.error('Failed to load announcements', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.content) return;
    setIsSubmitting(true);
    try {
      const res = await modulesService.publishAnnouncement(formData);
      if (res.success) {
        setFeedback('Announcement broadcasted to workforce.');
        setIsComposeOpen(false);
        setFormData({ title: '', content: '', category: 'GENERAL', priority: 'NORMAL', pinned: false });
        fetchAnnouncements();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error publishing'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Company Broadcasts & Announcements
          </h1>
        </div>

        {(user?.role === 'ADMIN') && (
          <button
            onClick={() => setIsComposeOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm transition-all border border-[#039583]"
          >
            <Plus className="w-4 h-4" />
            Publish Announcement
          </button>
        )}
      </div>

      {feedback && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-emerald-600 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Announcements Stream */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading broadcasts...</div>
        ) : (
          announcements.map((ann) => (
            <div
              key={ann._id}
              className={`p-6 rounded-2xl border transition-all ${
                ann.pinned
                  ? 'bg-gradient-to-r from-amber-50/50 to-white border-amber-200 shadow-xs'
                  : 'bg-white border-slate-200 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  {ann.pinned && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">
                      <Pin className="w-3 h-3" /> Pinned
                    </span>
                  )}
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                    {ann.category}
                  </span>
                  {ann.priority === 'HIGH' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md">
                      Priority High
                    </span>
                  )}
                </div>

                <span className="text-[11px] font-mono text-slate-400">
                  {new Date(ann.publishedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>

              <h2 className="text-base font-bold text-slate-900 tracking-tight mb-2">
                {ann.title}
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                {ann.content}
              </p>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-400">
                <User className="w-3.5 h-3.5" />
                <span>Published by {ann.publishedBy}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Compose Modal */}
      {isComposeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Publish Company Announcement</h2>
              <button onClick={() => setIsComposeOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePublish} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Headline Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q4 Company All-Hands Town Hall Announcement"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="GENERAL">General Notice</option>
                    <option value="EVENT">Event / Town Hall</option>
                    <option value="POLICY">Policy Update</option>
                    <option value="HR_ALERT">HR Alert / Benefits</option>
                    <option value="CELEBRATION">Celebration / Festival</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High Priority</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Body Text</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Detail the announcement information, links, agenda, and guidelines..."
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pinCheck"
                  checked={formData.pinned}
                  onChange={(e) => setFormData({ ...formData, pinned: e.target.checked })}
                  className="rounded text-slate-900"
                />
                <label htmlFor="pinCheck" className="text-xs text-slate-700 cursor-pointer">
                  Pin to Top of Workforce Stream
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsComposeOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Publishing...' : 'Broadcast'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
