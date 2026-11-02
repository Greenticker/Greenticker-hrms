import React, { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { pmsService } from '../../services/pmsService';
import { Assignment360, Group360 } from '../../types/pms';
import { GROUP_LABEL } from './Feedback360Panel';

const SCALE = [
  [1, 'Poor'],
  [2, 'Below'],
  [3, 'Meets'],
  [4, 'Above'],
  [5, 'Outstanding'],
] as const;

type Form = { assignmentId: string; rateeName: string; group: Group360; questions: { _id: string; text: string; competencyName: string }[] };

const FeedbackForm: React.FC<{ form: Form; onDone: () => void; onCancel: () => void }> = ({ form, onDone, onCancel }) => {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answered = form.questions.filter((q) => answers[q._id]).length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <button type="button" onClick={onCancel} className="text-[11px] font-semibold text-[#039583] hover:underline cursor-pointer mb-1">
          ← Back
        </button>
        <h2 className="text-lg font-bold text-slate-900">Feedback for {form.rateeName}</h2>
        <p className="text-xs text-slate-500 mt-1">You are giving feedback as: {GROUP_LABEL[form.group]}</p>
        <p className="mt-3 text-[11px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-[#039583] shrink-0" />
          {form.group === 'MANAGER'
            ? 'Your answers are combined into the report.'
            : 'Your answers are anonymous. Nobody, including HR, can see who gave which answer, and your group is only shown when at least 3 people from it reply.'}{' '}
          You can't change your answers after submitting.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
        {form.questions.map((q, i) => (
          <fieldset key={q._id} className="p-5">
            <legend className="sr-only">{q.text}</legend>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{q.competencyName}</p>
            <p className="text-sm text-slate-900 font-medium mt-0.5">
              {i + 1}. {q.text}
            </p>
            <div className="mt-3 grid grid-cols-5 gap-1.5 max-w-lg">
              {SCALE.map(([v, label]) => (
                <label
                  key={v}
                  className={`flex flex-col items-center gap-0.5 py-2 rounded-lg border cursor-pointer text-xs transition ${
                    answers[q._id] === v ? 'bg-[#023b77] border-[#023b77] text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <input type="radio" name={q._id} value={v} checked={answers[q._id] === v} onChange={() => setAnswers((a) => ({ ...a, [q._id]: v }))} className="sr-only" />
                  <span className="font-bold">{v}</span>
                  <span className="text-[9px] uppercase">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="p-5">
          <label htmlFor="fb-comment" className="block text-xs font-semibold text-slate-700">Comments (optional)</label>
          <textarea id="fb-comment" rows={4} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What should they keep doing? What could they do better?" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
          <p className="text-[10px] text-slate-400 mt-1">Avoid details that would reveal who you are.</p>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-slate-500">
          {answered} of {form.questions.length} answered
        </span>
        <button
          type="button"
          disabled={busy || answered < form.questions.length}
          onClick={async () => {
            if (!window.confirm('Submit your feedback? You will not be able to change it.')) return;
            setBusy(true);
            setError(null);
            try {
              await pmsService.submitFeedback(form.assignmentId, answers, comment);
              onDone();
            } catch (err: any) {
              setError(err?.message || 'Could not submit feedback.');
              setBusy(false);
            }
          }}
          className="px-5 py-2.5 text-xs font-bold text-white bg-[#039583] hover:bg-[#027a6b] rounded-xl cursor-pointer disabled:opacity-40"
        >
          {busy ? 'Submitting...' : 'Submit feedback'}
        </button>
      </div>
    </div>
  );
};

export const GiveFeedback: React.FC<{ onCountChange: () => void }> = ({ onCountChange }) => {
  const [data, setData] = useState<{ assignments: Assignment360[]; closed: boolean; due?: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => pmsService.myAssignments().then(setData).catch((err) => setError(err?.message || 'Could not load feedback requests.'));
  useEffect(() => {
    load();
  }, []);

  if (form) {
    return (
      <FeedbackForm
        form={form}
        onCancel={() => setForm(null)}
        onDone={() => {
          setForm(null);
          load();
          onCountChange();
        }}
      />
    );
  }
  if (error) return <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>;
  if (!data) return <div className="py-10 text-center text-xs text-slate-400">Loading feedback requests...</div>;

  const pending = data.assignments.filter((a) => a.status === 'PENDING').length;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        {data.closed
          ? '360° feedback for this cycle is closed.'
          : `${pending} request${pending === 1 ? '' : 's'} waiting${data.due ? ` · due ${new Date(`${data.due}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}`}
      </p>
      {data.assignments.length === 0 && (
        <div className="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">Nobody has asked you for feedback yet.</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.assignments.map((a) => (
          <div key={a._id} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">{a.rateeName}</p>
              <p className="text-[11px] text-slate-500 truncate">{[a.rateeDesignation, a.rateeDepartment].filter(Boolean).join(' · ')}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">As: {GROUP_LABEL[a.group]}</p>
            </div>
            {a.status === 'SUBMITTED' ? (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Given
              </span>
            ) : data.closed ? (
              <span className="text-xs text-slate-400">Closed</span>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  try {
                    setForm(await pmsService.getFeedbackForm(a._id));
                  } catch (err: any) {
                    setError(err?.message || 'Could not open the form.');
                  }
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-[#023b77] hover:bg-[#012a52] rounded-lg cursor-pointer shrink-0"
              >
                Give feedback
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
