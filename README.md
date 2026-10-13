# ScopKey Toolkit .𖥔 ݁ ˖ִ🛸༄˖°.

Este projeto viabiliza a coleta de uma lista grande de keywords no Scopus quando a API não está disponível no acesso atual via CAPES/CAFe. O toolkit automatiza busca, extração de `Author Keywords` / abstract / métricas e a organização local dos resultados.

Espero que este projeto te seja útil!, passei uns dias e madrugadas me dedicando a ele. (ᴗ˳ᴗ)ᶻz

- fluxo completo: `collect → extract → dedupe → categorize` (+ `clean`, `rank`, `sortby`)
- extração de Author/Indexed keywords, abstract e métricas por artigo
- download automático de PDFs: OpenAlex primeiro (acesso aberto), com fallback para IEEE Xplore (CAPES/CAFe) quando o OpenAlex não resolve
- saídas versionadas em JSONL, JSON e CSV

> Documentação completa (arquitetura, módulos, configuração e formatos de dados): **[doc.md](doc.md)**.

## Fluxo

```
searches.json → collect → extract → abstracts → dedupe → categorize
                                  ↘ clean / rank / sortby
                                                          ↘ download
```

## Setup

```bash
make setup    # instala dependências e cria o .env
make login    # autentica via CAFe e salva a sessão
```

Preencha o `.env` (veja `.env.EXAMPLE`) e as buscas em `config/searches.json`.

## Comandos

```bash
make collect          # coleta links (resume automático, sem limite)
make extract          # extrai keywords + abstract + métricas (incremental, 2 abas)
make collect-extract  # collect + extract em paralelo
make abstracts        # extrai abstracts de sessões anteriores
make dedupe           # consolida extracts → JSONL + JSON + CSV
make categorize       # categoriza artigos por grupos de pesquisa
make download         # baixa PDFs dos artigos deduplicados
make clean            # deduplicação + tradução automática de keywords
make rank             # ranking de keywords por citações
make sortby           # ordena resultados localmente
make test             # roda a suíte de testes
```

- `make` (ou `make help`) lista os alvos; `ARGS="..."` repassa flags extras (ex.: `make extract ARGS="--concurrency 3"`).
- Arquivo de buscas customizado (`.json`/`.jsonl`): `make collect caminho/buscas.jsonl` (idem `collect-extract`); no `download`: `make download caminho/lista.jsonl`.
- Ordenação local: `make sortby ARGS="--preset cited-highest"`.

## Licença

Este projeto está licenciado conforme [LICENSE.md](LICENSE.md).  
Contribua para ampliar o acesso livre ao conhecimento! ✌️👽

# How to cite (como citar):

```
@software{scopkey_toolkit_2026,
  author       = {Pereira, Alley},
  title        = {{ScopKey Toolkit}: Automated Extraction of Author Keywords from {Scopus} via {CAPES/CAFe}},
  year         = {2026},
  url          = {https://github.com/All3yp/scopkey-toolkit},
  version      = {0.4.0},
  note         = {Playwright-based pipeline for search, extraction, deduplication, and categorization of Scopus records}
}
```
---

<sub>_Em caso de dúvidas, me contate no Telegram, @heyalley_ (⚈₋₍⚈).</sub>
