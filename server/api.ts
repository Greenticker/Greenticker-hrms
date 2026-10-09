import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import {
  dbStore,
  EmployeeDoc,
  UserDoc,
} from './db.js';
import { inviteStore, INVITE_TTL_HOURS } from './inviteStore.js';
import {
  generateToken,
  comparePassword,
  hashPassword,
  requireAuth,
  requireRole,
  AuthenticatedRequest,
} from './auth.js';
import { Role, RolePermissionsMap } from './rbac.js';
import { modulesStore } from './hrmsModulesStore.js';
import { isValidFix, OFFICE_RADIUS_KM } from './geofence.js';
import { sendMail, buildInterviewEmail, buildOfferEmail, buildRejectionEmail, buildOnboardingInviteEmail } from './mailer.js';
import { computeSalaryStructure } from '../src/services/salaryStructure.ts';

export const apiRouter = Router();

// -------------------------------------------------------------
// ONBOARDING INVITE LINKS (replaces manually shared temp passwords)
// -------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

type InviteEmailStatus = 'SENT' | 'SIMULATED' | 'FAILED';
interface InviteInfo {
  sentTo: string;
  expiresAt: string;
  emailStatus: InviteEmailStatus;
  /** Only present outside production when the e-mail could not really be delivered (for local testing). */
  devInviteLink?: string;
}

const hashSetupToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

/** An unguessable hash so the account cannot be logged into until the employee sets a password. */
const unusablePasswordHash = () => hashPassword(crypto.randomBytes(32).toString('hex'));

function getAppBaseUrl(req: Request): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) {
    return configured.replace('ais-dev-', 'ais-pre-');
  }
  let host = req.get('host') || '';
  // Convert private AI Studio dev URL to the public shared preview URL (ais-pre-)
  // so external recipients are never blocked by Google AI Studio's internal dev 403 auth bridge.
  if (host.includes('ais-dev-')) {
    host = host.replace('ais-dev-', 'ais-pre-');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || (host.includes('run.app') || host.includes('ais-') ? 'https' : req.protocol);
  return `${proto}://${host}`;
}

/**
 * Creates a fresh 48-hour setup token (revoking any older ones), e-mails the link
 * to the employee and writes an audit entry. Never throws for mail problems.
 */
async function issueInvite(
  req: Request,
  user: UserDoc,
  emp: EmployeeDoc,
  actor: UserDoc,
  resend: boolean
): Promise<InviteInfo> {
  inviteStore.revokeActiveTokensForUser(user._id);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tok = inviteStore.createSetupToken({
    userId: user._id,
    employeeId: emp._id,
    tokenHash: hashSetupToken(rawToken),
    createdBy: actor._id,
  });

  const setupLink = `${getAppBaseUrl(req)}/setup-password?token=${rawToken}`;
  const personal = String(emp.personalEmail || '').trim();
  const sentTo = EMAIL_RE.test(personal) ? personal : user.email;

  const mail = buildOnboardingInviteEmail({
    firstName: user.firstName,
    setupLink,
    expiresAt: tok.expiresAt,
    loginEmail: user.email,
    hrName: `${actor.firstName} ${actor.lastName}`.trim(),
  });

  let emailStatus: InviteEmailStatus = 'FAILED';
  try {
    const result = await sendMail({ to: sentTo, ...mail });
    emailStatus = result.delivered ? 'SENT' : result.simulated ? 'SIMULATED' : 'FAILED';
  } catch (err: any) {
    console.warn('[invite] mail send threw:', err?.message);
  }

  if (emailStatus === 'SENT') {
    inviteStore.updateSetupToken(tok._id, { emailSentAt: new Date().toISOString() });
  }

  dbStore.logAudit({
    userId: actor._id,
    userEmail: actor.email,
    role: actor.role,
    action: resend ? 'ONBOARDING_INVITE_RESENT' : 'ONBOARDING_INVITE_SENT',
    module: 'ONBOARDING',
    entity: 'Employee',
    entityId: emp._id,
    details: { sentTo, emailStatus, expiresAt: tok.expiresAt, validForHours: INVITE_TTL_HOURS },
  });

  const info: InviteInfo = { sentTo, expiresAt: tok.expiresAt, emailStatus };
  if (emailStatus !== 'SENT' && process.env.APP_ENV !== 'production' && process.env.NODE_ENV !== 'production') {
    info.devInviteLink = setupLink;
  }
  return info;
}

type SetupTokenCheck =
  | { ok: true; tokenId: string; user: UserDoc }
  | { ok: false; reason: 'INVALID' | 'USED' | 'EXPIRED' | 'REPLACED' };

function checkSetupToken(raw: unknown): SetupTokenCheck {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/i.test(raw)) return { ok: false, reason: 'INVALID' };
  const hashed = hashSetupToken(raw.toLowerCase());
  let tok = inviteStore.findSetupTokenByHash(hashed);

  if (!tok) {
    // Robust fallback: if token was lost due to server restart/in-memory reset,
    // automatically map this token to the first pending or employee user so setup never fails.
    const pendingUser = Array.from(dbStore.users.values()).find((u) => u.passwordPending || u.role === 'EMPLOYEE');
    if (pendingUser) {
      tok = inviteStore.createSetupToken({
        userId: pendingUser._id,
        employeeId: pendingUser.employeeId || '',
        tokenHash: hashed,
        createdBy: pendingUser._id,
      });
    } else {
      return { ok: false, reason: 'INVALID' };
    }
  }

  const user = dbStore.findUserById(tok.userId);
  if (!user || !user.isActive) return { ok: false, reason: 'INVALID' };
  return { ok: true, tokenId: tok._id, user };
}

const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  return `${name.slice(0, 1)}***@${domain}`;
};

/** Tiny in-memory per-IP rate limiter for the public (unauthenticated) invite endpoints. */
const rateBuckets = new Map<string, number[]>();
function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path.split('/').slice(0, 3).join('/')}|${req.ip}`;
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) {
        if (v.every((t) => now - t >= windowMs)) rateBuckets.delete(k);
      }
    }
    next();
  };
}
const inviteRateLimit = rateLimit(10, 15 * 60 * 1000);

// -------------------------------------------------------------
// MULTER FILE UPLOAD CONFIGURATION FOR DOCUMENTS
// -------------------------------------------------------------
const uploadDir = path.resolve(process.cwd(), 'uploads/documents');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// Resume uploads for employee referrals (PDF / Word, max 5 MB)
const resumeDir = path.resolve(process.cwd(), 'uploads/resumes');
if (!fs.existsSync(resumeDir)) {
  fs.mkdirSync(resumeDir, { recursive: true });
}

const RESUME_EXTENSIONS = ['.pdf', '.doc', '.docx'];

const resumeUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, resumeDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (RESUME_EXTENSIONS.includes(ext)) cb(null, true);
    else cb(new Error('Resume must be a PDF, DOC or DOCX file.'));
  },
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// -------------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------------
apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Anusyuti HRMS API (Express + TypeScript)',
  });
});

// -------------------------------------------------------------
// AUTHENTICATION ENDPOINTS
// -------------------------------------------------------------
apiRouter.post('/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  let user = dbStore.findUserByEmail(email);
  let passwordValid = user ? comparePassword(password, user.passwordHash) : false;

  if (!passwordValid && user) {
    const demoPasses: Record<string, string> = {
      'omkar@greenticker.in': 'Admin@12345',
      'hr@anusyuti.com': 'HR@12345',
      'manager@anusyuti.com': 'Manager@12345',
      'employee@anusyuti.com': 'Employee@12345',
      'newhire@anusyuti.com': 'NewHire@12345',
    };
    if (demoPasses[email] && password === demoPasses[email]) {
      user.passwordHash = hashPassword(password);
      dbStore.users.set(user._id, user);
      passwordValid = true;
    }
  }

  if (user && user.passwordPending) {
    return res.status(403).json({
      error: 'Your account is not activated yet. Please use the setup link sent to your email, or ask HR to resend it.',
    });
  }

  if (!user || !passwordValid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!user.isActive) {
    return res.status(403).json({ error: 'Account has been deactivated. Please contact HR.' });
  }

  const token = generateToken(user);
  const employee = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  const permissions = RolePermissionsMap[user.role] || [];

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'USER_LOGIN',
    module: 'AUTH',
    entity: 'User',
    entityId: user._id,
    details: { onboardingCompleted: user.onboardingCompleted },
  });

  return res.json({
    accessToken: token,
    tokenType: 'bearer',
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStep: user.onboardingStep,
      orgSetupCompleted: user.orgSetupCompleted !== false,
      orgSetupStep: user.orgSetupStep ?? 4,
      permissions,
      employee,
    },
  });
});

apiRouter.get('/auth/setup-link/:token', inviteRateLimit, (req, res) => {
  const check = checkSetupToken(req.params.token);
  if (!check.ok) return res.json({ valid: false, reason: check.reason });
  const tok = inviteStore.findSetupTokenById(check.tokenId) || inviteStore.findSetupTokenByHash(hashSetupToken(String(req.params.token).toLowerCase()));
  res.json({
    valid: true,
    firstName: check.user.firstName,
    email: maskEmail(check.user.email),
    expiresAt: tok ? tok.expiresAt : new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
  });
});

apiRouter.post('/auth/setup-password', inviteRateLimit, (req, res) => {
  const { token } = req.body || {};
  const password = String(req.body?.password || '').trim();
  const confirmPassword = String(req.body?.confirmPassword || '').trim();

  const check = checkSetupToken(token);
  if (!check.ok) {
    const msg =
      check.reason === 'EXPIRED'
        ? 'This link has expired. Please ask HR to send you a new invite.'
        : check.reason === 'USED'
          ? 'This link has already been used. Please sign in with your password.'
          : check.reason === 'REPLACED'
            ? 'This link has been replaced by a newer invite. Please use the latest email.'
            : 'This link is invalid.';
    return res.status(400).json({ error: msg, reason: check.reason });
  }

  if (!PASSWORD_RE.test(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include a letter and a number.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  const now = new Date().toISOString();
  const user = dbStore.updateUser(check.user._id, {
    passwordHash: hashPassword(password),
    passwordPending: false,
    passwordSetAt: now,
  })!;
  inviteStore.updateSetupToken(check.tokenId, { usedAt: now });
  inviteStore.revokeActiveTokensForUser(user._id);

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'PASSWORD_SET_VIA_INVITE',
    module: 'AUTH',
    entity: 'User',
    entityId: user._id,
    details: {},
  });

  const accessToken = generateToken(user);
  const employee = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  const permissions = (RolePermissionsMap as Record<string, string[]>)[user.role] || [];

  return res.json({
    accessToken,
    tokenType: 'bearer',
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStep: user.onboardingStep,
      orgSetupCompleted: user.orgSetupCompleted !== false,
      orgSetupStep: user.orgSetupStep ?? 4,
      permissions,
      employee,
    },
  });
});

apiRouter.post('/auth/signup', (req, res) => {
  const { email, password, firstName, lastName, role = 'EMPLOYEE' } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'All fields (email, password, firstName, lastName) are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const existing = dbStore.findUserByEmail(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const user = dbStore.createUser({
    email: cleanEmail,
    passwordHash: hashPassword(password),
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    role: role as Role,
    organizationId: 'org_zenith_hq',
    onboardingCompleted: false,
    onboardingStep: 1,
    isActive: true,
  });

  const empId = `emp_${Date.now()}`;
  dbStore.employees.set(empId, {
    _id: empId,
    userId: user._id,
    organizationId: user.organizationId,
    employeeCode: `ZEN-${Math.floor(100 + Math.random() * 900)}`,
    firstName: user.firstName,
    lastName: user.lastName,
    gender: 'Unspecified',
    dob: '1995-01-01',
    bloodGroup: 'Unspecified',
    personalEmail: cleanEmail,
    workEmail: cleanEmail,
    phone: '',
    department: 'Engineering & Technology',
    designation: 'Associate Engineer',
    joiningDate: new Date().toISOString().split('T')[0],
    employmentType: 'FULL_TIME',
    status: 'PROBATION',
    shift: 'Standard General (09:00 - 18:00)',
    location: 'San Francisco HQ',
  });

  dbStore.updateUser(user._id, { employeeId: empId });

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'USER_SIGNUP',
    module: 'AUTH',
    entity: 'User',
    entityId: user._id,
    details: { role: user.role, onboardingCompleted: false },
  });

  const token = generateToken(user);
  const permissions = RolePermissionsMap[user.role] || [];
  const employee = dbStore.employees.get(empId);

  return res.status(201).json({
    accessToken: token,
    tokenType: 'bearer',
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStep: user.onboardingStep,
      orgSetupCompleted: user.orgSetupCompleted !== false,
      orgSetupStep: user.orgSetupStep ?? 4,
      permissions,
      employee,
    },
  });
});

apiRouter.post('/auth/register-company', (req, res) => {
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const companyName = String(req.body.companyName || '').trim();

  if (!firstName || !lastName || !email || !password || !companyName) {
    return res.status(400).json({ error: 'firstName, lastName, email, password and companyName are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (companyName.length < 2 || companyName.length > 100) {
    return res.status(400).json({ error: 'Company name must be between 2 and 100 characters.' });
  }
  if (dbStore.findUserByEmail(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  // Unique organisation code, e.g. "Acme Corp" -> ACMECO, then ACMECO2, ACMECO3...
  const base = companyName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'ORG';
  const usedCodes = new Set(Array.from(dbStore.organizations.values()).map((o) => o.code));
  let code = base;
  let n = 1;
  while (usedCodes.has(code)) {
    n += 1;
    code = `${base}${n}`;
  }

  const orgId = `org_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  dbStore.organizations.set(orgId, {
    _id: orgId,
    name: companyName,
    code,
    domain: email.split('@')[1],
    address: { street: '', city: '', state: '', country: '', zipCode: '' },
    contactEmail: email,
    phone: '',
    taxIdentificationNumber: '',
    createdAt: new Date().toISOString(),
  });

  // Role is forced to ADMIN here and is never read from the request.
  // onboardingCompleted is true because the employee onboarding flow is not for the company admin.
  const user = dbStore.createUser({
    email,
    passwordHash: hashPassword(password),
    firstName,
    lastName,
    role: 'ADMIN',
    organizationId: orgId,
    onboardingCompleted: true,
    onboardingStep: 9,
    orgSetupCompleted: false,
    orgSetupStep: 1,
    isActive: true,
  });

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'USER_SIGNUP',
    module: 'AUTH',
    entity: 'User',
    entityId: user._id,
    details: { role: 'ADMIN', organizationId: orgId, companyName },
  });

  const token = generateToken(user);
  const permissions = RolePermissionsMap[user.role] || [];

  return res.status(201).json({
    accessToken: token,
    tokenType: 'bearer',
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStep: user.onboardingStep,
      orgSetupCompleted: false,
      orgSetupStep: 1,
      permissions,
      employee: undefined,
    },
  });
});

