"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Language } from "@/types";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { createRequest, getLanguages } from "@/lib/api";
import { createBountyAction } from "@/lib/near/contract";

export default function NewRequestPage() {
  const { accountId, isAuthenticated, signIn, completeSignIn, callFunction } = useNearWallet();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [bountyAmount, setBountyAmount] = useState("");
  const [languageId, setLanguageId] = useState<number | undefined>();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [signing, setSigning] = useState(false);

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

  if (!accountId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="glass-card rounded-3xl p-12">
          <h1 className="text-2xl font-bold mb-4">Create a Song Request</h1>
          <p className="text-slate-400 mb-6">
            Sign in with your NEAR account to create a song request with a bounty
          </p>
          <button
            onClick={signIn}
            className="px-6 py-3 btn-primary rounded-xl font-medium transition"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const handleSign = async () => {
    setSigning(true);
    await completeSignIn();
    setSigning(false);
  };

  const handleSubmit = async () => {

    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!description.trim()) {
      setError("Description is required");
      return;
    }
    const nearAmount = parseFloat(bountyAmount);
    if (!bountyAmount || isNaN(nearAmount) || nearAmount < 1) {
      setError("Bounty must be at least 1 NEAR");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      // Convert NEAR to yoctoNEAR (1 NEAR = 1e24 yoctoNEAR)
      const amountYocto = BigInt(Math.round(nearAmount * 1e6)) * BigInt(1e18);
      const amountYoctoStr = amountYocto.toString();

      // Generate a temporary UUID for the on-chain bounty
      const requestUuid = crypto.randomUUID();

      // 1. Create on-chain bounty
      const action = createBountyAction(requestUuid, amountYoctoStr);
      const txHash = await callFunction({
        contractId: action.contractId,
        method: action.method,
        args: action.args as Record<string, unknown>,
        gas: action.gas,
        deposit: action.deposit,
      });

      // 2. Create request in backend
      await createRequest({
        title: title.trim(),
        description: description.trim(),
        bounty_amount_yocto: amountYoctoStr,
        bounty_tx_hash: txHash,
        language_id: languageId,
      });

      // 3. Redirect to requests list
      router.push("/requests");
    } catch (e: any) {
      console.error("Failed to create request:", e);
      setError(e instanceof Error ? e.message : "Failed to create request");
    }
    setSubmitting(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-8">Create a Song Request</h1>

      <div className="space-y-6">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Title *
          </label>
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
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Description *
          </label>
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
            Bounty Amount (NEAR) *
          </label>
          <div className="relative">
            <input
              type="number"
              value={bountyAmount}
              onChange={(e) => setBountyAmount(e.target.value)}
              placeholder="1"
              min={1}
              step="0.1"
              className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 pr-16 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
              NEAR
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Minimum 1 NEAR. This amount will be locked on-chain and awarded to
            the creator whose song you choose.
          </p>
        </div>

        {/* Language */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Language (optional)
          </label>
          <select
            value={languageId ?? ""}
            onChange={(e) =>
              setLanguageId(
                e.target.value ? Number(e.target.value) : undefined
              )
            }
            className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition"
          >
            <option value="">Any language</option>
            {languages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* Auth + Submit */}
        {!isAuthenticated ? (
          <div className="space-y-3">
            <button
              onClick={handleSign}
              disabled={signing}
              className="w-full py-3 btn-primary rounded-xl disabled:opacity-50 font-medium transition"
            >
              {signing ? "Waiting for signature..." : "Sign message to authorize"}
            </button>
            <p className="text-xs text-slate-500 text-center">
              One-time signature to verify your wallet. After signing you can create requests.
            </p>
          </div>
        ) : (
          <>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 btn-primary rounded-xl disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none font-medium transition"
            >
              {submitting ? "Creating Request..." : "Create Request"}
            </button>
            <p className="text-xs text-slate-600 text-center">
              By creating a request, your bounty will be locked in a smart contract
              until you award it to a song or withdraw it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
