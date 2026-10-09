import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { LeaveRequest, LeaveBalance, LeaveType } from '../types/modules';
import {
  CalendarDays,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  Search,
  AlertCircle,
  X,
  Palmtree,
  Stethoscope,
  Award,
  Heart,
  Calendar,
  UserCheck,
} from 'lucide-react';

export const LeavePage: React.FC = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  // Apply modal
  const [isApplyOpen, setIsApplyOpen] = useState(false);
  const [applyForm, setApplyForm] = useState({
    leaveType: 'CASUAL' as LeaveType,
    startDate: '',
    endDate: '',
    daysCount: 1,
    isHalfDay: false,
    halfDaySession: 'MORNING' as 'MORNING' | 'AFTERNOON',
    reason: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Review modal
  const [reviewItem, setReviewItem] = useState<LeaveRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const fetchLeaveData = async () => {
    setLoading(true);
    try {
      const res = await modulesService.getLeaveRequests({
        status: statusFilter,
      });
      setRequests(res.requests);
      setBalance(res.balance);
    } catch (err) {
      console.error('Failed to load leaves', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaveData();
  }, [statusFilter]);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyForm.startDate || !applyForm.endDate || !applyForm.reason) return;
    setIsSubmitting(true);
    try {
      const res = await modulesService.applyLeave(applyForm);
      if (res.success) {
        setFeedback('Leave request submitted successfully for approval.');
        setIsApplyOpen(false);
        setApplyForm({
          leaveType: 'CASUAL',
          startDate: '',
          endDate: '',
          daysCount: 1,
          isHalfDay: false,
          halfDaySession: 'MORNING',
          reason: '',
        });
        fetchLeaveData();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error submitting leave'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await modulesService.updateLeaveStatus(id, status, rejectionReason);
      if (res.success) {
        setFeedback(`Leave request marked as ${status}.`);
        setReviewItem(null);
        setRejectionReason('');
        fetchLeaveData();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error updating status'}`);
    }
  };

  const filteredRequests = requests.filter((r) => {
    const matchesSearch =
      r.employeeName.toLowerCase().includes(search.toLowerCase()) ||
      r.employeeCode.toLowerCase().includes(search.toLowerCase()) ||
      r.department.toLowerCase().includes(search.toLowerCase()) ||
      r.reason.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Leave Requests & Entitlements
          </h1>
        </div>

        <button
          onClick={() => setIsApplyOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm transition-all border border-[#039583]"
        >
          <Plus className="w-4 h-4" />
          Apply for Leave
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

      {/* Leave Balances Cards */}
      {balance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Palmtree className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Casual Leave (CL)</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-slate-900">{balance.casual.remaining}</span>
                <span className="text-xs text-slate-400 font-medium">/ {balance.casual.total} Days Total</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">{balance.casual.used} days utilized this year</p>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sick Leave (SL)</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-slate-900">{balance.sick.remaining}</span>
                <span className="text-xs text-slate-400 font-medium">/ {balance.sick.total} Days Total</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">{balance.sick.used} days utilized this year</p>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Earned Leave (EL)</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-slate-900">{balance.earned.remaining}</span>
                <span className="text-xs text-slate-400 font-medium">/ {balance.earned.total} Days Total</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">{balance.earned.used} days utilized (carryover max 30)</p>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
              <Heart className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Parental / Maternity</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-slate-900">{balance.maternity.remaining}</span>
                <span className="text-xs text-slate-400 font-medium">Days Statutory</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">Full salary statutory entitlement</p>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 overflow-x-auto">
          {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search leaves, employee, reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
          />
        </div>
      </div>

      {/* Leaves Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-400 border-b border-slate-100">
              <tr>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Leave Type</th>
                <th className="py-3 px-4">Dates & Duration</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Reviewed By</th>
                {(user?.role === 'ADMIN') && (
                  <th className="py-3 px-4 text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Loading leave requests...
                  </td>
                </tr>
              ) : filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No leave requests found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr key={req._id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      <div>{req.employeeName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{req.employeeCode} • {req.department}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                        req.leaveType === 'CASUAL'
                          ? 'bg-blue-100 text-blue-800'
                          : req.leaveType === 'SICK'
                          ? 'bg-rose-100 text-rose-800'
                          : req.leaveType === 'EARNED'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-purple-100 text-purple-800'
                      }`}>
                        {req.leaveType}
                      </span>
                      {req.isHalfDay && (
                        <span className="ml-1.5 text-[10px] text-slate-400">
                          (Half Day - {req.halfDaySession})
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-800 font-mono text-[11px]">
                        {req.startDate} {req.startDate !== req.endDate ? `to ${req.endDate}` : ''}
                      </div>
                      <div className="text-[11px] text-slate-400">{req.daysCount} Day(s)</div>
                    </td>
                    <td className="py-3.5 px-4 max-w-xs truncate" title={req.reason}>
                      {req.reason}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        req.status === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : req.status === 'REJECTED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {req.status === 'APPROVED' && <CheckCircle2 className="w-3 h-3" />}
                        {req.status === 'REJECTED' && <XCircle className="w-3 h-3" />}
                        {req.status === 'PENDING' && <Clock className="w-3 h-3" />}
                        {req.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-500">
                      {req.reviewedBy || '—'}
                      {req.rejectionReason && (
                        <div className="text-[10px] text-rose-600 italic">"{req.rejectionReason}"</div>
                      )}
                    </td>
                    {(user?.role === 'ADMIN') && (
                      <td className="py-3.5 px-4 text-right">
                        {req.status === 'PENDING' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleUpdateStatus(req._id, 'APPROVED')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-[11px] shadow-xs"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => setReviewItem(req)}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium text-[11px]"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Apply Leave Modal */}
      {isApplyOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Apply for Leave</h2>
              <button onClick={() => setIsApplyOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleApply} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Leave Category</label>
                <select
                  value={applyForm.leaveType}
                  onChange={(e) => setApplyForm({ ...applyForm, leaveType: e.target.value as LeaveType })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="CASUAL">Casual Leave (CL)</option>
                  <option value="SICK">Sick Leave (SL)</option>
                  <option value="EARNED">Earned Leave (EL)</option>
                  <option value="MATERNITY">Maternity Leave</option>
                  <option value="PATERNITY">Paternity Leave</option>
                  <option value="UNPAID">Unpaid Leave (Loss of Pay)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={applyForm.startDate}
                    onChange={(e) => setApplyForm({ ...applyForm, startDate: e.target.value })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    value={applyForm.endDate}
                    onChange={(e) => setApplyForm({ ...applyForm, endDate: e.target.value })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyForm.isHalfDay}
                    onChange={(e) => setApplyForm({ ...applyForm, isHalfDay: e.target.checked })}
                    className="rounded text-slate-900 focus:ring-slate-900"
                  />
                  <span>Half Day Session</span>
                </label>
                {applyForm.isHalfDay && (
                  <select
                    value={applyForm.halfDaySession}
                    onChange={(e) => setApplyForm({ ...applyForm, halfDaySession: e.target.value as any })}
                    className="text-xs p-1.5 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="MORNING">Morning Session</option>
                    <option value="AFTERNOON">Afternoon Session</option>
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Leave</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Provide brief context for the requested leave duration..."
                  value={applyForm.reason}
                  onChange={(e) => setApplyForm({ ...applyForm, reason: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsApplyOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Remarks Modal */}
      {reviewItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Reject Leave Request</h3>
            <p className="text-xs text-slate-500">
              Provide a clear reason for rejecting {reviewItem.employeeName}'s {reviewItem.leaveType} leave request.
            </p>
            <textarea
              rows={3}
              placeholder="e.g. Critical project sprint milestone overlap, please reschedule..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setReviewItem(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUpdateStatus(reviewItem._id, 'REJECTED')}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
