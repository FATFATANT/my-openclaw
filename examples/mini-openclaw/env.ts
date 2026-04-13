import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const ENV_FILE_NAMES = [".env.local", ".env"];

export function loadMiniOpenClawEnv() {
  const rootDir = process.cwd();

  for (const fileName of ENV_FILE_NAMES) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    dotenv.config({
      path: filePath,
      override: false,
    });
  }
}
