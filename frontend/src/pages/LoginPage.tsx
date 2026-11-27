import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types/auth';
import { ShieldCheck, UserCheck, KeyRound, Sparkles, Building2 } from 'lucide-react';
import { VetanLogo } from '../components/common/anusyuti_logo';

interface LoginPageProps {
  onSuccess: () => void;
  onNavigateToSignup: () => void;
  onNavigateToRegisterCompany: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onSuccess, onNavigateToSignup, onNavigateToRegisterCompany }) => {
  const { login, verifyOtp, sessionMessage } = useAuth();
  const [otp, setOtp] = useState<{ challengeId: string; message: string; devOtp?: string } | null>(null);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('omkar@greenticker.in');
  const [password, setPassword] = useState('Admin@12345');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (otp) {
        await verifyOtp(otp.challengeId, code.trim());
        onSuccess();
        return;
      }
      const result = await login(email, password);
      if ('mfaRequired' in result) {
        setOtp(result);
        setCode('');
        return;
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const quickLogins = [
    {
      role: 'SUPER_ADMIN' as Role,
      title: 'Super Admin',
      email: 'superadmin@vetan.ai',
      pass: 'SuperAdmin@12345',
      desc: 'Full RW: Code, tax rules, global masters, immutable retention & audit',
      color: 'border-purple-300 bg-purple-50/70 hover:border-purple-500',
    },
    {
      role: 'ADMIN_1' as Role,
      title: 'Admin 1',
      email: 'admin1@vetan.ai',
      pass: 'Admin1@12345',
      desc: 'Operations & HR Admin: RW on Core HR, Loans, Asset, Leaves, Payroll',
      color: 'border-indigo-300 bg-indigo-50/70 hover:border-indigo-500',
    },
    {
      role: 'ADMIN_2' as Role,
      title: 'Admin 2',
      email: 'admin2@vetan.ai',
      pass: 'Admin2@12345',
      desc: 'Day-to-day Asset issue/return, Attendance, Leave, Ticketing',
      color: 'border-violet-300 bg-violet-50/70 hover:border-violet-500',
    },
    {
      role: 'FINANCE' as Role,
      title: 'Finance',
      email: 'finance@vetan.ai',
      pass: 'Finance@12345',
      desc: 'Payroll processing, Loan/Adv approval, Insurance premiums, Exit F&F',
      color: 'border-emerald-300 bg-emerald-50/70 hover:border-emerald-500',
    },
    {
      role: 'HR' as Role,
      title: 'HR',
      email: 'hr@vetan.ai',
      pass: 'HR@12345',
      desc: 'Employee Master owner, Onboarding verification, POSH, Performance',
      color: 'border-brand-300 bg-brand-50/70 hover:border-brand-500',
    },
    {
      role: 'ACCOUNTS' as Role,
      title: 'Accounts',
      email: 'accounts@vetan.ai',
      pass: 'Accounts@12345',
      desc: 'Ledger/GL owner, JV posting, Loans recovery & payout posting',
      color: 'border-amber-300 bg-amber-50/70 hover:border-amber-500',
    },
    {
      role: 'AUDITORS' as Role,
      title: 'Auditors',
      email: 'auditor@vetan.ai',
      pass: 'Auditor@12345',
      desc: 'Read-Only compliance & statutory auditing across all 18 modules',
      color: 'border-rose-300 bg-rose-50/70 hover:border-rose-500',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center px-6 py-4 rounded-2xl bg-white shadow-xl border border-slate-200/90 mx-auto transition-transform hover:scale-[1.02]">
          <VetanLogo size="lg" variant="horizontal" />
        </div>
        <p className="mt-4 text-xs text-slate-500 font-medium">
          Sign in to access your Human Resource Management System
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-xl">
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200 sm:rounded-2xl sm:px-10">
          {sessionMessage && !error && (
            <div role="status" className="mb-5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium">{sessionMessage}</div>
          )}
          {error && (
            <div role="alert" className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {error}
            </div>
          )}
          {otp && (
            <form className="space-y-4 mb-6" onSubmit={handleSubmit}>
              <p className="text-xs text-slate-700">{otp.message}</p>
              {otp.devOtp && <p className="text-[11px] text-amber-700">Email is not configured here; your code is {otp.devOtp}.</p>}
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">One-time code
                <input autoFocus inputMode="numeric" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-lg tracking-[0.5em] text-center" />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={loading || code.length !== 6} className="flex-1 rounded-lg bg-primary text-white py-2 text-sm font-semibold disabled:opacity-50">Verify</button>
                <button type="button" onClick={() => setOtp(null)} className="rounded-lg border border-slate-300 px-3 text-sm">Back</button>
              </div>
            </form>
          )}

          <form className="space-y-4" onSubmit={handleSubmit} hidden={!!otp}>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Work Email Address
              </label>
              <div className="mt-1">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/25"
                  placeholder="name@company.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Password
              </label>
              <div className="mt-1">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/25"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-slate-900 hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary/25 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loading ? 'Authenticating with JWT...' : 'Sign In to Workspace'}
              </button>
            </div>
          </form>

          {/* Quick Demo Role Selection Dropdown */}
          <div className="mt-8 pt-6 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="role-select-dropdown" className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-accent" />
                Select Role to Test
              </label>
              <span className="text-[11px] text-slate-400 font-mono">RBAC Test Suite</span>
            </div>

            <select
              id="role-select-dropdown"
              value={quickLogins.find((item) => item.email === email)?.role || ''}
              onChange={(e) => {
                const selected = quickLogins.find((item) => item.role === e.target.value);
                if (selected) {
                  setEmail(selected.email);
                  setPassword(selected.pass);
                }
              }}
              className="w-full bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/25 cursor-pointer shadow-xs"
            >
              <option value="" disabled>-- Choose a Role from Access Matrix --</option>
              {quickLogins.map((item) => (
                <option key={item.role} value={item.role}>
                  {item.title} ({item.email})
                </option>
              ))}
            </select>

            {/* Selected Role Scope Card */}
            {(() => {
              const activeItem = quickLogins.find((item) => item.email === email);
              if (!activeItem) return null;
              return (
                <div className={`p-3 rounded-xl border text-xs space-y-1 ${activeItem.color}`}>
                  <div className="flex items-center justify-between font-bold text-slate-900">
                    <span>{activeItem.title} Scope</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/80 border border-slate-200">
                      {activeItem.role}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">{activeItem.desc}</p>
                </div>
              );
            })()}
          </div>

          <div className="mt-6 text-center space-y-2">
            <div>
              <button
                onClick={onNavigateToSignup}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
              >
                Don't have an account? Register new employee
              </button>
            </div>
            <div>
              <button
                onClick={onNavigateToRegisterCompany}
                className="text-xs text-accent hover:text-primary-hover font-bold cursor-pointer flex items-center justify-center gap-1 mx-auto"
              >
                <Building2 className="w-3.5 h-3.5" /> Register a New Company Workspace
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};