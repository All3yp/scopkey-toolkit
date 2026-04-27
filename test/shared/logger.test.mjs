import test from "node:test";
import assert from "node:assert/strict";

import { logger, log } from "../../src/shared/logger.mjs";

function captureLogs(fn) {
  const originalLog = console.log;
  const entries = [];
  console.log = (...args) => entries.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
  return entries;
}

test("logger: divider, header and step emit expected messages", () => {
  const lines = captureLogs(() => {
    logger.divider();
    logger.header("Section");
    logger.step("next action");
  });

  assert.ok(lines.some(line => line.includes("▶ Section")));
  assert.ok(lines.some(line => line.includes("→ next action")));
  assert.ok(lines.some(line => line.includes("─")));
});

test("logger: article prints index/title/url", () => {
  const lines = captureLogs(() => {
    logger.article(3, 10, "A title", "https://example.org/a");
  });

  assert.ok(lines.some(line => line.includes("[3/10]")));
  assert.ok(lines.some(line => line.includes("A title")));
  assert.ok(lines.some(line => line.includes("https://example.org/a")));
});

test("logger: success prints default and source-specific labels with keyword list", () => {
  const fromScopus = captureLogs(() => {
    logger.success(["k1", "k2"], "scopus");
  });
  assert.ok(fromScopus.some(line => line.includes("2 keywords do Scopus")));
  assert.ok(fromScopus.some(line => line.includes("k1")));

  const translated = captureLogs(() => {
    logger.success(["k"], "translated");
  });
  assert.ok(translated.some(line => line.includes("1 keywords traduzidas")));

  const dedup = captureLogs(() => {
    logger.success(["k"], "deduplicated");
  });
  assert.ok(dedup.some(line => line.includes("1 keywords deduplicadas")));

  const fallback = captureLogs(() => {
    logger.success(["k"], "unknown-source");
  });
  assert.ok(fallback.some(line => line.includes("1 keywords")));
});

test("logger: empty handles known sources and fallback", () => {
  const noSection = captureLogs(() => {
    logger.empty("no-section");
  });
  assert.ok(noSection.some(line => line.includes("Artigo sem seção de keywords")));

  const emptySection = captureLogs(() => {
    logger.empty("empty-section");
  });
  assert.ok(emptySection.some(line => line.includes("Seção de keywords vazia")));

  const fallback = captureLogs(() => {
    logger.empty("other");
  });
  assert.ok(fallback.some(line => line.includes("Nenhuma keyword encontrada")));
});

test("logger: error/warn/info/done/ok emit status markers", () => {
  const lines = captureLogs(() => {
    logger.error("err");
    logger.warn("warn");
    logger.info("info");
    logger.done("done");
    logger.ok("ok");
  });

  assert.ok(lines.some(line => line.includes("✗ err")));
  assert.ok(lines.some(line => line.includes("⚠ warn")));
  assert.ok(lines.some(line => line.includes("ℹ info")));
  assert.ok(lines.some(line => line.includes("✓ done")));
  assert.ok(lines.some(line => line.includes("✓") && line.includes("ok")));
});

test("logger: summary branch with and without failures", () => {
  const withFailures = captureLogs(() => {
    logger.summary(12, 3, "artifacts/output/extract/results/results.jsonl");
  });
  assert.ok(withFailures.some(line => line.includes("Concluído")));
  assert.ok(withFailures.some(line => line.includes("✓ Sucesso:") && line.includes("12")));
  assert.ok(withFailures.some(line => line.includes("✗ Falhas:") && line.includes("3")));
  assert.ok(withFailures.some(line => line.includes("Resultados: artifacts/output/extract/results/results.jsonl")));

  const noFailures = captureLogs(() => {
    logger.summary(4, 0, "out.jsonl");
  });
  assert.equal(noFailures.some(line => line.includes("✗ Falhas:")), false);
});

test("logger: log alias points to logger", () => {
  assert.equal(log, logger);
});
