import { request, api, API_BASE, getAuthToken, ApiError } from './api';
import { JobCandidate, JobOpening, MyInterview, OfferVersion, Requisition } from '../types/modules';

async function download(path: string, fileName: string): Promise<void> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'Download failed.', res.status, data);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const post = <T = any>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T = any>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });

export interface OfferInput {
  annualCtc: number;
  designation: string;
  joiningDate: string;
  validTill: string;
  location: string;
  reportingTo?: string;
  notes?: string;
  revisionReason?: string;
}

export const recruitmentService = {
  // Requisitions: manager raises -> finance approves budget -> HR publishes
  getRequisitions: () => request<{ requisitions: Requisition[] }>('/recruitment/requisitions'),
  createRequisition: (data: Record<string, unknown>) =>
    post<{ success: boolean; requisition: Requisition; message: string }>('/recruitment/requisitions', data),
  reviewRequisition: (id: string, decision: 'APPROVED' | 'REJECTED', comment?: string) =>
    put<{ success: boolean; requisition: Requisition }>(`/recruitment/requisitions/${id}/review`, { decision, comment }),
  publishRequisition: (id: string, channels: string[]) =>
    post<{ success: boolean; job: JobOpening }>(`/recruitment/requisitions/${id}/publish`, { channels }),

  getJobs: () => request<{ jobs: JobOpening[] }>('/recruitment/jobs'),

  // Candidates
  getCandidates: (params?: { jobId?: string; includeArchived?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.jobId) q.append('jobId', params.jobId);
    if (params?.includeArchived) q.append('includeArchived', 'true');
    const qs = q.toString() ? `?${q.toString()}` : '';
    return request<{ candidates: JobCandidate[] }>(`/recruitment/candidates${qs}`);
  },
  addCandidate: (data: Record<string, string>, resume?: File | null) => {
    const form = new FormData();
    Object.entries(data).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') form.append(k, v);
    });
    if (resume) form.append('resume', resume);
    return api.upload<{ success: boolean; candidate: JobCandidate }>('/recruitment/candidates', form);
  },
  updateCandidate: (id: string, data: Record<string, unknown>) =>
    put<{ success: boolean; candidate: JobCandidate }>(`/recruitment/candidates/${id}`, data),
  downloadResume: (id: string, fileName?: string) => download(`/recruitment/candidates/${id}/resume`, fileName || 'resume'),
  shortlist: (id: string) => post<{ success: boolean; candidate: JobCandidate }>(`/recruitment/candidates/${id}/shortlist`),
  scheduleInterview: (id: string, data: Record<string, unknown>) =>
    post<{ success: boolean; candidate: JobCandidate; message: string; sentFrom: string }>(
      `/recruitment/candidates/${id}/schedule-interview`,
      data
    ),
  downloadCalendar: (id: string, round: number) =>
    download(`/recruitment/candidates/${id}/rounds/${round}/calendar.ics`, `interview-round-${round}.ics`),
  recordDecision: (id: string, data: Record<string, unknown>) =>
    post<{ success: boolean; candidate: JobCandidate; message?: string }>(`/recruitment/candidates/${id}/feedback`, data),
  extendOffer: (id: string, data: OfferInput) =>
    post<{ success: boolean; candidate: JobCandidate; offer: OfferVersion; message: string; requiresApproval: boolean }>(
      `/recruitment/candidates/${id}/extend-offer`,
      data
    ),
  approveOffer: (id: string, decision: 'APPROVED' | 'REJECTED', comment?: string) =>
    post<{ success: boolean; candidate: JobCandidate; offer: OfferVersion }>(`/recruitment/candidates/${id}/offer/approve`, {
      decision,
      comment,
    }),
  recordOfferResponse: (id: string, response: 'ACCEPTED' | 'DECLINED', comment?: string) =>
    post<{ success: boolean; candidate: JobCandidate }>(`/recruitment/candidates/${id}/offer/respond`, { response, comment }),
  convertToEmployee: (id: string, data: Record<string, string>) =>
    post<{ success: boolean; candidate: JobCandidate; message: string }>(`/recruitment/candidates/${id}/convert-to-employee`, data),
  reject: (id: string, reason: string, notifyCandidate: boolean) =>
    post<{ success: boolean; candidate: JobCandidate; message: string }>(`/recruitment/candidates/${id}/reject`, {
      reason,
      notifyCandidate,
    }),

  // Interview panel members
  getMyInterviews: () => request<{ interviews: MyInterview[] }>('/recruitment/my-interviews'),
  submitPanelFeedback: (id: string, round: number, data: { rating: number; comments: string; recommendation: string }) =>
    post<{ success: boolean; message: string }>(`/recruitment/candidates/${id}/rounds/${round}/panel-feedback`, data),
};
