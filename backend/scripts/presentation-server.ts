// Temporary recording service: real public map data, isolated in-memory accounts/reports.
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.js';
import {buildApp} from '../src/app.js';
const store=new Store(':memory:');
store.importDataset(JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')));
const point={lat:37.61999,lng:127.06288};
for(const [type,title,description] of [
  ['ROAD_DAMAGE','보도블록 점검이 필요해요','[촬영용 제보] 보도블록이 들뜬 상황을 재현한 예시입니다. 실제 현장 신고가 아닙니다.'],
  ['DANGER','어두운 길을 함께 살펴봐요','[촬영용 제보] 조명 점검이 필요한 상황을 재현한 예시입니다. 실제 현장 신고가 아닙니다.'],
] as const)store.createReport({type,title,description,position:point},'presentation-neighbor',randomUUID(),new Date().toISOString());
const app=await buildApp({databasePath:':memory:',demoMode:false,production:false,host:'127.0.0.1',port:4105,jwtAudience:'authenticated',adminSubjects:[],corsOrigins:['http://127.0.0.1:5173']},{store});
await app.listen({host:'127.0.0.1',port:4105});
console.log('Isolated presentation server: 4105. No production writes.');
