// Isolated browser QA: all reports and accounts live only in this process's memory.
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.js';
import {buildApp} from '../src/app.js';
import type {Dataset} from '../src/schemas.js';
const store=new Store(':memory:');const data=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')) as Dataset;store.importDataset(data);
const point=data.nodes.find(n=>n.name.includes('광운'))??data.nodes[0]!;
for(const [type,title,description] of [
  ['ROAD_DAMAGE','인도 블록이 깨져 있어요','[화면 검증용] 어린이들이 자주 지나는 길이라 빠른 확인이 필요해요.'],
  ['DANGER','가로등이 깜빡거려요','[화면 검증용] 저녁에 너무 어두워서 지나가기 불편합니다.'],
  ['CONSTRUCTION','도로 공사로 우회가 필요해요','[화면 검증용] 도서관 앞 도로의 공사 안내를 확인해주세요.'],
  ['FACILITY_FAILURE','벤치 나무판이 깨졌어요','[화면 검증용] 앉으면 위험할 수 있어요. 현장 확인이 필요합니다.']
] as const){store.createReport({type,title,description,position:point.position},'qa-neighbor',randomUUID(),new Date().toISOString());}
const app=await buildApp({databasePath:':memory:',demoMode:false,production:false,host:'127.0.0.1',port:4104,jwtAudience:'authenticated',adminSubjects:[],corsOrigins:['http://127.0.0.1:5174']},{store});
await app.inject({method:'POST',url:'/api/v1/auth/signup',payload:{email:'wireframe-qa@example.test',password:'Wireframe-QA-2026!',nickname:'도토리주민',district:'월계1동'}});
await app.listen({host:'127.0.0.1',port:4104});console.log('Isolated in-memory wireframe QA: 4104');
