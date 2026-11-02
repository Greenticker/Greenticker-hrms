/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BaseLayout } from './components/layout/BaseLayout';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { RegisterCompanyPage } from './pages/RegisterCompanyPage';
import { CompanySetupPage } from './pages/CompanySetupPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SetPasswordPage } from './pages/Setpasswordpage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage';
import { OrganizationPage } from './pages/OrganizationPage';
import { OnboardingQueuePage } from './pages/OnboardingQueuePage';
import { DocumentsPage } from './pages/DocumentsPage';
import { LifecyclePage } from './pages/LifecyclePage';
import { AttendancePage } from './pages/AttendancePage';
import { ShiftsPage } from './pages/ShiftsPage';
import { LeavePage } from './pages/LeavePage';
import { ExpensesPage } from './pages/ExpensesPage';
import { PayrollPage } from './pages/PayrollPage';
import { TaxPage } from './pages/TaxPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { PoshPage } from './pages/PoshPage';
import { HolidaysPage } from './pages/HolidaysPage';
import { AnnouncementsPage } from './pages/AnnouncementsPage';
import { PerformancePage } from './pages/PerformancePage';
import { RecruitmentPage } from './pages/RecruitmentPage';
import { HrRequestsPage } from './pages/HrRequestsPage';
import { FullFinalPage } from './pages/FullFinalPage';
import { ExitManagementPage } from './pages/ExitManagementPage';
import { IncomeTaxCalculatorPage } from './pages/IncomeTaxCalculatorPage';
import { SalaryArrearPage } from './pages/SalaryArrearPage';
import { ReportsPage } from './pages/ReportsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { AssetsPage } from './pages/AssetsPage';
import { InsurancePage } from './pages/InsurancePage';
import { LetterTemplatesPage } from './pages/LetterTemplatesPage';
import { ModulePlaceholder } from './pages/ModulePlaceholder';
import { SystemSettingsPage, SETTINGS_ADMIN_ROLES } from './pages/SystemSettingsPage';

/**
 * Tab IDs are the ones emitted by Sidebar.tsx (and DashboardPage navigation).
 * Older IDs that previously existed in this file are kept as aliases so any
 * remaining callers keep working.
 */
const TAB_ALIASES: Record<string, string> = {
  audit: 'audit_logs',
  fnf: 'full_final',
  requests: 'hr_requests',
};

/** Page titles shown in the navbar, keyed by canonical tab ID. */
const SECTION_TITLES: Record<string, string> = {
  dashboard: 'vetan.ai',
  employees: 'Employees Directory',
  employee_detail: 'Employee Profile',
  organization: 'Organization & Departments',
  onboarding: 'Onboarding Queue',
  documents: 'Employee Documents',
  letter_templates: 'Letter Templates',
  lifecycle: 'Employee Lifecycle',
  attendance: 'Attendance & Overtime',
  shifts: 'Work Shifts & Rosters',
  leave: 'Leave Management',
  expenses: 'Expense Claims',
  payroll: 'Payroll Management',
  assets: 'Allocated Assets',
  tax: 'Tax & Deductions',
  policies: 'Company Policies',
  posh: 'POSH Committee & Support',
  holidays: 'Holiday Calendar',
  announcements: 'Announcements & Feeds',
  performance: 'Performance & Goals',
  recruitment: 'Recruitment & Job Openings',
  hr_requests: 'HR Service Desk',
  full_final: 'Full & Final Settlement',
  exit_management: 'Exit Management',
  income_tax_calculator: 'Income Tax Calculator',
  salary_arrears: 'Salary Arrears',
  reports: 'Structured HR Reports',
  analytics: 'Workforce Analytics & Insights',
  audit_logs: 'Security & Audit Logs',
  insurance: 'Insurance & Benefits',
  profile: 'My Profile',
  settings: 'System Settings',
  roles_permissions: 'Roles & Permissions',
};

/** Pages that need no props from this component. */
const SIMPLE_PAGES: Record<string, React.ComponentType> = {
  organization: OrganizationPage,
  onboarding: OnboardingQueuePage,
  documents: DocumentsPage,
  letter_templates: LetterTemplatesPage,
  lifecycle: LifecyclePage,
  attendance: AttendancePage,
  shifts: ShiftsPage,
  leave: LeavePage,
  expenses: ExpensesPage,
  payroll: PayrollPage,
  assets: AssetsPage,
  tax: TaxPage,
  policies: PoliciesPage,
  posh: PoshPage,
  holidays: HolidaysPage,
  announcements: AnnouncementsPage,
  performance: PerformancePage,
  recruitment: RecruitmentPage,
  hr_requests: HrRequestsPage,
  full_final: FullFinalPage,
  exit_management: ExitManagementPage,
  income_tax_calculator: IncomeTaxCalculatorPage,
  salary_arrears: SalaryArrearPage,
  reports: ReportsPage,
  analytics: AnalyticsPage,
  insurance: InsurancePage,
};

function checkIsSetupRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const path = (window.location.pathname || '').toLowerCase().replace(/\/+$/, '');
  const search = new URLSearchParams(window.location.search);
  const hash = window.location.hash || '';
  return (
    path === '/setup-password' ||
    path === '/set-password' ||
    path.endsWith('/setup-password') ||
    path.endsWith('/set-password') ||
    path.includes('setup-password') ||
    path.includes('set-password') ||
    search.has('token') ||
    hash.includes('token=')
  );
}

function MainApp() {
  const { user, isLoading } = useAuth();
  const [authView, setAuthView] = useState<'login' | 'signup' | 'register-company'>('login');
  const [activeTab, setActiveTabRaw] = useState<string>('dashboard');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  // Invite links open /setup-password?token=... (the app has no router, so detect it here).
  const [inSetupRoute, setInSetupRoute] = useState<boolean>(() => checkIsSetupRoute());

  React.useEffect(() => {
    const onLocationChange = () => setInSetupRoute(checkIsSetupRoute());
    window.addEventListener('popstate', onLocationChange);
    return () => window.removeEventListener('popstate', onLocationChange);
  }, []);

  const setActiveTab = (tabId: string) => setActiveTabRaw(TAB_ALIASES[tabId] ?? tabId);

  // Shown before any auth check so it works even if someone else is signed in on this browser.
  if (inSetupRoute) {
    return <SetPasswordPage onDone={() => setInSetupRoute(false)} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-lg animate-pulse">
            V
          </div>
          <p className="text-xs font-semibold text-slate-500 font-mono">
            Initializing vetan.ai...
          </p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    if (authView === 'signup') {
      return (
        <SignupPage
          onSuccess={() => {}}
          onNavigateToLogin={() => setAuthView('login')}
        />
      );
    }
    if (authView === 'register-company') {
      return (
        <RegisterCompanyPage
          onSuccess={() => window.location.reload()}
          onNavigateToLogin={() => setAuthView('login')}
        />
      );
    }
    return (
      <LoginPage
        onSuccess={() => {}}
        onNavigateToSignup={() => setAuthView('signup')}
        onNavigateToRegisterCompany={() => setAuthView('register-company')}
      />
    );
  }

  if (user.role === 'ADMIN' && user.orgSetupCompleted === false) {
    return (
      <CompanySetupPage
        onComplete={() => window.location.reload()}
      />
    );
  }

  if (!user.onboardingCompleted) {
    return (
      <OnboardingPage
        onComplete={() => {
          setActiveTab('dashboard');
        }}
      />
    );
  }

  const handleSelectEmployee = (empId: string) => {
    setSelectedEmployeeId(empId);
    setActiveTab('employee_detail');
  };

  const handleSelectTab = (tabId: string) => {
    if (tabId === 'profile') {
      if (user.employee?._id) {
        setSelectedEmployeeId(user.employee._id);
        setActiveTab('employee_detail');
      } else {
        setActiveTab('profile');
      }
    } else {
      setActiveTab(tabId);
    }
  };

  const renderPage = (): React.ReactNode => {
    if (activeTab === 'dashboard') {
      return <DashboardPage onNavigateTab={handleSelectTab} />;
    }
    if (activeTab === 'settings' || activeTab === 'roles_permissions') {
      return (
        <SystemSettingsPage
          key={activeTab}
          initialTab={activeTab === 'roles_permissions' ? 'roles' : 'company'}
          onComplete={() => setActiveTab('dashboard')}
        />
      );
    }
    if (activeTab === 'audit_logs') {
      return <AuditLogsPage onNavigateTab={handleSelectTab} />;
    }
    if (activeTab === 'employees') {
      return <EmployeesPage onSelectEmployee={handleSelectEmployee} />;
    }
    if (activeTab === 'employee_detail' && selectedEmployeeId) {
      return (
        <EmployeeDetailPage
          employeeId={selectedEmployeeId}
          onBack={() => setActiveTab('employees')}
        />
      );
    }

    const Page = SIMPLE_PAGES[activeTab];
    if (Page) return <Page />;

    // Only reached for modules that have no page yet (currently: settings,
    // and 'profile' for accounts that have no linked employee record).
    return (
      <ModulePlaceholder
        moduleId={activeTab}
        onBackToDashboard={() => setActiveTab('dashboard')}
      />
    );
  };

  // Main Authenticated Workspace
  return (
    <BaseLayout
      activeTab={
        activeTab === 'employee_detail'
          ? 'employees'
          : activeTab === 'roles_permissions' && SETTINGS_ADMIN_ROLES.includes(user.role)
          ? 'settings'
          : activeTab
      }
      onSelectTab={handleSelectTab}
      sectionTitle={SECTION_TITLES[activeTab] ?? activeTab.replace(/_/g, ' ').toUpperCase()}
    >
      {renderPage()}
    </BaseLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}