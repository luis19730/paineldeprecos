import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mediana,
  media,
  desvioPadrao,
  coeficienteVariacao,
  identificarOutliers,
  calcularReferencia,
} from '../src/estatistica.js';

/** Constrói observações de preço a partir de um array de valores. */
function amostras(vals) {
  return vals.map((v, i) => ({
    id: i,
    preco_unitario: v,
    orgao: `Órgão ${i + 1}`,
    data_homologacao: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
  }));
}

// ------------------------------------------------------------------
// Funções primitivas
// ------------------------------------------------------------------
test('mediana de lista ímpar', () => {
  assert.equal(mediana([1, 3, 5]), 3);
});
test('mediana de lista par', () => {
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
});
test('media básica', () => {
  assert.equal(media([10, 20, 30]), 20);
});
test('desvioPadrao homogêneo (zeros)', () => {
  assert.equal(desvioPadrao([5, 5, 5]), 0);
});
test('coeficienteVariacao com media zero retorna null', () => {
  assert.equal(coeficienteVariacao(0, 0), null);
});
test('coeficienteVariacao correto', () => {
  assert.equal(coeficienteVariacao(2, 10), 0.2);
});

// ------------------------------------------------------------------
// Caso 1: POUCAS AMOSTRAS (<3 fontes)
// ------------------------------------------------------------------
test('caso <3 fontes: resultado indicativo e sem descarte', () => {
  const resultado = calcularReferencia(amostras([10, 12]));
  assert.equal(resultado.preco_referencia, 11);
  assert.equal(resultado.outliers_descartados, 0);
  assert.equal(resultado.amostras_usadas, 2);
  assert.ok(resultado.aviso, 'deve haver aviso sobre menos de 3 fontes');
});

test('menos de 3 fontes usa toda a amostra mesmo se houver outlier aparente', () => {
  // 3 valores, um deles bem discrepante: após descarte sobrariam <3.
  const resultado = calcularReferencia(amostras([8, 9, 100]));
  // Como sobraria apenas 2, volta a usar a amostra inteira.
  assert.equal(resultado.outliers_descartados, 0);
  assert.equal(resultado.amostras_usadas, 3);
});

// ------------------------------------------------------------------
// Caso 2: ALTA DISPERSÃO (CV > 30%)
// ------------------------------------------------------------------
test('alta dispersão → usa mediana como referência', () => {
  // Distribuição com alta dispersão (CV > 30%), sem outliers formais explícitos:
  // valores espalhados uniformemente num intervalo largo.
  const valores = [15, 10, 40, 20, 35, 12, 30, 45, 18, 25, 42, 28];
  const resultado = calcularReferencia(valores.map((v, i) => ({ id: i, preco_unitario: v })));
  assert.equal(resultado.metodo_calculo, 'mediana');
  // Referência = mediana (robusta a dispersão).
  assert.equal(resultado.preco_referencia, mediana(valores));
});

test('alta dispersão com outliers → descarta outliers antes de decidir', () => {
  // 1000 e 5000 são outliers claros; após descarte a amostra fica homogênea → média.
  const valores = [100, 102, 105, 99, 101, 104, 98, 103, 106, 107, 1000, 5000];
  const obs = valores.map((v, i) => ({ id: i, preco_unitario: v }));
  const resultado = calcularReferencia(obs);
  assert.ok(
    resultado.outliers_descartados > 0,
    'deve descartar valores atípicos (1000 e 5000)'
  );
  // Após descartar os outliers, os valores restantes são homogêneos → média.
  assert.equal(resultado.metodo_calculo, 'media');
  // O preço de referência deve ignorar os outliers.
  assert.ok(resultado.preco_referencia < 500);
});

// ------------------------------------------------------------------
// Caso 3: AMOSTRA HOMOGÊNEA (baixa dispersão)
// ------------------------------------------------------------------
test('amostra homogênea → usa média e não descarta outliers', () => {
  const valores = [9.8, 10.1, 9.9, 10.2, 10.0, 9.7, 10.3, 10.0, 9.9, 10.1];
  const resultado = calcularReferencia(amostras(valores));
  assert.equal(resultado.metodo_calculo, 'media');
  assert.equal(resultado.outliers_descartados, 0);
  assert.equal(resultado.preco_referencia, media(valores));
});

// ------------------------------------------------------------------
// Comportamento de outliers por IQR (função pura)
// ------------------------------------------------------------------
test('identificarOutliers marca valores fora do intervalo IQR', () => {
  const valores = [10, 11, 12, 13, 14, 15, 16, 17, 100];
  const { indices } = identificarOutliers(valores);
  assert.deepEqual(indices, [8]); // apenas o 100
});

test('identificarOutliers não marca nada em amostra homogênea', () => {
  const valores = [10, 10.1, 9.9, 10.2, 10, 9.8];
  assert.deepEqual(identificarOutliers(valores).indices, []);
});

test('identificarOutliers retorna vazio com menos de 4 amostras', () => {
  assert.deepEqual(identificarOutliers([1, 2, 3]).indices, []);
});

// ------------------------------------------------------------------
// Memória de cálculo: sinalização dos outliers na amostra
// ------------------------------------------------------------------
test('calcularReferencia sinaliza outlier em amostras', () => {
  const obs = amostras([10, 11, 12, 13, 14, 15, 16, 17, 100, 19, 20, 21]);
  const resultado = calcularReferencia(obs);
  const marcado = resultado.amostras.find((a) => a.preco_unitario === 100);
  assert.ok(marcado.outlier, 'o valor 100 deve estar marcado como outlier');
});
