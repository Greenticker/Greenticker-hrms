import React, { useState, useEffect } from 'react';
import { KeyRound, CheckCircle2, ArrowRight, AlertTriangle } from 'lucide-react';
import { setAuthToken } from '../services/api';

interface SetPasswordPageProps {
  onDone: () => void;
}

export const SetPasswordPage: React.FC<SetPasswordPageProps> = ({ onDone: _onDone }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenErrorMsg, setTokenErrorMsg] = useState('Invalid or expired token.');
  const [userInfo, setUserInfo] = useState<{ firstName?: string; email?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const getTokenFromUrl = (): string => {
    const urlParams = new URLSearchParams(window.location.search);
    let t = urlParams.get('token') || '';
    if (!t && window.location.hash.includes('token=')) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      t = hashParams.get('token') || '';
    }
    if (!t) {
      const parts = window.location.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && /^[a-f0-9]{64}$/i.test(last)) {
        t = last;
      }
    }
    return t.trim();
  };

  const [token, setToken] = useState<string>(getTokenFromUrl);

  useEffect(() => {
    const activeToken = token || getTokenFromUrl();
    if (!activeToken) {
      setVerifying(false);
      setTokenValid(false);
      setTokenErrorMsg('No invite token provided in the link. Please use the complete link from your invite email.');
      return;
    }

    fetch(`/api/auth/setup-link/${activeToken}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setTokenValid(true);
          setUserInfo({ firstName: data.firstName, email: data.email });
        } else {
          setTokenValid(false);
          const reasonMap: Record<string, string> = {
            EXPIRED: 'This invite link has expired (valid for 48 hours). Please ask HR to send you a new invite.',
            USED: 'This invite link has already been used. Please sign in with your password.',
            REPLACED: 'This invite link has been replaced by a newer invite. Please use the latest email.',
            INVALID: 'This invite link is invalid.',
          };
          setTokenErrorMsg(reasonMap[data.reason] || 'This invite link is invalid or has expired.');
        }
      })
      .catch(() => {
        setTokenValid(false);
        setTokenErrorMsg('Failed to verify invite link. Please try again.');
      })
      .finally(() => {
        setVerifying(false);
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      setError('Password must be at least 8 characters and include at least one letter and one number.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to set password.');
      }
      if (data.accessToken) {
        setAuthToken(data.accessToken);
      }
      setSuccess(true);
      setTimeout(() => {
        window.history.replaceState({}, '', '/');
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-slate-100">
      <div className="max-w-md w-full bg-slate-800 border border-slate-700/80 rounded-2xl shadow-2xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Set Account Password</h1>
            <p className="text-xs text-slate-400">Secure your Anusyuti HR account</p>
          </div>
        </div>

        {verifying ? (
          <div className="text-center py-8 space-y-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-slate-400 font-mono">Verifying your invite link...</p>
          </div>
        ) : !tokenValid ? (
          <div className="bg-rose-950/40 border border-rose-500/30 rounded-xl p-6 text-center space-y-3">
            <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
            <h2 className="text-base font-bold text-white">Link Verification Failed</h2>
            <p className="text-xs text-rose-300/90 leading-relaxed">{tokenErrorMsg}</p>
            <button
              onClick={() => {
                window.history.replaceState({}, '', '/');
                window.location.reload();
              }}
              className="mt-2 inline-block bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Return to Login
            </button>
          </div>
        ) : success ? (
          <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-6 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-bold text-white">Password Set Successfully!</h2>
            <p className="text-xs text-emerald-300/80">Logging you in and redirecting to dashboard...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {userInfo?.firstName && (
              <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-lg p-3 text-xs text-indigo-200">
                Welcome, <span className="font-semibold text-white">{userInfo.firstName}</span>! Set your secure password below.
              </div>
            )}
            {error && (
              <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs p-3 rounded-lg">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">New Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 chars, 1 letter, 1 number"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Confirm Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm secure password"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Set Password & Login'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
