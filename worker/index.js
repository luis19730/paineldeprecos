/**
 * Proxy Cloudflare Worker para consultar APIs públicas de preços e catálogo
 * sem bloqueio de CORS.
 *
 * O GitHub Pages serve a página estática que roda no navegador. Ao tentar falar
 * direto com https://dadosabertos.compras.gov.br (e demais APIs públicas), elas
 * não enviam os cabeçalhos CORS necessários; este Worker executa o fetch do
 * LADO DO SERVIDOR e devolve a resposta com `Access-Control-Allow-Origin: *`.
 *
 * Endpoints expostos (todas as respostas carregam CORS *):
 *   GET /api/pesquisa-preco/material?codigo=<CATMAT>
 *   GET /api/pesquisa-preco/servico?codigo=<CATSER>
 *   GET /api/catalogo?q=<termo|codigo>        -> autocomplete de itens do CATMAT
 */

const DADOS_ABERTOS_BASE_URL = globalThis.DADOS_ABERTOS_BASE_URL || 'https://dadosabertos.compras.gov.br';
// API do catálogo CATMAT com busca textual funcional (intermediário que indexa
// os dados oficiais do governo). Usada porque o filtro textual da API oficial do
// Compras.gov.br está quebrado desde meados de 2026 (ignora o termo digitado).
const CATMAT_SEARCH_BASE_URL = 'https://catmat.com.br/api/v1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

function json(res, status, extra = {}) {
  return new Response(res, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extra },
  });
}

