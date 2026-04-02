"use client";

import { useState, useRef, useEffect } from "react";
import type { Song } from "@/types";

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (text: string) => void;
  songs?: Song[];
}

function insertAround(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  onInsert: (text: string) => void
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const replacement = `${before}${selected || "text"}${after}`;
  const newValue = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
  onInsert(newValue);
  // Select the inserted/wrapped text
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + (selected || "text").length);
  });
}

export function MarkdownToolbar({ textareaRef, onInsert, songs }: MarkdownToolbarProps) {
  const [showSongPicker, setShowSongPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSongPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowSongPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSongPicker]);

  const btn = "px-2 py-1 text-[11px] font-medium rounded-md bg-white/[0.04] border border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all";

  return (
    <div className="flex items-center gap-1 mb-1.5 relative">
      <button
        type="button"
        className={btn}
        title="Bold"
        onClick={() => {
          if (textareaRef.current) insertAround(textareaRef.current, "**", "**", onInsert);
        }}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className={btn}
        title="Italic"
        onClick={() => {
          if (textareaRef.current) insertAround(textareaRef.current, "*", "*", onInsert);
        }}
      >
        <em>I</em>
      </button>
      <button
        type="button"
        className={btn}
        title="Link"
        onClick={() => {
          if (!textareaRef.current) return;
          const ta = textareaRef.current;
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          const selected = ta.value.substring(start, end);
          const url = selected.startsWith("http") ? selected : "https://";
          const linkText = selected.startsWith("http") ? "link" : (selected || "link");
          const replacement = `[${linkText}](${url})`;
          const newValue = ta.value.substring(0, start) + replacement + ta.value.substring(end);
          onInsert(newValue);
          requestAnimationFrame(() => {
            ta.focus();
            if (selected.startsWith("http")) {
              ta.setSelectionRange(start + 1, start + 5); // select "link"
            } else {
              const urlStart = start + linkText.length + 3;
              ta.setSelectionRange(urlStart, urlStart + url.length);
            }
          });
        }}
      >
        <svg className="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </button>

      {/* Song embed button */}
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          className={btn}
          title="Embed song"
          onClick={() => setShowSongPicker(!showSongPicker)}
        >
          <svg className="w-3.5 h-3.5 inline" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </button>

        {showSongPicker && (
          <div className="absolute top-full left-0 mt-1 w-72 max-h-60 overflow-y-auto rounded-xl bg-[#0a0a1a] border border-white/[0.1] shadow-xl z-50">
            {!songs || songs.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-slate-500 text-center">No songs to embed</p>
            ) : (
              songs.map((song) => (
                <button
                  key={song.uuid}
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] transition-colors text-left"
                  onClick={() => {
                    if (!textareaRef.current) return;
                    const ta = textareaRef.current;
                    const pos = ta.selectionStart;
                    const tag = `[[song:${song.uuid}]]`;
                    const newValue = ta.value.substring(0, pos) + tag + ta.value.substring(pos);
                    onInsert(newValue);
                    setShowSongPicker(false);
                    requestAnimationFrame(() => {
                      ta.focus();
                      const newPos = pos + tag.length;
                      ta.setSelectionRange(newPos, newPos);
                    });
                  }}
                >
                  {song.cover_image_url ? (
                    <img src={song.cover_image_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-gradient-to-br from-purple-900/60 to-cyan-900/60 shrink-0" />
                  )}
                  <span className="text-[12px] text-slate-300 truncate">{song.title}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