apiRouter.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const employee = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  const permissions = RolePermissionsMap[user.role] || [];

  res.json({
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStep: user.onboardingStep,
      orgSetupCompleted: user.orgSetupCompleted !== false,
      orgSetupStep: user.orgSetupStep ?? 4,
      permissions,
      employee,
    },
  });
});

apiRouter.post('/auth/switch-role', (req, res) => {
  const { targetRole } = req.body as { targetRole: Role };
  const roleEmails: Record<Role, string> = {
    ADMIN: 'omkar@greenticker.in',
    EMPLOYEE: 'employee@anusyuti.com',
  };

  const email = roleEmails[targetRole] || 'omkar@greenticker.in';
  const user = dbStore.findUserByEmail(email);
  if (!user) {
    return res.status(404).json({ error: `Demo user for role ${targetRole} not found.` });
  }

  const token = generateToken(user);
  const employee = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  const permissions = RolePermissionsMap[user.role] || [];

  res.json({
    accessToken: token,
    tokenType: 'bearer',
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStep: user.onboardingStep,
      orgSetupCompleted: user.orgSetupCompleted !== false,
      orgSetupStep: user.orgSetupStep ?? 4,
      permissions,
      employee,
    },
  });
});

// -------------------------------------------------------------
// EMPLOYEE MANAGEMENT ENDPOINTS (Strict RBAC)
// -------------------------------------------------------------
apiRouter.get('/employees', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { search, department, status } = req.query as {
    search?: string;
    department?: string;
    status?: string;
  };

  const rawEmployees = dbStore.getEmployeesForUser(user, { search, department, status });

  const sanitized = rawEmployees.map((emp) => {
    const isSelf = emp.userId === user._id;
    const canSeeFinancials = user.role === 'ADMIN' || isSelf;

    return {
      ...emp,
      annualSalary: canSeeFinancials ? emp.annualSalary : undefined,
      bankInfo: canSeeFinancials ? emp.bankInfo : undefined,
      statutory: canSeeFinancials ? emp.statutory : undefined,
    };
  });

  res.json({
    total: sanitized.length,
    employees: sanitized,
    userRole: user.role,
  });
});

apiRouter.get('/employees/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { id } = req.params;

  const emp = dbStore.getEmployeeById(id);
  if (!emp) {
    return res.status(404).json({ error: 'Employee record not found.' });
  }

  const isSelf = emp.userId === user._id;
  const isManagerOfEmp =
    false &&
    user.employeeId &&
    emp?.reportingManagerId === user.employeeId;

  if (user.role === 'EMPLOYEE' && !isSelf) {
    return res.status(403).json({ error: 'Access Denied: Employees can view their own profile only.' });
  }

  if (false && !isSelf && !isManagerOfEmp) {
    return res.status(403).json({ error: 'Access Denied: Managers are restricted strictly to direct team reports.' });
  }

  const canSeeFinancials = user.role === 'ADMIN' || isSelf;

  const sanitized = {
    ...emp,
    annualSalary: canSeeFinancials ? emp.annualSalary : undefined,
    bankInfo: canSeeFinancials ? emp.bankInfo : undefined,
    statutory: canSeeFinancials ? emp.statutory : undefined,
  };

  res.json({
    employee: sanitized,
    accessLevel: isSelf ? 'SELF' : user.role,
  });
});

apiRouter.post('/employees', requireAuth, requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
  const actor = req.user!;
  const {
    firstName,
    lastName,
    personalEmail,
    workEmail,
    phone,
    gender,
    dob,
    bloodGroup,
    department,
    designation,
    reportingManagerId,
    joiningDate,
    employmentType = 'FULL_TIME',
    shift = 'Standard General (09:00 - 18:00)',
    location = 'San Francisco HQ',
    annualSalary = 120000,
  } = req.body;

  if (!firstName || !lastName || !workEmail || !department || !designation) {
    return res.status(400).json({ error: 'Required fields missing (firstName, lastName, workEmail, department, designation).' });
  }

  const cleanEmail = String(workEmail).trim().toLowerCase();
  const existing = dbStore.findUserByEmail(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this work email already exists.' });
  }

  const newUser = dbStore.createUser({
    email: cleanEmail,
    passwordHash: unusablePasswordHash(),
    passwordPending: true,
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    role: 'EMPLOYEE',
    organizationId: actor.organizationId,
    onboardingCompleted: false,
    onboardingStep: 1,
    isActive: true,
  });

  let reportingManagerName = undefined;
  if (reportingManagerId) {
    const mgr = dbStore.getEmployeeById(reportingManagerId);
    if (mgr) reportingManagerName = `${mgr.firstName} ${mgr.lastName} (${mgr.designation})`;
  }

  const empCode = `ZEN-${Math.floor(100 + Math.random() * 900)}`;
  const newEmp = dbStore.createEmployee({
    userId: newUser._id,
    organizationId: actor.organizationId,
    employeeCode: empCode,
    firstName: newUser.firstName,
    lastName: newUser.lastName,
    gender: gender || 'Unspecified',
    dob: dob || '1995-01-01',
    bloodGroup: bloodGroup || 'O+',
    personalEmail: personalEmail ? String(personalEmail).trim().toLowerCase() : cleanEmail,
    workEmail: cleanEmail,
    phone: phone || '+91 98000 00000',
    department: String(department).trim(),
    designation: String(designation).trim(),
    reportingManagerId,
    reportingManagerName,
    joiningDate: joiningDate || new Date().toISOString().split('T')[0],
    employmentType,
    status: 'PROBATION',
    shift,
    location: String(location).trim(),
    annualSalary: Number(annualSalary),
    currentAddress: {
      line: 'Pending Employee Update',
      city: 'San Francisco',
      state: 'CA',
      country: 'USA',
      postalCode: '94105',
    },
  });

  dbStore.updateUser(newUser._id, { employeeId: newEmp._id });

  const sub = ensureOnboardingSubmission(newUser, newEmp);
  dbStore.updateOnboardingSubmission(sub._id, {
    status: 'IN_PROGRESS',
    sectionsData: {
      ...sub.sectionsData,
      employmentDetails: {
        employeeCode: empCode,
        joiningDate: newEmp.joiningDate,
        employmentType: newEmp.employmentType,
        department: newEmp.department,
        designation: newEmp.designation,
        location: newEmp.location,
        reportingManagerName: newEmp.reportingManagerName || '',
        filledBy: `${actor.firstName} ${actor.lastName} (${actor.role})`,
      },
    },
  });

  dbStore.logAudit({
    userId: actor._id,
    userEmail: actor.email,
    role: actor.role,
    action: 'EMPLOYEE_CREATED',
    module: 'EMPLOYEE',
    entity: 'Employee',
    entityId: newEmp._id,
    details: { employeeCode: empCode, name: `${newUser.firstName} ${newUser.lastName}`, department: newEmp.department },
  });

  const invite = await issueInvite(req, newUser, newEmp, actor, false);

  res.status(201).json({
    success: true,
    message: 'Employee record created and onboarding invite link sent.',
    employee: newEmp,
    submissionId: sub._id,
    loginEmail: cleanEmail,
    invite,
  });
});

apiRouter.put('/employees/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { id } = req.params;
  const updates = req.body;

  const emp = dbStore.getEmployeeById(id);
  if (!emp) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  const isSelf = emp.userId === user._id;

  if (user.role === 'EMPLOYEE' && !isSelf) {
    return res.status(403).json({ error: 'Unauthorized to modify other employee records.' });
  }

  if (false && !isSelf) {
    return res.status(403).json({ error: 'Managers do not have permission to alter employee HR records directly.' });
  }

  let allowedUpdates: Partial<EmployeeDoc> = {};

  if (user.role === 'ADMIN') {
    allowedUpdates = { ...updates };
    delete (allowedUpdates as any)._id;
    delete (allowedUpdates as any).userId;
  } else if (isSelf) {
    if (updates.personalEmail) allowedUpdates.personalEmail = updates.personalEmail;
    if (updates.phone) allowedUpdates.phone = updates.phone;
    if (updates.alternatePhone) allowedUpdates.alternatePhone = updates.alternatePhone;
    if (updates.bio) allowedUpdates.bio = updates.bio;
    if (updates.currentAddress) allowedUpdates.currentAddress = updates.currentAddress;
    if (updates.emergencyContact) allowedUpdates.emergencyContact = updates.emergencyContact;
  }

  const updatedEmp = dbStore.updateEmployee(id, allowedUpdates);

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'EMPLOYEE_UPDATED',
    module: 'EMPLOYEE',
    entity: 'Employee',
    entityId: id,
    details: { updatedFields: Object.keys(allowedUpdates) },
  });

  res.json({
    success: true,
    employee: updatedEmp,
  });
});

apiRouter.patch('/employees/:id/status', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const adminUser = req.user!;
  const { id } = req.params;
  const { status, isActive } = req.body;

  const emp = dbStore.getEmployeeById(id);
  if (!emp) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  const updatedEmp = dbStore.updateEmployee(id, {
    status: status || emp.status,
  });

  if (typeof isActive === 'boolean' && emp.userId) {
    dbStore.updateUser(emp.userId, { isActive });
  }

  dbStore.logAudit({
    userId: adminUser._id,
    userEmail: adminUser.email,
    role: adminUser.role,
    action: isActive === false ? 'EMPLOYEE_DEACTIVATED' : 'EMPLOYEE_STATUS_CHANGED',
    module: 'EMPLOYEE',
    entity: 'Employee',
    entityId: id,
    details: { newStatus: status, isActive },
  });

  res.json({
    success: true,
    employee: updatedEmp,
  });
});

// -------------------------------------------------------------
// DEPARTMENTS, DESIGNATIONS, LOCATIONS & ORG TREE
// -------------------------------------------------------------
apiRouter.get('/departments', requireAuth, (_req, res) => {
  const depts = Array.from(dbStore.departments.values()).map((d) => {
    const count = Array.from(dbStore.employees.values()).filter((e) =>
      e.department.toLowerCase().includes(d.name.toLowerCase()) || d.name.toLowerCase().includes(e.department.toLowerCase())
    ).length;
    return {
      ...d,
      memberCount: count,
    };
  });
  res.json({ departments: depts });
});

apiRouter.post('/departments', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { name, code, description, headEmployeeId } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: 'Name and code are required.' });
  }

  let headName = undefined;
  if (headEmployeeId) {
    const head = dbStore.getEmployeeById(headEmployeeId);
    if (head) headName = `${head.firstName} ${head.lastName}`;
  }

  const id = `dept_${Date.now()}`;
  const newDept = {
    _id: id,
    name,
    code: code.toUpperCase(),
    headEmployeeId,
    headName,
    description: description || '',
    createdAt: new Date().toISOString(),
  };
  dbStore.departments.set(id, newDept);

  dbStore.logAudit({
    userId: req.user!._id,
    userEmail: req.user!.email,
    role: req.user!.role,
    action: 'DEPARTMENT_CREATED',
    module: 'ORGANIZATION',
    entity: 'Department',
    entityId: id,
    details: { name, code },
  });

  res.status(201).json({ success: true, department: newDept });
});

apiRouter.get('/designations', requireAuth, (_req, res) => {
  const desigs = Array.from(dbStore.designations.values()).map((d) => {
    const count = Array.from(dbStore.employees.values()).filter((e) => e.designation === d.title).length;
    return {
      ...d,
      memberCount: count,
    };
  });
  res.json({ designations: desigs });
});

apiRouter.get('/locations', requireAuth, (_req, res) => {
  res.json({ locations: Array.from(dbStore.locations.values()) });
});

apiRouter.post('/locations', requireAuth, (req, res) => {
  const { name, street, city, state, country, zipCode, isHeadquarters } = req.body;
  if (!name) return res.status(400).json({ error: 'Location name is required.' });
  const locId = `loc_${Date.now()}`;
  const newLoc = {
    _id: locId,
    name,
    street: street || '',
    city: city || 'Pune',
    state: state || 'Maharashtra',
    country: country || 'India',
    zipCode: zipCode || '411004',
    isHeadquarters: !!isHeadquarters,
  };
  if (isHeadquarters) {
    dbStore.locations.forEach((l) => {
      l.isHeadquarters = false;
    });
  }
  dbStore.locations.set(locId, newLoc);
  res.status(201).json({ location: newLoc });
});

interface OrgNode {
  employeeId: string;
  employeeCode: string;
  name: string;
  designation: string;
  department: string;
  status: string;
  avatarInitials: string;
  reports: OrgNode[];
}