/** Reenvia a resposta upstream adicionando CORS. */
function proxied(resp) {
  return new Response(resp.body, {
    status: resp.status,
    headers: {
      'Content-Type': resp.headers.get('Content-Type') || 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/** Endpoint de preços praticados (Compras.gov.br). */
async function handlePesquisaPreco(url) {
  const match = url.pathname.match(/^\/api\/pesquisa-preco\/(material|servico)$/);
  if (!match) {
    return json(JSON.stringify({ erro: 'Rota não encontrada. Use /api/pesquisa-preco/material|servico?codigo=...' }), 404);
  }
  const tipo = match[1];
  const codigo = (url.searchParams.get('codigo') || '').trim();
  if (!codigo) {
    return json(JSON.stringify({ erro: 'Parâmetro "codigo" é obrigatório.' }), 400);
  }

  // IMPORTANTE — quebra conhecida da API (2026-07→08): a SEGES trocou a assinatura
  // de query da rota de MATERIAL (1_consultarMaterial): o parâmetro
  // `codigoItemCatalogo` foi substituído por `tipo=codigoItemCatalogo` + `codigo`.
  // A rota de SERVIÇO (3_consultarServico) NÃO mudou e ainda usa `codigoItemCatalogo`.
  let apiUrl;
  if (tipo === 'material') {
    apiUrl =
      DADOS_ABERTOS_BASE_URL +
      '/modulo-pesquisa-preco/1_consultarMaterial' +
      '?tipo=codigoItemCatalogo&codigo=' +
      encodeURIComponent(codigo) +
      '&tamanhoPagina=100&pagina=1';
  } else {
    apiUrl =
      DADOS_ABERTOS_BASE_URL +
      '/modulo-pesquisa-preco/3_consultarServico' +
      '?codigoItemCatalogo=' +
      encodeURIComponent(codigo) +
      '&tamanhoPagina=100&pagina=1';
  }

  try {
    const resp = await fetch(apiUrl, {
      headers: { accept: 'application/json', 'user-agent': 'painel-precos-licitacoes/0.1' },
    });
    if (!resp.ok) {
      const text = await resp.text();
      return json(
        JSON.stringify({ erro: `A API do Compras.gov.br respondeu com status ${resp.status}.`, detalhe: text }),
        resp.status
      );
    }
    return proxied(resp);
  } catch (err) {
    return json(
      JSON.stringify({ erro: 'Falha ao consultar o Compras.gov.br.', detalhe: String(err && err.message) }),
      502
    );
  }
}

/** Agrega estatísticas de mercado (referência externa) de um CATMAT/CATSER. */
async function handleMercado(url) {
  const match = url.pathname.match(/^\/api\/pesquisa-preco\/(material|servico)\/mercado$/);
  if (!match) return json(JSON.stringify({ erro: 'Rota inválida.' }), 404);
  const tipo = match[1];
  const codigo = (url.searchParams.get('codigo') || '').trim();
  if (!codigo) return json(JSON.stringify({ erro: 'Parâmetro "codigo" é obrigatório.' }), 400);

  // Número máximo de páginas (100 registros cada) para não estourar o plano grátis
  // do worker. 5 páginas = até 500 amostras, suficiente para uma mediana robusta.
  const MAX_PAGINAS = 5;

  let precoBase;
  let qsBase;
  if (tipo === 'material') {
    precoBase =
      DADOS_ABERTOS_BASE_URL + '/modulo-pesquisa-preco/1_consultarMaterial';
    qsBase = 'tipo=codigoItemCatalogo&codigo=' + encodeURIComponent(codigo) + '&tamanhoPagina=100&';
  } else {
    precoBase =
      DADOS_ABERTOS_BASE_URL + '/modulo-pesquisa-preco/3_consultarServico';
    qsBase = 'codigoItemCatalogo=' + encodeURIComponent(codigo) + '&tamanhoPagina=100&';
  }

  const valores = [];
  let totalRegistros = 0;
  let paginasRestantes = Infinity;
  let pagina = 1;

  try {
    while (pagina <= MAX_PAGINAS && paginasRestantes > 0) {
      const resp = await fetch(precoBase + '?' + qsBase + 'pagina=' + pagina, {
        headers: { accept: 'application/json', 'user-agent': 'painel-precos-licitacoes/0.1' },
      });
      if (!resp.ok) {
        return json(
          JSON.stringify({
            erro: `A API do Compras.gov.br respondeu com status ${resp.status} na página ${pagina}.`,
          }),
          resp.status
        );
      }
      const data = await resp.json();
      const lista = Array.isArray(data.resultado) ? data.resultado : [];
      lista.forEach((r) => {
        const v = Number(r.precoUnitario);
        if (Number.isFinite(v) && v > 0) valores.push(v);
      });
      if (data.totalRegistros !== undefined) totalRegistros = data.totalRegistros;
      if (data.paginasRestantes !== undefined) paginasRestantes = Number(data.paginasRestantes);
      else paginasRestantes = lista.length < 100 ? 0 : paginasRestantes - 1;
      pagina++;
    }

    if (!valores.length) {
      return json(JSON.stringify({ itens: [], medianaMercado: null, totalRegistros }), 200);
    }

    const sorted = [...valores].sort((a, b) => a - b);
    const mediana = quartil(sorted, 0.5);
    const media = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const dp = valores.length > 1
      ? Math.sqrt(valores.reduce((a, b) => a + Math.pow(b - media, 2), 0) / (valores.length - 1))
      : 0;
    const cv = media ? (dp / media) * 100 : 0;

    return json(
      JSON.stringify({
        itens: valores.length,
        totalRegistros,
        medianaMercado: mediana,
        mediaMercado: media,
        min: min,
        max: max,
        desvioPadrao: dp,
        cv: cv,
        // Usa-se a mediana como referência externa (robusta a outliers).
        referenciaMercado: mediana,
      }),
      200
    );
  } catch (err) {
    return json(
      JSON.stringify({ erro: 'Falha ao consultar o mercado.', detalhe: String(err && err.message) }),
      502
    );
  }
}

function quartil(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

/** Endpoint de autocomplete do catálogo CATMAT (descrição ou código). */
async function handleCatalogo(url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    return json(JSON.stringify({ erro: 'Parâmetro "q" é obrigatório.' }), 400);
  }

  const ehCodigo = /^\d{6}$/.test(q);
  try {
    if (ehCodigo) {
      // Busca exata por código CATMAT.
      const resp = await fetch(`${CATMAT_SEARCH_BASE_URL}/item/${encodeURIComponent(q)}`, {
        headers: { accept: 'application/json' },
      });
      if (!resp.ok) {
        return json(JSON.stringify({ itens: [], aviso: 'Item não encontrado para o código informado.' }), 200);
      }
      const item = await resp.json();
      return json(
        JSON.stringify({
          itens: [
            {
              codigo_item: item.codigo_item,
              descricao_item: item.descricao_item,
              nome_grupo: item.nome_grupo,
              nome_pdm: item.nome_pdm,
            },
          ],
        }),
        200
      );
    }

    // Busca textual.
    const resp = await fetch(
      `${CATMAT_SEARCH_BASE_URL}/search?q=${encodeURIComponent(q)}&size=10`,
      { headers: { accept: 'application/json' } }
    );
    if (!resp.ok) {
      return json(JSON.stringify({ erro: `catmat.com.br respondeu status ${resp.status}.` }), resp.status);
    }
    const data = await resp.json();
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const itens = hits.map((h) => ({
      codigo_item: h.codigo_item,
      descricao_item: h.descricao_item,
      nome_grupo: h.nome_grupo,
      nome_pdm: h.nome_pdm,
    }));
    return json(JSON.stringify({ itens }), 200);
  } catch (err) {
    return json(
      JSON.stringify({ erro: 'Falha ao consultar o catálogo CATMAT.', detalhe: String(err && err.message) }),
      502
    );
  }
}

/** Resolve o codigoPdm de um item usando a API oficial (fallback: catmat.com.br). */
async function codigoPdmDoItem(codigo, itemCatmat) {
  try {
    const qs = `codigoItem=${encodeURIComponent(codigo)}&pagina=1&tamanhoPagina=1`;
    const resp = await fetch(`${DADOS_ABERTOS_BASE_URL}/modulo-material/4_consultarItemMaterial?${qs}`, {
      headers: { accept: 'application/json' },
    });
    if (resp.ok) {
      const data = await resp.json();
      const item = (data.resultado || [])[0];
      if (item && item.codigoPdm) {
        return {
          pdm: item.codigoPdm,
          descricao: item.descricaoItem,
          nomePdm: item.nomePdm,
        };
      }
    }
  } catch (e) {
    /* fallback abaixo */
  }
  // Fallback: catmat.com.br expõe codigo_pdm.
  if (itemCatmat && itemCatmat.codigo_pdm) {
    return { pdm: itemCatmat.codigo_pdm, descricao: itemCatmat.descricao_item };
  }
  return null;
}

/** Consulta as unidades de fornecimento de um item pelo PDM (fonte oficial). */
async function unidadesPorPdm(pdm) {
  try {
    const qs = `codigoPdm=${encodeURIComponent(pdm)}&pagina=1&tamanhoPagina=100`;
    const resp = await fetch(
      `${DADOS_ABERTOS_BASE_URL}/modulo-material/6_consultarMaterialUnidadeFornecimento?${qs}`,
      { headers: { accept: 'application/json' } }
    );
    if (resp.ok) {
      const data = await resp.json();
      const lista = (data.resultado || []);
      return lista
        .filter((u) => u.statusUnidadeFornecimento)
        .map((u) => ({
          sigla: u.siglaUnidadeFornecimento,
          nome: u.nomeUnidadeFornecimento,
          siglaMedida: u.siglaUnidadeMedida,
          capacidade: u.capacidadeUnidadeFornecimento,
        }));
    }
  } catch (e) {
    /* retorna vazio */
  }
  return [];
}

/** Endpoint que entrega o item completo (descrição + unidade de fornecimento). */
async function handleItemCompleto(url) {
  const codigo = (url.searchParams.get('codigo') || '').trim();
  if (!/^\d{6}$/.test(codigo)) {
    return json(JSON.stringify({ erro: 'Informe um código de 6 dígitos.' }), 400);
  }

  // 1) Descrição via catmat (rápida e sem filtro textual quebrado).
  let itemCatmat = null;
  try {
    const resp = await fetch(`${CATMAT_SEARCH_BASE_URL}/item/${encodeURIComponent(codigo)}`, {
      headers: { accept: 'application/json' },
    });
    if (resp.ok) itemCatmat = await resp.json();
  } catch (e) { /* segue sem */ }

  // 2) PDM pela API oficial (fallback para catmat).
  let pdmInfo = await codigoPdmDoItem(codigo, itemCatmat);
  // Se a oficial falhou mas a catmat tem codigo_pdm, já foi resolvido no fallback.

  // 3) Unidades de fornecimento pelo PDM.
  let unidades = [];
  if (pdmInfo && pdmInfo.pdm) {
    unidades = await unidadesPorPdm(pdmInfo.pdm);
  }

  const descricao =
    (pdmInfo && pdmInfo.descricao) ||
    (itemCatmat && itemCatmat.descricao_item) ||
    '';
  const nomePdm = (pdmInfo && pdmInfo.nomePdm) || (itemCatmat && itemCatmat.nome_pdm) || '';

  // Unidade preferencial: a primeira disponível; senão null.
  const unidade = unidades.length ? unidades[0].nome : null;

  return json(
    JSON.stringify({
      codigo,
      descricao,
      nomePdm,
      codigoPdm: pdmInfo ? pdmInfo.pdm : null,
      unidade,
      unidades,
    }),
    200
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return json(JSON.stringify({ erro: 'Método não permitido.' }), 405);
    }

    if (url.pathname.match(/^\/api\/pesquisa-preco\/(material|servico)\/mercado$/)) {
      return handleMercado(url);
    }
    if (url.pathname.startsWith('/api/pesquisa-preco/')) {
      return handlePesquisaPreco(url);
    }
    if (url.pathname === '/api/catalogo') {
      return handleCatalogo(url);
    }
    if (url.pathname === '/api/catalogo/item') {
      return handleItemCompleto(url);
    }

    return json(
      JSON.stringify({
        erro: 'Rota não encontrada. Use /api/pesquisa-preco/material|servico?codigo=... ou /api/catalogo?q=...',
      }),
      404
    );
  },
};
