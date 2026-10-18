import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken } from './api';
import { connectSocket, disconnectSocket } from './socket';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api('/auth/me').then((u) => { setUser(u); connectSocket(); })
      // only a rejected token destroys the session — a transient network
      // failure keeps it so the user is not logged out by a flaky wifi
      .catch((e) => { if (e.status === 401) localStorage.removeItem('token'); })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    connectSocket();
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    disconnectSocket();
    setUser(null);
  };

  // direct session (used by leader sign-up: server already returned token + user)
  const signIn = (token, user) => {
    localStorage.setItem('token', token);
    setUser(user);
    connectSocket();
    return user;
  };

  // re-read the current user from the server (after a profile edit)
  const refreshUser = async () => {
    const u = await api('/auth/me');
    setUser(u);
    return u;
  };

  return <AuthContext.Provider value={{ user, login, signIn, logout, refreshUser, loading }}>{children}</AuthContext.Provider>;
}
