# Módulo de Teste — Pesquisa de Preços para Licitações

Módulo **isolado e autossuficiente** para testar a lógica estatística de determinação
de preço de referência em processos licitatórios. Não depende de Supabase, Cloudflare
Workers, APIs externas nem do restante do sistema.

Foi criado de propósito em uma pasta separada (`modulo-teste-precos/`) para não
interferir no projeto atual.

## O que testa

A função `calcularReferencia` recebe uma lista de observações de preço
(`{ preco_unitario, ... }`) e devolve:

- **Média** e **mediana**
- **Desvio padrão** (amostral) e **coeficiente de variação**
- **Descarte de outliers** pelo método do intervalo interquartil (IQR)
- **Método de cálculo escolhido** (`media` ou `mediana`)
- Avisos sobre tamanho insuficiente da amostra
- Sinalização de quais amostras foram consideradas outliers (para memória de cálculo)

## Metodologia legal aplicada

- **Lei 14.133/2021, Art. 23** — pesquisa de preços com preferencialmente no mínimo
  3 fontes de referência.
- **IN SEGES/ME nº 65/2021** — tratamento estatístico: descarte de outliers e
  substituição da média pela mediana quando há grande dispersão.

### Regras implementadas

| Situação | Comportamento |
|---|---|
| Menos de 3 fontes | Resultado *indicativo*, mantém a amostra inteira (a lei pede ≥ 3 fontes) |
| Alta dispersão (CV > 30%, ≥ 5 amostras) | Usa **mediana** como referência |
| Baixa dispersão | Usa **média** como referência |
| Outliers por IQR | Descartados antes do cálculo; contabilizados em `outliers_descartados` |
| < 3 válidas após descarte | Volta à amostra inteira (indicativo) |

## Como executar

```bash
npm test            # roda os testes (Node 18+)
npm run test:watch  # modo watch
```

## Estrutura

```
modulo-teste-precos/
├── package.json
├── src/
│   └── estatistica.js        # funções de cálculo (puro, sem dependências)
└── test/
    └── estatistica.test.js   # testes: <3 fontes, alta dispersão, homogênea, outliers
```
