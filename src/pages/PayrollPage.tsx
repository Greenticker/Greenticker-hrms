import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { Payslip } from '../types/modules';
import { AnusyutiLogo } from '../components/common/anusyuti_logo';
import {
  Banknote,
  Calendar,
  Download,
  Printer,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  TrendingDown,
  Building,
  CreditCard,
  User,
  Shield,
  FileCheck,
  Search,
  Play,
  X,
} from 'lucide-react';


/** Indian-format rupee amount, always 2 decimals (payslip amounts are no longer whole rupees). */
const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const PayrollPage: React.FC = () => {
  const { user } = useAuth();
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [summary, setSummary] = useState({
    totalSlips: 0,
    totalDisbursed: 0,
    totalDeductions: 0,
    netPayout: 0,
  });
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSlip, setSelectedSlip] = useState<Payslip | null>(null);

  // Run Payroll Modal (Admin/HR)
  const [isRunOpen, setIsRunOpen] = useState(false);
  const [runMonth, setRunMonth] = useState('2025-03');
  const [runMonthName, setRunMonthName] = useState('March 2025');
  const [isRunning, setIsRunning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchPayroll = async () => {
    setLoading(true);
    try {
      const res = await modulesService.getPayslips({
        month: selectedMonth || undefined,
      });
      setPayslips(res.payslips);
      setSummary(res.summary);
      if (res.payslips.length > 0 && !selectedSlip) {
        setSelectedSlip(res.payslips[0]);
      }
    } catch (err) {
      console.error('Failed to load payslips', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayroll();
  }, [selectedMonth]);

  const handleRunPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRunning(true);
    try {
      const res = await modulesService.runPayroll(runMonth, runMonthName);
      if (res.success) {
        setFeedback(res.message);
        setIsRunOpen(false);
        fetchPayroll();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error executing payroll run'}`);
    } finally {
      setIsRunning(false);
    }
  };

  /**
   * Prints only the payslip card.
   * Opens a popup containing the payslip + the app's own styles, so it works
   * even where window.print() is blocked (e.g. sandboxed iframe previews).
   * Falls back to window.print() (with the @media print rules below) if the
   * popup is blocked.
   */
  const handlePrint = () => {
    const el = document.getElementById('payslip-print');
    if (!el) return;

    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
      window.print();
      return;
    }

    const styles = Array.from(
      document.querySelectorAll('link[rel="stylesheet"], style')
    )
      .map((node) => {
        // Make stylesheet links absolute so they resolve inside the popup
        if (node instanceof HTMLLinkElement) {
          return `<link rel="stylesheet" href="${node.href}">`;
        }
        return node.outerHTML;
      })
      .join('\n');

    w.document.open();
    w.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Payslip - ${selectedSlip?.employeeName ?? ''} - ${selectedSlip?.monthName ?? ''}</title>
    ${styles}
    <style>
      body { background: #fff; padding: 24px; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
      @page { margin: 12mm; }
    </style>
  </head>
  <body>
    ${el.outerHTML}
  </body>
</html>`);
    w.document.close();

    // Give styles/fonts a moment to apply before opening the print dialog
    const doPrint = () => {
      w.focus();
      w.print();
    };
    w.onload = () => setTimeout(doPrint, 500);
    // Safety net in case onload already fired
    setTimeout(() => {
      if (!w.closed && w.document.readyState === 'complete') {
        // onload handler will normally have run; this avoids a silent no-op
      }
    }, 1500);
  };

  const filteredSlips = payslips.filter((p) => {
    const s = search.toLowerCase();
    return (
      p.employeeName.toLowerCase().includes(s) ||
      p.employeeCode.toLowerCase().includes(s) ||
      p.department.toLowerCase().includes(s) ||
      p.monthName.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6">
      {/* Fallback print rules: used only if the popup is blocked and window.print() runs */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #payslip-print, #payslip-print * { visibility: visible !important; }
          #payslip-print {
            position: absolute !important;
            left: 0;
            top: 0;
            width: 100%;
            box-shadow: none !important;
            border: none !important;
          }
          html, body {
            height: auto !important;
            overflow: visible !important;
          }
        }
      `}</style>

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {user?.role === 'EMPLOYEE' ? 'My Salary Slips & Compensation' : 'Enterprise Payroll Management'}
          </h1>
        </div>

        {(user?.role === 'ADMIN') && (
          <button
            onClick={() => setIsRunOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm transition-all shrink-0 border border-[#039583]"
          >
            <Play className="w-4 h-4 fill-white" />
            Execute Monthly Payroll Run
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

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Gross Payroll</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">
              ₹{fmt(summary.totalDisbursed)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Total across active statements</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Statutory Deductions</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">
              ₹{fmt(summary.totalDeductions)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">EPF, Professional Tax & TDS</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Net Disbursed Payout</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-emerald-600 font-mono">
              ₹{fmt(summary.netPayout)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Direct ACH bank deposit</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Generated Payslips</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">
              {summary.totalSlips}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">100% statutory compliant</p>
        </div>
      </div>

      {/* Main Content Layout: Statements List + Interactive Payslip Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Statement Archive (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Payslip Archive</h2>
              <span className="text-xs text-slate-400 font-mono">{filteredSlips.length} Statements</span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search statements..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
            {loading ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
                Loading payroll data...
              </div>
            ) : filteredSlips.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
                No payslips found for selected filters.
              </div>
            ) : (
              filteredSlips.map((slip) => {
                const isSelected = selectedSlip?._id === slip._id;
                return (
                  <div
                    key={slip._id}
                    onClick={() => setSelectedSlip(slip)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold uppercase tracking-wider font-mono ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                        {slip.monthName}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        isSelected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        {slip.status}
                      </span>
                    </div>

                    <div className="mt-2 flex items-baseline justify-between">
                      <div>
                        <p className={`font-semibold text-sm ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                          {slip.employeeName}
                        </p>
                        <p className={`text-xs ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                          {slip.designation}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`text-base font-bold font-mono ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                          ₹{fmt(slip.netSalary)}
                        </span>
                        <div className={`text-[10px] font-mono ${isSelected ? 'text-slate-400' : 'text-slate-400'}`}>
                          Net Pay
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Detailed Payslip Statement Preview (8 cols) */}
        <div className="lg:col-span-8">
          {selectedSlip ? (
            <div
              id="payslip-print"
              className="bg-white rounded-2xl border border-slate-200 shadow-xs p-8 space-y-6 print:p-0 print:border-none"
            >
              {/* Slip Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-6 gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <AnusyutiLogo size="sm" variant="icon" />
                    <div>
                      <h2 className="text-base font-black text-slate-900 tracking-tight">Anusyuti</h2>
                      <p className="text-[11px] text-slate-500">Corporate HQ & Technology Center</p>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest font-mono">
                    PAYSLIP STATEMENT
                  </span>
                  <p className="text-lg font-bold text-slate-900">{selectedSlip.monthName}</p>
                  <p className="text-[11px] text-slate-500 font-mono">Disbursed on {selectedSlip.payDate}</p>
                  {(selectedSlip.annualCtc ?? 0) > 0 && (
                    <p className="mt-1 text-[11px] font-semibold text-slate-700 font-mono">
                      Annual CTC: ₹{fmt(selectedSlip.annualCtc ?? 0)}
                    </p>
                  )}
                </div>
              </div>

              {/* Employee & Bank Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Employee Name</span>
                  <p className="font-semibold text-slate-900">{selectedSlip.employeeName}</p>
                  <p className="text-slate-500 text-[11px] font-mono">{selectedSlip.employeeCode}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Department & Title</span>
                  <p className="font-semibold text-slate-900">{selectedSlip.designation}</p>
                  <p className="text-slate-500 text-[11px]">{selectedSlip.department}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">PAN & PF UAN</span>
                  <p className="font-semibold text-slate-900 font-mono">{selectedSlip.panNumber}</p>
                  <p className="text-slate-500 text-[11px] font-mono">{selectedSlip.pfUan}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Bank & Account</span>
                  <p className="font-semibold text-slate-900">{selectedSlip.bankName}</p>
                  <p className="text-slate-500 text-[11px] font-mono">{selectedSlip.bankAccountNumber}</p>
                </div>
              </div>

              {/* Earnings vs Deductions Table */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Earnings */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex justify-between items-center">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Earnings Components</span>
                    <span className="text-xs font-bold text-slate-500 uppercase">Amount (₹)</span>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs p-1">
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">Basic Salary</span>
                      <span className="font-mono font-medium text-slate-900">₹{fmt(selectedSlip.basicSalary)}</span>
                    </div>
                    {(selectedSlip.educationAllowance ?? 0) > 0 && (
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">Education Allowance</span>
                      <span className="font-mono font-medium text-slate-900">₹{fmt(selectedSlip.educationAllowance ?? 0)}</span>
                    </div>
                    )}
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">House Rent Allowance (HRA)</span>
                      <span className="font-mono font-medium text-slate-900">₹{fmt(selectedSlip.hra)}</span>
                    </div>
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">Special Allowance</span>
                      <span className="font-mono font-medium text-slate-900">₹{fmt(selectedSlip.specialAllowance)}</span>
                    </div>
                    {(selectedSlip.lta ?? 0) > 0 && (
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">Leave Travel Allowance (LTA)</span>
                      <span className="font-mono font-medium text-slate-900">₹{fmt(selectedSlip.lta ?? 0)}</span>
                    </div>
                    )}
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">Conveyance Allowance</span>
                      <span className="font-mono font-medium text-slate-900">₹{fmt(selectedSlip.conveyanceAllowance)}</span>
                    </div>
                    {selectedSlip.medicalAllowance > 0 && (
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">Medical Allowance</span>
                      <span className="font-mono font-medium text-slate-900">₹{fmt(selectedSlip.medicalAllowance)}</span>
                    </div>
                    )}
                    {selectedSlip.performanceBonus > 0 && (
                      <div className="flex justify-between py-2 px-3 bg-emerald-50/50">
                        <span className="text-emerald-800 font-semibold">Performance Bonus</span>
                        <span className="font-mono font-semibold text-emerald-800">₹{fmt(selectedSlip.performanceBonus)}</span>
                      </div>
                    )}
                  </div>
                  <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-between items-center font-bold text-xs text-slate-900">
                    <span>Gross Earnings (A)</span>
                    <span className="font-mono text-sm">₹{fmt(selectedSlip.grossSalary)}</span>
                  </div>
                </div>

                {/* Deductions */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex justify-between items-center">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Statutory Deductions</span>
                    <span className="text-xs font-bold text-slate-500 uppercase">Amount (₹)</span>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs p-1">
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">Provident Fund (EPF Employee 12%)</span>
                      <span className="font-mono font-medium text-slate-900">-₹{fmt(selectedSlip.providentFund)}</span>
                    </div>
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">Professional Tax (PT)</span>
                      <span className="font-mono font-medium text-slate-900">-₹{fmt(selectedSlip.professionalTax)}</span>
                    </div>
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">TDS / Income Tax Withheld</span>
                      <span className="font-mono font-medium text-slate-900">-₹{fmt(selectedSlip.tds)}</span>
                    </div>
                    <div className="flex justify-between py-2 px-3">
                      <span className="text-slate-600">Other Deductions / Loss of Pay</span>
                      <span className="font-mono font-medium text-slate-400">₹0</span>
                    </div>
                  </div>
                  <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-between items-center font-bold text-xs text-slate-900">
                    <span>Total Deductions (B)</span>
                    <span className="font-mono text-sm text-slate-900">-₹{fmt(selectedSlip.totalDeductions)}</span>
                  </div>
                </div>
              </div>

              {/* Net Payable Banner */}
              <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                    Net Take-Home Salary (A - B)
                  </span>
                  <div className="text-3xl font-black text-emerald-950 font-mono mt-0.5">
                    ₹{fmt(selectedSlip.netSalary)} INR
                  </div>
                  <p className="text-xs text-emerald-700 mt-1">
                    Mode of Payment: {selectedSlip.paymentMode.replace('_', ' ')} • Transaction Ref:{' '}
                    <span className="font-mono font-bold">{selectedSlip.transactionId}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 print:hidden">
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-900 font-semibold text-xs shadow-xs hover:bg-emerald-100 transition-all"
                  >
                    <Printer className="w-4 h-4" />
                    Print Payslip
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 text-center border-t border-slate-100 pt-4 font-mono">
                This is a digitally generated document authenticated by Anusyuti HRMS Enterprise Engine. No signature required.
              </div>
            </div>
          ) : (
            <div className="h-full bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center text-center">
              <Banknote className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-sm font-semibold text-slate-600">Select a payslip from the left archive to preview details.</p>
            </div>
          )}
        </div>
      </div>

      {/* Execute Payroll Run Modal */}
      {isRunOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">Execute Monthly Payroll Run</h3>
              <button onClick={() => setIsRunOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              This will automatically compute statutory EPF, Professional Tax, TDS withholdings, and attendance LOP deductions for all active personnel across Anusyuti.
            </p>

            <form onSubmit={handleRunPayroll} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payroll Period Month (YYYY-MM)</label>
                <input
                  type="text"
                  required
                  placeholder="2025-03"
                  value={runMonth}
                  onChange={(e) => setRunMonth(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Display Label</label>
                <input
                  type="text"
                  required
                  placeholder="March 2025"
                  value={runMonthName}
                  onChange={(e) => setRunMonthName(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] space-y-1">
                <div className="font-bold">Automated Calculations:</div>
                <div>• Basic: 50% of monthly CTC</div>
                <div>• HRA: 20% of monthly CTC</div>
                <div>• EPF: 12% statutory employee contribution</div>
                <div>• Professional Tax: $200 standard tier</div>
                <div>• TDS: Computed based on chosen Tax Regime (Old vs New)</div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRunOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRunning}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs disabled:opacity-50"
                >
                  {isRunning ? 'Processing Payroll...' : 'Execute Payroll'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};