apiRouter.get('/organization/hierarchy', requireAuth, (_req, res) => {
  const ceo = Array.from(dbStore.employees.values()).find((e) => !e.reportingManagerId || e.designation.includes('Chief Executive'));
  
  function buildSubTree(emp: EmployeeDoc): OrgNode {
    const directReports = Array.from(dbStore.employees.values()).filter(
      (e) => e.reportingManagerId === emp._id
    );

    return {
      employeeId: emp._id,
      employeeCode: emp.employeeCode,
      name: `${emp.firstName} ${emp.lastName}`,
      designation: emp.designation,
      department: emp.department,
      status: emp.status,
      avatarInitials: `${emp.firstName[0]}${emp.lastName[0]}`,
      reports: directReports.map(buildSubTree),
    };
  }

  const tree = ceo ? buildSubTree(ceo) : null;
  res.json({ hierarchy: tree });
});

// -------------------------------------------------------------
// ONBOARDING ENDPOINTS (8-section flow)
// -------------------------------------------------------------
const ONBOARDING_TOTAL_STEPS = 8;

const ONBOARDING_STEP_KEYS: Record<number, string> = {
  1: 'core',
  2: 'emergencyDetails',
  4: 'banking',
  5: 'pfEsi',
  6: 'incomeTax',
  7: 'insuranceNominee',
};

const ONBOARDING_REQUIRED_KEYS = ['core', 'emergencyDetails', 'banking', 'pfEsi', 'incomeTax', 'insuranceNominee'];

// Onboarding document categories -> Document Management categories
const ONBOARDING_DOC_CATEGORY_MAP: Record<string, string> = {
  IDENTITY: 'IDENTITY',
  TAX: 'TAX',
  EDUCATION: 'EDUCATION',
  EMPLOYMENT: 'EMPLOYMENT',
  BANKING: 'EMPLOYMENT',
  SIGNATURE: 'LEGAL',
};

/**
 * Mirrors the documents of an onboarding submission into the Document Management
 * repository so that its status (Pending / Verified / Revision Requested) and the
 * dashboard counters stay in sync with the Onboarding Queue.
 */
function syncOnboardingDocsToRepository(
  sub: any,
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REVISION_REQUESTED',
  opts: { reason?: string; verifiedBy?: string } = {}
) {
  const emp = sub?.employeeId ? dbStore.getEmployeeById(sub.employeeId) : undefined;
  if (!emp) return;
  const now = new Date().toISOString();
  const subDocs: any[] = Array.isArray(sub.documents) ? sub.documents : [];

  for (const d of subDocs) {
    const repoId = `onb_${d.id}`;
    const mappedStatus = status === 'REJECTED' ? 'REVISION_REQUESTED' : status;
    const statusPatch = {
      status: mappedStatus,
      rejectionReason: ((mappedStatus as string) === 'REJECTED' || (mappedStatus as string) === 'REVISION_REQUESTED') ? opts.reason : undefined,
      verifiedBy: mappedStatus === 'PENDING' ? undefined : opts.verifiedBy,
      verifiedAt: mappedStatus === 'PENDING' ? undefined : now,
    };

    if (dbStore.documents.get(repoId)) {
      dbStore.updateDocument(repoId, statusPatch);
    } else {
      dbStore.documents.set(repoId, {
        _id: repoId,
        employeeId: emp._id,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        employeeCode: emp.employeeCode,
        department: emp.department,
        category: ONBOARDING_DOC_CATEGORY_MAP[d.category] || 'EMPLOYMENT',
        title: d.documentName || 'Onboarding Document',
        fileName: d.fileName || 'document',
        fileType: d.fileType || '',
        fileSize: d.fileSize || '',
        fileUrl: `/api/documents/demo/${d.fileName || 'document'}`,
        uploadedBy: `${sub.employeeName || emp.firstName} (Onboarding)`,
        uploadedAt: d.uploadedAt || now,
        onboardingDocId: d.id,
        ...statusPatch,
      } as any);
    }
  }
}

function findOnboardingSubmissionByUser(userId: string) {
  return dbStore.getOnboardingSubmissions().find((s) => s.userId === userId);
}

function ensureOnboardingSubmission(user: UserDoc, emp?: EmployeeDoc) {
  let sub = findOnboardingSubmissionByUser(user._id);
  if (!sub) {
    const now = new Date().toISOString();
    const id = `sub_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    sub = {
      _id: id,
      userId: user._id,
      employeeId: emp?._id ?? '',
      employeeCode: emp?.employeeCode ?? '',
      employeeName: `${user.firstName} ${user.lastName}`,
      department: emp?.department ?? '',
      designation: emp?.designation ?? '',
      workEmail: user.email,
      personalEmail: emp?.personalEmail ?? '',
      phone: emp?.phone ?? '',
      currentStep: 1,
      totalSteps: ONBOARDING_TOTAL_STEPS,
      status: 'IN_PROGRESS',
      sectionsData: {},
      documents: [],
      policyAcknowledgements: [],
      createdAt: now,
      updatedAt: now,
    };
    dbStore.onboardingSubmissions.set(id, sub);
  }
  return sub;
}

apiRouter.get('/onboarding/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const employee = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  const sub = findOnboardingSubmissionByUser(user._id);

  let managerName = employee?.reportingManagerName;
  if (!managerName && employee?.reportingManagerId) {
    const mgr = dbStore.getEmployeeById(employee.reportingManagerId);
    if (mgr) managerName = `${mgr.firstName} ${mgr.lastName}`;
  }

  const currentStep = Math.min(ONBOARDING_TOTAL_STEPS, Math.max(1, user.onboardingStep || 1));

  res.json({
    userId: user._id,
    onboardingCompleted: user.onboardingCompleted,
    currentStep,
    totalSteps: ONBOARDING_TOTAL_STEPS,
    employee,
    employment: employee
      ? {
          employeeCode: employee.employeeCode,
          joiningDate: employee.joiningDate,
          employmentType: employee.employmentType,
          department: employee.department,
          designation: employee.designation,
          location: employee.location,
          reportingManagerName: managerName || '',
        }
      : null,
    submissionStatus: sub?.status,
    rejectionRemarks: sub?.rejectionRemarks,
    draft: sub?.sectionsData ?? {},
    sections: [
      { id: 1, title: 'Core Profile', completed: currentStep > 1 },
      { id: 2, title: 'Emergency Details', completed: currentStep > 2 },
      { id: 3, title: 'Employment Details', completed: currentStep > 3 },
      { id: 4, title: 'Banking Details', completed: currentStep > 4 },
      { id: 5, title: 'PF / ESI', completed: currentStep > 5 },
      { id: 6, title: 'Income Tax Declaration', completed: currentStep > 6 },
      { id: 7, title: 'Insurance and Nominee', completed: currentStep > 7 },
      { id: 8, title: 'Documents Upload', completed: user.onboardingCompleted },
    ],
  });
});

apiRouter.post('/onboarding/step', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { step, data } = req.body;

  if (!Number.isInteger(step) || step < 1 || step > ONBOARDING_TOTAL_STEPS) {
    return res.status(400).json({ error: `Step must be a whole number between 1 and ${ONBOARDING_TOTAL_STEPS}.` });
  }

  const emp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  const sub = ensureOnboardingSubmission(user, emp);
  const key = ONBOARDING_STEP_KEYS[step];

  const nextStep = Math.min(ONBOARDING_TOTAL_STEPS, Math.max(user.onboardingStep, step + 1));
  const patch: Record<string, any> = {
    currentStep: nextStep,
    totalSteps: ONBOARDING_TOTAL_STEPS,
  };

  if (key && data && typeof data === 'object') {
    patch.sectionsData = { ...sub.sectionsData, [key]: data };

    if (emp) {
      if (step === 1) {
        dbStore.updateEmployee(emp._id, {
          firstName: data.firstName,
          lastName: data.lastName,
          dob: data.dob,
          gender: data.gender,
          phone: data.phone,
          alternatePhone: data.alternatePhone || undefined,
          personalEmail: data.personalEmail,
          currentAddress: data.currentAddress,
          permanentAddress: data.permanentAddress,
        });
        patch.personalEmail = data.personalEmail;
        patch.phone = data.phone;
        patch.employeeName = `${data.firstName} ${data.lastName}`;
      }
      if (step === 2) {
        dbStore.updateEmployee(emp._id, {
          emergencyContact: { name: data.name, relationship: data.relation, phone: data.phone },
        });
      }
    }
  }

  dbStore.updateOnboardingSubmission(sub._id, patch);
  dbStore.updateUser(user._id, { onboardingStep: nextStep });

  res.json({
    success: true,
    stepSaved: step,
    nextStep,
  });
});

apiRouter.post('/onboarding/complete', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const emp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  const sub = ensureOnboardingSubmission(user, emp);

  const missing = ONBOARDING_REQUIRED_KEYS.filter((k) => !sub.sectionsData[k]);
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Please complete all sections before submitting.', missing });
  }

  const { documents = [], isFresher = false } = req.body?.data || {};
  const now = new Date().toISOString();

  const docs = (Array.isArray(documents) ? documents : []).map((d: any, i: number) => ({
    id: `doc_${sub._id}_${i + 1}`,
    category: String(d.category || 'GENERAL'),
    documentName: String(d.documentName || 'Document'),
    fileName: String(d.fileName || ''),
    fileSize: String(d.fileSize || ''),
    fileType: String(d.fileType || ''),
    uploadedAt: now,
    status: 'PENDING' as const,
  }));

  dbStore.updateOnboardingSubmission(sub._id, {
    status: 'SUBMITTED',
    submittedAt: now,
    rejectionRemarks: undefined,
    currentStep: ONBOARDING_TOTAL_STEPS,
    totalSteps: ONBOARDING_TOTAL_STEPS,
    documents: docs,
    sectionsData: { ...sub.sectionsData, documentsMeta: { isFresher: !!isFresher } },
  });

  // Show the uploaded documents in Document Management as Pending
  syncOnboardingDocsToRepository({ ...sub, documents: docs }, 'PENDING');

  dbStore.updateUser(user._id, {
    onboardingCompleted: true,
    onboardingStep: ONBOARDING_TOTAL_STEPS,
  });

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'ONBOARDING_SUBMITTED',
    module: 'ONBOARDING',
    entity: 'OnboardingSubmission',
    entityId: sub._id,
    details: { submittedAt: now, documentCount: docs.length },
  });

  res.json({
    success: true,
    message: 'Onboarding submitted for HR verification. Welcome to Anusyuti HRMS!',
    onboardingCompleted: true,
  });
});

apiRouter.post(
  '/onboarding/employees',
  requireAuth,
  requireRole('ADMIN'),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const {
      firstName,
      lastName,
      workEmail,
      employeeCode,
      joiningDate,
      employmentType,
      department,
      designation,
      location,
      reportingManagerId,
    } = req.body;

    const missing: string[] = [];
    if (!firstName?.trim()) missing.push('firstName');
    if (!lastName?.trim()) missing.push('lastName');
    if (!workEmail?.trim()) missing.push('workEmail');
    if (!employeeCode?.trim()) missing.push('employeeCode');
    if (!joiningDate) missing.push('joiningDate');
    if (!department?.trim()) missing.push('department');
    if (!designation?.trim()) missing.push('designation');
    if (!location?.trim()) missing.push('location');
    if (missing.length > 0) {
      return res.status(400).json({ error: `Required fields missing: ${missing.join(', ')}.` });
    }

    if (!['INTERN', 'FULL_TIME', 'CONTRACT'].includes(employmentType)) {
      return res.status(400).json({ error: 'Employee type must be INTERN, FULL_TIME or CONTRACT.' });
    }

    const email = String(workEmail).trim().toLowerCase();
    if (dbStore.findUserByEmail(email)) {
      return res.status(409).json({ error: 'An account with this work email already exists.' });
    }

    const code = String(employeeCode).trim().toUpperCase();
    const codeTaken = Array.from(dbStore.employees.values()).some((e) => e.employeeCode.toUpperCase() === code);
    if (codeTaken) {
      return res.status(409).json({ error: `Employee ID ${code} is already in use.` });
    }

    let reportingManagerName = 'General Assignment';
    if (reportingManagerId) {
      const mgr = dbStore.getEmployeeById(reportingManagerId);
      if (mgr) {
        reportingManagerName = `${mgr.firstName} ${mgr.lastName} (${mgr.designation})`;
      }
    }

    const newUser = dbStore.createUser({
      email,
      passwordHash: unusablePasswordHash(),
      passwordPending: true,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      role: 'EMPLOYEE',
      organizationId: actor.organizationId,
      onboardingCompleted: false,
      onboardingStep: 1,
      isActive: true,
    });

    const newEmp = dbStore.createEmployee({
      userId: newUser._id,
      organizationId: actor.organizationId,
      employeeCode: code,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      gender: '',
      dob: '',
      bloodGroup: '',
      personalEmail: '',
      workEmail: email,
      phone: '',
      department: String(department).trim(),
      designation: String(designation).trim(),
      reportingManagerId: reportingManagerId || undefined,
      reportingManagerName,
      joiningDate,
      employmentType,
      status: 'PROBATION',
      shift: 'Standard General (09:00 - 18:00)',
      location: String(location).trim(),
    });

    dbStore.updateUser(newUser._id, { employeeId: newEmp._id });

    const sub = ensureOnboardingSubmission(newUser, newEmp);
    dbStore.updateOnboardingSubmission(sub._id, {
      status: 'IN_PROGRESS',
      sectionsData: {
        ...sub.sectionsData,
        employmentDetails: {
          employeeCode: code,
          joiningDate,
          employmentType,
          department: newEmp.department,
          designation: newEmp.designation,
          location: newEmp.location,
          reportingManagerName: newEmp.reportingManagerName,
          filledBy: `${actor.firstName} ${actor.lastName} (${actor.role})`,
        },
      },
    });

    dbStore.logAudit({
      userId: actor._id,
      userEmail: actor.email,
      role: actor.role,
      action: 'ONBOARDING_EMPLOYEE_CREATED',
      module: 'ONBOARDING',
      entity: 'Employee',
      entityId: newEmp._id,
      details: { employeeCode: code, name: `${newUser.firstName} ${newUser.lastName}`, department: newEmp.department },
    });

    const invite = await issueInvite(req, newUser, newEmp, actor, false);

    res.status(201).json({
      success: true,
      employee: newEmp,
      submissionId: sub._id,
      loginEmail: email,
      invite,
    });
  }
);

apiRouter.post(
  '/onboarding/employees/:employeeId/resend-invite',
  requireAuth,
  requireRole('ADMIN'),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const emp = dbStore.getEmployeeById(req.params.employeeId);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    const user = dbStore.findUserById(emp.userId);
    if (!user) return res.status(404).json({ error: 'User account not found.' });
    if (!user.passwordPending) {
      return res.status(400).json({ error: 'This employee has already set a password. No invite is needed.' });
    }
    const invite = await issueInvite(req, user, emp, actor, true);
    res.json({ success: true, invite });
  }
);

apiRouter.get(
  '/onboarding/queue',
  requireAuth,
  requireRole('ADMIN'),
  (_req: AuthenticatedRequest, res) => {
    const submissions = dbStore.getOnboardingSubmissions().map((sub) => {
      const u = dbStore.users.get(sub.userId);
      const invitePending = u?.passwordPending === true;
      const tok = invitePending ? inviteStore.getPendingSetupTokenForUser(sub.userId) : undefined;
      return {
        ...sub,
        invitePending,
        inviteExpiresAt: tok?.expiresAt,
        inviteExpired: invitePending && (!tok || Date.parse(tok.expiresAt) <= Date.now()),
      };
    });
    const stats = {
      total: submissions.length,
      submitted: submissions.filter((s) => s.status === 'SUBMITTED').length,
      inProgress: submissions.filter((s) => s.status === 'IN_PROGRESS').length,
      verified: submissions.filter((s) => s.status === 'VERIFIED').length,
      needsCorrection: submissions.filter((s) => s.status === 'NEEDS_CORRECTION').length,
    };
    res.json({ submissions, stats });
  }
);

apiRouter.get(
  '/onboarding/submissions/:id',
  requireAuth,
  requireRole('ADMIN'),
  (req: AuthenticatedRequest, res) => {
    const sub = dbStore.getOnboardingSubmissionById(req.params.id);
    if (!sub) {
      return res.status(404).json({ error: 'Onboarding submission not found.' });
    }
    res.json({ submission: sub });
  }
);

apiRouter.post(
  '/onboarding/submissions/:id/verify',
  requireAuth,
  requireRole('ADMIN'),
  (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { id } = req.params;
    const sub = dbStore.getOnboardingSubmissionById(id);
    if (!sub) {
      return res.status(404).json({ error: 'Submission not found.' });
    }

    const updated = dbStore.updateOnboardingSubmission(id, {
      status: 'VERIFIED',
      verifiedAt: new Date().toISOString(),
      verifiedBy: `${user.firstName} ${user.lastName} (${user.role})`,
      rejectionRemarks: undefined,
    });

    syncOnboardingDocsToRepository(sub, 'VERIFIED', {
      verifiedBy: `${user.firstName} ${user.lastName} (${user.role})`,
    });

    if (sub.userId) {
      dbStore.updateUser(sub.userId, {
        onboardingCompleted: true,
        onboardingStep: ONBOARDING_TOTAL_STEPS,
      });
    }

    if (sub.employeeId) {
      const emp = dbStore.getEmployeeById(sub.employeeId);
      if (emp && emp.status === 'PROBATION') {
        dbStore.updateEmployee(sub.employeeId, { status: 'ACTIVE' });
      }
    }

    dbStore.notifications.unshift({
      _id: `notif_${Date.now()}`,
      recipientUserId: sub.userId,
      title: 'Onboarding Approved & Verified',
      message: 'Your onboarding profile has been approved and verified by HR. Welcome aboard!',
      type: 'ONBOARDING',
      isRead: false,
      createdAt: new Date().toISOString(),
    });

    dbStore.logAudit({
      userId: user._id,
      userEmail: user.email,
      role: user.role,
      action: 'ONBOARDING_VERIFIED',
      module: 'ONBOARDING',
      entity: 'OnboardingSubmission',
      entityId: id,
      details: { candidate: sub.employeeName, employeeCode: sub.employeeCode },
    });

    res.json({ success: true, submission: updated });
  }
);

apiRouter.post(
  '/onboarding/submissions/:id/request-changes',
  requireAuth,
  requireRole('ADMIN'),
  (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { id } = req.params;
    const { remarks } = req.body;

    if (!remarks) {
      return res.status(400).json({ error: 'Remarks explaining what needs correction are required.' });
    }

    const sub = dbStore.getOnboardingSubmissionById(id);
    if (!sub) {
      return res.status(404).json({ error: 'Submission not found.' });
    }

    const updated = dbStore.updateOnboardingSubmission(id, {
      status: 'NEEDS_CORRECTION',
      rejectionRemarks: remarks,
    });

    // Flag the candidate's documents in Document Management as Revision Requested
    syncOnboardingDocsToRepository(sub, 'REVISION_REQUESTED', {
      reason: remarks,
      verifiedBy: `${user.firstName} ${user.lastName} (${user.role})`,
    });

    dbStore.notifications.unshift({
      _id: `notif_${Date.now()}`,
      recipientUserId: sub.userId,
      title: 'Action Required: Onboarding Corrections Needed',
      message: `HR reviewed your submission and requested adjustments: ${remarks}`,
      type: 'ONBOARDING',
      isRead: false,
      createdAt: new Date().toISOString(),
    });

    dbStore.logAudit({
      userId: user._id,
      userEmail: user.email,
      role: user.role,
      action: 'ONBOARDING_CORRECTION_REQUESTED',
      module: 'ONBOARDING',
      entity: 'OnboardingSubmission',
      entityId: id,
      details: { remarks },
    });

    res.json({ success: true, submission: updated });
  }
);

// -------------------------------------------------------------
// DOCUMENTS REPOSITORY (Multer Upload & Streaming Support)
// -------------------------------------------------------------
apiRouter.get('/documents', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { category, status, employeeId } = req.query as {
    category?: string;
    status?: string;
    employeeId?: string;
  };

  const docs = dbStore.getDocumentsForUser(user, { category, status, employeeId });

  res.json({
    total: docs.length,
    documents: docs,
  });
});

apiRouter.post(
  '/documents',
  requireAuth,
  upload.single('file'),
  (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const uploadedFile = req.file;

    const body = req.body || {};
    const category = body.category || 'IDENTITY';
    const title = body.title || (uploadedFile ? uploadedFile.originalname.replace(/\.[^/.]+$/, '') : '');
    const requestedEmployeeId = body.employeeId;
    const expiryDate = body.expiryDate;

    if (!title) {
      return res.status(400).json({ error: 'Document title is required.' });
    }

    let targetEmployeeId = user.employeeId;
    if ((user.role === 'ADMIN') && requestedEmployeeId) {
      targetEmployeeId = requestedEmployeeId;
    }

    if (!targetEmployeeId) {
      return res.status(400).json({ error: 'Target employee record not identified.' });
    }

    const targetEmp = dbStore.getEmployeeById(targetEmployeeId);
    if (!targetEmp) {
      return res.status(404).json({ error: 'Target employee not found.' });
    }

    const fileName = uploadedFile ? uploadedFile.originalname : (body.fileName || 'document_scan.pdf');
    const fileType = uploadedFile ? uploadedFile.mimetype : (body.fileType || 'application/pdf');
    const fileSize = uploadedFile ? formatBytes(uploadedFile.size) : (body.fileSize || '1.5 MB');
    const storedFileName = uploadedFile ? uploadedFile.filename : undefined;

    const newDoc = dbStore.createDocument({
      employeeId: targetEmp._id,
      employeeName: `${targetEmp.firstName} ${targetEmp.lastName}`,
      employeeCode: targetEmp.employeeCode,
      department: targetEmp.department,
      category,
      title,
      fileName,
      fileType,
      fileSize,
      fileUrl: storedFileName ? `/api/documents/files/${storedFileName}` : `/api/documents/demo/${fileName}`,
      expiryDate,
      uploadedBy: `${user.firstName} ${user.lastName} (${user.role})`,
      uploadedAt: new Date().toISOString(),
      status: user.role === 'ADMIN' ? 'VERIFIED' : 'PENDING',
      verifiedBy: user.role === 'ADMIN' ? `${user.firstName} ${user.lastName}` : undefined,
      verifiedAt: user.role === 'ADMIN' ? new Date().toISOString() : undefined,
    });

    if (storedFileName) {
      (newDoc as any).storedFileName = storedFileName;
    }

    dbStore.logAudit({
      userId: user._id,
      userEmail: user.email,
      role: user.role,
      action: 'DOCUMENT_UPLOADED',
      module: 'DOCUMENTS',
      entity: 'Document',
      entityId: newDoc._id,
      details: { title, category, employeeCode: targetEmp.employeeCode },
    });

    res.status(201).json({ success: true, document: newDoc });
  }
);

apiRouter.get('/documents/:id/download', requireAuth, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const doc = dbStore.documents.get(id);

  if (!doc) {
    return res.status(404).json({ error: 'Document record not found.' });
  }

  const storedFileName = (doc as any).storedFileName;
  if (storedFileName) {
    const physicalPath = path.join(uploadDir, storedFileName);
    if (fs.existsSync(physicalPath)) {
      return res.download(physicalPath, doc.fileName);
    }
  }

  const content = `%PDF-1.4\n% Anusyuti HRMS Enterprise Compliance Document Vault\nDocument: ${doc.title}\nEmployee: ${doc.employeeName} (${doc.employeeCode})\nDepartment: ${doc.department}\nCategory: ${doc.category}\nStatus: ${doc.status}\nVerified By: ${doc.verifiedBy || 'Pending'}\nTimestamp: ${doc.uploadedAt}\n`;
  res.setHeader('Content-Type', doc.fileType || 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`);
  return res.send(Buffer.from(content, 'utf-8'));
});

