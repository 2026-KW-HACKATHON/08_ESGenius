import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeHeader, routePanel, type RouteViewState } from '../src/route-view';
import { presentationRoute, demoOrigin, demoDestination } from '../src/demo-route';
const state:RouteViewState={demo:true,origin:demoOrigin,destination:demoDestination,profile:'WALK',night:false,nightAuto:false,comfort:false,stairs:false,slopes:false,busy:false,error:'',guiding:true,routes:[presentationRoute('WALK',false,false)],index:0};
test('day guidance uses the green route and cat; night guidance uses yellow and firefly',()=>{
  assert.match(routeHeader(state),/초록 경로/);assert.match(routePanel(state,true,''),/고양이와 함께/);
  assert.doesNotMatch(routePanel(state,true,''),/반딧불이/);
  const night={...state,night:true};assert.match(routeHeader(night),/노란 안심 경로/);assert.match(routePanel(night,true,''),/반딧불이와 함께/);
});
