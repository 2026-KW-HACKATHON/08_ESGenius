import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeNotices, parseSeoulSheet, noticePeriod, readNotices } from '../src/construction-notices.js';
import { insideDataset } from '../src/geo.js';
import type { Dataset } from '../src/schemas.js';

const row={PRMISN_NO:'노원구-2026-가스-0028',CNW_NM:'월계동 66-5호 가스 공사',ATDRC_ID:'노원구',ADSTRD_CD:'월계동',CNWPD_DT:'2026-09-21 ~ 2026-10-31',PRCS_STTUS_SE:'착공계 접수',ROAD_KND_CD:'구도',ROAD_SE_CD:'보도',APPLCNT_NM:'수집하지 않는 신청자'};
test('Seoul sheet is parsed as data, preserves string contents, rejects code and truncation',()=>{
  // Use JSON.stringify to cover escaped quotes, commas and apparent key tokens.
  const text='{result:"ok",page:{totalCount:1},list:[{title:'+JSON.stringify('a:b,} key: "text"')+',},],}';
  assert.equal(parseSeoulSheet(text).list[0]!.title,'a:b,} key: "text"');
  assert.throws(()=>parseSeoulSheet('{result:(globalThis.x=1),page:{totalCount:0},list:[]}'));
  assert.throws(()=>parseSeoulSheet('{result:"ok",page:{totalCount:2},list:[]}'),/Incomplete/);
});
test('merge repeated road/pavement rows, preserve permit revisions, exclude other dongs and private applicant fields',()=>{
  const result=normalizeNotices([row,{...row,ROAD_SE_CD:'차도'},{...row,CNWPD_DT:'2026-10-01 ~ 2026-11-01'},{...row,ADSTRD_CD:'중계동'}]);
  assert.equal(result.length,2);assert.notEqual(result[0]!.id,result[1]!.id);
  assert.deepEqual(result[1]!.pavements,['보도','차도']);assert.equal(result[1]!.address,'서울특별시 노원구 월계동 66-5');
  assert.ok(!JSON.stringify(result).includes('수집하지 않는'));assert.equal(result[1]!.pedestrianControl,'UNVERIFIED');assert.equal(result[1]!.position,undefined);
});
test('bad source dates quarantined, historical period never means completed, KST day boundaries are inclusive',()=>{
  const rejected:Array<{permitNo:string;period:string;reason:string}>=[];
  assert.equal(normalizeNotices([{...row,CNWPD_DT:'2020-09-28 ~ 2020-09-07'}],rejected).length,0);assert.equal(rejected.length,1);
  const n=normalizeNotices([row])[0]!;
  assert.equal(noticePeriod(n,new Date('2026-09-20T14:59:59Z')),'UPCOMING');
  assert.equal(noticePeriod(n,new Date('2026-09-20T15:00:00Z')),'IN_PERIOD');
  assert.equal(noticePeriod(n,new Date('2026-10-31T14:59:59Z')),'IN_PERIOD');
  assert.equal(noticePeriod(n,new Date('2026-10-31T15:00:00Z')),'PAST_PERIOD');
});
test('committed public snapshot has provenance, unique records, explicit unverified control and boundary-checked reference points',()=>{
  const c=readNotices(new Date());assert.ok(c.available);assert.ok(c.items.length>0);assert.match(c.sourceUrl,/data.seoul.go.kr/);
  assert.equal(new Set(c.items.map(n=>n.id)).size,c.items.length);
  const d=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')) as Dataset;
  for(const n of c.items){assert.equal(n.pedestrianControl,'UNVERIFIED');if(n.position){assert.ok(n.address);assert.equal(insideDataset(n.position,d),n.region==='WOLGYE1');}}
  assert.equal(readNotices(new Date('2100-01-01')).stale,true);
});
