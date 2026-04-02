/**
 * FastFS upload utilities for near.fm.
 *
 * Based on https://github.com/fastnear/fastdata-drag-and-drop
 *
 * FastFS stores files as NEAR transaction arguments. The transaction
 * calls `__fastdata_fastfs` with gas=1 (intentionally fails execution),
 * but the data is still recorded on-chain and indexed by FastFS.
 *
 * Files <= 1MB use SimpleFastfs, files > 1MB are chunked with PartialFastfs.
 * URL format: https://{accountId}.fastfs.io/{contractId}/{relativePath}
 */

import { serialize as borshSerialize, type Schema } from "borsh";

const CHUNK_SIZE = 1 << 20; // 1 MB
const FASTFS_CONTRACT =
  process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.testnet";

// ── Borsh Schema (matches reference: fastnear/fastdata-drag-and-drop) ──

const FastfsFileContent = {
  struct: {
    mimeType: "string",
    content: { array: { type: "u8" } },
  },
} as Schema;

const SimpleFastfs = {
  struct: {
    relativePath: "string",
    content: { option: FastfsFileContent },
  },
} as Schema;

const PartialFastfs = {
  struct: {
    relativePath: "string",
    offset: "u32",
    fullSize: "u32",
    mimeType: "string",
    contentChunk: { array: { type: "u8" } },
    nonce: "u32",
  },
} as Schema;

const FastfsDataSchema = {
  enum: [
    { struct: { simple: SimpleFastfs } },
    { struct: { partial: PartialFastfs } },
  ],
} as Schema;

function encodeFfs(ffs: unknown): Uint8Array {
  return borshSerialize(FastfsDataSchema, ffs);
}

// ── Public API ──

export interface FastFSUploadPart {
  encoded: Uint8Array;
  offset: number;
  totalParts: number;
  partIndex: number;
}

/**
 * Prepare FastFS upload parts for a file.
 * Returns an array of encoded Borsh payloads ready to be sent as transactions.
 */
export function prepareFastFSUpload(
  relativePath: string,
  mimeType: string,
  content: Uint8Array
): FastFSUploadPart[] {
  if (content.length <= CHUNK_SIZE) {
    return [
      {
        encoded: encodeFfs({
          simple: {
            relativePath,
            content: {
              mimeType,
              content,
            },
          },
        }),
        offset: 0,
        totalParts: 1,
        partIndex: 0,
      },
    ];
  }

  const nonce = Math.floor(Date.now() / 1000) - 1769376240;
  const parts: FastFSUploadPart[] = [];
  const totalParts = Math.ceil(content.length / CHUNK_SIZE);

  for (let i = 0; i < totalParts; i++) {
    const offset = i * CHUNK_SIZE;
    const chunk = content.slice(offset, Math.min(offset + CHUNK_SIZE, content.length));
    parts.push({
      encoded: encodeFfs({
        partial: {
          relativePath,
          offset,
          fullSize: content.length,
          mimeType,
          contentChunk: chunk,
          nonce,
        },
      }),
      offset,
      totalParts,
      partIndex: i,
    });
  }

  return parts;
}

/**
 * Upload a file to FastFS by sending transactions via wallet.
 * Each part is sent as a separate transaction (sequentially).
 *
 * @param callFunction - Wallet's callFunction
 * @param parts - Prepared upload parts from prepareFastFSUpload
 * @param onProgress - Optional progress callback (partIndex, totalParts)
 */
export async function uploadToFastFS(
  callFunction: (params: {
    contractId: string;
    method: string;
    args: Uint8Array;
    gas: string;
  }) => Promise<string>,
  parts: FastFSUploadPart[],
  onProgress?: (partIndex: number, totalParts: number) => void
): Promise<string[]> {
  const txHashes: string[] = [];

  for (const part of parts) {
    // gas=1 transactions intentionally fail on-chain but data is still recorded.
    // Catch errors per chunk (like the reference implementation) to avoid
    // aborting the entire upload when a chunk's wallet popup is dismissed.
    const txHash = await callFunction({
      contractId: FASTFS_CONTRACT,
      method: "__fastdata_fastfs",
      args: part.encoded,
      gas: "1",
    }).catch(() => "");
    txHashes.push(txHash);
    onProgress?.(part.partIndex + 1, part.totalParts);
  }

  return txHashes;
}

/**
 * Compute SHA-256 hash of file content.
 */
export async function computeFileHash(content: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content as unknown as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Upload a file to FastFS via the server-side relayer.
 * For users without a NEAR wallet (Solana, Google).
 */
export async function uploadToFastFSViaRelayer(
  file: File,
): Promise<{ url: string; hash: string; relativePath: string }> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
  const formData = new FormData();
  formData.append("file", file);

  const resp = await fetch(`${API_URL}/api/fastfs/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `Upload failed: ${resp.status}`);
  }

  const data = await resp.json();
  return {
    url: data.url,
    hash: data.hash,
    relativePath: data.relative_path,
  };
}

/**
 * Construct the FastFS URL for a file.
 * Uses main.fastfs.io path-based format to avoid SSL/DNS issues with subdomains.
 */
export function getFastFSUrl(
  accountId: string,
  relativePath: string
): string {
  return `https://main.fastfs.io/${accountId}/${FASTFS_CONTRACT}/${relativePath}`;
}

/**
 * Get the relative path for a file based on its hash and extension.
 */
export function getRelativePath(hash: string, mimeType: string): string {
  const ext = mimeType.split("/")[1] || "bin";
  const extMap: Record<string, string> = {
    mpeg: "mp3",
    "x-wav": "wav",
    wav: "wav",
    ogg: "ogg",
    mp4: "mp4",
    webm: "webm",
    jpeg: "jpg",
    png: "png",
    gif: "gif",
    webp: "webp",
    svg: "svg",
  };
  return `${hash}.${extMap[ext] || ext}`;
}
