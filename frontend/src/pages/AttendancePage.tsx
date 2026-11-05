import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { attendanceService } from '../services/attendanceService';
import { AttendanceRecord, AttendanceStats } from '../types/attendance';
import {
  Clock,
  LogIn,
  LogOut,
  Search,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Moon,
  X,
  MapPin,
} from 'lucide-react';
import { GeofenceD3Summary } from '../components/common/GeofenceD3Summary';

type GPSLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export const AttendancePage: React.FC = () => {
  const { user } = useAuth();

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<AttendanceStats>({
    totalRecords: 0,
    todayPresent: 0,
    todayCheckedInNow: 0,
    todayLate: 0,
    totalOvertimeHours: 0,
    totalExtraDayCredit: 0,
    totalWorkedHours: 0,
  });

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState<'today' | 'all'>('all');

  // Self check-in/out state
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [todayRecord, setTodayRecord] =
    useState<AttendanceRecord | null>(null);
  const [isClocking, setIsClocking] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Regularize modal
  const [regularizeRecord, setRegularizeRecord] =
    useState<AttendanceRecord | null>(null);

  const [regFormData, setRegFormData] = useState({
    checkInTime: '',
    checkOutTime: '',
    status: 'PRESENT',
    reason: '',
  });

  const fetchAttendance = async () => {
    setLoading(true);

    try {
      const todayStr = new Date().toISOString().split('T')[0];

      const res = await attendanceService.getAttendance({
        date: dateFilter === 'today' ? todayStr : undefined,
        status: statusFilter,
      });

      setRecords(res.records);
      setStats(res.stats);

      // Check current user's today status
      const userEmpId = user?.employee?._id || user?.employeeId;

      if (userEmpId) {
        const userToday = res.records.find(
          (r) => r.employeeId === userEmpId && r.date === todayStr
        );

        if (userToday) {
          setTodayRecord(userToday);
          setIsCheckedIn(
            Boolean(userToday.checkInTime && !userToday.checkOutTime)
          );
        } else {
          setTodayRecord(null);
          setIsCheckedIn(false);
        }
      }
    } catch (err) {
      console.error('Failed to load attendance:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendance();
  }, [dateFilter, statusFilter]);

  /**
   * Get the user's current GPS location.
   *
   * GPS is mandatory for both check-in and check-out.
   * The attendance API is never called if location cannot be obtained.
   */
  const getCurrentGPSLocation = (): Promise<GPSLocation> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            'Geolocation is not supported by this browser. Please use a browser that supports location access.'
          )
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;

          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(accuracy)
          ) {
            reject(
              new Error(
                'Your browser returned an invalid GPS location. Please try again.'
              )
            );
            return;
          }

          resolve({
            latitude,
            longitude,
            accuracy,
          });
        },
        (error) => {
          switch (error.code) {
            case error.PERMISSION_DENIED:
              reject(
                new Error(
                  'Location permission was denied. Please allow location access in your browser and try again.'
                )
              );
              break;

            case error.POSITION_UNAVAILABLE:
              reject(
                new Error(
                  'Your location could not be determined. Please check your device location/GPS settings and try again.'
                )
              );
              break;

            case error.TIMEOUT:
              reject(
                new Error(
                  'Getting your GPS location timed out. Please try again.'
                )
              );
              break;

            default:
              reject(
                new Error(
                  'Unable to get your current GPS location. Please try again.'
                )
              );
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      );
    });
  };

  const handleCheckInToggle = async () => {
    setIsClocking(true);

    try {
      // GPS must be obtained before either attendance action.
      // If GPS fails, no attendance API call is made.
      const location = await getCurrentGPSLocation();

      if (!isCheckedIn) {
        const res = await attendanceService.checkIn({
          location,
        });

        if (res.success) {
          const nowTime = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          const updatedRec = {
            ...res.record,
            checkInTime: res.record.checkInTime || nowTime,
          };
          setFeedbackMsg(
            `Checked in at ${updatedRec.checkInTime}. GPS captured (${location.latitude.toFixed(
              6
            )}, ${location.longitude.toFixed(6)}).`
          );

          setIsCheckedIn(true);
          setTodayRecord(updatedRec);

          await fetchAttendance();

          setTimeout(() => setFeedbackMsg(null), 4000);
        }
      } else {
        const res = await attendanceService.checkOut({
          location,
        });

        if (res.success) {
          setFeedbackMsg(
            `Checked out successfully. GPS captured (${location.latitude.toFixed(
              6
            )}, ${location.longitude.toFixed(6)}).`
          );

          setIsCheckedIn(false);
          setTodayRecord(res.record);

          await fetchAttendance();

          setTimeout(() => setFeedbackMsg(null), 5000);
        }
      }
    } catch (err: unknown) {
      console.error('Clock action failed:', err);

      alert(
        err instanceof Error
          ? err.message
          : 'Unable to complete attendance action because GPS location could not be obtained.'
      );
    } finally {
      setIsClocking(false);
    }
  };

  const handleRegularizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!regularizeRecord || !regFormData.reason.trim()) return;

    try {
      const res = await attendanceService.regularize(
        regularizeRecord._id,
        regFormData
      );

      if (res.success) {
        setFeedbackMsg(
          `Attendance regularized for ${res.record.employeeName}. Extra pay: ${res.record.extraDayCredit ? `+${res.record.extraDayCredit} day` : 'none'}.`
        );

        setRegularizeRecord(null);

        await fetchAttendance();

        setTimeout(() => setFeedbackMsg(null), 4000);
      }
    } catch (err) {
      console.error('Regularization failed:', err);
    }
  };

  const filteredRecords = records.filter((r) => {
    const q = search.toLowerCase();

    return (
      r.employeeName.toLowerCase().includes(q) ||
      r.employeeCode.toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q) ||
      r.date.includes(q)
    );
  });



  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Attendance & Overtime Management
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchAttendance}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#039583] hover:bg-[#023b77] text-white rounded-xl text-xs font-semibold transition border border-[#039583]"
          >
            Refresh Timesheet
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-xs flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{feedbackMsg}</span>
          </div>

          <button onClick={() => setFeedbackMsg(null)}>
            <X className="w-4 h-4 text-emerald-600" />
          </button>
        </div>
      )}

      {/* Clock-In Widget, 2x2 Metric Cards & Geofence in the Same Row */}
      <div className={`grid grid-cols-1 ${user?.role === 'EMPLOYEE' ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-6 items-stretch`}>
        {/* Column 1: Clock-In / Check-Out Widget (EMPLOYEE ROLE ONLY) */}
        {user?.role === 'EMPLOYEE' && (
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-6 shadow-md flex flex-col justify-between space-y-5 h-full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />

                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                  Live Shift Attendance
                </span>
              </div>

              <span className="text-[11px] font-mono bg-slate-800 px-2 py-0.5 rounded text-slate-300 border border-slate-700">
                {new Date().toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-3xl font-black font-mono tracking-tight text-white">
                {new Date().toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>

              <p className="text-xs text-slate-400">
                Expected Shift:{' '}
                <span className="text-slate-200 font-semibold">
                  Standard 09:00 - 18:00 (8h + 1h break)
                </span>
              </p>
            </div>

            {/* Today Summary */}
            <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/80 grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <span className="text-[10px] text-slate-400 block font-mono uppercase">
                  Check-In
                </span>

                <span className="font-bold text-white font-mono mt-0.5 block">
                  {todayRecord?.checkInTime || '--:--'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 block font-mono uppercase">
                  Worked
                </span>

                <span className="font-bold text-emerald-400 font-mono mt-0.5 block">
                  {todayRecord?.effectiveWorkingHours
                    ? `${todayRecord.effectiveWorkingHours}h`
                    : isCheckedIn
                    ? 'In Progress'
                    : '0.0h'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 block font-mono uppercase">
                  Extra Pay
                </span>

                <span className="font-bold text-purple-400 font-mono mt-0.5 block">
                  {todayRecord?.extraDayCredit
                    ? `+${todayRecord.extraDayCredit} day`
                    : 'None'}
                </span>
              </div>
            </div>

            {/* GPS Notice */}
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />

              <span>
                GPS location is required for check-in and check-out.
              </span>
            </div>

            {/* Action Button */}
            <button
              onClick={handleCheckInToggle}
              disabled={isClocking}
              className={`w-full py-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition shadow-sm cursor-pointer ${
                isCheckedIn
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black'
              } ${isClocking ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {isClocking ? (
                <>
                  <Clock className="w-4 h-4 animate-spin" />
                  Getting GPS Location...
                </>
              ) : isCheckedIn ? (
                <>
                  <LogOut className="w-4 h-4" />
                  Clock Out Now
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Clock In for Shift
                </>
              )}
            </button>
          </div>
        )}

        {/* Column 2: 4 Metric Cards in 2x2 Grid */}
        <div className="grid grid-cols-2 gap-3.5 h-full">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between h-full">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Today On Duty
            </span>

            <div>
              <p className="text-2xl font-black text-slate-900 font-mono mt-2">
                {stats.todayPresent}
              </p>

              <p className="text-[11px] text-slate-500 mt-0.5">
                Staff present today
              </p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-blue-200 bg-blue-50/20 shadow-xs flex flex-col justify-between h-full">
            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3" /> Active Now
            </span>

            <div>
              <p className="text-2xl font-black text-blue-700 font-mono mt-2">
                {stats.todayCheckedInNow}
              </p>

              <p className="text-[11px] text-blue-600 mt-0.5">
                Currently on floor
              </p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-amber-200 bg-amber-50/20 shadow-xs flex flex-col justify-between h-full">
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Late Arrivals
            </span>

            <div>
              <p className="text-2xl font-black text-amber-700 font-mono mt-2">
                {stats.todayLate}
              </p>

              <p className="text-[11px] text-amber-600 mt-0.5">
                Exceeded grace period
              </p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-purple-200 bg-purple-50/20 shadow-xs flex flex-col justify-between h-full">
            <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider flex items-center gap-1">
              <Flame className="w-3 h-3" /> Extra Days Earned
            </span>

            <div>
              <p className="text-2xl font-black text-purple-700 font-mono mt-2">
                +{stats.totalExtraDayCredit ?? 0} days
              </p>

              <p className="text-[11px] text-purple-600 mt-0.5">
                Paid as extra salary days
              </p>
            </div>
          </div>
        </div>

        {/* Column 3: Geofence D3 Summary */}
        <div className="h-full">
          <GeofenceD3Summary records={records} />
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold text-slate-600">
            <button
              onClick={() => setDateFilter('all')}
              className={`px-3 py-1 rounded-lg transition ${
                dateFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : ''
              }`}
            >
              Full Timesheet
            </button>

            <button
              onClick={() => setDateFilter('today')}
              className={`px-3 py-1 rounded-lg transition ${
                dateFilter === 'today'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : ''
              }`}
            >
              Today Only
            </button>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          >
            <option value="ALL">All Statuses</option>
            <option value="PRESENT">Present</option>
            <option value="LATE">Late Arrival</option>
            <option value="WORK_FROM_HOME">Work From Home</option>
            <option value="HALF_DAY">Half Day</option>
          </select>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />

          <input
            type="text"
            placeholder="Search employee, code, or date..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
          />
        </div>
      </div>

      {/* Attendance Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500 font-mono">
            Loading attendance records...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-12 text-center">
            <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />

            <p className="text-sm font-semibold text-slate-700">
              No Attendance Records Found
            </p>

            <p className="text-xs text-slate-400 mt-1">
              No shift logs match the current query parameters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider font-mono">
                  <th className="py-3.5 px-4">Date & Shift</th>

                  {(user?.role === 'ADMIN') && (
                    <th className="py-3.5 px-4">Employee</th>
                  )}

                  <th className="py-3.5 px-4">Check-In</th>
                  <th className="py-3.5 px-4">Check-Out</th>
                  <th className="py-3.5 px-4">Effective Hours</th>

                  <th className="py-3.5 px-4 bg-purple-50/50 text-purple-900">
                    Extra Pay
                  </th>

                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filteredRecords.map((r) => (
                  <tr
                    key={r._id}
                    className="hover:bg-slate-50/60 transition"
                  >
                    <td className="py-3 px-4">
                      <span className="font-bold text-slate-900 font-mono block">
                        {r.date}
                      </span>

                      <span className="text-[10px] text-slate-400 block line-clamp-1">
                        {r.shiftName}
                      </span>

                      {r.isNightShift && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded mt-0.5">
                          <Moon className="w-2.5 h-2.5" /> Night
                        </span>
                      )}
                    </td>

                    {(user?.role === 'ADMIN') && (
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-900 block">
                          {r.employeeName}
                        </span>

                        <span className="text-[10px] text-slate-400 font-mono">
                          {r.employeeCode} · {r.department}
                        </span>
                      </td>
                    )}

                    <td className="py-3 px-4 font-mono font-medium text-slate-800">
                      {r.checkInTime || '--:--'}
                    </td>

                    <td className="py-3 px-4 font-mono font-medium text-slate-800">
                      {r.checkOutTime ||
                        (r.checkInTime ? 'Active Now' : '--:--')}
                    </td>

                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      {r.effectiveWorkingHours
                        ? `${r.effectiveWorkingHours} hrs`
                        : '--'}
                    </td>

                    <td className="py-3 px-4 font-mono bg-purple-50/30">
                      {r.extraDayCredit && r.extraDayCredit > 0 ? (
                        <span className="font-bold text-purple-700 bg-purple-100/70 px-2 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border border-purple-200">
                          <Flame className="w-3 h-3 text-purple-600" />
                          +{r.extraDayCredit} day{r.extraDayCredit === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono text-[11px]">
                          None
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono uppercase border ${
                          r.status === 'PRESENT'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : r.status === 'WORK_FROM_HOME'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : r.status === 'LATE'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {r.status.replace('_', ' ')}
                      </span>

                      {r.isRegularized && (
                        <span className="block text-[9px] text-purple-600 font-mono mt-0.5">
                          Regularized by {r.regularizedBy?.split(' ')[0]}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      {(user?.role === 'ADMIN') && (
                        <button
                          onClick={() => {
                            setRegularizeRecord(r);

                            setRegFormData({
                              checkInTime: r.checkInTime || '09:00',
                              checkOutTime: r.checkOutTime || '18:00',
                              status: r.status,
                              reason: '',
                            });
                          }}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition"
                        >
                          Regularize
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Regularize Modal */}
      {regularizeRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Regularize Attendance Record
                </h3>

                <p className="text-xs text-slate-500">
                  {regularizeRecord.employeeName} · {regularizeRecord.date}
                </p>
              </div>

              <button
                onClick={() => setRegularizeRecord(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleRegularizeSubmit}
              className="space-y-4 text-xs"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Check-In Time
                  </label>

                  <input
                    type="time"
                    value={regFormData.checkInTime}
                    onChange={(e) =>
                      setRegFormData({
                        ...regFormData,
                        checkInTime: e.target.value,
                      })
                    }
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Check-Out Time
                  </label>

                  <input
                    type="time"
                    value={regFormData.checkOutTime}
                    onChange={(e) =>
                      setRegFormData({
                        ...regFormData,
                        checkOutTime: e.target.value,
                      })
                    }
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Attendance Status
                </label>

                <select
                  value={regFormData.status}
                  onChange={(e) =>
                    setRegFormData({
                      ...regFormData,
                      status: e.target.value,
                    })
                  }
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
                >
                  <option value="PRESENT">Present</option>
                  <option value="WORK_FROM_HOME">Work From Home</option>
                  <option value="HALF_DAY">Half Day</option>
                  <option value="LATE">Late Arrival</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Justification Reason *
                </label>

                <textarea
                  rows={2}
                  placeholder="e.g. System biometric outage / Approved client off-site meeting..."
                  value={regFormData.reason}
                  onChange={(e) =>
                    setRegFormData({
                      ...regFormData,
                      reason: e.target.value,
                    })
                  }
                  required
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRegularizeRecord(null)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shadow-xs"
                >
                  Confirm Regularization
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};