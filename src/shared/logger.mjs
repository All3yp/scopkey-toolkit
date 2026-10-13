function colorEnabled() {
  if (process.env.NO_COLOR) return false;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined) return force !== "0" && force !== "false";
  return Boolean(process.stdout && process.stdout.isTTY);
}

const palette = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  gray: "\x1b[90m",
  red: "\x1b[91m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  blue: "\x1b[94m",
  magenta: "\x1b[95m",
  cyan: "\x1b[96m",
  white: "\x1b[97m",
  orange: "\x1b[38;5;208m",
};

const c = colorEnabled()
  ? palette
  : Object.fromEntries(Object.keys(palette).map(k => [k, ""]));

const WIDTH = Math.max(48, Math.min(process.stdout?.columns || 60, 72));
const rule = (char = "─", color = c.dim) => `${color}${char.repeat(WIDTH)}${c.reset}`;

export const logger = {
  divider() {
    console.log(rule());
  },

  header(title) {
    console.log();
    console.log(`${c.bold}${c.cyan}  ▶ ${title}${c.reset}`);
    console.log(rule("─", c.cyan));
  },

  step(msg) {
    console.log(`${c.gray}  → ${msg}${c.reset}`);
  },

  article(index, total, title, url) {
    console.log(rule());
    console.log(`${c.cyan}${c.bold}  [${index}/${total}]${c.reset} ${c.white}${title}${c.reset}`);
    if (url) console.log(`${c.gray}        ${url}${c.reset}`);
  },

  success(keywords, source) {
    const msgs = {
      "scopus": "keywords do Scopus",
      "translated": "keywords traduzidas",
      "deduplicated": "keywords deduplicadas",
    };
    const msg = msgs[source] || "keywords";
    console.log(`${c.green}  ✓ ${keywords.length} ${msg}${c.reset}`);
    for (const kw of keywords) {
      console.log(`${c.gray}      ·${c.reset} ${kw}`);
    }
  },

  empty(source) {
    const msgs = {
      "no-section": "Artigo sem seção de keywords",
      "empty-section": "Seção de keywords vazia",
    };
    const msg = msgs[source] || "Nenhuma keyword encontrada";
    console.log(`${c.yellow}  ⚠ ${msg}${c.reset}`);
  },

  error(msg) {
    console.log(`${c.red}  ✗ ${msg}${c.reset}`);
  },

  warn(msg) {
    console.log(`${c.yellow}  ⚠ ${msg}${c.reset}`);
  },

  info(msg) {
    console.log(`${c.blue}  ℹ ${msg}${c.reset}`);
  },

  done(msg) {
    console.log(`${c.green}  ✓ ${msg}${c.reset}`);
  },

  ok(msg) {
    console.log(`${c.green}    ✓ ${msg}${c.reset}`);
  },

  summary(success, fail, resultsPath) {
    console.log(rule("━", c.dim));
    console.log(`  ${c.bold}Concluído${c.reset}`);
    console.log(`  ${c.green}✓ Sucesso:${c.reset}  ${c.bold}${success}${c.reset}`);
    if (fail > 0) console.log(`  ${c.red}✗ Falhas:${c.reset}   ${c.bold}${fail}${c.reset}`);
    console.log(`  ${c.gray}Resultados:${c.reset} ${resultsPath}`);
  },
};

export const log = logger;
