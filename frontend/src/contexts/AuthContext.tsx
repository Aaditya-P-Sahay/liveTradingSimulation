import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

interface User {
  email: string;
  name?: string;
  role?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('auth_token');
    if (savedToken) {
      setToken(savedToken);
      checkAuth(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const checkAuth = async (authToken: string) => {
    try {
      const { data } = await axios.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      
      if (data.success) {
        setUser({
          email: data.user["Candidate's Email"],
          name: data.user["Candidate's Name"],
          role: data.user.role
        });
      }
    } catch (error) {
      localStorage.removeItem('auth_token');
      setToken(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const { data } = await axios.post(`${API_URL}/auth/login`, { email, password });
    
    if (data.success && data.token) {
      localStorage.setItem('auth_token', data.token);
      setToken(data.token);
      setUser({
        email: data.user?.["Candidate's Email"] || email,
        name: data.user?.["Candidate's Name"],
        role: data.user?.role
      });
    }
  };

  const signup = async (email: string, password: string, name: string) => {
    const { data } = await axios.post(`${API_URL}/auth/signup`, {
      email,
      password,
      full_name: name
    });
    
    if (data.success && data.token) {
      localStorage.setItem('auth_token', data.token);
      setToken(data.token);
      setUser({ email, name, role: 'user' });
    }
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};