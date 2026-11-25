import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User, Role, AuthResponse } from '../types/auth';
import { request, setAuthToken, getAuthToken } from '../services/api';

export interface MfaChallenge {
  mfaRequired: true;
  challengeId: string;
  message: string;
  devOtp?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  sessionMessage: string | null;
  login: (email: string, password: string) => Promise<User | MfaChallenge>;
  verifyOtp: (challengeId: string, code: string) => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<User>;
  signup: (firstName: string, lastName: string, email: string, password: string, role?: Role) => Promise<User>;
  switchRole: (targetRole: Role) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateOnboardingStatus: (completed: boolean, step: number) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const idleMinutes = useRef<number>(Number(localStorage.getItem('zenith_idle_minutes')) || 30);
  const lastActivity = useRef<number>(Date.now());
  const lastRefresh = useRef<number>(Date.now());

  const accept = (data: AuthResponse & { idleTimeoutMinutes?: number }) => {
    setAuthToken(data.accessToken);
    setToken(data.accessToken);
    setUser(data.user);
    if (data.idleTimeoutMinutes) {
      idleMinutes.current = data.idleTimeoutMinutes;
      localStorage.setItem('zenith_idle_minutes', String(data.idleTimeoutMinutes));
    }
    lastActivity.current = Date.now();
    lastRefresh.current = Date.now();
    setSessionMessage(null);
    return data.user;
  };

  // Idle timeout: the token expires after the configured idle time; while the user is active
  // the app refreshes it (never beyond the maximum session length enforced by the server).
  useEffect(() => {
    if (!user) return;
    const onActivity = () => { lastActivity.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const endSession = (text: string) => {
      setAuthToken(null);
      setToken(null);
      setUser(null);
      setSessionMessage(text);
    };
    const timer = window.setInterval(async () => {
      const idleMs = idleMinutes.current * 60_000;
      const now = Date.now();
      if (now - lastActivity.current >= idleMs) {
        endSession('You were signed out after a period of inactivity.');
        return;
      }
      if (now - lastRefresh.current > idleMs / 3 && now - lastActivity.current < idleMs / 3) {
        lastRefresh.current = now;
        try {
          accept(await request<AuthResponse>('/auth/refresh', { method: 'POST' }));
        } catch {
          endSession('Your session has ended. Please sign in again.');
        }
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      window.clearInterval(timer);
    };
  }, [user?.id]);

  const fetchCurrentUser = async () => {
    try {
      if (!getAuthToken()) {
        setIsLoading(false);
        return;
      }
      const data = await request<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch (err) {
      console.warn('Session expired or invalid token:', err);
      setAuthToken(null);
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const login = async (email: string, password: string): Promise<User | MfaChallenge> => {
    const data = await request<AuthResponse | MfaChallenge>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if ('mfaRequired' in data) return data;
    return accept(data);
  };

  const verifyOtp = async (challengeId: string, code: string): Promise<User> =>
    accept(await request<AuthResponse>('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ challengeId, code }) }));

  const changePassword = async (currentPassword: string, newPassword: string): Promise<User> =>
    accept(await request<AuthResponse>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }));

  const signup = async (
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    role: Role = 'EMPLOYEE'
  ): Promise<User> => {
    const data = await request<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ firstName, lastName, email, password, role }),
    });
    setAuthToken(data.accessToken);
    setToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const switchRole = async (targetRole: Role): Promise<User> => {
    const data = await request<AuthResponse>('/auth/switch-role', {
      method: 'POST',
      body: JSON.stringify({ targetRole }),
    });
    setAuthToken(data.accessToken);
    setToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    await fetchCurrentUser();
  };

  const updateOnboardingStatus = (completed: boolean, step: number) => {
    if (user) {
      setUser({
        ...user,
        onboardingCompleted: completed,
        onboardingStep: step,
      });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        sessionMessage,
        login,
        verifyOtp,
        changePassword,
        signup,
        switchRole,
        logout,
        refreshUser,
        updateOnboardingStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
