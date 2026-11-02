import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { HolidayInput, HolidayItem } from '../types/modules';
import { Calendar, ChevronLeft, ChevronRight, Edit2, PartyPopper, Plus, Trash2, X } from 'lucide-react';

const EMPTY_FORM: HolidayInput = { name: '', date: '', type: 'MANDATORY', description: '' };

type TypeFilter = 'ALL' | HolidayItem['type'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "YYYY-MM-DD" -> local Date (avoids the UTC shift of new Date("YYYY-MM-DD")). */
const parseDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const prettyDate = (iso: string) =>
  parseDate(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const TYPE_STYLE: Record<HolidayItem['type'], { badge: string; cell: string; dot: string; label: string }> = {
  MANDATORY: {
    badge: 'bg-emerald-100 text-emerald-800',
    cell: 'bg-emerald-50 border-emerald-300 text-emerald-900',
    dot: 'bg-emerald-500',
    label: 'Mandatory',
  },
  RESTRICTED: {
    badge: 'bg-amber-100 text-amber-800',
    cell: 'bg-amber-50 border-amber-300 text-amber-900',
    dot: 'bg-amber-500',
    label: 'Restricted',
  },
};

export const HolidaysPage: React.FC = () => {
  const { user } = useAuth();
  // Only HR maintains the holiday calendar; the backend enforces the same rule
  const canManage = user?.role === 'HR';
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayItem | null>(null);
  const [form, setForm] = useState<HolidayInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const todayKey = toKey(new Date());

  useEffect(() => {
    const fetchHolidays = async () => {
      setLoading(true);
      try {
        const res = await modulesService.getHolidays();
        setHolidays(res.holidays);
        // Open the calendar on the month of the next upcoming holiday.
        const next = res.holidays.find((h) => h.date >= toKey(new Date()));
        if (next) {
          const d = parseDate(next.date);
          setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
        }
      } catch (err: any) {
        console.error('Failed to load holidays', err);
        setError(err?.message || 'Could not load the holiday calendar.');
      } finally {
        setLoading(false);
      }
    };
    fetchHolidays();
  }, []);

  const filtered = useMemo(
    () =>
      [...holidays]
        .filter((h) => typeFilter === 'ALL' || h.type === typeFilter)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [holidays, typeFilter]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, HolidayItem[]>();
    filtered.forEach((h) => map.set(h.date, [...(map.get(h.date) || []), h]));
    return map;
  }, [filtered]);

  const nextHoliday = useMemo(() => holidays.find((h) => h.date >= todayKey), [holidays, todayKey]);

  const counts = useMemo(
    () => ({
      total: holidays.length,
      mandatory: holidays.filter((h) => h.type === 'MANDATORY').length,
      restricted: holidays.filter((h) => h.type === 'RESTRICTED').length,
      remaining: holidays.filter((h) => h.date >= todayKey).length,
    }),
    [holidays, todayKey]
  );

  // List view: group by month
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: HolidayItem[] }[] = [];
    filtered.forEach((h) => {
      const key = h.date.slice(0, 7);
      let g = out.find((x) => x.key === key);
      if (!g) {
        const d = parseDate(h.date);
        g = { key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, items: [] };
        out.push(g);
      }
      g.items.push(h);
    });
    return out;
  }, [filtered]);

  // Calendar view: 6-week grid for the cursor month
  const calendarDays = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const shiftMonth = (delta: number) => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
    setSelectedKey(null);
  };

  // Calendar day -> highlight it in the list and scroll the list to it
  const selectFromCalendar = (key: string | null) => {
    setSelectedKey(key);
    if (key) document.getElementById(`holiday-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // List item -> move the calendar to that holiday's month and mark the day
  const selectFromList = (h: HolidayItem) => {
    const d = parseDate(h.date);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedKey(h.date);
  };

  const openAdd = (date = '') => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, date });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (h: HolidayItem) => {
    setEditing(h);
    setForm({ name: h.name, date: h.date, type: h.type, description: h.description || '' });
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.date) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = editing
        ? await modulesService.updateHoliday(editing._id, form)
        : await modulesService.createHoliday(form);
      setHolidays((prev) => [...prev.filter((h) => h._id !== res.holiday._id), res.holiday]);
      setFormOpen(false);
      selectFromList(res.holiday);
    } catch (err: any) {
      setFormError(err?.message || 'Could not save the holiday.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (h: HolidayItem) => {
    if (!window.confirm(`Delete "${h.name}" on ${prettyDate(h.date)}?`)) return;
    try {
      await modulesService.deleteHoliday(h._id);
      setHolidays((prev) => prev.filter((x) => x._id !== h._id));
      if (selectedKey === h.date) setSelectedKey(null);
    } catch (err: any) {
      alert(err?.message || 'Could not delete the holiday.');
    }
  };


  const holidayCard = (h: HolidayItem, compact = false) => {
    const past = h.date < todayKey;
    const style = TYPE_STYLE[h.type] || TYPE_STYLE.MANDATORY;
    return (
      <div
        key={h._id}
        id={`holiday-${h.date}`}
        role="button"
        tabIndex={0}
        onClick={() => selectFromList(h)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectFromList(h);
          }
        }}
        className={`group w-full text-left flex items-start gap-4 p-4 rounded-xl border transition cursor-pointer hover:shadow-sm scroll-mt-12 ${
          h._id === nextHoliday?._id ? 'border-[#039583] bg-[#039583]/5' : 'border-slate-200 bg-white'
        } ${past ? 'opacity-60' : ''} ${selectedKey === h.date ? 'ring-2 ring-[#023b77]' : ''}`}
      >
        <div className="w-14 shrink-0 text-center rounded-lg bg-slate-50 border border-slate-200 py-1.5">
          <div className="text-[10px] font-bold uppercase text-slate-500">{MONTHS[parseDate(h.date).getMonth()].slice(0, 3)}</div>
          <div className="text-xl font-black text-slate-900 leading-tight">{parseDate(h.date).getDate()}</div>
          <div className="text-[10px] text-slate-400">{h.dayOfWeek?.slice(0, 3)}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">{h.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${style.badge}`}>{style.label}</span>
            {h._id === nextHoliday?._id && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#039583] text-white">Next</span>
            )}
            {past && <span className="text-[10px] text-slate-400">Past</span>}
          </div>
          {!compact && h.description && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{h.description}</p>}
          <p className="text-[11px] text-slate-400 mt-1 font-mono">
            {h.dayOfWeek}, {prettyDate(h.date)} • All offices
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(h);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-[#023b77] hover:bg-slate-100 cursor-pointer"
              aria-label={`Edit ${h.name}`}
              title="Edit"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(h);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
              aria-label={`Delete ${h.name}`}
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Public Holidays</h1>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => openAdd()}
            className="self-start md:self-auto flex items-center gap-2 px-4 py-2 bg-[#039583] hover:bg-[#027a6b] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Add Holiday</span>
          </button>
        )}
      </div>

      {error && <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Total holidays', counts.total],
          ['Mandatory', counts.mandatory],
          ['Restricted (optional)', counts.restricted],
          ['Upcoming', counts.remaining],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-xs font-semibold text-slate-500">{label}</span>
            <p className="text-2xl font-black text-slate-900 mt-1 font-mono tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {nextHoliday && (
        <div className="p-4 rounded-2xl bg-[#039583]/10 border border-[#039583]/30 flex items-center gap-3">
          <PartyPopper className="w-5 h-5 text-[#039583] shrink-0" />
          <p className="text-sm text-slate-800">
            Next holiday: <span className="font-bold">{nextHoliday.name}</span> on {nextHoliday.dayOfWeek}, {prettyDate(nextHoliday.date)}
            {(() => {
              const days = Math.round((parseDate(nextHoliday.date).getTime() - parseDate(todayKey).getTime()) / 86400000);
              return <span className="text-slate-500"> — {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}</span>;
            })()}
          </p>
        </div>
      )}

      {/* Type filter + legend */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          ['ALL', 'All'],
          ['MANDATORY', 'Mandatory'],
          ['RESTRICTED', 'Restricted'],
        ] as [TypeFilter, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTypeFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
              typeFilter === key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Mandatory</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Restricted</span>
        </div>
      </div>

      {/* Calendar always shows; loading / empty states live in the list panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
          {/* ---------------- CALENDAR (left) ---------------- */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5 lg:sticky lg:top-4">
            <div className="flex items-center justify-between mb-4">
              <button type="button" onClick={() => shiftMonth(-1)} className="p-2 rounded-lg hover:bg-slate-100 cursor-pointer" aria-label="Previous month">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-center">
                <h2 className="text-base font-bold text-slate-900">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</h2>
                <button
                  type="button"
                  onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); setSelectedKey(null); }}
                  className="text-[11px] text-[#039583] font-semibold hover:underline cursor-pointer"
                >
                  Today
                </button>
              </div>
              <button type="button" onClick={() => shiftMonth(1)} className="p-2 rounded-lg hover:bg-slate-100 cursor-pointer" aria-label="Next month">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`py-1 text-[10px] font-bold uppercase ${i === 0 || i === 6 ? 'text-rose-400' : 'text-slate-400'}`}>{w}</div>
              ))}
              {calendarDays.map((d) => {
                const key = toKey(d);
                const inMonth = d.getMonth() === cursor.getMonth();
                const dayHolidays = byDate.get(key) || [];
                const holiday = dayHolidays[0];
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const style = holiday ? TYPE_STYLE[holiday.type] || TYPE_STYLE.MANDATORY : null;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      if (dayHolidays.length) selectFromCalendar(key);
                      else if (canManage) openAdd(key);
                      else selectFromCalendar(null);
                    }}
                    title={!dayHolidays.length && canManage ? 'Add a holiday on this day' : undefined}
                    className={`relative min-h-[64px] sm:min-h-[80px] rounded-lg border p-1.5 text-left transition ${
                      style ? `${style.cell} cursor-pointer hover:shadow-sm` : weekend ? 'bg-slate-50 border-slate-100' : 'bg-white border-slate-100'
                    } ${inMonth ? '' : 'opacity-40'} ${selectedKey === key ? 'ring-2 ring-[#023b77]' : ''}`}
                  >
                    <span
                      className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-semibold ${
                        key === todayKey ? 'bg-[#023b77] text-white' : weekend ? 'text-rose-400' : 'text-slate-700'
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    {holiday && (
                      <span className="block mt-0.5 text-[10px] font-semibold leading-tight line-clamp-2">
                        {holiday.name}
                        {dayHolidays.length > 1 && ` +${dayHolidays.length - 1}`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---------------- LIST (right) ---------------- */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-5 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
            {loading ? (
              <p className="py-12 text-center text-xs text-slate-400">Loading holiday schedule...</p>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-xs text-slate-400">No holidays to show.</p>
            ) : (
              groups.map((g) => (
                <section key={g.key} className="space-y-2">
                  <h2 className="sticky top-0 z-10 -mx-4 px-4 py-1.5 bg-white text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5" /> {g.label}
                    <span className="text-slate-400 font-normal normal-case">({g.items.length})</span>
                  </h2>
                  <div className="space-y-2">{g.items.map((h) => holidayCard(h))}</div>
                </section>
              ))
            )}
          </div>
        </div>

      {/* Add / Edit Holiday Modal (HR only) */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">{editing ? 'Edit Holiday' : 'Add Holiday'}</h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label htmlFor="holiday-name" className="block text-xs font-semibold text-slate-700">Holiday Name *</label>
                <input
                  id="holiday-name"
                  type="text"
                  required
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  placeholder="e.g. Diwali"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="holiday-date" className="block text-xs font-semibold text-slate-700">Date *</label>
                  <input
                    id="holiday-date"
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                  {form.date && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      {parseDate(form.date).toLocaleDateString('en-IN', { weekday: 'long' })}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="holiday-type" className="block text-xs font-semibold text-slate-700">Type</label>
                  <select
                    id="holiday-type"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as HolidayInput['type'] })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                  >
                    <option value="MANDATORY">Mandatory</option>
                    <option value="RESTRICTED">Restricted (optional)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="holiday-description" className="block text-xs font-semibold text-slate-700">Description</label>
                <textarea
                  id="holiday-description"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  placeholder="Optional note shown to employees"
                />
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{formError}</div>
              )}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-bold text-white bg-[#023b77] hover:bg-[#012a52] rounded-lg cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
