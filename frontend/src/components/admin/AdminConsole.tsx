import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { employeeService } from '../../services/employeeService';
import { Employee } from '../../types/employee';
import {
  Badge, BAD, btn, card, downloadApiFile, errMsg, fmtDate, GOOD, inputCls, Modal, Msg, MsgState, okMsg, PRIMARY, SECONDARY, Table, Tabs,
} from '../common/ui';

export type AdminTab = 'users' | 'roles' | 'security' | 'company' | 'workflows' | 'integrations' | 'conflicts' | 'backup';
const USER_ADMINS = ['ADMIN', 'ADMIN_1', 'ADMIN_2', 'SUPER_ADMIN'];

export const AdminConsole: React.FC<{ initial?: AdminTab; companySetup?: React.ReactNode }> = ({ initial = 'users', companySetup }) => {
  const { user } = useAuth();
  const role = user?.role || '';
  const isSA = role === 'SUPER_ADMIN';
  const tabs = useMemo(() => {
    const t: { id: AdminTab; label: string }[] = [];
    if (USER_ADMINS.includes(role) || role === 'AUDITORS') t.push({ id: 'users', label: 'Users' });
    t.push({ id: 'roles', label: 'Roles & permissions' });
    if (USER_ADMINS.includes(role) || role === 'AUDITORS') {
      t.push({ id: 'security', label: 'Security' }, { id: 'company', label: 'Company' }, { id: 'workflows', label: 'Workflows' },
        { id: 'integrations', label: 'Integrations' }, { id: 'conflicts', label: 'Role conflicts' });
    }
    if (isSA) t.push({ id: 'backup', label: 'Backup & restore' });
    return t;
  }, [role, isSA]);
  const [tab, setTab] = useState<AdminTab>(tabs.some((t) => t.id === initial) ? initial : tabs[0].id);
  const [msg, setMsg] = useState<MsgState>(null);
  const [settings, setSettings] = useState<any>(null);
  const loadSettings = () => api.get<any>('/admin/settings').then((r) => setSettings(r.settings)).catch(() => undefined);
  useEffect(() => { if (tabs.some((t) => ['security', 'company', 'workflows', 'integrations'].includes(t.id))) loadSettings(); }, [tabs]);
  const saveSection = async (section: string, body: any) => {
    try { const r = await api.put<any>(`/admin/settings/${section}`, body); setSettings(r.settings); setMsg(okMsg('Saved and logged in the audit trail.')); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setMsg(null); }} />
      {!isSA && tab !== 'users' && tab !== 'roles' && <p className="text-xs text-slate-500">Only the Super Admin can change system settings; you have a read-only view.</p>}
      <Msg msg={msg} />
      {tab === 'users' && <Users setMsg={setMsg} canEdit={USER_ADMINS.includes(role)} isSA={isSA} />}
      {tab === 'roles' && <Roles setMsg={setMsg} />}
      {tab === 'security' && settings && <Security s={settings} canEdit={isSA} save={saveSection} />}
      {tab === 'company' && settings && (
        <div className="space-y-4">
          <Company s={settings.company} canEdit={isSA} save={(b) => saveSection('company', b)} />
          {companySetup}
        </div>
      )}
      {tab === 'workflows' && settings && <Workflows s={settings.workflows} canEdit={isSA} save={(b) => saveSection('workflows', b)} />}
      {tab === 'integrations' && settings && <Integrations s={settings.integrations} canEdit={isSA} save={(b) => saveSection('integrations', b)} setMsg={setMsg} />}
      {tab === 'conflicts' && <Conflicts setMsg={setMsg} />}
      {tab === 'backup' && <Backup setMsg={setMsg} />}
    </div>
  );
};

type SetMsg = { setMsg: (m: MsgState) => void };

