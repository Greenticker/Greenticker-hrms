import { MapPin, ShieldCheck, Radio } from 'lucide-react';

interface GeofenceD3SummaryProps {
  records: any[];
}

const OFFICE_SITES = [
  { city: 'Pune',      match: 'pune',      name: 'Mantri Alpine, Bavdhan' },
  { city: 'Bengaluru', match: 'bengaluru', name: 'Prestige Tech Park HQ'  },
  { city: 'Mumbai',    match: 'mumbai',    name: 'Financial Hub BKC'      },
  { city: 'Hyderabad', match: 'hyderabad', name: 'HITEC City Center'      },
  { city: 'Delhi',     match: 'delhi',     name: 'Cyber City NCR'         },
];

export const GeofenceD3Summary: React.FC<GeofenceD3SummaryProps> = ({ records }) => {
  const wfoRecords = records.filter((r) => r.workMode === 'WORK_FROM_OFFICE');

  const offices = OFFICE_SITES.map((site) => ({
    ...site,
    checkedInCount: wfoRecords.filter(
      (r) =>
        r.location?.toLowerCase().includes(site.match) ||
        r.department?.toLowerCase().includes(site.match) ||
        r.checkInLocation?.toLowerCase().includes(site.match)
    ).length,
    radiusKm: 0.5,
    active: true,
  }));

  const totalOfficeCheckins = offices.reduce((acc, o) => acc + o.checkedInCount, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between h-full space-y-3">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-[#039583] animate-pulse" />
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Geofence Status
          </h3>
        </div>
        <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-[11px] font-bold text-emerald-800">
            {totalOfficeCheckins} Inside Perimeter
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 my-auto">
        {offices.map((o) => (
          <div key={o.city} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-center space-y-0.5">
            <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-slate-800">
              <MapPin className="w-3 h-3 text-[#039583]" />
              {o.city}
            </div>
            <p className="text-xs font-black text-[#023b77]">{o.checkedInCount} Staff</p>
            <p className="text-[9px] text-slate-400 font-mono">0.5 km radius</p>
          </div>
        ))}
      </div>
    </div>
  );
};
