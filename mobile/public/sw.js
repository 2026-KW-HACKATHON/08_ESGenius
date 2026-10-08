// Navigation is network-first. Only the offline help page is cached: no routes,
// reports, GPS, credentials, API responses or third-party map resources persist.
const CACHE='wolgye-offline-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('wolgye-offline-')&&k!==CACHE).map(k=>caches.delete(k)))));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.mode==='navigate'&&url.origin===self.location.origin&&['/','/index.html'].includes(url.pathname)){
    event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
  }
});
