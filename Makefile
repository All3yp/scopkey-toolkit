NODE ?= node
NPM  ?= npm

# Argumentos extras repassados ao script (ex: make extract ARGS="--concurrency 3")
ARGS ?=

# Alvos conhecidos — usado para extrair um arquivo de buscas passado por posição
TARGETS := help setup login collect extract collect-extract abstracts dedupe categorize download rename clean rank sortby test coverage build check

# Arquivo opcional (json ou jsonl), passado por posição:
#   make collect config/minhas-buscas.jsonl
#   make download artifacts/output/extract/deduped/articles-deduped.jsonl
INPUT := $(firstword $(filter-out $(TARGETS),$(MAKECMDGOALS)))
ifneq ($(INPUT),)
SEARCHES_ARG := --searches $(INPUT)
FILE_ARG := --file $(INPUT)
endif

# rename: argumentos posicionais — o 1º é o PDF, o 2º (entre aspas) é "id_titulo".
#   make rename ~/artigo.pdf "85098064539_Titulo do artigo"
# Também aceita a forma explícita PDF=... NAME=... como fallback.
RENAME_ARGS := $(filter-out $(TARGETS),$(MAKECMDGOALS))
RENAME_PDF  := $(or $(word 1,$(RENAME_ARGS)),$(PDF))
RENAME_NAME := $(or $(wordlist 2,$(words $(RENAME_ARGS)),$(RENAME_ARGS)),$(NAME))

.DEFAULT_GOAL := help

.PHONY: $(TARGETS)

help:
	@echo "ScopKey Toolkit — comandos disponíveis:"
	@echo ""
	@echo "  make setup            instala dependências e cria o .env"
	@echo "  make login            autentica via CAFe e salva a sessão"
	@echo "  make collect          coleta os links dos artigos"
	@echo "  make extract          extrai keywords + abstract + métricas"
	@echo "  make collect-extract  collect + extract em paralelo"
	@echo "  make abstracts        extrai abstracts de sessões anteriores"
	@echo "  make dedupe           consolida extracts → JSONL + JSON + CSV"
	@echo "  make categorize       categoriza artigos por grupos de pesquisa"
	@echo "  make download         baixa PDFs (opcional: make download caminho.jsonl)"
	@echo "  make rename           renomeia PDF manual: make rename arq.pdf \"id_titulo\""
	@echo "  make clean            deduplica + traduz keywords"
	@echo "  make rank             ranking de keywords por citações"
	@echo "  make sortby           ordena os resultados localmente"
	@echo "  make test             executa a suíte de testes"
	@echo "  make coverage         testes + relatório de cobertura"
	@echo "  make build            valida a sintaxe dos scripts"
	@echo "  make check            build + testes"
	@echo ""
	@echo "  Arquivo de buscas:  make collect caminho/buscas.jsonl"
	@echo "  Arquivo de download: make download caminho/lista.jsonl"
	@echo "  Flags extras:       make <alvo> ARGS=\"--flag valor\""

setup:
	$(NPM) install
	$(NODE) src/scripts/setup-env.mjs

login:
	$(NODE) src/scripts/login.mjs $(ARGS)

collect:
	$(NODE) src/pipeline/collect-links.mjs $(SEARCHES_ARG)

extract:
	$(NODE) src/pipeline/extract-keywords.mjs $(ARGS)

collect-extract:
	$(NODE) src/pipeline/collect-extract.mjs $(SEARCHES_ARG)

abstracts:
	$(NODE) src/pipeline/extract-abstracts.mjs $(ARGS)

dedupe:
	$(NODE) src/pipeline/dedupe-articles.mjs $(ARGS)

categorize:
	$(NODE) src/pipeline/categorize-articles.mjs $(ARGS)

download:
	$(NODE) src/pipeline/download-articles.mjs $(FILE_ARG) $(ARGS)

rename:
	@[ -n "$(RENAME_PDF)" ] && [ -n "$(RENAME_NAME)" ] || { echo 'uso: make rename <arquivo.pdf> "id_titulo"'; exit 1; }
	$(NODE) scripts/rename-download.mjs "$(RENAME_PDF)" "$(RENAME_NAME)"

clean:
	$(NODE) src/pipeline/clean-keywords.mjs $(ARGS)

rank:
	$(NODE) src/pipeline/rank-keywords.mjs $(ARGS)

sortby:
	$(NODE) src/pipeline/sort-results.mjs $(ARGS)

test:
	$(NODE) --test test/**/*.test.mjs

coverage:
	$(NODE) --test --experimental-test-coverage test/**/*.test.mjs

build:
	$(NODE) --check src/**/*.mjs

check: build test

# Permite passar um arquivo de buscas por posição sem erro de "alvo desconhecido"
%:
	@:
