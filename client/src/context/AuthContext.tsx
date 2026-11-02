'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AuthUser } from '@/types';

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, role?: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: (googlePayload: any, role?: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let storedToken: string | null = null;
    let storedUserStr: string | null = null;

    try {
      storedToken = localStorage.getItem('mapwell_token') || sessionStorage.getItem('mapwell_token');
      storedUserStr = localStorage.getItem('mapwell_user') || sessionStorage.getItem('mapwell_user');
    } catch (e) {
      // Storage access blocked or restricted
    }

    if (storedToken && storedUserStr) {
      try {
        const parsedUser = JSON.parse(storedUserStr);
        setUser(parsedUser);
        setToken(storedToken);

        // Verify token with backend
        fetch('/api/auth/me', {
          headers: {
            Authorization: `Bearer ${storedToken}`
          }
        })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.success && data?.user) {
              setUser(data.user);
              if (localStorage.getItem('mapwell_token')) {
                localStorage.setItem('mapwell_user', JSON.stringify(data.user));
              } else {
                sessionStorage.setItem('mapwell_user', JSON.stringify(data.user));
              }
            } else {
              // Token invalid
              logout();
            }
          })
          .catch(() => {
            // Keep existing cached session if offline
          })
          .finally(() => setLoading(false));
      } catch (err) {
        logout();
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string, role = 'analyst', rememberMe = true) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to sign in. Please verify your credentials.' };
      }

      setUser(data.user);
      setToken(data.token);

      const storage = rememberMe ? localStorage : sessionStorage;
      // Clear opposite storage to avoid stale tokens
      const otherStorage = rememberMe ? sessionStorage : localStorage;
      try {
        otherStorage.removeItem('mapwell_token');
        otherStorage.removeItem('mapwell_user');
        storage.setItem('mapwell_token', data.token);
        storage.setItem('mapwell_user', JSON.stringify(data.user));
      } catch (e) {}

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error occurred during sign-in.' };
    }
  };

  const loginWithGoogle = async (googlePayload: any, role = 'analyst', rememberMe = true) => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...googlePayload, role })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Google authentication failed.' };
      }

      setUser(data.user);
      setToken(data.token);

      const storage = rememberMe ? localStorage : sessionStorage;
      const otherStorage = rememberMe ? sessionStorage : localStorage;
      try {
        otherStorage.removeItem('mapwell_token');
        otherStorage.removeItem('mapwell_user');
        storage.setItem('mapwell_token', data.token);
        storage.setItem('mapwell_user', JSON.stringify(data.user));
      } catch (e) {}

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Google sign-in error.' };
    }
  };

  const logout = () => {
    try {
      localStorage.removeItem('mapwell_token');
      localStorage.removeItem('mapwell_user');
      sessionStorage.removeItem('mapwell_token');
      sessionStorage.removeItem('mapwell_user');
      fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    } catch (e) {}
    setUser(null);
    setToken(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
