import { request } from './api';
import { LifecycleEvent, LifecycleEventType } from '../types/lifecycle';

export const lifecycleService = {
  getEvents: async (params?: {
    eventType?: string;
    employeeId?: string;
  }): Promise<{ total: number; events: LifecycleEvent[] }> => {
    const query = new URLSearchParams();
    if (params?.eventType && params.eventType !== 'ALL') query.append('eventType', params.eventType);
    if (params?.employeeId) query.append('employeeId', params.employeeId);

    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<{ total: number; events: LifecycleEvent[] }>(`/lifecycle/events${qs}`);
  },

  createEvent: async (data: {
    employeeId: string;
    eventType: LifecycleEventType;
    effectiveDate: string;
    previousValue?: string;
    newValue: string;
    reason: string;
    notes?: string;
  }): Promise<{ success: boolean; event: LifecycleEvent; updatedEmployee?: any }> => {
    return request<{ success: boolean; event: LifecycleEvent; updatedEmployee?: any }>(
      '/lifecycle/events',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  },
};
