# Painel de Preços para Licitações

Ferramenta de pesquisa de preços e padronização de orçamentos para embasar processos
licitatórios, conforme a **Lei 14.133/2021 (Art. 23)** e a **IN SEGES/ME nº 65/2021**.

- **Página (GitHub Pages):** https://luis19730.github.io/paineldeprecos/
- **Proxy Worker (Cloudflare):** https://painel-precos-licitacoes.luis19730.workers.dev

## O que faz

1. **Identificar o item** — código CATMAT/CATSER, descrição, unidade e quantidade no
   orçamento, com autocomplete na API oficial.
2. **Buscar preços** ao vivo na **API oficial do Compras.gov.br** (Módulo Pesquisa de
   Preço) pelo código, além de permitir registrar cotações manuais com rastreabilidade
   (permitidas pela IN 65/2021).
3. **Analisar a amostra** — cards de resultado (menor, maior, mediana, média, outliers)
   com alertas de qualidade baseados em regras reais da IN 65/2021.
4. **Explorar os registros** — filtros por texto/UF/fonte, ordenação por coluna,
   paginação 25/50/100 e detalhes expansíveis de cada contratação.
5. **Calcular preço de referência** — média, mediana, desvio padrão, coeficiente de
   variação e descarte de outliers (método IQR).
6. **Montar orçamento** — itens com quantidade editável, persistido automaticamente no
   navegador (`localStorage`).
7. **Exportar** — planilha `.xlsx` padronizada com 3 abas (Orçamento, Memória de Cálculo
   e Metodologia) ou `.csv` analítico dos dados coletados.

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
| Registro mais recente com mais de 2 anos | Alerta para verificar se os preços refletem o mercado |
| Unidade divergente | Alerta para conferência antes do uso |

## Segurança e qualidade

- **XSS:** todos os dados externos (API, cotações manuais) são escapados antes de
  qualquer interpolação em HTML (`esc()`).
- **Performance:** debounce de 120 ms no filtro textual da tabela.
- **Responsividade:** layout adaptado a telas estreitas (tabela com rolagem horizontal).
- **Testes:** `npm test` (15 testes unitários da estatística) + suíte de harnesses
  jsdom que validam o comportamento da página de ponta a ponta.

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
- `GET /api/catalogo?q=<texto>&tipo=<material|servico>` (autocomplete)
- `GET /api/catalogo/item?codigo=<codigo>&tipo=<material|servico>` (detalhe do item)
- `GET /api/pesquisa-preco/<tipo>/csv?codigo=<codigo>` (CSV no padrão Painel de Preços)

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
├── test/
│   └── estatistica.test.js
└── package.json
```