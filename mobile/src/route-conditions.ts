import type {Search} from './types';
export type RoutingOptions={profile:Search['profile'];night:boolean;comfort:boolean;stairs:boolean;slopes:boolean;verifiedOnly:boolean};
export function selectPreference<T extends RoutingOptions>(state:T,mode:'FAST'|'COMFORT'|'NIGHT') {
  Object.assign(state,{profile:'WALK',night:mode==='NIGHT',comfort:mode==='COMFORT',stairs:mode==='COMFORT',slopes:mode==='COMFORT'});
}
export function routeConditions(state:RoutingOptions):Omit<Search,'originNodeId'|'destinationNodeId'|'viaNodeIds'>{
  return {profile:state.profile,avoidStairs:state.stairs||state.profile!=='WALK',avoidSlopes:state.slopes||state.profile!=='WALK',preference:state.night?'NIGHT':state.comfort?'COMFORT':'FAST',dataPolicy:state.verifiedOnly?'VERIFIED':'REFERENCE',maxDetourRatio:1.5};
}
