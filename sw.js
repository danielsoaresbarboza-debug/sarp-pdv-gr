// Service worker: o app abre e funciona sem internet.
// Rede primeiro (pega versão nova) com limite de 4 s; se a rede falhar/demorar, usa o que está guardado.
const CACHE = 'sarp-v73';
const BASE = ['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','versao.json'];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(BASE.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
function comTimeout(req, ms){
  return new Promise((ok,fail)=>{
    const t = setTimeout(()=>fail(new Error('timeout')), ms);
    fetch(req).then(r=>{ clearTimeout(t); ok(r); }, e=>{ clearTimeout(t); fail(e); });
  });
}
self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method!=='GET') return;
  const url = new URL(req.url);
  if(url.origin!==self.location.origin) return;           // CDN/Google/etc. seguem direto pela rede
  if(url.pathname.endsWith('versao.json')){ e.respondWith(fetch(req).catch(()=>new Response('{}',{headers:{'Content-Type':'application/json'}}))); return; }
  e.respondWith(
    comTimeout(req, 4000).then(r=>{
      if(r && r.ok){ const c = r.clone(); caches.open(CACHE).then(ch=>ch.put(req,c)); }
      return r;
    }).catch(()=>caches.match(req, {ignoreSearch:true}).then(m=>m || (req.mode==='navigate' ? caches.match('index.html') : Response.error())))
  );
});
