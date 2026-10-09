import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';
import { dbStore, UserDoc } from './db.ts';
import { hasPermission, Role } from './rbac.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'zenith-hrms-enterprise-jwt-super-secret-key-2026';
const JWT_EXPIRES_IN = '24h';

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
  organizationId: string;
}

export function generateToken(user: UserDoc): string {
  const payload: JwtPayload = {
    userId: user._id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch (err) {
    return null;
  }
}

export function comparePassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function hashPassword(plain: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(plain, salt);
}

// Augment Express Request interface with authenticated user
export interface AuthenticatedRequest extends Request {
  user?: UserDoc;
  jwtPayload?: JwtPayload;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }

  const user = dbStore.findUserById(decoded.userId);
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'User not found or account deactivated.' });
  }

  req.user = user;
  req.jwtPayload = decoded;
  next();
}

export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: `Access Denied. Role '${req.user.role}' lacks permission: '${permission}'`,
      });
    }

    next();
  };
}

export function requireRole(...allowedRoles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied. Requires one of [${allowedRoles.join(', ')}]. Current role: ${req.user.role}`,
      });
    }

    next();
  };
}
