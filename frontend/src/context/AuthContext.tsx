import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Role, AuthResponse } from '../types/auth';
import { request, setAuthToken, getAuthToken } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
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

  const login = async (email: string, password: string): Promise<User> => {
    const data = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(data.accessToken);
    setToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

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
        login,
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
