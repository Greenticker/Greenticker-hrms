import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessages } from '../utils/access';

/** Shown when the password has expired: nothing else works until it is changed. */
export const ChangePasswordPage: React.FC = () => {
  const { changePassword, logout } = useAuth();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) return setErrors(['The new passwords do not match.']);
    try {
      await changePassword(f.current, f.next);
    } catch (err) {
      setErrors(apiErrorMessages(err));
    }
  };
  const cls = 'mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm';
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-8 w-full max-w-md space-y-4">
        <h1 className="text-lg font-bold">Your password has expired</h1>
        <p className="text-xs text-slate-500">Choose a new password. It must meet the password policy and cannot be one of your recent passwords.</p>
        {errors.length > 0 && <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">{errors.map((x) => <div key={x}>{x}</div>)}</div>}
        <label className="block text-xs font-semibold">Current password<input type="password" required className={cls} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <label className="block text-xs font-semibold">New password<input type="password" required className={cls} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></label>
        <label className="block text-xs font-semibold">Confirm new password<input type="password" required className={cls} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
        <div className="flex gap-2">
          <button type="submit" className="flex-1 rounded-lg bg-primary text-white py-2 text-sm font-semibold">Change password</button>
          <button type="button" onClick={logout} className="rounded-lg border border-slate-300 px-3 text-sm">Sign out</button>
        </div>
      </form>
    </div>
  );
};
