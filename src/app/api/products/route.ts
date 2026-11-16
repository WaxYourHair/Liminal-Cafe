import { json, route } from "@/server/api";
import { createProduct, getProduct, listProducts } from "@/server/repo/catalog";
import { productSchema } from "@/lib/schemas";

export const GET = route("any", async ({ req }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const catParam = url.searchParams.get("categoryId");
  const categoryId = catParam ? Number(catParam) : undefined;
  const activeOnly = url.searchParams.get("activeOnly") === "true";

  const products = await listProducts({
    q,
    categoryId: categoryId && Number.isInteger(categoryId) ? categoryId : undefined,
    activeOnly,
  });
  return json({ products });
});

export const POST = route("any", async ({ req }) => {
  const body = await req.json();
  const data = productSchema.parse(body);
  const id = await createProduct(data);
  const product = await getProduct(id);
  return json({ product }, 201);
});
