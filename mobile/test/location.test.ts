import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceM,usableFix } from '../src/location';
test('GPS rejects inaccurate, old and future positions consistently with backend',()=>{
  const now=1800000000000;assert.equal(usableFix(50,now-30000,now),true);
  for(const [accuracy,time] of [[51,now],[10,now-30001],[10,now+5001],[-1,now],[NaN,now]])assert.equal(usableFix(accuracy,time,now),false);
});
test('start distance uses meters, not latitude/longitude degrees',()=>{
  const origin={lat:37.62,lng:127.06};assert.equal(distanceM(origin,origin),0);assert.ok(distanceM(origin,{...origin,lat:37.621})>100);assert.ok(distanceM(origin,{...origin,lat:37.6201})<20);
});
