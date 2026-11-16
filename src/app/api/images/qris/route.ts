import { HttpError, route } from "@/server/api";
import { getBinarySetting } from "@/server/repo/settings";
import { imageResponse } from "@/server/upload";

export const GET = route("any", async () => {
  const row = await getBinarySetting("qris_image");
  if (!row || !row.binary_value || !row.mime) {
    throw new HttpError(404, "Gambar QRIS belum diunggah.");
  }
  return imageResponse(row.binary_value, row.mime, row.updated_at);
});
