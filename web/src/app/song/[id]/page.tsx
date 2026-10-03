import type { Metadata } from "next";
import { SongDetail } from "./SongDetail";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// Server-side: fetch song for OG tags
async function fetchSong(uuid: string) {
  try {
    const res = await fetch(`${API_URL}/api/songs/${uuid}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.song;
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
  const song = await fetchSong(id);
  if (!song) {
    return { title: "Song not found — near.fm" };
  }

  const siteBase = API_URL.replace('api.near.fm', 'near.fm');
  const artistName = song.uploader_display_name || song.uploader_account_id;
  // Songs with cover: use cover directly (faster, smaller). Without cover: generate OG image with text.
  const ogImage = song.cover_image_url || `${siteBase}/api/og?${new URLSearchParams({
    title: song.title,
    author: artistName,
    type: "song",
  })}`;
  const description = song.description
    ? song.description.slice(0, 150)
    : `Listen to "${song.title}" by ${artistName} — AI-generated music on near.fm. Vote, tip, and discover new tracks.`;
  const ogTitle = `${song.title} by ${artistName} — near.fm`;

  return {
    title: ogTitle,
    description,
    openGraph: {
      title: ogTitle,
      description,
      type: "music.song",
      siteName: "near.fm",
      images: [{ url: ogImage, width: 1200, height: 630, alt: song.title }],
      ...(song.audio_url && {
        audio: [{ url: song.audio_url, type: song.audio_mime_type }],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      images: [ogImage],
    },
  };
}

export default async function SongPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SongDetail uuid={id} />;
}
