import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { attendanceService } from '../services/attendanceService';
import { employeeService } from '../services/employeeService';
import { Shift } from '../types/attendance';
import { Department } from '../types/employee';
import {
  Calendar,
  Clock,
  Plus,
  Building,
  CheckCircle2,
  Moon,
  Sun,
  Coffee,
  AlertCircle,
  AlertTriangle,
  X,
  Edit2,
  Trash2,
  Search,
  RotateCcw,
  Check,
} from 'lucide-react';

export const ShiftsPage: React.FC = () => {
  const { user } = useAuth();
  const canManageShifts = user?.role === 'ADMIN';

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'DAY' | 'NIGHT'>('ALL');

  // Modal State for Add & Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Delete Confirmation State
  const [deleteConfirmShift, setDeleteConfirmShift] = useState<Shift | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const initialFormData = {
    name: '',
    code: '',
    startTime: '09:00',
    endTime: '18:00',
    expectedHours: 8,
    breakMinutes: 60,
    gracePeriodMinutes: 15,
    isNightShift: false,
    departments: [] as string[],
    isActive: true,
  };

  const [formData, setFormData] = useState(initialFormData);

  const fetchShifts = async () => {
    setLoading(true);
    try {
      const [shiftsRes, deptsRes] = await Promise.all([
        attendanceService.getShifts(),
        employeeService.getDepartments(),
      ]);
      setShifts(shiftsRes.shifts);
      setDepartments(deptsRes.departments);
    } catch (err) {
      console.error('Failed to load shifts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShifts();
  }, []);

  const handleOpenCreateModal = () => {
    setEditingShift(null);
    setFormData(initialFormData);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (shift: Shift) => {
    setEditingShift(shift);
    setFormData({
      name: shift.name,
      code: shift.code,
      startTime: shift.startTime,
      endTime: shift.endTime,
      expectedHours: shift.expectedHours ?? 8,
      breakMinutes: shift.breakMinutes ?? 60,
      gracePeriodMinutes: shift.gracePeriodMinutes ?? 15,
      isNightShift: Boolean(shift.isNightShift),
      departments: shift.departments ? [...shift.departments] : [],
      isActive: shift.isActive !== false,
    });
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) return;

    setIsSubmitting(true);
    try {
      // Ending before the start time means the shift crosses midnight => night shift.
      const payload = {
        ...formData,
        isNightShift: formData.isNightShift || formData.endTime < formData.startTime,
      };
      if (editingShift) {
        const res = await attendanceService.updateShift(editingShift._id, payload);
        if (res.success) {
          setFeedbackMsg({
            type: 'success',
            text: `Shift "${res.shift.name}" updated successfully!`,
          });
          setIsModalOpen(false);
          await fetchShifts();
          setTimeout(() => setFeedbackMsg(null), 4000);
        }
      } else {
        const res = await attendanceService.createShift(payload);
        if (res.success) {
          setFeedbackMsg({
            type: 'success',
            text: `Shift "${res.shift.name}" configured successfully!`,
          });
          setIsModalOpen(false);
          setFormData(initialFormData);
          await fetchShifts();
          setTimeout(() => setFeedbackMsg(null), 4000);
        }
      }
    } catch (err: any) {
      console.error('Failed to save shift:', err);
      setFeedbackMsg({
        type: 'error',
        text: err?.message || 'Failed to save shift policy. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmShift) return;

    setIsDeleting(true);
    try {
      const res = await attendanceService.deleteShift(deleteConfirmShift._id);
      if (res.success) {
        setFeedbackMsg({
          type: 'success',
          text: `Shift "${deleteConfirmShift.name}" was deleted successfully.`,
        });
        setDeleteConfirmShift(null);
        await fetchShifts();
        setTimeout(() => setFeedbackMsg(null), 4000);
      }
    } catch (err: any) {
      console.error('Failed to delete shift:', err);
      setFeedbackMsg({
        type: 'error',
        text: err?.message || 'Failed to delete shift. Please try again.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleDept = (deptName: string) => {
    setFormData((prev) => ({
      ...prev,
      departments: prev.departments.includes(deptName)
        ? prev.departments.filter((d) => d !== deptName)
        : [...prev.departments, deptName],
    }));
  };

  const filteredShifts = shifts.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code.toLowerCase().includes(search.toLowerCase()) ||
      s.departments?.some((d) => d.toLowerCase().includes(search.toLowerCase()));

    if (filterType === 'DAY') return matchesSearch && !s.isNightShift;
    if (filterType === 'NIGHT') return matchesSearch && s.isNightShift;
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Work Shifts & Rosters
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchShifts}
            className="p-2.5 bg-[#012a52] hover:bg-[#023b77] text-white rounded-xl transition cursor-pointer border border-[#039583]/50"
            title="Refresh shifts"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {canManageShifts && (
            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2.5 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition shadow-xs cursor-pointer border border-[#039583]"
            >
              <Plus className="w-4 h-4" />
              Configure New Shift
            </button>
          )}
        </div>
      </div>

      {/* Role Notice for HR & Admin */}
      {canManageShifts && (
        <div className="bg-indigo-50/60 border border-indigo-200/80 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-indigo-900">
            <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>
              <strong>HR Operational Authority:</strong> As {user?.role}, you have full authority to create, update parameters, allocate departments, and delete work shifts and roster schedules.
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
            {shifts.length} Total Shifts
          </span>
        </div>
      )}

      {/* Feedback Alert */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-xl text-xs flex items-center justify-between shadow-2xs border ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-semibold">{feedbackMsg.text}</span>
          </div>
          <button onClick={() => setFeedbackMsg(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search and Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search shift by name, code (e.g. S-GEN), or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {(
            [
              { id: 'ALL', label: `All Shifts (${shifts.length})` },
              { id: 'DAY', label: `Day Shifts (${shifts.filter((s) => !s.isNightShift).length})` },
              { id: 'NIGHT', label: `Night Shifts (${shifts.filter((s) => s.isNightShift).length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                filterType === tab.id
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Shifts Grid */}
      {loading ? (
        <div className="p-16 text-center text-xs text-slate-400 font-mono bg-white rounded-2xl border border-slate-200">
          Loading shift roster configurations...
        </div>
      ) : filteredShifts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
          <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-700">No Shift Configurations Found</p>
          <p className="text-xs text-slate-400 mt-1">
            {search
              ? 'No shifts match your query parameters.'
              : 'Establish organizational work schedules by clicking "Configure New Shift".'}
          </p>
          {canManageShifts && (
            <button
              onClick={handleOpenCreateModal}
              className="mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Configure New Shift
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredShifts.map((s) => (
            <div
              key={s._id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 hover:shadow-sm transition flex flex-col justify-between space-y-4"
            >
              <div>
                {/* Header Strip with Code, Night/Day, and Action Buttons */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                      {s.code}
                    </span>

                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1 border ${
                        s.isNightShift
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {s.isNightShift ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                      {s.isNightShift ? 'Night Shift' : 'Day Shift'}
                    </span>
                  </div>

                  {canManageShifts && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEditModal(s)}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition cursor-pointer"
                        title="Edit Shift"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmShift(s)}
                        className="p-1.5 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition cursor-pointer"
                        title="Delete Shift"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <h3 className="text-base font-bold text-slate-900 mt-3">{s.name}</h3>

                {/* Timing strip */}
                <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block font-mono">
                      Shift Hours
                    </span>
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {s.startTime} – {s.endTime}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block font-mono">
                      Target Duty
                    </span>
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {s.expectedHours} hrs/day
                    </span>
                  </div>
                </div>

                {/* Rules List */}
                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Coffee className="w-3.5 h-3.5 text-slate-400" />
                      Lunch & Break Deduction
                    </span>
                    <span className="font-mono font-semibold text-slate-800">{s.breakMinutes} mins</span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      Late Arrival Grace Period
                    </span>
                    <span className="font-mono font-semibold text-slate-800">
                      {s.gracePeriodMinutes} mins
                    </span>
                  </div>
                </div>

                {/* Covered Departments */}
                <div className="mt-4 pt-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Covered Departments ({s.departments?.length || 0})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {s.departments && s.departments.length > 0 ? (
                      s.departments.map((dept, i) => (
                        <span
                          key={i}
                          className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium"
                        >
                          {dept}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">
                        All Departments / General Pool
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Active Roster Policy
                </span>

                {canManageShifts ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleOpenEditModal(s)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition cursor-pointer"
                    >
                      <Edit2 className="w-3 h-3 text-slate-500" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => setDeleteConfirmShift(s)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[11px] font-semibold transition cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3 text-rose-600" />
                      <span>Delete</span>
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-400 text-[10px] font-mono">View Only</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Shift Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingShift ? 'Edit Shift Schedule' : 'Configure Shift Schedule'}
                </h3>
                <p className="text-xs text-slate-500">
                  {editingShift
                    ? `Update schedule parameters, working hours, and grace rules for ${editingShift.code}.`
                    : 'Establish working hour thresholds, break periods, and grace rules.'}
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shift Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Afternoon Support Shift"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shift Code *</label>
                  <input
                    type="text"
                    placeholder="e.g. AFT-03"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono uppercase text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Start Time (24h) *</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">End Time (24h) *</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    required
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Expected Hours</label>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={formData.expectedHours}
                    onChange={(e) =>
                      setFormData({ ...formData, expectedHours: Number(e.target.value) })
                    }
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Break (Mins)</label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    value={formData.breakMinutes}
                    onChange={(e) =>
                      setFormData({ ...formData, breakMinutes: Number(e.target.value) })
                    }
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Grace (Mins)</label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={formData.gracePeriodMinutes}
                    onChange={(e) =>
                      setFormData({ ...formData, gracePeriodMinutes: Number(e.target.value) })
                    }
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700">
                    Applicable Departments ({formData.departments.length} selected)
                  </label>
                  <span className="text-[10px] text-slate-400">Leave empty to cover all</span>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-xl">
                  {departments.map((d) => (
                    <label key={d._id} className="flex items-center gap-2 cursor-pointer text-[11px] hover:text-slate-900">
                      <input
                        type="checkbox"
                        checked={formData.departments.includes(d.name)}
                        onChange={() => toggleDept(d.name)}
                        className="rounded text-slate-900 focus:ring-slate-900 cursor-pointer"
                      />
                      <span className="truncate">{d.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="nightShift"
                    checked={formData.isNightShift}
                    onChange={(e) => setFormData({ ...formData, isNightShift: e.target.checked })}
                    className="rounded text-slate-900 focus:ring-slate-900 cursor-pointer"
                  />
                  <label htmlFor="nightShift" className="font-semibold text-slate-700 cursor-pointer">
                    Classify as Night / Overnight Shift (crosses midnight)
                  </label>
                </div>
                <p className="text-[10px] text-slate-500 pl-6">
                  Night shifts earn +1 day after 10h and +1.5 days after 14h. A shift whose end time is
                  earlier than its start time is marked as night automatically.
                </p>

                <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60">
                  <input
                    type="checkbox"
                    id="activeShift"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="rounded text-slate-900 focus:ring-slate-900 cursor-pointer"
                  />
                  <label htmlFor="activeShift" className="font-semibold text-slate-700 cursor-pointer">
                    Active Shift Policy (available for employee attendance assignment)
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {editingShift ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Update Shift Policy
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Save Shift Policy
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmShift && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">Delete Work Shift?</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Are you sure you want to delete <strong className="text-slate-900">{deleteConfirmShift.name}</strong> ({deleteConfirmShift.code})?
                This shift is scheduled for {deleteConfirmShift.startTime} – {deleteConfirmShift.endTime} ({deleteConfirmShift.expectedHours}h duty).
              </p>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-800">
              <strong>Caution:</strong> Attendance calculations and rosters tied to this shift code will revert to standard shift defaults.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteConfirmShift(null)}
                disabled={isDeleting}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isDeleting ? 'Deleting...' : 'Yes, Delete Shift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};