import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types/auth';
import { ShieldCheck, UserCheck, KeyRound, Sparkles, Building2 } from 'lucide-react';
import { AnusyutiLogo } from '../components/common/anusyuti_logo';

interface LoginPageProps {
  onSuccess: () => void;
  onNavigateToSignup: () => void;
  onNavigateToRegisterCompany: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onSuccess, onNavigateToSignup, onNavigateToRegisterCompany }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('omkar@greenticker.in');
  const [password, setPassword] = useState('Admin@12345');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const quickLogins = [
    {
      role: 'ADMIN' as Role,
      title: 'Administrator',
      email: 'omkar@greenticker.in',
      pass: 'Admin@12345',
      desc: 'Complete organization authority, policies & settings',
      color: 'border-purple-200 hover:border-purple-400 bg-purple-50/50',
    },
    {
      role: 'EMPLOYEE' as Role,
      title: 'Employee',
      email: 'employee@anusyuti.com',
      pass: 'Employee@12345',
      desc: 'Self-service attendance, check-in, leave & claims',
      color: 'border-slate-200 hover:border-slate-400 bg-slate-50',
    },
    {
      role: 'EMPLOYEE' as Role,
      title: 'New Hire (Incomplete)',
      email: 'newhire@anusyuti.com',
      pass: 'NewHire@12345',
      desc: 'Tests Rule 6: First login redirect to 9-step Onboarding',
      color: 'border-amber-200 hover:border-amber-400 bg-amber-50/60',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center px-6 py-4 rounded-2xl bg-white shadow-xl border border-slate-200/90 mx-auto transition-transform hover:scale-[1.02]">
          <AnusyutiLogo size="lg" variant="horizontal" />
        </div>
        <p className="mt-4 text-xs text-slate-500 font-medium">
          Sign in to access your Human Resource Management System
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-xl">
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200 sm:rounded-2xl sm:px-10">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {error}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
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
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
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
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loading ? 'Authenticating with JWT...' : 'Sign In to Workspace'}
              </button>
            </div>
          </form>

          {/* Quick Demo Role Selection */}
          <div className="mt-8 pt-6 border-t border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                Select Role to Test
              </p>
              <span className="text-[11px] text-slate-400 font-mono">RBAC Test Suite</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {quickLogins.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setEmail(item.email);
                    setPassword(item.pass);
                  }}
                  className={`p-2.5 text-left rounded-lg border transition-all cursor-pointer ${item.color} ${
                    email === item.email ? 'ring-2 ring-slate-900 shadow-xs' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">{item.title}</span>
                    <span className="text-[10px] font-mono text-slate-500">{item.role}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{item.desc}</p>
                </button>
              ))}
            </div>
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
                className="text-xs text-[#039583] hover:text-[#027d70] font-bold cursor-pointer flex items-center justify-center gap-1 mx-auto"
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