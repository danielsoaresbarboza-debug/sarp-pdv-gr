// Baixa METAR/TAF dos aeródromos do app e grava em wx/ICAO.json (o app lê de lá, sem CORS e sem expor a chave).
// Fonte 1: REDEMET (chave em REDEMET_API_KEY, guardada como Secret do GitHub). Fonte 2: AviationWeather.gov.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bloco = html.slice(html.indexOf('const AERODROMOS'), html.indexOf('];', html.indexOf('const AERODROMOS')));
const icaos = [...new Set([...bloco.matchAll(/\["(S[A-Z]{3})"/g)].map(m => m[1]))];
const KEY = process.env.REDEMET_API_KEY || '';
const pad = n => String(n).padStart(2, '0');
const fmtZ = d => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours());
const esperar = ms => new Promise(r => setTimeout(r, ms));
const pick = j => { const L = (j && j.data && (j.data.data || j.data)) || []; const a = Array.isArray(L) ? L.slice() : []; a.sort((x, y) => String(y.validade_inicial || '').localeCompare(String(x.validade_inicial || ''))); return a[0] ? (a[0].mens || a[0].message || '') : ''; };
async function json(url) { const r = await fetch(url, { headers: { 'user-agent': 'sarp-pdv-gr-wx' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
let falhaLogada = false;
async function redemet(icao) {
  if (!KEY) throw new Error('sem chave');
  const bases = ['https://api-redemet.decea.gov.br', 'https://api-redemet.decea.mil.br'];
  const ini = fmtZ(new Date(Date.now() - 6 * 3600e3)), fim = fmtZ(new Date());
  const tenta = async (tipo) => {
    for (const base of bases) for (const q of [`?api_key=${KEY}`, `?api_key=${KEY}&data_ini=${ini}&data_fim=${fim}`]) {
      try { const t = pick(await json(`${base}/mensagens/${tipo}/${icao}${q}`)); if (t) return t; }
      catch (e) { if (!falhaLogada) { falhaLogada = true; console.log(`REDEMET ${base} ${tipo} ${icao}: ${e.message}`); } }
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
console.log(`aeródromos: ${icaos.length} · com METAR: ${ok} · atualizados: ${mudou}`);
if (!ok) { console.error('Nenhuma fonte respondeu.'); process.exit(1); }
