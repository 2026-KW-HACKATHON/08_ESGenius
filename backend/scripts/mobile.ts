import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { configFromEnv } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { Dataset } from '../src/schemas.js';
const base=configFromEnv();
if(base.production)throw new Error('Use npm start for deployment. This command is for USB device development.');
if(!base.devUserToken)throw new Error('Run npm run setup first to create a local resident token.');
const config={...base,host:'127.0.0.1',port:4101,databasePath:'./data/mobile.sqlite',demoMode:false,corsOrigins:['http://127.0.0.1:5173','http://localhost:5173','https://localhost']};
const store=new Store(config.databasePath);
if(!store.dataset())store.importDataset(JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')) as Dataset);
const app=await buildApp(config,{store,logger:true});
await app.listen({host:config.host,port:config.port});
console.log('USB Android backend: 127.0.0.1:4101. Use adb reverse tcp:4101 tcp:4101. No preview role switching endpoints are enabled.');
let closing=false;async function close(){if(closing)return;closing=true;await app.close();store.close();}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
