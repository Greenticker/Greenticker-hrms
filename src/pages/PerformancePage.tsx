import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { PerformanceReview } from '../types/modules';
import { Target, Star, Award, TrendingUp, CheckCircle2, User, Sparkles, XCircle, Hourglass } from 'lucide-react';


// A goal counts as "achieved" when the manager rated it 3.0 or higher (out of 5).
// Below 3.0 = not achieved. No manager rating yet = still in progress.
export const ACHIEVED_THRESHOLD = 3;

type GoalStatus = 'ACHIEVED' | 'NOT_ACHIEVED' | 'IN_PROGRESS';

const getGoalStatus = (managerRating?: number): GoalStatus => {
  if (managerRating === undefined || managerRating === null || managerRating === 0) return 'IN_PROGRESS';
  return managerRating >= ACHIEVED_THRESHOLD ? 'ACHIEVED' : 'NOT_ACHIEVED';
};

const GOAL_SEGMENTS: Array<{ key: GoalStatus; label: string; color: string }> = [
  { key: 'ACHIEVED', label: 'Achieved', color: '#10b981' },
  { key: 'IN_PROGRESS', label: 'In Progress', color: '#f59e0b' },
  { key: 'NOT_ACHIEVED', label: 'Not Achieved', color: '#f43f5e' },
];

