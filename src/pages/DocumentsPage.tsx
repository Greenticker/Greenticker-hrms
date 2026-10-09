import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { documentService } from '../services/documentService';
import { employeeService } from '../services/employeeService';
import {
  DocumentItem,
  DocumentCategory,
} from '../types/documents';
import { Employee } from '../types/employee';

import {
  FileText,
  Search,
  Filter,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Download,
  Trash2,
  X,
  Upload,
  Calendar,
  Building,
  Eye,
  Check,
  FileCheck,
  Loader2,
  User,
} from 'lucide-react';

const CATEGORY_OPTIONS: {
  id: DocumentCategory;
  label: string;
}[] = [
  {
    id: 'IDENTITY',
    label: 'Identity & Legal',
  },
  {
    id: 'EDUCATION',
    label: 'Education & Degrees',
  },
  {
    id: 'EMPLOYMENT',
    label: 'Employment & Relieving',
  },
  {
    id: 'CERTIFICATION',
    label: 'Professional Certifications',
  },
  {
    id: 'TAX',
    label: 'Tax & Compliance',
  },
  {
    id: 'LEGAL',
    label: 'NDA & Legal Agreements',
  },
];

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatDate = (date?: string): string => {
  if (!date) return '-';

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString();
};

const getStatusClasses = (status: DocumentItem['status']) => {
  switch (status) {
    case 'VERIFIED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-100';

    case 'REJECTED':
      return 'bg-rose-50 text-rose-700 border-rose-100';

    default:
      return 'bg-amber-50 text-amber-700 border-amber-100';
  }
};

const getCategoryLabel = (category: DocumentCategory): string => {
  return (
    CATEGORY_OPTIONS.find((item) => item.id === category)?.label ||
    category
  );
};

