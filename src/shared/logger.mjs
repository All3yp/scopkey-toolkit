const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  orange: "\x1b[38;5;208m",
};

const COLS = 50;
const line = (char = "─") => c.dim + char.repeat(COLS) + c.reset;

export const logger = {
  divider() {
    console.log(line());
  },

  header(title) {
    console.log();
    console.log(`${c.bold}${c.cyan}  ▶ ${title}${c.reset}`);
    console.log(line());
  },

  step(msg) {
    console.log(`${c.dim}  → ${msg}${c.reset}`);
  },

  article(index, total, title, url) {
    console.log(line());
    console.log(`${c.cyan}${c.bold}[${index}/${total}]${c.reset} ${c.white}${title}${c.reset}`);
    console.log(`${c.dim}        ${url}${c.reset}`);
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
      console.log(`${c.dim}      ·${c.reset} ${kw}`);
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
    console.log(`${c.green}    ✓ ${c.dim}${msg}${c.reset}`);
  },

  summary(success, fail, resultsPath) {
    console.log(line("━"));
    console.log(`${c.bold}Concluído${c.reset}`);
    console.log(`  ${c.green}✓ Sucesso:${c.reset}  ${success}`);
    if (fail > 0) console.log(`  ${c.red}✗ Falhas:${c.reset}   ${fail}`);
    console.log(`  ${c.dim}Resultados: ${resultsPath}${c.reset}`);
  },
};

export const log = logger;
