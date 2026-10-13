#!/usr/bin/env node
/**
 * Prévia do logger — imprime exemplos de todas as mensagens SEM executar
 * nenhum pipeline (sem browser, sem rede, sem downloads).
 *
 *   node scripts/preview-logs.mjs [all|download|extract|misc]
 *   make preview
 *   make preview ARGS="download"
 */
import { log } from "../src/shared/logger.mjs";

const scenarios = {
  download() {
    log.header("Download Articles (Incremental)");

    log.info("Lendo: articles-deduped.jsonl");
    log.info("Artigos: 128");
    log.info("Downloads já feitos: 40");
    log.info("Pendentes: 88");
    log.step("Lista de pendentes: artifacts/output/extract/downloads/logs/pendentes-20260713.jsonl");
    log.info("⚡ Download paralelo: 4 abas");

    log.article(1, 88, "Deep Learning for Remote Sensing: A Survey", "https://www.scopus.com/record/display.uri?eid=2-s2.0-85098064539");
    log.ok("Downloaded: 85098064539_Deep_Learning_for_Remote_Sensing_A_Survey.pdf (via OpenAlex)");

    log.article(2, 88, "Verify and Revive: Secure Detection and Recovery", "https://ieeexplore.ieee.org/document/9142377");
    log.ok("Downloaded: 9142377_Verify_and_Revive.pdf");
    log.warn("Nenhum botão View PDF / Full Text encontrado");
    log.warn("Failed: no-pdf-button-found");

    log.article(3, 88, "Adaptive Beamforming for UAV Networks", "https://www.scopus.com/record/display.uri?eid=2-s2.0-85100000000");
    log.error("Timeout ao baixar: navigation timeout of 30000ms exceeded");

    log.header("Download Complete");
    log.done("86 PDFs baixados (Scopus/CAPES: 40, OpenAlex: 46)");
    log.warn("2 falhas");
    log.step("Registros salvos em: artifacts/output/extract/downloads/logs/downloads-20260713.jsonl");
    log.step("PDFs em: artifacts/output/extract/downloads");
    log.divider();
  },

  extract() {
    log.header("Extract Keywords (Incremental)");
    log.info("Lendo 3 arquivo(s) de links de todas as sessões de coleta");
    log.info("Total: 214  |  Já processados: 126  |  A processar: 88");
    log.info("⚡ Extração paralela: 2 abas");

    log.article(1, 88, "Federated Learning in Wireless Systems", "https://www.scopus.com/record/display.uri?eid=2-s2.0-85111111111");
    log.success(["federated learning", "wireless networks", "privacy"], "scopus");

    log.article(2, 88, "Channel Estimation with Deep Learning", "https://www.scopus.com/record/display.uri?eid=2-s2.0-85122222222");
    log.empty("no-section");
    log.empty("empty-section");

    log.header("Abstract Extraction Complete");
    log.done("86 abstracts extraídos");
    log.step("Abstracts salvos em: artifacts/output/extract/abstracts/abstracts-20260713.jsonl");
    log.summary(86, 2, "artifacts/output/extract/results/results-20260713.jsonl");
  },

  misc() {
    log.header("Estados do logger");
    log.step("passo / progresso");
    log.info("informação");
    log.ok("subitem de sucesso");
    log.done("concluído");
    log.success(["author keyword", "indexed keyword"], "translated");
    log.warn("aviso");
    log.empty("no-section");
    log.error("erro");
    log.divider();
    log.summary(12, 3, "artifacts/output/extract/results/results.jsonl");
  },
};

function run(name) {
  const scenario = scenarios[name];
  if (!scenario) {
    console.error(`Cenário desconhecido: ${name}`);
    console.error(`Disponíveis: ${Object.keys(scenarios).join(", ")}, all`);
    process.exit(1);
  }
  scenario();
}

const arg = (process.argv[2] || "all").toLowerCase();

if (arg === "all") {
  for (const name of Object.keys(scenarios)) run(name);
} else {
  run(arg);
}
