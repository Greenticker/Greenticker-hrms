import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { HrRequest } from '../types/modules';
import { FileQuestion, Plus, CheckCircle2, Clock, Search, AlertCircle, X, MessageSquare } from 'lucide-react';

export const HrRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState<HrRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formData, setFormData] = useState({
    category: 'GENERAL',
    subject: '',
    description: '',
    priority: 'MEDIUM',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Resolve Ticket
  const [resolveItem, setResolveItem] = useState<HrRequest | null>(null);
  const [resolutionRemarks, setResolutionRemarks] = useState('');

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const res = await modulesService.getHrRequests(statusFilter);
      setRequests(res.requests);
    } catch (err) {
      console.error('Failed to load tickets', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [statusFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.subject || !formData.description) return;
    setIsSubmitting(true);
    try {
      const res = await modulesService.createHrRequest(formData);
      if (res.success) {
        setFeedback(`Ticket ${res.request.ticketNumber} logged with HR operations.`);
        setIsCreateOpen(false);
        setFormData({ category: 'GENERAL', subject: '', description: '', priority: 'MEDIUM' });
        fetchTickets();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error submitting ticket'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolve = async () => {
    if (!resolveItem) return;
    try {
      const res = await modulesService.resolveHrRequest(resolveItem._id, resolutionRemarks);
      if (res.success) {
        setFeedback(`Ticket ${resolveItem.ticketNumber} resolved.`);
        setResolveItem(null);
        setResolutionRemarks('');
        fetchTickets();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error resolving ticket'}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            HR Helpdesk & Query Ticketing
          </h1>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm transition-all shrink-0 border border-[#039583]"
        >
          <Plus className="w-4 h-4" />
          Raise HR Ticket
        </button>
      </div>

      {feedback && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-emerald-600 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        {['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED'].map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              statusFilter === st
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {st.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Tickets List */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading service requests...</div>
        ) : requests.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
            No service desk tickets found.
          </div>
        ) : (
          requests.map((ticket) => (
            <div
              key={ticket._id}
              className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    {ticket.ticketNumber}
                  </span>
                  <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                    {ticket.category}
                  </span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                    ticket.priority === 'HIGH' || ticket.priority === 'URGENT'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {ticket.priority}
                  </span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                    ticket.status === 'RESOLVED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {ticket.status}
                  </span>
                </div>

                <h3 className="font-bold text-sm text-slate-900">{ticket.subject}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{ticket.description}</p>

                <div className="text-[11px] text-slate-400 font-mono pt-1">
                  Submitted by {ticket.employeeName} ({ticket.department}) on {new Date(ticket.createdAt).toLocaleDateString()}
                  {ticket.assignedTo && <span> • Assigned to {ticket.assignedTo}</span>}
                </div>

                {ticket.resolutionRemarks && (
                  <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-900 text-xs mt-2 border border-emerald-100">
                    <span className="font-bold">Resolution Note: </span>
                    {ticket.resolutionRemarks}
                  </div>
                )}
              </div>

              {(user?.role === 'ADMIN') && ticket.status !== 'RESOLVED' && (
                <button
                  onClick={() => setResolveItem(ticket)}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shrink-0 shadow-xs"
                >
                  Mark Resolved
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Raise Ticket Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Raise HR Service Request</h2>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="PAYROLL">Payroll & Compensation</option>
                    <option value="DOCUMENTS">Official Letters & Visas</option>
                    <option value="BENEFITS">Medical Insurance & Benefits</option>
                    <option value="IT_ASSETS">Hardware / Laptop Upgrade</option>
                    <option value="LEAVE_ATTENDANCE">Attendance Correction</option>
                    <option value="GENERAL">General Policy Inquiry</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium (Standard SLA: 48h)</option>
                    <option value="HIGH">High (SLA: 24h)</option>
                    <option value="URGENT">Urgent (Immediate)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Subject / Summary</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Requesting official letter of employment for home loan mortgage"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Detailed Description</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Provide complete background, dates, and documentation specifics..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resolve Ticket Remarks Modal */}
      {resolveItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Resolve Ticket {resolveItem.ticketNumber}</h3>
            <p className="text-xs text-slate-500">Provide resolution remarks communicated to {resolveItem.employeeName}.</p>
            <textarea
              rows={3}
              placeholder="e.g. Letter uploaded to document vault and emailed to employee..."
              value={resolutionRemarks}
              onChange={(e) => setResolutionRemarks(e.target.value)}
              className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setResolveItem(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs"
              >
                Confirm Resolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
