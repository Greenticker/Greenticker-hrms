import React from 'react';
import { useAuth } from '../context/AuthContext';
import { CompanySetupPage } from './CompanySetupPage';
import { AdminConsole } from '../components/admin/AdminConsole';

// Roles that see the full admin console (others get the read-only Roles & Permissions view)
export const SETTINGS_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'ADMIN_1', 'ADMIN_2', 'AUDITORS'];

type SettingsTab = 'company' | 'roles';

interface SystemSettingsPageProps {
  onComplete: () => void;
  initialTab?: SettingsTab;
}

export const SystemSettingsPage: React.FC<SystemSettingsPageProps> = ({ onComplete, initialTab = 'company' }) => {
  const { user } = useAuth();
  const canSetupCompany = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role || '');
  return (
    <AdminConsole
      initial={initialTab === 'roles' ? 'roles' : 'users'}
      companySetup={canSetupCompany ? <CompanySetupPage onComplete={onComplete} /> : null}
    />
  );
};
