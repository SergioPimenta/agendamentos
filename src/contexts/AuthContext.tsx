import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../services/api';
import type { PublicSettings, User } from '../types';

interface AuthContextType {
  user: User | null;
  settings: PublicSettings | null;
  loading: boolean;
  /** Não foi possível falar com o servidor ao iniciar (sem derrubar a sessão). */
  offline: boolean;
  retry: () => void;
  login: (token: string, user: User) => void;
  logout: () => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setUserState(null);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setOffline(false);
    (async () => {
      const [pub, me] = await Promise.allSettled([
        api.get<{ settings: PublicSettings }>('/public'),
        localStorage.getItem('token') ? api.get<{ user: User }>('/auth/me') : Promise.reject(new Error('no-token')),
      ]);
      if (!alive) return;
      if (pub.status === 'fulfilled') setSettings(pub.value.settings);
      if (me.status === 'fulfilled') setUserState(me.value.user);
      else if (me.reason instanceof ApiError && me.reason.status === 401) localStorage.removeItem('token');
      else if (localStorage.getItem('token')) setOffline(true);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    window.addEventListener('auth:expired', logout);
    return () => window.removeEventListener('auth:expired', logout);
  }, [logout]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      settings,
      loading,
      offline,
      retry: () => setAttempt((n) => n + 1),
      logout,
      setUser: setUserState,
      login: (token, u) => {
        localStorage.setItem('token', token);
        setUserState(u);
      },
    }),
    [user, settings, loading, offline, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
