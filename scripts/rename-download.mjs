#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TITLE_MAX_LEN = 50;

/** Expands a leading `~` (the Makefile recipe quotes the value, so the shell won't do it). */
function expandHome(p) {
  const s = String(p ?? "");
  if (s === "~") return os.homedir();
  if (s.startsWith("~/")) return path.join(os.homedir(), s.slice(2));
  return s;
}

/**
 * Builds the download filename from an "<id>_<title>" string.
 * The title is sanitized exactly like download-articles.mjs:
 *   `${id}_${title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50)}.pdf`
 */
export function buildDownloadFilename(name) {
  const raw = String(name ?? "").trim().replace(/\.pdf$/i, "");
  const sep = raw.indexOf("_");
  const id = sep === -1 ? raw : raw.slice(0, sep);
  const title = sep === -1 ? "" : raw.slice(sep + 1);
  const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, TITLE_MAX_LEN);
  return safeTitle ? `${id}_${safeTitle}.pdf` : `${id}.pdf`;
}

function main(argv) {
  const [pdfPath, name] = argv;

  if (!pdfPath || !name) {
    console.error("Uso: node scripts/rename-download.mjs <arquivo.pdf> <id_title>");
    console.error('Ex.: node scripts/rename-download.mjs baixado.pdf "85098064539_VerifyandRevive: Secure Detection and Recovery"');
    process.exit(1);
  }

  const src = path.resolve(expandHome(pdfPath));
  if (!fs.existsSync(src)) {
    console.error(`Arquivo não encontrado: ${src}`);
    process.exit(1);
  }
  if (!/\.pdf$/i.test(src)) {
    console.error(`Não é um PDF: ${src}`);
    process.exit(1);
  }

  const dest = path.join(path.dirname(src), buildDownloadFilename(name));

  if (src === dest) {
    console.log(`Já está nomeado assim: ${path.basename(src)}`);
    return;
  }
  if (fs.existsSync(dest)) {
    console.error(`Destino já existe, nada foi alterado: ${dest}`);
    process.exit(1);
  }

  fs.renameSync(src, dest);
  console.log(`✓ ${path.basename(src)} → ${path.basename(dest)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