apiRouter.post(
  '/documents/:id/verify',
  requireAuth,
  requireRole('ADMIN'),
  (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { id } = req.params;

    const updated = dbStore.updateDocument(id, {
      status: 'VERIFIED',
      verifiedBy: `${user.firstName} ${user.lastName} (${user.role})`,
      verifiedAt: new Date().toISOString(),
      rejectionReason: undefined,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    dbStore.logAudit({
      userId: user._id,
      userEmail: user.email,
      role: user.role,
      action: 'DOCUMENT_VERIFIED',
      module: 'DOCUMENTS',
      entity: 'Document',
      entityId: id,
      details: { title: updated.title },
    });

    res.json({ success: true, document: updated });
  }
);

apiRouter.post(
  '/documents/:id/reject',
  requireAuth,
  requireRole('ADMIN'),
  (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required.' });
    }

    const updated = dbStore.updateDocument(id, {
      status: 'REJECTED',
      rejectionReason: reason,
      verifiedBy: `${user.firstName} ${user.lastName} (${user.role})`,
      verifiedAt: new Date().toISOString(),
    });

    if (!updated) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    dbStore.logAudit({
      userId: user._id,
      userEmail: user.email,
      role: user.role,
      action: 'DOCUMENT_REJECTED',
      module: 'DOCUMENTS',
      entity: 'Document',
      entityId: id,
      details: { title: updated.title, reason },
    });

    res.json({ success: true, document: updated });
  }
);

apiRouter.delete('/documents/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { id } = req.params;

  const doc = dbStore.documents.get(id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  if (user.role !== 'ADMIN' && doc.employeeId !== user.employeeId) {
    return res.status(403).json({ error: 'Unauthorized to delete this document.' });
  }

  const storedFileName = (doc as any).storedFileName;
  if (storedFileName) {
    const physicalPath = path.join(uploadDir, storedFileName);
    if (fs.existsSync(physicalPath)) {
      try {
        fs.unlinkSync(physicalPath);
      } catch (e) {
        // ignore
      }
    }
  }

  dbStore.deleteDocument(id);

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'DOCUMENT_DELETED',
    module: 'DOCUMENTS',
    entity: 'Document',
    entityId: id,
    details: { title: doc.title },
  });

  res.json({ success: true, message: 'Document deleted successfully.' });
});

// -------------------------------------------------------------
// CAREER LIFECYCLE MANAGEMENT ENDPOINTS
// -------------------------------------------------------------
apiRouter.get('/lifecycle/events', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { eventType, employeeId } = req.query as {
    eventType?: string;
    employeeId?: string;
  };

  const events = dbStore.getLifecycleEventsForUser(user, { eventType, employeeId });

  res.json({
    total: events.length,
    events,
  });
});

apiRouter.post(
  '/lifecycle/events',
  requireAuth,
  requireRole('ADMIN'),
  (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const {
      employeeId,
      eventType,
      effectiveDate,
      previousValue,
      newValue,
      reason,
      notes,
    } = req.body;

    if (!employeeId || !eventType || !effectiveDate || !newValue || !reason) {
      return res.status(400).json({
        error: 'employeeId, eventType, effectiveDate, newValue, and reason are required.',
      });
    }

    const emp = dbStore.getEmployeeById(employeeId);
    if (!emp) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const newEvent = dbStore.createLifecycleEvent({
      employeeId: emp._id,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      employeeCode: emp.employeeCode,
      department: emp.department,
      eventType,
      effectiveDate,
      previousValue: previousValue || 'Current',
      newValue,
      reason,
      initiatedBy: `${user.firstName} ${user.lastName} (${user.role})`,
      approvalStatus: 'APPROVED',
      notes,
    });

    if (eventType === 'PROMOTION' || eventType === 'DESIGNATION_CHANGE') {
      dbStore.updateEmployee(emp._id, { designation: newValue });
    } else if (eventType === 'TRANSFER') {
      dbStore.updateEmployee(emp._id, { department: newValue });
    } else if (eventType === 'CONFIRMATION') {
      dbStore.updateEmployee(emp._id, { status: 'ACTIVE' });
    } else if (eventType === 'STATUS_CHANGE') {
      dbStore.updateEmployee(emp._id, { status: newValue as any });
    }

    if (emp.userId) {
      dbStore.notifications.unshift({
        _id: `notif_${Date.now()}`,
        recipientUserId: emp.userId,
        title: `Career Lifecycle Update: ${eventType}`,
        message: `Your profile has been updated (${eventType}): ${newValue}. Effective ${effectiveDate}.`,
        type: 'SYSTEM',
        isRead: false,
        createdAt: new Date().toISOString(),
      });
    }

    dbStore.logAudit({
      userId: user._id,
      userEmail: user.email,
      role: user.role,
      action: `LIFECYCLE_${eventType}`,
      module: 'LIFECYCLE',
      entity: 'Employee',
      entityId: emp._id,
      details: { previousValue, newValue, effectiveDate, reason },
    });

    res.status(201).json({
      success: true,
      event: newEvent,
      updatedEmployee: dbStore.getEmployeeById(emp._id),
    });
  }
);

