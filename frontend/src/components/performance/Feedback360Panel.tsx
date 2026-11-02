import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, EyeOff, Lock, Plus, Search, Send, Trash2, Undo2, Users, X } from 'lucide-react';
import { pmsService } from '../../services/pmsService';
import { Group360, Nomination360View, RaterRow, Report360 } from '../../types/pms';
import { ReasonDialog } from './GoalSheetView';

export const GROUP_LABEL: Record<Group360, string> = {
  MANAGER: 'Manager',
  PEER: 'Peers',
  TEAM: 'Team members',
  OTHER_DEPT: 'Other departments',
};

const GROUP_CLS: Record<Group360, string> = {
  MANAGER: 'bg-[#023b77]/10 text-[#023b77]',
  PEER: 'bg-emerald-50 text-emerald-800',
  TEAM: 'bg-amber-50 text-amber-800',
  OTHER_DEPT: 'bg-slate-100 text-slate-700',
};

const NOM_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  SUBMITTED: { label: 'With manager', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  APPROVED: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
};

const fmt = (iso?: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const GroupChip: React.FC<{ group: Group360 }> = ({ group }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase whitespace-nowrap ${GROUP_CLS[group]}`}>{GROUP_LABEL[group]}</span>
);

// ------------------------------------------------------------ rater picker

const RaterPicker: React.FC<{
  employeeId: string;
  selected: string[];
  onDone: (ids: string[]) => void;
  onClose: () => void;
}> = ({ employeeId, selected, onDone, onClose }) => {
  const [candidates, setCandidates] = useState<RaterRow[]>([]);
  const [picked, setPicked] = useState<string[]>(selected);
  const [q, setQ] = useState('');
  useEffect(() => {
    pmsService.getCandidates(employeeId).then((r) => setCandidates(r.candidates));
  }, [employeeId]);
  const shown = candidates.filter((c) => `${c.name} ${c.department || ''} ${c.designation || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Choose people to give feedback</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">The group (peer, team, other department) is set from the org chart.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, department..." className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900" />
          </div>
        </div>
        <div className="overflow-y-auto p-3 space-y-1">
          {shown.map((c) => (
            <label key={c.employeeId} className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer ${picked.includes(c.employeeId) ? 'border-[#039583] bg-[#039583]/5' : 'border-transparent hover:bg-slate-50'}`}>
              <input type="checkbox" checked={picked.includes(c.employeeId)} onChange={() => toggle(c.employeeId)} className="rounded border-slate-300" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-900">{c.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{[c.designation, c.department].filter(Boolean).join(' · ')}</p>
              </div>
              <GroupChip group={c.group} />
            </label>
          ))}
          {shown.length === 0 && <p className="py-8 text-center text-xs text-slate-400">No matching people.</p>}
        </div>
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100">
          <span className="text-xs text-slate-500">{picked.length} selected</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
            <button type="button" onClick={() => onDone(picked)} className="px-4 py-2 text-xs font-bold text-white bg-[#023b77] rounded-lg cursor-pointer">Use these people</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ report

const ScoreBar: React.FC<{ value: number | null }> = ({ value }) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
      {value != null && <div className="h-full bg-[#039583]" style={{ width: `${(value / 5) * 100}%` }} />}
    </div>
    <span className="w-10 text-right font-mono text-xs font-bold text-slate-900">{value == null ? '—' : value.toFixed(2)}</span>
  </div>
);

export const Report360View: React.FC<{ report: Report360 }> = ({ report }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="bg-[#023b77] text-white rounded-2xl p-5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">360° score</p>
        <p className="text-4xl font-black mt-1">{report.score360 == null ? '—' : report.score360.toFixed(2)}</p>
        <p className="text-[11px] text-slate-300 mt-1">out of 5, weighted by group</p>
      </div>
      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">By group</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {report.groups.map((g) => (
            <div key={g.group} className={`rounded-xl border p-3 ${g.counted ? 'border-slate-200' : 'border-dashed border-slate-200 bg-slate-50'}`}>
              <p className="text-[11px] font-semibold text-slate-600">{g.label}</p>
              <p className="text-[10px] text-slate-400">weight {Math.round(g.weight * 100)}%</p>
              {g.counted ? (
                <>
                  <p className="text-xl font-black text-slate-900 mt-1">{g.average?.toFixed(2) ?? '—'}</p>
                  <p className="text-[10px] text-slate-500">{g.responses} {g.responses === 1 ? 'reply' : 'replies'}</p>
                </>
              ) : (
                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <EyeOff className="w-3 h-3" /> {g.group === 'MANAGER' ? 'No reply' : `Fewer than ${report.minPerGroup} replies`}
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-2">Groups with too few replies are hidden to protect anonymity, and their weight is spread over the other groups.</p>
      </div>
    </div>

    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">By competency</p>
      <div className="space-y-2.5">
        {report.competencies.map((c) => (
          <div key={c.competencyId} className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-1 sm:gap-4 items-center">
            <span className="text-xs font-semibold text-slate-800">{c.name}</span>
            <ScoreBar value={c.score} />
          </div>
        ))}
      </div>
    </div>

    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Comments ({report.comments.length})</p>
      {report.comments.length === 0 ? (
        <p className="text-xs text-slate-400">No comments.</p>
      ) : (
        <ul className="space-y-2">
          {report.comments.map((c, i) => (
            <li key={i} className="text-xs text-slate-700 bg-slate-50 rounded-lg px-3 py-2">“{c}”</li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-slate-400 mt-2">Comments are shown in random order with no names or groups.</p>
    </div>
  </div>
);

// ------------------------------------------------------------------- panel

export const Feedback360Panel: React.FC<{ employeeId: string; isOwner: boolean }> = ({ employeeId, isOwner }) => {
  const [view, setView] = useState<Nomination360View | null>(null);
  const [report, setReport] = useState<Report360 | null>(null);
  const [raters, setRaters] = useState<RaterRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(false);
  const [sendBack, setSendBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (v: Nomination360View) => {
    setView(v);
    setRaters(v.nomination.raters);
    setDirty(false);
    if (v.permissions.canSeeReport) pmsService.getReport360(employeeId).then(setReport).catch(() => setReport(null));
  };

  useEffect(() => {
    pmsService.get360(employeeId).then(apply).catch((err) => setError(err?.message || 'Could not load 360° feedback.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const groupCounts = useMemo(() => {
    const c: Record<string, number> = {};
    raters.forEach((r) => (c[r.group] = (c[r.group] || 0) + 1));
    return c;
  }, [raters]);

  const run = async (fn: () => Promise<Nomination360View>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
      return true;
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveFirst = async () => (dirty ? run(() => pmsService.saveNominations(employeeId, raters.map((r) => r.employeeId))) : true);

  if (error && !view) return <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>;
  if (!view) return <div className="py-10 text-center text-xs text-slate-400">Loading 360° feedback...</div>;

  const perms = view.permissions;
  const status = NOM_STATUS[view.nomination.status];
  const thinGroups = (['PEER', 'TEAM', 'OTHER_DEPT'] as Group360[]).filter((g) => (groupCounts[g] || 0) > 0 && (groupCounts[g] || 0) < view.minPerGroup);

  return (
    <div className="space-y-4">
      {view.feedback360.closed && (
        <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 text-xs flex items-center gap-2">
          <Lock className="w-4 h-4" /> 360° feedback is closed{view.feedback360.released ? ' and results have been released.' : '. HR has not released results to employees yet.'}
        </div>
      )}

      {report && <Report360View report={report} />}
      {!report && view.feedback360.closed && isOwner && !view.feedback360.released && (
        <div className="p-6 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200">Your 360° report will appear here once HR releases it.</div>
      )}

      {/* Nominations */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-500" />
            <h4 className="text-sm font-bold text-slate-900">Feedback givers</h4>
            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${status.cls}`}>{status.label}</span>
          </div>
          <span className="text-[11px] text-slate-500">
            {view.nominationDue && <>Nominate by {fmt(view.nominationDue)}</>}
            {view.feedbackDue && <> · Feedback due {fmt(view.feedbackDue)}</>}
          </span>
        </div>

        <div className="p-5 space-y-3">
          {view.manager && (
            <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50">
              <div>
                <p className="text-xs font-semibold text-slate-900">{view.manager.name}</p>
                <p className="text-[11px] text-slate-500">Included automatically</p>
              </div>
              <GroupChip group="MANAGER" />
            </div>
          )}
          {raters.map((r) => (
            <div key={r.employeeId} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-100">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900">{r.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{[r.designation, r.department].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex items-center gap-2">
                <GroupChip group={r.group} />
                {perms.canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setRaters((rs) => rs.filter((x) => x.employeeId !== r.employeeId));
                      setDirty(true);
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                    aria-label={`Remove ${r.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {raters.length === 0 && <p className="text-xs text-slate-400">Nobody nominated yet. Aim for at least {view.minPerGroup} people in each group you choose.</p>}

          {perms.canEdit && thinGroups.length > 0 && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              {thinGroups.map((g) => GROUP_LABEL[g]).join(', ')}: fewer than {view.minPerGroup} people. Results for a group with fewer than {view.minPerGroup} replies are hidden.
            </p>
          )}

          {view.nomination.status === 'APPROVED' && (
            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs text-slate-700">
                <strong>{view.progress.total.submitted}</strong> of {view.progress.total.assigned} have given feedback.
              </p>
              {view.progress.groups && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(Object.keys(view.progress.groups) as Group360[])
                    .filter((g) => view.progress.groups![g].assigned > 0)
                    .map((g) => (
                      <span key={g} className="text-[11px] px-2 py-1 rounded-lg bg-slate-50 border border-slate-200">
                        {GROUP_LABEL[g]}: {view.progress.groups![g].submitted}/{view.progress.groups![g].assigned}
                      </span>
                    ))}
                </div>
              )}
            </div>
          )}

          {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
        </div>

        {(perms.canEdit || perms.canSubmit || perms.canApprove || perms.canSendBack) && (
          <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60">
            {perms.canEdit && (
              <button type="button" onClick={() => setPicker(true)} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Choose people
              </button>
            )}
            {perms.canEdit && dirty && (
              <button type="button" disabled={busy} onClick={saveFirst} className="px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white cursor-pointer">
                Save
              </button>
            )}
            {perms.canSubmit && (
              <button
                type="button"
                disabled={busy || raters.length === 0}
                onClick={async () => (await saveFirst()) && run(() => pmsService.submitNominations(employeeId))}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#039583] text-white hover:bg-[#027a6b] cursor-pointer disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" /> Send to manager
              </button>
            )}
            {perms.canSendBack && (
              <button type="button" disabled={busy} onClick={() => setSendBack(true)} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-amber-300 text-amber-800 bg-amber-50 cursor-pointer">
                <Undo2 className="w-3.5 h-3.5" /> Send back
              </button>
            )}
            {perms.canApprove && (
              <button type="button" disabled={busy} onClick={async () => (await saveFirst()) && run(() => pmsService.approveNominations(employeeId))} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#023b77] text-white hover:bg-[#012a52] cursor-pointer">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve & send requests
              </button>
            )}
          </div>
        )}
      </div>

      {picker && (
        <RaterPicker
          employeeId={employeeId}
          selected={raters.map((r) => r.employeeId)}
          onClose={() => setPicker(false)}
          onDone={async (ids) => {
            setPicker(false);
            await run(() => pmsService.saveNominations(employeeId, ids));
          }}
        />
      )}
      {sendBack && (
        <ReasonDialog
          title="Send nominations back"
          label="What should change?"
          confirmLabel="Send back"
          required
          onCancel={() => setSendBack(false)}
          onConfirm={async (c) => {
            apply(await pmsService.sendBackNominations(employeeId, c));
            setSendBack(false);
          }}
        />
      )}
    </div>
  );
};
