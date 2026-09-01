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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return json(JSON.stringify({ erro: 'Método não permitido.' }), 405);
    }

    if (url.pathname.startsWith('/api/pesquisa-preco/')) {
      return handlePesquisaPreco(url);
    }
    if (url.pathname === '/api/catalogo') {
      return handleCatalogo(url);
    }

    return json(
      JSON.stringify({
        erro: 'Rota não encontrada. Use /api/pesquisa-preco/material|servico?codigo=... ou /api/catalogo?q=...',
      }),
      404
    );
  },
};
