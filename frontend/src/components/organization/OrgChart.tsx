import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Maximize2,
  Minimize2,
  Scan,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { OrgTreeNode } from '../../types/employee';

/**
 * Org chart that always fits the whole tree into one window.
 *
 * - Auto "fit to screen": the tree is measured and scaled so everything is visible.
 * - Compact layout: employees with no reports are grouped into one stacked list
 *   under their manager instead of each taking a full column.
 * - Zoom (buttons / mouse wheel), drag to pan, expand/collapse, search highlight,
 *   and a full-window mode.
 */

const MIN_SCALE = 0.15;
const MAX_SCALE = 2;
const FIT_PADDING = 24;

const isLeaf = (n: OrgTreeNode) => !n.reports || n.reports.length === 0;

const countDescendants = (n: OrgTreeNode): number =>
  (n.reports || []).reduce((sum, c) => sum + 1 + countDescendants(c), 0);

const collectManagerIds = (n: OrgTreeNode, out: string[] = []): string[] => {
  if (!isLeaf(n)) {
    out.push(n.employeeId);
    n.reports.forEach((c) => collectManagerIds(c, out));
  }
  return out;
};

const matchesQuery = (n: OrgTreeNode, q: string) =>
  !!q &&
  [n.name, n.employeeCode, n.designation, n.department].some((v) => v?.toLowerCase().includes(q));

interface ChartCtx {
  collapsed: Set<string>;
  toggle: (id: string) => void;
  query: string;
}

const Rail: React.FC<{ isFirst: boolean; isLast: boolean }> = ({ isFirst, isLast }) => (
  <>
    {!isFirst && <div className="absolute top-0 left-0 w-1/2 h-0.5 bg-indigo-300" />}
    {!isLast && <div className="absolute top-0 right-0 w-1/2 h-0.5 bg-indigo-300" />}
  </>
);

const ManagerCard: React.FC<{ node: OrgTreeNode; level: number; ctx: ChartCtx }> = ({ node, level, ctx }) => {
  const hasReports = !isLeaf(node);
  const isCollapsed = ctx.collapsed.has(node.employeeId);
  const hit = matchesQuery(node, ctx.query);
  const total = useMemo(() => countDescendants(node), [node]);

  return (
    <div
      className={`relative flex items-center gap-2.5 p-2.5 pr-3 rounded-xl border bg-white shadow-xs w-60 transition-shadow hover:shadow-md ${
        level === 0 ? 'border-indigo-300 bg-gradient-to-r from-indigo-50 to-white ring-2 ring-indigo-500/20' : 'border-slate-200'
      } ${hit ? 'ring-2 ring-amber-400 border-amber-400' : ''}`}
      title={`${node.name} (${node.employeeCode})\n${node.designation} · ${node.department}`}
    >
      <div className="w-8 h-8 rounded-full bg-[#023b77] text-white font-bold text-[11px] flex items-center justify-center shrink-0">
        {node.avatarInitials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-xs text-slate-900 truncate">{node.name}</div>
        <div className="text-[10px] text-slate-500 truncate">{node.designation}</div>
        <div className="text-[10px] text-[#039583] font-semibold truncate">{node.department}</div>
      </div>
      {hasReports && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => ctx.toggle(node.employeeId)}
          className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-indigo-200 bg-white text-[9px] font-bold text-indigo-700 shadow-2xs hover:bg-indigo-50 cursor-pointer"
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? <ChevronRight className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
          {total}
        </button>
      )}
    </div>
  );
};

