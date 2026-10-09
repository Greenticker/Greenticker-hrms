import { request } from './api';
import { OnboardingQueueItem, OnboardingQueueStats, InviteInfo } from '../types/onboardingQueue';

export const onboardingQueueService = {
  getQueue: async (): Promise<{
    submissions: OnboardingQueueItem[];
    stats: OnboardingQueueStats;
  }> => {
    return request<{ submissions: OnboardingQueueItem[]; stats: OnboardingQueueStats }>(
      '/onboarding/queue'
    );
  },

  getSubmission: async (id: string): Promise<{ submission: OnboardingQueueItem }> => {
    return request<{ submission: OnboardingQueueItem }>(`/onboarding/submissions/${id}`);
  },

  verifySubmission: async (
    id: string
  ): Promise<{ success: boolean; submission: OnboardingQueueItem }> => {
    return request<{ success: boolean; submission: OnboardingQueueItem }>(
      `/onboarding/submissions/${id}/verify`,
      {
        method: 'POST',
      }
    );
  },

  resendInvite: async (employeeId: string): Promise<{ success: boolean; invite: InviteInfo }> => {
    return request<{ success: boolean; invite: InviteInfo }>(
      `/onboarding/employees/${employeeId}/resend-invite`,
      { method: 'POST' }
    );
  },

  requestChanges: async (
    id: string,
    remarks: string
  ): Promise<{ success: boolean; submission: OnboardingQueueItem }> => {
    return request<{ success: boolean; submission: OnboardingQueueItem }>(
      `/onboarding/submissions/${id}/request-changes`,
      {
        method: 'POST',
        body: JSON.stringify({ remarks }),
      }
    );
  },
};