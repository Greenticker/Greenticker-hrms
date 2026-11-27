import React from 'react';
import { X } from 'lucide-react';
import { apiErrorMessages } from '../../utils/access';
import { API_BASE, ApiError, getAuthToken } from '../../services/api';

/** Small shared building blocks for the module pages. */

export const inputCls =
  'w-full min-h-11 px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:bg-slate-100 disabled:border-slate-200';
export const btn = (tone: string) =>
  `inline-flex items-center justify-center gap-2 h-8 px-4 rounded-lg font-semibold text-xs cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${tone}`;
export const PRIMARY = 'bg-primary text-white hover:bg-primary-hover active:bg-primary-active';
export const SECONDARY = 'bg-primary-subtle text-primary hover:bg-primary-light';
export const GOOD = 'bg-emerald-600 text-white hover:bg-emerald-700';
export const BAD = 'bg-rose-600 text-white hover:bg-rose-700';
export const card = 'bg-white border border-slate-200 rounded-xl p-6 space-y-4';

export const fmtMoney = (n: number | undefined | null) =>
  (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (s?: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '—');

const TONES: Record<string, string> = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-sky-100 text-sky-800',
  grey: 'bg-slate-100 text-slate-700',
};
const STATUS_TONE: Record<string, string> = {
  APPROVED: 'green', ACTIVE: 'green', PAID: 'green', POSTED: 'green', PUBLISHED: 'green', VERIFIED: 'green', RESOLVED: 'green', CLOSED: 'grey',
  ACCEPTED: 'green', IN_STOCK: 'green', SETTLED: 'green', RELEASED: 'green', OK: 'green',
  PENDING: 'amber', PENDING_MANAGER: 'amber', PENDING_FINANCE: 'amber', PENDING_APPROVAL: 'amber', PENDING_VERIFICATION: 'amber', DRAFT: 'amber',
  PENDING_ISSUE: 'amber', OPEN: 'amber', IN_PROGRESS: 'blue', REOPENED: 'amber', INTIMATED: 'amber', UNDER_REVIEW: 'blue', PREPARED: 'amber',
  PAYMENT_PREPARED: 'blue', PAYROLL_QUEUED: 'blue', ALLOCATED: 'blue', ENDING: 'amber', PENDING_L2: 'amber',
  REJECTED: 'red', CANCELLED: 'grey', ARCHIVED: 'grey', REVERSED: 'grey', ENDED: 'grey', WRITTEN_OFF: 'grey', DISPOSED: 'grey', DISPUTED: 'red',
  REPORTED_LOST: 'red', REPORTED_DAMAGED: 'red', DAMAGED: 'red', CLOSED_PERIOD: 'grey',
};
export const Badge: React.FC<{ s?: string | null; tone?: string }> = ({ s, tone }) =>
  s ? (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap ${TONES[tone || STATUS_TONE[s] || 'grey']}`}>
      {s.replace(/_/g, ' ')}
    </span>
  ) : null;

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className={`bg-white rounded-2xl ${wide ? 'max-w-4xl' : 'max-w-lg'} w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto`}>
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

export type MsgState = { ok: boolean; text: string[] } | null;
export const okMsg = (t: string): MsgState => ({ ok: true, text: [t] });
export const errMsg = (e: unknown): MsgState => ({ ok: false, text: apiErrorMessages(e) });

export const Msg: React.FC<{ msg: MsgState }> = ({ msg }) =>
  msg && msg.text.length ? (
    <div
      role={msg.ok ? 'status' : 'alert'}
      className={`p-4 rounded-lg text-xs border ${msg.ok ? 'bg-green-100 border-green-200 text-green-800' : 'bg-red-100 border-red-200 text-red-800'}`}
    >
      {msg.text.length === 1 ? msg.text[0] : <ul className="list-disc pl-4">{msg.text.map((t) => <li key={t}>{t}</li>)}</ul>}
    </div>
  ) : null;

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={btn(value === t.id ? PRIMARY : SECONDARY)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export const PageHeader: React.FC<{ title: string; subtitle?: string; children?: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-xl font-bold text-navy">{title}</h1>
      {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
    </div>
    {children}
  </div>
);

export interface Col<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  right?: boolean;
}
export function Table<T extends Record<string, any>>({ cols, rows, empty, rowKey }: { cols: Col<T>[]; rows: T[]; empty?: string; rowKey?: (r: T, i: number) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 font-medium border-b border-slate-200">
            {cols.map((c) => (
              <th key={c.key} className={`py-2 px-2 ${c.right ? 'text-right' : ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : r._id || i} className="border-b border-slate-100 align-top">
              {cols.map((c) => (
                <td key={c.key} className={`py-2 px-2 ${c.right ? 'text-right font-mono' : ''}`}>{c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={cols.length} className="py-4 px-2 text-slate-500">{empty || 'Nothing here yet.'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Downloads a file from the API with the signed-in user's token. */
export async function downloadApiFile(path: string, fallbackName: string): Promise<void> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'Download failed.', res.status, data);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Opens a protected file (bill, proof, attachment) in a new tab using the user's token. */
export async function openApiFile(path: string): Promise<void> {
  const tab = window.open('', '_blank');
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${getAuthToken() || ''}` } });
  if (!res.ok) {
    tab?.close();
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'Could not open the file.', res.status, data);
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.location.assign(url);
}

/** Saves rows as a CSV file in the browser. */
export function saveCsv(name: string, columns: string[], rows: Record<string, any>[]) {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
