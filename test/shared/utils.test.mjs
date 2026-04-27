import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureDir, readJson, writeJson, appendJsonl,
  readJsonlIds, findLatestLinks, readAllDoneIds, countFailures,
} from "../../src/shared/utils.mjs";

function tmp(prefix = "utils-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

test("ensureDir: creates nested directories and is idempotent", () => {
  const root = tmp();
  try {
    const nested = path.join(root, "a", "b", "c");
    ensureDir(nested);
    assert.equal(fs.existsSync(nested), true);
    ensureDir(nested);
    assert.equal(fs.existsSync(nested), true);
  } finally { cleanup(root); }
});

test("readJson: returns fallback when file does not exist", () => {
  const root = tmp();
  try { assert.deepEqual(readJson(path.join(root, "missing.json"), { ok: true }), { ok: true }); }
  finally { cleanup(root); }
});

test("readJson: returns fallback when file contains invalid JSON", () => {
  const root = tmp();
  try {
    const f = path.join(root, "bad.json");
    fs.writeFileSync(f, "{not-json", "utf8");
    assert.deepEqual(readJson(f, []), []);
  } finally { cleanup(root); }
});

test("readJson: parses and returns valid JSON content", () => {
  const root = tmp();
  try {
    const f = path.join(root, "ok.json");
    fs.writeFileSync(f, JSON.stringify({ a: 1, b: [2, 3] }), "utf8");
    assert.deepEqual(readJson(f), { a: 1, b: [2, 3] });
  } finally { cleanup(root); }
});

test("readJson: default fallback is an empty array", () => {
  const root = tmp();
  try { assert.deepEqual(readJson(path.join(root, "missing.json")), []); }
  finally { cleanup(root); }
});

test("writeJson: creates parent directories and pretty-prints JSON", () => {
  const root = tmp();
  try {
    const f = path.join(root, "deep", "nested", "out.json");
    writeJson(f, { hello: "world" });
    assert.equal(fs.readFileSync(f, "utf8"), '{\n  "hello": "world"\n}');
  } finally { cleanup(root); }
});

test("writeJson + readJson round-trip preserves data", () => {
  const root = tmp();
  try {
    const f = path.join(root, "rt.json");
    const data = { a: 1, b: ["x", "y"], c: { d: null } };
    writeJson(f, data);
    assert.deepEqual(readJson(f), data);
  } finally { cleanup(root); }
});

test("appendJsonl: appends one JSON object per line, creating directories", () => {
  const root = tmp();
  try {
    const f = path.join(root, "new", "data.jsonl");
    appendJsonl(f, { id: "a" });
    appendJsonl(f, { id: "b" });
    appendJsonl(f, { id: "c" });
    assert.deepEqual(fs.readFileSync(f, "utf8").split("\n"), ['{"id":"a"}', '{"id":"b"}', '{"id":"c"}', ""]);
  } finally { cleanup(root); }
});

test("readJsonlIds: collects string ids from all valid lines", () => {
  const root = tmp();
  try {
    const f = path.join(root, "ids.jsonl");
    fs.writeFileSync(f, ['{"id":"1","extra":true}', '{"id":"2"}', '{"noId":"skip"}', '{"id":3}'].join("\n") + "\n", "utf8");
    const ids = readJsonlIds(f);
    assert.ok(ids instanceof Set);
    assert.deepEqual([...ids].sort(), ["1", "2", "3"]);
  } finally { cleanup(root); }
});

test("readJsonlIds: silently skips blank and malformed lines", () => {
  const root = tmp();
  try {
    const f = path.join(root, "ids.jsonl");
    fs.writeFileSync(f, ["", "   ", '{"id":"ok"}', "not-json", '{"id":"ok2"}'].join("\n"), "utf8");
    assert.deepEqual([...readJsonlIds(f)].sort(), ["ok", "ok2"]);
  } finally { cleanup(root); }
});

test("readJsonlIds: returns empty Set when file missing", () => {
  assert.equal(readJsonlIds(path.join(os.tmpdir(), "definitely-not-here.jsonl")).size, 0);
});

test("findLatestLinks: returns null for missing directory", () => {
  assert.equal(findLatestLinks(path.join(os.tmpdir(), "no-such-dir-" + Date.now())), null);
});

test("findLatestLinks: returns null for empty directory", () => {
  const root = tmp();
  try { assert.equal(findLatestLinks(root), null); } finally { cleanup(root); }
});

test("findLatestLinks: only matches links-*.json (ignores other files)", () => {
  const root = tmp();
  try {
    fs.writeFileSync(path.join(root, "readme.txt"), "x");
    fs.writeFileSync(path.join(root, "results-2024.jsonl"), "x");
    fs.writeFileSync(path.join(root, "notlinks.json"), "x");
    assert.equal(findLatestLinks(root), null);
  } finally { cleanup(root); }
});

test("findLatestLinks: picks lexicographically-latest filename", () => {
  const root = tmp();
  try {
    fs.writeFileSync(path.join(root, "links-2024-01-02_10h00m00s.json"), "x");
    fs.writeFileSync(path.join(root, "links-2025-06-15_12h30m45s.json"), "x");
    fs.writeFileSync(path.join(root, "links-2024-12-31_23h59m59s.json"), "x");
    assert.equal(findLatestLinks(root), path.join(root, "links-2025-06-15_12h30m45s.json"));
  } finally { cleanup(root); }
});

test("readAllDoneIds: includes results with non-empty keywords; excludes empty/missing", () => {
  const root = tmp();
  try {
    const resultsDir = path.join(root, "results");
    const noKwDir    = path.join(root, "no-kw");
    ensureDir(resultsDir); ensureDir(noKwDir);

    fs.writeFileSync(
      path.join(resultsDir, "results-a.jsonl"),
      ['{"id":"A1","keywords":["x","y"]}', '{"id":"A2","keywords":[]}', '{"id":"A3"}', '{"id":"A4","keywords":["z"]}'].join("\n") + "\n",
      "utf8"
    );
    fs.writeFileSync(path.join(noKwDir, "no-keywords-a.jsonl"), ['{"id":"N1"}', '{"id":"N2"}'].join("\n") + "\n", "utf8");

    assert.deepEqual([...readAllDoneIds(resultsDir, noKwDir)].sort(), ["A1", "A4", "N1", "N2"]);
  } finally { cleanup(root); }
});

test("readAllDoneIds: dedups ids across multiple files", () => {
  const root = tmp();
  try {
    const resultsDir = path.join(root, "results");
    const noKwDir    = path.join(root, "no-kw");
    ensureDir(resultsDir); ensureDir(noKwDir);

    fs.writeFileSync(path.join(resultsDir, "results-a.jsonl"), '{"id":"DUP","keywords":["k"]}\n');
    fs.writeFileSync(path.join(resultsDir, "results-b.jsonl"), '{"id":"DUP","keywords":["k"]}\n');

    assert.deepEqual([...readAllDoneIds(resultsDir, noKwDir)], ["DUP"]);
  } finally { cleanup(root); }
});

test("readAllDoneIds: tolerates missing directories", () => {
  const nowhere = path.join(os.tmpdir(), "nope-" + Date.now());
  assert.equal(readAllDoneIds(nowhere, nowhere + "-2").size, 0);
});

test("countFailures: counts occurrences per id across files", () => {
  const root = tmp();
  try {
    const dir = path.join(root, "failures");
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, "failures-a.jsonl"), ['{"id":"X","err":"timeout"}', '{"id":"Y","err":"network"}', '{"id":"X","err":"retry"}'].join("\n") + "\n", "utf8");
    fs.writeFileSync(path.join(dir, "failures-b.jsonl"), '{"id":"X","err":"other"}\n{"id":"Z","err":"ok"}\n');

    const counts = countFailures(dir);
    assert.equal(counts.get("X"), 3);
    assert.equal(counts.get("Y"), 1);
    assert.equal(counts.get("Z"), 1);
    assert.equal(counts.has("missing"), false);
  } finally { cleanup(root); }
});

test("countFailures: returns empty Map for missing directory", () => {
  const counts = countFailures(path.join(os.tmpdir(), "no-such-" + Date.now()));
  assert.ok(counts instanceof Map);
  assert.equal(counts.size, 0);
});

test("countFailures: coerces numeric ids to strings", () => {
  const root = tmp();
  try {
    const dir = path.join(root, "failures");
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, "failures.jsonl"), '{"id":42}\n{"id":"42"}\n');
    const counts = countFailures(dir);
    assert.equal(counts.get("42"), 2);
    assert.equal(counts.get(42), undefined);
  } finally { cleanup(root); }
});
