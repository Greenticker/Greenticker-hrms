import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Gavel, Save, Send, ThumbsUp, Undo2 } from 'lucide-react';
import { pmsService } from '../../services/pmsService';
import { Appraisal, AppraisalStatus, Pip, PipProgress } from '../../types/pms';
import { ReasonDialog } from './GoalSheetView';

export const APPRAISAL_STATUS: Record<AppraisalStatus, { label: string; cls: string }> = {
  SELF: { label: 'Self appraisal', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  MANAGER: { label: 'With manager', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  REVIEWER: { label: 'With reviewer', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  CALIBRATION: { label: 'Calibration', cls: 'bg-purple-50 text-purple-800 border-purple-200' },
  FINAL: { label: 'Final', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  PUBLISHED: { label: 'Published', cls: 'bg-[#039583]/10 text-[#027a6b] border-[#039583]/30' },
  APPEAL: { label: 'Under appeal', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  CLOSED: { label: 'Closed', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
};

export const AppraisalBadge: React.FC<{ status: AppraisalStatus }> = ({ status }) => {
  const s = APPRAISAL_STATUS[status];
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase whitespace-nowrap ${s.cls}`}>{s.label}</span>;
};

export const RATING_LABEL: Record<number, string> = { 1: 'Poor', 2: 'Below expectations', 3: 'Meets expectations', 4: 'Exceeds expectations', 5: 'Outstanding' };

const STEPS: AppraisalStatus[] = ['SELF', 'MANAGER', 'REVIEWER', 'CALIBRATION', 'FINAL', 'PUBLISHED', 'CLOSED'];

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const n2 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));

const RatingPicker: React.FC<{ value?: number; onChange?: (v: number) => void; label: string }> = ({ value, onChange, label }) => (
  <div className="flex gap-1" role="radiogroup" aria-label={label}>
    {[1, 2, 3, 4, 5].map((v) => (
      <button
        key={v}
        type="button"
        role="radio"
        aria-checked={value === v}
        disabled={!onChange}
        onClick={() => onChange?.(v)}
        title={RATING_LABEL[v]}
        className={`w-8 h-8 rounded-lg text-xs font-bold border transition ${
          value === v ? 'bg-[#023b77] border-[#023b77] text-white' : 'border-slate-200 text-slate-500'
        } ${onChange ? 'hover:border-[#023b77] cursor-pointer' : 'cursor-default'}`}
      >
        {v}
      </button>
    ))}
  </div>
);

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode; actions?: React.ReactNode }> = ({ title, hint, children, actions }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-xs">
    <div className="px-5 py-3 border-b border-slate-100">
      <h4 className="text-sm font-bold text-slate-900">{title}</h4>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
    <div className="p-5 space-y-4">{children}</div>
    {actions && <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60">{actions}</div>}
  </div>
);

const btn = {
  ghost: 'flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-40',
  primary: 'flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#039583] text-white hover:bg-[#027a6b] cursor-pointer disabled:opacity-40',
  dark: 'flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#023b77] text-white hover:bg-[#012a52] cursor-pointer disabled:opacity-40',
  warn: 'flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 cursor-pointer',
};

// ---------------------------------------------------------------- rating change dialog

const RatingDialog: React.FC<{
  title: string;
  base: number;
  current?: number;
  confirmLabel: string;
  reasonRequiredOnSame?: boolean;
  onCancel: () => void;
  onConfirm: (rating: number, reason: string) => Promise<void>;
}> = ({ title, base, current, confirmLabel, reasonRequiredOnSame, onCancel, onConfirm }) => {
  const [rating, setRating] = useState(current ?? base);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = rating !== base;
  const needReason = changed || !!reasonRequiredOnSame;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onConfirm(rating, reason.trim());
          } catch (err: any) {
            setError(err?.message || 'Something went wrong.');
            setBusy(false);
          }
        }}
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-4"
      >
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <div>
          <p className="text-xs font-semibold text-slate-700 mb-1.5">Rating (can move by at most 1 point from {base})</p>
          <div className="flex gap-1.5">
            {[base - 1, base, base + 1].filter((v) => v >= 1 && v <= 5).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setRating(v)}
                className={`flex-1 py-2 rounded-lg border text-xs font-bold cursor-pointer ${rating === v ? 'bg-[#023b77] border-[#023b77] text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {v} <span className="block text-[9px] font-normal">{RATING_LABEL[v]}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="rating-reason" className="block text-xs font-semibold text-slate-700">Reason {needReason && '*'}</label>
          <textarea id="rating-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
        </div>
        {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
          <button type="submit" disabled={busy || (needReason && !reason.trim())} className="px-4 py-2 text-xs font-bold text-white bg-[#023b77] rounded-lg cursor-pointer disabled:opacity-50">
            {busy ? 'Saving...' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

// ------------------------------------------------------------------- PIP card

const PROGRESS_LABEL: Record<PipProgress, string> = { ON_TRACK: 'On track', AT_RISK: 'At risk', OFF_TRACK: 'Off track' };

export const PipCard: React.FC<{ pip: Pip; onChange: (p: Pip) => void }> = ({ pip, onChange }) => {
  const [objectives, setObjectives] = useState(pip.objectives.join('\n'));
  const [reviews, setReviews] = useState(pip.reviews);
  const [closing, setClosing] = useState<null | 'SUCCESSFUL' | 'UNSUCCESSFUL' | 'EXTENDED'>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setObjectives(pip.objectives.join('\n'));
    setReviews(pip.reviews);
  }, [pip]);
  const edit = pip.permissions.canEdit;
  return (
    <Section
      title={`Improvement plan (${pip.status === 'ACTIVE' ? 'active' : 'closed'})`}
      hint={`${fmt(pip.startDate)} – ${fmt(pip.endDate)} · manager ${pip.managerName}`}
      actions={
        edit || pip.permissions.canClose ? (
          <>
            {edit && (
              <button
                type="button"
                className={btn.ghost}
                onClick={async () => {
                  setError(null);
                  try {
                    onChange((await pmsService.updatePip(pip._id, { objectives: objectives.split('\n'), reviews: reviews.map((r) => ({ day: r.day, notes: r.notes, progress: r.progress })) })).pip);
                  } catch (err: any) {
                    setError(err?.message || 'Could not save.');
                  }
                }}
              >
                <Save className="w-3.5 h-3.5" /> Save plan
              </button>
            )}
            {pip.permissions.canClose && (
              <>
                <button type="button" className={btn.ghost} onClick={() => setClosing('EXTENDED')}>Extend 30 days</button>
                <button type="button" className={btn.warn} onClick={() => setClosing('UNSUCCESSFUL')}>Close: unsuccessful</button>
                <button type="button" className={btn.primary} onClick={() => setClosing('SUCCESSFUL')}>Close: successful</button>
              </>
            )}
          </>
        ) : undefined
      }
    >
      <div>
        <p className="text-xs font-semibold text-slate-700 mb-1">Objectives {edit && <span className="font-normal text-slate-400">(one per line)</span>}</p>
        {edit ? (
          <textarea rows={4} value={objectives} onChange={(e) => setObjectives(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" aria-label="Objectives" />
        ) : pip.objectives.length ? (
          <ul className="list-disc pl-5 text-xs text-slate-700 space-y-0.5">{pip.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
        ) : (
          <p className="text-xs text-slate-400">Objectives not set yet.</p>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {reviews.map((r, i) => (
          <div key={r.day} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-bold text-slate-800">Day {r.day} review <span className="font-normal text-slate-500">· {fmt(r.date)}</span></p>
            {edit ? (
              <>
                <select
                  aria-label={`Day ${r.day} progress`}
                  value={r.progress || ''}
                  onChange={(e) => setReviews((rs) => rs.map((x, j) => (j === i ? { ...x, progress: (e.target.value || null) as PipProgress | null } : x)))}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs bg-white"
                >
                  <option value="">Not reviewed</option>
                  {Object.entries(PROGRESS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <textarea
                  rows={3}
                  aria-label={`Day ${r.day} notes`}
                  value={r.notes}
                  onChange={(e) => setReviews((rs) => rs.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </>
            ) : (
              <>
                <p className="text-[11px] font-semibold text-slate-600">{r.progress ? PROGRESS_LABEL[r.progress] : 'Not reviewed'}</p>
                {r.notes && <p className="text-xs text-slate-600">{r.notes}</p>}
              </>
            )}
          </div>
        ))}
      </div>
      {pip.outcome && (
        <p className="text-xs text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
          Outcome: <strong>{pip.outcome.result.toLowerCase()}</strong> — {pip.outcome.notes} ({pip.outcome.by}, {fmt(pip.outcome.on)})
        </p>
      )}
      {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
      {closing && (
        <ReasonDialog
          title={closing === 'EXTENDED' ? 'Extend plan by 30 days' : `Close plan: ${closing.toLowerCase()}`}
          label="Notes on the outcome"
          confirmLabel={closing === 'EXTENDED' ? 'Extend' : 'Close plan'}
          required
          danger={closing === 'UNSUCCESSFUL'}
          onCancel={() => setClosing(null)}
          onConfirm={async (notes) => {
            onChange((await pmsService.closePip(pip._id, closing, notes)).pip);
            setClosing(null);
          }}
        />
      )}
    </Section>
  );
};

// ------------------------------------------------------------------- main panel

export const AppraisalPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [ap, setAp] = useState<Appraisal | null | undefined>(undefined);
  const [goalsLocked, setGoalsLocked] = useState(false);
  const [pips, setPips] = useState<Pip[]>([]);
  const [selfForm, setSelfForm] = useState<{ competencyRatings: Record<string, number>; comments: string }>({ competencyRatings: {}, comments: '' });
  const [mgrForm, setMgrForm] = useState<{ competencyRatings: Record<string, number>; kpiOverride: string; kpiOverrideReason: string; comments: string }>({
    competencyRatings: {}, kpiOverride: '', kpiOverrideReason: '', comments: '',
  });
  const [dialog, setDialog] = useState<null | 'sendBack' | 'review' | 'calibrate' | 'appeal' | 'resolve'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (a: Appraisal | null) => {
    setAp(a);
    if (!a) return;
    setSelfForm({ competencyRatings: a.self.competencyRatings || {}, comments: a.self.comments || '' });
    const m = a.manager || {};
    setMgrForm({
      competencyRatings: m.competencyRatings || {},
      kpiOverride: m.kpiOverride == null ? '' : String(m.kpiOverride),
      kpiOverrideReason: m.kpiOverrideReason || '',
      comments: m.comments || '',
    });
  };

  useEffect(() => {
    pmsService
      .getAppraisal(employeeId)
      .then((r) => {
        setGoalsLocked(!!r.goalsLocked);
        apply(r.appraisal);
      })
      .catch((err) => setError(err?.message || 'Could not load the appraisal.'));
    pmsService.getPips(employeeId).then((r) => setPips(r.pips)).catch(() => setPips([]));
  }, [employeeId]);

  const run = async (fn: () => Promise<{ appraisal: Appraisal }>) => {
    setBusy(true);
    setError(null);
    try {
      apply((await fn()).appraisal);
      return true;
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (ap === undefined && !error) return <div className="py-10 text-center text-xs text-slate-400">Loading appraisal...</div>;

  if (!ap) {
    return (
      <div className="space-y-3">
        {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
        <div className="bg-white p-10 rounded-2xl border border-slate-200 text-center space-y-3">
          <ClipboardCheck className="w-8 h-8 text-[#039583] mx-auto" />
          <p className="text-sm font-semibold text-slate-800">Year-end appraisal not started</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {goalsLocked ? 'The employee starts the appraisal with their self appraisal.' : 'The appraisal opens once the goal sheet is approved and locked.'}
          </p>
          {goalsLocked && (
            <button type="button" onClick={() => run(async () => ({ appraisal: (await pmsService.getAppraisal(employeeId, true)).appraisal! }))} className="px-5 py-2.5 text-xs font-bold text-white bg-[#039583] rounded-xl cursor-pointer">
              Start my self appraisal
            </button>
          )}
        </div>
      </div>
    );
  }

  const p = ap.permissions;
  const sc = ap.scores;
  const stepIndex = STEPS.indexOf(ap.status === 'APPEAL' ? 'PUBLISHED' : ap.status);
  const kpiOverrideNum = mgrForm.kpiOverride.trim() === '' ? null : Number(mgrForm.kpiOverride);
  const autoAcceptOn = ap.publishedOn ? new Date(new Date(ap.publishedOn).getTime() + ap.autoAcceptDays * 86400000) : null;
  const allRated = (r: Record<string, number>) => ap.competencies.every((c) => r[c._id]);

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">Year-end appraisal</h3>
            <AppraisalBadge status={ap.status} />
          </div>
          <p className="text-[11px] text-slate-500">Manager: {ap.managerName} · Reviewer: {ap.reviewerName || 'none'}</p>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <div className={`h-0.5 min-w-4 flex-1 ${i <= stepIndex ? 'bg-[#039583]' : 'bg-slate-200'}`} />}
              <span className={`text-[10px] font-semibold whitespace-nowrap px-2 py-1 rounded-full ${i < stepIndex ? 'bg-[#039583]/10 text-[#027a6b]' : i === stepIndex ? 'bg-[#023b77] text-white' : 'text-slate-400'}`}>
                {APPRAISAL_STATUS[s].label}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}

      {/* Scores */}
      {sc && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            ['KPI', sc.kpiScore, `${sc.weights.kpi}%`, sc.kpiScoreSystem != null && sc.kpiScore !== sc.kpiScoreSystem ? `calculated ${n2(sc.kpiScoreSystem)}` : null],
            ['Competency', sc.competencyScore, `${sc.weights.competency}%`, null],
            ['360°', sc.score360, `${sc.weights.feedback360}%`, sc.score360 == null ? 'not counted' : null],
            ['Final score', sc.finalScore, null, null],
          ].map(([label, value, weight, note]) => (
            <div key={label as string} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-[11px] font-semibold text-slate-500">{label as string} {weight && <span className="text-slate-400">· {weight as string}</span>}</p>
              <p className="text-2xl font-black text-slate-900 mt-1 font-mono">{n2(value as number | null)}</p>
              {note && <p className="text-[10px] text-slate-400">{note as string}</p>}
            </div>
          ))}
          <div className="bg-[#023b77] text-white rounded-xl p-4 col-span-2 lg:col-span-1">
            <p className="text-[11px] font-semibold text-slate-300">Rating</p>
            <p className="text-3xl font-black mt-0.5">{sc.finalRating ?? '—'}</p>
            <p className="text-[10px] text-slate-300">{sc.finalRating ? RATING_LABEL[sc.finalRating] : 'not yet calculated'}</p>
            {sc.computedRating != null && (sc.proposedRating !== sc.computedRating || sc.calibratedRating !== sc.proposedRating) && (
              <p className="text-[10px] text-amber-200 mt-1">
                calculated {sc.computedRating} → reviewer {sc.proposedRating} → calibrated {sc.calibratedRating}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Published: accept / appeal */}
      {ap.status === 'PUBLISHED' && p.canAccept && (
        <div className="p-4 rounded-2xl bg-[#039583]/10 border border-[#039583]/30 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <p className="text-xs text-slate-800">
            Your rating has been published. Accept it, or appeal to HR if you disagree.
            {autoAcceptOn && <> It is accepted automatically on <strong>{fmt(autoAcceptOn.toISOString())}</strong>.</>}
          </p>
          <div className="flex gap-2 shrink-0">
            <button type="button" className={btn.warn} onClick={() => setDialog('appeal')}>
              <Gavel className="w-3.5 h-3.5" /> Appeal
            </button>
            <button type="button" disabled={busy} className={btn.primary} onClick={() => run(() => pmsService.acceptRating(ap._id))}>
              <ThumbsUp className="w-3.5 h-3.5" /> Accept rating
            </button>
          </div>
        </div>
      )}
      {ap.appeal?.reason && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-1">
          <p className="font-bold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Appeal: “{ap.appeal.reason}”</p>
          {ap.appeal.resolution && (
            <p>Outcome ({ap.appeal.resolvedBy}, {fmt(ap.appeal.resolvedOn)}): {ap.appeal.resolution}{ap.appeal.resolvedRating ? ` — rating changed to ${ap.appeal.resolvedRating}` : ' — rating unchanged'}</p>
          )}
          {p.canResolveAppeal && (
            <div className="pt-2">
              <button type="button" className={btn.dark} onClick={() => setDialog('resolve')}>Resolve appeal</button>
            </div>
          )}
        </div>
      )}
      {ap.acceptance && <p className="text-[11px] text-slate-500">Rating {ap.acceptance.auto ? 'accepted automatically' : 'accepted'} on {fmt(ap.acceptance.on)}.</p>}

      {/* Self appraisal */}
      <Section
        title="Self appraisal"
        hint="The employee rates each competency from 1 (poor) to 5 (outstanding) and comments on the year."
        actions={
          p.canEditSelf ? (
            <>
              <button type="button" disabled={busy} className={btn.ghost} onClick={() => run(() => pmsService.saveSelf(ap._id, selfForm))}>
                <Save className="w-3.5 h-3.5" /> Save
              </button>
              <button
                type="button"
                disabled={busy || !allRated(selfForm.competencyRatings) || !selfForm.comments.trim()}
                className={btn.primary}
                onClick={async () => (await run(() => pmsService.saveSelf(ap._id, selfForm))) && run(() => pmsService.submitSelf(ap._id))}
              >
                <Send className="w-3.5 h-3.5" /> Submit to manager
              </button>
            </>
          ) : undefined
        }
      >
        <div className="space-y-2">
          {ap.competencies.map((c) => (
            <div key={c._id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800">{c.name}</span>
              <RatingPicker
                label={`Self rating: ${c.name}`}
                value={selfForm.competencyRatings[c._id]}
                onChange={p.canEditSelf ? (v) => setSelfForm((f) => ({ ...f, competencyRatings: { ...f.competencyRatings, [c._id]: v } })) : undefined}
              />
            </div>
          ))}
        </div>
        {p.canEditSelf ? (
          <textarea rows={4} aria-label="Self appraisal comments" value={selfForm.comments} onChange={(e) => setSelfForm((f) => ({ ...f, comments: e.target.value }))} placeholder="Achievements, challenges, what you learned..." className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
        ) : (
          <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{ap.self.comments || <span className="text-slate-400">Not submitted yet.</span>}</p>
        )}
      </Section>

      {/* Manager appraisal */}
      {(ap.manager || p.canEditManager) && ap.status !== 'SELF' && (
        <Section
          title="Manager appraisal"
          hint="The KPI score is calculated from the goal sheet. The manager rates competencies and may move the KPI score by up to 1 point with a reason."
          actions={
            p.canEditManager || p.canSendBack ? (
              <>
                {p.canSendBack && ap.status === 'MANAGER' && (
                  <button type="button" className={btn.warn} onClick={() => setDialog('sendBack')}>
                    <Undo2 className="w-3.5 h-3.5" /> Send back to employee
                  </button>
                )}
                {p.canEditManager && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      className={btn.ghost}
                      onClick={() => run(() => pmsService.saveManager(ap._id, { ...mgrForm, kpiOverride: kpiOverrideNum }))}
                    >
                      <Save className="w-3.5 h-3.5" /> Save
                    </button>
                    <button
                      type="button"
                      disabled={busy || !allRated(mgrForm.competencyRatings) || !mgrForm.comments.trim()}
                      className={btn.primary}
                      onClick={async () =>
                        (await run(() => pmsService.saveManager(ap._id, { ...mgrForm, kpiOverride: kpiOverrideNum }))) && run(() => pmsService.submitManager(ap._id))
                      }
                    >
                      <Send className="w-3.5 h-3.5" /> Submit {ap.reviewerName ? 'to reviewer' : 'for calibration'}
                    </button>
                  </>
                )}
              </>
            ) : undefined
          }
        >
          {sc && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
              <div>
                <p className="text-xs font-semibold text-slate-700">Calculated KPI score</p>
                <p className="text-lg font-black font-mono text-slate-900">{n2(sc.kpiScoreSystem)}</p>
                {sc.kpiScoreSystem == null && <p className="text-[11px] text-amber-700">Record all KPI actuals on the goal sheet first.</p>}
              </div>
              <div>
                <label htmlFor="kpi-override" className="text-xs font-semibold text-slate-700">Adjusted KPI score (optional)</label>
                {p.canEditManager ? (
                  <input
                    id="kpi-override"
                    type="number"
                    step="0.01"
                    min={sc.kpiScoreSystem != null ? Math.max(1, sc.kpiScoreSystem - 1) : 1}
                    max={sc.kpiScoreSystem != null ? Math.min(5, sc.kpiScoreSystem + 1) : 5}
                    disabled={sc.kpiScoreSystem == null}
                    value={mgrForm.kpiOverride}
                    onChange={(e) => setMgrForm((f) => ({ ...f, kpiOverride: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                  />
                ) : (
                  <p className="text-lg font-black font-mono text-slate-900">{ap.manager?.kpiOverride == null ? '—' : n2(ap.manager.kpiOverride)}</p>
                )}
              </div>
              <div>
                <label htmlFor="kpi-reason" className="text-xs font-semibold text-slate-700">Reason for adjusting {kpiOverrideNum != null && '*'}</label>
                {p.canEditManager ? (
                  <input id="kpi-reason" value={mgrForm.kpiOverrideReason} onChange={(e) => setMgrForm((f) => ({ ...f, kpiOverrideReason: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                ) : (
                  <p className="text-xs text-slate-600 mt-1">{ap.manager?.kpiOverrideReason || '—'}</p>
                )}
              </div>
            </div>
          )}
          <div className="space-y-2">
            {ap.competencies.map((c) => (
              <div key={c._id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800">
                  {c.name}
                  {selfForm.competencyRatings[c._id] && <span className="ml-2 font-normal text-slate-400">self: {selfForm.competencyRatings[c._id]}</span>}
                </span>
                <RatingPicker
                  label={`Manager rating: ${c.name}`}
                  value={mgrForm.competencyRatings[c._id]}
                  onChange={p.canEditManager ? (v) => setMgrForm((f) => ({ ...f, competencyRatings: { ...f.competencyRatings, [c._id]: v } })) : undefined}
                />
              </div>
            ))}
          </div>
          {p.canEditManager ? (
            <textarea rows={4} aria-label="Manager comments" value={mgrForm.comments} onChange={(e) => setMgrForm((f) => ({ ...f, comments: e.target.value }))} placeholder="Overall assessment, strengths, development areas..." className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
          ) : (
            <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{ap.manager?.comments || <span className="text-slate-400">Not submitted yet.</span>}</p>
          )}
        </Section>
      )}

      {/* Reviewer */}
      {(p.canReview || ap.reviewer?.reason || ap.reviewer?.adjustedRating) && (
        <Section
          title="Reviewer approval"
          hint="The manager's manager agrees with the rating, or changes it by up to 1 point with a reason."
          actions={
            p.canReview ? (
              <>
                <button type="button" className={btn.warn} onClick={() => setDialog('sendBack')}>
                  <Undo2 className="w-3.5 h-3.5" /> Send back to manager
                </button>
                <button type="button" className={btn.dark} onClick={() => setDialog('review')}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                </button>
              </>
            ) : undefined
          }
        >
          <p className="text-xs text-slate-700">
            {ap.reviewer?.adjustedRating
              ? `Rating changed to ${ap.reviewer.adjustedRating}: ${ap.reviewer.reason}`
              : ap.reviewer?.reason
              ? `Approved: ${ap.reviewer.reason}`
              : sc?.computedRating
              ? `Calculated rating: ${sc.computedRating} (${RATING_LABEL[sc.computedRating]})`
              : 'Waiting for the reviewer.'}
          </p>
        </Section>
      )}

      {/* Calibration (HR) */}
      {(p.canCalibrate || ap.calibration?.rating) && sc && (
        <Section
          title="Calibration"
          hint="HR may move the rating by up to 1 point, with a reason."
          actions={p.canCalibrate ? <button type="button" className={btn.dark} onClick={() => setDialog('calibrate')}>Calibrate rating</button> : undefined}
        >
          <p className="text-xs text-slate-700">
            {ap.calibration?.rating ? `Calibrated to ${ap.calibration.rating} by ${ap.calibration.by}: ${ap.calibration.reason}` : `No change from the reviewed rating (${sc.proposedRating}).`}
          </p>
        </Section>
      )}

      {pips.map((pip) => (
        <PipCard key={pip._id} pip={pip} onChange={(u) => setPips((ps) => ps.map((x) => (x._id === u._id ? u : x)))} />
      ))}

      {/* Dialogs */}
      {dialog === 'sendBack' && (
        <ReasonDialog
          title="Send appraisal back"
          label={ap.status === 'MANAGER' ? 'What should the employee change?' : 'What should the manager change?'}
          confirmLabel="Send back"
          required
          onCancel={() => setDialog(null)}
          onConfirm={async (c) => {
            if (await run(() => pmsService.sendBackAppraisal(ap._id, c))) setDialog(null);
          }}
        />
      )}
      {dialog === 'review' && sc?.computedRating && (
        <RatingDialog
          title="Approve appraisal"
          base={sc.computedRating}
          confirmLabel="Approve"
          onCancel={() => setDialog(null)}
          onConfirm={async (rating, reason) => {
            const res = await pmsService.reviewerApprove(ap._id, rating === sc.computedRating ? null : rating, reason);
            apply(res.appraisal);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'calibrate' && sc?.proposedRating && (
        <RatingDialog
          title="Calibrate rating"
          base={sc.proposedRating}
          current={sc.calibratedRating ?? undefined}
          confirmLabel="Save"
          onCancel={() => setDialog(null)}
          onConfirm={async (rating, reason) => {
            apply((await pmsService.calibrate(ap._id, rating, reason)).appraisal);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'resolve' && sc?.calibratedRating && (
        <RatingDialog
          title="Resolve appeal"
          base={sc.calibratedRating}
          confirmLabel="Resolve"
          reasonRequiredOnSame
          onCancel={() => setDialog(null)}
          onConfirm={async (rating, reason) => {
            apply((await pmsService.resolveAppeal(ap._id, rating, reason)).appraisal);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'appeal' && (
        <ReasonDialog
          title="Appeal your rating"
          label="Why do you disagree with the rating?"
          confirmLabel="Send appeal to HR"
          required
          onCancel={() => setDialog(null)}
          onConfirm={async (r) => {
            if (await run(() => pmsService.appealRating(ap._id, r))) setDialog(null);
          }}
        />
      )}
    </div>
  );
};
