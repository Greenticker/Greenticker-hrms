/**
 * Geofence helpers for GPS attendance.
 *
 * Rule: an attendance day is WORK_FROM_OFFICE only when BOTH the check-in and the
 * check-out GPS fixes are within OFFICE_RADIUS_KM (0.5 km) of the employee's office.
 * Anything else is WORK_FROM_HOME.
 *
 * IMPORTANT: replace the coordinates below with the exact latitude / longitude of
 * each of your offices (right-click the building in Google Maps -> click the
 * coordinates to copy them). You can also override them without code changes:
 *   OFFICE_COORDS='[{"match":"bengaluru","name":"Bengaluru HQ","latitude":12.9352,"longitude":77.6245}]'
 */

export const OFFICE_RADIUS_KM = 0.5;

export interface OfficeSite {
  /** lower-case text matched against the employee's `location` string */
  match: string;
  name: string;
  latitude: number;
  longitude: number;
}

// Approximate coordinates - please verify / replace with your exact office pins.
const DEFAULT_OFFICES: OfficeSite[] = [
  { match: 'pune', name: 'Office No. 102, Mantri Alpine, SN.O 268, Sunarwadi, Bhunde Vasti, Bavdhan, Pune, Maharashtra 411021', latitude: 18.5204, longitude: 73.7845 },
  { match: 'bengaluru', name: 'Bengaluru HQ (Prestige Tech Park)', latitude: 12.9373, longitude: 77.6969 },
  { match: 'mumbai', name: 'Mumbai Financial Hub (BKC)', latitude: 19.0669, longitude: 72.8696 },
  { match: 'hyderabad', name: 'Hyderabad Tech Center (HITEC City)', latitude: 17.4435, longitude: 78.3772 },
  { match: 'delhi', name: 'Delhi NCR Cyber City', latitude: 28.4950, longitude: 77.0890 },
];

function loadOffices(): OfficeSite[] {
  try {
    if (process.env.OFFICE_COORDS) {
      const parsed = JSON.parse(process.env.OFFICE_COORDS);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((o) => o && Number.isFinite(o.latitude) && Number.isFinite(o.longitude))
          .map((o) => ({
            match: String(o.match || o.name || '').toLowerCase(),
            name: String(o.name || o.match || 'Office'),
            latitude: Number(o.latitude),
            longitude: Number(o.longitude),
          }));
      }
    }
  } catch (err) {
    console.error('[geofence] OFFICE_COORDS is not valid JSON, using defaults.', err);
  }
  return DEFAULT_OFFICES;
}

const OFFICES = loadOffices();

export function findOfficeForLocation(employeeLocation?: string): OfficeSite {
  const text = (employeeLocation || '').toLowerCase();
  return OFFICES.find((o) => o.match && text.includes(o.match)) || OFFICES[0];
}

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type WorkMode = 'WORK_FROM_OFFICE' | 'WORK_FROM_HOME';

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export function isValidFix(g: any): g is GeoFix {
  return (
    g &&
    typeof g === 'object' &&
    Number.isFinite(g.latitude) &&
    Number.isFinite(g.longitude) &&
    Math.abs(g.latitude) <= 90 &&
    Math.abs(g.longitude) <= 180
  );
}

/** Distance (km, 3 dp) from the employee's office for one GPS fix. */
export function distanceFromOffice(fix: GeoFix, employeeLocation?: string): { office: OfficeSite; km: number } {
  const office = findOfficeForLocation(employeeLocation);
  const km = distanceKm(fix.latitude, fix.longitude, office.latitude, office.longitude);
  return { office, km: Math.round(km * 1000) / 1000 };
}

export const isWithinOffice = (km: number) => km <= OFFICE_RADIUS_KM;
