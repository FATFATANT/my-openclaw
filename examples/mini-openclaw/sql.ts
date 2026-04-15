import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_SQL_SCHEMA = `
Table customers (
  customer_id INTEGER PRIMARY KEY,
  customer_name TEXT,
  city TEXT,
  segment TEXT
)

Table orders (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER,
  order_date TEXT,
  amount NUMERIC,
  status TEXT
)

Relationships:
- orders.customer_id -> customers.customer_id
`.trim();

function readOptionalFile(filePath?: string): string | null {
  if (!filePath) {
    return null;
  }
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function loadSqlSchemaText(): string {
  const configured = readOptionalFile(process.env.OPENCLAW_MINI_SQL_SCHEMA_PATH);
  return configured?.trim() || DEFAULT_SQL_SCHEMA;
}

export function isSqlQuestion(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("sql") ||
    normalized.includes("query") ||
    normalized.includes("查询") ||
    normalized.includes("select") ||
    normalized.includes("统计")
  );
}

export function inferDemoSql(question: string): string {
  const normalized = question.toLowerCase();
  if (normalized.includes("top") && normalized.includes("customer")) {
    return [
      "SELECT",
      "  c.customer_name,",
      "  SUM(o.amount) AS total_amount",
      "FROM orders o",
      "JOIN customers c ON c.customer_id = o.customer_id",
      "GROUP BY c.customer_id, c.customer_name",
      "ORDER BY total_amount DESC",
      "LIMIT 5;",
    ].join("\n");
  }
  if (normalized.includes("monthly") || normalized.includes("每月")) {
    return [
      "SELECT",
      "  substr(order_date, 1, 7) AS order_month,",
      "  SUM(amount) AS total_amount",
      "FROM orders",
      "GROUP BY substr(order_date, 1, 7)",
      "ORDER BY order_month ASC;",
    ].join("\n");
  }
  return [
    "SELECT",
    "  c.customer_name,",
    "  o.order_date,",
    "  o.amount,",
    "  o.status",
    "FROM orders o",
    "JOIN customers c ON c.customer_id = o.customer_id",
    "ORDER BY o.order_date DESC",
    "LIMIT 10;",
  ].join("\n");
}

export async function runReadOnlySql(sql: string): Promise<string> {
  const databasePath = process.env.OPENCLAW_MINI_SQLITE_DB_PATH?.trim();
  if (!databasePath) {
    return "SQL execution skipped: OPENCLAW_MINI_SQLITE_DB_PATH is not configured.";
  }

  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
    return "Only read-only SELECT / WITH queries are allowed in this mini example.";
  }

  const script = `
import json
import sqlite3
import sys

db_path = sys.argv[1]
sql = sys.argv[2]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
try:
    cur.execute(sql)
    rows = [dict(row) for row in cur.fetchmany(10)]
    print(json.dumps(rows, ensure_ascii=False))
finally:
    cur.close()
    conn.close()
`.trim();

  const { stdout } = await execFileAsync("python3", ["-c", script, databasePath, sql], {
    maxBuffer: 1024 * 1024,
  });
  const trimmed = stdout.trim();
  return trimmed ? `SQL preview rows: ${trimmed}` : "SQL executed successfully with no rows.";
}
