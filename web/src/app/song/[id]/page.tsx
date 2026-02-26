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

  return {
    title: `${song.title} — near.fm`,
    description:
      song.description ||
      `AI-generated song by ${song.uploader_account_id} on near.fm`,
    openGraph: {
      title: `${song.title} — near.fm`,
      description:
        song.description ||
        `AI-generated song by ${song.uploader_account_id}`,
      type: "music.song",
      siteName: "near.fm",
      ...(song.cover_image_url && { images: [{ url: song.cover_image_url }] }),
      ...(song.audio_url && {
        audio: [{ url: song.audio_url, type: song.audio_mime_type }],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: `${song.title} — near.fm`,
      description:
        song.description ||
        `AI-generated song on near.fm`,
      ...(song.cover_image_url && { images: [song.cover_image_url] }),
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