const Users: React.FC<SetMsg & { canEdit: boolean; isSA: boolean }> = ({ setMsg, canEdit, isSA }) => {
  const { user } = useAuth();
  const [data, setData] = useState<{ users: any[]; roles: string[] }>({ users: [], roles: [] });
  const [emps, setEmps] = useState<Employee[]>([]);
  const [f, setF] = useState<any>(null);
  const [q, setQ] = useState('');
  const load = () => api.get<any>('/admin/users').then(setData).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); if (canEdit) employeeService.getEmployees().then((r) => setEmps(r.employees || [])).catch(() => undefined); }, [canEdit]);
  const linked = new Set(data.users.map((u) => u.employeeId));
  const act = async (fn: () => Promise<any>, ok: string) => { try { const r = await fn(); setMsg(okMsg(r?.pendingApproval ? 'Role change sent to the Super Admin for approval.' : ok)); load(); } catch (e) { setMsg(errMsg(e)); } };
  const rows = data.users.filter((u) => !q || `${u.email} ${u.name} ${u.role}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className={card}>
      <div className="flex flex-wrap gap-2 justify-between">
        <input className={inputCls + ' w-64'} placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
        {canEdit && <button className={btn(PRIMARY)} onClick={() => setF({ employeeId: '', email: '', role: 'EMPLOYEE' })}>Create login</button>}
      </div>
      <Table rows={rows} cols={[
        { key: 'email', label: 'Login', render: (u) => <>{u.email}<div className="text-slate-400">{u.name} · {u.employeeCode || 'no employee link'}</div></> },
        { key: 'role', label: 'Role', render: (u) => <>{u.role}{u.pendingRole && <div className="text-amber-700">→ {u.pendingRole.role} (pending)</div>}</> },
        { key: 'isActive', label: 'Status', render: (u) => <><Badge s={u.isActive ? 'ACTIVE' : 'CANCELLED'} />{u.lockedUntil && <Badge s="LOCKED" tone="red" />}{u.mfaEnabled && <Badge s="MFA" tone="blue" />}</> },
        { key: 'lastLoginAt', label: 'Last login', render: (u) => fmtDate(u.lastLoginAt) },
        { key: 'a', label: '', render: (u) => canEdit && u._id !== user?.id && (
          <div className="flex flex-wrap gap-1 justify-end">
            <select className={inputCls + ' w-32'} value="" aria-label={`Change role of ${u.email}`} onChange={(e) => e.target.value && act(() => api.put(`/admin/users/${u._id}/role`, { role: e.target.value }), 'Role changed.')}>
              <option value="">Role…</option>{data.roles.filter((r) => r !== u.role).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {isSA && u.pendingRole && <button className={btn(GOOD)} onClick={() => act(() => api.post(`/admin/users/${u._id}/role/approve`, { decision: 'APPROVED' }), 'Role change approved.')}>Approve role</button>}
            {u.lockedUntil && <button className={btn(SECONDARY)} onClick={() => act(() => api.post(`/admin/users/${u._id}/unlock`), 'Unlocked.')}>Unlock</button>}
            <button className={btn(SECONDARY)} onClick={() => act(() => api.put(`/admin/users/${u._id}/mfa`, { enabled: !u.mfaEnabled }), `MFA ${u.mfaEnabled ? 'disabled' : 'enabled'}.`)}>{u.mfaEnabled ? 'MFA off' : 'MFA on'}</button>
            <button className={btn(u.isActive ? BAD : GOOD)} onClick={() => act(() => api.put(`/admin/users/${u._id}/status`, { isActive: !u.isActive }), u.isActive ? 'Deactivated.' : 'Activated.')}>{u.isActive ? 'Deactivate' : 'Activate'}</button>
          </div>
        ) },
      ]} />
      {f && (
        <Modal title="Create a login" onClose={() => setF(null)}>
          <p className="text-xs text-slate-500">Every login belongs to one employee and uses their own work email; generic logins (admin@, hr1@) are not allowed.</p>
          <label className="text-xs block">Employee<select className={inputCls} value={f.employeeId} onChange={(e) => { const emp = emps.find((x) => x._id === e.target.value); setF({ ...f, employeeId: e.target.value, email: emp?.workEmail || '' }); }}>
            <option value="">Choose…</option>{emps.filter((e) => !linked.has(e._id)).map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
          </select></label>
          <label className="text-xs block">Work email<input className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="text-xs block">Role<select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{data.roles.map((r) => <option key={r}>{r}</option>)}</select></label>
          <div className="flex justify-end"><button className={btn(PRIMARY)} onClick={() => act(async () => { await api.post('/admin/users', f); setF(null); }, 'Login created; a set-password invite was sent.')}>Create</button></div>
        </Modal>
      )}
    </div>
  );
};

const ACCESS = ['READ_WRITE', 'READ_ONLY', 'NO_ACCESS'];
const Roles: React.FC<SetMsg> = ({ setMsg }) => {
  const [data, setData] = useState<any>(null);
  const load = () => api.get<any>('/admin/roles').then(setData).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);
  if (!data) return <p className="text-xs text-slate-500">Role permissions are managed by the administrators.</p>;
  const roles = Object.keys(data.matrix[0]?.access || {});
  const set = async (role: string, module: string, access: string) => {
    try { await api.put(`/admin/roles/${role}/permissions`, { [module]: access }); setMsg(okMsg(`${role}: ${module} → ${access.replace('_', ' ').toLowerCase()} (logged).`)); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className={card}>
      <p className="text-xs text-slate-500">{data.canEdit ? 'Change a cell to grant or restrict a role. Every change is logged. Admins can never get salary (payroll) access; Auditors stay read-only.' : 'Read-only view.'}</p>
      <div className="overflow-x-auto">
        <table className="text-[11px] w-full">
          <thead><tr className="border-b text-left text-slate-500"><th className="py-2 pr-2">Module</th>{roles.map((r) => <th key={r} className="px-1">{r}</th>)}</tr></thead>
          <tbody>
            {data.matrix.map((m: any) => (
              <tr key={m.module} className="border-b border-slate-100">
                <td className="py-1 pr-2 font-semibold">{m.module.replace(/_/g, ' ')}</td>
                {roles.map((r) => (
                  <td key={r} className="px-1">
                    {data.canEdit && r !== 'SUPER_ADMIN' ? (
                      <select aria-label={`${r} ${m.module}`} className={`border rounded px-1 py-0.5 ${data.overrides?.[m.module]?.[r] ? 'border-indigo-500' : 'border-slate-200'}`} value={m.access[r]} onChange={(e) => set(r, m.module, e.target.value)}>
                        {ACCESS.map((a) => <option key={a} value={a}>{a === 'READ_WRITE' ? 'RW' : a === 'READ_ONLY' ? 'R' : '—'}</option>)}
                      </select>
                    ) : <span>{m.access[r] === 'READ_WRITE' ? 'RW' : m.access[r] === 'READ_ONLY' ? 'R' : '—'}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const NumField: React.FC<{ label: string; value: any; onChange: (v: number) => void; disabled: boolean }> = ({ label, value, onChange, disabled }) => (
  <label className="text-xs">{label}<input type="number" className={inputCls} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} /></label>
);
const Check: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void; disabled: boolean }> = ({ label, value, onChange, disabled }) => (
  <label className="text-xs flex gap-1 items-center"><input type="checkbox" disabled={disabled} checked={!!value} onChange={(e) => onChange(e.target.checked)} />{label}</label>
);

const Security: React.FC<{ s: any; canEdit: boolean; save: (section: string, body: any) => void }> = ({ s, canEdit, save }) => {
  const [pp, setPp] = useState(s.passwordPolicy);
  const [lo, setLo] = useState(s.lockout);
  const [mfa, setMfa] = useState(s.mfa);
  const [se, setSe] = useState(s.session);
  const d = !canEdit;
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className={card}>
        <h3 className="font-bold text-sm">Password policy</h3>
        <div className="grid grid-cols-3 gap-2">
          <NumField label="Min length" value={pp.minLength} disabled={d} onChange={(v) => setPp({ ...pp, minLength: v })} />
          <NumField label="Expiry (days)" value={pp.expiryDays} disabled={d} onChange={(v) => setPp({ ...pp, expiryDays: v })} />
          <NumField label="History (no reuse)" value={pp.historyCount} disabled={d} onChange={(v) => setPp({ ...pp, historyCount: v })} />
        </div>
        <div className="flex flex-wrap gap-3">
          {(['requireUpper', 'requireLower', 'requireDigit', 'requireSpecial'] as const).map((k) => <Check key={k} label={k.replace('require', '')} value={pp[k]} disabled={d} onChange={(v) => setPp({ ...pp, [k]: v })} />)}
        </div>
        {canEdit && <button className={btn(PRIMARY)} onClick={() => save('passwordPolicy', pp)}>Save</button>}
      </div>
      <div className={card}>
        <h3 className="font-bold text-sm">Account lockout</h3>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Lock after failed attempts" value={lo.maxAttempts} disabled={d} onChange={(v) => setLo({ ...lo, maxAttempts: v })} />
          <NumField label="Lock for (minutes)" value={lo.lockMinutes} disabled={d} onChange={(v) => setLo({ ...lo, lockMinutes: v })} />
        </div>
        {canEdit && <button className={btn(PRIMARY)} onClick={() => save('lockout', lo)}>Save</button>}
      </div>
      <div className={card}>
        <h3 className="font-bold text-sm">Multi-factor sign-in (email OTP)</h3>
        <Check label="Require an OTP for these roles" value={mfa.enabled} disabled={d} onChange={(v) => setMfa({ ...mfa, enabled: v })} />
        <div className="flex flex-wrap gap-2">{['SUPER_ADMIN', 'ADMIN', 'ADMIN_1', 'ADMIN_2', 'HR', 'FINANCE', 'ACCOUNTS', 'AUDITORS', 'MANAGER', 'EMPLOYEE'].map((r) => (
          <Check key={r} label={r} value={mfa.roles.includes(r)} disabled={d} onChange={(v) => setMfa({ ...mfa, roles: v ? [...mfa.roles, r] : mfa.roles.filter((x: string) => x !== r) })} />
        ))}</div>
        <NumField label="Code valid (minutes)" value={mfa.otpMinutes} disabled={d} onChange={(v) => setMfa({ ...mfa, otpMinutes: v })} />
        <p className="text-xs text-slate-500">MFA can also be switched on for individual users in Users.</p>
        {canEdit && <button className={btn(PRIMARY)} onClick={() => save('mfa', mfa)}>Save</button>}
      </div>
      <div className={card}>
        <h3 className="font-bold text-sm">Session</h3>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Log out after idle (minutes)" value={se.idleTimeoutMinutes} disabled={d} onChange={(v) => setSe({ ...se, idleTimeoutMinutes: v })} />
          <NumField label="Maximum session (hours)" value={se.maxSessionHours} disabled={d} onChange={(v) => setSe({ ...se, maxSessionHours: v })} />
        </div>
        {canEdit && <button className={btn(PRIMARY)} onClick={() => save('session', se)}>Save</button>}
      </div>
    </div>
  );
};

const Company: React.FC<{ s: any; canEdit: boolean; save: (b: any) => void }> = ({ s, canEdit, save }) => {
  const [c, setC] = useState(s);
  const d = !canEdit;
  return (
    <div className={card}>
      <h3 className="font-bold text-sm">Company settings</h3>
      <div className="grid md:grid-cols-3 gap-2 text-xs">
        {[['name', 'Company name'], ['currency', 'Currency'], ['currencySymbol', 'Currency symbol'], ['timezone', 'Time zone'], ['dateFormat', 'Date format']].map(([k, l]) => (
          <label key={k}>{l}<input className={inputCls} disabled={d} value={c[k] || ''} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></label>
        ))}
        <label>Financial year starts (month)<input type="number" min={1} max={12} className={inputCls} disabled={d} value={c.financialYearStartMonth} onChange={(e) => setC({ ...c, financialYearStartMonth: Number(e.target.value) })} /></label>
      </div>
      <h4 className="font-semibold text-xs">Email templates</h4>
      {Object.entries(c.emailTemplates || {}).map(([k, t]: [string, any]) => (
        <div key={k} className="grid md:grid-cols-3 gap-2 text-xs">
          <span className="font-semibold">{k}</span>
          <input className={inputCls} disabled={d} value={t.subject} onChange={(e) => setC({ ...c, emailTemplates: { ...c.emailTemplates, [k]: { ...t, subject: e.target.value } } })} />
          <input className={inputCls} disabled={d} value={t.body} onChange={(e) => setC({ ...c, emailTemplates: { ...c.emailTemplates, [k]: { ...t, body: e.target.value } } })} />
        </div>
      ))}
      {canEdit && <button className={btn(PRIMARY)} onClick={() => save(c)}>Save</button>}
    </div>
  );
};

const Workflows: React.FC<{ s: any; canEdit: boolean; save: (b: any) => void }> = ({ s, canEdit, save }) => {
  const [w, setW] = useState(s);
  return (
    <div className={card}>
      <p className="text-xs text-slate-500">Only the Super Admin can change approval workflows, so no approver can change the rules for their own approvals. Changes are logged.</p>
      <label className="text-xs block w-72">Leave approval levels
        <select className={inputCls} disabled={!canEdit} value={w.leave.levels} onChange={(e) => setW({ ...w, leave: { ...w.leave, levels: Number(e.target.value) } })}>
          <option value={1}>1 — reporting manager</option><option value={2}>2 — manager, then manager's manager</option>
        </select>
      </label>
      <p className="text-xs">Expense claims: {w.expense.description} · Asset requests: {w.asset.description}</p>
      {canEdit && <button className={btn(PRIMARY)} onClick={() => save({ leave: { levels: w.leave.levels } })}>Save</button>}
    </div>
  );
};

const SECRET = ['apiKey', 'password', 'authToken'];
const Integrations: React.FC<{ s: any; canEdit: boolean; save: (b: any) => void } & SetMsg> = ({ s, canEdit, save, setMsg }) => {
  const [i, setI] = useState(s);
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {Object.entries(i).map(([name, conf]: [string, any]) => (
        <div key={name} className={card}>
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm capitalize">{name}</h3>
            {canEdit && <button className={btn(SECONDARY)} onClick={() => api.post<any>(`/admin/integrations/${name}/test`).then((r) => setMsg(r.ok ? okMsg(r.detail) : { ok: false, text: [r.detail] })).catch((e) => setMsg(errMsg(e)))}>Test</button>}
          </div>
          {Object.entries(conf).filter(([k]) => !k.endsWith('Set')).map(([k, v]) => (
            <label key={k} className="text-xs block">{k}{SECRET.includes(k) && conf[`${k}Set`] ? ' (stored — enter a new value to replace)' : ''}
              {typeof v === 'boolean'
                ? <input type="checkbox" className="ml-2" disabled={!canEdit} checked={v} onChange={(e) => setI({ ...i, [name]: { ...conf, [k]: e.target.checked } })} />
                : <input className={inputCls} type={SECRET.includes(k) ? 'password' : 'text'} disabled={!canEdit} value={String(v ?? '')} autoComplete="off"
                    onChange={(e) => setI({ ...i, [name]: { ...conf, [k]: e.target.value } })} />}
            </label>
          ))}
          {canEdit && <button className={btn(PRIMARY)} onClick={() => save({ [name]: i[name] })}>Save</button>}
        </div>
      ))}
    </div>
  );
};

const Conflicts: React.FC<SetMsg> = ({ setMsg }) => {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.get<any>('/admin/role-conflicts').then(setData).catch((e) => setMsg(errMsg(e))); }, []);
  if (!data) return null;
  return (
    <div className={card}>
      <p className="text-xs text-slate-500">Forbidden combinations for one person: {data.rules.join(' · ')}. Every login must be named and linked to an employee.</p>
      <Table rows={data.findings} rowKey={(_, i) => String(i)} empty="No conflicts found." cols={[
        { key: 'severity', label: 'Severity', render: (f) => <Badge s={f.severity} tone={f.severity === 'HIGH' ? 'red' : 'amber'} /> },
        { key: 'type', label: 'Finding', render: (f) => f.type.replace(/_/g, ' ').toLowerCase() }, { key: 'email', label: 'Login(s)' }, { key: 'role', label: 'Role(s)' }, { key: 'detail', label: 'Detail' },
      ]} />
    </div>
  );
};

const Backup: React.FC<SetMsg> = ({ setMsg }) => {
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState('');
  const restore = async () => {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const r = await api.post<any>('/admin/restore', { confirm, backup });
      setMsg(okMsg(`Restored ${Object.values(r.restored).reduce((a: number, b: any) => a + Number(b), 0)} records. The audit trail is never overwritten.`));
    } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className={card}>
        <h3 className="font-bold text-sm">Take a backup</h3>
        <p className="text-xs text-slate-500">Downloads every collection as one JSON file. The download is logged.</p>
        <button className={btn(PRIMARY)} onClick={() => downloadApiFile('/admin/backup', 'hrms_backup.json').catch((e) => setMsg(errMsg(e)))}>Download backup</button>
      </div>
      <div className={card}>
        <h3 className="font-bold text-sm">Restore</h3>
        <p className="text-xs text-rose-700">Replaces all current data with the backup (audit logs are kept). Use on a test server first.</p>
        <input type="file" accept=".json" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <label className="text-xs block">Type RESTORE to confirm<input className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        <button className={btn(BAD)} disabled={!file || confirm !== 'RESTORE'} onClick={restore}>Restore</button>
      </div>
    </div>
  );
};
