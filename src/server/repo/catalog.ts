import "server-only";
import { exec, query, queryOne } from "../db";
import { HttpError } from "../api";

export interface CategoryRow {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  product_count: number;
}

export interface ProductRow {
  id: number;
  category_id: number;
  category_name: string;
  name: string;
  description: string | null;
  price: number;
  image: string | null;
  is_active: number;
  updated_at: Date;
  used_count: number;
}

export async function listCategories(): Promise<CategoryRow[]> {
  return query<CategoryRow>(
    `SELECT c.id, c.name, c.description, c.sort_order, COUNT(p.id) AS product_count
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id ORDER BY c.sort_order, c.name`,
  );
}

export async function createCategory(input: { name: string; description: string | null }) {
  const next = await queryOne<{ n: number }>("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM categories");
  const res = await exec("INSERT INTO categories (name, description, sort_order) VALUES (?, ?, ?)", [
    input.name,
    input.description,
    next?.n ?? 1,
  ]);
  return res.insertId;
}

export async function updateCategory(id: number, input: { name: string; description: string | null }) {
  const res = await exec("UPDATE categories SET name = ?, description = ? WHERE id = ?", [
    input.name,
    input.description,
    id,
  ]);
  if (res.affectedRows === 0) throw new HttpError(404, "Kategori tidak ditemukan.");
}

/** A category can only be deleted when no product (active or not) still points at it. */
export async function deleteCategory(id: number) {
  const used = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE category_id = ?", [id]);
  if (used && used.n > 0) {
    throw new HttpError(409, `Kategori masih dipakai ${used.n} produk. Pindahkan atau hapus produknya dulu.`);
  }
  const res = await exec("DELETE FROM categories WHERE id = ?", [id]);
  if (res.affectedRows === 0) throw new HttpError(404, "Kategori tidak ditemukan.");
}

const PRODUCT_SELECT = `
  SELECT p.id, p.category_id, c.name AS category_name, p.name, p.description, p.price, p.image,
         p.is_active, p.updated_at,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.product_id = p.id) AS used_count
    FROM products p JOIN categories c ON c.id = p.category_id`;

export async function listProducts(filter: { q?: string; categoryId?: number; activeOnly?: boolean } = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.q) {
    where.push("p.name LIKE ?");
    params.push(`%${filter.q}%`);
  }
  if (filter.categoryId) {
    where.push("p.category_id = ?");
    params.push(filter.categoryId);
  }
  if (filter.activeOnly) where.push("p.is_active = 1");
  const sql = `${PRODUCT_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.sort_order, p.name`;
  return query<ProductRow>(sql, params);
}

export async function getProduct(id: number) {
  return queryOne<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = ?`, [id]);
}

interface ProductInput {
  categoryId: number;
  name: string;
  description: string | null;
  price: number;
  isActive: boolean;
}

async function assertCategory(id: number) {
  const cat = await queryOne("SELECT id FROM categories WHERE id = ?", [id]);
  if (!cat) throw new HttpError(422, "Kategori tidak ditemukan.");
}

export async function createProduct(input: ProductInput) {
  await assertCategory(input.categoryId);
  const res = await exec(
    "INSERT INTO products (category_id, name, description, price, is_active) VALUES (?, ?, ?, ?, ?)",
    [input.categoryId, input.name, input.description, input.price, input.isActive ? 1 : 0],
  );
  return res.insertId;
}

export async function updateProduct(id: number, input: ProductInput) {
  await assertCategory(input.categoryId);
  const res = await exec(
    "UPDATE products SET category_id = ?, name = ?, description = ?, price = ?, is_active = ? WHERE id = ?",
    [input.categoryId, input.name, input.description, input.price, input.isActive ? 1 : 0, id],
  );
  if (res.affectedRows === 0) throw new HttpError(404, "Produk tidak ditemukan.");
}

export async function setProductActive(id: number, active: boolean) {
  const res = await exec("UPDATE products SET is_active = ? WHERE id = ?", [active ? 1 : 0, id]);
  if (res.affectedRows === 0) throw new HttpError(404, "Produk tidak ditemukan.");
}

/**
 * Products that already appear in an order are never deleted, only deactivated,
 * so the transaction history keeps its link to the product.
 */
export async function deleteProduct(id: number): Promise<"deleted" | "deactivated"> {
  const product = await getProduct(id);
  if (!product) throw new HttpError(404, "Produk tidak ditemukan.");
  if (product.used_count > 0) {
    await setProductActive(id, false);
    return "deactivated";
  }
  await exec("DELETE FROM products WHERE id = ?", [id]);
  return "deleted";
}

export async function setProductImage(id: number, data: Buffer | null, mime: string | null) {
  const res = await exec(
    "UPDATE products SET image_data = ?, image_mime = ?, image = ? WHERE id = ?",
    [data, mime, data ? `/api/images/product/${id}` : null, id],
  );
  if (res.affectedRows === 0) throw new HttpError(404, "Produk tidak ditemukan.");
}

export async function getProductImage(id: number) {
  return queryOne<{ image_data: Buffer | null; image_mime: string | null; updated_at: Date }>(
    "SELECT image_data, image_mime, updated_at FROM products WHERE id = ?",
    [id],
  );
}
