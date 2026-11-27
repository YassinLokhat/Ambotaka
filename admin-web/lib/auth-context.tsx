'use client';
import { createContext, useContext } from 'react';

export interface Me { id: string; username: string; roles: string[]; permissions: string[] }
export const AuthContext = createContext<{ me: Me; can: (p: string) => boolean } | null>(null);
export const useAuth = () => { const c = useContext(AuthContext); if (!c) throw new Error('AuthContext manquant'); return c; };
