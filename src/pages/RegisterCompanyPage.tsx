import React, { useState } from 'react';
import { AnusyutiLogo } from '../components/common/anusyuti_logo';
import { Building2, User, Mail, Lock, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';

interface RegisterCompanyPageProps {
  onSuccess: () => void;
  onNavigateToLogin: () => void;
}

export const RegisterCompanyPage: React.FC<RegisterCompanyPageProps> = ({ onSuccess, onNavigateToLogin }) => {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    companyName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/auth/register-company', form);
      if (res.accessToken) {
        localStorage.setItem('accessToken', res.accessToken);
        onSuccess();
      } else {
        throw new Error(res.error || 'Registration failed.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to register company. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const setField = (field: string, val: string) => setForm(prev => ({ ...prev, [field]: val }));

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="flex justify-center mb-5">
          <div className="bg-white px-6 py-3.5 rounded-2xl shadow-2xl border border-slate-100 transition-transform hover:scale-[1.02]">
            <AnusyutiLogo size="lg" variant="horizontal" />
          </div>
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight">Register Your Organization</h2>
        <p className="text-xs text-slate-400 mt-1">Create your enterprise workspace and configure HRMS in minutes</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-8 px-6 shadow-2xl rounded-2xl border border-slate-100 sm:px-10">
          {error && (
            <div className="mb-6 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Company Name</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Building2 className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={form.companyName}
                  onChange={e => setField('companyName', e.target.value)}
                  placeholder="Acme Global Technologies"
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">First Name</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={form.firstName}
                    onChange={e => setField('firstName', e.target.value)}
                    placeholder="Jane"
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Last Name</label>
                <input
                  type="text"
                  required
                  value={form.lastName}
                  onChange={e => setField('lastName', e.target.value)}
                  placeholder="Doe"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Work Email (Admin)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={e => setField('email', e.target.value)}
                  placeholder="admin@acme.com"
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Password (min 8 chars)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={e => setField('password', e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#039583]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-[#039583] hover:bg-[#027d70] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Register & Continue Setup <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={onNavigateToLogin}
              className="text-xs font-semibold text-slate-600 hover:text-[#039583] cursor-pointer"
            >
              Already registered? Sign in here
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
