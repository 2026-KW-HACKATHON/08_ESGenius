import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateDataset} from '../src/store.js';
import type {Dataset,Facility} from '../src/schemas.js';

const path='data/wolgye1.dataset.json';
const data:Dataset=JSON.parse(readFileSync(path,'utf8'));
if(data.isDemo)throw new Error('Public safety data must not be applied to a synthetic graph');
const files=['wolgye-official-lights','wolgye-safety-facilities','wolgye-public-bells','wolgye-archived-lights'];
const snapshots=files.map(name=>{const file='data/'+name+'.json',raw=readFileSync(file,'utf8'),snapshot=JSON.parse(raw);if(snapshot.datasetId&&snapshot.datasetId!==data.id)throw new Error('Dataset scope mismatch: '+file);return {file,snapshot,sha256:createHash('sha256').update(raw).digest('hex')};});
const facilities:Facility[]=snapshots.flatMap(s=>s.snapshot.facilities);
const managed=new Set(facilities.map(f=>f.id));
// Preserve separately imported facilities; replace the collected IDs idempotently.
const next={...data,facilities:[...data.facilities.filter(f=>!managed.has(f.id)),...facilities]};
validateDataset(next);
writeFileSync(path,JSON.stringify(next,null,2)+'\n');
writeFileSync('data/safety-sources.json',JSON.stringify({datasetId:data.id,appliedAt:new Date().toISOString(),files:snapshots.map(s=>({path:s.file,sha256:s.sha256,facilities:s.snapshot.facilities.length})),counts:{officialLampCoordinates:17,archivalLampAddresses:290,cctvCoordinates:190,indoorBellBuildings:6,stairsWays:11,hillPoints:1,elevators:1},limits:['2018 security-light addresses are not current surveyed lamp coordinates and are excluded from route scoring.','CCTV coordinates are grouped, not camera-unit counts; no crime-safety score is inferred.','Indoor toilet bells are building points and excluded from outdoor-route scoring.','OSM slopes, widths and wheelchair access remain unknown. Elevators do not create unverified graph connections.','Current district-wide security-light and outdoor emergency-bell inventories could not be verified in full.'],unavailableSources:[{id:'OA-15972',description:'Nowon smart-security-light realtime sheet returned no rows; public 2026.05.04–05.10 file download timed out.'},{id:'15028206',description:'National emergency-bell file endpoint returned 403.'}]},null,2)+'\n');
console.log(JSON.stringify({facilities:next.facilities.length,snapshots:snapshots.map(s=>({file:s.file,count:s.snapshot.facilities.length}))}));
