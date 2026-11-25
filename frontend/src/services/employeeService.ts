import { request, api, getAuthToken, API_BASE, ApiError } from './api';
import { Employee, Department, Subdepartment, Designation, Location, OrgTreeNode, DirectoryEntry, Grade, ImportResponse } from '../types/employee';
import { InviteInfo } from '../types/onboardingQueue';

export interface EmployeesResponse {
  total: number;
  employees: Employee[];
  userRole: string;
  /** ALL (whole master), TEAM (a manager's reportees) or SELF */
  scope?: 'ALL' | 'TEAM' | 'SELF';
}

export interface EmployeeDetailResponse {
  employee: Employee;
  accessLevel: 'SELF' | 'ALL' | 'TEAM';
  canEdit?: boolean;
  canEditMaster?: boolean;
  canEditSalary?: boolean;
  canRequestBankChange?: boolean;
  canReviewBankChange?: boolean;
}

export const employeeService = {
  async getEmployees(params?: { search?: string; department?: string; status?: string }): Promise<EmployeesResponse> {
    const query = new URLSearchParams();
    if (params?.search) query.append('search', params.search);
    if (params?.department && params.department !== 'ALL') query.append('department', params.department);
    if (params?.status && params.status !== 'ALL') query.append('status', params.status);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return request<EmployeesResponse>(`/employees${queryString}`);
  },

  async getEmployeeById(id: string): Promise<EmployeeDetailResponse> {
    return request<EmployeeDetailResponse>(`/employees/${id}`);
  },

  /** Company directory: public contact details of every colleague. */
  async getDirectory(params?: { search?: string; department?: string }): Promise<{ total: number; employees: DirectoryEntry[] }> {
    const query = new URLSearchParams();
    if (params?.search) query.append('search', params.search);
    if (params?.department && params.department !== 'ALL') query.append('department', params.department);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<{ total: number; employees: DirectoryEntry[] }>(`/employees/directory${qs}`);
  },

  /** Downloads the CSV template for bulk employee import. */
  async downloadImportTemplate(): Promise<void> {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/employees/import-template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error || 'Could not download the template.', res.status, data);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'employee_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  },

  async bulkImport(file: File, options?: { dryRun?: boolean; sendInvites?: boolean }): Promise<ImportResponse> {
    const form = new FormData();
    form.append('file', file);
    form.append('dryRun', options?.dryRun ? 'true' : 'false');
    form.append('sendInvites', options?.sendInvites === false ? 'false' : 'true');
    return api.upload<ImportResponse>('/employees/bulk-import', form);
  },

  /** Ask for a new salary bank account; HR must verify it before payroll uses it. */
  async requestBankChange(
    id: string,
    data: { bankName: string; accountHolder: string; accountNumber: string; confirmAccountNumber: string; ifsc: string; branch?: string; reason?: string }
  ): Promise<{ success: boolean; message: string; employee: Employee }> {
    return request(`/employees/${id}/bank-change`, { method: 'POST', body: JSON.stringify(data) });
  },

  async reviewBankChange(id: string, decision: 'APPROVED' | 'REJECTED', comment?: string): Promise<{ success: boolean; employee: Employee }> {
    return request(`/employees/${id}/bank-change/review`, { method: 'POST', body: JSON.stringify({ decision, comment }) });
  },

  async getGrades(): Promise<{ grades: Grade[] }> {
    return request<{ grades: Grade[] }>('/grades');
  },

  async createGrade(data: { code: string; name: string; rank?: number; description?: string }): Promise<{ success: boolean; grade: Grade }> {
    return request<{ success: boolean; grade: Grade }>('/grades', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async createEmployee(data: Partial<Employee> & { panNumber?: string; aadhaarNumber?: string }): Promise<{ success: boolean; employee: Employee; invite: InviteInfo }> {
    return request<{ success: boolean; employee: Employee; invite: InviteInfo }>('/employees', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateEmployee(
    id: string,
    data: Partial<Employee> & { panNumber?: string; aadhaarNumber?: string }
  ): Promise<{ success: boolean; employee: Employee }> {
    return request<{ success: boolean; employee: Employee }>(`/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async setEmployeeStatus(id: string, status: string, isActive?: boolean): Promise<{ success: boolean; employee: Employee }> {
    return request<{ success: boolean; employee: Employee }>(`/employees/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, isActive }),
    });
  },

  async updateProbation(id: string, data: { probationMonths?: number; probationEndDate?: string; status?: string }): Promise<{ success: boolean; employee: Employee }> {
    return request<{ success: boolean; employee: Employee }>(`/employees/${id}/probation`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async getDepartments(): Promise<{ departments: Department[] }> {
    return request<{ departments: Department[] }>('/departments');
  },

  async createDepartment(data: { name: string; code: string; description?: string; headEmployeeId?: string }): Promise<{ success: boolean; department: Department }> {
    return request<{ success: boolean; department: Department }>('/departments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getSubdepartments(): Promise<{ subdepartments: Subdepartment[] }> {
    return request<{ subdepartments: Subdepartment[] }>('/subdepartments');
  },

  async createSubdepartment(data: {
    name: string;
    departmentName: string;
    code?: string;
    description?: string;
  }): Promise<{ success: boolean; subdepartment: Subdepartment }> {
    return request<{ success: boolean; subdepartment: Subdepartment }>('/subdepartments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getDesignations(): Promise<{ designations: Designation[] }> {
    return request<{ designations: Designation[] }>('/designations');
  },

  async createDesignation(data: { title: string; code?: string; level?: string; department?: string; subdepartment?: string; description?: string }): Promise<{ success: boolean; designation: Designation }> {
    return request<{ success: boolean; designation: Designation }>('/designations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async endDesignation(id: string, endReason?: string): Promise<{ success: boolean; designation: Designation; message: string }> {
    return request<{ success: boolean; designation: Designation; message: string }>(`/designations/${id}/end`, {
      method: 'POST',
      body: JSON.stringify({ endReason }),
    });
  },

  async getLocations(): Promise<{ locations: Location[] }> {
    return request<{ locations: Location[] }>('/locations');
  },

  async createLocation(data: Partial<Location>): Promise<{ location: Location }> {
    return request<{ location: Location }>('/locations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getHierarchy(): Promise<{ hierarchy: OrgTreeNode | null }> {
    return request<{ hierarchy: OrgTreeNode | null }>('/organization/hierarchy');
  },
};