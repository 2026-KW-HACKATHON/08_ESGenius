import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function worker(){
  const listeners:Record<string,(e:any)=>void>={};let cached='';
  vm.runInNewContext(source,{URL,Promise,self:{location:{origin:'https://walk.example'},addEventListener:(n:string,f:any)=>listeners[n]=f},fetch:()=>Promise.reject(new Error('offline')),caches:{match:async(p:string)=>{cached=p;return 'offline-help';}}});
  return {listeners,cached:()=>cached};
}
test('worker never intercepts API, authentication, map tiles or cross-origin documents',()=>{
  const w=worker();
  for(const request of [{mode:'navigate',url:'https://walk.example/api/v1/me'},{mode:'cors',url:'https://walk.example/api/v1/routes/search'},{mode:'cors',url:'https://auth.example/token'},{mode:'no-cors',url:'https://map.example/tile'},{mode:'navigate',url:'https://other.example/'}]){
    w.listeners.fetch!({request,respondWith:()=>assert.fail('private/dynamic request intercepted')});
  }
  assert.equal(w.cached(),'');
});
test('offline navigation returns help, not a cached route or logged-in page',async()=>{
  const w=worker();let response:Promise<string>|undefined;
  w.listeners.fetch!({request:{mode:'navigate',url:'https://walk.example/'},respondWith:(r:Promise<string>)=>response=r});
  assert.equal(await response,'offline-help');assert.equal(w.cached(),'/offline.html');
});
