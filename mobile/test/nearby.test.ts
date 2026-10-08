import test from 'node:test';
import assert from 'node:assert/strict';
import {nearbyFacts,nearbyItems,nearbyView,withinCoverage} from '../src/nearby-view';
import type {Coverage,MapItem} from '../src/types';

const position={lat:37.62,lng:127.06};
const coverage:Coverage={dataset:'test',bbox:[127.05,37.61,127.07,37.63],nodes:[]};
const item=(id:string,kind:string,extra:Partial<MapItem>={}):MapItem=>({id,kind,position,status:'UNKNOWN',...extra});

test('nearby counts exclude archived addresses, resolved construction and locations beyond 500m',()=>{
  const items=[item('lamp','STREETLIGHT'),item('address','STREETLIGHT',{locationKind:'ADDRESS'}),item('cctv','CCTV'),item('far','CCTV',{position:{lat:37.64,lng:127.06}}),item('work','CONSTRUCTION'),item('finished','CONSTRUCTION',{status:'RESOLVED'}),item('notice','CONSTRUCTION_NOTICE')];
  const facts=nearbyFacts(items,position);
  assert.equal(facts.lamps,1);assert.equal(facts.cameras,1);assert.equal(facts.works,2);
  assert.equal(facts.closestLamp,0);assert.match(facts.title,/공사 안내/);
  assert.equal(nearbyItems(items,position,'CONSTRUCTION').length,2);
});
test('nearby information follows the supplied GPS center and handles polygon holes and service boundary',()=>{
  const polygon={...coverage,boundary:{coordinates:[[[127.05,37.61],[127.07,37.61],[127.06,37.63],[127.05,37.61]]]}};
  assert.equal(withinCoverage(position,polygon),true);
  assert.equal(withinCoverage({lat:37.629,lng:127.069},polygon),false);
  const hole={...coverage,boundary:{coordinates:[[[127.05,37.61],[127.07,37.61],[127.07,37.63],[127.05,37.63]],[[127.059,37.619],[127.061,37.619],[127.061,37.621],[127.059,37.621]]]}};
  assert.equal(withinCoverage(position,hole),false);
  assert.equal(nearbyFacts([item('light','STREETLIGHT')],{lat:37.63,lng:127.06}).lamps,0);
});
test('missing GPS, stale signal and outside coverage never masquerade as zero nearby facilities',()=>{
  for(const status of ['loading','unavailable','stale','data-error'] as const){
    const html=nearbyView({status,position,coverage,items:[]});
    assert.doesNotMatch(html,/등록 0곳|안내 0곳/);assert.match(html,/disabled/);
  }
  const html=nearbyView({status:'ready',position:{lat:37.5,lng:127},coverage,items:[]});
  assert.match(html,/아직 이 지역 정보는 없어요/);assert.doesNotMatch(html,/등록 0곳/);
});
test('registered fixtures do not imply working cameras, measured spacing or a dark road',()=>{
  const html=nearbyView({status:'ready',position,coverage,items:[item('lamp','STREETLIGHT'),item('camera','CCTV')]});
  assert.match(html,/가장 가까운 곳 0m/);assert.match(html,/등록 1곳/);
  assert.match(html,/밝기·작동 미확인/);assert.doesNotMatch(html,/운영 중|간격|어두워요/);
  assert.doesNotMatch(nearbyFacts([],position).title,/어두워요/);
});