const polarToCartesian = (cx: number, cy: number, r: number, angle: number) => {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const describeSlice = (cx: number, cy: number, r: number, start: number, end: number) => {
  const a = polarToCartesian(cx, cy, r, end);
  const b = polarToCartesian(cx, cy, r, start);
  const largeArc = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${b.x} ${b.y} A ${r} ${r} 0 ${largeArc} 1 ${a.x} ${a.y} Z`;
};

const GoalsPieChart: React.FC<{ counts: Record<GoalStatus, number> }> = ({ counts }) => {
  const total = counts.ACHIEVED + counts.IN_PROGRESS + counts.NOT_ACHIEVED;
  const size = 180;
  const c = size / 2;
  const r = 80;

  let angle = 0;
  const slices = GOAL_SEGMENTS.filter((seg) => counts[seg.key] > 0).map((seg) => {
    const sweep = (counts[seg.key] / total) * 360;
    const start = angle;
    angle += sweep;
    return { ...seg, start, end: angle, sweep };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-44 h-44 shrink-0" role="img" aria-label="Goals achieved pie chart">
      {total === 0 ? (
        <circle cx={c} cy={c} r={r} fill="#e2e8f0" />
      ) : slices.length === 1 ? (
        <circle cx={c} cy={c} r={r} fill={slices[0].color} />
      ) : (
        slices.map((sl) => (
          <path
            key={sl.key}
            d={describeSlice(c, c, r, sl.start, sl.end)}
            fill={sl.color}
            stroke="#ffffff"
            strokeWidth={2}
          >
            <title>{`${sl.label}: ${counts[sl.key]}`}</title>
          </path>
        ))
      )}
      {/* donut hole with achieved % */}
      <circle cx={c} cy={c} r={48} fill="#ffffff" />
      <text x={c} y={c - 2} textAnchor="middle" className="fill-slate-900" style={{ fontSize: 26, fontWeight: 800 }}>
        {total === 0 ? '—' : `${Math.round((counts.ACHIEVED / total) * 100)}%`}
      </text>
      <text x={c} y={c + 16} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
        ACHIEVED
      </text>
    </svg>
  );
};

export const PerformancePage: React.FC = () => {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReviews = async () => {
      setLoading(true);
      try {
        const res = await modulesService.getPerformanceReviews();
        setReviews(res.reviews);
      } catch (err) {
        console.error('Failed to load reviews', err);
      } finally {
        setLoading(false);
      }
    };
    fetchReviews();
  }, []);

  const goalCounts = reviews
    .flatMap((r) => r.goals)
    .reduce<Record<GoalStatus, number>>(
      (acc, g) => {
        acc[getGoalStatus(g.managerRating)] += 1;
        return acc;
      },
      { ACHIEVED: 0, IN_PROGRESS: 0, NOT_ACHIEVED: 0 }
    );
  const totalGoals = goalCounts.ACHIEVED + goalCounts.IN_PROGRESS + goalCounts.NOT_ACHIEVED;
  const isEmployeeView = user?.role === 'EMPLOYEE';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Performance Reviews, Goals & OKRs
        </h1>
      </div>


      {/* Goals Dashboard */}
      {!loading && reviews.length > 0 && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-slate-500" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {isEmployeeView ? 'My Goals Dashboard' : 'Goals Dashboard — All Visible Employees'}
            </h2>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-8">
            <GoalsPieChart counts={goalCounts} />

            <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Achieved</span>
                </div>
                <p className="text-2xl font-black text-emerald-900 mt-1">{goalCounts.ACHIEVED}</p>
                <p className="text-[11px] text-emerald-700">of {totalGoals} goals</p>
              </div>
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
                <div className="flex items-center gap-2 text-amber-700">
                  <Hourglass className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">In Progress</span>
                </div>
                <p className="text-2xl font-black text-amber-900 mt-1">{goalCounts.IN_PROGRESS}</p>
                <p className="text-[11px] text-amber-700">awaiting manager rating</p>
              </div>
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-100">
                <div className="flex items-center gap-2 text-rose-700">
                  <XCircle className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Not Achieved</span>
                </div>
                <p className="text-2xl font-black text-rose-900 mt-1">{goalCounts.NOT_ACHIEVED}</p>
                <p className="text-[11px] text-rose-700">manager rating below {ACHIEVED_THRESHOLD}/5</p>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-4">
            A goal counts as achieved when the manager rating is {ACHIEVED_THRESHOLD}/5 or higher.
          </p>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading appraisal dossiers...</div>
      ) : reviews.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 text-xs">
          No performance review cycles scheduled for your profile.
        </div>
      ) : (
        reviews.map((rev) => (
          <div key={rev._id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
              <div>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 font-mono">
                  {rev.cycle}
                </span>
                <h2 className="text-lg font-bold text-slate-900 mt-1">
                  Appraisal Record: {rev.employeeName} ({rev.employeeCode})
                </h2>
                <p className="text-xs text-slate-500">{rev.department}</p>
              </div>

              <div className="flex items-center gap-4">
                <div className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold uppercase">
                  {rev.status}
                </div>
              </div>
            </div>

            {/* Goals & OKRs Breakdown */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Key Performance Objectives & Weightage
              </h3>
              <div className="space-y-3">
                {rev.goals.map((g, i) => (
                  <div key={i} className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <h4 className="font-semibold text-xs text-slate-900">{g.title}</h4>
                        {(() => {
                          const st = getGoalStatus(g.managerRating);
                          const cls =
                            st === 'ACHIEVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : st === 'IN_PROGRESS'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800';
                          return (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${cls}`}>
                              {st === 'ACHIEVED' ? 'Achieved' : st === 'IN_PROGRESS' ? 'In Progress' : 'Not Achieved'}
                            </span>
                          );
                        })()}
                      </div>
                      <span className="text-xs font-mono font-bold text-slate-600">{g.weightage}% Weight</span>
                    </div>

                    <p className="text-xs text-slate-500 pl-8">{g.description}</p>

                    {g.comments && (
                      <div className="pl-8 pt-2 text-xs">
                        <span className="italic text-emerald-700 text-[11px]">"{g.comments}"</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Qualitative Feedback */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100 text-xs">
              <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100">
                <span className="font-bold text-emerald-900 uppercase text-[10px] tracking-wider block mb-1">
                  Core Strengths Identified
                </span>
                <p className="text-emerald-800 leading-relaxed">{rev.strengths}</p>
              </div>

              <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
                <span className="font-bold text-indigo-900 uppercase text-[10px] tracking-wider block mb-1">
                  Growth Opportunities & Calibration
                </span>
                <p className="text-indigo-800 leading-relaxed">{rev.areasOfImprovement}</p>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};