import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { employeeService } from '../services/employeeService';
import { Employee } from '../types/employee';
import { ExpenseClaim, ExpenseCategory } from '../types/modules';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { ExportButtons } from '../components/common/ExportButtons';
import {
  Receipt,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  DollarSign,
  Briefcase,
  FileText,
  CreditCard,
  X,
  ExternalLink,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

export const ExpensesPage: React.FC = () => {
  const { user } = useAuth();
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [employeesList, setEmployeesList] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  // Submit modal
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [formData, setFormData] = useState({
    targetEmployeeId: '',
    title: '',
    category: 'MEALS' as ExpenseCategory,
    amount: '',
    currency: 'INR',
    expenseDate: new Date().toISOString().split('T')[0],
    description: '',
    receiptName: 'uploaded_invoice.pdf',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Review modal
  const [reviewClaim, setReviewClaim] = useState<ExpenseClaim | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const res = await modulesService.getExpenses({
        status: statusFilter,
        category: categoryFilter,
      });
      setClaims(res.claims);
    } catch (err) {
      console.error('Failed to load expenses', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
    if (user?.role === 'ADMIN' || (user?.role as string) === 'HR') {
      employeeService.getEmployees({}).then((res) => {
        setEmployeesList(res.employees || []);
      }).catch(() => {});
    }
  }, [statusFilter, categoryFilter, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.amount || !formData.expenseDate || !formData.description) return;
    setIsSubmitting(true);
    try {
      const res = await modulesService.submitExpense({
        ...formData,
        targetEmployeeId: formData.targetEmployeeId || undefined,
        amount: Number(formData.amount),
      });
      if (res.success) {
        const targetEmp = employeesList.find((e) => e._id === formData.targetEmployeeId);
        if (targetEmp) {
          setFeedback(`Expense claim submitted on behalf of ${targetEmp.firstName} ${targetEmp.lastName}.`);
        } else {
          setFeedback('Expense claim submitted successfully for manager and HR audit.');
        }
        setIsSubmitOpen(false);
        setFormData({
          targetEmployeeId: '',
          title: '',
          category: 'MEALS',
          amount: '',
          currency: 'INR',
          expenseDate: new Date().toISOString().split('T')[0],
          description: '',
          receiptName: 'uploaded_invoice.pdf',
        });
        fetchExpenses();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error submitting expense'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (
    id: string,
    status: 'MANAGER_APPROVED' | 'HR_APPROVED' | 'REJECTED' | 'REIMBURSED'
  ) => {
    try {
      const res = await modulesService.updateExpenseStatus(id, status, {
        rejectionReason: status === 'REJECTED' ? rejectionReason : undefined,
      });
      if (res.success) {
        setFeedback(`Expense claim updated to ${status}.`);
        setReviewClaim(null);
        setRejectionReason('');
        fetchExpenses();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error updating expense'}`);
    }
  };

  const totalAmount = claims.reduce((acc, c) => acc + c.amount, 0);
  const reimbursedAmount = claims.filter((c) => c.status === 'REIMBURSED').reduce((acc, c) => acc + c.amount, 0);
  const pendingAmount = claims.filter((c) => c.status !== 'REIMBURSED' && c.status !== 'REJECTED').reduce((acc, c) => acc + c.amount, 0);

  const filteredClaims = claims.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.employeeName.toLowerCase().includes(q) ||
      c.employeeCode.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    );
  });

  const handleExportExcel = () => {
    exportToExcel(
      filteredClaims,
      'Expense_Claims_Report',
      'ExpenseClaims',
      [
        { header: 'Claim Title', key: 'title' },
        { header: 'Employee Name', key: 'employeeName' },
        { header: 'Category', key: 'category' },
        { header: 'Expense Date', key: 'expenseDate' },
        { header: 'Currency', key: 'currency' },
        { header: 'Amount', key: 'amount' },
        { header: 'Status', key: 'status' },
        { header: 'Description', key: 'description' },
        { header: 'Receipt File', key: (c) => c.receiptName || 'N/A' },
      ]
    );
  };

  const handleExportPdf = () => {
    const headers = ['Title', 'Employee', 'Category', 'Date', 'Amount', 'Status'];
    const rows = filteredClaims.map((c) => [
      c.title,
      c.employeeName,
      c.category,
      c.expenseDate,
      `${c.currency} ${c.amount.toLocaleString()}`,
      c.status,
    ]);
    exportToPdf(
      'Expense Claims & Reimbursement Audit Report',
      headers,
      rows,
      'Expense_Claims_Report',
      `Exported ${filteredClaims.length} expense reimbursement records`
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Expense Claims & Reimbursement
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <ExportButtons
            onExportExcel={handleExportExcel}
            onExportPdf={handleExportPdf}
          />
          <button
            onClick={() => setIsSubmitOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm transition-all border border-[#039583] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Submit Expense Claim
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

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center shrink-0">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Claims Value</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-bold text-slate-900">₹{totalAmount.toLocaleString()}</span>
              <span className="text-xs text-slate-400 font-medium">({claims.length} claims)</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">In Approval Pipeline</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-bold text-slate-900">₹{pendingAmount.toLocaleString()}</span>
              <span className="text-xs text-amber-600 font-medium">Pending Payout</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Settled & Reimbursed</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-bold text-slate-900">₹{reimbursedAmount.toLocaleString()}</span>
              <span className="text-xs text-emerald-600 font-medium">Disbursed</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 overflow-x-auto">
          {['ALL', 'SUBMITTED', 'MANAGER_APPROVED', 'HR_APPROVED', 'REIMBURSED', 'REJECTED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search claims, payee, purpose..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
          />
        </div>
      </div>

      {/* Claims Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-400 border-b border-slate-100">
              <tr>
                <th className="py-3 px-4">Claimant</th>
                <th className="py-3 px-4">Expense Title & Category</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Receipt</th>
                <th className="py-3 px-4">Status</th>
                {(user?.role === 'ADMIN') && (
                  <th className="py-3 px-4 text-right">Approval Action</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Loading expense claims...
                  </td>
                </tr>
              ) : filteredClaims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No expense claims found matching filters.
                  </td>
                </tr>
              ) : (
                filteredClaims.map((claim) => (
                  <tr key={claim._id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      <div>{claim.employeeName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{claim.employeeCode} • {claim.department}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-800">{claim.title}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700">
                          {claim.category.replace('_', ' ')}
                        </span>
                        <span className="text-[11px] text-slate-400 truncate max-w-xs">{claim.description}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600">
                      {claim.expenseDate}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900 font-mono text-sm">
                      ₹{claim.amount.toLocaleString()} {claim.currency === 'USD' ? 'INR' : claim.currency}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-600 font-mono text-[10px]">
                        <FileText className="w-3 h-3 text-slate-400" />
                        <span className="max-w-[120px] truncate">{claim.receiptName || 'receipt.pdf'}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        claim.status === 'REIMBURSED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : claim.status === 'HR_APPROVED'
                          ? 'bg-blue-100 text-blue-800'
                          : claim.status === 'MANAGER_APPROVED'
                          ? 'bg-indigo-100 text-indigo-800'
                          : claim.status === 'REJECTED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {claim.status === 'REIMBURSED' && <CheckCircle2 className="w-3 h-3" />}
                        {claim.status === 'REJECTED' && <XCircle className="w-3 h-3" />}
                        {claim.status === 'SUBMITTED' && <Clock className="w-3 h-3" />}
                        {claim.status.replace('_', ' ')}
                      </span>
                      {claim.paymentReference && (
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">{claim.paymentReference}</div>
                      )}
                    </td>
                    {(user?.role === 'ADMIN') && (
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {claim.status === 'SUBMITTED' && (
                            <button
                              onClick={() => handleUpdateStatus(claim._id, 'MANAGER_APPROVED')}
                              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-[11px] shadow-xs"
                            >
                              Manager Approve
                            </button>
                          )}
                          {(claim.status === 'MANAGER_APPROVED' || (claim.status === 'SUBMITTED' && user?.role === 'ADMIN')) && (
                            <button
                              onClick={() => handleUpdateStatus(claim._id, 'HR_APPROVED')}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-[11px] shadow-xs"
                            >
                              HR Verify
                            </button>
                          )}
                          {claim.status === 'HR_APPROVED' && (user?.role === 'ADMIN') && (
                            <button
                              onClick={() => handleUpdateStatus(claim._id, 'REIMBURSED')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-[11px] shadow-xs"
                            >
                              Disburse Payout
                            </button>
                          )}
                          {claim.status !== 'REIMBURSED' && claim.status !== 'REJECTED' && (
                            <button
                              onClick={() => setReviewClaim(claim)}
                              className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium text-[11px]"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Submit Claim Modal */}
      {isSubmitOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Submit Corporate Expense Claim</h2>
              <button onClick={() => setIsSubmitOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {(user?.role === 'ADMIN' || (user?.role as string) === 'HR') && (
                <div className="bg-amber-50/70 border border-amber-200/80 p-3 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                    <UserCheck className="w-4 h-4 text-amber-600" />
                    <span>Submit Claim On Behalf of Employee</span>
                  </div>
                  <select
                    value={formData.targetEmployeeId}
                    onChange={(e) => setFormData({ ...formData, targetEmployeeId: e.target.value })}
                    className="w-full text-xs bg-white border border-slate-200 rounded-lg p-2 font-medium focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
                  >
                    <option value="">-- Myself ({user?.firstName || 'User'} {user?.lastName || ''}) --</option>
                    {employeesList.map((emp) => (
                      <option key={emp._id} value={emp._id}>
                        {emp.firstName} {emp.lastName} ({emp.employeeCode} - {emp.department})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-amber-700">
                    Selecting an employee will file this expense claim under their employee profile.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Expense Title / Item</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q3 AWS Cloud Practitioner Certification Exam"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="TRAVEL">Travel & Transport</option>
                    <option value="MEALS">Meals & Client Dining</option>
                    <option value="INTERNET">Internet & Telephony</option>
                    <option value="OFFICE_SUPPLIES">Office Supplies / Hardware</option>
                    <option value="LEARNING">Learning & Certification</option>
                    <option value="CLIENT_ENTERTAINMENT">Client Entertainment</option>
                    <option value="OTHER">Other Expenses</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Amount (₹ INR)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Date Incurred</label>
                <input
                  type="date"
                  required
                  value={formData.expenseDate}
                  onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })}
                  className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Business Purpose & Details</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Detail the business context, project code, or client event justification..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Receipt Attachment</label>
                <div className="border border-dashed border-slate-300 rounded-xl p-3 text-center bg-slate-50">
                  <FileText className="w-5 h-5 mx-auto text-slate-400 mb-1" />
                  <p className="text-xs text-slate-600 font-medium">{formData.receiptName}</p>
                  <p className="text-[10px] text-slate-400">PDF, PNG, or JPG receipt up to 10MB</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsSubmitOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Claim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Remarks Modal */}
      {reviewClaim && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Reject Expense Claim</h3>
            <p className="text-xs text-slate-500">
              Provide clarification to {reviewClaim.employeeName} regarding why the claim for "${reviewClaim.amount} ({reviewClaim.title})" is being rejected.
            </p>
            <textarea
              rows={3}
              placeholder="e.g. Missing valid GST/tax invoice receipt, or expense exceeds policy cap..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setReviewClaim(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUpdateStatus(reviewClaim._id, 'REJECTED')}
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
