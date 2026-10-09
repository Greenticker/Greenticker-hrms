import React, { useState, useEffect } from 'react';
import { request } from '../services/api';
import { Shield, Search, Filter, Lock, Clock, User, ChevronRight, X } from 'lucide-react';

interface AuditLog {
  _id: string;
  userId: string;
  userEmail: string;
  role: string;
  action: string;
  module: string;
  entity: string;
  entityId?: string;
  details?: Record<string, any>;
  timestamp: string;
}

export const AuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [inspectLog, setInspectLog] = useState<AuditLog | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const res = await request<{ auditLogs: AuditLog[] }>('/audit-logs');
        setLogs(res.auditLogs);
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
      log.entity.toLowerCase().includes(s);
    return matchesModule && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-emerald-100 text-emerald-800">
            Enterprise Security & Compliance
          </span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Immutable System Security & Audit Trail
        </h1>
        <p className="text-sm text-slate-500">
          Append-only cryptographically verifiable logs recording identity authentication, workforce mutations, payroll executions, and confidential record access.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 overflow-x-auto">
          {['ALL', 'EMPLOYEE', 'ATTENDANCE', 'PAYROLL', 'LEAVE', 'EXPENSES', 'DOCUMENTS', 'LIFECYCLE', 'POSH', 'AUTH'].map((mod) => (
            <button
              key={mod}
              onClick={() => setModuleFilter(mod)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                moduleFilter === mod
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {mod}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search action, email, module..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-400 border-b border-slate-100">
              <tr>
                <th className="py-3 px-4">Timestamp (UTC)</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Module</th>
                <th className="py-3 px-4">Action Event</th>
                <th className="py-3 px-4">Entity</th>
                <th className="py-3 px-4 text-right">Payload Details</th>
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
                filteredLogs.map((log) => (
                  <tr key={log._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-sans font-semibold text-slate-900">
                      <div>{log.userEmail}</div>
                      <span className="text-[10px] font-mono text-slate-400 font-bold uppercase">{log.role}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                        {log.module}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-800">
                      {log.action}
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-sans">
                      {log.entity} {log.entityId ? `(#${log.entityId.slice(0, 10)})` : ''}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setInspectLog(log)}
                        className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[10px] uppercase font-sans"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspect Modal */}
      {inspectLog && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 font-sans">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="font-mono text-[10px] uppercase text-slate-400">AUDIT RECORD ID</span>
                <h3 className="text-sm font-bold text-slate-900 font-mono">{inspectLog._id}</h3>
              </div>
              <button onClick={() => setInspectLog(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-xl">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Actor</span>
                <p className="font-semibold text-slate-900">{inspectLog.userEmail}</p>
                <p className="text-slate-500 text-[10px]">{inspectLog.role}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Event Action</span>
                <p className="font-semibold text-slate-900 font-mono">{inspectLog.action}</p>
                <p className="text-slate-500 text-[10px]">{inspectLog.module}</p>
              </div>
            </div>

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                JSON Event Payload
              </span>
              <pre className="p-3 bg-slate-900 text-emerald-400 rounded-xl text-xs font-mono overflow-x-auto max-h-60">
                {JSON.stringify(inspectLog.details || {}, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setInspectLog(null)}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl"
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
