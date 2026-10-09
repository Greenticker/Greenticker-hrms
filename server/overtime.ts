export const SHIFT_MINUTES = 8 * 60; // standard shift, break included
export const UNPAID_BUFFER_LIMIT_MINUTES = 10 * 60; // up to 10h => nothing extra
export const TIER_TWO_LIMIT_MINUTES = 14 * 60; // 10h-14h => tier 1, above 14h => tier 2

export type ExtraPayTier = 'NONE' | 'HALF_DAY' | 'FULL_DAY' | 'ONE_AND_HALF_DAY';

export interface ShiftCredit {
  extraDayCredit: number; // 0, 0.5, 1 or 1.5
  tier: ExtraPayTier;
  extraMinutes: number; // minutes beyond the 8h shift (informational)
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

// If check-out is earlier than check-in, the shift crossed midnight.
export function grossMinutesBetween(checkIn: string, checkOut: string): number {
  const start = toMinutes(checkIn);
  const end = toMinutes(checkOut);
  return end >= start ? end - start : end + 24 * 60 - start;
}

export function computeShiftCredit(grossMinutes: number, isNightShift: boolean): ShiftCredit {
  const extraMinutes = Math.max(0, grossMinutes - SHIFT_MINUTES);
  return { extraDayCredit: 0, tier: 'NONE', extraMinutes };
}

export const describeTier = (tier: ExtraPayTier): string => {
  switch (tier) {
    case 'HALF_DAY': return '+0.5 day';
    case 'FULL_DAY': return '+1 day';
    case 'ONE_AND_HALF_DAY': return '+1.5 days';
    default: return 'No extra pay';
  }
};