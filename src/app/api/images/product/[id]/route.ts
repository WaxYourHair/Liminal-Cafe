import { HttpError, parseId, route } from "@/server/api";
import { getProductImage } from "@/server/repo/catalog";
import { imageResponse } from "@/server/upload";

export const GET = route<{ id: string }>("any", async ({ params }) => {
  const id = parseId(params.id);
  const row = await getProductImage(id);
  if (!row || !row.image_data || !row.image_mime) {
    throw new HttpError(404, "Gambar tidak ditemukan.");
  }
  return imageResponse(row.image_data, row.image_mime, row.updated_at);
});
