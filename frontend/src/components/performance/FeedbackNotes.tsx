import React, { useEffect, useMemo, useState } from 'react';
import { Lightbulb, Send, Sparkles } from 'lucide-react';
import { pmsService } from '../../services/pmsService';
import { FeedbackNote, PersonRow } from '../../types/pms';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const NoteItem: React.FC<{ note: FeedbackNote; direction: 'from' | 'to' }> = ({ note, direction }) => (
  <li className="p-3 rounded-xl border border-slate-200 bg-white">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
        {note.kind === 'PRAISE' ? <Sparkles className="w-3.5 h-3.5 text-amber-500" /> : <Lightbulb className="w-3.5 h-3.5 text-[#039583]" />}
        {direction === 'from' ? `From ${note.fromName}` : `To ${note.toName}`}
      </span>
      <span className="text-[10px] text-slate-400">{fmt(note.createdOn)}</span>
    </div>
    <p className="text-xs text-slate-700 mt-1.5 whitespace-pre-wrap">{note.text}</p>
  </li>
);

/** F11 continuous feedback: anyone can send a short note to a colleague. */
export const NoteComposer: React.FC<{ onSent?: () => void }> = ({ onSent }) => {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<FeedbackNote['kind']>('PRAISE');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    pmsService.getPeople().then((r) => setPeople(r.people)).catch(() => setPeople([]));
  }, []);
  const matches = useMemo(
    () => (q.trim() ? people.filter((p) => `${p.name} ${p.department || ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []),
    [q, people]
  );
  const chosen = people.find((p) => p.employeeId === to);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!to || !text.trim()) return;
        setBusy(true);
        setMsg(null);
        try {
          await pmsService.sendNote(to, kind, text.trim());
          setMsg({ ok: true, text: `Note sent to ${chosen?.name}.` });
          setText('');
          setTo('');
          setQ('');
          onSent?.();
        } catch (err: any) {
          setMsg({ ok: false, text: err?.message || 'Could not send the note.' });
        } finally {
          setBusy(false);
        }
      }}
      className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3"
    >
      <div>
        <h4 className="text-sm font-bold text-slate-900">Send a quick note</h4>
        <p className="text-[11px] text-slate-500">Recognise good work or share a suggestion. The colleague and their manager can see it, with your name.</p>
      </div>
      <div className="relative">
        {chosen ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-xs">
            <span><strong>{chosen.name}</strong> <span className="text-slate-500">{chosen.department}</span></span>
            <button type="button" onClick={() => setTo('')} className="text-[11px] text-[#039583] font-semibold cursor-pointer">Change</button>
          </div>
        ) : (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a colleague..." aria-label="Find a colleague" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {matches.map((p) => (
                  <li key={p.employeeId}>
                    <button type="button" onClick={() => setTo(p.employeeId)} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                      <strong>{p.name}</strong> <span className="text-slate-500">{[p.designation, p.department].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="flex gap-1.5">
        {([
          ['PRAISE', 'Praise', Sparkles],
          ['SUGGESTION', 'Suggestion', Lightbulb],
        ] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${kind === k ? 'bg-[#023b77] text-white border-[#023b77]' : 'border-slate-200 text-slate-600'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      <textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-label="Note" placeholder="What did they do well, or what could help?" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-400">{text.length}/500</span>
        <button type="submit" disabled={busy || !to || !text.trim()} className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-[#039583] text-white cursor-pointer disabled:opacity-40">
          <Send className="w-3.5 h-3.5" /> Send note
        </button>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</p>}
    </form>
  );
};

/** Notes an employee has received (and, for yourself, notes you've sent). */
export const NotesList: React.FC<{ employeeId?: string; refreshKey?: number }> = ({ employeeId, refreshKey }) => {
  const [data, setData] = useState<{ received: FeedbackNote[]; sent: FeedbackNote[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    pmsService.getNotes(employeeId).then(setData).catch((err) => setError(err?.message || 'Could not load notes.'));
  }, [employeeId, refreshKey]);
  if (error) return <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>;
  if (!data) return <div className="py-6 text-center text-xs text-slate-400">Loading notes...</div>;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Received ({data.received.length})</p>
        <ul className="space-y-2">
          {data.received.map((n) => <NoteItem key={n._id} note={n} direction="from" />)}
          {!data.received.length && <li className="text-xs text-slate-400">No notes yet.</li>}
        </ul>
      </div>
      {!employeeId && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Sent ({data.sent.length})</p>
          <ul className="space-y-2">
            {data.sent.map((n) => <NoteItem key={n._id} note={n} direction="to" />)}
            {!data.sent.length && <li className="text-xs text-slate-400">You haven't sent any notes.</li>}
          </ul>
        </div>
      )}
    </div>
  );
};
