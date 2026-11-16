/**
 * Change a user's password from the command line (e.g. replacing the default ones before go-live).
 *   npm run user:password -- <username> <new-password>
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.log("Pemakaian: npm run user:password -- <username> <password-baru>");
    process.exit(1);
  }
  if (password.length < 6) throw new Error("Password minimal 6 karakter.");
  const conn = process.env.DATABASE_URL
    ? await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: process.env.DB_SSL === "true" ? {} : undefined })
    : await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === "true" ? {} : undefined,
      });
  const hash = await bcrypt.hash(password, 12);
  const [res] = await conn.execute("UPDATE users SET password = ? WHERE username = ?", [hash, username]);
  await conn.end();
  if ((res as mysql.ResultSetHeader).affectedRows === 0) throw new Error(`User "${username}" tidak ditemukan.`);
  console.log(`Password "${username}" berhasil diganti.`);
}

main().catch((err) => {
  console.error("Gagal:", err.message);
  process.exit(1);
});
