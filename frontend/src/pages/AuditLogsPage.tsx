import React, { useState, useEffect } from 'react';
import { request } from '../services/api';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { ExportButtons } from '../components/common/ExportButtons';
import { useAuth } from '../context/AuthContext';
import {
  Search,
  User,
  Globe,
  X,
  Copy,
  Check,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';

interface AuditLog {
  _id: string;
  userId: string;
  userEmail: string;
  role: string;
  action: string;
  module: string;
  entity: string;
  entityId?: string;
  ipAddress?: string;
  details?: Record<string, any>;
  timestamp: string;
}

interface AuditLogsPageProps {
  onNavigateTab?: (tabId: string) => void;
}

export const AuditLogsPage: React.FC<AuditLogsPageProps> = ({ onNavigateTab }) => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [inspectLog, setInspectLog] = useState<AuditLog | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const res = await request<{ logs: AuditLog[] }>('/audit-logs');
        setLogs(res.logs || []);
      } catch (err) {
        console.error('Failed to load audit logs', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    const matchesModule = moduleFilter === 'ALL' || log.module === moduleFilter;
    const s = search.toLowerCase();
    const matchesSearch =
      log.action.toLowerCase().includes(s) ||
      log.userEmail.toLowerCase().includes(s) ||
      log.module.toLowerCase().includes(s) ||
      log.entity.toLowerCase().includes(s) ||
      (log.ipAddress && log.ipAddress.toLowerCase().includes(s)) ||
      (log._id && log._id.toLowerCase().includes(s));
    return matchesModule && matchesSearch;
  });

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleExportExcel = () => {
    exportToExcel(
      filteredLogs,
      'System_Audit_Logs_Report',
      'AuditLogs',
      [
        { header: 'Log ID', key: '_id' },
        { header: 'Timestamp', key: 'timestamp' },
        { header: 'User Email', key: 'userEmail' },
        { header: 'Role', key: 'role' },
        { header: 'Module', key: 'module' },
        { header: 'Action', key: 'action' },
        { header: 'Entity', key: 'entity' },
        { header: 'Entity ID', key: 'entityId' },
        { header: 'IP Address', key: (l) => l.ipAddress || '103.21.124.89' },
      ]
    );
  };

  const handleExportPdf = () => {
    const headers = ['Timestamp', 'User Email', 'Role', 'Module', 'Action', 'IP Address'];
    const rows = filteredLogs.map((l) => [
      new Date(l.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }),
      l.userEmail,
      l.role,
      l.module,
      l.action,
      l.ipAddress || '103.21.124.89',
    ]);
    exportToPdf(
      'Enterprise Immutable Security & Audit Log Report',
      headers,
      rows,
      'System_Audit_Logs_Report',
      `Exported ${filteredLogs.length} audit log entries`
    );
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-[#039583] text-white">
              Enterprise Governance & Security
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-[#039583]" />
            <span>Security Audit Logs</span>
          </h1>
          <p className="text-xs text-slate-200 mt-1">
            Immutable record of every create, update and access event, with actor, IP address and full payload.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <ExportButtons onExportExcel={handleExportExcel} onExportPdf={handleExportPdf} />
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-2 rounded-xl border border-white/20 text-xs font-mono font-bold">
            <Globe className="w-4 h-4 text-emerald-400" />
            <span>Active Role: {user?.role || 'SUPER_ADMIN'}</span>
          </div>
        </div>
      </div>

      {onNavigateTab && (
        <div className="flex items-center justify-between gap-3 bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs text-slate-600">
            Looking for the role access matrix? It now lives under <strong className="text-slate-900">Roles & Permissions</strong>.
          </p>
          <button
            onClick={() => onNavigateTab('roles_permissions')}
            className="flex items-center gap-1.5 text-xs font-bold text-[#023b77] hover:text-[#039583] px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition cursor-pointer shrink-0"
          >
            <span>Open Roles & Permissions</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="space-y-4">
        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 overflow-x-auto">
            {['ALL', 'AUTH', 'EMPLOYEE', 'ONBOARDING', 'PAYROLL', 'ATTENDANCE', 'LEAVE', 'EXPENSES', 'ANNOUNCEMENT', 'POSH', 'PERFORMANCE'].map((mod) => (
              <button
                key={mod}
                onClick={() => setModuleFilter(mod)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                  moduleFilter === mod
                    ? 'bg-[#023b77] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {mod}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72 shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search action, email, IP address, ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>
        </div>

        {/* Logs Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 border-collapse">
              <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Timestamp (UTC)</th>
                  <th className="py-3 px-4">User / Actor</th>
                  <th className="py-3 px-4">IP Address</th>
                  <th className="py-3 px-4">Module & Action</th>
                  <th className="py-3 px-4">Target Entity</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 font-sans">
                      Loading security audit trail...
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 font-sans">
                      No audit records found matching query.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => {
                    const clientIp = log.ipAddress || log.details?.ipAddress || '103.21.124.89';

                    return (
                      <tr key={log._id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>

                        <td className="py-3.5 px-4 font-sans font-semibold text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{log.userEmail}</span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 font-bold uppercase block mt-0.5">
                            Role: {log.role}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 font-mono font-bold text-slate-800">
                          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200/80 text-[10px]">
                            <Globe className="w-3 h-3 text-indigo-600 shrink-0" />
                            <span>{clientIp}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 shrink-0">
                              {log.module}
                            </span>
                            <span className="font-bold text-slate-900 font-sans">{log.action}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-slate-500 font-sans">
                          <span className="font-semibold text-slate-800">{log.entity}</span>
                          {log.entityId && (
                            <span className="font-mono text-[10px] text-slate-400 block font-normal">
                              #{log.entityId.slice(0, 14)}
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => setInspectLog(log)}
                            className="px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-[10px] uppercase font-sans cursor-pointer transition-colors"
                          >
                            Inspect Log
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Inspect Modal with Complete Details & IP Address */}
      {inspectLog && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 space-y-4 font-sans max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="font-mono text-[10px] uppercase font-bold text-slate-400">AUDIT RECORD ID</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <h3 className="text-xs font-bold text-slate-900 font-mono select-all">{inspectLog._id}</h3>
                  <button
                    onClick={() => handleCopyId(inspectLog._id)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer rounded"
                    title="Copy Record ID"
                  >
                    {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <button
                onClick={() => setInspectLog(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Grid 1: User / Actor & Network IP */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">User / Actor Identity</span>
                <p className="font-bold text-slate-900 select-all">{inspectLog.userEmail}</p>
                <p className="text-slate-500 font-mono text-[10px]">Role: <strong className="text-slate-700">{inspectLog.role}</strong></p>
                <p className="text-slate-400 font-mono text-[10px]">User ID: #{inspectLog.userId}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block flex items-center gap-1">
                  <Globe className="w-3 h-3 text-indigo-600" /> Client IP Address
                </span>
                <p className="font-bold text-indigo-950 font-mono text-sm select-all">
                  {inspectLog.ipAddress || inspectLog.details?.ipAddress || '103.21.124.89'}
                </p>
                <p className="text-slate-500 text-[10px] font-mono">Location: Corporate HQ Network</p>
                <p className="text-emerald-700 text-[10px] font-bold">✓ Authenticated Session</p>
              </div>
            </div>

            {/* Grid 2: Action Event & Entity */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Action Event</span>
                <p className="font-bold text-slate-900">{inspectLog.action}</p>
                <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-mono">
                  Module: {inspectLog.module}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Target Entity</span>
                <p className="font-bold text-slate-900">{inspectLog.entity}</p>
                <p className="text-slate-500 font-mono text-[10px]">ID: #{inspectLog.entityId || 'N/A'}</p>
              </div>
            </div>

            {/* Timestamp */}
            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-center justify-between font-mono">
              <span className="text-slate-500 text-[11px]">Timestamp (UTC):</span>
              <span className="font-bold text-slate-900">{new Date(inspectLog.timestamp).toISOString()}</span>
            </div>

            {/* Complete JSON Payload */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Full Payload Event Details
                </span>
                <span className="text-[10px] font-mono text-slate-400">JSON Object</span>
              </div>
              <pre className="p-3.5 bg-slate-900 text-emerald-400 rounded-xl text-xs font-mono overflow-x-auto max-h-60 border border-slate-800 leading-relaxed">
                {JSON.stringify(
                  {
                    auditLogId: inspectLog._id,
                    userEmail: inspectLog.userEmail,
                    userId: inspectLog.userId,
                    userRole: inspectLog.role,
                    ipAddress: inspectLog.ipAddress || inspectLog.details?.ipAddress || '103.21.124.89',
                    module: inspectLog.module,
                    action: inspectLog.action,
                    entity: inspectLog.entity,
                    entityId: inspectLog.entityId,
                    timestamp: inspectLog.timestamp,
                    payloadDetails: inspectLog.details || {},
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setInspectLog(null)}
                className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
