import { log } from "./logger.mjs";

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  white:  "\x1b[37m",
  blue:   "\x1b[34m",
  magenta: "\x1b[35m",
};

const COLS = 70;
const line = (char = "─") => c.dim + char.repeat(COLS) + c.reset;

export const fmt = {
  header(title) {
    console.log("");
    console.log(line("═"));
    console.log(`${c.cyan}${c.bold}  ${title}${c.reset}`);
    console.log(line("═"));
  },

  searchStart(name, maxResults, url) {
    console.log("");
    console.log(`${c.bold}▶ ${name}${c.reset} ${c.dim}(max: ${maxResults})${c.reset}`);
    console.log(`${c.dim}  ${url}${c.reset}`);
  },

  pageProgress(pageNum, read, added, total, max) {
    const pct = Math.min(100, Math.round((total / max) * 100));
    const bar = this.progressBar(pct, 20);
    console.log(`  ${c.dim}Página ${pageNum}:${c.reset} ${bar} ${c.cyan}${total}/${max}${c.reset} ${c.dim}(+${added} novos, ${read} lidos)${c.reset}`);
  },

  progressBar(pct, width) {
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    return `${c.green}[${bar}]${c.reset}`;
  },

  searchSummary(total, detectedPages, maxResults) {
    const status = total > 0 ? c.green : c.yellow;
    console.log(`  ${status}✓ Coletados: ${total}/${maxResults} artigos${c.reset}`);
    if (detectedPages) {
      console.log(`  ${c.dim}  Paginação: ${detectedPages} páginas${c.reset}`);
    } else {
      console.log(`  ${c.yellow}  ⚠ Paginação não detectada${c.reset}`);
    }
  },

  session(status) {
    if (status === "checking") {
      console.log(`${c.dim}Verificando sessão...${c.reset}`);
    } else if (status === "active") {
      console.log(`${c.green}✓ Sessão ativa${c.reset}`);
    } else if (status === "expired") {
      console.log(`${c.yellow}⚠ Sessão expirada, iniciando login...${c.reset}`);
    }
  },

  displayAdjusted(perPage) {
    console.log(`  ${c.green}✓${c.reset} ${c.dim}Display: ${perPage}/página${c.reset}`);
  },

  displayWarning() {
    console.log(`  ${c.yellow}⚠${c.reset} ${c.dim}Display padrão (select não encontrado)${c.reset}`);
  },

  finalSummary(results, outputPath) {
    console.log("");
    console.log(line("═"));
    console.log(`${c.cyan}${c.bold}  RESUMO DA COLETA${c.reset}`);
    console.log(line("═"));

    let totalArticles = 0;
    for (const r of results) {
      const status = r.count > 0 ? c.green : c.yellow;
      console.log(`  ${status}•${c.reset} ${c.bold}${r.id}${c.reset}: ${c.cyan}${r.count}${c.reset}${r.total ? ` / ${r.total}` : ""} ${c.dim}artigos${c.reset}`);
      totalArticles += r.count;
    }

    console.log(line("─"));
    console.log(`  ${c.green}${c.bold}Total geral:${c.reset} ${c.cyan}${totalArticles}${c.reset} ${c.dim}artigos em ${results.length} buscas${c.reset}`);
    console.log(`  ${c.dim}Salvo em: ${outputPath}${c.reset}`);
    console.log(line("═"));
  },

  cookieAccepted() {
    console.log(`  ${c.dim}✓ Cookies aceitos${c.reset}`);
  },

  loginInstructions() {
    console.log(`${c.yellow}Acompanhe o browser para completar o login:${c.reset}`);
    console.log(`  ${c.dim}1. Instituição selecionada automaticamente${c.reset}`);
    console.log(`  ${c.dim}2. Credenciais preenchidas automaticamente${c.reset}`);
    console.log(`  ${c.dim}3. Clique "Continuar" manualmente${c.reset}`);
  },

  waitingScopus(url, remainingSec) {
    console.log(`${c.dim}Aguardando Scopus... (${remainingSec}s) URL: ${url}${c.reset}`);
  },

  redirectAttempt() {
    console.log(`${c.dim}Tentando redirecionamento direto...${c.reset}`);
  },

  paginationDone() {
    console.log(`  ${c.dim}✓ Paginação finalizada${c.reset}`);
  },
};

export default fmt;
