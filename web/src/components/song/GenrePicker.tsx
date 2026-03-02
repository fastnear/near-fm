"use client";

import { useEffect, useState } from "react";
import type { Genre } from "@/types";
import { getGenres } from "@/lib/api";

interface Props {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  maxGenres?: number;
}

export function GenrePicker({ selectedIds, onChange, maxGenres = 3 }: Props) {
  const [genres, setGenres] = useState<Genre[]>([]);

  useEffect(() => {
    getGenres().then(setGenres).catch(console.error);
  }, []);

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((g) => g !== id));
    } else if (selectedIds.length < maxGenres) {
      onChange([...selectedIds, id]);
    }
  };

  if (genres.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {genres.map((g) => {
          const selected = selectedIds.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                selected
                  ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
                  : "bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-white/[0.15] hover:text-slate-300"
              } ${
                !selected && selectedIds.length >= maxGenres
                  ? "opacity-40 cursor-not-allowed"
                  : "cursor-pointer"
              }`}
              disabled={!selected && selectedIds.length >= maxGenres}
            >
              {g.name}
            </button>
          );
        })}
      </div>
      {selectedIds.length >= maxGenres && (
        <p className="text-xs text-slate-500 mt-1.5">
          Maximum {maxGenres} genres selected
        </p>
      )}
    </div>
  );
}
