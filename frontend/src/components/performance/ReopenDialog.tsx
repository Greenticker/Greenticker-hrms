import React, { useState } from 'react';
import { RotateCcw, X } from 'lucide-react';

/**
 * HR re-opens a submitted form: reason (required, kept in the audit log), an optional new
 * deadline when the phase deadline has passed and, for appraisals, the stage to go back to.
 */
export const ReopenDialog: React.FC<{
  title: string;
  stages?: { value: string; label: string }[];
  showDeadline?: boolean;
  onCancel: () => void;
  onConfirm: (data: { reason: string; extendUntil?: string; stage?: string }) => Promise<void>;
}> = ({ title, stages, showDeadline = true, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [extendUntil, setExtendUntil] = useState('');
  const [stage, setStage] = useState(stages?.[0]?.value || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          setBusy(true);
          setError(null);
          try {
            await onConfirm({ reason: reason.trim(), extendUntil: extendUntil || undefined, stage: stage || undefined });
          } catch (err: any) {
            setError(err?.message || 'Something went wrong.');
            setBusy(false);
          }
        }}
        className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-3 text-xs"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-amber-600" /> {title}
          </h3>
          <button type="button" onClick={onCancel} aria-label="Close" className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        {stages && stages.length > 0 && (
          <label className="block">
            <span className="font-semibold text-slate-700">Re-open at</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 bg-white">
              {stages.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="font-semibold text-slate-700">Reason (recorded in the audit log) *</span>
          <textarea required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        {showDeadline && (
          <label className="block">
            <span className="font-semibold text-slate-700">New deadline (if the original one has passed)</span>
            <input type="date" min={today} value={extendUntil} onChange={(e) => setExtendUntil(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
        )}
        {error && <p role="alert" className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
            Cancel
          </button>
          <button type="submit" disabled={busy || !reason.trim()} className="px-4 py-2 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 cursor-pointer">
            {busy ? 'Re-opening...' : 'Re-open'}
          </button>
        </div>
      </form>
    </div>
  );
};
