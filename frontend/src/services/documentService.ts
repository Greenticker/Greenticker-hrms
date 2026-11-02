import { request, getAuthToken } from './api';
import { DocumentItem } from '../types/documents';

const API_BASE = '/api';

export const documentService = {
  getDocuments: async (params?: {
    category?: string;
    status?: string;
    employeeId?: string;
  }): Promise<{ total: number; documents: DocumentItem[] }> => {
    const query = new URLSearchParams();

    if (params?.category && params.category !== 'ALL') {
      query.append('category', params.category);
    }

    if (params?.status && params.status !== 'ALL') {
      query.append('status', params.status);
    }

    if (params?.employeeId) {
      query.append('employeeId', params.employeeId);
    }

    const qs = query.toString() ? `?${query.toString()}` : '';

    return request<{ total: number; documents: DocumentItem[] }>(
      `/documents${qs}`
    );
  },

  uploadDocument: async (data: {
    employeeId?: string;
    category: string;
    title: string;
    file: File;
    expiryDate?: string;
  }): Promise<{ success: boolean; document: DocumentItem }> => {
    const formData = new FormData();

    formData.append('file', data.file);
    formData.append('category', data.category);
    formData.append('title', data.title);

    if (data.employeeId) {
      formData.append('employeeId', data.employeeId);
    }

    if (data.expiryDate) {
      formData.append('expiryDate', data.expiryDate);
    }

    const token = getAuthToken();

    const headers: Record<string, string> = {};

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/documents`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const contentType = response.headers.get('content-type');
    const isJson =
      contentType && contentType.includes('application/json');

    const dataResponse = isJson
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message =
        dataResponse?.detail ||
        dataResponse?.error ||
        response.statusText ||
        'Failed to upload document';

      throw new Error(message);
    }

    return dataResponse;
  },

  uploadMultipleDocuments: async (data: {
    employeeId?: string;
    category?: string;
    files: File[];
    filesMetadata?: Record<string, { title?: string; category?: string; expiryDate?: string }>;
    expiryDate?: string;
  }): Promise<{ success: boolean; documents: DocumentItem[]; count: number; totalSize: string; message: string }> => {
    const formData = new FormData();

    data.files.forEach((file) => {
      formData.append('files', file);
    });

    if (data.category) {
      formData.append('category', data.category);
    }

    if (data.employeeId) {
      formData.append('employeeId', data.employeeId);
    }

    if (data.expiryDate) {
      formData.append('expiryDate', data.expiryDate);
    }

    if (data.filesMetadata) {
      formData.append('filesMetadata', JSON.stringify(data.filesMetadata));
    }

    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/documents/multiple`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const contentType = response.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');
    const dataResponse = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const message =
        dataResponse?.detail ||
        dataResponse?.error ||
        response.statusText ||
        'Failed to upload documents';
      throw new Error(message);
    }

    return dataResponse;
  },

  verifyDocument: async (
    id: string
  ): Promise<{ success: boolean; document: DocumentItem }> => {
    return request<{ success: boolean; document: DocumentItem }>(
      `/documents/${id}/verify`,
      {
        method: 'POST',
      }
    );
  },

  rejectDocument: async (
    id: string,
    reason: string
  ): Promise<{ success: boolean; document: DocumentItem }> => {
    return request<{ success: boolean; document: DocumentItem }>(
      `/documents/${id}/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    );
  },

  deleteDocument: async (
    id: string
  ): Promise<{ success: boolean; message: string }> => {
    return request<{ success: boolean; message: string }>(
      `/documents/${id}`,
      {
        method: 'DELETE',
      }
    );
  },

  /**
   * Opens a document using an authenticated request.
   * This is used instead of window.open() because the API
   * requires the JWT Authorization header.
   */
  viewDocument: async (id: string): Promise<void> => {
    const token = getAuthToken();

    const response = await fetch(
      `${API_BASE}/documents/${id}/download`,
      {
        method: 'GET',
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : {},
      }
    );

    if (!response.ok) {
      throw new Error('Unable to open document');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    window.open(url, '_blank', 'noopener,noreferrer');

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60000);
  },

  /**
   * Downloads a document with authentication.
   */
  downloadDocument: async (
    id: string,
    fileName: string
  ): Promise<void> => {
    const token = getAuthToken();

    const response = await fetch(
      `${API_BASE}/documents/${id}/download`,
      {
        method: 'GET',
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : {},
      }
    );

    if (!response.ok) {
      throw new Error('Unable to download document');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);
  },

  /**
   * Restores a soft-deleted document (Admin only).
   */
  restoreDocument: async (id: string): Promise<{ success: boolean; message: string }> => {
    return request<{ success: boolean; message: string }>(`/documents/${id}/restore`, {
      method: 'POST',
    });
  },
};