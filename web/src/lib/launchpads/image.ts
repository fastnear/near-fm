/**
 * Squash a cover image into a small square `data:` URI that fits a launchpad's
 * on-chain icon limit. Tries sizes from large to small and webp/jpeg qualities
 * from high to low; returns the first under `target`, else the smallest
 * under `hardCap`.
 */
export async function compressIcon(
  source: Blob | string,
  opts: { target?: number; hardCap: number; sizes?: number[] } ,
): Promise<{ dataUri: string; bytes: number }> {
  const sizes = opts.sizes ?? [192, 160, 128, 96];
  const target = opts.target ?? 8192;
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
  const bitmap = await createImageBitmap(blob);
  let best: { dataUri: string; bytes: number } | null = null;

  for (const size of sizes) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    // Cover-fit the square.
    const s = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - s) / 2;
    const sy = (bitmap.height - s) / 2;
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size);

    const candidates: { dataUri: string; bytes: number }[] = [];
    for (const type of ["image/webp", "image/jpeg"]) {
      for (const q of [0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.45, 0.35]) {
        const uri = canvas.toDataURL(type, q);
        if (!uri.startsWith(`data:${type}`)) break; // format unsupported by this browser
        candidates.push({ dataUri: uri, bytes: new TextEncoder().encode(uri).length });
      }
    }
    const fit = candidates.find((c) => c.bytes <= target);
    if (fit) return fit;
    const smallest = candidates.reduce((a, b) => (b.bytes < a.bytes ? b : a));
    if (!best || smallest.bytes < best.bytes) best = smallest;
    if (smallest.bytes <= opts.hardCap) return smallest;
  }
  throw new Error(`Image is ${Math.round((best?.bytes ?? 0) / 1024)} KB after compression; the limit is ${Math.round(opts.hardCap / 1024)} KB.`);
}
