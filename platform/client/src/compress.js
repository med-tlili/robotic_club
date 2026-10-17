// ============================================================
//  compress.js — keep uploads small enough for any host
//
//  The club can be self-hosted (big LAN uploads fine) or on Vercel,
//  where request bodies are capped at 4.5 MB. Images bigger than
//  ~3.5 MB are re-encoded in the browser (max 2048 px, WebP) before
//  they are sent, so phone photos always go through. Videos and other
//  files are left untouched.
// ============================================================
const LIMIT = 3.5 * 1024 * 1024;

export async function shrinkImage(file) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/') || file.size <= LIMIT) {
    return file; // not an image, or small enough already
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.82));
    if (!blob || blob.size >= file.size) return file; // no gain — keep the original
    const base = String(file.name || 'photo').replace(/\.\w+$/, '');
    return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: Date.now() });
  } catch {
    return file; // unreadable image — the server will report it
  }
}
