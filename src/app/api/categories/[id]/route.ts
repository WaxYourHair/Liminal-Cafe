import { json, parseId, route } from "@/server/api";
import { deleteCategory, listCategories, updateCategory } from "@/server/repo/catalog";
import { categorySchema } from "@/lib/schemas";

export const PUT = route<{ id: string }>("any", async ({ req, params }) => {
  const id = parseId(params.id);
  const body = await req.json();
  const data = categorySchema.parse(body);
  await updateCategory(id, data);
  const categories = await listCategories();
  return json({ categories });
});

export const DELETE = route<{ id: string }>("any", async ({ params }) => {
  const id = parseId(params.id);
  await deleteCategory(id);
  const categories = await listCategories();
  return json({ categories });
});
