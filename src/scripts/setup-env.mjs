import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../shared/logger.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const envExamplePath = path.join(ROOT, ".env.EXAMPLE");
const envPath = path.join(ROOT, ".env");

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    logger.done(".env file created from .env.EXAMPLE");
    logger.warn("Now you need to fill the .env file with your credentials and settings.");
  } else {
    logger.error(".env.EXAMPLE not found. Could not create .env file.");
  }
} else {
  logger.info(".env already exists, skipping creation.");
}
