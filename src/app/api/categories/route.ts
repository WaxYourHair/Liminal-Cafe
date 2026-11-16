import { json, route } from "@/server/api";
import { createCategory, listCategories } from "@/server/repo/catalog";
import { categorySchema } from "@/lib/schemas";

export const GET = route("any", async () => {
  const categories = await listCategories();
  return json({ categories });
});

export const POST = route("any", async ({ req }) => {
  const body = await req.json();
  const data = categorySchema.parse(body);
  const id = await createCategory(data);
  const categories = await listCategories();
  return json({ id, categories }, 201);
});
