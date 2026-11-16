import "server-only";
import bcrypt from "bcryptjs";
import type { Pool } from "mysql2/promise";

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'kasir') NOT NULL DEFAULT 'kasir',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_categories_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS products (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_id INT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    price INT UNSIGNED NOT NULL,
    image VARCHAR(255) NULL,
    image_data MEDIUMBLOB NULL,
    image_mime VARCHAR(30) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_products_name (name),
    KEY idx_products_category (category_id),
    KEY idx_products_active (is_active),
    CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_uuid CHAR(36) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    order_code VARCHAR(30) NOT NULL,
    customer_name VARCHAR(100) NULL,
    notes VARCHAR(500) NULL,
    status ENUM('pending', 'selesai') NOT NULL DEFAULT 'pending',
    total INT UNSIGNED NOT NULL,
    approved_at DATETIME NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_orders_code (order_code),
    UNIQUE KEY uq_orders_client_uuid (client_uuid),
    KEY idx_orders_status (status, approved_at),
    KEY idx_orders_approved (approved_at),
    KEY idx_orders_completed (completed_at),
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NULL,
    product_name VARCHAR(120) NOT NULL,
    price INT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    subtotal INT UNSIGNED NOT NULL,
    notes VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_order_items_order (order_id),
    KEY idx_order_items_product (product_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products (id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS payments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id INT UNSIGNED NOT NULL,
    payment_method ENUM('cash', 'qris') NOT NULL,
    payment_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
    paid_amount INT UNSIGNED NOT NULL DEFAULT 0,
    change_amount INT UNSIGNED NOT NULL DEFAULT 0,
    verified_by INT UNSIGNED NULL,
    paid_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_payments_order (order_id),
    KEY idx_payments_status (payment_status, payment_method),
    CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders (id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_payments_verified_by FOREIGN KEY (verified_by) REFERENCES users (id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sync_queue (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id INT UNSIGNED NULL,
    event_key VARCHAR(120) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload JSON NOT NULL,
    sync_status ENUM('pending', 'synced', 'failed') NOT NULL DEFAULT 'pending',
    retry_count INT UNSIGNED NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    next_retry_at DATETIME NULL,
    locked_until DATETIME NULL,
    synced_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sync_event_key (event_key),
    KEY idx_sync_due (sync_status, next_retry_at),
    KEY idx_sync_order (order_id),
    CONSTRAINT fk_sync_order FOREIGN KEY (order_id) REFERENCES orders (id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(60) NOT NULL,
    setting_value TEXT NULL,
    binary_value MEDIUMBLOB NULL,
    mime VARCHAR(30) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const DEFAULT_MENU: { category: string; description: string; items: [string, number, string?][] }[] = [
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

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function bootstrapDatabaseIfEmpty(pool: Pool): Promise<void> {
  for (const ddl of DDL_STATEMENTS) {
    await pool.query(ddl);
  }

  const accounts = [
    {
      name: process.env.SEED_ADMIN_NAME ?? "Admin",
      username: process.env.SEED_ADMIN_USERNAME ?? "admin",
      password: process.env.SEED_ADMIN_PASSWORD ?? "admin123",
      role: "admin",
    },
    {
      name: process.env.SEED_KASIR_NAME ?? "Kasir",
      username: process.env.SEED_KASIR_USERNAME ?? "kasir",
      password: process.env.SEED_KASIR_PASSWORD ?? "kasir123",
      role: "kasir",
    },
  ];

  for (const acc of accounts) {
    const [existing] = await pool.execute("SELECT id FROM users WHERE username = ?", [acc.username]);
    if ((existing as unknown[]).length === 0) {
      const hash = await bcrypt.hash(acc.password, 12);
      await pool.execute("INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)", [
        acc.name,
        acc.username,
        hash,
        acc.role,
      ]);
    }
  }

  let sortOrder = 0;
  for (const group of DEFAULT_MENU) {
    sortOrder += 1;
    await pool.execute(
      "INSERT INTO categories (name, description, sort_order) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id",
      [group.category, group.description, sortOrder],
    );
    const [catRows] = await pool.execute("SELECT id FROM categories WHERE name = ?", [group.category]);
    const categoryId = (catRows as { id: number }[])[0].id;
    for (const [name, price, description] of group.items) {
      const slug = toSlug(name);
      await pool.execute(
        `INSERT INTO products (category_id, name, description, price, image)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE image = COALESCE(products.image, VALUES(image))`,
        [categoryId, name, description ?? null, price, `/menu/${slug}.jpg`],
      );
    }
  }

  await pool.execute(
    "INSERT INTO settings (setting_key, setting_value) VALUES ('cafe_name', 'Liminal Campervan Bar') ON DUPLICATE KEY UPDATE setting_key = setting_key",
  );
}
