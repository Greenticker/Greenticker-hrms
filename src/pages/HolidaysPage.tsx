import React, { useState, useEffect } from 'react';
import { modulesService } from '../services/modulesService';
import { HolidayItem } from '../types/modules';
import { Calendar, CheckCircle2, Clock, MapPin, Tag } from 'lucide-react';

export const HolidaysPage: React.FC = () => {
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHolidays = async () => {
      setLoading(true);
      try {
        const res = await modulesService.getHolidays();
        setHolidays(res.holidays);
      } catch (err) {
        console.error('Failed to load holidays', err);
      } finally {
        setLoading(false);
      }
    };
    fetchHolidays();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Official Company Public Holidays (2026 Calendar)
        </h1>
      </div>

      {/* Holidays Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full py-12 text-center text-xs text-slate-400">
            Loading holiday schedule...
          </div>
        ) : (
          holidays.map((h) => (
            <div
              key={h._id}
              className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                    h.type === 'MANDATORY'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {h.type}
                  </span>
                  <span className="text-xs font-mono font-semibold text-slate-400">{h.dayOfWeek}</span>
                </div>

                <h3 className="text-base font-bold text-slate-900 tracking-tight">{h.name}</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{h.description}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono text-slate-600">
                <span className="flex items-center gap-1.5 font-bold text-slate-800">
                  <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                  {h.date}
                </span>
                <span className="text-[10px] text-slate-400">All Global Offices</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
