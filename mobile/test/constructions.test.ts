import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constructionStatus, constructionCautions, constructionSummary } from '../src/constructions';
import type { Construction, Route } from '../src/types';
const c={status:'ACTIVE',impact:'BLOCK',startsAt:'2026-10-01T00:00:00Z',expectedEndAt:'2026-10-02T00:00:00Z'} as Construction;
test('expired expected end never implies release; scheduled and resolved remain distinct',()=>{
  const now=Date.parse('2026-10-07T00:00:00Z');
  assert.equal(constructionStatus(c,now),'통행 금지');
  assert.equal(constructionStatus({...c,impact:'CAUTION'},now),'통행 주의');
  assert.equal(constructionStatus({...c,startsAt:'2026-11-01T00:00:00Z'},now),'예정');
  assert.equal(constructionStatus({...c,status:'RESOLVED'},now),'통제 해제');
});
test('route warning counts unique construction notices, not affected edges',()=>{
  const route={segments:[{edgeId:'a',constructionIds:['one']},{edgeId:'b',constructionIds:['one','two']}]} as Route;
  assert.deepEqual(constructionCautions(route),['one','two']);
  assert.match(constructionSummary(3,route),/금지 3개 구간/);
  assert.match(constructionSummary(3,route),/주의 2건/);
  assert.doesNotMatch(constructionSummary(0,undefined),/공사가 없/);
});