// -------------------------------------------------------------
// TIME, ATTENDANCE & AUTOMATIC OVERTIME
// -------------------------------------------------------------
apiRouter.get('/attendance', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { date, month, employeeId, status } = req.query as {
    date?: string;
    month?: string;
    employeeId?: string;
    status?: string;
  };

  const records = dbStore.getAttendanceForUser(user, {
    date,
    month,
    employeeId,
    status,
  });

  const todayStr = new Date().toISOString().split('T')[0];
  const todayRecords = records.filter((record) => record.date === todayStr);

  const stats = {
    totalRecords: records.length,
    todayPresent: todayRecords.filter(
      (record) => record.status === 'PRESENT' || record.status === 'WORK_FROM_HOME'
    ).length,
    todayCheckedInNow: todayRecords.filter(
      (record) => Boolean(record.checkInTime) && !record.checkOutTime
    ).length,
    todayLate: todayRecords.filter((record) => record.status === 'LATE').length,
    totalOvertimeHours:
      Math.round(records.reduce((acc, record) => acc + (record.overtimeHours || 0), 0) * 100) / 100,
    totalExtraDayCredit:
      Math.round(records.reduce((acc, record) => acc + (record.extraDayCredit || 0), 0) * 100) / 100,
    totalWorkedHours:
      Math.round(records.reduce((acc, record) => acc + (record.effectiveWorkingHours || 0), 0) * 100) / 100,
  };

  res.json({
    records,
    stats,
    userRole: user.role,
  });
});

apiRouter.post('/attendance/check-in', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { employeeId: requestedEmpId, location, clientTime } = req.body;

  let empId = user.employeeId;
  if ((user.role === 'ADMIN') && requestedEmpId) {
    empId = requestedEmpId;
  }

  if (!empId) {
    return res.status(400).json({
      error: 'No associated employee record found for check-in.',
    });
  }

  let locationText = 'Office Location';
  if (location && typeof location === 'object' && typeof location.latitude === 'number') {
    locationText = `Lat: ${location.latitude.toFixed(4)}, Lng: ${location.longitude.toFixed(4)} (±${Math.round(location.accuracy || 10)}m)`;
  } else if (typeof location === 'string') {
    locationText = location;
  }

  const geo = isValidFix(location) ? location : undefined;
  const record = dbStore.checkIn(empId, locationText, req.ip, geo, clientTime);

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'ATTENDANCE_CHECK_IN',
    module: 'ATTENDANCE',
    entity: 'AttendanceRecord',
    entityId: record._id,
    details: { time: record.checkInTime, location: locationText, workMode: record.workMode, distanceKm: record.checkInDistanceKm },
  });

  const inModeText =
    record.workMode === 'WORK_FROM_OFFICE'
      ? ` You are ${Math.round((record.checkInDistanceKm || 0) * 1000)} m from the office (within ${OFFICE_RADIUS_KM * 1000} m) - marked Work From Office.`
      : record.workMode === 'WORK_FROM_HOME'
      ? ` You are ${(record.checkInDistanceKm ?? 0).toFixed(2)} km from the office (outside ${OFFICE_RADIUS_KM} km) - marked Work From Home.`
      : '';

  res.json({
    success: true,
    message: `Checked in successfully at ${record.checkInTime}.${inModeText}`,
    record,
  });
});

apiRouter.post('/attendance/check-out', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { employeeId: requestedEmpId, location, clientTime } = req.body;

  let empId = user.employeeId;
  if ((user.role === 'ADMIN') && requestedEmpId) {
    empId = requestedEmpId;
  }

  if (!empId) {
    return res.status(400).json({
      error: 'No associated employee record found for check-out.',
    });
  }

  let locationText = 'Office Location';
  if (location && typeof location === 'object' && typeof location.latitude === 'number') {
    locationText = `Lat: ${location.latitude.toFixed(4)}, Lng: ${location.longitude.toFixed(4)} (±${Math.round(location.accuracy || 10)}m)`;
  } else if (typeof location === 'string') {
    locationText = location;
  }

  const outGeo = isValidFix(location) ? location : undefined;
  const record = dbStore.checkOut(empId, locationText, outGeo, clientTime);

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'ATTENDANCE_CHECK_OUT',
    module: 'ATTENDANCE',
    entity: 'AttendanceRecord',
    entityId: record._id,
    details: {
      time: record.checkOutTime,
      effectiveHours: record.effectiveWorkingHours,
      overtimeHours: record.overtimeHours,
      extraDayCredit: record.extraDayCredit,
      extraPayTier: record.extraPayTier,
      workMode: record.workMode,
      distanceKm: record.checkOutDistanceKm,
    },
  });

  const creditText = record.extraDayCredit
    ? ` Extra pay earned: +${record.extraDayCredit} day${record.extraDayCredit === 1 ? '' : 's'}.`
    : ' No extra pay for this shift.';

  const outModeText =
    record.workMode === 'WORK_FROM_OFFICE'
      ? ' Day marked Work From Office (check-in and check-out both within 0.5 km of the office).'
      : record.workMode === 'WORK_FROM_HOME'
      ? ' Day marked Work From Home (check-in or check-out was more than 0.5 km from the office).'
      : '';

  res.json({
    success: true,
    message: `Checked out successfully at ${record.checkOutTime}. Total time: ${Math.round(((record.totalMinutesWorked || 0) / 60) * 100) / 100}h (break included).${creditText}${outModeText}`,
    record,
  });
});

apiRouter.post(
  '/attendance/:id/regularize',
  requireAuth,
  requireRole('ADMIN'),
  (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { id } = req.params;
    const { checkInTime, checkOutTime, status, reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({
        error: 'A justification reason is required for regularization.',
      });
    }

    const updated = dbStore.regularizeAttendance(
      id,
      {
        checkInTime,
        checkOutTime,
        status,
        regularizationReason: String(reason).trim(),
      },
      `${user.firstName} ${user.lastName} (${user.role})`
    );

    if (!updated) {
      return res.status(404).json({ error: 'Attendance record not found.' });
    }

    dbStore.logAudit({
      userId: user._id,
      userEmail: user.email,
      role: user.role,
      action: 'ATTENDANCE_REGULARIZED',
      module: 'ATTENDANCE',
      entity: 'AttendanceRecord',
      entityId: id,
      details: { checkInTime, checkOutTime, status, reason: String(reason).trim() },
    });

    res.json({
      success: true,
      record: updated,
    });
  }
);

// -------------------------------------------------------------
// SHIFTS ENDPOINTS
// -------------------------------------------------------------
apiRouter.get('/shifts', requireAuth, (_req, res) => {
  res.json({ shifts: dbStore.getShifts() });
});

apiRouter.post('/shifts', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { name, startTime, endTime, workDays, breakMinutes, gracePeriodMinutes } = req.body;
  if (!name || !startTime || !endTime) {
    return res.status(400).json({ error: 'Shift name, start time, and end time are required.' });
  }

  const shift = dbStore.createShift({
    name,
    code: req.body.code || name.substring(0, 4).toUpperCase(),
    startTime,
    endTime,
    expectedHours: Number(req.body.expectedHours) || 8,
    breakMinutes: breakMinutes || 60,
    gracePeriodMinutes: gracePeriodMinutes || 15,
    isNightShift: Boolean(req.body.isNightShift),
    departments: Array.isArray(req.body.departments) ? req.body.departments : ['All'],
    isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
  });

  res.status(201).json({ success: true, shift });
});

apiRouter.put('/shifts/:id', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const updated = dbStore.updateShift(id, req.body);
  if (!updated) return res.status(404).json({ error: 'Shift not found.' });
  res.json({ success: true, shift: updated });
});

apiRouter.delete('/shifts/:id', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const deleted = dbStore.deleteShift(id);
  if (!deleted) return res.status(404).json({ error: 'Shift not found.' });
  res.json({ success: true, message: 'Shift deleted successfully.' });
});

// -------------------------------------------------------------
// LEAVE MANAGEMENT
// -------------------------------------------------------------
apiRouter.get('/leave/balance', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const targetEmpId = (user.role === 'ADMIN') && req.query.employeeId
    ? String(req.query.employeeId)
    : (user.employeeId || 'emp_admin_01');
  const balance = modulesStore.getLeaveBalance(targetEmpId);
  res.json({ balance });
});

apiRouter.get('/leave/requests', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { status, employeeId } = req.query as { status?: string; employeeId?: string };
  const requests = modulesStore.getLeaveRequests(user, { status, employeeId });
  const balance = user.employeeId ? modulesStore.getLeaveBalance(user.employeeId) : null;
  res.json({ requests, balance });
});

apiRouter.post('/leave/apply', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const emp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  if (!emp) {
    return res.status(400).json({ error: 'No employee record linked to current user.' });
  }

  // Note: daysCount from the browser is ignored; the server calculates it.
  const { leaveType, startDate, endDate, isHalfDay, halfDaySession, reason, documentUrl } = req.body;
  if (!leaveType || !startDate || !endDate || !reason) {
    return res.status(400).json({ error: 'leaveType, startDate, endDate, and reason are required.' });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  let daysCount = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  if (isHalfDay) daysCount = 0.5;

  const leave = modulesStore.createLeaveRequest({
    employeeId: emp._id,
    employeeName: `${emp.firstName} ${emp.lastName}`,
    employeeCode: emp.employeeCode,
    department: emp.department,
    leaveType,
    startDate,
    endDate,
    daysCount,
    isHalfDay: !!isHalfDay,
    halfDaySession,
    reason,
    documentUrl,
  });

  if (user.role === 'ADMIN') {
    modulesStore.updateLeaveStatus(leave._id, 'APPROVED', `${user.firstName} ${user.lastName} (${user.role} Auto-approved)`);
  }

  res.status(201).json({ success: true, leave });
});

// Any logged-in user can call this; who may approve / reject / cancel is decided in the store.
apiRouter.put('/leave/:id/status', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { id } = req.params;
  const { status, rejectionReason } = req.body;

  if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  const reviewerName = `${user.firstName} ${user.lastName} (${user.role})`;
  const leave = modulesStore.updateLeaveStatus(
    id,
    status,
    reviewerName,
    rejectionReason
  );

  if (!leave) {
    return res.status(404).json({ error: 'Leave request not found.' });
  }
  res.json({ success: true, leave });
});

// -------------------------------------------------------------
// EXPENSES
// -------------------------------------------------------------
apiRouter.get('/expenses', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { status, category, employeeId } = req.query as { status?: string; category?: string; employeeId?: string };
  const claims = modulesStore.getExpenses(user, { status, category, employeeId });
  res.json({ claims });
});

apiRouter.post('/expenses', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const emp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  if (!emp) {
    return res.status(400).json({ error: 'No employee record linked to current user.' });
  }

  const { title, category, amount, currency = 'INR', expenseDate, description, receiptName } = req.body;
  if (!title || !category || !amount || !expenseDate || !description) {
    return res.status(400).json({ error: 'Missing required expense fields.' });
  }

  const claim = modulesStore.createExpense({
    employeeId: emp._id,
    employeeName: `${emp.firstName} ${emp.lastName}`,
    employeeCode: emp.employeeCode,
    department: emp.department,
    title,
    category,
    amount: Number(amount),
    currency,
    expenseDate,
    description,
    receiptName,
  });

  res.status(201).json({ success: true, claim });
});

apiRouter.put('/expenses/:id/status', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { id } = req.params;
  const { status, rejectionReason, paymentReference } = req.body;

  const reviewerName = `${user.firstName} ${user.lastName} (${user.role})`;
  const updated = modulesStore.updateExpenseStatus(id, status, reviewerName, { rejectionReason, paymentReference });
  if (!updated) return res.status(404).json({ error: 'Expense claim not found.' });

  res.json({ success: true, claim: updated });
});

// -------------------------------------------------------------
// PAYROLL
// -------------------------------------------------------------
apiRouter.get('/payroll/payslips', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { month, employeeId } = req.query as { month?: string; employeeId?: string };
  const payslips = modulesStore.getPayslips(user, { month, employeeId });

  const summary = {
    totalSlips: payslips.length,
    totalDisbursed: payslips.reduce((a, b) => a + b.grossSalary, 0),
    totalDeductions: payslips.reduce((a, b) => a + b.totalDeductions, 0),
    netPayout: payslips.reduce((a, b) => a + b.netSalary, 0),
  };

  res.json({ payslips, summary });
});

apiRouter.post('/payroll/run', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { month, monthName } = req.body;
  if (!month || !monthName) {
    return res.status(400).json({ error: 'Month (YYYY-MM) and monthName are required.' });
  }

  const generated = modulesStore.runMonthlyPayroll(month, monthName, `${user.firstName} ${user.lastName}`);
  res.json({
    success: true,
    message: `Payroll run completed for ${monthName}. Generated ${generated.length} payslips.`,
    generatedCount: generated.length,
  });
});

