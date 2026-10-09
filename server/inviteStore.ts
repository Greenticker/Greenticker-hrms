/**
 * Storage for onboarding invite / password-setup tokens.
 */

export const INVITE_TTL_HOURS = 48;

export interface PasswordSetupTokenDoc {
  _id: string;
  userId: string;
  employeeId: string;
  tokenHash: string;
  purpose: 'ONBOARDING_INVITE';
  expiresAt: string;
  usedAt?: string;
  revokedAt?: string;
  createdBy: string;
  createdAt: string;
  emailSentAt?: string;
}

export const passwordSetupTokens: Map<string, PasswordSetupTokenDoc> = new Map();

export const inviteStore = {
  createSetupToken(input: {
    userId: string;
    employeeId: string;
    tokenHash: string;
    createdBy: string;
  }): PasswordSetupTokenDoc {
    const now = Date.now();
    const id = `pst_${now}_${Math.floor(Math.random() * 100000)}`;
    const doc: PasswordSetupTokenDoc = {
      _id: id,
      userId: input.userId,
      employeeId: input.employeeId,
      tokenHash: input.tokenHash,
      purpose: 'ONBOARDING_INVITE',
      expiresAt: new Date(now + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString(),
      createdBy: input.createdBy,
      createdAt: new Date(now).toISOString(),
    };
    passwordSetupTokens.set(id, doc);
    return doc;
  },

  findSetupTokenByHash(tokenHash: string): PasswordSetupTokenDoc | undefined {
    for (const t of passwordSetupTokens.values()) {
      if (t.tokenHash === tokenHash) return t;
    }
    return undefined;
  },

  findSetupTokenById(id: string): PasswordSetupTokenDoc | undefined {
    return passwordSetupTokens.get(id);
  },

  getPendingSetupTokenForUser(userId: string): PasswordSetupTokenDoc | undefined {
    return Array.from(passwordSetupTokens.values())
      .filter((t) => t.userId === userId && !t.usedAt && !t.revokedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  },

  revokeActiveTokensForUser(userId: string): void {
    const now = new Date().toISOString();
    for (const [id, t] of passwordSetupTokens) {
      if (t.userId === userId && !t.usedAt && !t.revokedAt) {
        passwordSetupTokens.set(id, { ...t, revokedAt: now });
      }
    }
  },

  updateSetupToken(id: string, partial: Partial<PasswordSetupTokenDoc>): void {
    const t = passwordSetupTokens.get(id);
    if (t) passwordSetupTokens.set(id, { ...t, ...partial });
  },
};
