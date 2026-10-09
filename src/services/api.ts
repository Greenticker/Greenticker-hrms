export const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export function getAuthToken(): string | null {
  return localStorage.getItem('zenith_auth_token');
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem('zenith_auth_token', token);
  } else {
    localStorage.removeItem('zenith_auth_token');
  }
}

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMsg = (data && data.error) || response.statusText || 'An unexpected error occurred';
    throw new ApiError(errorMsg, response.status, data);
  }

  return data as T;
}

export const api = {
  get: <T = any>(endpoint: string) => request<T>(endpoint, { method: 'GET' }),
  post: <T = any>(endpoint: string, body?: any) => request<T>(endpoint, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T = any>(endpoint: string, body?: any) => request<T>(endpoint, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
  upload: async <T = any>(endpoint: string, formData: FormData) => {
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.error || 'Upload failed', response.status, data);
    }
    return data as T;
  },
};
