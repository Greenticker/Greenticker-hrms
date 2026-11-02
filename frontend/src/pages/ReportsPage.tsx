import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { employeeService } from '../services/employeeService';
import { Department, Location } from '../types/employee';
import {
  FileText,
  Play,
  Download,
  Share2,
  Calendar,
  Building2,
  MapPin,
  CheckSquare,
  Square,
  Clock,
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Mail,
  X,
  Search,
  SlidersHorizontal,
  Lock,
  Layers,
  Sparkles,
} from 'lucide-react';

interface ReportTemplateItem {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultFormat: string;
}

interface ScheduledReport {
  id: string;
  reportName: string;
  frequency: string;
  recipients: string;
  nextRunDate: string;
  status: 'ACTIVE' | 'PAUSED';
  format: string;
}

interface GeneratedFile {
  id: string;
  fileName: string;
  reportType: string;
  generatedAt: string;
  generatedBy: string;
  fileSize: string;
  format: string;
}

export const ReportsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  // Navigation Sub-tabs matching reference
  const [activeTab, setActiveTab] = useState<'run' | 'templates' | 'schedules' | 'generated'>('run');

  // Filter Bar state matching reference image
  const [reportType, setReportType] = useState<string>('headcount_summary');
  const [period, setPeriod] = useState<string>('Monthly');
  const [containingDate, setContainingDate] = useState<string>('2026-10-19');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [selectedLocation, setSelectedLocation] = useState<string>('ALL');

  // Download formats state matching reference checkboxes
  const [selectedFormat, setSelectedFormat] = useState<'PDF' | 'Excel' | 'CSV' | 'Word'>('PDF');

  // Dynamic Departments & Locations
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // Execution & Preview State
  const [isExecuting, setIsExecuting] = useState(false);
  const [hasRun, setHasRun] = useState(true); // Default to executed preview
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  // Share Modal State
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareSuccess, setShareSuccess] = useState(false);

  useEffect(() => {
    employeeService.getDepartments().then((res) => {
      if (res.departments) setDepartments(res.departments);
    }).catch(() => {});
    employeeService.getLocations().then((res) => {
      if (res.locations) setLocations(res.locations);
    }).catch(() => {});
  }, []);

  const handleRunReport = () => {
    setIsExecuting(true);
    setToastNotice(null);
    setTimeout(() => {
      setIsExecuting(false);
      setHasRun(true);
      setToastNotice(`Report generated successfully as of ${containingDate}!`);
      setTimeout(() => setToastNotice(null), 4000);
    }, 600);
  };

  const handleDownload = () => {
    const ext = selectedFormat.toLowerCase();
    setToastNotice(`Downloading report as ${selectedFormat} file (${reportType}_${containingDate}.${ext === 'excel' ? 'xlsx' : ext === 'word' ? 'docx' : ext})...`);
    setTimeout(() => {
      setToastNotice(`Downloaded ${selectedFormat} report to your device!`);
      setTimeout(() => setToastNotice(null), 4000);
    }, 1200);
  };

  const handleShareSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareEmail.trim()) return;
    setShareSuccess(true);
    setTimeout(() => {
      setShareSuccess(false);
      setIsShareOpen(false);
      setShareEmail('');
      setToastNotice(`Report link shared to ${shareEmail}!`);
      setTimeout(() => setToastNotice(null), 4000);
    }, 800);
  };

  // Mock Report Data for the active run preview
  const mockTableData = [
    { code: 'ZEN-101', name: 'Aarav Sharma', dept: 'Engineering & Technology', location: 'Bengaluru HQ', status: 'PERMANENT', jobType: 'Full time', ctc: '₹24,00,000', joining: '2022-04-15' },
    { code: 'ZEN-102', name: 'Diya Patel', dept: 'Engineering & Technology', location: 'Bengaluru HQ', status: 'PERMANENT', jobType: 'Full time', ctc: '₹18,50,000', joining: '2023-01-10' },
    { code: 'ZEN-103', name: 'Rohan Verma', dept: 'Product & Design', location: 'Mumbai Regional Office', status: 'PROBATION', jobType: 'Full time', ctc: '₹16,00,000', joining: '2026-06-01' },
    { code: 'ZEN-104', name: 'Ananya Iyer', dept: 'Sales & Customer Success', location: 'Delhi NCR Hub', status: 'PERMANENT', jobType: 'Full time', ctc: '₹14,50,000', joining: '2023-09-20' },
    { code: 'ZEN-105', name: 'Vikram Malhotra', dept: 'Finance & Compliance', location: 'Bengaluru HQ', status: 'PERMANENT', jobType: 'Full time', ctc: '₹22,00,000', joining: '2021-11-05' },
    { code: 'ZEN-106', name: 'Siddharth Rao', dept: 'Engineering & Technology', location: 'Bengaluru HQ', status: 'PROBATION', jobType: 'Internship', ctc: '₹4,80,000', joining: '2026-07-15' },
    { code: 'ZEN-107', name: 'Priya Sundaram', dept: 'People Operations & HR', location: 'Bengaluru HQ', status: 'PERMANENT', jobType: 'Full time', ctc: '₹15,00,000', joining: '2024-02-01' },
    { code: 'ZEN-108', name: 'Kavya Nair', dept: 'Product & Design', location: 'Remote / Hybrid', status: 'TEMPORARY', jobType: 'Contract', ctc: '₹12,00,000', joining: '2026-03-12' },
  ];

  const templatesList: ReportTemplateItem[] = [
    { id: 't1', name: 'Workforce Headcount & Demographics Master', category: 'People & HR', description: 'Complete employee roster including department, designation, status, job type, and joining date.', defaultFormat: 'XLSX' },
    { id: 't2', name: 'Monthly Payroll Disbursal & Statutory CTC', category: 'Payroll & Finance', description: 'Gross salary, PF, ESI, TDS deductions, net pay disbursal, and bank account numbers.', defaultFormat: 'XLSX' },
    { id: 't3', name: 'Attendance Adherence & Overtime Ledger', category: 'Time & Attendance', description: 'Present days, late arrivals, shift hours, and overtime calculations per employee.', defaultFormat: 'CSV' },
    { id: 't4', name: 'Leave Quota Consumption & Carry-Forward', category: 'Leaves', description: 'Casual, Sick, Earned Leave balances, LOP deductions, and carry-forward metrics.', defaultFormat: 'CSV' },
    { id: 't5', name: 'Form 24Q Quarterly Tax & Statutory Filings', category: 'Tax & Compliance', description: 'Quarterly TDS deductions, employee tax regimes, and Form 16 preparation ledger.', defaultFormat: 'PDF' },
    { id: 't6', name: 'Probation Milestone & Onboarding Queue Tracker', category: 'Lifecycle', description: '6-month probation evaluations, confirmation due dates, and document verification queue.', defaultFormat: 'PDF' },
  ];

  const schedulesList: ScheduledReport[] = [
    { id: 's1', reportName: 'Monthly Payroll & CTC Disbursal Summary', frequency: 'Monthly (1st of Month)', recipients: 'finance@vetan.ai, hr@vetan.ai', nextRunDate: '2026-11-01', status: 'ACTIVE', format: 'XLSX' },
    { id: 's2', reportName: 'Weekly Attendance & Late Arrival Audit', frequency: 'Weekly (Every Monday)', recipients: 'operations@vetan.ai', nextRunDate: '2026-10-26', status: 'ACTIVE', format: 'CSV' },
    { id: 's3', reportName: 'Quarterly Form 24Q Tax & Compliance Ledger', frequency: 'Quarterly', recipients: 'tax-admin@vetan.ai', nextRunDate: '2026-12-31', status: 'PAUSED', format: 'PDF' },
  ];

  const generatedFilesList: GeneratedFile[] = [
    { id: 'g1', fileName: 'Workforce_Headcount_Summary_10-19-2026.pdf', reportType: 'Programme summary (KPIs)', generatedAt: '2026-10-19 08:30 AM', generatedBy: 'Aditya Kapoor (HR)', fileSize: '1.4 MB', format: 'PDF' },
    { id: 'g2', fileName: 'Monthly_Payroll_CTC_Disbursal_Sep2026.xlsx', reportType: 'Payroll & CTC Disbursal', generatedAt: '2026-09-30 06:15 PM', generatedBy: 'Aditya Kapoor (HR)', fileSize: '3.2 MB', format: 'XLSX' },
    { id: 'g3', fileName: 'Attendance_Overtime_Ledger_Sep2026.csv', reportType: 'Attendance & Overtime', generatedAt: '2026-09-29 07:00 PM', generatedBy: 'System Automated', fileSize: '840 KB', format: 'CSV' },
    { id: 'g4', fileName: 'Statutory_Form24Q_Tax_Q2_2026.pdf', reportType: 'Form 24Q Tax Compliance', generatedAt: '2026-09-15 04:45 PM', generatedBy: 'System Automated', fileSize: '2.1 MB', format: 'PDF' },
  ];

  return (
    <div className="space-y-5">
      {/* Top Navigation Bar matching reference style */}
      <div className="border-b border-slate-200 flex items-center gap-8 text-sm font-semibold text-slate-600 px-1 pt-1">
        <button
          onClick={() => setActiveTab('run')}
          className={`pb-3 relative cursor-pointer transition-colors ${
            activeTab === 'run'
              ? 'text-[#039583] font-bold border-b-2 border-[#039583]'
              : 'hover:text-slate-900'
          }`}
        >
          Run a report
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`pb-3 relative cursor-pointer transition-colors ${
            activeTab === 'templates'
              ? 'text-[#039583] font-bold border-b-2 border-[#039583]'
              : 'hover:text-slate-900'
          }`}
        >
          Templates
        </button>
        <button
          onClick={() => setActiveTab('schedules')}
          className={`pb-3 relative cursor-pointer transition-colors ${
            activeTab === 'schedules'
              ? 'text-[#039583] font-bold border-b-2 border-[#039583]'
              : 'hover:text-slate-900'
          }`}
        >
          Schedules
        </button>
        <button
          onClick={() => setActiveTab('generated')}
          className={`pb-3 relative cursor-pointer transition-colors ${
            activeTab === 'generated'
              ? 'text-[#039583] font-bold border-b-2 border-[#039583]'
              : 'hover:text-slate-900'
          }`}
        >
          Generated
        </button>
      </div>

      {toastNotice && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-bold flex items-center justify-between shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastNotice}</span>
          </div>
          <button onClick={() => setToastNotice(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ================= TAB 1: RUN A REPORT (EXACT REFERENCE DESIGN) ================= */}
      {activeTab === 'run' && (
        <div className="space-y-6">
          {/* Main Filter Panel Card matching the uploaded reference image */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
              {/* Filter 1: Report Select */}
              <div className="space-y-1.5 lg:col-span-1">
                <label className="block text-xs font-bold text-slate-700">Report</label>
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  className="w-full text-xs font-medium bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#039583] shadow-2xs"
                >
                  <option value="headcount_summary">Programme summary (KPIs vs previous period)</option>
                  <option value="payroll_disbursal">Monthly Payroll & CTC Disbursal</option>
                  <option value="attendance_overtime">Attendance & Overtime Ledger</option>
                  <option value="leave_balances">Leave Quota & Balance Statement</option>
                  <option value="form24q_tax">Form 24Q Statutory Tax Compliance</option>
                  <option value="probation_tracker">Probation & Onboarding Status</option>
                </select>
              </div>

              {/* Filter 2: Period Select */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Period</label>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="w-full text-xs font-medium bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#039583] shadow-2xs"
                >
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Annual">Annual</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Custom">Custom Range</option>
                </select>
              </div>

              {/* Filter 3: Containing Date */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Containing date</label>
                <div className="relative">
                  <input
                    type="date"
                    value={containingDate}
                    onChange={(e) => setContainingDate(e.target.value)}
                    className="w-full text-xs font-mono font-medium bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#039583] shadow-2xs"
                  />
                </div>
              </div>

              {/* Filter 4: Department (HRMS equivalent of Taluka) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Department</label>
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="w-full text-xs font-medium bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#039583] shadow-2xs"
                >
                  <option value="ALL">All departments</option>
                  {departments.map((d) => (
                    <option key={d._id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                  <option value="Engineering & Technology">Engineering & Technology</option>
                  <option value="Product & Design">Product & Design</option>
                  <option value="Sales & Customer Success">Sales & Customer Success</option>
                  <option value="Finance & Compliance">Finance & Compliance</option>
                  <option value="People Operations & HR">People Operations & HR</option>
                </select>
              </div>

              {/* Filter 5: Work Location (HRMS equivalent of Village) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Work Location</label>
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  className="w-full text-xs font-medium bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#039583] shadow-2xs"
                >
                  <option value="ALL">All locations</option>
                  {locations.map((loc) => (
                    <option key={loc._id} value={loc.name}>
                      {loc.name}
                    </option>
                  ))}
                  <option value="Bengaluru HQ">Bengaluru HQ</option>
                  <option value="Mumbai Regional Office">Mumbai Regional Office</option>
                  <option value="Delhi NCR Hub">Delhi NCR Hub</option>
                  <option value="Remote / Hybrid">Remote / Hybrid</option>
                </select>
              </div>
            </div>

            {/* Run Button matching reference screenshot */}
            <div>
              <button
                onClick={handleRunReport}
                disabled={isExecuting}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#006e70] hover:bg-[#005254] text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs border border-[#005254] disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{isExecuting ? 'Running...' : 'Run'}</span>
              </button>
            </div>

            {/* Download formats section matching reference screenshot */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-2">
                <span className="block text-xs font-bold text-slate-700">Download formats</span>
                <div className="flex items-center gap-5 text-xs text-slate-700 font-medium">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="downloadFormat"
                      checked={selectedFormat === 'PDF'}
                      onChange={() => setSelectedFormat('PDF')}
                      className="accent-[#006e70] cursor-pointer"
                    />
                    <span>PDF</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="downloadFormat"
                      checked={selectedFormat === 'Excel'}
                      onChange={() => setSelectedFormat('Excel')}
                      className="accent-[#006e70] cursor-pointer"
                    />
                    <span>Excel</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="downloadFormat"
                      checked={selectedFormat === 'CSV'}
                      onChange={() => setSelectedFormat('CSV')}
                      className="accent-[#006e70] cursor-pointer"
                    />
                    <span>CSV</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="downloadFormat"
                      checked={selectedFormat === 'Word'}
                      onChange={() => setSelectedFormat('Word')}
                      className="accent-[#006e70] cursor-pointer"
                    />
                    <span>Word</span>
                  </label>
                </div>
              </div>

              {/* Action Buttons matching reference screenshot */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5 text-slate-600" />
                  <span>Download</span>
                </button>

                <button
                  onClick={() => setIsShareOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                >
                  <Share2 className="w-3.5 h-3.5 text-slate-600" />
                  <span>Share</span>
                </button>
              </div>
            </div>
          </div>

          {/* Results Display Area */}
          {hasRun && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6 animate-in fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#006e70]" />
                    <span>
                      {reportType === 'headcount_summary'
                        ? 'Programme Summary (KPIs vs Previous Period)'
                        : reportType === 'payroll_disbursal'
                        ? 'Monthly Payroll & CTC Disbursal Report'
                        : reportType === 'attendance_overtime'
                        ? 'Attendance Adherence & Overtime Ledger'
                        : reportType === 'leave_balances'
                        ? 'Leave Quota & Balance Statement'
                        : reportType === 'form24q_tax'
                        ? 'Form 24Q Statutory Tax Compliance'
                        : 'Probation Milestone & Onboarding Status'}
                    </span>
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                    <span>Period: <strong className="text-slate-800">{period}</strong></span>
                    <span>·</span>
                    <span>As of: <strong className="text-slate-800 font-mono">{containingDate}</strong></span>
                    <span>·</span>
                    <span>Department: <strong className="text-slate-800">{selectedDept === 'ALL' ? 'All departments' : selectedDept}</strong></span>
                    <span>·</span>
                    <span>Location: <strong className="text-slate-800">{selectedLocation === 'ALL' ? 'All locations' : selectedLocation}</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full font-bold">
                    148 Records Compiled
                  </span>
                </div>
              </div>

              {/* KPI Summary Strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Total Personnel</span>
                  <p className="text-xl font-black text-slate-900 font-mono mt-0.5">148</p>
                  <span className="text-[10px] text-emerald-600 font-bold">+12% vs prev period</span>
                </div>
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400">On-Time Attendance</span>
                  <p className="text-xl font-black text-emerald-600 font-mono mt-0.5">96.8%</p>
                  <span className="text-[10px] text-emerald-600 font-bold">+2.4% vs prev period</span>
                </div>
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Monthly CTC Outflow</span>
                  <p className="text-xl font-black text-slate-900 font-mono mt-0.5">₹1.84 Cr</p>
                  <span className="text-[10px] text-slate-500">Statutory Compliant</span>
                </div>
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Probation Due Review</span>
                  <p className="text-xl font-black text-amber-700 font-mono mt-0.5">6</p>
                  <span className="text-[10px] text-amber-700 font-bold">Next 30 days</span>
                </div>
              </div>

              {/* Tabular Output */}
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Emp Code</th>
                      <th className="py-3 px-4">Employee Name</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Location</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Job Type</th>
                      <th className="py-3 px-4">Annual CTC</th>
                      <th className="py-3 px-4">Joining Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {mockTableData
                      .filter((row) => selectedDept === 'ALL' || row.dept === selectedDept)
                      .filter((row) => selectedLocation === 'ALL' || row.location === selectedLocation)
                      .map((row) => (
                        <tr key={row.code} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">{row.code}</td>
                          <td className="py-3 px-4 text-slate-900 font-bold">{row.name}</td>
                          <td className="py-3 px-4 text-slate-600">{row.dept}</td>
                          <td className="py-3 px-4 text-slate-600">{row.location}</td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              row.status === 'PERMANENT' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-700 font-semibold">{row.jobType}</td>
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">{row.ctc}</td>
                          <td className="py-3 px-4 font-mono text-slate-500">{row.joining}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 2: TEMPLATES ================= */}
      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {templatesList.map((tpl) => (
            <div
              key={tpl.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                  {tpl.category}
                </span>
                <h3 className="text-sm font-bold text-slate-900">{tpl.name}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{tpl.description}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400">Default: {tpl.defaultFormat}</span>
                <button
                  onClick={() => {
                    setActiveTab('run');
                    setReportType(tpl.id === 't2' ? 'payroll_disbursal' : tpl.id === 't3' ? 'attendance_overtime' : tpl.id === 't4' ? 'leave_balances' : tpl.id === 't5' ? 'form24q_tax' : 'headcount_summary');
                  }}
                  className="px-3.5 py-1.5 bg-[#006e70] hover:bg-[#005254] text-white rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Run Template
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ================= TAB 3: SCHEDULES ================= */}
      {activeTab === 'schedules' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Automated Scheduled Reports</h3>
              <p className="text-xs text-slate-500 mt-0.5">Recurring report dispatches to leadership and auditors</p>
            </div>
            <button
              onClick={() => setToastNotice('New automated schedule modal opened.')}
              className="px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Schedule</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Report Name</th>
                  <th className="py-3 px-4">Frequency</th>
                  <th className="py-3 px-4">Recipients</th>
                  <th className="py-3 px-4">Next Run Date</th>
                  <th className="py-3 px-4">Format</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {schedulesList.map((sch) => (
                  <tr key={sch.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-900">{sch.reportName}</td>
                    <td className="py-3 px-4 text-slate-600">{sch.frequency}</td>
                    <td className="py-3 px-4 font-mono text-slate-600 truncate max-w-xs">{sch.recipients}</td>
                    <td className="py-3 px-4 font-mono text-slate-700">{sch.nextRunDate}</td>
                    <td className="py-3 px-4 font-mono text-slate-700 font-bold">{sch.format}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        sch.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {sch.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= TAB 4: GENERATED ================= */}
      {activeTab === 'generated' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Generated Report Archives</h3>
              <p className="text-xs text-slate-500 mt-0.5">Historical log of generated files ready for download</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">File Name</th>
                  <th className="py-3 px-4">Report Type</th>
                  <th className="py-3 px-4">Generated At</th>
                  <th className="py-3 px-4">Generated By</th>
                  <th className="py-3 px-4">File Size</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {generatedFilesList.map((file) => (
                  <tr key={file.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-[#006e70] shrink-0" />
                      <span>{file.fileName}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{file.reportType}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{file.generatedAt}</td>
                    <td className="py-3 px-4 text-slate-700">{file.generatedBy}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{file.fileSize}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => {
                          setToastNotice(`Downloading archived report ${file.fileName}...`);
                        }}
                        className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold text-[11px] transition cursor-pointer inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {isShareOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Share2 className="w-4 h-4 text-[#006e70]" />
                <span>Share Generated Report</span>
              </h3>
              <button onClick={() => setIsShareOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleShareSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Recipient Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="auditor@vetan.ai"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <p className="text-[11px] text-slate-500">
                A secure link with PDF/Excel download capabilities for report as of {containingDate} will be emailed.
              </p>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsShareOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={shareSuccess}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  {shareSuccess ? 'Sending...' : 'Send Report Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};