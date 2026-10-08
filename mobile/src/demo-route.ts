import type { Node, Route, Search, MapItem } from './types';
import roads from './film-road-data.json';
// Road geometry comes exclusively from the local OSM graph, never hand-drawn coordinates.
export const demoOrigin=roads.origin as Node;
export const demoDestination=roads.destination as Node;
export const presentationConstruction=roads.construction as MapItem;
export const presentationFacilities=roads.facilities as MapItem[];
export function presentationRoute(profile:Search['profile'],avoid:boolean,night:boolean,construction=false):Route{
  const route=structuredClone((construction?roads.detour:night?roads.night:profile!=='WALK'||avoid?roads.accessible:roads.fast) as unknown as Route);
  // Both road alternatives share the station approach containing these public lamps.
  if(night)route.facilities=structuredClone(roads.night.facilities);
  return route;
}
