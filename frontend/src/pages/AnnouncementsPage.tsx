import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { AnnouncementItem } from '../types/modules';
import {
  Megaphone,
  Pin,
  Plus,
  User,
  X,
  Sparkles,
  BarChart3,
  CheckCircle2,
  Trash2,
  Vote,
} from 'lucide-react';

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

  // Poll form state
  const [includePoll, setIncludePoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);

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

  const handleAddPollOption = () => {
    if (pollOptions.length < 6) {
      setPollOptions((prev) => [...prev, '']);
    }
  };

  const handleRemovePollOption = (index: number) => {
    if (pollOptions.length > 2) {
      setPollOptions((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleOptionChange = (index: number, val: string) => {
    setPollOptions((prev) => {
      const copy = [...prev];
      copy[index] = val;
      return copy;
    });
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.content) return;

    let pollPayload: { question: string; options: string[] } | undefined = undefined;
    if (includePoll) {
      const validOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (!pollQuestion.trim() || validOptions.length < 2) {
        setFeedback('Please enter a poll question and at least 2 valid options.');
        return;
      }
      pollPayload = {
        question: pollQuestion.trim(),
        options: validOptions,
      };
    }

    setIsSubmitting(true);
    try {
      const res = await modulesService.publishAnnouncement({
        ...formData,
        poll: pollPayload,
      });
      if (res.success) {
        setFeedback('Announcement broadcasted to workforce.');
        setIsComposeOpen(false);
        setFormData({ title: '', content: '', category: 'GENERAL', priority: 'NORMAL', pinned: false });
        setIncludePoll(false);
        setPollQuestion('');
        setPollOptions(['', '']);
        fetchAnnouncements();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error publishing'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVote = async (announcementId: string, optionId: string) => {
    try {
      const res = await modulesService.voteAnnouncementPoll(announcementId, optionId);
      if (res.success && res.announcement) {
        setAnnouncements((prev) =>
          prev.map((a) => (a._id === announcementId ? res.announcement : a))
        );
      }
    } catch (err: any) {
      console.error('Failed to vote:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Megaphone className="w-6 h-6 text-[#039583]" />
            <span>Company Broadcasts & Announcements</span>
          </h1>
          <p className="text-xs text-slate-200 mt-1">
            Workforce notices, policy alerts, company milestones & interactive polls.
          </p>
        </div>

        {(user?.role === 'ADMIN' || user?.role === 'HR') && (
          <button
            onClick={() => setIsComposeOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm transition-all border border-[#039583] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Publish Announcement / Poll</span>
          </button>
        )}
      </div>

      {feedback && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center justify-between shadow-2xs">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Announcements Stream */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading broadcasts...</div>
        ) : announcements.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">No broadcasts published yet.</div>
        ) : (
          announcements.map((ann) => {
            const hasPoll = !!ann.poll && ann.poll.options && ann.poll.options.length > 0;
            const totalVotes = ann.poll?.totalVotes || 0;
            const currentUserId = user?.id || '';

            return (
              <div
                key={ann._id}
                className={`p-6 rounded-2xl border transition-all ${
                  ann.pinned
                    ? 'bg-gradient-to-r from-amber-50/40 via-white to-white border-amber-200 shadow-xs'
                    : 'bg-white border-slate-200 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {ann.pinned && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md">
                        <Pin className="w-3 h-3 text-amber-700" /> Pinned
                      </span>
                    )}
                    {hasPoll && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-md">
                        <BarChart3 className="w-3 h-3 text-indigo-600" /> Interactive Poll
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
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line mb-4">
                  {ann.content}
                </p>

                {/* Poll Card */}
                {hasPoll && ann.poll && (
                  <div className="mt-4 p-5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Vote className="w-4 h-4 text-indigo-600 shrink-0" />
                        <h3 className="text-xs font-bold text-slate-900">{ann.poll.question}</h3>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 font-bold bg-white px-2.5 py-1 rounded-full border border-slate-200">
                        {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
                      </span>
                    </div>

                    <div className="space-y-2.5 pt-1">
                      {ann.poll.options.map((opt) => {
                        const votes = opt.votes || 0;
                        const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
                        const isVoted = (opt.votedUserIds || []).includes(currentUserId);

                        return (
                          <div
                            key={opt.id}
                            onClick={() => handleVote(ann._id, opt.id)}
                            className={`group relative p-3 rounded-xl border transition-all cursor-pointer overflow-hidden ${
                              isVoted
                                ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500/30'
                                : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50/80'
                            }`}
                          >
                            {/* Percentage Bar Background Fill */}
                            <div
                              className={`absolute left-0 top-0 bottom-0 transition-all duration-500 pointer-events-none ${
                                isVoted ? 'bg-indigo-100/60' : 'bg-slate-100/80'
                              }`}
                              style={{ width: `${pct}%` }}
                            />

                            <div className="relative flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                                    isVoted
                                      ? 'border-indigo-600 bg-indigo-600 text-white'
                                      : 'border-slate-300 bg-white group-hover:border-indigo-400'
                                  }`}
                                >
                                  {isVoted && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                                </div>
                                <span
                                  className={`font-semibold ${
                                    isVoted ? 'text-indigo-950 font-bold' : 'text-slate-800'
                                  }`}
                                >
                                  {opt.text}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 font-mono">
                                <span className="font-bold text-slate-900">{pct}%</span>
                                <span className="text-[10px] text-slate-400">({votes})</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                      <span>Click any option to cast or change your vote</span>
                      {ann.poll.options.some((o) => (o.votedUserIds || []).includes(currentUserId)) && (
                        <span className="text-indigo-600 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Your vote is recorded
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>Published by {ann.publishedBy}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Compose Modal */}
      {isComposeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span>Publish Announcement & Poll</span>
              </h2>
              <button
                onClick={() => setIsComposeOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePublish} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Headline Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q4 Company All-Hands Town Hall Announcement"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">Body Text *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Detail the announcement information, links, agenda, and guidelines..."
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                <input
                  type="checkbox"
                  id="pinCheck"
                  checked={formData.pinned}
                  onChange={(e) => setFormData({ ...formData, pinned: e.target.checked })}
                  className="rounded text-slate-900 cursor-pointer"
                />
                <label htmlFor="pinCheck" className="text-xs font-medium text-slate-700 cursor-pointer">
                  Pin to Top of Workforce Stream
                </label>
              </div>

              {/* Poll Composition Section */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-indigo-600" />
                    <span className="text-xs font-bold text-slate-900">Include Interactive Poll</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={includePoll}
                    onChange={(e) => setIncludePoll(e.target.checked)}
                    className="rounded text-indigo-600 cursor-pointer"
                  />
                </div>

                {includePoll && (
                  <div className="space-y-3 pt-2 border-t border-slate-200/80">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Poll Question / Prompt *
                      </label>
                      <input
                        type="text"
                        required={includePoll}
                        placeholder="e.g. Which topic should we prioritize for next month's workshop?"
                        value={pollQuestion}
                        onChange={(e) => setPollQuestion(e.target.value)}
                        className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-600"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-700">Poll Options *</label>
                      {pollOptions.map((opt, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-400 w-4 text-center">
                            {idx + 1}.
                          </span>
                          <input
                            type="text"
                            required={includePoll}
                            placeholder={`Option ${idx + 1}`}
                            value={opt}
                            onChange={(e) => handleOptionChange(idx, e.target.value)}
                            className="flex-1 text-xs p-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-600"
                          />
                          {pollOptions.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemovePollOption(idx)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                              title="Remove option"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}

                      {pollOptions.length < 6 && (
                        <button
                          type="button"
                          onClick={handleAddPollOption}
                          className="mt-1 flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Option</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsComposeOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs disabled:opacity-50 cursor-pointer"
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
