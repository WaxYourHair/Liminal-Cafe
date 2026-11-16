import { z } from "zod";

/** Validation schemas shared by the browser and the server. Server-side validation is authoritative. */

const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} maksimal ${max} karakter.`)
    .transform((v) => (v.length ? v : null))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Nama kategori wajib diisi.").max(100, "Nama kategori maksimal 100 karakter."),
  description: text(255, "Deskripsi"),
});

export const productSchema = z.object({
  categoryId: z.coerce.number().int("Kategori tidak valid.").positive("Pilih kategori."),
  name: z.string().trim().min(1, "Nama produk wajib diisi.").max(120, "Nama produk maksimal 120 karakter."),
  description: text(500, "Deskripsi"),
  price: z.coerce
    .number({ message: "Harga harus berupa angka." })
    .int("Harga harus bilangan bulat.")
    .min(0, "Harga tidak boleh negatif.")
    .max(100_000_000, "Harga terlalu besar."),
  isActive: z.coerce.boolean().default(true),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username wajib diisi.").max(50),
  password: z.string().min(1, "Password wajib diisi.").max(200),
});

export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Password lama wajib diisi."),
    newPassword: z.string().min(6, "Password baru minimal 6 karakter.").max(200),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "Password baru harus berbeda dari password lama.",
    path: ["newPassword"],
  });

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Waktu tidak valid.");

export const orderItemSchema = z.object({
  productId: z.number().int().positive().nullable(),
  productName: z.string().trim().min(1).max(120),
  price: z.number().int().min(0, "Harga tidak boleh negatif."),
  quantity: z.number().int().min(1, "Jumlah minimal 1.").max(999, "Jumlah maksimal 999."),
  notes: text(255, "Catatan item"),
});

export const createOrderOpSchema = z.object({
  type: z.literal("create"),
  clientUuid: z.string().uuid(),
  orderCode: z.string().regex(/^[0-9]{6}-[A-Z0-9]{2}-[0-9]{3,4}$/, "Kode order tidak valid."),
  userId: z.number().int().positive(),
  customerName: text(100, "Nama pelanggan"),
  notes: text(500, "Catatan"),
  items: z.array(orderItemSchema).min(1, "Keranjang masih kosong.").max(100),
  payment: z.object({
    method: z.enum(["cash", "qris"]),
    paidAmount: z.number().int().min(0),
    verified: z.literal(true, { message: "Pembayaran belum diverifikasi kasir." }),
  }),
  approvedAt: isoDate,
});

export const completeOrderOpSchema = z.object({
  type: z.literal("complete"),
  clientUuid: z.string().uuid(),
  completedAt: isoDate,
});

export const pushOpSchema = z.discriminatedUnion("type", [createOrderOpSchema, completeOrderOpSchema]);
export const pushBodySchema = z.object({ ops: z.array(z.unknown()).min(1).max(50) });

export type CreateOrderOp = z.infer<typeof createOrderOpSchema>;
export type CompleteOrderOp = z.infer<typeof completeOrderOpSchema>;
export type PushOp = z.infer<typeof pushOpSchema>;

export interface PushResult {
  clientUuid: string;
  type: PushOp["type"];
  ok: boolean;
  /** true when the server already had this operation (safe retry). */
  duplicate?: boolean;
  error?: string;
  orderCode?: string;
}

export interface OrderView {
  id: number | null;
  clientUuid: string;
  orderCode: string;
  customerName: string | null;
  notes: string | null;
  status: "pending" | "selesai";
  total: number;
  approvedAt: string;
  completedAt: string | null;
  cashierName: string;
  payment: {
    method: "cash" | "qris";
    status: "pending" | "verified" | "rejected";
    paidAmount: number;
    changeAmount: number;
    verifiedByName: string | null;
    paidAt: string | null;
  };
  items: { productName: string; price: number; quantity: number; subtotal: number; notes: string | null }[];
  /** Set by the tablet when this order or its completion is still waiting to reach the server. */
  localOnly?: boolean;
}

export function cartTotal(items: { price: number; quantity: number }[]): number {
  return items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}
