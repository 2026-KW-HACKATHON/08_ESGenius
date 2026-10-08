import { Type as T } from '@sinclair/typebox';
import { Source,Position,RouteRequest } from './schemas.js';
const Counts=T.Object({construction:T.Integer(),automaticConstruction:T.Integer(),stairs:T.Integer(),accessibility:T.Integer(),slope:T.Integer()});
const Avoided=T.Array(T.Object({id:T.String(),title:T.String(),basis:T.String()}));
const Route=T.Object({
  labels:T.Array(T.String()),edgeIds:T.Array(T.String()),distanceM:T.Integer(),estimatedDurationSec:T.Integer(),
  constructionDetour:T.Optional(T.Object({avoided:Avoided,extraDistanceM:T.Integer(),extraDurationSec:T.Integer()})),
  timeBasis:T.Object({speedMps:T.Number(),isAssumed:T.Boolean(),waitingTimeIncluded:T.Boolean()}),detourRatio:T.Number(),
  quality:T.Object({dataPolicy:T.String(),slopeUnknownM:T.Integer(),accessibilityUnknownM:T.Integer(),registeredStreetlights:T.Integer(),registeredBells:T.Integer(),registeredCctv:T.Number()}),
  geometry:T.Object({type:T.Literal('LineString'),coordinates:T.Array(T.Tuple([T.Number(),T.Number()]))}),
  lighting:T.Object({litM:T.Integer(),darkM:T.Integer(),unknownM:T.Integer(),observedLitRatio:T.Number()}),
  facilities:T.Object({streetlights:T.Integer(),cctv:T.Integer(),emergencyBells:T.Integer(),ids:T.Array(T.String())}),
  nightSafety:T.Object({narrowM:T.Integer(),widthUnknownM:T.Integer(),workingStreetlights:T.Integer(),workingBells:T.Integer()}),
  segments:T.Array(T.Object({edgeId:T.String(),distanceM:T.Integer(),lighting:T.String(),stairs:T.Boolean(),slopePercent:T.Optional(T.Number()),geometry:T.Array(T.Tuple([T.Number(),T.Number()])),constructionIds:T.Array(T.String()),source:Source})),warnings:T.Array(T.String()),
});
export const RouteEnvelope=T.Object({
  data:T.Object({graphVersion:T.String(),rulesVersion:T.String(),isDemo:T.Boolean(),datasetId:T.String(),calculatedAt:T.String({format:'date-time'}),excludedEdges:Counts,
    resolvedSearch:T.Optional(RouteRequest),connections:T.Optional(T.Array(T.Object({nodeId:T.String(),position:Position,requestedPosition:Position,offsetM:T.Integer(),connectorSurveyed:T.Boolean()}))),
    constructionAvoidance:T.Optional(T.Object({enabled:T.Boolean(),radiusM:T.Number(),mappedCount:T.Integer(),unmappedCount:T.Integer(),stale:T.Boolean(),notice:T.String(),avoided:Avoided,baselineDistanceM:T.Union([T.Integer(),T.Null()])})),
    status:T.Union([T.Literal('OK'),T.Literal('NO_MATCHING_ROUTE'),T.Literal('ALREADY_ARRIVED')]),routes:T.Array(Route),notice:T.Optional(T.String()),singleRouteReason:T.Optional(T.Union([T.String(),T.Null()]))}),
  meta:T.Object({isDemo:T.Boolean(),graphVersion:T.String()}),
});
export type { RouteRequest, Position, NightCheck, ConstructionInput, ReportInput } from './schemas.js';
export type RouteResult=ReturnType<typeof import('./routing.js').computeRoutes>;
