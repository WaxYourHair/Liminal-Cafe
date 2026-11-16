import "server-only";
import { HttpError } from "./api";

const MAX_BYTES = 2 * 1024 * 1024;

/** Detects the real image type from magic bytes; the browser-sent content type is not trusted. */
function sniff(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export async function readImageUpload(form: FormData, field = "image"): Promise<{ data: Buffer; mime: string }> {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) throw new HttpError(422, "Pilih file gambar terlebih dahulu.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Ukuran gambar maksimal 2 MB.");
  const data = Buffer.from(await file.arrayBuffer());
  const mime = sniff(data);
  if (!mime) throw new HttpError(415, "Format gambar harus JPG, PNG, atau WEBP.");
  return { data, mime };
}

export function imageResponse(data: Buffer, mime: string, updatedAt: Date) {
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=86400",
      ETag: `"${updatedAt.getTime()}"`,
    },
  });
}
