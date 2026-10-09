import { request } from './api';
import { Employee, Department, Designation, Location, OrgTreeNode } from '../types/employee';
import { InviteInfo } from '../types/onboardingQueue';

export interface EmployeesResponse {
  total: number;
  employees: Employee[];
  userRole: string;
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

  async getEmployeeById(id: string): Promise<{ employee: Employee; accessLevel: string }> {
    return request<{ employee: Employee; accessLevel: string }>(`/employees/${id}`);
  },

  async createEmployee(data: Partial<Employee>): Promise<{ success: boolean; employee: Employee; invite: InviteInfo }> {
    return request<{ success: boolean; employee: Employee; invite: InviteInfo }>('/employees', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateEmployee(id: string, data: Partial<Employee>): Promise<{ success: boolean; employee: Employee }> {
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

  async getDepartments(): Promise<{ departments: Department[] }> {
    return request<{ departments: Department[] }>('/departments');
  },

  async createDepartment(data: { name: string; code: string; description?: string; headEmployeeId?: string }): Promise<{ success: boolean; department: Department }> {
    return request<{ success: boolean; department: Department }>('/departments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getDesignations(): Promise<{ designations: Designation[] }> {
    return request<{ designations: Designation[] }>('/designations');
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