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
      .catch(() => localStorage.removeItem('token'))
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

  return <AuthContext.Provider value={{ user, login, signIn, logout, loading }}>{children}</AuthContext.Provider>;
}
