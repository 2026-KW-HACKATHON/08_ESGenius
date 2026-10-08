import { configFromEnv } from './config.js';
import { buildApp } from './app.js';
const config=configFromEnv();
const app=await buildApp(config,{logger:true});
await app.listen({host:config.host,port:config.port});
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
