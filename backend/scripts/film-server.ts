import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
const store=new Store('./data/film-recording.sqlite');
if(!store.dataset())store.importDataset(JSON.parse(readFileSync('./data/wolgye1.dataset.json','utf8')));
const app=await buildApp({databasePath:'./data/film-recording.sqlite',demoMode:false,production:false,host:'127.0.0.1',port:4102,jwtAudience:'authenticated',adminSubjects:[],corsOrigins:[]},{store});
await app.listen({host:'127.0.0.1',port:4102});
console.log('Isolated recording server ready at 4102');
