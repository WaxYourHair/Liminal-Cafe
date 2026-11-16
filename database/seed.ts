/**
 * Creates the schema (database/campervan_cafe.sql) and seeds default accounts and the menu.
 * Safe to run more than once: existing users, categories and products are left untouched.
 *
 *   npm run db:setup     schema + seed
 *   npm run db:seed      seed only
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const MENU: { category: string; description: string; items: [string, number, string?][] }[] = [
  {
    category: "Signature",
    description: "Racikan khas Liminal",
    items: [
      ["El Tugra", 18000, "A refreshing blend of espresso, peach, raspberry & sparkling soda."],
      ["Dirty Latte", 20000, "Bold espresso meets silky milk for a rich, creamy finish."],
      ["Sparkling Fiesta Bubblegum", 15000, "A vibrant bubblegum soda with a fun, refreshing fizz."],
    ],
  },
  {
    category: "Espresso-Based",
    description: "Iced",
    items: [
      ["Iced Palm Sugar Latte", 15000],
      ["Iced Butterscotch Latte", 15000],
      ["Iced Salted Caramel Latte", 15000],
      ["Iced Americano", 15000],
      ["Iced Lemon Americano", 15000],
      ["Iced Coconut Americano", 15000],
      ["Iced Cranberry Americano", 15000],
    ],
  },
  {
    category: "Manual Brew",
    description: "Seduh manual",
    items: [
      ["V60", 15000],
      ["Japanese Iced Coffee", 15000],
      ["Kopi Tubruk", 8000],
    ],
  },
  {
    category: "Non-Coffee Iced",
    description: "Non-coffee dingin",
    items: [
      ["Iced Chocolate", 15000],
      ["Iced Matcha", 15000],
      ["Iced Lychee Tea", 15000],
      ["Iced Lychee Yakult", 15000],
    ],
  },
  {
    category: "Non-Coffee Hot",
    description: "Non-coffee panas",
    items: [
      ["Hot Chocolate", 15000],
      ["Hot Tea", 8000],
      ["Hot Lemon Tea", 10000],
      ["Hot Lychee Tea", 15000],
    ],
  },
  {
    category: "Refreshers",
    description: "Squash segar",
    items: [
      ["Mango Squash", 15000],
      ["Peach Squash", 15000],
      ["Lychee Squash", 15000],
      ["Lemon Squash", 15000],
      ["Orange Squash", 15000],
    ],
  },
];

function connConfig(withDb: boolean): mysql.ConnectionOptions {
  const ssl = process.env.DB_SSL === "true" ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined;
  if (process.env.DATABASE_URL) return { uri: process.env.DATABASE_URL, multipleStatements: true, ssl };
  return {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: withDb ? (process.env.DB_NAME ?? "campervan_cafe") : undefined,
    multipleStatements: true,
    timezone: "Z",
    ssl,
  };
}

async function applySchema() {
  const dbName = process.env.DB_NAME ?? "campervan_cafe";
  let sql = fs.readFileSync(path.join(__dirname, "campervan_cafe.sql"), "utf8");
  // Respect a custom DB_NAME (and hosted databases where the name is fixed).
  sql = sql.replace(/campervan_cafe(?=[\s;])/g, dbName);
  const conn = await mysql.createConnection(connConfig(false));
  try {
    if (process.env.DATABASE_URL) {
      // Hosted URL already points at a database; skip CREATE DATABASE / USE.
      sql = sql.replace(/CREATE DATABASE[\s\S]*?;\s*USE [^;]+;/, "");
    }
    await conn.query(sql);
    console.log(`Skema database "${dbName}" siap.`);
  } finally {
    await conn.end();
  }
}

async function seed() {
  const conn = await mysql.createConnection(connConfig(true));
  try {
    const accounts = [
      {
        name: process.env.SEED_ADMIN_NAME ?? "Admin",
        username: process.env.SEED_ADMIN_USERNAME ?? "admin",
        password: process.env.SEED_ADMIN_PASSWORD,
        role: "admin",
      },
      {
        name: process.env.SEED_KASIR_NAME ?? "Kasir",
        username: process.env.SEED_KASIR_USERNAME ?? "kasir",
        password: process.env.SEED_KASIR_PASSWORD,
        role: "kasir",
      },
    ];
    for (const acc of accounts) {
      if (!acc.password || acc.password.length < 6) {
        throw new Error(`Password untuk "${acc.username}" belum diisi di .env (minimal 6 karakter).`);
      }
      const [rows] = await conn.execute("SELECT id FROM users WHERE username = ?", [acc.username]);
      if ((rows as unknown[]).length) {
        console.log(`Akun "${acc.username}" sudah ada, dilewati.`);
        continue;
      }
      const hash = await bcrypt.hash(acc.password, 12);
      await conn.execute("INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)", [
        acc.name,
        acc.username,
        hash,
        acc.role,
      ]);
      console.log(`Akun ${acc.role} "${acc.username}" dibuat.`);
    }

    let order = 0;
    for (const group of MENU) {
      order += 1;
      await conn.execute(
        "INSERT INTO categories (name, description, sort_order) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id",
        [group.category, group.description, order],
      );
      const [cat] = await conn.execute("SELECT id FROM categories WHERE name = ?", [group.category]);
      const categoryId = (cat as { id: number }[])[0].id;
      for (const [name, price, description] of group.items) {
        const slug = toSlug(name);
        const imgFile = path.join(__dirname, "..", "public", "menu", `${slug}.jpg`);
        const hasImg = fs.existsSync(imgFile);
        const imgPath = hasImg ? `/menu/${slug}.jpg` : null;
        const imgData = hasImg ? fs.readFileSync(imgFile) : null;
        const imgMime = hasImg ? "image/jpeg" : null;
        await conn.execute(
          `INSERT INTO products (category_id, name, description, price, image, image_data, image_mime)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             image = COALESCE(VALUES(image), products.image),
             image_data = COALESCE(VALUES(image_data), products.image_data),
             image_mime = COALESCE(VALUES(image_mime), products.image_mime)`,
          [categoryId, name, description ?? null, price, imgPath, imgData, imgMime],
        );
      }
    }
    await conn.execute(
      "INSERT INTO settings (setting_key, setting_value) VALUES ('cafe_name', 'Liminal Campervan Bar') ON DUPLICATE KEY UPDATE setting_key = setting_key",
    );
    const [count] = await conn.execute("SELECT COUNT(*) AS n FROM products");
    console.log(`Menu siap: ${(count as { n: number }[])[0].n} produk.`);
  } finally {
    await conn.end();
  }
}

async function main() {
  const mode = process.argv[2] ?? "all";
  if (mode === "all" || mode === "schema") await applySchema();
  if (mode === "all" || mode === "seed") await seed();
}

main().catch((err) => {
  console.error("Gagal:", err.message);
  process.exit(1);
});
