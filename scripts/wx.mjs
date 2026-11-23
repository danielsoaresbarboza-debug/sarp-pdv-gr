// Baixa METAR/TAF dos aeródromos do app e grava em wx/ICAO.json (o app lê de lá, sem CORS e sem expor a chave).
// Fonte 1: REDEMET (chave em REDEMET_API_KEY, guardada como Secret do GitHub). Fonte 2: AviationWeather.gov.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bloco = html.slice(html.indexOf('const AERODROMOS'), html.indexOf('];', html.indexOf('const AERODROMOS')));
const icaos = [...new Set([...bloco.matchAll(/\["(S[A-Z]{3})"/g)].map(m => m[1]))];
const KEY0 = (process.env.REDEMET_API_KEY || '').replace(/\s+/g, '');
let KEY = KEY0;
// I maiúsculo e l minúsculo se confundem ao copiar: testa as variações e usa a que a REDEMET aceitar.
async function escolheChave() {
  if (!KEY0) return;
  const pos = [...KEY0].map((c, i) => 'Il'.includes(c) ? i : -1).filter(i => i >= 0);
  const cands = new Set([KEY0]);
  for (let m = 0; m < (1 << Math.min(pos.length, 6)); m++) { const a = [...KEY0]; pos.slice(0, 6).forEach((p, j) => { a[p] = (m >> j) & 1 ? 'I' : 'l'; }); cands.add(a.join('')); }
  for (const k of cands) {
    try { const r = await fetch('https://api-redemet.decea.gov.br/mensagens/metar/SBBR', { headers: { 'X-Api-Key': k, 'user-agent': 'sarp-pdv-gr-wx' } }); diag.teste_chave = (diag.teste_chave || []).concat(r.status); if (r.ok) { KEY = k; diag.chave_ok = true; return; } } catch (e) { diag.teste_chave = (diag.teste_chave || []).concat(String(e.message)); }
  }
}
const pad = n => String(n).padStart(2, '0');
const fmtZ = d => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours());
const esperar = ms => new Promise(r => setTimeout(r, ms));
const pick = j => { const L = (j && j.data && (j.data.data || j.data)) || []; const a = Array.isArray(L) ? L.slice() : []; a.sort((x, y) => String(y.validade_inicial || '').localeCompare(String(x.validade_inicial || ''))); return a[0] ? (a[0].mens || a[0].message || '') : ''; };
const diag = { chave_presente: !!KEY0, tamanho_chave: KEY0.length, tentativas: [] };
async function json(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': 'sarp-pdv-gr-wx', ...headers } });
  const txt = await r.text();
  if (diag.tentativas.length < 12) diag.tentativas.push({ url: url.replace(KEY, '***'), http: r.status, trecho: txt.slice(0, 200).replace(KEY, '***') });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return JSON.parse(txt);
}
async function redemet(icao) {
  if (!KEY) throw new Error('sem chave');
  const bases = ['https://api-redemet.decea.gov.br', 'https://api-redemet.decea.mil.br'];
  const ini = fmtZ(new Date(Date.now() - 6 * 3600e3)), fim = fmtZ(new Date());
  const tenta = async (tipo) => {
    for (const base of bases) for (const [q, h] of [
      [`?api_key=${KEY}`, {}], [`?api_key=${KEY}&data_ini=${ini}&data_fim=${fim}`, {}],
      ['', { 'X-Api-Key': KEY }], [`?data_ini=${ini}&data_fim=${fim}`, { 'X-Api-Key': KEY }]]) {
      try { const t = pick(await json(`${base}/mensagens/${tipo}/${icao}${q}`, h)); if (t) return t; } catch (e) {}
    }
    return '';
  };
  const metar = await tenta('metar');
  if (!metar) throw new Error('sem METAR');
  return { metar, taf: await tenta('taf'), fonte: 'REDEMET' };
}
let awc = null;
async function aviationweather(icao) {
  if (!awc) {
    const ids = icaos.join(',');
    const m = await json(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json`).catch(() => []);
    const t = await json(`https://aviationweather.gov/api/data/taf?ids=${ids}&format=json`).catch(() => []);
    awc = { m: Object.fromEntries((m || []).map(x => [x.icaoId, x.rawOb])), t: Object.fromEntries((t || []).map(x => [x.icaoId, x.rawTAF])) };
  }
  return { metar: awc.m[icao] || '', taf: awc.t[icao] || '', fonte: 'AviationWeather' };
}
fs.mkdirSync(new URL('../wx/', import.meta.url), { recursive: true });
await escolheChave();
let mudou = 0, ok = 0;
for (const icao of icaos) {
  let r = null;
  try { r = await redemet(icao); } catch (e) { r = null; }
  if (!r || !r.metar) { try { r = await aviationweather(icao); } catch (e) { r = null; } }
  await esperar(KEY ? 1200 : 0);
  if (!r || !r.metar) continue; ok++;
  const arq = new URL(`../wx/${icao}.json`, import.meta.url); let ant = null;
  try { ant = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) {}
  if (ant && ant.metar === r.metar && ant.taf === (r.taf || ant.taf)) continue;
  fs.writeFileSync(arq, JSON.stringify({ icao, metar: r.metar, taf: r.taf || (ant && ant.taf) || '', fonte: r.fonte, gerado: new Date().toISOString() }) + '\n'); mudou++;
}
diag.gerado = new Date().toISOString(); fs.writeFileSync(new URL('../wx/DIAGNOSTICO.json', import.meta.url), JSON.stringify(diag, null, 1) + '\n');
console.log(`aeródromos: ${icaos.length} · com METAR: ${ok} · atualizados: ${mudou}`);
if (!ok) { console.error('Nenhuma fonte respondeu.'); process.exit(1); }