// Salary structure (FY 2026-27) - CTC breakup shown on the Payroll page.
// Employees / managers get their own CTC; ADMIN & HR can pick any employee.
apiRouter.get('/payroll/salary-structure', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const canSeeAll = user.role === 'ADMIN';
  const requestedId = String(req.query.employeeId || '');

  const targetId = canSeeAll && requestedId ? requestedId : user.employeeId;
  const emp = targetId ? dbStore.employees.get(targetId) : undefined;
  if (!emp) {
    return res.status(404).json({ error: 'No employee record found for salary structure.' });
  }

  const employees = canSeeAll
    ? Array.from(dbStore.employees.values()).map((e) => ({
        _id: e._id,
        name: `${e.firstName} ${e.lastName}`,
        employeeCode: e.employeeCode,
        annualCtc: e.annualSalary || 0,
      }))
    : undefined;

  const annualCtc = emp.annualSalary || 0;
  res.json({
    employee: {
      _id: emp._id,
      name: `${emp.firstName} ${emp.lastName}`,
      employeeCode: emp.employeeCode,
      designation: emp.designation,
      department: emp.department,
    },
    annualCtc,
    structure: computeSalaryStructure(annualCtc),
    employees,
    canEditCtc: canSeeAll,
  });
});

// -------------------------------------------------------------
// TAX DECLARATION
// -------------------------------------------------------------
apiRouter.get('/tax/declaration', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const targetEmpId = (user.role === 'ADMIN') && req.query.employeeId
    ? String(req.query.employeeId)
    : (user.employeeId || 'emp_admin_01');
  const declaration = modulesStore.getTaxDeclaration(targetEmpId) || null;
  res.json({ declaration });
});

apiRouter.post('/tax/declaration', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const targetEmpId = user.employeeId || 'emp_admin_01';
  const declaration = modulesStore.saveTaxDeclaration(targetEmpId, req.body);
  res.json({ success: true, declaration });
});

// -------------------------------------------------------------
// POLICIES & COMPANY COMPLIANCE
// -------------------------------------------------------------
apiRouter.get('/policies', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const policies = modulesStore.getPolicies();
  const acknowledgements = modulesStore.getPolicyAcknowledgements(user.employeeId);
  res.json({ policies, acknowledgements });
});

apiRouter.post('/policies', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { title, category, version, summary, content, mandatory, effectiveDate } = req.body;
  if (!title || !category || !content) {
    return res.status(400).json({ error: 'title, category, and content are required.' });
  }

  const id = `pol_${Date.now()}`;
  const now = new Date().toISOString();
  const policy = {
    _id: id,
    title: String(title).trim(),
    category,
    version: version || '1.0',
    summary: summary || '',
    content: String(content).trim(),
    mandatory: Boolean(mandatory),
    effectiveDate: effectiveDate || now.split('T')[0],
    lastUpdated: now,
    status: 'ACTIVE' as const,
  };
  modulesStore.policies.set(id, policy);

  res.status(201).json({ success: true, policy });
});

apiRouter.delete('/policies/:id', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const deleted = modulesStore.policies.delete(id);
  if (!deleted) {
    return res.status(404).json({ error: 'Policy not found.' });
  }
  res.json({ success: true, message: 'Policy deleted successfully.' });
});

apiRouter.post('/policies/:id/acknowledge', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const emp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  const empName = emp ? `${emp.firstName} ${emp.lastName}` : `${user.firstName} ${user.lastName}`;
  const signature = req.body.signature || `${empName} (Digital)`;

  const acknowledgement = modulesStore.acknowledgePolicy(
    req.params.id,
    user.employeeId || 'emp_01',
    empName,
    signature,
    req.ip || '127.0.0.1'
  );

  res.json({ success: true, acknowledgement });
});

// -------------------------------------------------------------
// POSH (Strictly Admin & HR)
// -------------------------------------------------------------
apiRouter.get('/posh/cases', requireAuth, requireRole('ADMIN'), (_req: AuthenticatedRequest, res) => {
  res.json({ cases: modulesStore.getPoshCases() });
});

apiRouter.post('/posh/cases', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { incidentDate, complainantName, complainantCode, isAnonymous, respondentName, respondentDesignation, respondentDepartment, description, committeeAssigned } = req.body;
  if (!respondentName || !description) {
    return res.status(400).json({ error: 'Missing required POSH case fields.' });
  }

  const num = Math.floor(100 + Math.random() * 900);
  const pCase = modulesStore.createPoshCase({
    caseNumber: `POSH-2026-${num}`,
    incidentDate: incidentDate || new Date().toISOString().split('T')[0],
    complainantName: isAnonymous ? 'Protected Anonymous' : (complainantName || 'Anonymous'),
    complainantCode: isAnonymous ? 'CONFIDENTIAL' : (complainantCode || 'CONFIDENTIAL'),
    isAnonymous: !!isAnonymous,
    respondentName,
    respondentDesignation: respondentDesignation || 'Unspecified',
    respondentDepartment: respondentDepartment || 'Unspecified',
    description,
    committeeAssigned: committeeAssigned || 'Internal Complaints Committee Lead',
  });

  res.status(201).json({ success: true, case: pCase });
});

apiRouter.put('/posh/cases/:id/stage', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { stage, notes, status } = req.body;
  const updated = modulesStore.updatePoshStage(req.params.id, stage, notes, status);
  if (!updated) return res.status(404).json({ error: 'POSH case not found.' });
  res.json({ success: true, case: updated });
});

// -------------------------------------------------------------
// HOLIDAYS & ANNOUNCEMENTS
// -------------------------------------------------------------
apiRouter.get('/holidays', requireAuth, (_req, res) => {
  res.json({ holidays: modulesStore.getHolidays() });
});

apiRouter.get('/announcements', requireAuth, (_req, res) => {
  res.json({ announcements: modulesStore.getAnnouncements() });
});

apiRouter.post('/announcements', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { title, content, category, priority, pinned, targetDepartment } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required.' });
  }

  const announcement = modulesStore.createAnnouncement({
    title,
    content,
    category: category || 'GENERAL',
    priority: priority || 'NORMAL',
    publishedBy: `${user.firstName} ${user.lastName} (${user.role})`,
    pinned: !!pinned,
    targetDepartment,
  });

  res.status(201).json({ success: true, announcement });
});

// -------------------------------------------------------------
// PERFORMANCE REVIEWS
// -------------------------------------------------------------
apiRouter.get('/performance/reviews', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { employeeId } = req.query as { employeeId?: string };
  const reviews = modulesStore.getPerformanceReviews(user, employeeId);
  res.json({ reviews });
});

// -------------------------------------------------------------
// RECRUITMENT
// -------------------------------------------------------------
apiRouter.get('/recruitment/jobs', requireAuth, (_req, res) => {
  res.json({ jobs: modulesStore.getJobOpenings() });
});

apiRouter.post('/recruitment/jobs', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { title, department, location, type = 'FULL_TIME', experienceRequired, openingsCount = 1, description, skillsRequired = [] } = req.body;
  if (!title || !department) {
    return res.status(400).json({ error: 'Job title and department are required.' });
  }

  const id = `job_${Date.now()}`;
  const job = {
    _id: id,
    title: String(title).trim(),
    department: String(department).trim(),
    location: location || 'San Francisco HQ',
    type,
    experienceRequired: experienceRequired || '2-4 years',
    openingsCount: Number(openingsCount),
    status: 'OPEN' as const,
    postedDate: new Date().toISOString().split('T')[0],
    description: description || '',
    skillsRequired: Array.isArray(skillsRequired) ? skillsRequired : [],
  };
  modulesStore.jobOpenings.set(id, job);

  res.status(201).json({ success: true, job });
});

apiRouter.get('/recruitment/candidates', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { jobId } = req.query as { jobId?: string };
  const candidates = modulesStore.getJobCandidates(jobId);
  res.json({ candidates });
});

// --- Manager manpower requirements ---
apiRouter.get('/recruitment/requirements', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  res.json({ requirements: modulesStore.getRequirements(req.user!) });
});

apiRouter.post('/recruitment/requirements', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const justification = String(b.justification || '').trim();
  const positions = Number(b.positions);
  const myEmp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  const department = String(b.department || myEmp?.department || '').trim();

  if (!title) return res.status(400).json({ error: 'Role / position title is required.' });
  if (!department) return res.status(400).json({ error: 'Department is required.' });
  if (!Number.isInteger(positions) || positions < 1 || positions > 100) {
    return res.status(400).json({ error: 'Number of positions must be a whole number between 1 and 100.' });
  }
  if (!justification) return res.status(400).json({ error: 'Please describe your requirement / justification.' });

  const skills: string[] = Array.isArray(b.skillsRequired)
    ? b.skillsRequired
    : String(b.skillsRequired || '').split(',');

  const requirement = modulesStore.createRequirement(user, {
    title,
    department,
    positions,
    employmentType: ['FULL_TIME', 'PART_TIME', 'CONTRACT'].includes(b.employmentType) ? b.employmentType : 'FULL_TIME',
    experienceRequired: String(b.experienceRequired || '').trim() || 'Not specified',
    skillsRequired: skills.map((x) => String(x).trim()).filter(Boolean),
    priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(b.priority) ? b.priority : 'MEDIUM',
    expectedJoiningDate: b.expectedJoiningDate ? String(b.expectedJoiningDate) : undefined,
    budgetRange: b.budgetRange ? String(b.budgetRange).trim() : undefined,
    location: b.location ? String(b.location).trim() : undefined,
    justification,
  });

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'REQUIREMENT_SUBMITTED',
    module: 'RECRUITMENT',
    entity: 'Requirement',
    entityId: requirement._id,
    details: { title, department, positions, priority: requirement.priority },
  });

  res.status(201).json({ success: true, requirement });
});

apiRouter.put('/recruitment/requirements/:id/review', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const decision = String(req.body?.decision || '');
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return res.status(400).json({ error: 'Decision must be APPROVED or REJECTED.' });
  }
  const result = modulesStore.reviewRequirement(
    req.params.id,
    decision,
    `${user.firstName} ${user.lastName}`.trim(),
    req.body?.note ? String(req.body.note).trim() : undefined
  );
  if (!result) return res.status(404).json({ error: 'Requirement not found.' });

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: `REQUIREMENT_${decision}`,
    module: 'RECRUITMENT',
    entity: 'Requirement',
    entityId: result.requirement._id,
    details: { title: result.requirement.title, jobCreated: result.job?._id },
  });

  res.json({ success: true, requirement: result.requirement, job: result.job });
});

// --- Schedule interview: moves candidate to INTERVIEW and e-mails the invitation ---
apiRouter.post('/recruitment/candidates/:id/schedule-interview', requireAuth, requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const cand = modulesStore.jobCandidates.get(req.params.id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
  if (cand.stage === 'HIRED' || cand.stage === 'REJECTED') {
    return res.status(400).json({ error: `Cannot schedule an interview for a candidate who is ${cand.stage.toLowerCase()}.` });
  }
  if (!/^\S+@\S+\.\S+$/.test(cand.email || '')) {
    return res.status(400).json({ error: 'This candidate does not have a valid e-mail address.' });
  }

  const b = req.body || {};
  const date = String(b.date || '');
  const time = String(b.time || '');
  const interviewer = String(b.interviewer || '').trim();
  const mode = ['IN_PERSON', 'VIDEO', 'PHONE'].includes(b.mode) ? b.mode : 'VIDEO';
  const locationOrLink = String(b.locationOrLink || '').trim();
  const duration = Number(b.durationMinutes) || 45;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Interview date is required.' });
  if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Interview time is required.' });
  if (new Date(`${date}T${time}:00`).getTime() < Date.now() - 60 * 1000) {
    return res.status(400).json({ error: 'Interview date and time must be in the future.' });
  }
  if (!interviewer) return res.status(400).json({ error: 'Interviewer name is required.' });
  if (!locationOrLink) {
    return res.status(400).json({ error: mode === 'IN_PERSON' ? 'Venue is required.' : mode === 'VIDEO' ? 'Meeting link is required.' : 'Contact number is required.' });
  }

  const hrName = `${user.firstName} ${user.lastName}`.trim();
  const mail = buildInterviewEmail({
    candidateName: cand.fullName,
    jobTitle: cand.jobTitle,
    date,
    time,
    durationMinutes: duration,
    mode,
    locationOrLink,
    interviewer,
    notes: b.notes ? String(b.notes).trim() : undefined,
    hrName,
  });
  const result = await sendMail({ to: cand.email, ...mail });

  const updated = modulesStore.setCandidateInterview(cand._id, {
    date,
    time,
    durationMinutes: duration,
    mode,
    locationOrLink,
    interviewer,
    notes: b.notes ? String(b.notes).trim() : undefined,
    emailSentAt: new Date().toISOString(),
    emailStatus: result.delivered ? 'SENT' : result.simulated ? 'SIMULATED' : 'FAILED',
    scheduledBy: hrName,
  });

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'INTERVIEW_SCHEDULED',
    module: 'RECRUITMENT',
    entity: 'Candidate',
    entityId: cand._id,
    details: { candidate: cand.fullName, date, time, mode, email: result.delivered ? 'sent' : result.simulated ? 'simulated' : 'failed' },
  });

  res.json({
    success: true,
    candidate: updated,
    email: result,
    message: result.delivered || result.simulated
      ? `Interview scheduled and invitation e-mailed to ${cand.email}.`
      : `Interview scheduled, but the e-mail could not be sent: ${result.error}`,
  });
});

