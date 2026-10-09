import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types/auth';
import { AnusyutiLogo } from '../components/common/anusyuti_logo';

interface SignupPageProps {
  onSuccess: () => void;
  onNavigateToLogin: () => void;
}

export const SignupPage: React.FC<SignupPageProps> = ({ onSuccess, onNavigateToLogin }) => {
  const { signup } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('EMPLOYEE');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signup(firstName, lastName, email, password, role);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center px-6 py-4 rounded-2xl bg-white shadow-xl border border-slate-200/90 mx-auto transition-transform hover:scale-[1.02]">
          <AnusyutiLogo size="lg" variant="horizontal" />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
          Create Employee Account
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Register to join the Anusyuti platform
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200 sm:rounded-2xl sm:px-10">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {error}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">First Name</label>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="Sarah"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Last Name</label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="Connor"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="priya.sharma@anusyuti.com"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="At least 6 characters"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Designated Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="EMPLOYEE">Employee (Self-Service)</option>
                <option value="ADMIN">Administrator (Full Access)</option>
              </select>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg shadow-sm text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loading ? 'Creating Account...' : 'Register Account'}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={onNavigateToLogin}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
            >
              Already have an account? Sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};