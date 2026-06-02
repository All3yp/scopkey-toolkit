import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


export function readJsonlIds(file) {
  const ids = new Set();
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj.id) ids.add(String(obj.id));
      } catch {
      }
    }
  } catch {
  }
  return ids;
}


function collectLinksRecursive(dir) {
  const found = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        found.push(...collectLinksRecursive(full));
      } else if (/^links-.*\.json$/.test(entry.name)) {
        found.push(full);
      }
    }
  } catch { }
  return found;
}

export function findLatestLinks(outputDir) {
  const files = collectLinksRecursive(outputDir);
  if (!files.length) return null;
  files.sort().reverse();
  return files[0];
}

export function findLatestLinksFiles(outputDir, limit = 1) {
  const files = collectLinksRecursive(outputDir);
  return files.sort().reverse().slice(0, Math.max(1, Number(limit) || 1));
}

function listJsonl(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

function readIdsFromJsonl(files, filter) {
  const ids = new Set();
  for (const file of files) {
    try {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.id && (!filter || filter(obj))) ids.add(String(obj.id));
        } catch {  }
      }
    } catch {  }
  }
  return ids;
}

export function readAllDoneIdsFromAllSessions(extractParentDir) {
  const ids = new Set();
  try {
    for (const entry of fs.readdirSync(extractParentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sessionDir = path.join(extractParentDir, entry.name);
      const resultsDir = path.join(sessionDir, "results");
      const noKwDir = path.join(sessionDir, "no-keywords");
      for (const id of readAllDoneIds(resultsDir, noKwDir)) ids.add(id);
    }
  } catch { }
  return ids;
}

export function readAllDoneIds(resultsDir, noKeywordsDir) {
  const ids = readIdsFromJsonl(
    listJsonl(resultsDir),
    obj => Array.isArray(obj.keywords) && obj.keywords.length > 0
  );
  for (const id of readIdsFromJsonl(listJsonl(noKeywordsDir))) {
    ids.add(id);
  }
  return ids;
}

export function countFailures(failuresDir) {
  const counts = new Map();
  for (const file of listJsonl(failuresDir)) {
    try {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.id) {
            const id = String(obj.id);
            counts.set(id, (counts.get(id) || 0) + 1);
          }
        } catch {  }
      }
    } catch {  }
  }
  return counts;
}

export function loadAbstractsMap(abstractsDir) {
  const abstracts = new Map();
  for (const file of listJsonl(abstractsDir)) {
    try {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.id && obj.abstract) {
            abstracts.set(String(obj.id), obj.abstract);
          }
        } catch {  }
      }
    } catch {  }
  }
  return abstracts;
}
