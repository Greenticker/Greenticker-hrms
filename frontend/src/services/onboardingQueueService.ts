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

  reviewSection: async (
    id: string,
    sectionKey: string,
    status: 'VERIFIED' | 'NEEDS_CORRECTION',
    remarks?: string
  ): Promise<{ success: boolean; submission: OnboardingQueueItem; allCleared?: boolean; sectionKey?: string }> => {
    return request<{ success: boolean; submission: OnboardingQueueItem; allCleared?: boolean; sectionKey?: string }>(
      `/onboarding/submissions/${id}/section-review`,
      {
        method: 'POST',
        body: JSON.stringify({ sectionKey, status, remarks }),
      }
    );
  },

  sendConsolidatedRevisions: async (
    id: string,
    revisions?: Array<{ sectionKey: string; remarks: string }>,
    generalNote?: string
  ): Promise<{
    success: boolean;
    submission: OnboardingQueueItem;
    revisionsCount: number;
    recipientEmail: string;
    emailSent: boolean;
  }> => {
    return request<{
      success: boolean;
      submission: OnboardingQueueItem;
      revisionsCount: number;
      recipientEmail: string;
      emailSent: boolean;
    }>(`/onboarding/submissions/${id}/send-revisions`, {
      method: 'POST',
      body: JSON.stringify({ revisions, generalNote }),
    });
  },
};