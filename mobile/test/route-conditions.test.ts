import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeConditions,selectPreference} from '../src/route-conditions';
import {nextManeuver} from '../src/navigation';
test('selecting shortest clears mobility and hill filters and sends FAST explicitly',()=>{
  const state={profile:'WHEELCHAIR' as const as 'WALK'|'WHEELCHAIR',night:true,comfort:true,stairs:true,slopes:true,verifiedOnly:false};selectPreference(state,'FAST');assert.deepEqual(routeConditions(state),{profile:'WALK',avoidStairs:false,avoidSlopes:false,preference:'FAST',dataPolicy:'REFERENCE',maxDetourRatio:1.5});
  selectPreference(state,'COMFORT');assert.equal(routeConditions(state).avoidStairs,true);assert.equal(routeConditions(state).avoidSlopes,true);
  selectPreference(state,'NIGHT');assert.equal(routeConditions(state).preference,'NIGHT');assert.equal(routeConditions(state).avoidSlopes,false);
});
test('guidance reports actual left/right bends, distance, arrival and no turns on a straight route',()=>{
  const right:[number,number][]=[[127,37],[127,37.001],[127.001,37.001]];
  assert.equal(nextManeuver(right,0).kind,'RIGHT');assert.match(nextManeuver(right,0).text,/110m 앞 오른쪽/);
  assert.equal(nextManeuver([[127,37],[127,37.001],[126.999,37.001]],0).kind,'LEFT');
  assert.equal(nextManeuver([[127,37],[127,37.001],[127,37.002]],0).kind,'STRAIGHT');
  assert.equal(nextManeuver(right,199).kind,'ARRIVE');assert.equal(nextManeuver([],0).kind,'ARRIVE');
});
