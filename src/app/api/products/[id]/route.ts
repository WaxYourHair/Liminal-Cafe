import { z } from "zod";
import { json, parseId, route } from "@/server/api";
import { deleteProduct, getProduct, setProductActive, updateProduct } from "@/server/repo/catalog";
import { productSchema } from "@/lib/schemas";

export const PUT = route<{ id: string }>("any", async ({ req, params }) => {
  const id = parseId(params.id);
  const body = await req.json();
  const data = productSchema.parse(body);
  await updateProduct(id, data);
  const product = await getProduct(id);
  return json({ product });
});

export const PATCH = route<{ id: string }>("any", async ({ req, params }) => {
  const id = parseId(params.id);
  const body = await req.json();
  const { isActive } = z.object({ isActive: z.boolean() }).parse(body);
  await setProductActive(id, isActive);
  const product = await getProduct(id);
  return json({ product });
});

export const DELETE = route<{ id: string }>("any", async ({ params }) => {
  const id = parseId(params.id);
  const outcome = await deleteProduct(id);
  return json({ outcome });
});
