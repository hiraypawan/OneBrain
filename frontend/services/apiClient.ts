import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '',
  withCredentials: true,
});

api.interceptors.request.use((cfg) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('onebrain_token') : null;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
