import { request } from './api';
import {
  AttendanceRecord,
  AttendanceStats,
  Shift,
} from '../types/attendance';

type GPSLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type AttendanceClockData = {
  employeeId?: string;
  location: GPSLocation;
};

export const attendanceService = {
  getAttendance: async (params?: {
    date?: string;
    month?: string;
    employeeId?: string;
    status?: string;
  }): Promise<{
    records: AttendanceRecord[];
    stats: AttendanceStats;
    userRole: string;
  }> => {
    const query = new URLSearchParams();

    if (params?.date) {
      query.append('date', params.date);
    }

    if (params?.month) {
      query.append('month', params.month);
    }

    if (params?.employeeId) {
      query.append('employeeId', params.employeeId);
    }

    if (params?.status && params.status !== 'ALL') {
      query.append('status', params.status);
    }

    const qs = query.toString() ? `?${query.toString()}` : '';

    return request<{
      records: AttendanceRecord[];
      stats: AttendanceStats;
      userRole: string;
    }>(`/attendance${qs}`);
  },

  /**
   * Check in an employee.
   *
   * GPS location is mandatory.
   */
  checkIn: async (
    data: AttendanceClockData
  ): Promise<{
    success: boolean;
    message: string;
    record: AttendanceRecord;
  }> => {
    const payload = {
      ...data,
      clientTime: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    };
    return request<{
      success: boolean;
      message: string;
      record: AttendanceRecord;
    }>('/attendance/check-in', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Check out an employee.
   *
   * GPS location is mandatory.
   */
  checkOut: async (
    data: AttendanceClockData
  ): Promise<{
    success: boolean;
    message: string;
    record: AttendanceRecord;
  }> => {
    const payload = {
      ...data,
      clientTime: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    };
    return request<{
      success: boolean;
      message: string;
      record: AttendanceRecord;
    }>('/attendance/check-out', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  regularize: async (
    id: string,
    data: {
      checkInTime?: string;
      checkOutTime?: string;
      status?: string;
      reason: string;
    }
  ): Promise<{
    success: boolean;
    record: AttendanceRecord;
  }> => {
    return request<{
      success: boolean;
      record: AttendanceRecord;
    }>(`/attendance/${id}/regularize`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getShifts: async (): Promise<{
    shifts: Shift[];
  }> => {
    return request<{
      shifts: Shift[];
    }>('/shifts');
  },

  createShift: async (
    data: Omit<Shift, '_id' | 'createdAt'>
  ): Promise<{
    success: boolean;
    shift: Shift;
  }> => {
    return request<{
      success: boolean;
      shift: Shift;
    }>('/shifts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateShift: async (
    id: string,
    data: Partial<Shift>
  ): Promise<{
    success: boolean;
    shift: Shift;
  }> => {
    return request<{
      success: boolean;
      shift: Shift;
    }>(`/shifts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  endShift: async (
    id: string,
    reason?: string
  ): Promise<{
    success: boolean;
    message: string;
    shift: Shift;
  }> => {
    return request<{
      success: boolean;
      message: string;
      shift: Shift;
    }>(`/shifts/${id}/end`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  deleteShift: async (
    id: string
  ): Promise<{
    success: boolean;
    message: string;
  }> => {
    return request<{
      success: boolean;
      message: string;
    }>(`/shifts/${id}`, {
      method: 'DELETE',
    });
  },
};