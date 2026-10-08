import { readFileSync } from 'node:fs';
import { configFromEnv } from '../src/config.js';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import type { Dataset } from '../src/schemas.js';
const config=configFromEnv();
const store=new Store(config.databasePath);
// Bootstrap an empty volume only. A restart must never overwrite reports or a
// reviewed dataset/closure imported by the operator.
if(!store.dataset()){
  const dataset=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')) as Dataset;
  if(dataset.isDemo||config.demoMode)throw new Error('Deployment requires the real Wolgye1 dataset.');
  store.importDataset(dataset);
}
const app=await buildApp(config,{store,logger:true});
await app.listen({host:config.host,port:config.port});
let closing=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(closing)return;closing=true;void app.close().then(()=>{store.close();process.exit(0);});});
