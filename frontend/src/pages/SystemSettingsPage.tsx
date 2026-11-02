import React, { useState } from 'react';
import { Building2, ShieldCheck, Table, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { CompanySetupPage } from './CompanySetupPage';
import { RbacRolesTab } from '../components/common/RbacRolesTab';
import { ModuleAccessMatrix } from '../components/common/ModuleAccessMatrix';

// Only these roles can change company setup; others get the read-only Roles & Permissions view
export const SETTINGS_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

type SettingsTab = 'company' | 'roles';

interface SystemSettingsPageProps {
  onComplete: () => void;
  initialTab?: SettingsTab;
}

const tabClass = (active: boolean) =>
  `flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
    active ? 'bg-[#023b77] text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

const RolesPermissionsPanel: React.FC = () => {
  const [view, setView] = useState<'matrix' | 'permissions'>('matrix');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button onClick={() => setView('matrix')} className={tabClass(view === 'matrix')}>
          <Table className="w-3.5 h-3.5" />
          <span>Module Access Matrix</span>
        </button>
        <button onClick={() => setView('permissions')} className={tabClass(view === 'permissions')}>
          <KeyRound className="w-3.5 h-3.5" />
          <span>Role Permissions</span>
        </button>
      </div>

      {view === 'matrix' ? <ModuleAccessMatrix /> : <RbacRolesTab readOnly />}
    </div>
  );
};

export const SystemSettingsPage: React.FC<SystemSettingsPageProps> = ({ onComplete, initialTab = 'company' }) => {
  const { user } = useAuth();
  const canEditSettings = SETTINGS_ADMIN_ROLES.includes(user?.role || '');
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  if (!canEditSettings) {
    return <RolesPermissionsPanel />;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-xs flex items-center gap-1 overflow-x-auto">
        <button onClick={() => setTab('company')} className={tabClass(tab === 'company')}>
          <Building2 className="w-3.5 h-3.5" />
          <span>Company Setup</span>
        </button>
        <button onClick={() => setTab('roles')} className={tabClass(tab === 'roles')}>
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Roles & Permissions (RBAC)</span>
        </button>
      </div>

      {tab === 'company' ? <CompanySetupPage onComplete={onComplete} /> : <RolesPermissionsPanel />}
    </div>
  );
};
