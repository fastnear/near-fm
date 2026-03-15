"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { getCurrentUser, type AuthUser } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isPremium: boolean;
  loading: boolean;
  signInWithGoogle: () => void;
  promptSignIn: () => void;
  showSignInModal: boolean;
  closeSignInModal: () => void;
  signOut: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isPremium: false,
  loading: true,
  signInWithGoogle: () => {},
  promptSignIn: () => {},
  showSignInModal: false,
  closeSignInModal: () => {},
  signOut: () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSignInModal, setShowSignInModal] = useState(false);

  const isAuthenticated = !!user;
  const isPremium = !!user?.is_premium;

  const fetchUser = useCallback(async () => {
    try {
      const u = await getCurrentUser();
      setUser(u);
    } catch {
      setUser(null);
    }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Listen for session changes (NEAR sign-in, link-wallet, etc.)
  useEffect(() => {
    const onSessionChanged = () => {
      fetchUser();
    };
    const onExpired = () => {
      setUser(null);
    };
    window.addEventListener("nearfm_session_changed", onSessionChanged);
    window.addEventListener("nearfm_token_expired", onExpired);
    return () => {
      window.removeEventListener("nearfm_session_changed", onSessionChanged);
      window.removeEventListener("nearfm_token_expired", onExpired);
    };
  }, [fetchUser]);

  const signInWithGoogle = useCallback(() => {
    window.location.href = `${API_URL}/api/auth/google`;
  }, []);

  const promptSignIn = useCallback(() => {
    setShowSignInModal(true);
  }, []);

  const closeSignInModal = useCallback(() => {
    setShowSignInModal(false);
  }, []);

  const signOut = useCallback(async () => {
    // Clear wallet link on server before clearing cookie
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    setUser(null);
    window.dispatchEvent(new Event("nearfm_signed_out"));
  }, []);

  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isPremium,
        loading,
        signInWithGoogle,
        promptSignIn,
        showSignInModal,
        closeSignInModal,
        signOut,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
