/**
 * Proxy Cloudflare Worker para consultar a API do Compras.gov.br (Módulo Pesquisa
 * de Preço) sem bloqueio de CORS.
 *
 * O GitHub Pages serve a página estática que roda no navegador. Ao tentar falar
 * direto com https://dadosabertos.compras.gov.br, a API pública não envia os
 * cabeçalhos CORS necessários, então o navegador bloqueia a resposta.
 *
 * Este Worker executa o fetch do LADO DO SERVIDOR (sem restrição de CORS) e
 * devolve a resposta com cabeçalho `access-control-allow-origin: *`.
 *
 * Endpoints expostos:
 *   GET /api/pesquisa-preco/material?codigo=<CATMAT>
 *   GET /api/pesquisa-preco/servico?codigo=<CATSER>
 *
 * Todas as respostas carregam `Access-Control-Allow-Origin: *`.
 */

const DADOS_ABERTOS_BASE_URL = globalThis.DADOS_ABERTOS_BASE_URL || 'https://dadosabertos.compras.gov.br';

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Preflight OPTIONS (CORS).
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return json(JSON.stringify({ erro: 'Método não permitido.' }), 405);
    }

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
    // Referência: https://dadosabertos.compras.gov.br
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

      // Reenvia a resposta original adicionando os cabeçalhos CORS.
      return new Response(resp.body, {
        status: resp.status,
        headers: {
          'Content-Type': resp.headers.get('Content-Type') || 'application/json',
          ...CORS_HEADERS,
        },
      });
    } catch (err) {
      return json(
        JSON.stringify({ erro: 'Falha ao consultar o Compras.gov.br.', detalhe: String(err && err.message) }),
        502
      );
    }
  },
};
