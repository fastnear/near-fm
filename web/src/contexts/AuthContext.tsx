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

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? match[1] : null;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; Domain=.near.fm; Path=/; Max-Age=0`;
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

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
    if (!getCookie("nearfm_session")) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const u = await getCurrentUser();
      setUser(u);
    } catch {
      setUser(null);
      clearCookie("nearfm_session");
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
      clearCookie("nearfm_session");
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
    clearCookie("nearfm_session");
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
