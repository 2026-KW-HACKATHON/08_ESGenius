import 'dotenv/config';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { constructionSource, normalizeNotices, parseSeoulSheet, noticePeriod, type NoticeCatalog } from '../src/construction-notices.js';
import { insideDataset } from '../src/geo.js';
import type { Dataset } from '../src/schemas.js';

const endpoint='https://data.seoul.go.kr/dataList/dataView.do';
const body=new URLSearchParams({onepagerow:'1000',infId:'OA-22901',srvType:'S',serviceKind:'1',pageNo:'1',ssUserId:'SAMPLE_VIEW',strOrderby:'CNWPD_DT DESC',filterCol:'ADSTRD_CD',txtFilter:'월계'});
const response=await fetch(endpoint,{method:'POST',body,signal:AbortSignal.timeout(30000)});
if(!response.ok)throw new Error('Seoul collection failed: '+response.status);
const rejected:Array<{permitNo:string;period:string;reason:string}>=[];
const raw=await response.text(),parsed=parseSeoulSheet(raw),items=normalizeNotices(parsed.list,rejected);
if(!items.length)throw new Error('Empty collection; preserving previous snapshot');
const now=new Date(),dataset=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')) as Dataset;
let geocodingFailures=0;
// Only explicit lot addresses are geocoded. A lot is a reference point, never a
// surveyed work perimeter or a blocked walking edge. No keyword guesses.
if(process.env.KAKAO_REST_API_KEY)for(const n of items.filter(n=>n.address&&noticePeriod(n,now)!=='PAST_PERIOD')){
  try{
    const url=new URL('https://dapi.kakao.com/v2/local/search/address.json');url.searchParams.set('query',n.address!);url.searchParams.set('analyze_type','exact');
    const r=await fetch(url,{headers:{Authorization:'KakaoAK '+process.env.KAKAO_REST_API_KEY},signal:AbortSignal.timeout(10000)});
    if(!r.ok){geocodingFailures++;continue;}
    const result=await r.json() as {documents:{address?:{address_name:string;region_1depth_name:string;region_2depth_name:string;region_3depth_name:string;main_address_no:string;sub_address_no:string;mountain_yn:string};x:string;y:string}[]};
    const lot=n.address!.split(' ').at(-1)!;
    const matches=result.documents.filter(d=>{const a=d.address;return a&&a.region_1depth_name==='서울'&&a.region_2depth_name==='노원구'&&a.region_3depth_name==='월계동'&&((a.mountain_yn==='Y'?'산':'')+a.main_address_no+(a.sub_address_no?'-'+a.sub_address_no:''))===lot;});
    if(matches.length!==1)continue;
    const position={lat:Number(matches[0]!.y),lng:Number(matches[0]!.x)};
    if(!Number.isFinite(position.lat)||!Number.isFinite(position.lng)||position.lat<37||position.lat>38||position.lng<126||position.lng>128)continue;
    n.position=position;n.region=insideDataset(position,dataset)?'WOLGYE1':'OTHER_WOLGYE';
    n.locationNote='공사명에 명시된 지번의 카카오 주소 검색 기준점입니다. 공사 범위·통제 위치를 뜻하지 않습니다. 행정동 구분은 확보한 월계1동 경계와 기준점을 비교했습니다.';
  }catch{geocodingFailures++;}
}
const catalog:NoticeCatalog & {collection:{endpoint:string;filter:string;sha256:string;geocodingFailures:number;rejected:typeof rejected}}={collectedAt:now.toISOString(),sourceUrl:constructionSource,sourceName:'서울특별시 · 도로굴착 공사 현황 (OA-22901)',license:'공공누리 제1유형 · 서울특별시 출처표시',rawCount:parsed.list.length,items,collection:{endpoint,filter:'ADSTRD_CD contains 월계; district 노원구; dong 월계동',sha256:createHash('sha256').update(raw).digest('hex'),geocodingFailures,rejected}};
const target='data/wolgye-construction-notices.json';writeFileSync(target+'.tmp',JSON.stringify(catalog,null,2)+'\n');renameSync(target+'.tmp',target);
console.log(JSON.stringify({raw:catalog.rawCount,records:items.length,uniquePermits:new Set(items.map(n=>n.permitNo)).size,inPeriod:items.filter(n=>noticePeriod(n,now)==='IN_PERIOD').length,located:items.filter(n=>n.position).length,wolgye1ReferencePoints:items.filter(n=>n.region==='WOLGYE1').length,geocodingFailures}));