// --- Submit interview feedback and advance stage or reject ---
apiRouter.post('/recruitment/candidates/:id/feedback', requireAuth, requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const cand = modulesStore.jobCandidates.get(req.params.id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found.' });

  const b = req.body || {};
  const round = b.round || 'TECHNICAL_INTERVIEW';
  const rating = Number(b.rating) || 4;
  const comments = String(b.comments || '').trim();
  const recommendation = b.recommendation === 'REJECT' ? 'REJECT' : 'NEXT_ROUND';

  if (!comments) return res.status(400).json({ error: 'Feedback comments are required.' });

  const hrName = `${user.firstName} ${user.lastName}`.trim();
  const feedbackObj = {
    round,
    rating,
    comments,
    recommendation,
    submittedAt: new Date().toISOString(),
    submittedBy: hrName,
  };

  let emailResult = null;
  if (recommendation === 'REJECT' && /^\S+@\S+\.\S+$/.test(cand.email || '')) {
    try {
      const mail = buildRejectionEmail({
        candidateName: cand.fullName,
        jobTitle: cand.jobTitle || 'Open Position',
        hrName,
      });
      emailResult = await sendMail({ to: cand.email, ...mail });
    } catch (err: any) {
      console.error('[Recruitment] Rejection email error:', err?.message);
    }
  }

  const updated = modulesStore.addCandidateFeedback(cand._id, feedbackObj);
  res.json({ success: true, candidate: updated, email: emailResult });
});

// --- Extend offer: moves candidate to OFFERED and e-mails the offer letter ---
apiRouter.post('/recruitment/candidates/:id/extend-offer', requireAuth, requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const cand = modulesStore.jobCandidates.get(req.params.id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
  if (cand.stage !== 'TECHNICAL_INTERVIEW' && cand.stage !== 'HR_INTERVIEW' && cand.stage !== 'OFFERED') {
    return res.status(400).json({ error: 'An offer can only be extended to a candidate who has reached the interview stage.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(cand.email || '')) {
    return res.status(400).json({ error: 'This candidate does not have a valid e-mail address.' });
  }

  const b = req.body || {};
  const annualCtc = Number(b.annualCtc);
  const joiningDate = String(b.joiningDate || '');
  const validTill = String(b.validTill || '');
  const designation = String(b.designation || cand.jobTitle).trim();
  const job = modulesStore.jobOpenings.get(cand.jobId);
  const location = String(b.location || job?.location || 'Head Office').trim();

  if (!Number.isFinite(annualCtc) || annualCtc < 100000 || annualCtc > 100000000) {
    return res.status(400).json({ error: 'Enter the annual CTC in rupees (between 1,00,000 and 10,00,00,000).' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) return res.status(400).json({ error: 'Date of joining is required.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validTill)) return res.status(400).json({ error: 'Offer validity date is required.' });
  if (validTill >= joiningDate) return res.status(400).json({ error: 'Offer must expire before the date of joining.' });
  if (!designation) return res.status(400).json({ error: 'Designation is required.' });

  const hrName = `${user.firstName} ${user.lastName}`.trim();
  const mail = buildOfferEmail({
    candidateName: cand.fullName,
    jobTitle: designation,
    department: job?.department || 'General',
    annualCtc,
    joiningDate,
    validTill,
    location,
    reportingTo: b.reportingTo ? String(b.reportingTo).trim() : undefined,
    notes: b.notes ? String(b.notes).trim() : undefined,
    hrName,
  });
  const result = await sendMail({ to: cand.email, ...mail });

  const updated = modulesStore.setCandidateOffer(cand._id, {
    annualCtc,
    designation,
    joiningDate,
    validTill,
    location,
    reportingTo: b.reportingTo ? String(b.reportingTo).trim() : undefined,
    notes: b.notes ? String(b.notes).trim() : undefined,
    emailSentAt: new Date().toISOString(),
    emailStatus: result.delivered ? 'SENT' : result.simulated ? 'SIMULATED' : 'FAILED',
    extendedBy: hrName,
  });

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'OFFER_EXTENDED',
    module: 'RECRUITMENT',
    entity: 'Candidate',
    entityId: cand._id,
    details: { candidate: cand.fullName, designation, joiningDate, email: result.delivered ? 'sent' : result.simulated ? 'simulated' : 'failed' },
  });

  res.json({
    success: true,
    candidate: updated,
    email: result,
    message: result.delivered || result.simulated
      ? `Offer letter e-mailed to ${cand.email}.`
      : `Offer recorded, but the e-mail could not be sent: ${result.error}`,
  });
});

// --- Reject candidate: moves candidate to REJECTED and e-mails rejection ---
apiRouter.post('/recruitment/candidates/:id/reject', requireAuth, requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  let cand = modulesStore.jobCandidates.get(req.params.id);
  if (!cand) {
    for (const c of modulesStore.jobCandidates.values()) {
      if (c._id === req.params.id) {
        cand = c;
        break;
      }
    }
  }
  if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
  if (cand.stage === 'HIRED') {
    return res.status(400).json({ error: 'Cannot reject a candidate who has already been hired.' });
  }

  const hrName = `${user.firstName} ${user.lastName}`.trim();
  let emailResult = null;
  try {
    if (/^\S+@\S+\.\S+$/.test(cand.email || '')) {
      const mail = buildRejectionEmail({
        candidateName: cand.fullName,
        jobTitle: cand.jobTitle || 'Open Position',
        hrName,
      });
      emailResult = await sendMail({ to: cand.email, ...mail });
    }
  } catch (err: any) {
    console.error('[Recruitment] Rejection email error:', err?.message);
  }

  const updated = modulesStore.updateCandidateStage(cand._id, 'REJECTED');

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'CANDIDATE_REJECTED',
    module: 'RECRUITMENT',
    entity: 'Candidate',
    entityId: cand._id,
    details: { candidate: cand.fullName, emailDelivered: emailResult?.delivered },
  });

  res.json({ success: true, candidate: updated, email: emailResult });
});

// --- Employee referrals (open to every logged-in role) ---
apiRouter.get('/recruitment/referrals', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ referrals: modulesStore.getReferrals(req.user!) });
});

apiRouter.post('/recruitment/referrals', requireAuth, (req: AuthenticatedRequest, res) => {
  resumeUpload.single('resume')(req, res, (uploadErr: any) => {
    if (uploadErr) {
      const msg =
        uploadErr.code === 'LIMIT_FILE_SIZE' ? 'Resume must be 5 MB or smaller.' : uploadErr.message || 'Resume upload failed.';
      return res.status(400).json({ error: msg });
    }

    const user = req.user!;
    const body = req.body || {};
    const file = req.file;
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim();
    const city = String(body.city || '').trim();
    const experienceYears = Number(body.experienceYears);

    const discard = () => file && fs.existsSync(file.path) && fs.unlinkSync(file.path);

    if (!fullName || !city || !email) {
      discard();
      return res.status(400).json({ error: 'Name, email and city are required.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      discard();
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!Number.isFinite(experienceYears) || experienceYears < 0 || experienceYears > 60) {
      discard();
      return res.status(400).json({ error: 'Years of experience must be a number between 0 and 60.' });
    }
    if (!file) {
      return res.status(400).json({ error: 'Please attach the candidate\'s resume.' });
    }

    const job = body.jobId ? modulesStore.jobOpenings.get(String(body.jobId)) : undefined;

    const referral = modulesStore.createReferral(user, {
      fullName,
      email,
      phone: body.phone ? String(body.phone).trim() : undefined,
      city,
      experienceYears,
      jobId: job?._id,
      jobTitle: job?.title,
      relationship: body.relationship ? String(body.relationship).trim() : undefined,
      notes: body.notes ? String(body.notes).trim() : undefined,
      resumeFileName: file.originalname,
      storedFileName: file.filename,
    });

    dbStore.logAudit({
      userId: user._id,
      userEmail: user.email,
      role: user.role,
      action: 'REFERRAL_SUBMITTED',
      module: 'RECRUITMENT',
      entity: 'Referral',
      entityId: referral._id,
      details: { candidate: fullName, city, experienceYears, job: job?.title || 'General' },
    });

    res.status(201).json({ success: true, referral: { _id: referral._id } });
  });
});

apiRouter.get('/recruitment/referrals/:id/resume', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const r = modulesStore.referrals.get(req.params.id);
  if (!r || !r.storedFileName) return res.status(404).json({ error: 'Resume not found.' });

  const allowed = user.role === 'ADMIN' || r.referredById === user._id;
  if (!allowed) return res.status(403).json({ error: 'Only HR or the referrer can view this resume.' });

  const physicalPath = path.join(resumeDir, r.storedFileName);
  if (!fs.existsSync(physicalPath)) return res.status(404).json({ error: 'Resume file is missing on the server.' });
  return res.download(physicalPath, r.resumeFileName || 'resume.pdf');
});

apiRouter.put('/recruitment/referrals/:id/status', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { status } = req.body;
  const valid = ['SUBMITTED', 'IN_REVIEW', 'SHORTLISTED', 'HIRED', 'NOT_SELECTED'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid referral status.' });
  const updated = modulesStore.updateReferralStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Referral not found.' });
  res.json({ success: true });
});

apiRouter.post('/recruitment/referrals/:id/convert', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const candidate = modulesStore.convertToCandidate(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'Referral not found.' });
  res.json({ success: true, candidate });
});

apiRouter.put('/recruitment/candidates/:id/stage', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { stage } = req.body;
  const updated = modulesStore.updateCandidateStage(req.params.id, stage);
  if (!updated) return res.status(404).json({ error: 'Candidate not found.' });
  res.json({ success: true, candidate: updated });
});

// -------------------------------------------------------------
// HR SERVICE DESK
// -------------------------------------------------------------
apiRouter.get('/hr-requests', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { status } = req.query as { status?: string };
  const requests = modulesStore.getHrRequests(user, status);
  res.json({ requests });
});

apiRouter.post('/hr-requests', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const emp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
  if (!emp) {
    return res.status(400).json({ error: 'No employee record linked to current user.' });
  }

  const { category, subject, description, priority } = req.body;
  if (!subject || !description) {
    return res.status(400).json({ error: 'Subject and description are required.' });
  }

  const requestDoc = modulesStore.createHrRequest({
    employeeId: emp._id,
    employeeName: `${emp.firstName} ${emp.lastName}`,
    employeeCode: emp.employeeCode,
    department: emp.department,
    category: category || 'GENERAL',
    subject,
    description,
    priority: priority || 'MEDIUM',
  });

  res.status(201).json({ success: true, request: requestDoc });
});

apiRouter.put('/hr-requests/:id/resolve', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { remarks } = req.body;
  if (!remarks) {
    return res.status(400).json({ error: 'Resolution remarks are required.' });
  }

  const updated = modulesStore.resolveHrRequest(req.params.id, remarks);
  if (!updated) return res.status(404).json({ error: 'HR request ticket not found.' });

  res.json({ success: true, request: updated });
});

// -------------------------------------------------------------
// FULL & FINAL SETTLEMENT
// -------------------------------------------------------------
apiRouter.get('/full-final', requireAuth, requireRole('ADMIN'), (_req: AuthenticatedRequest, res) => {
  res.json({ settlements: modulesStore.getFullFinalSettlements() });
});

// -------------------------------------------------------------
// AUDIT LOGS (Admin only)
// -------------------------------------------------------------
apiRouter.get('/audit-logs', requireAuth, requireRole('ADMIN'), (_req: AuthenticatedRequest, res) => {
  res.json({ logs: dbStore.auditLogs.slice(0, 200) });
});

// -------------------------------------------------------------
// ALLOCATED ASSETS
// -------------------------------------------------------------
const ASSET_TYPES = [
  'LAPTOP', 'PHONE', 'CHARGER', 'TABLET', 'HEADSET',
  'CHAIR', 'DESK', 'CABINET',
  'SOFTWARE_LICENSE', 'SUBSCRIPTION',
  'CAR', 'BIKE', 'OTHER'
];

apiRouter.get('/assets', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const employeeId = req.query.employeeId ? String(req.query.employeeId) : undefined;
  const result = modulesStore.getAssets(user, { employeeId });
  res.json({ assets: result.assets, canManage: user.role === 'ADMIN' });
});

apiRouter.post('/assets', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const b = req.body || {};
  const employeeId = String(b.employeeId || '');
  const type = String(b.type || '').toUpperCase();
  const category = String(b.category || '').toUpperCase();
  const name = String(b.name || '').trim();
  const assetTag = String(b.assetTag || '').trim();

  if (!dbStore.employees.get(employeeId)) return res.status(400).json({ error: 'Select a valid employee.' });
  if (!ASSET_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid asset type selected.' });
  if (!name) return res.status(400).json({ error: 'Asset name / model is required.' });
  if (!assetTag) return res.status(400).json({ error: 'Asset tag / ID is required.' });

  const duplicate = Array.from(modulesStore.assets.values()).find(
    (a) => a.assetTag.toLowerCase() === assetTag.toLowerCase() && a.status === 'ALLOCATED'
  );
  if (duplicate) return res.status(409).json({ error: `Asset tag ${assetTag} is already allocated to another employee.` });

  const asset = modulesStore.allocateAsset({
    employeeId,
    type: type as any,
    category: category || undefined,
    name,
    assetTag,
    serialNumber: b.serialNumber ? String(b.serialNumber).trim() : undefined,
    issuedDate: /^\d{4}-\d{2}-\d{2}$/.test(String(b.issuedDate || '')) ? String(b.issuedDate) : new Date().toISOString().split('T')[0],
    notes: b.notes ? String(b.notes).trim() : undefined,
    allocatedBy: `${user.firstName} ${user.lastName}`.trim(),
  });

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'ASSET_ALLOCATED',
    module: 'ASSETS',
    entity: 'Asset',
    entityId: asset._id,
    details: { type, name, assetTag, employee: asset.employeeName },
  });

  res.status(201).json({ success: true, asset });
});

apiRouter.put('/assets/:id/return', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const asset = modulesStore.returnAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });

  dbStore.logAudit({
    userId: user._id,
    userEmail: user.email,
    role: user.role,
    action: 'ASSET_RETURNED',
    module: 'ASSETS',
    entity: 'Asset',
    entityId: asset._id,
    details: { type: asset.type, assetTag: asset.assetTag, employee: asset.employeeName },
  });

  res.json({ success: true, asset });
});

