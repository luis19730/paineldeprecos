/**
 * Funções de cálculo estatístico para determinação do preço de referência.
 *
 * Módulo ISOLADO de teste — não depende de Supabase, Cloudflare ou APIs externas.
 * Recebe listas de preços e devolve o preço de referência tratado estatisticamente.
 *
 * Metodologia (BASE LEGAL):
 *  - Lei 14.133/2021, Art. 23 — pesquisa de preços com preferencialmente no
 *    mínimo 3 fontes de referência.
 *  - IN SEGES/ME nº 65/2021 — tratamento estatístico com descarte de outliers e
 *    substituição da média pela mediana quando há grande dispersão.
 *
 * Regra de outliers: método do intervalo interquartil (IQR).
 * Valores fora de [Q1 - 1.5*IQR, Q3 + 1.5*IQR] são descartados.
 *
 * Regra de dispersão (IN 65): quando o coeficiente de variação (CV) > 30%,
 * usa-se a MEDIANA como referência (mais robusta); caso contrário, a MÉDIA.
 */

/**
 * @param {number[]} arr
 * @returns {number} mediana
 */
export function mediana(arr) {
  if (!arr.length) return NaN;
  const ordenado = [...arr].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2
    ? ordenado[meio]
    : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

/**
 * @param {number[]} arr
 * @returns {number} média aritmética
 */
export function media(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Desvio padrão amostral (Bessel, N-1). Para N===1 retorna 0.
 * @param {number[]} arr
 * @param {number} [m] média pré-calculada
 */
export function desvioPadrao(arr, m) {
  if (arr.length < 2) return 0;
  const mu = m === undefined ? media(arr) : m;
  const variancia = arr.reduce((s, v) => s + (v - mu) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variancia);
}

/**
 * Coeficiente de variação (desvio/média). Retorna null se a média for 0.
 * @param {number} desvio
 * @param {number} mediaValor
 */
export function coeficienteVariacao(desvio, mediaValor) {
  if (!mediaValor || mediaValor === 0) return null;
  return desvio / Math.abs(mediaValor);
}

/**
 * Quartis Q1 e Q3 (método "inclusive" / Tukey).
 */
function quartis(arr) {
  const ordenado = [...arr].sort((a, b) => a - b);
  return {
    q1: mediana(ordenado.slice(0, Math.ceil(ordenado.length / 2))),
    q3: mediana(ordenado.slice(Math.floor(ordenado.length / 2))),
  };
}

/**
 * Identifica os índices de outliers por IQR.
 * @param {number[]} valores
 * @returns {{ indices: number[], limites: {inferior:number,superior:number}|null }}
 */
export function identificarOutliers(valores) {
  if (valores.length < 4) return { indices: [], limites: null };
  const { q1, q3 } = quartis(valores);
  const iqr = q3 - q1;
  const inferior = q1 - 1.5 * iqr;
  const superior = q3 + 1.5 * iqr;
  return {
    indices: valores
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => v < inferior || v > superior)
      .map(({ i }) => i),
    limites: { inferior, superior },
  };
}

/**
 * Calcula o preço de referência completo com tratamento estatístico.
 *
 * @param {Array<{ preco_unitario: number, [k:string]: any }>} amostras observações de preço
 * @returns {object} { preco_referencia, metodo_calculo, media, mediana, desvio_padrao,
 *                     coeficiente_variacao, outliers_descartados, amostras_usadas, aviso,
 *                     limites_outliers }
 */
export function calcularReferencia(amostras) {
  if (!amostras || !amostras.length) {
    return {
      preco_referencia: null,
      metodo_calculo: null,
      media: null,
      mediana: null,
      desvio_padrao: null,
      coeficiente_variacao: null,
      outliers_descartados: 0,
      amostras_usadas: 0,
      aviso: 'Sem amostras válidas.',
    };
  }

  let valores = amostras.map((a) => Number(a.preco_unitario));
  const { indices, limites } = identificarOutliers(valores);

  // Campos que marcam os outliers na amostra original.
  amostras = amostras.map((a, i) => ({
    ...a,
    outlier: indices.includes(i),
  }));

  let outliersDescartados = indices.length;

  // IN 65/2021: com menos de 3 amostras válidas após descarte, usa a amostra inteira
  // (resultado apenas indicativo, pois a lei pede no mínimo 3 fontes).
  let aviso = null;
  let amostrasUsadas = valores.length - outliersDescartados;
  if (amostrasUsadas < 3) {
    if (outliersDescartados > 0) {
      valores = amostras.map((a) => Number(a.preco_unitario));
      amostras = amostras.map((a) => ({ ...a, outlier: false }));
      outliersDescartados = 0;
      amostrasUsadas = valores.length;
      aviso =
        'Menos de 3 amostras válidas após descarte de outliers; usada a amostra inteira (resultado apenas indicativo).';
    } else {
      aviso =
        'Amostra com menos de 3 fontes; abaixo do recomendado pela Lei 14.133/2021, Art. 23. Resultado indicativo.';
    }
  } else {
    valores = valores.filter((_, i) => !indices.includes(i));
  }

  const mediaValor = media(valores);
  const medianaValor = mediana(valores);
  const dpValor = desvioPadrao(valores, mediaValor);
  const cvValor = coeficienteVariacao(dpValor, mediaValor);
  const usarMediana = cvValor !== null && cvValor > 0.3 && valores.length >= 5;

  return {
    preco_referencia: usarMediana ? medianaValor : mediaValor,
    metodo_calculo: usarMediana ? 'mediana' : 'media',
    media: mediaValor,
    mediana: medianaValor,
    desvio_padrao: dpValor,
    coeficiente_variacao: cvValor,
    outliers_descartados: outliersDescartados,
    amostras_usadas: amostrasUsadas,
    limites_outliers: limites,
    aviso,
    // Amostras com flag `outlier` para memória de cálculo.
    amostras: amostras,
  };
}

export default { mediana, media, desvioPadrao, coeficienteVariacao, identificarOutliers, calcularReferencia };
