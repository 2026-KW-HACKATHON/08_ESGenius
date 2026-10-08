import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseSheet} from '../src/seoul-sheet.js';
import {insideDataset} from '../src/geo.js';
import type {Dataset,Facility} from '../src/schemas.js';

const root='data/safety-research';mkdirSync(root,{recursive:true});
const d:Dataset=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8'));
const endpoint='https://data.seoul.go.kr/dataList/dataView.do?onepagerow=1000';
const rows:Record<string,string>[]=[],seen=new Set<string>();let total=0;
// The public sheet returns 1,000 rows but advances its page offset by 100.
for(let page=1;page===1||rows.length<total;page+=10){
  const body=new URLSearchParams({infId:'OA-20934',srvType:'S',serviceKind:'1',pageNo:String(page),ssUserId:'SAMPLE_VIEW',strWhere:" AND SVCAREAID LIKE '▥노원구▥'",strOrderby:'SVCAREAID DESC,UPDTDATE DESC'});
  const response=await fetch(endpoint,{method:'POST',body,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('CCTV source HTTP '+response.status);
  const text=await response.text(),result=parseSheet(text);total=result.page?.totalCount??0;
  if(!total||!result.list.length)throw new Error('Incomplete CCTV response');
  writeFileSync(`${root}/cctv-page-${page}.json`,JSON.stringify(result));
  let added=0;for(const row of result.list)if(!seen.has(row.RONUM!)){seen.add(row.RONUM!);rows.push(row);added++;}
  if(!added||page>100)throw new Error('CCTV pagination did not advance');
}
if(rows.length!==total)throw new Error('CCTV source changed while collecting; preserve snapshot');
const local=rows.filter(r=>r.SVCAREAID==='노원구'&&insideDataset({lat:Number(r.WGSYPT),lng:Number(r.WGSXPT)},d));
const groups=new Map<string,typeof rows>();
for(const row of local){const key=row.WGSYPT+','+row.WGSXPT;groups.set(key,[...(groups.get(key)??[]),row]);}
const facilities:Facility[]=[...groups].map(([key,group])=>({id:'seoul-cctv-'+createHash('sha256').update(key).digest('hex').slice(0,16),name:group[0]!.ADDR!.slice(0,150)+(group.length>1?` 외 ${group.length-1}개 등록 기록`:''),type:'CCTV',position:{lat:Number(group[0]!.WGSYPT),lng:Number(group[0]!.WGSXPT)},status:'UNKNOWN',source:{type:'OFFICIAL',name:'서울특별시 · 노원구 안심이 CCTV 연계 현황',url:'https://data.seoul.go.kr/dataList/OA-20934/S/1/datasetView.do',observedAt:group[0]!.UPDTDATE+'T00:00:00+09:00',recheckAt:group[0]!.UPDTDATE+'T00:00:00+09:00',dateMeaning:'원자료 수정일. 동일 좌표의 등록 기록을 묶은 위치이며 현재 작동·촬영 방향은 미확인.'}}));
for(const f of facilities)f.source.recheckAt=new Date(Date.parse(f.source.observedAt)+86400000).toISOString();
const result={datasetId:d.id,collectedAt:new Date().toISOString(),sourceUrl:'https://data.seoul.go.kr/dataList/OA-20934/S/1/datasetView.do',license:'공공누리 제1유형 · 서울특별시 출처표시',totalRecords:total,localRecords:local.length,coordinateGroups:facilities.length,facilities};
writeFileSync('data/wolgye-safety-facilities.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({total,localRecords:local.length,coordinateGroups:facilities.length}));
