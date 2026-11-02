import { request } from './api';
import { GalleryLetterTemplate, LetterPreview, LetterTemplate } from '../types/letterTemplates';

export const letterTemplateService = {
  getTemplates: async (): Promise<{ templates: LetterTemplate[] }> => {
    return request<{ templates: LetterTemplate[] }>('/letter-templates');
  },

  updateTemplate: async (
    id: string,
    data: Pick<LetterTemplate, 'title' | 'category' | 'subject' | 'content'>
  ): Promise<{ success: boolean; template: LetterTemplate }> => {
    return request<{ success: boolean; template: LetterTemplate }>(`/letter-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteTemplate: async (id: string): Promise<{ success: boolean }> => {
    return request<{ success: boolean }>(`/letter-templates/${id}`, { method: 'DELETE' });
  },

  previewTemplate: async (id: string, employeeId?: string): Promise<LetterPreview> => {
    return request<LetterPreview>(`/letter-templates/${id}/preview`, {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    });
  },

  getGallery: async (): Promise<{ templates: GalleryLetterTemplate[] }> => {
    return request<{ templates: GalleryLetterTemplate[] }>('/letter-templates/gallery');
  },

  previewGalleryTemplate: async (key: string, employeeId?: string): Promise<LetterPreview> => {
    return request<LetterPreview>(`/letter-templates/gallery/${key}/preview`, {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    });
  },

  /** Copies a gallery template into the organisation's own templates (admin only). */
  useGalleryTemplate: async (key: string): Promise<{ success: boolean; template: LetterTemplate }> => {
    return request<{ success: boolean; template: LetterTemplate }>(`/letter-templates/gallery/${key}/use`, {
      method: 'POST',
    });
  },
};
