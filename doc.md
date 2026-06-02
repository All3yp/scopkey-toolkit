# ScopKey Toolkit — Wiki

Documentação técnica completa do projeto. Para uso rápido veja o [README](README.md).

---

## Índice

1. [Visão geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Módulos](#módulos)
4. [Pipeline detalhado](#pipeline-detalhado)
5. [Formatos de dados](#formatos-de-dados)
6. [Configuração de buscas](#configuração-de-buscas)
7. [Scopus Search Fields](#scopus-search-fields)
8. [Testes e qualidade](#testes-e-qualidade)
9. [Deploy / release](#deploy--release)

---

## Visão geral

O ScopKey Toolkit automatiza a extração de keywords e metadados de artigos científicos no Scopus via Playwright (browser automation). Surgiu da necessidade de exportar dados quando o acesso via API institucional CAPES/CAFe não estava disponível.

**Dependências principais:**

| Pacote | Uso |
|--------|-----|
| `playwright` | Automação do browser (Chromium) |
| `detectlanguage` | Detecção de idioma das keywords |
| `google-translate-api-next` | Tradução automática PT→EN |
| `dotenv` | Carregamento de variáveis de ambiente |

---

## Arquitetura

```
src/
├── core/               # Lógica pura, sem I/O de pipeline
│   ├── abstract-extract.mjs    # Extrai abstract do DOM do Scopus
│   ├── build-url.mjs           # Constrói URLs de busca do Scopus
│   └── keyword-extract.mjs     # Extrai keywords do DOM / texto
├── pipeline/           # Scripts executáveis (entrada e saída de arquivos)
│   ├── collect-links.mjs       # Coleta links de artigos
│   ├── extract-keywords.mjs    # Extrai keywords + abstract por artigo
│   ├── extract-abstracts.mjs   # Extrai abstracts de sessões anteriores
│   ├── dedupe-articles.mjs     # Consolida e deduplica todos os resultados
│   ├── categorize-articles.mjs # Categoriza artigos por tema
│   ├── clean-keywords.mjs      # Normaliza e traduz keywords
│   ├── rank-keywords.mjs       # Ranking de keywords por citações
│   ├── sort-results.mjs        # Ordena artigos coletados localmente
│   ├── collect-extract.mjs     # Orquestra collect + extract em paralelo
│   └── download-articles.mjs   # Download de PDFs dos artigos
├── shared/             # Utilitários compartilhados entre scripts
│   ├── config.mjs      # Configuração de runtime (env, browser, tradutor)
│   ├── logger.mjs      # Logger formatado com ícones
│   ├── formatter.mjs   # Formatação de sumários e exibições
│   └── utils.mjs       # I/O: ensureDir, appendJsonl, readJsonlIds, etc.
├── browser/            # Helpers de automação Playwright
└── scripts/            # Scripts auxiliares (setup, pre-commit)

config/
├── searches.json       # Configurações de busca
├── categories.json     # Grupos de keywords por tema
└── ...

test/
├── core/               # Testes de src/core/
├── pipeline/           # Testes de src/pipeline/
└── shared/             # Testes de src/shared/
```

---

## Módulos

### `src/core/keyword-extract.mjs`

Extrai keywords do DOM de uma página Scopus. Usa estratégias em cascata:

| Prioridade | Estratégia | Descrição |
|-----------|------------|-----------|
| 1 | `id-exact` | IDs exatos `#document-details-author-keywords` e `#document-details-indexed-keywords` |
| 2 | `testid` | Elementos com `data-testid*="keyword"` |
| 3 | `heading` | TreeWalker procura por headings "Author Keywords", "Indexed Keywords", "Engineering…" |
| 4 | `class` | Seletores de classe como `[class*="keywordGroup"]` |
| 5 | `id` | Qualquer `[id*="keyword"]` |

**Retorno:**
```json
{
  "source": "id-exact",
  "keywords": ["UAV", "Deep learning", "Wireless networks"],
  "groups": [
    { "type": "author", "keywords": ["UAV", "Deep learning"] },
    { "type": "indexed-controlled", "keywords": ["Deep learning", "Wireless networks"] },
    { "type": "indexed-uncontrolled", "keywords": ["Aerial vehicle"] }
  ]
}
```

Tipos de grupo: `author`, `indexed-controlled`, `indexed-uncontrolled`, `indexed`, `other`.

**`extractFromText(text)`** — fallback quando o DOM não está disponível; lê o corpo da página como texto.

---

### `src/core/abstract-extract.mjs`

Função `extractAbstractFromDOM()` executada via `page.evaluate()`. Busca `#document-details-abstract > p` e retorna o texto trimado ou `null`.

---

### `src/core/build-url.mjs`

**`buildScopusUrl(search)`** — constrói a URL de busca completa do Scopus a partir de uma entrada de `searches.json`.

- `limit` sempre `200` (máximo suportado pela interface Scopus)
- `sourceTitle` vira cluster `exactsrctitle,"...",t` (não é inserido no param `s`)
- Filtros de campo (`AUTH`, `AFFIL`, etc.) são concatenados ao param `s`
- Requer `SCOPUS_RESULTS_URL` no ambiente

**`resolveScopusSort(search)`** — mapeia `sortBy`/`sortDirection` para o código interno do Scopus (`cp-f`, `plf-t`, etc.).

---

### `src/shared/utils.mjs`

| Função | Descrição |
|--------|-----------|
| `ensureDir(dir)` | Cria diretório recursivamente |
| `readJson(file, fallback)` | Lê JSON com fallback silencioso |
| `writeJson(file, data)` | Escreve JSON indentado |
| `appendJsonl(file, obj)` | Acrescenta linha JSONL |
| `readJsonlIds(file)` | Retorna `Set<string>` de IDs de um JSONL |
| `findLatestLinks(dir)` | Retorna o `links-*.json` mais recente em `dir` |
| `findLatestLinksFiles(dir, limit)` | Retorna todos os `links-*.json` recursivamente, até `limit` |
| `readAllDoneIds(dirs)` | Agrega IDs processados de múltiplos diretórios |
| `readAllDoneIdsFromAllSessions(extractParentDir)` | Varre todas as sessões de extract e retorna IDs já processados |
| `countFailures(dir)` | Conta falhas por ID em arquivos `failures-*.jsonl` |

---

### `src/shared/config.mjs`

**`buildRuntimeConfig(overrides?)`** — constrói o objeto de runtime com:
- `SETTINGS`: credenciais, caminhos, flags
- `detectLang(text)`: detecta idioma via DetectLanguage API (ou retorna `"en"`)
- `translateIfNeeded(text)`: traduz se não for inglês

**`resolveSecret(value)`** — suporta valores no formato `PASS:caminho/no/pass` para integração com o gerenciador `pass(1)`.

**`PATHS`** — objeto com todos os caminhos de saída, calculados a partir de `SESSION_TS` (ou timestamp atual).

---

### `src/pipeline/collect-links.mjs`

- Lê `config/searches.json`, abre o browser com sessão salva
- Pagina o Scopus (200 por página) até coletar todos os resultados
- Salva `artifacts/output/collect/<ts>/links-<id>-<ts>.json` por busca
- Incremental: retoma de onde parou se interrompido

---

### `src/pipeline/extract-keywords.mjs`

- Lê todos os `links-*.json` da sessão de collect
- Pula artigos já processados em **qualquer sessão anterior** (`readAllDoneIdsFromAllSessions`)
- Para cada artigo: navega até a URL, aguarda seletores de keyword, chama `extractFromDOM` + `extractAbstractFromDOM`
- Salva no JSONL de results: `id`, `title`, `abstract`, `keywords`, `originalKeywords`, `groups`, `source`, `sourceLink`
- Falhas vão para `failures/`, sem keywords para `no-keywords/`

---

### `src/pipeline/extract-abstracts.mjs`

- Lê artigos de **todas as sessões de extract** (via scan de `artifacts/output/extract/`)
- Pula artigos cujo abstract já existe em qualquer sessão de abstracts
- Navega até cada artigo e extrai o abstract
- Útil para retroativamente popular abstracts em sessões antigas

---

### `src/pipeline/dedupe-articles.mjs`

- Varre **todas as sessões** de `artifacts/output/extract/*/results/`
- Deduplica por `id` (primeiro encontrado vence)
- Para abstract: prefere o campo `abstract` embutido no result; fallback para `abstracts/` da sessão
- Gera três arquivos em `artifacts/output/extract/deduped/`:
  - `articles-deduped.jsonl` — JSONL linha a linha
  - `articles-deduped.json` — array JSON completo
  - `articles-deduped.csv` — colunas: `id`, `title`, `abstract`, `keywords`, `authorKeywords`, `indexedKeywords`, `source`, `sourceLink`

---

### `src/pipeline/categorize-articles.mjs`

- Lê o arquivo deduped (ou resultados da sessão)
- Compara keywords de cada artigo com grupos definidos em `config/categories.json`
- Salva `articles-categorized.jsonl` com campo `categories` adicionado

---

## Pipeline detalhado

### Fluxo completo recomendado

```bash
# 1. Autenticar (necessário apenas uma vez por sessão)
npm run login

# 2. Coletar todos os artigos das buscas configuradas
npm run collect

# 3. Extrair keywords + abstract de todos os artigos coletados
npm run extract

# 4. (Opcional) Extrair abstracts de sessões anteriores que não tinham
npm run abstracts

# 5. Consolidar tudo em um único arquivo deduplicado
npm run dedupe

# 6. Categorizar artigos por tema
npm run categorize

# 7. (Opcional) Limpar/traduzir keywords
npm run clean

# 8. (Opcional) Gerar ranking
npm run rank
```

### Re-executar extract para artigos que falharam

O extract é incremental — ao rodar novamente, pula automaticamente os que já estão em qualquer sessão anterior. Os artigos em `failures/` serão tentados novamente na próxima execução.

```bash
npm run extract
```

### Collect + extract simultâneos

```bash
npm run collect-extract
```

Roda coleta e extração em paralelo. Artigos chegam para a extração à medida que são coletados.

---

## Formatos de dados

### `links-<id>-<ts>.json`

Array de publicações coletadas:

```json
[
  {
    "id": "85123456789",
    "title": "Deep Reinforcement Learning for UAV Path Planning",
    "url": "https://www.scopus.com/record/display.uri?eid=2-s2.0-85123456789",
    "year": 2023,
    "citedBy": 42,
    "authors": ["Smith J.", "Zhang W."],
    "sourceTitle": "IEEE Transactions on Vehicular Technology"
  }
]
```

### `results-<ts>.jsonl`

Um objeto JSON por linha:

```json
{
  "id": "85123456789",
  "title": "Deep Reinforcement Learning for UAV Path Planning",
  "abstract": "This paper proposes...",
  "keywords": ["UAV", "Deep reinforcement learning", "Path planning"],
  "originalKeywords": ["UAV", "Deep reinforcement learning", "Path planning"],
  "groups": [
    { "type": "author", "keywords": ["UAV", "Deep reinforcement learning"] },
    { "type": "indexed-controlled", "keywords": ["Deep reinforcement learning", "Path planning"] }
  ],
  "source": "id-exact",
  "sourceLink": "https://www.scopus.com/record/display.uri?eid=2-s2.0-85123456789"
}
```

### `articles-deduped.csv`

Cabeçalho: `id,title,abstract,keywords,authorKeywords,indexedKeywords,source,sourceLink`

- `keywords` — todas as keywords, separadas por `; `
- `authorKeywords` — somente do grupo `author`, separadas por `; `
- `indexedKeywords` — todos os grupos não-author, deduplicadas, separadas por `; `

---

## Configuração de buscas

### `config/searches.json`

```json
[
  {
    "name": "ntn-uav",
    "query": "TITLE-ABS-KEY(\"non-terrestrial network\" AND UAV)",
    "exclusion": "indoor OR laboratory",
    "yearFrom": 2019,
    "yearTo": 2026,
    "docTypes": ["ar", "cp", "re"],
    "sortBy": "citedBy",
    "sortDirection": "highest",
    "categoryIds": ["ntn_uav"]
  }
]
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `name` | string | Identificador único (usado no nome dos arquivos) |
| `query` | string | Query principal Scopus |
| `exclusion` | string? | Termos a excluir com `AND NOT` |
| `sourceTitle` | string? | Filtro por título de periódico (vira cluster) |
| `authors` | string[]? | Filtro por autores |
| `affiliations` | string[]? | Filtro por afiliação |
| `countries` | string[]? | Filtro por país |
| `conferences` | string[]? | Filtro por conferência |
| `publishers` | string[]? | Filtro por editora |
| `language` | string? | Filtro por idioma |
| `yearFrom` | number? | Ano inicial |
| `yearTo` | number? | Ano final |
| `docTypes` | string[]? | Tipos de documento (`ar`, `re`, `cp`, `ch`, `ip`) |
| `sortBy` | string? | `date`, `citedBy`, `relevance` |
| `sortDirection` | string? | `newest`/`oldest` (date) ou `highest`/`lowest` (citedBy) |
| `categoryIds` | string[]? | IDs de `categories.json` para enriquecer a query |

> **Nota:** `maxResults` foi removido. A coleta sempre pagina todos os resultados encontrados pelo Scopus (200 por página).

### `config/categories.json`

Define grupos de keywords para categorização e enriquecimento de queries:

```json
[
  {
    "id": "ntn_uav",
    "label": "UAV / Drone",
    "keywords": ["UAV", "drone", "unmanned aerial vehicle", "RPAS"]
  },
  {
    "id": "ntn_v2x_security",
    "label": "V2X Security",
    "cross": [
      ["v2x", "vehicular", "vehicle-to"],
      ["security", "authentication", "privacy"]
    ]
  }
]
```

- `keywords`: array simples → `(kw1 OR kw2 OR ...)`
- `cross`: produto AND de grupos → `((g1a OR g1b) AND (g2a OR g2b))`

---

## Scopus Search Fields

Referência rápida dos field codes usados nas queries:

| Campo | Código Scopus | Exemplo |
|-------|---------------|---------|
| Título | `TITLE` | `TITLE("machine learning")` |
| Abstract | `ABS` | `ABS("neural networks")` |
| Keywords | `KEY` | `KEY("deep learning")` |
| Título+Abs+KW | `TITLE-ABS-KEY` | `TITLE-ABS-KEY("NTN")` |
| Periódico | `SRCTITLE` | `SRCTITLE("IEEE Trans.")` |
| Afiliação | `AFFIL` | `AFFIL("MIT")` |
| Autor | `AUTH` | `AUTH("Smith J")` |
| País afiliação | `AFFILCOUNTRY` | `AFFILCOUNTRY("Brazil")` |
| Conferência | `CONF` | `CONF("ICC")` |
| Editora | `PUBLISHER` | `PUBLISHER("Elsevier")` |
| Idioma | `LANGUAGE` | `LANGUAGE("English")` |
| Ano | `PUBYEAR` | `PUBYEAR > 2019` |
| Tipo de doc | `DOCTYPE` | `DOCTYPE(ar)` |

**Tipos de documento:**

| Código | Tipo |
|--------|------|
| `ar` | Article |
| `re` | Review |
| `cp` | Conference Paper |
| `ch` | Book Chapter |
| `ip` | Article in Press |
| `bk` | Book |

---

## Testes e qualidade

### Executar testes

```bash
npm test                          # todos os testes
npm run test:coverage             # testes + relatório de cobertura
node --test test/core/keyword-extract.test.mjs   # arquivo específico
```

### Cobertura atual

| Arquivo | Lines | Branches | Funcs |
|---------|-------|----------|-------|
| `abstract-extract.mjs` | 100% | 100% | 100% |
| `keyword-extract.mjs` | 100% | 93% | 100% |
| `build-url.mjs` | 88% | 94% | 83% |
| `sort-results.mjs` | 96% | 96% | 78% |
| `config.mjs` | 95% | 85% | 89% |
| `logger.mjs` | 100% | 100% | 100% |
| `utils.mjs` | 88% | 91% | 89% |
| **Total** | **~94%** | **~93%** | **~91%** |

### Estrutura dos testes

```
test/
├── core/
│   ├── abstract-extract.test.mjs   # extractAbstractFromDOM
│   ├── build-url.test.mjs          # buildScopusUrl, resolveScopusSort
│   └── keyword-extract.test.mjs    # extractFromDOM (todas as estratégias), extractFromText
├── pipeline/
│   ├── dedupe-articles.test.mjs    # lógica de dedup, CSV, merge de abstracts
│   └── sort-results.test.mjs       # sortPublications, resolveSortOptions, runSortResults
└── shared/
    ├── config.test.mjs             # buildRuntimeConfig, resolveSecret
    ├── logger.test.mjs             # todas as funções do logger
    └── utils.test.mjs              # todas as funções de I/O
```

Os testes usam o runner nativo `node:test` + `node:assert/strict`. Não há dependências externas de teste.

---

## Deploy / release

O projeto não tem backend — é um toolkit CLI local. "Deploy" significa criar um pacote versionado para distribuição ou arquivamento.

### Como criar um release

```bash
# 1. Garantir que tudo passa
npm run check        # build (typecheck) + testes

# 2. Bump de versão no package.json
npm version patch    # 0.1.0 → 0.1.1 (bug fix)
npm version minor    # 0.1.0 → 0.2.0 (nova feature)
npm version major    # 0.1.0 → 1.0.0 (breaking change)

# 3. Criar o pacote comprimido (exclui node_modules e artifacts)
npm pack             # gera scopkey-toolkit-0.x.x.tgz

# 4. (Opcional) Tag no git
git tag v0.x.x
git push origin v0.x.x
```

### O que o `npm pack` inclui

Inclui tudo que não está no `.gitignore` / `.npmignore`. Para controlar o conteúdo, o `package.json` pode ter um campo `files`:

```json
"files": [
  "src/",
  "config/",
  "scripts/",
  ".env.EXAMPLE",
  "README.md",
  "doc.md",
  "LICENSE.md"
]
```

### Instalar a partir do `.tgz`

```bash
npm install ./scopkey-toolkit-0.x.x.tgz
```

### CI / GitHub Actions

O workflow em `.github/` pode ser configurado para rodar `npm run check` em cada push e criar o release automaticamente ao fazer push de uma tag `v*`:

```yaml
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run check
      - run: npm pack
      - uses: softprops/action-gh-release@v2
        with:
          files: '*.tgz'
```

---

*Documentação gerada em Jun/2026. Para contribuições ou dúvidas: Telegram @heyalley.*
