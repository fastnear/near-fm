"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Language } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { getLanguages, createBountyFromBalance } from "@/lib/api";

// Accepted bounty assets. Add more here to support additional tokens.
const BOUNTY_ASSETS = [
  { id: "usdc", label: "USDC", symbol: "$", minCents: 100, decimals: 2 },
  // { id: "near", label: "NEAR", symbol: "Ⓝ", minCents: 100, decimals: 2 },
  // { id: "sol", label: "SOL", symbol: "◎", minCents: 100, decimals: 2 },
];

const QUICK_AMOUNTS = [1, 5, 10, 25, 50]; // in USD

export default function NewRequestPage() {
  const { user, isAuthenticated, promptSignIn } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [bountyAmount, setBountyAmount] = useState("");
  const [selectedAsset] = useState(BOUNTY_ASSETS[0]);
  const [languageId, setLanguageId] = useState<number | undefined>();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getLanguages()
      .then((langs) => {
        setLanguages(langs);
        if (!languageId) {
          const english = langs.find((l) => l.code === "en");
          if (english) setLanguageId(english.id);
        }
      })
      .catch(console.error);
  }, []);

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="glass-card rounded-3xl p-12">
          <h1 className="text-2xl font-bold mb-4">Create a Song Request</h1>
          <p className="text-slate-400 mb-6">
            Sign in to create a song request with a bounty
          </p>
          <button onClick={promptSignIn} className="px-6 py-3 btn-primary rounded-xl font-medium">
            Sign In
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!title.trim()) { setError("Title is required"); return; }
    if (!description.trim()) { setError("Description is required"); return; }

    const usdAmount = parseFloat(bountyAmount);
    if (!bountyAmount || isNaN(usdAmount) || usdAmount < 1) {
      setError(`Minimum bounty is ${selectedAsset.symbol}1.00`);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const amountCents = Math.round(usdAmount * 100);
      const result = await createBountyFromBalance(
        title.trim(),
        description.trim(),
        amountCents,
        languageId,
      );
      router.push(`/requests/${result.uuid}`);
    } catch (e: any) {
      const msg = e?.message || "Failed to create request";
      if (msg.includes("Insufficient balance")) {
        setError("Insufficient balance. Top up first.");
      } else if (msg.includes("No wallet")) {
        setError("Please top up your balance first to create a bounty.");
      } else {
        setError(msg);
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-8">Create a Song Request</h1>

      <div className="space-y-6">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What kind of song are you looking for?"
            maxLength={200}
            className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Description *</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the song you want in detail: style, mood, lyrics theme, instruments, etc."
            rows={5}
            className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition resize-none"
          />
        </div>

        {/* Bounty Amount */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Bounty ({selectedAsset.label}) *
          </label>

          {/* Quick amounts */}
          <div className="flex gap-2 mb-3">
            {QUICK_AMOUNTS.map((v) => (
              <button
                key={v}
                onClick={() => setBountyAmount(String(v))}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                  bountyAmount === String(v)
                    ? "bg-purple-500/15 text-purple-300 border-purple-500/25"
                    : "bg-white/[0.04] text-slate-400 border-white/[0.06] hover:bg-white/[0.08]"
                }`}
              >
                {selectedAsset.symbol}{v}
              </button>
            ))}
          </div>

          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
              {selectedAsset.symbol}
            </span>
            <input
              type="number"
              value={bountyAmount}
              onChange={(e) => setBountyAmount(e.target.value)}
              placeholder="1.00"
              min={1}
              step="0.01"
              className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl pl-8 pr-16 py-3 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
              {selectedAsset.label}
            </span>
          </div>

          {/* Asset selector (shown when multiple assets available) */}
          {BOUNTY_ASSETS.length > 1 && (
            <div className="flex gap-2 mt-2">
              {BOUNTY_ASSETS.map((asset) => (
                <button
                  key={asset.id}
                  className={`px-3 py-1 text-xs rounded-lg border transition ${
                    selectedAsset.id === asset.id
                      ? "bg-purple-500/15 text-purple-300 border-purple-500/25"
                      : "bg-white/[0.04] text-slate-500 border-white/[0.06]"
                  }`}
                >
                  {asset.label}
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-500 mt-2">
            Minimum {selectedAsset.symbol}1. Anyone can add more to your bounty later.
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Pick a winner anytime. If no winner, you can withdraw after 30 days (20% fee).
            Funds are held in a dedicated escrow wallet.
          </p>
        </div>

        {/* Language */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Language (optional)</label>
          <select
            value={languageId ?? ""}
            onChange={(e) => setLanguageId(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-purple-500 transition"
          >
            <option value="">Any language</option>
            {languages.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 text-rose-400 text-sm">
            {error}
            {error.includes("balance") && (
              <a href="/balance" className="block mt-1 text-purple-400 hover:text-purple-300 underline">
                Top up balance →
              </a>
            )}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3 btn-primary rounded-xl disabled:opacity-30 disabled:cursor-not-allowed font-medium transition"
        >
          {submitting ? "Creating Request..." : "Create Request"}
        </button>
      </div>
    </div>
  );
}
