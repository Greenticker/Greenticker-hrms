import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, CalendarRange, ClipboardList, MessageSquareHeart, Search, Settings2, Target, UserCheck, Users } from 'lucide-react';
import { NoteComposer, NotesList } from '../components/performance/FeedbackNotes';
import { PmsReports } from '../components/performance/PmsReports';
import { pmsService } from '../services/pmsService';
import { GoalSheet, GoalSheetStatus, GoalSheetSummary, KpiLibraryItem, Overview360Row, PmsContext } from '../types/pms';
import { STATUS_STYLE, StatusBadge } from '../components/performance/GoalSheetView';
import { PmsSetup } from '../components/performance/PmsSetup';
import { EmployeeWorkspace } from '../components/performance/EmployeeWorkspace';
import { GiveFeedback } from '../components/performance/GiveFeedback';
import { YearEndAdmin } from '../components/performance/YearEndAdmin';

type Tab = 'mine' | 'feedback' | 'team' | 'review' | 'all' | 'yearend' | 'reports' | 'setup';

const NOM_LABEL: Record<Overview360Row['nominationStatus'], string> = {
  NOT_STARTED: 'Not started',
  DRAFT: 'Draft',
  SUBMITTED: 'With manager',
  APPROVED: 'Approved',
};

/** HR / management tracker: where each employee's 360° stands. */
const Overview360List: React.FC<{ onOpen: (employeeId: string) => void }> = ({ onOpen }) => {
  const [rows, setRows] = useState<Overview360Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    pmsService.getOverview360().then((r) => setRows(r.rows)).catch((err) => setError(err?.message || 'Could not load the 360° tracker.'));
  }, []);
  if (error) return <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>;
  if (!rows) return <div className="py-10 text-center text-xs text-slate-400">Loading...</div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-200">
          <tr>
            <th className="py-2.5 px-4">Employee</th>
            <th className="py-2.5 px-4">Department</th>
            <th className="py-2.5 px-4">Nominations</th>
            <th className="py-2.5 px-4 text-right">Nominated</th>
            <th className="py-2.5 px-4 text-right">Feedback given</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.employeeId} onClick={() => onOpen(r.employeeId)} className="hover:bg-slate-50 cursor-pointer">
              <td className="py-2.5 px-4 font-semibold text-slate-900">{r.employeeName}</td>
              <td className="py-2.5 px-4 text-slate-600">{r.department || '—'}</td>
              <td className="py-2.5 px-4 text-slate-700">{NOM_LABEL[r.nominationStatus]}</td>
              <td className="py-2.5 px-4 text-right font-mono">{r.nominated || '—'}</td>
              <td className="py-2.5 px-4 text-right font-mono">{r.assigned ? `${r.submitted} / ${r.assigned}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
type ListScope = 'team' | 'review' | 'all';

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

// ------------------------------------------------------------- sheet list

const SheetList: React.FC<{
  scope: ListScope;
  onOpen: (row: GoalSheetSummary) => void;
  canStart: boolean;
}> = ({ scope, onOpen, canStart }) => {
  const [rows, setRows] = useState<GoalSheetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GoalSheetStatus | 'ALL'>('ALL');
  const [q, setQ] = useState('');

  useEffect(() => {
    setLoading(true);
    pmsService
      .listSheets(scope)
      .then((r) => setRows(r.rows))
      .catch((err) => setError(err?.message || 'Could not load goal sheets.'))
      .finally(() => setLoading(false));
  }, [scope]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length };
    rows.forEach((r) => (c[r.status] = (c[r.status] || 0) + 1));
    return c;
  }, [rows]);

  const shown = rows.filter(
    (r) =>
      (filter === 'ALL' || r.status === filter) &&
      `${r.employeeName} ${r.employeeCode || ''} ${r.department || ''}`.toLowerCase().includes(q.trim().toLowerCase())
  );

  if (loading) return <div className="py-12 text-center text-xs text-slate-400">Loading goal sheets...</div>;
  if (error) return <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(['ALL', 'NOT_STARTED', 'DRAFT', 'SUBMITTED', 'APPROVED', 'LOCKED'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                filter === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {s === 'ALL' ? 'All' : STATUS_STYLE[s].label} <span className="opacity-60 font-mono">{counts[s] || 0}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full lg:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, code, department..."
            aria-label="Search employees"
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-4">Employee</th>
              <th className="py-2.5 px-4">Department</th>
              <th className="py-2.5 px-4">Grade</th>
              <th className="py-2.5 px-4">Manager</th>
              <th className="py-2.5 px-4">Status</th>
              <th className="py-2.5 px-4 text-right">KPIs</th>
              <th className="py-2.5 px-4 text-right">KPI score</th>
              <th className="py-2.5 px-4 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => {
              const openable = !!r.sheetId || canStart;
              return (
                <tr
                  key={r.employeeId}
                  onClick={() => openable && onOpen(r)}
                  className={openable ? 'hover:bg-slate-50 cursor-pointer' : ''}
                >
                  <td className="py-2.5 px-4">
                    <p className="font-semibold text-slate-900">{r.employeeName}</p>
                    <p className="text-[11px] text-slate-400">{[r.employeeCode, r.designation].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">{r.department || '—'}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{r.grade || '—'}</td>
                  <td className="py-2.5 px-4 text-slate-600">{r.managerName || '—'}</td>
                  <td className="py-2.5 px-4">
                    <StatusBadge status={r.status} />
                    {r.version && r.version > 1 && <span className="ml-1 text-[10px] font-mono text-slate-400">v{r.version}</span>}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                    {r.lineCount ? `${r.lineCount} · ${r.weightTotal}%` : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">{r.kpiScore != null ? r.kpiScore.toFixed(2) : '—'}</td>
                  <td className="py-2.5 px-4 text-right">
                    {openable && (
                      <span className="text-[11px] font-bold text-[#039583]">{r.sheetId ? 'Open →' : 'Start →'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-xs text-slate-400">
                  No employees to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------- page

export const PerformancePage: React.FC = () => {
  const [ctx, setCtx] = useState<PmsContext | null>(null);
  const [library, setLibrary] = useState<KpiLibraryItem[]>([]);
  const [tab, setTab] = useState<Tab>('mine');
  const [mySheet, setMySheet] = useState<GoalSheet | null | undefined>(undefined);
  const [openSheet, setOpenSheet] = useState<GoalSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);
  const [allView, setAllView] = useState<'goals' | '360'>('goals');

  const loadContext = useCallback(async () => {
    try {
      const [c, lib] = await Promise.all([pmsService.getContext(), pmsService.getKpiLibrary()]);
      setCtx(c);
      setLibrary(lib.kpis);
      setTab((t) => (t === 'mine' && !c.employeeId ? (c.hasTeam ? 'team' : c.canViewAll ? 'all' : c.isHR ? 'setup' : 'mine') : t));
    } catch (err: any) {
      setError(err?.message || 'Could not load Performance Management.');
    }
  }, []);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  // My goal sheet (if there is an active cycle and I am an employee)
  useEffect(() => {
    if (!ctx?.employeeId || !ctx.activeCycle) {
      setMySheet(null);
      return;
    }
    pmsService
      .getSheetForEmployee(ctx.employeeId)
      .then((r) => setMySheet(r.sheet))
      .catch((err) => setError(err?.message || 'Could not load your goal sheet.'));
  }, [ctx]);

  const openRow = async (row: GoalSheetSummary) => {
    setError(null);
    try {
      const res = row.sheetId
        ? await pmsService.getSheet(row.sheetId)
        : await pmsService.getSheetForEmployee(row.employeeId, true);
      if (res.sheet) setOpenSheet(res.sheet);
    } catch (err: any) {
      setError(err?.message || 'Could not open the goal sheet.');
    }
  };

  const openEmployee = async (employeeId: string) => {
    setError(null);
    try {
      const res = await pmsService.getSheetForEmployee(employeeId);
      if (res.sheet) setOpenSheet(res.sheet);
      else setError('This employee has not started a goal sheet yet.');
    } catch (err: any) {
      setError(err?.message || 'Could not open this employee.');
    }
  };

  const startMine = async () => {
    if (!ctx?.employeeId) return;
    try {
      const res = await pmsService.getSheetForEmployee(ctx.employeeId, true);
      setMySheet(res.sheet);
    } catch (err: any) {
      setError(err?.message || 'Could not start your goal sheet.');
    }
  };

  if (!ctx) {
    return error ? (
      <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>
    ) : (
      <div className="py-12 text-center text-xs text-slate-400">Loading Performance Management...</div>
    );
  }

  const cycle = ctx.activeCycle;
  const today = new Date().toISOString().slice(0, 10);
  const currentPhase = cycle?.phases.find((p) => p.start <= today && today <= p.end);
  const nextPhase = cycle?.phases.find((p) => p.start > today);

  const tabs: [Tab, string, React.ComponentType<{ className?: string }>, boolean][] = [
    ['mine', 'My Performance', Target, !!ctx.employeeId],
    ['feedback', 'Give Feedback', MessageSquareHeart, !!ctx.employeeId && !!cycle],
    ['team', 'My Team', Users, ctx.hasTeam],
    ['review', 'For Review', UserCheck, ctx.hasReviewees],
    ['all', 'All Employees', ClipboardList, ctx.canViewAll],
    ['yearend', 'Year-end', Award, ctx.canViewAll],
    ['reports', 'Reports', BarChart3, ctx.canViewAll || ctx.hasTeam || ctx.hasReviewees],
    ['setup', 'Setup', Settings2, ctx.isHR],
  ];

  const switchTab = (t: Tab) => {
    setTab(t);
    setOpenSheet(null);
    setError(null);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Performance Management</h1>
          {cycle ? (
            <p className="text-xs text-slate-200 mt-1 flex items-center gap-1.5">
              <CalendarRange className="w-3.5 h-3.5" />
              {cycle.name}
              {currentPhase ? (
                <> · <strong className="text-white">{currentPhase.label}</strong> due {fmtDate(currentPhase.end)}</>
              ) : nextPhase ? (
                <> · Next: {nextPhase.label} from {fmtDate(nextPhase.start)}</>
              ) : null}
            </p>
          ) : (
            <p className="text-xs text-slate-200 mt-1">No active appraisal cycle</p>
          )}
        </div>
        {ctx.revisionOpen && cycle?.revisionWindow && (
          <div className="px-3 py-2 rounded-xl bg-amber-400/20 border border-amber-300/40 text-xs text-amber-100">
            Goal revision window open until {fmtDate(cycle.revisionWindow.closesOn)}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-xs flex items-center gap-1 overflow-x-auto">
        {tabs
          .filter(([, , , visible]) => visible)
          .map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                tab === id ? 'bg-[#023b77] text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
              {id === 'feedback' && ctx.pendingFeedback > 0 && (
                <span className="ml-0.5 min-w-5 h-5 px-1.5 rounded-full bg-amber-400 text-slate-900 text-[10px] font-bold flex items-center justify-center">
                  {ctx.pendingFeedback}
                </span>
              )}
            </button>
          ))}
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}

      {tab === 'setup' ? (
        <PmsSetup onChanged={loadContext} />
      ) : !cycle ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-2">
          <p className="text-sm font-semibold text-slate-700">Goal setting hasn't started yet.</p>
          <p className="text-xs text-slate-500">
            {ctx.isHR ? 'Create and activate an appraisal cycle under Setup to open goal setting.' : 'HR will open the appraisal cycle soon.'}
          </p>
          {ctx.isHR && (
            <button type="button" onClick={() => switchTab('setup')} className="mt-2 px-4 py-2 text-xs font-bold text-white bg-[#039583] rounded-lg cursor-pointer">
              Go to Setup
            </button>
          )}
        </div>
      ) : tab === 'mine' ? (
        mySheet === undefined ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading your goal sheet...</div>
        ) : mySheet ? (
          <EmployeeWorkspace sheet={mySheet} rules={ctx.rules} library={library} isOwner onSheetChange={setMySheet} />
        ) : (
          <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
            <Target className="w-8 h-8 text-[#039583] mx-auto" />
            <p className="text-sm font-semibold text-slate-800">Set your goals for {cycle.name}</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Add {ctx.rules.minLines}–{ctx.rules.maxLines} KPIs, each weighted {ctx.rules.minWeight}–{ctx.rules.maxWeight}%, totalling 100%, including the
              "{ctx.rules.complianceKra}" KRA at {ctx.rules.complianceMinWeight}% or more. Your manager and reviewer then approve them.
            </p>
            <button type="button" onClick={startMine} className="px-5 py-2.5 text-xs font-bold text-white bg-[#039583] hover:bg-[#027a6b] rounded-xl cursor-pointer">
              Start my goal sheet
            </button>
          </div>
        )
      ) : tab === 'feedback' ? (
        <div className="space-y-6">
          <GiveFeedback onCountChange={loadContext} />
          <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 items-start">
            <NoteComposer onSent={() => setListKey((k) => k + 1)} />
            <NotesList refreshKey={listKey} />
          </div>
        </div>
      ) : openSheet ? (
        <EmployeeWorkspace
          sheet={openSheet}
          rules={ctx.rules}
          library={library}
          isOwner={openSheet.employeeId === ctx.employeeId}
          onSheetChange={setOpenSheet}
          onBack={() => {
            setOpenSheet(null);
            setListKey((k) => k + 1);
          }}
        />
      ) : tab === 'reports' ? (
        <PmsReports key={listKey} onOpenEmployee={openEmployee} />
      ) : tab === 'yearend' ? (
        <YearEndAdmin key={listKey} isHR={ctx.isHR} onOpenEmployee={openEmployee} />
      ) : tab === 'all' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
            {([
              ['goals', 'Goal sheets'],
              ['360', '360° tracker'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAllView(id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${allView === id ? 'bg-white text-[#023b77] shadow-xs' : 'text-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {allView === 'goals' ? (
            <SheetList key={`all-${listKey}`} scope="all" onOpen={openRow} canStart={false} />
          ) : (
            <Overview360List key={`360-${listKey}`} onOpen={openEmployee} />
          )}
        </div>
      ) : (
        <SheetList key={`${tab}-${listKey}`} scope={tab as ListScope} onOpen={openRow} canStart={tab === 'team'} />
      )}
    </div>
  );
};
