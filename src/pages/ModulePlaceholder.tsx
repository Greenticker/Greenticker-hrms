import React from 'react';
import { Layers, ArrowRight, ShieldCheck, Clock, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface ModulePlaceholderProps {
  moduleId: string;
  onBackToDashboard: () => void;
}

export const ModulePlaceholder: React.FC<ModulePlaceholderProps> = ({ moduleId, onBackToDashboard }) => {
  const { user } = useAuth();

  const moduleDetails: Record<string, { title: string; phase: string; desc: string; highlights: string[] }> = {
    employees: {
      title: 'Employees Directory & Profile Management',
      phase: 'User & Employee Management',
      desc: 'Centralized directory containing full employee lifecycle data, contact info, statutory details, and managerial reporting structures.',
      highlights: ['Tabbed profile views', 'Multi-department filtering', 'Reporting hierarchy tracking'],
    },
    onboarding: {
      title: 'Employee Onboarding Queue',
      phase: 'Onboarding Workflow',
      desc: 'HR review pipeline for newly registered employees completing the 9 mandatory onboarding stages.',
      highlights: ['Step-by-step progress tracking', 'Document validation queue', 'Policy consent audit log'],
    },
    documents: {
      title: 'Employee Document Repository',
      phase: 'Document Management',
      desc: 'Secure document management for ID proofs, contracts, certifications, and relieving letters with expiry tracking.',
      highlights: ['Upload & replace capability', 'HR verification stamps', 'Expiry date tracking'],
    },
    attendance: {
      title: 'Attendance & Overtime Management',
      phase: 'Time, Attendance & Overtime',
      desc: 'Live shift attendance logs with automatic extra-day pay (8h shift incl. break; day-credits above 10h).',
      highlights: ['No separate overtime page', 'Automatic overtime computation', 'Shift roster integration'],
    },
    shifts: {
      title: 'Work Shifts & Rostering',
      phase: 'Shift Scheduling',
      desc: 'Organization shift configuration including working hour parameters, grace periods, and break policies.',
      highlights: ['Standard & rotational shifts', 'Weekend & holiday rules', 'Break management'],
    },
    leave: {
      title: 'Leave Management & Balances',
      phase: 'Leave Management',
      desc: 'Configurable leave categories (Casual, Sick, Earned, Parental) with multi-level approval workflows.',
      highlights: ['Annual allocation & accrual', 'Manager & HR approval workflows', 'Leave encashment rules'],
    },
    expenses: {
      title: 'Expense Claims & Reimbursements',
      phase: 'Expense Management',
      desc: 'Employee expense submission with receipt attachment, managerial authorization, and OCR integration capability.',
      highlights: ['Receipt upload support', 'Approval hierarchy', 'Reimbursement status tracking'],
    },
    payroll: {
      title: 'Payroll & Compensation Management',
      phase: 'Payroll System',
      desc: 'Full-cycle salary processing integrating basic pay, HRA, bonuses, attendance deductions, PF, ESI, and TDS.',
      highlights: ['Salary structure configuration', 'Automated payslip generation', 'Statutory deductions integration'],
    },
    tax: {
      title: 'Tax Profile & Form 16 Preparation',
      phase: 'Tax & Form 16',
      desc: 'Guided tax declarations (New vs Old regime), investment proofs collection, and Form 16 Part A/B data generation.',
      highlights: ['Chapter VI-A declaration', 'Proof upload & HR verification', 'Connected Form 16 generation'],
    },
    policies: {
      title: 'Organizational Policies Management',
      phase: 'Policies & Governance',
      desc: 'Core policy management with administrative authoring, version tracking, and employee acknowledgement logs.',
      highlights: ['Admin-only creation & deletion', '15 Starter HR policy templates', 'Version tracking & acknowledgements'],
    },
    posh: {
      title: 'POSH Committee & Confidential Grievances',
      phase: 'POSH Compliance',
      desc: 'Strictly confidential workflow for sexual harassment case reporting and Internal Committee inquiry tracking.',
      highlights: ['Strictly restricted to Admin/Authorized HR', 'Zero visibility to ordinary managers/employees', 'Auditable case timeline'],
    },
    holidays: {
      title: 'Public & Optional Holidays',
      phase: 'Holiday Calendar',
      desc: 'Annual holiday calendar configured by location, department, and mandatory/optional classifications.',
      highlights: ['Location applicability', 'Optional holiday quotas', 'Calendar synchronization'],
    },
    announcements: {
      title: 'Company Announcements & Notices',
      phase: 'Internal Communications',
      desc: 'Targeted corporate broadcasts with role and department audience filters.',
      highlights: ['Audience segmenting', 'Attachment support', 'Expiry scheduling'],
    },
    performance: {
      title: 'Performance & OKR Reviews',
      phase: 'Performance Management',
      desc: 'Review cycles with self-evaluation, manager feedback ratings, and strategic goal tracking.',
      highlights: ['Goal setting & KPIs', 'Self & Manager reviews', 'Historical review scoring'],
    },
    recruitment: {
      title: 'Recruitment & Job Openings',
      phase: 'Talent Acquisition',
      desc: 'Job requisition tracking, candidate profiles, resume management, and interview stage pipelines.',
      highlights: ['Job opening postings', 'Candidate tracking', 'Offer letter generation link'],
    },
    hr_requests: {
      title: 'HR Operations Service Desk',
      phase: 'HR Operations',
      desc: 'Employee service requests for salary certificates, address updates, bank changes, and formal HR queries.',
      highlights: ['Ticket tracking', 'Resolution SLAs', 'HR document issuing'],
    },
    full_final: {
      title: 'Full & Final Settlement (F&F)',
      phase: 'Separation & F&F',
      desc: 'Employee exit workflow calculating notice pay, leave encashment, asset handovers, and final settlement payouts.',
      highlights: ['Asset clearance checks', 'Leave encashment computation', 'Settlement certificate generation'],
    },
    reports: {
      title: 'Workforce Reports & Analytics',
      phase: 'Reports & Analytics',
      desc: 'Role-filtered reporting across headcount, attrition, attendance trends, overtime, leave usage, and payroll expenses.',
      highlights: ['Role-isolated analytics', 'Export capabilities', 'Compliance audit charts'],
    },
    audit_logs: {
      title: 'Security & Audit Logging Console',
      phase: 'Security & Audit Hardening',
      desc: 'Immutable audit trail capturing all critical actions, employee edits, payroll runs, and permission checks.',
      highlights: ['Admin-only access', 'IP & device metadata', 'Old vs new state tracking'],
    },
    profile: {
      title: 'My Employee Profile',
      phase: 'Self-Service Profile',
      desc: 'Personal employment profile with view and permitted edit permissions.',
      highlights: ['Personal contact update', 'Bank & statutory view', 'Assigned shift & manager details'],
    },
    settings: {
      title: 'System & Organization Settings',
      phase: 'System Administration',
      desc: 'Global organization parameters, working days, shifts, roles, and API integrations.',
      highlights: ['Organization metadata', 'RBAC role mappings', 'Notification triggers'],
    },
  };

  const details = moduleDetails[moduleId] || {
    title: 'HRMS Module',
    phase: 'Upcoming Phase',
    desc: 'This module is scheduled for implementation in subsequent phases.',
    highlights: ['Modular architecture', 'RBAC enforcement', 'API integration'],
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded font-mono">
                {details.phase}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-xs text-slate-500 font-mono">Module ID: {moduleId}</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-2">{details.title}</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">{details.desc}</p>
          </div>
          <button
            onClick={onBackToDashboard}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            ← Return to Dashboard
          </button>
        </div>

        <div className="mt-6">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
            Architectural Specifications & Planned Features
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {details.highlights.map((h, i) => (
              <div key={i} className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs">
                <span className="font-semibold text-slate-900">• {h}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 p-4 rounded-xl border border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <p className="text-xs font-bold text-slate-900">
                RBAC Access Status: Permitted for <span className="font-mono text-indigo-700">{user?.role}</span>
              </p>
              <p className="text-[11px] text-slate-500">
                Backend route access and database collection schemas have been provisioned in Phase 1.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};