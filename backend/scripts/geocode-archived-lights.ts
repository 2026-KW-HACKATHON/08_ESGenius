import 'dotenv/config';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {insideDataset} from '../src/geo.js';
import type {Dataset,Facility} from '../src/schemas.js';

// Original coordinates are blank. Address reference points are explicitly marked,
// never substituted for lamp coordinates or used to infer illuminated road segments.
const text=new TextDecoder('euc-kr').decode(readFileSync('data/safety-research/nowon-security-lights-2018.csv'));
const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(value.replace(/\r$/,''));value='';if(c==='\n'){rows.push(row);row=[];}}else value+=c;}
if(value||row.length){row.push(value);rows.push(row);}rows.shift();
const local=rows.filter(r=>r[0]?.startsWith('월계1동'));
const groups=new Map<string,string[][]>(),rejected:{name:string;reason:string}[]=[];
for(const r of local){const lot=r[3]?.match(/^서울특별시 노원구 월계1동 (산?\d+(?:-\d+)?)(?:\([^)]*\))?$/)?.[1];if(!lot){rejected.push({name:r[0]!,reason:'명확한 지번 없음'});continue;}const address='서울특별시 노원구 월계동 '+lot;groups.set(address,[...(groups.get(address)??[]),r]);}
const cachePath='data/safety-research/light-geocodes.json';
const cache:Record<string,any>=existsSync(cachePath)?JSON.parse(readFileSync(cachePath,'utf8')):{};
if(!process.env.KAKAO_REST_API_KEY)throw new Error('Address collection requires the configured Kakao REST key');
const addresses=[...groups.keys()];let requests=0;
for(let i=0;i<addresses.length;i+=4){await Promise.all(addresses.slice(i,i+4).map(async address=>{
  if(address in cache)return;
  const u=new URL('https://dapi.kakao.com/v2/local/search/address.json');u.searchParams.set('query',address);u.searchParams.set('analyze_type','exact');
  const r=await fetch(u,{headers:{Authorization:'KakaoAK '+process.env.KAKAO_REST_API_KEY},signal:AbortSignal.timeout(10000)});requests++;
  if(!r.ok)throw new Error('Address source HTTP '+r.status);
  const data=await r.json() as any,lot=address.split(' ').at(-1);
  const matches=data.documents.filter((x:any)=>{const a=x.address;return a&&a.region_1depth_name==='서울'&&a.region_2depth_name==='노원구'&&a.region_3depth_name==='월계동'&&(a.mountain_yn==='Y'?'산':'')+a.main_address_no+(a.sub_address_no?'-'+a.sub_address_no:'')===lot;});
  cache[address]=matches.length===1?{lat:Number(matches[0].y),lng:Number(matches[0].x)}:null;
}));writeFileSync(cachePath,JSON.stringify(cache));if(i%80===0)console.log('주소 확인',Math.min(i+4,addresses.length)+'/'+addresses.length);}
const d:Dataset=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8'));
const archive=JSON.parse(readFileSync('data/safety-research/light-mirror-source.json','utf8'));
const facilities:Facility[]=[];
for(const [address,group] of groups){const position=cache[address];if(!position||!insideDataset(position,d)){rejected.push({name:address,reason:position?'월계1동 경계 밖':'현재 주소와 정확히 일치하는 결과 없음'});continue;}
  facilities.push({id:'archive-light-'+createHash('sha256').update(address).digest('hex').slice(0,16),type:'STREETLIGHT',locationKind:'ADDRESS',name:'보안등 설치 주소 · '+address.replace('서울특별시 노원구 ',''),position,status:'UNKNOWN',description:`2018년 보안등 설치 기록 ${group.length}건의 지번 주소 기준점입니다. 실제 등주 좌표·현재 존치·점등 상태는 확인되지 않았으며 야간 경로 추천의 조명 근거에 포함하지 않습니다. 원본 명칭: ${group.map(r=>r[0]).join(' / ')}`.slice(0,1900),source:{type:'PUBLIC_ARCHIVE',name:'노원구 2018 보안등정보 · MJU FENCE 공개 보존본',url:archive.url,observedAt:'2018-10-05T00:00:00+09:00',recheckAt:'2018-10-06T00:00:00+09:00',dateMeaning:'2018-10-05 원자료 기준일. 공공자료 보존본에서 수집; 현재 주소 검색 기준점이며 시설의 실제 위치·현존 여부 미확인.'}});
}
const result={datasetId:d.id,collectedAt:new Date().toISOString(),originalDate:'2018-10-05',source:archive,rawRecords:rows.length,wolgye1Records:local.length,exactAddressGroups:groups.size,acceptedAddressPoints:facilities.length,rejected,facilities};
writeFileSync('data/wolgye-archived-lights.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({raw:rows.length,wolgye1:local.length,addresses:groups.size,accepted:facilities.length,rejected:rejected.length,requests}));
