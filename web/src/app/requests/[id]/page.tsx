import type { Metadata } from "next";
import { RequestDetail } from "./RequestDetail";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

async function fetchRequest(uuid: string) {
  try {
    const res = await fetch(`${API_URL}/api/requests/${uuid}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const req = await fetchRequest(id);
  if (!req) {
    return { title: "Request not found — near.fm" };
  }

  const bounty = req.bounty_usd_cents
    ? `$${(req.bounty_usd_cents / 100).toFixed(req.bounty_usd_cents % 100 === 0 ? 0 : 2)} bounty`
    : req.bounty_near
      ? `${(Number(req.bounty_near) / 1e24).toFixed(1)} NEAR bounty`
      : "";
  const title = `${req.title}${bounty ? ` — ${bounty}` : ""} — near.fm`;
  const description = req.description
    ? req.description.slice(0, 150)
    : `Song request by ${req.requester_account_id} on near.fm`;

  const ogImageUrl = `${API_URL.replace('api.near.fm', 'near.fm')}/api/og?${new URLSearchParams({
    title: req.title,
    subtitle: bounty,
    author: req.requester_display_name || req.requester_account_id,
    type: "request",
  })}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "near.fm",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: req.title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function RequestPage() {
  return <RequestDetail />;
}