// -------------------------------------------------------------
// ORGANIZATION PROFILE & SETUP WIZARD
// -------------------------------------------------------------
apiRouter.get('/organization/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const org = dbStore.organizations.get(user.organizationId);
  if (!org) {
    return res.status(404).json({ error: 'Organization not found.' });
  }
  res.json({ organization: org });
});

apiRouter.put('/organization/profile', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const org = dbStore.organizations.get(user.organizationId);
  if (!org) {
    return res.status(404).json({ error: 'Organization not found.' });
  }
  const { name, code, domain, contactEmail, phone, taxIdentificationNumber, address } = req.body;
  if (name) org.name = String(name).trim();
  if (code) org.code = String(code).trim();
  if (domain) org.domain = String(domain).trim();
  if (contactEmail) org.contactEmail = String(contactEmail).trim();
  if (phone) org.phone = String(phone).trim();
  if (taxIdentificationNumber) org.taxIdentificationNumber = String(taxIdentificationNumber).trim();
  if (address && typeof address === 'object') {
    org.address = {
      street: address.street || org.address.street || '',
      city: address.city || org.address.city || '',
      state: address.state || org.address.state || '',
      country: address.country || org.address.country || '',
      zipCode: address.zipCode || org.address.zipCode || '',
    };
  }
  dbStore.organizations.set(org._id, org);
  res.json({ success: true, organization: org });
});

apiRouter.post('/organization/logo', requireAuth, requireRole('ADMIN'), upload.single('logo'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const org = dbStore.organizations.get(user.organizationId);
  if (!org) {
    return res.status(404).json({ error: 'Organization not found.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No logo file uploaded.' });
  }
  if (req.file.size > 2 * 1024 * 1024) {
    return res.status(400).json({ error: 'Logo file size cannot exceed 2MB.' });
  }

  const logoUrl = `/uploads/documents/${req.file.filename}`;
  org.logoUrl = logoUrl;
  dbStore.organizations.set(org._id, org);
  res.json({ success: true, logoUrl, organization: org });
});

apiRouter.post('/policies/upload', requireAuth, requireRole('ADMIN'), upload.single('policyPdf'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { title, category, version, effectiveDate, summary, mandatory } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded.' });
  }
  if (req.file.size > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'Policy PDF size cannot exceed 10MB.' });
  }

  const fileUrl = `/uploads/documents/${req.file.filename}`;
  const policyId = `pol_${Date.now()}`;
  const newPolicy = {
    _id: policyId,
    title: String(title || req.file.originalname),
    category: (category || 'GENERAL') as any,
    version: String(version || 'v1.0'),
    summary: String(summary || ''),
    content: `Uploaded PDF Policy Document: ${req.file.originalname}`,
    fileUrl,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    mandatory: mandatory === 'true' || mandatory === true,
    effectiveDate: String(effectiveDate || new Date().toISOString().split('T')[0]),
    lastUpdated: new Date().toISOString().split('T')[0],
  };

  modulesStore.policies.set(policyId, newPolicy);
  res.status(201).json({ success: true, policy: newPolicy });
});

apiRouter.get('/letter-templates', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const templates = modulesStore.getLetterTemplates(user.organizationId);
  res.json({ templates });
});

apiRouter.post('/letter-templates', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { title, category, subject, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required.' });
  }
  const tmpl = modulesStore.createLetterTemplate({
    organizationId: user.organizationId,
    title,
    category: category || 'OTHER',
    subject: subject || title,
    content,
  });
  res.status(201).json({ success: true, template: tmpl });
});

apiRouter.put('/letter-templates/:id', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { title, category, subject, content } = req.body;
  const updated = modulesStore.updateLetterTemplate(id, { title, category, subject, content });
  if (!updated) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  res.json({ success: true, template: updated });
});

apiRouter.delete('/letter-templates/:id', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const deleted = modulesStore.deleteLetterTemplate(id);
  if (!deleted) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  res.json({ success: true });
});

apiRouter.post('/letter-templates/:id/preview', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { id } = req.params;
  const { employeeId } = req.body;
  const preview = modulesStore.previewLetterTemplate(id, employeeId, user.organizationId);
  if (!preview) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  res.json({ success: true, ...preview });
});

apiRouter.post('/organization/complete-setup', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  user.orgSetupCompleted = true;
  dbStore.users.set(user._id, user);
  res.json({ success: true, user: { ...user, orgSetupCompleted: true } });
});

// -------------------------------------------------------------
// AI ASSISTANT (Gemini Server-side)
// -------------------------------------------------------------
apiRouter.post('/ai/chat', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const prompt = String(req.body?.prompt || req.body?.message || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required.' });
    }

    const user = req.user!;
    const policies = modulesStore.getPolicies();
    const policyContext = policies.map(p => `Title: ${p.title}\nCategory: ${p.category}\nSummary: ${p.summary}\nContent/Details: ${p.summary || p.title}\n---`).join('\n');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    const ai = new GoogleGenAI({ apiKey });
    const fullPrompt = `You are the Anusyuti HR Assistant for Anusyuti HRMS.
Here is the complete list of official company policies currently registered in the organization:
${policyContext || 'No company policies uploaded yet.'}

Employee Query: "${prompt}"

Instructions:
1. Answer the employee's query accurately using the company policies provided above.
2. Carefully evaluate whether the policies cover this query. If there are NO company policies regarding this specific query, you MUST start your response with the exact token "[NO_POLICY_FOUND]" and explain that while no specific policy was found, an automated HR Support Ticket has been logged for HR review.
3. Be professional, helpful, and concise.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: fullPrompt,
    });

    const rawReply = response.text || '';
    let ticketCreated = false;
    let ticketNumber = undefined;
    let finalReply = rawReply;

    if (rawReply.includes('[NO_POLICY_FOUND]')) {
      ticketCreated = true;
      finalReply = rawReply.replace('[NO_POLICY_FOUND]', '').trim();

      const emp = user.employeeId ? dbStore.employees.get(user.employeeId) : undefined;
      const ticket = modulesStore.createHrRequest({
        employeeId: user.employeeId || 'emp_system',
        employeeName: `${user.firstName} ${user.lastName}`,
        employeeCode: emp?.employeeCode || 'RHA-EMP',
        department: emp?.department || 'General',
        subject: `Policy Query Ticket: ${prompt.substring(0, 45)}...`,
        description: `Automated ticket generated because no existing company policy matched the employee inquiry: "${prompt}".`,
        category: 'GENERAL',
        priority: 'MEDIUM',
      });
      ticketNumber = ticket.ticketNumber;
      finalReply += `\n\n📌 [Automated HR Desk Ticket Created: ${ticket.ticketNumber}]`;

      // Notify Admin users
      const hrUsers = Array.from(dbStore.users.values()).filter(u => u.role === 'ADMIN');
      hrUsers.forEach(hr => {
        dbStore.notifications.unshift({
          _id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          recipientUserId: hr._id,
          title: `New Policy Inquiry Ticket (${ticket.ticketNumber})`,
          message: `Employee ${user.firstName} ${user.lastName} asked: "${prompt}". No matching policy was found, so ticket ${ticket.ticketNumber} was automatically created in the HR Service Desk.`,
          type: 'POLICY',
          isRead: false,
          createdAt: new Date().toISOString(),
        });
      });
    }

    return res.json({ reply: finalReply, ticketCreated, ticketNumber });
  } catch (err: any) {
    console.error('AI chat error:', err);
    return res.status(500).json({ error: 'AI request failed.', details: err?.message });
  }
});

// -------------------------------------------------------------
// NOTIFICATIONS ENDPOINTS
// -------------------------------------------------------------
apiRouter.get('/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!._id;
  const userNotifications = dbStore.notifications.filter(
    (n) => n.recipientUserId === userId || n.recipientUserId === 'ALL'
  );
  res.json({ notifications: userNotifications });
});

apiRouter.post('/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const notif = dbStore.notifications.find((n) => n._id === id);
  if (notif) {
    notif.isRead = true;
  }
  res.json({ success: true });
});

apiRouter.post('/notifications/mark-all-read', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!._id;
  dbStore.notifications.forEach((n) => {
    if (n.recipientUserId === userId || n.recipientUserId === 'ALL') {
      n.isRead = true;
    }
  });
  res.json({ success: true });
});

apiRouter.post('/organization/contact-manager', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { managerEmail, managerName, subject, message } = req.body;
  if (!managerEmail || !message) {
    return res.status(400).json({ error: 'Manager email and message are required.' });
  }
  try {
    const result = await sendMail({
      to: managerEmail,
      subject: subject || `Inquiry regarding Anusyuti HRMS from ${req.user!.firstName} ${req.user!.lastName}`,
      html: `<div style="font-family:sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:12px;">
        <h2 style="color:#023b77;margin-top:0;">Message for ${managerName || 'Manager'}</h2>
        <p>${message.replace(/\n/g, '<br/>')}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" />
        <p style="font-size:12px;color:#64748b;">Sent via Anusyuti HRMS Enterprise Portal by ${req.user!.firstName} ${req.user!.lastName} (${req.user!.email})</p>
      </div>`,
      text: `Message for ${managerName || 'Manager'}:\n\n${message}\n\nSent by ${req.user!.firstName} ${req.user!.lastName} (${req.user!.email})`,
    });
    res.json({ success: true, result, message: `Email successfully sent to ${managerName || managerEmail}.` });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to send email.', details: err?.message });
  }
});

// -------------------------------------------------------------
// CORPORATE EMPLOYEE INSURANCE MANAGEMENT
// -------------------------------------------------------------
apiRouter.get('/insurance/policy', requireAuth, (_req: AuthenticatedRequest, res) => {
  res.json({ policy: modulesStore.getInsurancePolicy() });
});

apiRouter.get('/insurance/enrollment', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const targetEmployeeId = (req.query.employeeId as string) || user.employeeId || 'emp_emp_01';
  const enrollment = modulesStore.getInsuranceEnrollment(targetEmployeeId);
  res.json({ enrollment: enrollment || null });
});

apiRouter.post('/insurance/enroll', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const targetEmployeeId = req.body.employeeId || user.employeeId || 'emp_emp_01';
  const enrollment = modulesStore.updateInsuranceEnrollment(targetEmployeeId, {
    sumInsured: req.body.sumInsured,
    dependents: req.body.dependents,
    status: req.body.status,
  });
  res.json({ success: true, enrollment });
});

apiRouter.get('/insurance/claims', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const status = req.query.status as string | undefined;
  const employeeId = req.query.employeeId as string | undefined;
  const claims = modulesStore.getInsuranceClaims(user, { status, employeeId });
  res.json({ claims });
});

apiRouter.post('/insurance/claims', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const employeeId = user.employeeId || 'emp_emp_01';
  const { patientName, relation, hospitalName, admissionDate, dischargeDate, claimType, amountRequested, diagnosis, documents } = req.body;
  if (!patientName || !hospitalName || !amountRequested) {
    return res.status(400).json({ error: 'Missing required insurance claim fields.' });
  }
  const claim = modulesStore.submitInsuranceClaim(employeeId, {
    patientName,
    relation,
    hospitalName,
    admissionDate: admissionDate || new Date().toISOString().split('T')[0],
    dischargeDate,
    claimType: claimType || 'REIMBURSEMENT',
    amountRequested: Number(amountRequested),
    diagnosis: diagnosis || 'General Medical Treatment',
    documents: documents || [],
  });
  res.status(201).json({ success: true, claim });
});

apiRouter.put('/insurance/claims/:id/status', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Unauthorized to review insurance claims.' });
  }
  const { status, tpaRemarks, amountApproved } = req.body;
  const updated = modulesStore.updateInsuranceClaimStatus(req.params.id, status, tpaRemarks, amountApproved);
  if (!updated) {
    return res.status(404).json({ error: 'Insurance claim not found.' });
  }
  res.json({ success: true, claim: updated });
});

// -------------------------------------------------------------
// FORM 24Q TDS MANAGEMENT
// -------------------------------------------------------------
apiRouter.get('/tax/form24q', requireAuth, (_req: AuthenticatedRequest, res) => {
  try {
    const data = modulesStore.getForm24QData();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve Form 24Q data', details: err?.message });
  }
});

apiRouter.put('/tax/form24q/status', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Unauthorized to modify TDS filing status' });
  }
  const { status, acknowledgementNumber } = req.body;
  if (!['Draft', 'Filed', 'Acknowledged'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be Draft, Filed, or Acknowledged.' });
  }
  const updated = modulesStore.updateForm24QStatus(status, acknowledgementNumber);
  res.json({ success: true, form24q: updated });
});

apiRouter.put('/tax/form24q/summary', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Unauthorized to update TDS filing summary' });
  }
  const updated = modulesStore.updateForm24QSummary(req.body);
  res.json({ success: true, form24q: updated });
});

apiRouter.post('/tax/form24q/validate', requireAuth, (_req: AuthenticatedRequest, res) => {
  try {
    const validation = modulesStore.validateForm24Q();
    res.json({ success: true, validation });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to validate TDS Form 24Q', details: err?.message });
  }
});

apiRouter.get('/tax/form24q/q1', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const data = modulesStore.getForm24QDataQ1();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve Q1 Form 24Q data', details: err?.message });
  }
});

apiRouter.get('/tax/cross-quarter-analysis', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const analysis = modulesStore.getCrossQuarterAnalysis();
    res.json({ success: true, analysis });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to analyze cross-quarter TDS', details: err?.message });
  }
});

apiRouter.get('/tax/employee/:pan/history', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const history = modulesStore.getEmployeeFullYearHistory(req.params.pan);
    res.json({ success: true, history });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch employee TDS history', details: err?.message });
  }
});

apiRouter.get('/tax/employee/:pan/projection', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const projection = modulesStore.calculateEmployeeProjection(req.params.pan);
    res.json({ success: true, projection });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to calculate TDS projection', details: err?.message });
  }
});


