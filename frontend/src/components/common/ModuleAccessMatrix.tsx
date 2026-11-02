import React, { useState } from 'react';
import { exportToExcel, exportToPdf } from '../../utils/exportUtils';
import { ExportButtons } from './ExportButtons';
import { HRMS_ACCESS_MATRIX, AccessType } from '../../types/rbac';
import { Search, CheckCircle2, AlertCircle, MinusCircle, FileText } from 'lucide-react';

const renderAccessBadge = (type: AccessType) => {
  switch (type) {
    case 'READ_WRITE':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 whitespace-nowrap">
          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
          Read & Write
        </span>
      );
    case 'READ_ONLY':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-700 border border-amber-500/30 whitespace-nowrap">
          <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
          Read Only
        </span>
      );
    case 'NO_ACCESS':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-rose-500/10 text-rose-700 border border-rose-500/30 whitespace-nowrap">
          <MinusCircle className="w-3 h-3 text-rose-600 shrink-0" />
          No Access
        </span>
      );
  }
};

/** The official 18-module access policy (from the Roles PDF), with Excel / PDF export. */
export const ModuleAccessMatrix: React.FC = () => {
  const [matrixSearch, setMatrixSearch] = useState('');
  const [matrixRoleFilter, setMatrixRoleFilter] = useState<string>('ALL');

  const filteredMatrix = HRMS_ACCESS_MATRIX.filter((item) => {
    const ms = matrixSearch.toLowerCase();
    const matchesSearch =
      item.name.toLowerCase().includes(ms) ||
      item.rationale.toLowerCase().includes(ms) ||
      item.id.toLowerCase().includes(ms);

    if (!matchesSearch) return false;

    if (matrixRoleFilter !== 'ALL') {
      const accessVal = item.access[matrixRoleFilter as keyof typeof item.access];
      if (!accessVal || accessVal === 'NO_ACCESS') return false;
    }

    return true;
  });

  const handleExportExcel = () => {
    const rows = HRMS_ACCESS_MATRIX.map((m) => ({
      module: m.name,
      superAdmin: m.access.SUPER_ADMIN,
      admin1: m.access.ADMIN_1,
      admin2: m.access.ADMIN_2,
      finance: m.access.FINANCE,
      hr: m.access.HR,
      accounts: m.access.ACCOUNTS,
      auditors: m.access.AUDITORS,
      rationale: m.rationale,
    }));
    exportToExcel(rows, 'HRMS_Role_Based_Access_Matrix', 'AccessMatrix', [
      { header: 'Modules', key: 'module' },
      { header: 'Super Admin', key: 'superAdmin' },
      { header: 'Admin 1', key: 'admin1' },
      { header: 'Admin 2', key: 'admin2' },
      { header: 'Finance', key: 'finance' },
      { header: 'HR', key: 'hr' },
      { header: 'Accounts', key: 'accounts' },
      { header: 'Auditors', key: 'auditors' },
      { header: 'Rationale / Notes', key: 'rationale' },
    ]);
  };

  const handleExportPdf = () => {
    const headers = ['Module', 'SuperAdmin', 'Admin1', 'Admin2', 'Finance', 'HR', 'Accounts', 'Auditors', 'Rationale'];
    const rows = HRMS_ACCESS_MATRIX.map((m) => [
      m.name,
      m.access.SUPER_ADMIN,
      m.access.ADMIN_1,
      m.access.ADMIN_2,
      m.access.FINANCE,
      m.access.HR,
      m.access.ACCOUNTS,
      m.access.AUDITORS,
      m.rationale,
    ]);
    exportToPdf(
      'HRMS – Role-Based Access Control Matrix',
      headers,
      rows,
      'HRMS_Role_Based_Access_Matrix',
      'Official 18-Module Enterprise Access Control Reference'
    );
  };

  return (
    <div className="space-y-4">
      {/* Matrix Controls & Legends */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Module Access Control Matrix</h3>
            <p className="text-xs text-slate-500">
              Defines Read/Write, Read Only, and No Access rules for Super Admin, Admin 1, Admin 2, Finance, HR, Accounts, and Auditors.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/assets/aistudio/Roles_cd259f7a.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-[#023b77] hover:text-[#039583] px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            >
              <FileText className="w-3.5 h-3.5" />
              View Original PDF
            </a>
            <ExportButtons onExportExcel={handleExportExcel} onExportPdf={handleExportPdf} />
          </div>
        </div>

        {/* Legends */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">Legends:</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-800 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Read & Write
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-800 border border-amber-500/30">
            <AlertCircle className="w-3 h-3 text-amber-600" /> Read Only
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-800 border border-rose-500/30">
            <MinusCircle className="w-3 h-3 text-rose-600" /> No Access
          </span>
        </div>

        {/* Matrix Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="matrix-role-select" className="text-xs font-bold text-slate-700 shrink-0">Filter Role Access:</label>
            <select
              id="matrix-role-select"
              value={matrixRoleFilter}
              onChange={(e) => setMatrixRoleFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer shadow-xs"
            >
              <option value="ALL">All Roles (Full Access Matrix)</option>
              <option value="SUPER_ADMIN">Super Admin Access</option>
              <option value="ADMIN_1">Admin 1 Access</option>
              <option value="ADMIN_2">Admin 2 Access</option>
              <option value="FINANCE">Finance Access</option>
              <option value="HR">HR Access</option>
              <option value="ACCOUNTS">Accounts Access</option>
              <option value="AUDITORS">Auditors Access</option>
            </select>
          </div>

          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search module or rationale..."
              value={matrixSearch}
              onChange={(e) => setMatrixSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 border-collapse">
            <thead className="bg-[#023b77] text-white text-[11px] uppercase font-bold tracking-wider border-b border-slate-300">
              <tr>
                <th className="py-3.5 px-4 font-bold min-w-[180px]">Modules</th>
                <th className="py-3.5 px-3 text-center bg-[#012a52]">Super Admin</th>
                <th className="py-3.5 px-3 text-center">Admin 1</th>
                <th className="py-3.5 px-3 text-center">Admin 2</th>
                <th className="py-3.5 px-3 text-center bg-[#012a52]">Finance</th>
                <th className="py-3.5 px-3 text-center">HR</th>
                <th className="py-3.5 px-3 text-center bg-[#012a52]">Accounts</th>
                <th className="py-3.5 px-3 text-center">Auditors</th>
                <th className="py-3.5 px-4 min-w-[260px]">Rationale / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {filteredMatrix.map((item) => (
                <tr
                  key={item.id}
                  className={`${
                    item.category === 'PLATFORM_LEVEL' ? 'bg-amber-50/40 font-bold' : 'hover:bg-slate-50/80'
                  } transition-colors`}
                >
                  <td className="py-3.5 px-4 font-bold text-slate-900 flex flex-col justify-center">
                    <span className="text-xs">{item.name}</span>
                    {item.category === 'PLATFORM_LEVEL' && (
                      <span className="text-[9px] uppercase font-mono text-amber-700 tracking-wider">
                        Platform-level (beyond 18 modules)
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-center bg-slate-50/50">{renderAccessBadge(item.access.SUPER_ADMIN)}</td>
                  <td className="py-3 px-2 text-center">{renderAccessBadge(item.access.ADMIN_1)}</td>
                  <td className="py-3 px-2 text-center">{renderAccessBadge(item.access.ADMIN_2)}</td>
                  <td className="py-3 px-2 text-center bg-slate-50/50">{renderAccessBadge(item.access.FINANCE)}</td>
                  <td className="py-3 px-2 text-center">{renderAccessBadge(item.access.HR)}</td>
                  <td className="py-3 px-2 text-center bg-slate-50/50">{renderAccessBadge(item.access.ACCOUNTS)}</td>
                  <td className="py-3 px-2 text-center">{renderAccessBadge(item.access.AUDITORS)}</td>
                  <td className="py-3.5 px-4 text-slate-600 leading-relaxed font-sans">{item.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
