import { readFileSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import { Dataset } from '../src/schemas.js';
import { Store } from '../src/store.js';
import { configFromEnv } from '../src/config.js';
const path=process.argv[2];if(!path)throw new Error('Usage: npm run data:import -- <dataset.json>');
// TypeBox Value.Check does not implement string formats without registration;
// validate timestamps and source URIs explicitly in this import path.
import { FormatRegistry } from '@sinclair/typebox';
FormatRegistry.Set('date-time',s=>/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s)));
FormatRegistry.Set('uri',s=>{try{return ['https:','http:'].includes(new URL(s).protocol);}catch{return false;}});
const data:unknown=JSON.parse(readFileSync(path,'utf8'));
if(!Value.Check(Dataset,data))throw new Error(JSON.stringify([...Value.Errors(Dataset,data)].map(e=>({path:e.path,message:e.message}))));
const c=configFromEnv();if(data.isDemo!==c.demoMode)throw new Error('Dataset and DEMO_MODE must match.');
const store=new Store(c.databasePath);try{store.importDataset(data);console.log(`Imported ${data.nodes.length} nodes, ${data.edges.length} edges. Version ${store.revision()}. Demo=${data.isDemo}`);}finally{store.close();}
