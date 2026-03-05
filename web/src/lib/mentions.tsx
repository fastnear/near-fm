import Link from "next/link";
import type { ReactNode } from "react";

const MENTION_REGEX = /@([a-zA-Z0-9_\-.]+(?:\.near|\.testnet)?)/g;

export function renderWithMentions(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  MENTION_REGEX.lastIndex = 0;

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const username = match[1];
    parts.push(
      <Link
        key={`mention-${match.index}`}
        href={`/profile/${username}`}
        className="text-cyan-400 hover:underline"
      >
        @{username}
      </Link>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}
