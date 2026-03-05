import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-black/20 py-6 pb-28 md:pb-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
        <div className="flex items-center gap-4">
          <Link href="/about" className="hover:text-slate-300 transition-colors">
            About
          </Link>
          <Link href="/rules" className="hover:text-slate-300 transition-colors">
            Rules
          </Link>
        </div>
        <p>
          Created by{" "}
          <a
            href="https://fastnear.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-white transition-colors"
          >
            FastNEAR
          </a>
          , powered by{" "}
          <a
            href="https://near.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-white transition-colors"
          >
            NEAR Blockchain
          </a>
        </p>
      </div>
    </footer>
  );
}
