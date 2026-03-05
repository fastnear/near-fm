"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface ToastLink {
  url: string;
  label: string;
}

interface Toast {
  id: string;
  message: string;
  type: "loading" | "success" | "error";
  link?: ToastLink;
  duration?: number;
}

interface ToastContextType {
  showToast: (toast: Omit<Toast, "id"> & { id?: string }) => string;
  dismissToast: (id: string) => void;
  updateToast: (id: string, updates: Partial<Omit<Toast, "id">>) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => "",
  dismissToast: () => {},
  updateToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    if (toast.type === "loading") return;
    const dur = toast.duration ?? 5000;
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, dur);
    return () => clearTimeout(t);
  }, [toast.type, toast.duration, onDismiss]);

  const bgClass = toast.type === "success"
    ? "border-[#00ec97]/30 bg-[#00ec97]/10"
    : toast.type === "error"
    ? "border-rose-500/30 bg-rose-500/10"
    : "border-purple-500/30 bg-purple-500/10";

  const iconColor = toast.type === "success"
    ? "text-[#00ec97]"
    : toast.type === "error"
    ? "text-rose-400"
    : "text-purple-400";

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-2xl transition-all duration-300 max-w-sm ${bgClass} ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <div className={`shrink-0 mt-0.5 ${iconColor}`}>
        {toast.type === "loading" && (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
            <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {toast.type === "success" && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {toast.type === "error" && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200">{toast.message}</p>
        {toast.link && (
          <a
            href={toast.link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-purple-400 hover:text-purple-300 underline underline-offset-2 mt-1 inline-block"
          >
            {toast.link.label}
          </a>
        )}
      </div>
      {toast.type !== "loading" && (
        <button
          onClick={() => { setVisible(false); setTimeout(onDismiss, 300); }}
          className="text-slate-500 hover:text-slate-300 shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((input: Omit<Toast, "id"> & { id?: string }): string => {
    const id = input.id ?? Math.random().toString(36).slice(2);
    setToasts((prev) => {
      // Replace existing toast with same id
      const filtered = prev.filter((t) => t.id !== id);
      return [...filtered, { ...input, id }];
    });
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const updateToast = useCallback((id: string, updates: Partial<Omit<Toast, "id">>) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast, updateToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} onDismiss={() => dismissToast(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
