import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { employeeService } from '../services/employeeService';
import { Payslip } from '../types/modules';
import { Employee } from '../types/employee';
import { VetanLogo } from '../components/common/anusyuti_logo';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { ExportButtons } from '../components/common/ExportButtons';
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
  TrendingUp,
  DollarSign,
  Filter,
  Check,
  Edit3,
} from 'lucide-react';

/** Indian-format rupee amount, always 2 decimals. */
const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const PayrollPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'FINANCE';

  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
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

  // Date Range Print State
  const [printFromDate, setPrintFromDate] = useState('2025-01');
  const [printToDate, setPrintToDate] = useState('2026-12');

  // Run Payroll Modal (Admin/HR)
  const [isRunOpen, setIsRunOpen] = useState(false);
  const [runMonth, setRunMonth] = useState('2026-04');
  const [runMonthName, setRunMonthName] = useState('April 2026');
  const [isRunning, setIsRunning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Bulk Salary Revision State
  const [isBulkRevisionOpen, setIsBulkRevisionOpen] = useState(false);
  const [revisionMode, setRevisionMode] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');
  const [revisionValue, setRevisionValue] = useState<number>(10);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [revisionReason, setRevisionReason] = useState('Annual Appraisal Increment FY 2026-27');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('ALL');
  const [selectedEmpIds, setSelectedEmpIds] = useState<string[]>([]);
  const [isExecutingRevision, setIsExecutingRevision] = useState(false);

  const fetchPayrollAndEmployees = async () => {
    setLoading(true);
    try {
      const [payrollRes, empRes] = await Promise.all([
        modulesService.getPayslips({
          month: selectedMonth || undefined,
        }),
        employeeService.getEmployees().catch(() => ({ employees: [] })),
      ]);

      setPayslips(payrollRes.payslips);
      setSummary(payrollRes.summary);
      setEmployees(empRes.employees || []);

      if (payrollRes.payslips.length > 0 && !selectedSlip) {
        setSelectedSlip(payrollRes.payslips[0]);
      }

      // Initialize selected employees for bulk revision
      if (empRes.employees && empRes.employees.length > 0 && selectedEmpIds.length === 0) {
        setSelectedEmpIds(empRes.employees.map((e) => e._id));
      }
    } catch (err) {
      console.error('Failed to load payslips', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayrollAndEmployees();
  }, [selectedMonth]);

  const filteredPayslips = payslips.filter((p) => {
    const q = search.toLowerCase();
    return (
      p.employeeName.toLowerCase().includes(q) ||
      p.employeeCode.toLowerCase().includes(q) ||
      p.department.toLowerCase().includes(q) ||
      p.monthName.toLowerCase().includes(q)
    );
  });

  const handleRunPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRunning(true);
    try {
      const res = await modulesService.runPayroll(runMonth, runMonthName);
      if (res.success) {
        setFeedback(res.message);
        setIsRunOpen(false);
        fetchPayrollAndEmployees();
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error executing payroll run'}`);
    } finally {
      setIsRunning(false);
    }
  };

  /**
   * Bulk Print Payslips across date range
   */
  const handlePrintDateRange = () => {
    const rangeSlips = payslips.filter((p) => {
      const pMonth = p.month || p.monthName;
      return pMonth >= printFromDate && pMonth <= printToDate;
    });

    const slipsToPrint = rangeSlips.length > 0 ? rangeSlips : filteredPayslips;

    if (slipsToPrint.length === 0) {
      alert('No payslips found in the selected date range.');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=1000,height=1200');
    if (!printWindow) {
      alert('Please allow popups to enable salary statement print.');
      return;
    }

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((node) => (node instanceof HTMLLinkElement ? `<link rel="stylesheet" href="${node.href}">` : node.outerHTML))
      .join('\n');

    const payslipsHtml = slipsToPrint
      .map(
        (slip) => `
      <div style="page-break-after: always; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; margin-bottom: 32px; background: #fff;">
        <div style="display:flex; justify-between; align-items:center; border-bottom:2px solid #0f172a; padding-bottom:12px; margin-bottom:16px;">
          <div>
            <h2 style="font-size:18px; font-weight:bold; margin:0; color:#0f172a;">GREENTICKER FINANCIAL SERVICES LLP</h2>
            <p style="font-size:11px; color:#64748b; margin:2px 0 0 0;">vetan.ai Enterprise Payroll & Tax Statement</p>
          </div>
          <div style="text-align:right;">
            <span style="font-size:12px; font-weight:bold; background:#f1f5f9; padding:4px 8px; border-radius:6px;">${slip.monthName}</span>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:12px; margin-bottom:16px; background:#f8fafc; padding:12px; border-radius:8px;">
          <div><strong>Employee:</strong> ${slip.employeeName} (${slip.employeeCode})</div>
          <div><strong>Department:</strong> ${slip.department}</div>
          <div><strong>Designation:</strong> ${slip.designation}</div>
          <div><strong>Bank Account:</strong> ${slip.bankAccountNumber || 'Provided'}</div>
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
          <thead>
            <tr style="background:#039583; color:#fff;">
              <th style="padding:6px; text-align:left;">Earnings Component</th>
              <th style="padding:6px; text-align:right;">Amount (₹)</th>
              <th style="padding:6px; text-align:left;">Deduction Component</th>
              <th style="padding:6px; text-align:right;">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0;">Basic Salary</td>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0; text-align:right;">₹${fmt(slip.basicSalary)}</td>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0;">Provident Fund (EPF)</td>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0; text-align:right;">₹${fmt(slip.providentFund)}</td>
            </tr>
            <tr>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0;">House Rent Allowance (HRA)</td>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0; text-align:right;">₹${fmt(slip.hra)}</td>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0;">Professional Tax (PT)</td>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0; text-align:right;">₹${fmt(slip.professionalTax)}</td>
            </tr>
            <tr>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0;">Special Allowance</td>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0; text-align:right;">₹${fmt(slip.specialAllowance || 0)}</td>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0;">Income Tax (TDS)</td>
              <td style="padding:6px; border-bottom:1px solid #e2e8f0; text-align:right;">₹${fmt(slip.tds || 0)}</td>
            </tr>
            <tr style="font-weight:bold; background:#f1f5f9;">
              <td style="padding:8px; border-top:1px solid #0f172a;">Gross Earnings</td>
              <td style="padding:8px; border-top:1px solid #0f172a; text-align:right;">₹${fmt(slip.grossSalary)}</td>
              <td style="padding:8px; border-top:1px solid #0f172a;">Total Deductions</td>
              <td style="padding:8px; border-top:1px solid #0f172a; text-align:right; color:#e11d48;">₹${fmt(slip.totalDeductions)}</td>
            </tr>
          </tbody>
        </table>

        <div style="display:flex; justify-between; align-items:center; background:#ecfdf5; border:1px solid #a7f3d0; padding:12px; border-radius:8px; font-weight:bold; font-size:13px; color:#065f46;">
          <span>NET PAYOUT DISBURSED:</span>
          <span>₹${fmt(slip.netSalary)}</span>
        </div>
      </div>
    `
      )
      .join('');

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Bulk Salary Statements (${printFromDate} to ${printToDate})</title>
    ${styles}
    <style>
      body { background: #fff; padding: 24px; font-family: system-ui, sans-serif; }
      @page { margin: 10mm; }
    </style>
  </head>
  <body>
    <div style="margin-bottom: 20px; font-size:12px; color:#64748b;">
      Showing salary statement print range: <strong>${printFromDate}</strong> to <strong>${printToDate}</strong> (${slipsToPrint.length} Statement Slips)
    </div>
    ${payslipsHtml}
  </body>
</html>`);
    printWindow.document.close();
    printWindow.onload = () => setTimeout(() => { printWindow.focus(); printWindow.print(); }, 500);
  };

  /**
   * Calculate revised salary per employee for preview
   */
  const calculatedRevisions = useMemo(() => {
    return employees
      .filter((emp) => {
        if (selectedDeptFilter !== 'ALL' && emp.department !== selectedDeptFilter) return false;
        return selectedEmpIds.includes(emp._id);
      })
      .map((emp) => {
        const current = emp.annualSalary || 1200000;
        let revised = current;
        if (revisionMode === 'PERCENTAGE') {
          revised = Math.round(current * (1 + revisionValue / 100));
        } else {
          revised = Math.round(current + Number(revisionValue));
        }
        const diff = revised - current;
        return {
          employeeId: emp._id,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          employeeCode: emp.employeeCode,
          department: emp.department,
          currentSalary: current,
          newAnnualSalary: revised,
          diff,
        };
      });
  }, [employees, selectedDeptFilter, selectedEmpIds, revisionMode, revisionValue]);

  const handleExecuteBulkRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (calculatedRevisions.length === 0) return;

    setIsExecutingRevision(true);
    try {
      const payload = {
        revisions: calculatedRevisions.map((r) => ({
          employeeId: r.employeeId,
          newAnnualSalary: r.newAnnualSalary,
        })),
        effectiveDate,
        reason: revisionReason,
      };

      const res = await modulesService.executeBulkSalaryRevision(payload);
      if (res.success) {
        setFeedback(`Bulk salary revision applied for ${res.updatedEmployees.length} employees!`);
        setIsBulkRevisionOpen(false);
        await fetchPayrollAndEmployees();
      }
    } catch (err: any) {
      setFeedback(`Revision failed: ${err.message || 'Error executing revision'}`);
    } finally {
      setIsExecutingRevision(false);
    }
  };

  const toggleEmpForRevision = (empId: string) => {
    setSelectedEmpIds((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const handleExportExcel = () => {
    exportToExcel(
      filteredPayslips,
      'Payroll_Payslips_Report',
      'Payslips',
      [
        { header: 'Employee Code', key: 'employeeCode' },
        { header: 'Employee Name', key: 'employeeName' },
        { header: 'Department', key: 'department' },
        { header: 'Designation', key: 'designation' },
        { header: 'Month', key: 'monthName' },
        { header: 'Basic Salary (₹)', key: 'basicSalary' },
        { header: 'HRA (₹)', key: 'hra' },
        { header: 'Special Allowance (₹)', key: (p) => p.specialAllowance || 0 },
        { header: 'Gross Salary (₹)', key: 'grossSalary' },
        { header: 'PF Deduction (₹)', key: 'providentFund' },
        { header: 'PT Deduction (₹)', key: 'professionalTax' },
        { header: 'TDS Deduction (₹)', key: (p) => p.tds || 0 },
        { header: 'Total Deductions (₹)', key: 'totalDeductions' },
        { header: 'Net Salary (₹)', key: 'netSalary' },
      ]
    );
  };

  const handleExportPdf = () => {
    const headers = ['Code', 'Name', 'Department', 'Month', 'Gross (₹)', 'Deductions (₹)', 'Net Pay (₹)'];
    const rows = filteredPayslips.map((p) => [
      p.employeeCode,
      p.employeeName,
      p.department,
      p.monthName,
      `₹${fmt(p.grossSalary)}`,
      `₹${fmt(p.totalDeductions)}`,
      `₹${fmt(p.netSalary)}`,
    ]);
    exportToPdf(
      'Enterprise Payroll Statements Summary Report',
      headers,
      rows,
      'Payroll_Payslips_Report',
      `Exported ${filteredPayslips.length} monthly salary payslip records`
    );
  };

  const handleSinglePrint = () => {
    const el = document.getElementById('payslip-print');
    if (!el) return;

    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
      window.print();
      return;
    }

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((node) => (node instanceof HTMLLinkElement ? `<link rel="stylesheet" href="${node.href}">` : node.outerHTML))
      .join('\n');

    w.document.open();
    w.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Payslip - ${selectedSlip?.employeeName ?? ''} - ${selectedSlip?.monthName ?? ''}</title>
    ${styles}
    <style>
      body { background: #fff; padding: 24px; font-family: system-ui, sans-serif; }
      @page { margin: 12mm; }
    </style>
  </head>
  <body>
    ${el.outerHTML}
  </body>
</html>`);
    w.document.close();
    w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 500);
  };

  const departmentsList = useMemo(() => {
    const depts = new Set(employees.map((e) => e.department).filter(Boolean));
    return Array.from(depts);
  }, [employees]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Banknote className="w-6 h-6 text-[#039583]" />
            {user?.role === 'EMPLOYEE' ? 'My Salary Slips & Compensation' : 'Enterprise Payroll Management'}
          </h1>
          <p className="text-xs text-blue-100/80 mt-1">
            Execute monthly payroll runs, issue salary statements, manage date-range printing, & execute bulk revisions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons
            onExportExcel={handleExportExcel}
            onExportPdf={handleExportPdf}
          />

          {isAdmin && (
            <>
              <button
                onClick={() => setIsBulkRevisionOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs cursor-pointer border border-indigo-500"
              >
                <TrendingUp className="w-4 h-4" />
                Bulk Salary Revision
              </button>

              <button
                onClick={() => setIsRunOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm transition-all border border-[#039583] cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                Run Monthly Payroll
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>{feedback}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Salary Print Date Range Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <Printer className="w-4 h-4 text-[#039583]" />
          <span>Salary Statements Print Filter (From / To Date):</span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <label className="text-slate-500 font-semibold">From Month:</label>
            <input
              type="month"
              value={printFromDate}
              onChange={(e) => setPrintFromDate(e.target.value)}
              className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-slate-800"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-slate-500 font-semibold">To Month:</label>
            <input
              type="month"
              value={printToDate}
              onChange={(e) => setPrintToDate(e.target.value)}
              className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-slate-800"
            />
          </div>

          <button
            onClick={handlePrintDateRange}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Statements (Date Range)
          </button>
        </div>
      </div>

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
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Payslips Issued</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">{summary.totalSlips}</span>
            <span className="text-xs text-slate-400">statements</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Verified for compliance</p>
        </div>
      </div>

      {/* Main Grid: Left Payslip List, Right Active Payslip Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Payslips Table */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Salary Statements</h3>
            <div className="relative w-40">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search slip..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading salary statements...</div>
          ) : filteredPayslips.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No payslip records found.</div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredPayslips.map((p) => {
                const isSelected = selectedSlip?._id === p._id;
                return (
                  <div
                    key={p._id}
                    onClick={() => setSelectedSlip(p)}
                    className={`p-3.5 rounded-xl border text-xs cursor-pointer transition ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                        : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>{p.employeeName}</span>
                      <span className={isSelected ? 'text-emerald-400' : 'text-slate-900'}>
                        ₹{fmt(p.netSalary)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px] opacity-80">
                      <span>
                        {p.employeeCode} · {p.department}
                      </span>
                      <span>{p.monthName}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Selected Payslip Document View */}
        <div className="lg:col-span-7">
          {selectedSlip ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Official Payslip Statement</h3>
                  <p className="text-xs text-slate-500">
                    {selectedSlip.employeeName} ({selectedSlip.employeeCode}) — {selectedSlip.monthName}
                  </p>
                </div>
                <button
                  onClick={handleSinglePrint}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Statement
                </button>
              </div>

              {/* Printable Payslip Card */}
              <div id="payslip-print" className="p-6 bg-slate-50/50 border border-slate-200 rounded-2xl space-y-6">
                <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4">
                  <div className="flex items-center gap-3">
                    <VetanLogo className="w-10 h-10" />
                    <div>
                      <h2 className="text-base font-bold text-slate-900">GREENTICKER FINANCIAL SERVICES LLP</h2>
                      <p className="text-[11px] text-slate-500 font-mono">
                        vetan.ai HR Enterprise Operating Portal
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-mono font-bold px-2.5 py-1 bg-slate-900 text-white rounded-md">
                      {selectedSlip.monthName}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs bg-white p-4 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Employee Name</span>
                    <span className="font-bold text-slate-900">{selectedSlip.employeeName}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Employee ID</span>
                    <span className="font-mono font-bold text-slate-900">{selectedSlip.employeeCode}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Department</span>
                    <span className="font-semibold text-slate-800">{selectedSlip.department}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Designation</span>
                    <span className="font-semibold text-slate-800">{selectedSlip.designation}</span>
                  </div>
                </div>

                {/* Earnings & Deductions Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-[#039583] text-white font-bold text-[10px] uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Earnings Component</th>
                        <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                        <th className="py-2.5 px-3">Deduction Component</th>
                        <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800 font-mono">
                      <tr>
                        <td className="py-2 px-3 font-sans">Basic Salary</td>
                        <td className="py-2 px-3 text-right">₹{fmt(selectedSlip.basicSalary)}</td>
                        <td className="py-2 px-3 font-sans">Provident Fund (EPF)</td>
                        <td className="py-2 px-3 text-right">₹{fmt(selectedSlip.providentFund)}</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-sans">House Rent Allowance (HRA)</td>
                        <td className="py-2 px-3 text-right">₹{fmt(selectedSlip.hra)}</td>
                        <td className="py-2 px-3 font-sans">Professional Tax (PT)</td>
                        <td className="py-2 px-3 text-right">₹{fmt(selectedSlip.professionalTax)}</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-sans">Special Allowance</td>
                        <td className="py-2 px-3 text-right">₹{fmt(selectedSlip.specialAllowance || 0)}</td>
                        <td className="py-2 px-3 font-sans">Income Tax (TDS)</td>
                        <td className="py-2 px-3 text-right">₹{fmt(selectedSlip.tds || 0)}</td>
                      </tr>
                      <tr className="bg-slate-50 font-bold font-sans">
                        <td className="py-2.5 px-3 border-t border-slate-900">Gross Earnings</td>
                        <td className="py-2.5 px-3 text-right border-t border-slate-900 font-mono">
                          ₹{fmt(selectedSlip.grossSalary)}
                        </td>
                        <td className="py-2.5 px-3 border-t border-slate-900">Total Deductions</td>
                        <td className="py-2.5 px-3 text-right border-t border-slate-900 font-mono text-rose-600">
                          ₹{fmt(selectedSlip.totalDeductions)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center justify-between text-emerald-950 font-bold text-sm">
                  <span>NET SALARY DISBURSED:</span>
                  <span className="font-mono text-lg text-emerald-700">₹{fmt(selectedSlip.netSalary)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-400">
              Select a salary slip statement from the list to preview details.
            </div>
          )}
        </div>
      </div>

      {/* Execute Payroll Run Modal */}
      {isRunOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Execute Monthly Payroll Run</h3>
              <button onClick={() => setIsRunOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRunPayroll} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payroll Month Code (YYYY-MM)</label>
                <input
                  type="month"
                  value={runMonth}
                  onChange={(e) => setRunMonth(e.target.value)}
                  required
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Month Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. April 2026"
                  value={runMonthName}
                  onChange={(e) => setRunMonthName(e.target.value)}
                  required
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-[11px] text-emerald-800">
                <strong>System Notice:</strong> Generating payroll calculates basic salary, HRA, statutory EPF/PT deductions, and TDS for all active employees based on current CTC structures.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRunOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRunning}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  {isRunning ? 'Processing...' : 'Run Payroll Now'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Salary Revision Modal */}
      {isBulkRevisionOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-indigo-600" />
                  Bulk Salary & CTC Revision
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Apply bulk salary increments across selected employee groups or departments.
                </p>
              </div>
              <button onClick={() => setIsBulkRevisionOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteBulkRevision} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Increment Strategy *</label>
                  <select
                    value={revisionMode}
                    onChange={(e) => setRevisionMode(e.target.value as any)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                  >
                    <option value="PERCENTAGE">Percentage (%) Salary Increase</option>
                    <option value="FIXED">Flat Fixed Amount (+₹) Increase</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {revisionMode === 'PERCENTAGE' ? 'Percentage Rate (%) *' : 'Flat Amount (+₹ CTC) *'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    step={revisionMode === 'PERCENTAGE' ? '0.5' : '1000'}
                    value={revisionValue}
                    onChange={(e) => setRevisionValue(Number(e.target.value))}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-indigo-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Effective Date *</label>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Filter Department</label>
                  <select
                    value={selectedDeptFilter}
                    onChange={(e) => setSelectedDeptFilter(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                  >
                    <option value="ALL">All Departments ({employees.length} employees)</option>
                    {departmentsList.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Revision Reason / Note *</label>
                <input
                  type="text"
                  value={revisionReason}
                  onChange={(e) => setRevisionReason(e.target.value)}
                  required
                  placeholder="e.g. FY 2026-27 Annual Performance Appraisal Increment"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              {/* Dynamic Live Revision Preview Table */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span>
                    Revision Live Preview ({calculatedRevisions.length} Employees Selected)
                  </span>
                  <span className="text-indigo-600 font-mono">
                    Total Additional Outlay: +₹
                    {calculatedRevisions
                      .reduce((acc, curr) => acc + curr.diff, 0)
                      .toLocaleString()}
                  </span>
                </div>

                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-100 text-slate-600 font-bold uppercase">
                      <tr>
                        <th className="py-2 px-3">Select</th>
                        <th className="py-2 px-3">Employee</th>
                        <th className="py-2 px-3">Current CTC</th>
                        <th className="py-2 px-3">Revised CTC</th>
                        <th className="py-2 px-3 text-right">Increment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {employees
                        .filter((emp) => selectedDeptFilter === 'ALL' || emp.department === selectedDeptFilter)
                        .map((emp) => {
                          const isSelected = selectedEmpIds.includes(emp._id);
                          const current = emp.annualSalary || 1200000;
                          let revised = current;
                          if (revisionMode === 'PERCENTAGE') {
                            revised = Math.round(current * (1 + revisionValue / 100));
                          } else {
                            revised = Math.round(current + Number(revisionValue));
                          }
                          const diff = revised - current;

                          return (
                            <tr key={emp._id} className={isSelected ? 'bg-indigo-50/40' : 'opacity-60'}>
                              <td className="py-2 px-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleEmpForRevision(emp._id)}
                                  className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                              </td>
                              <td className="py-2 px-3 font-sans font-semibold text-slate-900">
                                {emp.firstName} {emp.lastName}
                                <span className="text-[10px] text-slate-400 block font-mono">
                                  {emp.employeeCode} · {emp.department}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-600">₹{current.toLocaleString()}</td>
                              <td className="py-2 px-3 font-bold text-indigo-950">₹{revised.toLocaleString()}</td>
                              <td className="py-2 px-3 text-right font-bold text-emerald-600">
                                +₹{diff.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsBulkRevisionOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isExecutingRevision || calculatedRevisions.length === 0}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isExecutingRevision ? 'Applying Revision...' : `Apply Revision to ${calculatedRevisions.length} Employees`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};