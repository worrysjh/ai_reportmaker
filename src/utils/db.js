import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const pool = new Pool();

export async function initDb() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
}

export async function query(q, params) {
  const res = await pool.query(q, params);
  return res.rows;
}
