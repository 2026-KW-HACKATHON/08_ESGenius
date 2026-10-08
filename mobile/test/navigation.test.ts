import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daylight, routeProgress } from '../src/navigation';
import { distanceM } from '../src/location';

test('Seoul sunrise/sunset boundaries switch automatically in every season',()=>{
  for(const month of ['01','04','07','10']){
    const d=daylight(new Date(`2026-${month}-07T12:00:00+09:00`));
    assert.equal(d.night,false);
    assert.equal(daylight(new Date(+d.sunset-1)).night,false);
    assert.equal(daylight(d.sunset).night,true);
    assert.equal(daylight(new Date(+d.sunrise-1)).night,true);
    assert.equal(daylight(d.sunrise).night,false);
    assert.equal(daylight(new Date(`2026-${month}-07T00:00:00+09:00`)).night,true);
  }
});
const coords:[number,number][]=[[127.059,37.621],[127.059,37.622],[127.060,37.622]];
test('guide follows next bend instead of flying straight through buildings',()=>{
  const progress=routeProgress(coords,{lat:37.62195,lng:127.059})!;
  assert.equal(progress.guide.lat,37.622);
  assert.ok(progress.guide.lng>127.059);
  assert.ok(progress.offRouteM<1);
  assert.ok(progress.remainingM>80);
});
test('off-route, arrival, repeated coordinates and empty paths',()=>{
  assert.ok(routeProgress(coords,{lat:37.63,lng:127.05})!.offRouteM>40);
  assert.equal(routeProgress(coords,{lat:37.622,lng:127.060})!.arrived,true);
  assert.equal(routeProgress([], {lat:0,lng:0}),null);
  const p=routeProgress([coords[0],...coords],{lat:37.621,lng:127.059})!;
  assert.ok(Math.abs(distanceM({lat:37.621,lng:127.059},p.guide)-18)<.1);
});
