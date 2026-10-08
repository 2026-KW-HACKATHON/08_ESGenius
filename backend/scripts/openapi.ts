import { writeFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { demoDataset } from '../src/demo.js';
import { Dataset } from '../src/schemas.js';
const app=await buildApp({databasePath:':memory:',demoMode:true,production:false,host:'127.0.0.1',port:4100,jwtAudience:'authenticated',adminSubjects:[],corsOrigins:[]});
writeFileSync('openapi.json',JSON.stringify(app.swagger(),null,2));
writeFileSync('data/demo.dataset.json',JSON.stringify(demoDataset(),null,2));
writeFileSync('data/dataset.schema.json',JSON.stringify(Dataset,null,2));
await app.close();console.log('Exported openapi.json, dataset schema and clearly labelled demo dataset.');
