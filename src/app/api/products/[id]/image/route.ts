import { json, parseId, route } from "@/server/api";
import { getProduct, setProductImage } from "@/server/repo/catalog";
import { readImageUpload } from "@/server/upload";

export const POST = route<{ id: string }>("any", async ({ req, params }) => {
  const id = parseId(params.id);
  const form = await req.formData();
  const { data, mime } = await readImageUpload(form, "image");
  await setProductImage(id, data, mime);
  const product = await getProduct(id);
  return json({ product });
});

export const DELETE = route<{ id: string }>("any", async ({ params }) => {
  const id = parseId(params.id);
  await setProductImage(id, null, null);
  const product = await getProduct(id);
  return json({ product });
});
