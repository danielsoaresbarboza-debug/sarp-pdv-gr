// Baixa NOTAM do AISWEB (DECEA) para os aeródromos do app e grava notam/NOTAM.json (o app lê de lá).
// ATENÇÃO: o formato da API do AISWEB NÃO foi verificado aqui. O script é defensivo e grava notam/DIAGNOSTICO.json
// com o que recebeu, para ajustar depois. Sem chave (AISWEB_API_KEY + AISWEB_API_PASS) ele só registra o diagnóstico.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bloco = html.slice(html.indexOf('const AERODROMOS'), html.indexOf('];', html.indexOf('const AERODROMOS')));
const icaos = [...new Set([...bloco.matchAll(/\["(S[A-Z]{3})"/g)].map(m => m[1]))];
const KEY = (process.env.AISWEB_API_KEY || '').trim(), PASS = (process.env.AISWEB_API_PASS || '').trim();
const diag = { chave_presente: !!KEY && !!PASS, icaos: icaos.length, tentativas: [], erros: [] };
const out = { atualizado: new Date().toISOString(), fonte: 'AISWEB/DECEA', itens: [] };
const tag = (x, t) => { const m = x.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>', 'i')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''; };
// Linha Q do NOTAM: Q) FIR/QCODE/TRAF/PURP/SCOPE/PISO/TETO/1535S04756W005  (coordenada + raio em NM)
function linhaQ(txt) {
  const q = (txt.match(/Q\)\s*([^\n]+)/) || [])[1]; if (!q) return {};
  const p = q.split('/').map(s => s.trim()); const c = (p[7] || '').match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})?/); if (!c) return {};
  const lat = (+c[1] + +c[2] / 60) * (c[3] === 'S' ? -1 : 1), lon = (+c[4] + +c[5] / 60) * (c[6] === 'W' ? -1 : 1);
  const fl = v => (/^\d{3}$/.test(v || '') ? Math.round(+v * 30.48) : 0); // nível de voo (centenas de pés) → metros
  return { lat: +lat.toFixed(4), lon: +lon.toFixed(4), raioNm: c[7] ? +c[7] : 1, piso: fl(p[5]), teto: fl(p[6]) };
}
const dt = s => { const m = (s || '').match(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/); return m ? `20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : ''; };
fs.mkdirSync(new URL('../notam/', import.meta.url), { recursive: true });
if (KEY && PASS) {
  const vistos = new Set();
  for (const icao of icaos) {
    try {
      const url = `https://aisweb.decea.mil.br/api/?apiKey=${KEY}&apiPass=${PASS}&area=notam&icaoCode=${icao}`;
      const r = await fetch(url, { headers: { 'user-agent': 'sarp-pdv-gr-notam' } }); const t = await r.text();
      if (diag.tentativas.length < 8) diag.tentativas.push({ icao, http: r.status, trecho: t.slice(0, 300).replace(KEY, '***').replace(PASS, '***') });
      if (!r.ok) continue;
      for (const bl of t.split(/<item>/i).slice(1)) {
        const txt = tag(bl, 'e') || tag(bl, 'texto') || tag(bl, 'message') || bl; const id = tag(bl, 'n') || tag(bl, 'numero') || ((txt.match(/([A-Z]\d{4}\/\d{2})/) || [])[1]) || '';
        if (!id || vistos.has(id)) continue; vistos.add(id);
        const q = linhaQ(txt), ini = dt((txt.match(/B\)\s*(\d{10})/) || [])[1]), fim = dt((txt.match(/C\)\s*(\d{10})/) || [])[1]);
        out.itens.push({ id, icao, texto: (txt.match(/E\)\s*([\s\S]*?)(?:\n[FG]\)|$)/) || [, ''])[1].trim().slice(0, 400), ini, fim, ...q });
      }
    } catch (e) { diag.erros.push(icao + ': ' + e.message); }
  }
} else diag.aviso = 'Sem AISWEB_API_KEY/AISWEB_API_PASS: nada baixado.';
diag.itens = out.itens.length; diag.com_coordenada = out.itens.filter(i => i.lat != null).length;
fs.writeFileSync(new URL('../notam/NOTAM.json', import.meta.url), JSON.stringify(out, null, 1));
fs.writeFileSync(new URL('../notam/DIAGNOSTICO.json', import.meta.url), JSON.stringify(diag, null, 1));
console.log(JSON.stringify(diag));
