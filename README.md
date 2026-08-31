# Painel de Preços para Licitações

Ferramenta de pesquisa de preços e padronização de orçamentos para embasar processos
licitatórios, conforme a **Lei 14.133/2021 (Art. 23)** e a **IN SEGES/ME nº 65/2021**.

- **Página (GitHub Pages):** https://luis19730.github.io/paineldepre-os/
- **Proxy Worker (Cloudflare):** https://painel-precos-licitacoes.luis19730.workers.dev

## O que faz

1. **Identificar o item** — código CATMAT/CATSER e descrição.
2. **Buscar preços** ao vivo na **API oficial do Compras.gov.br** (Módulo Pesquisa de
   Preço) pelo código, além de permitir registrar cotações manuais com rastreabilidade
   (permitidas pela IN 65/2021).
3. **Calcular preço de referência** — média, mediana, desvio padrão, coeficiente de
   variação e descarte de outliers (método IQR).
4. **Montar orçamento** e **exportar .xlsx** padronizado com 3 abas: Orçamento,
   Memória de Cálculo e Metodologia.

## Metodologia legal aplicada

- **Lei 14.133/2021, Art. 23** — pesquisa de preços com preferencialmente no mínimo
  3 fontes de referência.
- **IN SEGES/ME nº 65/2021** — tratamento estatístico: descarte de outliers e
  substituição da média pela mediana quando há grande dispersão.

| Situação | Comportamento |
|---|---|
| Menos de 3 fontes | Resultado *indicativo*, mantém a amostra inteira (a lei pede ≥ 3 fontes) |
| Alta dispersão (CV alto) | Preferir a **mediana** como referência |
| Outliers por IQR | Descartados antes do cálculo; sinalizados na memória de cálculo |

## Subsistemas

### 1. Lógica estatística (`src/estatistica.js`)

Funções puras de cálculo com testes unitários:

```bash
npm test            # roda os testes (Node 18+)
npm run test:watch  # modo watch
```

### 2. Worker proxy (`worker/index.js`)

O GitHub Pages é estático e o navegador **não consegue falar direto** com
`dadosabertos.compras.gov.br` por bloqueio de **CORS**. O worker executa o fetch do
lado do servidor e devolve a resposta com `Access-Control-Allow-Origin: *`.

```bash
# Fazer deploy do worker (requer conta Cloudflare e token)
npx wrangler login
npx wrangler deploy
```

Endpoints:
- `GET /api/pesquisa-preco/material?codigo=<CATMAT>`
- `GET /api/pesquisa-preco/servico?codigo=<CATSER>`

A página (`index.html`) usa a variável `API_BASE_URL` para apontar para o worker, com
fallback para a chamada direta à API caso o worker esteja fora do ar.

## Estrutura

```
├── index.html          # página web (GitHub Pages)
├── worker/
│   └── index.js        # proxy Cloudflare Worker (contorna CORS)
├── wrangler.toml       # config do worker
├── src/
│   └── estatistica.js  # lógica estatística pura
└── test/
    └── estatistica.test.js
```
