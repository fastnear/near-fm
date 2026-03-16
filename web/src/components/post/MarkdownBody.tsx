"use client";

import { useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { SongEmbed } from "./SongEmbed";

interface MarkdownBodyProps {
  children: string;
  /** "post" allows full markdown; "reply" strips headings/images */
  mode?: "post" | "reply";
}

export function MarkdownBody({ children, mode = "post" }: MarkdownBodyProps) {
  // Split text into markdown segments and song embeds using matchAll (no stateful regex)
  const segments = useMemo(() => {
    const result: { type: "md" | "song"; value: string }[] = [];
    const matches = [...children.matchAll(/\[\[song:([a-f0-9-]{36})\]\]/gi)];

    if (matches.length === 0) {
      return [{ type: "md" as const, value: children }];
    }

    let lastIndex = 0;
    for (const match of matches) {
      if (match.index! > lastIndex) {
        result.push({ type: "md", value: children.slice(lastIndex, match.index!) });
      }
      result.push({ type: "song", value: match[1] });
      lastIndex = match.index! + match[0].length;
    }
    if (lastIndex < children.length) {
      result.push({ type: "md", value: children.slice(lastIndex) });
    }
    return result;
  }, [children]);

  return (
    <div className="markdown-body">
      {segments.map((seg, i) =>
        seg.type === "song" ? (
          <SongEmbed key={i} uuid={seg.value} />
        ) : (
          <MarkdownSegment key={i} text={seg.value} mode={mode} />
        )
      )}
    </div>
  );
}

function MarkdownSegment({ text, mode }: { text: string; mode: "post" | "reply" }) {
  const handleExternalClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const href = e.currentTarget.getAttribute("href");
    if (!href) return;

    // Allow internal links
    try {
      const url = new URL(href, window.location.origin);
      if (url.origin === window.location.origin) return;
    } catch {
      return;
    }

    e.preventDefault();
    if (window.confirm(`You are about to leave near.fm and visit:\n\n${href}\n\nProceed?`)) {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }, []);

  const components: Components = useMemo(() => ({
    a: ({ href, children: c, ...props }: any) => (
      <a
        href={href}
        onClick={handleExternalClick}
        className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
        rel="noopener noreferrer"
        {...props}
      >
        {c}
      </a>
    ),
    p: ({ children: c }: any) => <p className="mb-1.5 last:mb-0">{c}</p>,
    strong: ({ children: c }: any) => <strong className="font-semibold text-white">{c}</strong>,
    em: ({ children: c }: any) => <em className="italic text-slate-200">{c}</em>,
    code: ({ children: c, className }: any) => {
      if (className) {
        return (
          <pre className="my-2 p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-x-auto text-[12px]">
            <code className="text-slate-300">{c}</code>
          </pre>
        );
      }
      return (
        <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[13px] text-slate-200 font-mono">{c}</code>
      );
    },
    pre: ({ children: c }: any) => <>{c}</>,
    blockquote: ({ children: c }: any) => (
      <blockquote className="border-l-2 border-purple-500/40 pl-3 my-2 text-slate-400 italic">{c}</blockquote>
    ),
    ul: ({ children: c }: any) => <ul className="list-disc list-inside my-1.5 space-y-0.5">{c}</ul>,
    ol: ({ children: c }: any) => <ol className="list-decimal list-inside my-1.5 space-y-0.5">{c}</ol>,
    li: ({ children: c }: any) => <li className="text-slate-300">{c}</li>,
    h1: mode === "reply"
      ? ({ children: c }: any) => <p className="font-semibold text-white">{c}</p>
      : ({ children: c }: any) => <h3 className="text-base font-semibold text-white mt-3 mb-1">{c}</h3>,
    h2: mode === "reply"
      ? ({ children: c }: any) => <p className="font-semibold text-white">{c}</p>
      : ({ children: c }: any) => <h4 className="text-sm font-semibold text-white mt-2 mb-1">{c}</h4>,
    h3: ({ children: c }: any) => <p className="font-semibold text-white">{c}</p>,
    h4: ({ children: c }: any) => <p className="font-semibold text-white">{c}</p>,
    h5: ({ children: c }: any) => <p className="font-semibold text-white">{c}</p>,
    h6: ({ children: c }: any) => <p className="font-semibold text-white">{c}</p>,
    hr: () => <hr className="my-3 border-white/[0.06]" />,
    // No external images — prevents IP leak to external servers
    img: () => null,
    // GFM tables
    table: ({ children: c }: any) => (
      <div className="my-2 overflow-x-auto rounded-lg border border-white/[0.06]">
        <table className="w-full text-[13px]">{c}</table>
      </div>
    ),
    thead: ({ children: c }: any) => <thead className="bg-white/[0.04]">{c}</thead>,
    tbody: ({ children: c }: any) => <tbody>{c}</tbody>,
    tr: ({ children: c }: any) => <tr className="border-b border-white/[0.04] last:border-0">{c}</tr>,
    th: ({ children: c }: any) => <th className="px-3 py-1.5 text-left text-slate-300 font-medium">{c}</th>,
    td: ({ children: c }: any) => <td className="px-3 py-1.5 text-slate-400">{c}</td>,
  }), [mode, handleExternalClick]);

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