/** Employees without reports, stacked compactly in one box. */
const LeafGroup: React.FC<{ nodes: OrgTreeNode[]; ctx: ChartCtx }> = ({ nodes, ctx }) => {
  const cols = nodes.length > 16 ? 3 : nodes.length > 7 ? 2 : 1;
  return (
    <div
      className="grid gap-1 p-1.5 rounded-xl border border-indigo-100 bg-indigo-50/40"
      style={{ gridTemplateColumns: `repeat(${cols}, 11rem)` }}
    >
      {nodes.map((n) => {
        const hit = matchesQuery(n, ctx.query);
        return (
          <div
            key={n.employeeId}
            title={`${n.name} (${n.employeeCode})\n${n.designation} · ${n.department}`}
            className={`px-2 py-1 rounded-lg border bg-white min-w-0 ${
              hit ? 'border-amber-400 ring-2 ring-amber-400' : 'border-slate-200'
            }`}
          >
            <div className="text-[11px] font-semibold text-slate-900 truncate">{n.name}</div>
            <div className="text-[9px] text-slate-500 truncate">{n.designation}</div>
          </div>
        );
      })}
    </div>
  );
};

const TreeNode: React.FC<{ node: OrgTreeNode; level: number; ctx: ChartCtx }> = ({ node, level, ctx }) => {
  const reports = node.reports || [];
  const expanded = reports.length > 0 && !ctx.collapsed.has(node.employeeId);

  // Leaves are grouped into a single compact branch; managers get their own branch.
  const leaves = reports.filter(isLeaf);
  const managers = reports.filter((r) => !isLeaf(r));
  const branches: Array<{ key: string; el: React.ReactNode }> = [];
  if (leaves.length) branches.push({ key: '__leaves', el: <LeafGroup nodes={leaves} ctx={ctx} /> });
  managers.forEach((m) =>
    branches.push({ key: m.employeeId, el: <TreeNode node={m} level={level + 1} ctx={ctx} /> }),
  );

  return (
    <div className="flex flex-col items-center">
      <ManagerCard node={node} level={level} ctx={ctx} />
      {expanded && (
        <>
          <div className="w-0.5 h-5 bg-indigo-300" />
          <div className="flex flex-row items-start">
            {branches.map((b, i) => (
              <div key={b.key} className="relative flex flex-col items-center px-2">
                {branches.length > 1 && <Rail isFirst={i === 0} isLast={i === branches.length - 1} />}
                <div className="w-0.5 h-4 bg-indigo-300" />
                {b.el}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/** People who aren't connected to the main tree, e.g. added without a reporting manager. */
const UnassignedPanel: React.FC<{ nodes: OrgTreeNode[]; ctx: ChartCtx }> = ({ nodes, ctx }) => {
  const leaves = nodes.filter(isLeaf);
  const trees = nodes.filter((n) => !isLeaf(n));
  const count = nodes.reduce((sum, n) => sum + 1 + countDescendants(n), 0);
  return (
    <div className="flex flex-col gap-3 p-3 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60">
      <div>
        <div className="text-xs font-bold text-amber-800">No reporting manager ({count})</div>
        <div className="text-[10px] text-amber-700">Set a reporting manager on these employees to place them in the tree.</div>
      </div>
      <div className="flex flex-row items-start gap-6">
        {leaves.length > 0 && <LeafGroup nodes={leaves} ctx={ctx} />}
        {trees.map((t) => (
          <TreeNode key={t.employeeId} node={t} level={1} ctx={ctx} />
        ))}
      </div>
    </div>
  );
};

export const OrgChart: React.FC<{ root: OrgTreeNode | null; unassigned?: OrgTreeNode[] }> = ({
  root,
  unassigned = [],
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [autoFit, setAutoFit] = useState(true);
  const [fullWindow, setFullWindow] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const totalPeople = useMemo(
    () => [root, ...unassigned].reduce((sum, n) => sum + (n ? 1 + countDescendants(n) : 0), 0),
    [root, unassigned],
  );

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return;
    const cw = vp.clientWidth - FIT_PADDING * 2;
    const ch = vp.clientHeight - FIT_PADDING * 2;
    const w = ct.offsetWidth;
    const h = ct.offsetHeight;
    if (!w || !h) return;
    const scale = Math.max(MIN_SCALE, Math.min(cw / w, ch / h, 1));
    setView({
      scale,
      x: (vp.clientWidth - w * scale) / 2,
      y: Math.max(FIT_PADDING, (vp.clientHeight - h * scale) / 2),
    });
  }, []);

  // Keep the chart fitted while the window / tree size changes, until the user zooms or pans.
  useLayoutEffect(() => {
    if (!autoFit) return;
    fit();
    const ro = new ResizeObserver(() => fit());
    if (viewportRef.current) ro.observe(viewportRef.current);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [autoFit, fit, fullWindow]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const px = cx ?? vp.clientWidth / 2;
    const py = cy ?? vp.clientHeight / 2;
    setAutoFit(false);
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  // Wheel zoom around the cursor (non-passive so the page doesn't scroll).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Esc leaves full-window mode.
  useEffect(() => {
    if (!fullWindow) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullWindow(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullWindow]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (autoFit && Math.abs(dx) + Math.abs(dy) < 3) return;
    setAutoFit(false);
    setView((v) => ({ ...v, x: d.x + dx, y: d.y + dy }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const ctx: ChartCtx = {
    collapsed,
    query: query.trim().toLowerCase(),
    toggle: (id) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAutoFit(true);
    },
  };

  const expandAll = () => {
    setCollapsed(new Set());
    setAutoFit(true);
  };
  // Show only the root and its direct reports.
  const collapseAll = () => {
    const ids = (root?.reports || []).flatMap((c) => collectManagerIds(c));
    unassigned.forEach((n) => collectManagerIds(n, ids));
    setCollapsed(new Set(ids));
    setAutoFit(true);
  };

  const btn =
    'flex items-center justify-center gap-1 h-8 px-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 text-[11px] font-semibold cursor-pointer';

  return (
    <div
      className={
        fullWindow
          ? 'fixed inset-0 z-50 bg-white flex flex-col p-4 gap-3'
          : 'flex flex-col gap-3'
      }
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Highlight name, code, role…"
            className="h-8 pl-8 pr-3 w-56 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-[#039583]"
          />
        </div>
        <span className="text-[11px] text-slate-500">{totalPeople} people</span>
        <div className="flex-1" />
        <button className={btn} onClick={expandAll} title="Expand all">
          <ChevronsUpDown className="w-3.5 h-3.5" /> Expand all
        </button>
        <button className={btn} onClick={collapseAll} title="Show top two levels only">
          <ChevronsDownUp className="w-3.5 h-3.5" /> Collapse
        </button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button className={btn} onClick={() => zoomAt(1 / 1.2)} title="Zoom out">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] font-mono text-slate-500 w-10 text-center">{Math.round(view.scale * 100)}%</span>
        <button className={btn} onClick={() => zoomAt(1.2)} title="Zoom in">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          className={`${btn} ${autoFit ? 'border-[#039583] text-[#039583]' : ''}`}
          onClick={() => setAutoFit(true)}
          title="Fit everything in the window"
        >
          <Scan className="w-3.5 h-3.5" /> Fit
        </button>
        <button
          className={btn}
          onClick={() => {
            setFullWindow((f) => !f);
            setAutoFit(true);
          }}
          title={fullWindow ? 'Exit full window (Esc)' : 'Full window'}
        >
          {fullWindow ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Canvas */}
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 cursor-grab active:cursor-grabbing select-none touch-none ${
          fullWindow ? 'flex-1' : 'h-[calc(100vh-300px)] min-h-[460px]'
        }`}
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(203 213 225) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        <div
          ref={contentRef}
          className="absolute top-0 left-0 w-max flex flex-row items-start gap-12"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {root && <TreeNode node={root} level={0} ctx={ctx} />}
          {unassigned.length > 0 && <UnassignedPanel nodes={unassigned} ctx={ctx} />}
        </div>
        <div className="absolute bottom-2 right-3 text-[10px] text-slate-400 pointer-events-none">
          Scroll to zoom · drag to pan
        </div>
      </div>
    </div>
  );
};
