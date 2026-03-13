"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyInfo,
} from "@/lib/api";

export default function ApiKeysPage() {
  const { isAuthenticated, loading: authLoading, promptSignIn } = useAuth();

  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      listApiKeys().then(setKeys).catch(() => {});
    }
  }, [isAuthenticated]);

  async function handleCreate() {
    setError("");
    setCreating(true);
    try {
      const res = await createApiKey(label || "default");
      setNewKey(res.key);
      setLabel("");
      const updated = await listApiKeys();
      setKeys(updated);
    } catch (e: any) {
      setError(e.message || "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: number) {
    try {
      await revokeApiKey(id);
      const updated = await listApiKeys();
      setKeys(updated);
    } catch (e: any) {
      setError(e.message || "Failed to revoke key");
    }
  }

  function copyKey() {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full skeleton" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gradient inline-block">
            API Keys
          </h1>
          <p className="text-slate-400">
            Create API keys for programmatic access to near.fm
          </p>
        </div>

        {!isAuthenticated ? (
          <div className="glass-card rounded-2xl p-5 text-center">
            <p className="text-slate-400 text-sm mb-3">
              Sign in to manage API keys
            </p>
            <button
              onClick={promptSignIn}
              className="btn-primary px-6 py-2 rounded-xl text-sm"
            >
              Sign In
            </button>
          </div>
        ) : (
          <>
            {/* Newly created key — show once */}
            {newKey && (
              <div className="glass-card rounded-2xl p-5 space-y-3 border border-green-500/20">
                <div className="text-sm font-medium text-green-400">
                  Key created — save it now, it won&apos;t be shown again
                </div>
                <div className="flex gap-2">
                  <code className="flex-1 bg-white/[0.04] rounded-lg px-3 py-2 text-xs text-slate-200 font-mono break-all select-all">
                    {newKey}
                  </code>
                  <button
                    onClick={copyKey}
                    className="px-3 py-2 rounded-lg text-xs bg-white/[0.08] text-slate-300 hover:bg-white/[0.12] transition-all shrink-0"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <button
                  onClick={() => setNewKey(null)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Create form */}
            <div className="glass-card rounded-2xl p-5 space-y-4">
              <div className="text-sm font-medium text-slate-300">
                Create New Key
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Label (optional)"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-white/[0.2] transition-colors"
                />
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 transition-all shrink-0"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
              {error && (
                <div className="text-red-400 text-xs bg-red-400/[0.08] rounded-lg p-3">
                  {error}
                </div>
              )}
            </div>

            {/* Usage info */}
            <div className="glass-card rounded-2xl p-5 space-y-3">
              <div className="text-sm font-medium text-slate-300">Usage</div>
              <div className="text-xs text-slate-400 space-y-2">
                <p>
                  Use your API key as a Bearer token to authenticate requests:
                </p>
                <code className="block bg-white/[0.04] rounded-lg px-3 py-2 text-slate-300 font-mono">
                  Authorization: Bearer nfm_...
                </code>
                <p>
                  API keys work with all endpoints: generate songs, check
                  balance, top up credits.
                </p>
              </div>
            </div>

            {/* Keys list */}
            {keys.length > 0 && (
              <div className="glass-card rounded-2xl p-5 space-y-3">
                <div className="text-sm font-medium text-slate-300">
                  Your Keys ({keys.filter((k) => !k.revoked_at).length} active)
                </div>
                <div className="space-y-2">
                  {keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between text-xs py-2 border-b border-white/[0.04] last:border-0"
                    >
                      <div className="space-y-0.5">
                        <div className="text-slate-300">
                          {k.label || "Unnamed"}
                        </div>
                        <div className="text-slate-500">
                          {new Date(k.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      {k.revoked_at ? (
                        <span className="text-slate-600 text-xs">Revoked</span>
                      ) : (
                        <button
                          onClick={() => handleRevoke(k.id)}
                          className="text-red-400 hover:text-red-300 text-xs transition-colors"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="text-center">
          <Link
            href="/"
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