export const DocumentsPage: React.FC = () => {
  const { user } = useAuth();

  const isAdminOrHr =
    user?.role === 'ADMIN';

  const currentEmpId =
    user?.employee?._id ||
    user?.employeeId ||
    '';

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] =
    useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] =
    useState<string>('ALL');

  // Upload modal
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [uploadFormData, setUploadFormData] = useState({
    employeeId: currentEmpId,
    category: 'IDENTITY' as DocumentCategory,
    title: '',
    expiryDate: '',
  });

  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);

  // Reject modal
  const [rejectingDocId, setRejectingDocId] =
    useState<string | null>(null);

  const [rejectionReason, setRejectionReason] =
    useState('');

  // Preview modal
  const [previewDoc, setPreviewDoc] =
    useState<DocumentItem | null>(null);

  const [processingDocumentId, setProcessingDocumentId] =
    useState<string | null>(null);

  const showFeedback = (message: string) => {
    setFeedbackMsg(message);

    window.setTimeout(() => {
      setFeedbackMsg(null);
    }, 3500);
  };

  const fetchDocs = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      const documentResponse =
        await documentService.getDocuments({
          category: selectedCategory,
          status: selectedStatus,
        });

      setDocuments(documentResponse.documents || []);

      if (isAdminOrHr) {
        const employeeResponse =
          await employeeService.getEmployees();

        if (employeeResponse?.employees) {
          setEmployees(employeeResponse.employees);
        }
      }
    } catch (error) {
      console.error(
        'Failed to load documents:',
        error
      );

      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Failed to load documents.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, [selectedCategory, selectedStatus]);

  useEffect(() => {
    setUploadFormData((previous) => ({
      ...previous,
      employeeId:
        previous.employeeId || currentEmpId,
    }));
  }, [currentEmpId]);

  const resetUploadForm = () => {
    setUploadFormData({
      employeeId: currentEmpId,
      category: 'IDENTITY',
      title: '',
      expiryDate: '',
    });

    setSelectedFile(null);
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);

    // If title is empty, automatically use the filename.
    if (!uploadFormData.title.trim()) {
      setUploadFormData((previous) => ({
        ...previous,
        title: file.name.replace(/\.[^/.]+$/, ''),
      }));
    }
  };

  const handleUploadSubmit = async (
    event: React.FormEvent
  ) => {
    event.preventDefault();

    if (!uploadFormData.title.trim()) {
      setErrorMsg('Please enter a document title.');
      return;
    }

    if (!selectedFile) {
      setErrorMsg('Please select a file to upload.');
      return;
    }

    if (!uploadFormData.employeeId) {
      setErrorMsg('Please select an employee.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const response =
        await documentService.uploadDocument({
          employeeId: uploadFormData.employeeId,
          category: uploadFormData.category,
          title: uploadFormData.title.trim(),
          file: selectedFile,
          expiryDate:
            uploadFormData.expiryDate || undefined,
        });

      if (response.success) {
        showFeedback(
          `Document "${response.document.title}" uploaded successfully.`
        );

        setIsUploadOpen(false);
        resetUploadForm();

        await fetchDocs();
      }
    } catch (error) {
      console.error(
        'Failed to upload document:',
        error
      );

      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Failed to upload document.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (id: string) => {
    setProcessingDocumentId(id);
    setErrorMsg(null);

    try {
      const response =
        await documentService.verifyDocument(id);

      if (response.success) {
        showFeedback(
          'Document verified successfully.'
        );

        await fetchDocs();

        if (previewDoc?._id === id) {
          setPreviewDoc(response.document);
        }
      }
    } catch (error) {
      console.error(
        'Failed to verify document:',
        error
      );

      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Failed to verify document.'
      );
    } finally {
      setProcessingDocumentId(null);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectingDocId) return;

    if (!rejectionReason.trim()) {
      setErrorMsg(
        'Please enter a rejection reason.'
      );
      return;
    }

    setProcessingDocumentId(rejectingDocId);
    setErrorMsg(null);

    try {
      const response =
        await documentService.rejectDocument(
          rejectingDocId,
          rejectionReason.trim()
        );

      if (response.success) {
        showFeedback(
          'Document rejected and reason recorded.'
        );

        setRejectingDocId(null);
        setRejectionReason('');

        await fetchDocs();

        if (
          previewDoc?._id === rejectingDocId
        ) {
          setPreviewDoc(response.document);
        }
      }
    } catch (error) {
      console.error(
        'Failed to reject document:',
        error
      );

      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Failed to reject document.'
      );
    } finally {
      setProcessingDocumentId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm(
      'Are you sure you want to delete this document? This action cannot be undone.'
    );

    if (!confirmed) return;

    setProcessingDocumentId(id);
    setErrorMsg(null);

    try {
      const response =
        await documentService.deleteDocument(id);

      if (response.success) {
        showFeedback('Document deleted.');

        if (previewDoc?._id === id) {
          setPreviewDoc(null);
        }

        await fetchDocs();
      }
    } catch (error) {
      console.error(
        'Failed to delete document:',
        error
      );

      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Failed to delete document.'
      );
    } finally {
      setProcessingDocumentId(null);
    }
  };

  const handleView = async (
    document: DocumentItem
  ) => {
    setProcessingDocumentId(document._id);
    setErrorMsg(null);

    try {
      await documentService.viewDocument(
        document._id
      );
    } catch (error) {
      console.error(
        'Failed to view document:',
        error
      );

      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Unable to open document.'
      );
    } finally {
      setProcessingDocumentId(null);
    }
  };

  const handleDownload = async (
    document: DocumentItem
  ) => {
    setProcessingDocumentId(document._id);
    setErrorMsg(null);

    try {
      await documentService.downloadDocument(
        document._id,
        document.fileName
      );

      showFeedback('Document download started.');
    } catch (error) {
      console.error(
        'Failed to download document:',
        error
      );

      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Unable to download document.'
      );
    } finally {
      setProcessingDocumentId(null);
    }
  };

  const filteredDocs = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return documents;
    }

    return documents.filter((doc) => {
      return (
        doc.title?.toLowerCase().includes(query) ||
        doc.employeeName
          ?.toLowerCase()
          .includes(query) ||
        doc.employeeCode
          ?.toLowerCase()
          .includes(query) ||
        doc.fileName
          ?.toLowerCase()
          .includes(query) ||
        doc.category
          ?.toLowerCase()
          .includes(query)
      );
    });
  }, [documents, search]);

  const statistics = useMemo(() => {
    return {
      total: documents.length,

      verified: documents.filter(
        (doc) => doc.status === 'VERIFIED'
      ).length,

      pending: documents.filter(
        (doc) => doc.status === 'PENDING'
      ).length,

      rejected: documents.filter(
        (doc) => doc.status === 'REJECTED' || (doc.status as string) === 'REVISION_REQUESTED'
      ).length,
    };
  }, [documents]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Document Management
          </h1>
        </div>

        <button
          onClick={() => {
            resetUploadForm();
            setIsUploadOpen(true);
            setErrorMsg(null);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#039583] hover:bg-[#023b77] text-white font-semibold text-xs shadow-sm shrink-0 border border-[#039583]"
        >
          <Plus className="w-4 h-4" />
          Upload Document
        </button>
      </div>

      {/* Feedback */}
      {feedbackMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {feedbackMsg}
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>

          <button
            onClick={() => setErrorMsg(null)}
            className="text-rose-500 hover:text-rose-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">
                Total Documents
              </p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {statistics.total}
              </p>
            </div>

            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
              <FileText className="w-4 h-4 text-slate-600" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">
                Verified
              </p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">
                {statistics.verified}
              </p>
            </div>

            <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">
                Pending
              </p>
              <p className="text-2xl font-bold text-amber-600 mt-1">
                {statistics.pending}
              </p>
            </div>

            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">
                Revision Requested
              </p>
              <p className="text-2xl font-bold text-rose-600 mt-1">
                {statistics.rejected}
              </p>
            </div>

            <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

            <input
              type="text"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search documents, employees or file names..."
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />

            <select
              value={selectedCategory}
              onChange={(event) =>
                setSelectedCategory(event.target.value)
              }
              className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none"
            >
              <option value="ALL">
                All Categories
              </option>

              {CATEGORY_OPTIONS.map((category) => (
                <option
                  key={category.id}
                  value={category.id}
                >
                  {category.label}
                </option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={(event) =>
                setSelectedStatus(event.target.value)
              }
              className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none"
            >
              <option value="ALL">
                All Statuses
              </option>
              <option value="PENDING">
                Pending
              </option>
              <option value="VERIFIED">
                Verified
              </option>
              <option value="REVISION_REQUESTED">
                Revision Requested
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* Documents */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Documents
            </h2>

            <p className="text-xs text-slate-500 mt-0.5">
              {filteredDocs.length} document
              {filteredDocs.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mb-3" />

            <p className="text-xs">
              Loading documents...
            </p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400">
            <FileText className="w-10 h-10 mb-3 text-slate-300" />

            <p className="text-sm font-semibold text-slate-600">
              No documents found
            </p>

            <p className="text-xs mt-1">
              Upload a document to get started.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    Document
                  </th>

                  {isAdminOrHr && (
                    <th className="px-5 py-3 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                      Employee
                    </th>
                  )}

                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    Category
                  </th>

                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    Status
                  </th>

                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    Uploaded
                  </th>

                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider font-bold text-slate-400 text-right">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredDocs.map((doc) => (
                  <tr
                    key={doc._id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-4 h-4 text-blue-600" />
                        </div>

                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate max-w-[240px]">
                            {doc.title}
                          </p>

                          <p className="text-[10px] text-slate-400 truncate max-w-[240px] mt-0.5">
                            {doc.fileName} · {doc.fileSize}
                          </p>
                        </div>
                      </div>
                    </td>

                    {isAdminOrHr && (
                      <td className="px-5 py-4">
                        <div>
                          <p className="text-xs font-medium text-slate-800">
                            {doc.employeeName ||
                              'Unknown employee'}
                          </p>

                          <p className="text-[10px] text-slate-400">
                            {doc.employeeCode || '-'}
                          </p>
                        </div>
                      </td>
                    )}

                    <td className="px-5 py-4">
                      <span className="text-xs text-slate-600">
                        {getCategoryLabel(doc.category)}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-semibold ${getStatusClasses(
                          doc.status
                        )}`}
                      >
                        {doc.status ===
                          'VERIFIED' && (
                          <CheckCircle2 className="w-3 h-3" />
                        )}

                        {doc.status ===
                          'PENDING' && (
                          <Clock className="w-3 h-3" />
                        )}

                        {doc.status ===
                          'REJECTED' && (
                          <AlertTriangle className="w-3 h-3" />
                        )}

                        {doc.status}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />

                        {formatDate(doc.uploadedAt)}
                      </div>

                      {doc.expiryDate && (
                        <p className="text-[10px] text-slate-400 mt-1">
                          Expires:{' '}
                          {formatDate(
                            doc.expiryDate
                          )}
                        </p>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() =>
                            handleView(doc)
                          }
                          disabled={
                            processingDocumentId ===
                            doc._id
                          }
                          title="View document"
                          className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                        >
                          {processingDocumentId ===
                          doc._id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() =>
                            handleDownload(doc)
                          }
                          disabled={
                            processingDocumentId ===
                            doc._id
                          }
                          title="Download document"
                          className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        {isAdminOrHr &&
                          doc.status !==
                            'VERIFIED' && (
                            <button
                              onClick={() =>
                                handleVerify(
                                  doc._id
                                )
                              }
                              disabled={
                                processingDocumentId ===
                                doc._id
                              }
                              title="Verify document"
                              className="p-2 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          )}

                        {isAdminOrHr &&
                          doc.status !==
                            'REJECTED' && (
                            <button
                              onClick={() => {
                                setRejectingDocId(
                                  doc._id
                                );
                                setRejectionReason('');
                              }}
                              title="Reject document"
                              className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                            >
                              <AlertTriangle className="w-4 h-4" />
                            </button>
                          )}

                        {isAdminOrHr && (
                          <button
                            onClick={() =>
                              handleDelete(
                                doc._id
                              )
                            }
                            disabled={
                              processingDocumentId ===
                              doc._id
                            }
                            title="Delete document"
                            className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Upload Document
                </h3>

                <p className="text-xs text-slate-500 mt-0.5">
                  Add an employee document to the HRMS.
                </p>
              </div>

              <button
                onClick={() => {
                  setIsUploadOpen(false);
                  resetUploadForm();
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleUploadSubmit}
              className="p-6 space-y-4"
            >
              {isAdminOrHr && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Employee *
                  </label>

                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

                    <select
                      value={
                        uploadFormData.employeeId
                      }
                      onChange={(event) =>
                        setUploadFormData({
                          ...uploadFormData,
                          employeeId:
                            event.target.value,
                        })
                      }
                      required
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    >
                      <option value="">
                        Select employee
                      </option>

                      {employees.map((employee) => (
                        <option
                          key={employee._id}
                          value={employee._id}
                        >
                          {employee.firstName}{' '}
                          {employee.lastName} (
                          {employee.employeeCode})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Document Category *
                  </label>

                  <select
                    value={
                      uploadFormData.category
                    }
                    onChange={(event) =>
                      setUploadFormData({
                        ...uploadFormData,
                        category:
                          event.target
                            .value as DocumentCategory,
                      })
                    }
                    required
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  >
                    {CATEGORY_OPTIONS.map(
                      (category) => (
                        <option
                          key={category.id}
                          value={category.id}
                        >
                          {category.label}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Expiry Date
                  </label>

                  <input
                    type="date"
                    value={
                      uploadFormData.expiryDate
                    }
                    onChange={(event) =>
                      setUploadFormData({
                        ...uploadFormData,
                        expiryDate:
                          event.target.value,
                      })
                    }
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Document Title *
                </label>

                <input
                  type="text"
                  value={uploadFormData.title}
                  onChange={(event) =>
                    setUploadFormData({
                      ...uploadFormData,
                      title: event.target.value,
                    })
                  }
                  placeholder="e.g. Passport, Degree Certificate"
                  required
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
              </div>

              {/* Real file input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Document File *
                </label>

                <label className="block cursor-pointer">
                  <div className="border-2 border-dashed border-slate-300 hover:border-slate-400 rounded-2xl p-6 text-center bg-slate-50/70 hover:bg-slate-50 transition">
                    <Upload className="w-7 h-7 text-slate-400 mx-auto mb-2" />

                    {selectedFile ? (
                      <>
                        <p className="text-xs font-semibold text-slate-800 break-all">
                          {selectedFile.name}
                        </p>

                        <p className="text-[10px] text-slate-400 mt-1">
                          {selectedFile.type ||
                            'Unknown file type'}{' '}
                          ·{' '}
                          {formatFileSize(
                            selectedFile.size
                          )}
                        </p>

                        <p className="text-[10px] text-blue-600 font-semibold mt-2">
                          Click to replace file
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-slate-700">
                          Click to select a file
                        </p>

                        <p className="text-[10px] text-slate-400 mt-1">
                          PDF, JPG, JPEG, PNG or other
                          supported document
                        </p>
                      </>
                    )}
                  </div>

                  <input
                    type="file"
                    onChange={handleFileChange}
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsUploadOpen(false);
                    resetUploadForm();
                  }}
                  className="px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    !selectedFile
                  }
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}

                  {isSubmitting
                    ? 'Uploading...'
                    : 'Upload Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectingDocId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />

                  <h3 className="text-sm font-bold text-slate-900">
                    Reject Document
                  </h3>
                </div>

                <p className="text-xs text-slate-500 mt-2">
                  Enter the reason this document is being
                  rejected.
                </p>
              </div>

              <button
                onClick={() =>
                  setRejectingDocId(null)
                }
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              rows={4}
              value={rejectionReason}
              onChange={(event) =>
                setRejectionReason(
                  event.target.value
                )
              }
              placeholder="e.g. Document is expired or the uploaded scan is not readable."
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-rose-500/20"
            />

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  setRejectingDocId(null);
                  setRejectionReason('');
                }}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>

              <button
                onClick={handleRejectSubmit}
                disabled={
                  !rejectionReason.trim() ||
                  processingDocumentId ===
                    rejectingDocId
                }
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                {processingDocumentId ===
                rejectingDocId ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5" />
                )}

                Reject Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Details Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between">
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                  {previewDoc.category}
                </span>

                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {previewDoc.title}
                </h3>

                <p className="text-xs text-slate-500 mt-1">
                  {previewDoc.fileName}
                </p>
              </div>

              <button
                onClick={() =>
                  setPreviewDoc(null)
                }
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">
                    Employee
                  </p>

                  <p className="text-xs font-semibold text-slate-800 mt-1">
                    {previewDoc.employeeName}
                  </p>

                  <p className="text-[10px] text-slate-400">
                    {previewDoc.employeeCode}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">
                    Department
                  </p>

                  <p className="text-xs font-semibold text-slate-800 mt-1 flex items-center gap-1">
                    <Building className="w-3 h-3 text-slate-400" />
                    {previewDoc.department ||
                      '-'}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">
                    File Type
                  </p>

                  <p className="text-xs font-semibold text-slate-800 mt-1">
                    {previewDoc.fileType ||
                      '-'}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">
                    File Size
                  </p>

                  <p className="text-xs font-semibold text-slate-800 mt-1">
                    {previewDoc.fileSize ||
                      '-'}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">
                    Uploaded By
                  </p>

                  <p className="text-xs font-semibold text-slate-800 mt-1">
                    {previewDoc.uploadedBy ||
                      '-'}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">
                    Uploaded At
                  </p>

                  <p className="text-xs font-semibold text-slate-800 mt-1">
                    {formatDate(
                      previewDoc.uploadedAt
                    )}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">
                  Status
                </p>

                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${getStatusClasses(
                    previewDoc.status
                  )}`}
                >
                  {previewDoc.status ===
                    'VERIFIED' && (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}

                  {previewDoc.status ===
                    'PENDING' && (
                    <Clock className="w-3.5 h-3.5" />
                  )}

                  {previewDoc.status ===
                    'REJECTED' && (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}

                  {previewDoc.status}
                </span>
              </div>

              {previewDoc.expiryDate && (
                <div className="text-xs text-slate-600">
                  <span className="font-semibold">
                    Expiry date:
                  </span>{' '}
                  {formatDate(
                    previewDoc.expiryDate
                  )}
                </div>
              )}

              {previewDoc.verifiedBy && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-700">
                  <p className="font-semibold">
                    Verified by{' '}
                    {previewDoc.verifiedBy}
                  </p>

                  {previewDoc.verifiedAt && (
                    <p className="text-[10px] mt-1">
                      {formatDate(
                        previewDoc.verifiedAt
                      )}
                    </p>
                  )}
                </div>
              )}

              {previewDoc.rejectionReason && (
                <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 text-xs text-rose-700">
                  <p className="font-semibold">
                    Rejection reason
                  </p>

                  <p className="mt-1">
                    {previewDoc.rejectionReason}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  onClick={() =>
                    handleView(previewDoc)
                  }
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" />
                  View File
                </button>

                <button
                  onClick={() =>
                    handleDownload(previewDoc)
                  }
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>

                {isAdminOrHr &&
                  previewDoc.status !==
                    'VERIFIED' && (
                    <button
                      onClick={() =>
                        handleVerify(
                          previewDoc._id
                        )
                      }
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Verify
                    </button>
                  )}

                <button
                  onClick={() =>
                    setPreviewDoc(null)
                  }
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsPage;