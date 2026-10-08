import { Type as T, type Static } from '@sinclair/typebox';

const obj = <P extends Record<string, any>>(p: P) => T.Object(p, { additionalProperties: false });
export const Id = T.String({ minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' });
export const Position = obj({ lat: T.Number({ minimum: -90, maximum: 90 }), lng: T.Number({ minimum: -180, maximum: 180 }) });
export type Position = Static<typeof Position>;
export const DateTime = T.String({ format: 'date-time' });
const tri = T.Union([T.Literal('PASS'), T.Literal('BLOCKED'), T.Literal('UNKNOWN')]);
export const Source = obj({
  type: T.Union([T.Literal('OFFICIAL'), T.Literal('FIELD_SURVEY'), T.Literal('OPEN_MAP'), T.Literal('PUBLIC_ARCHIVE'), T.Literal('DEMO')]),
  name: T.String({ minLength: 1, maxLength: 200 }), url: T.Optional(T.String({ format: 'uri', maxLength: 1000 })),
  observedAt: DateTime, recheckAt: DateTime, dateMeaning: T.Optional(T.String({maxLength:200})),
});
export const Facility = obj({
  id: Id, name: T.String({ minLength: 1, maxLength: 200 }), position: Position,
  description:T.Optional(T.String({maxLength:2000})),
  access:T.Optional(T.Union([T.Literal('INDOOR'),T.Literal('OUTDOOR'),T.Literal('UNKNOWN')])),
  openingHours:T.Optional(T.String({maxLength:200})),
  locationKind:T.Optional(T.Union([T.Literal('POINT'),T.Literal('ADDRESS')])),
  type: T.Union([T.Literal('STREETLIGHT'), T.Literal('CCTV'), T.Literal('EMERGENCY_BELL')]),
  status: T.Union([T.Literal('WORKING'), T.Literal('BROKEN'), T.Literal('UNKNOWN')]), source: Source,
});
export type Facility = Static<typeof Facility>;
export const Edge = obj({
  id: Id, from: Id, to: Id, bidirectional: T.Boolean(),
  geometry: T.Array(Position, { minItems: 2, maxItems: 100 }),
  stairs: T.Boolean(), wheelchair: tri, stroller: tri,
  slopePercent: T.Optional(T.Number({minimum:0,maximum:100})),
  passageWidthM: T.Optional(T.Number({minimum:0,maximum:100})),
  discomfort: T.Number({ minimum: 0, maximum: 1 }),
  lighting: T.Union([T.Literal('LIT'), T.Literal('DARK'), T.Literal('UNKNOWN')]),
  source: Source,
  // Explicit surveyed relationship; geographic proximity alone is not evidence.
  facilityIds: T.Array(Id, { maxItems: 100, uniqueItems: true }),
});
export type Edge = Static<typeof Edge>;
export const Dataset = obj({
  id: Id, name: T.String({ minLength: 1 }), isDemo: T.Boolean(),
  bbox: T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()]),
  boundary: T.Optional(obj({type:T.Literal('Polygon'),coordinates:T.Array(T.Array(T.Tuple([T.Number(),T.Number()]),{minItems:4}),{minItems:1})})),
  nodes: T.Array(obj({ id: Id, name: T.String({ minLength: 1 }), position: Position }), { minItems: 2, maxItems: 3000 }),
  edges: T.Array(Edge, { minItems: 1, maxItems: 10000 }),
  facilities: T.Array(Facility, { maxItems: 10000 }),
});
export type Dataset = Static<typeof Dataset>;
export const RouteRequest = obj({
  originNodeId: Id, destinationNodeId: Id,
  viaNodeIds: T.Optional(T.Array(Id, { maxItems: 3, uniqueItems: true })),
  profile: T.Union([T.Literal('WALK'), T.Literal('WHEELCHAIR'), T.Literal('STROLLER')], { default: 'WALK' }),
  avoidStairs: T.Boolean({ default: false }),
  avoidSlopes: T.Optional(T.Boolean()),
  preference: T.Union([T.Literal('FAST'), T.Literal('NIGHT'), T.Literal('COMFORT')], { default: 'NIGHT' }),
  dataPolicy: T.Optional(T.Union([T.Literal('VERIFIED'),T.Literal('REFERENCE')])),
  maxDetourRatio: T.Number({ minimum: 1, maximum: 2, default: 1.5 }),
});
export type RouteRequest = Static<typeof RouteRequest>;
export const RoutePlan = obj({...T.Omit(RouteRequest,['originNodeId','destinationNodeId','viaNodeIds']).properties,
  origin:Position,destination:Position,via:T.Optional(T.Array(Position,{maxItems:3}))});
export type RoutePlan = Static<typeof RoutePlan>;
export const ConstructionCreate = obj({
  title: T.String({ minLength: 2, maxLength: 100 }), description: T.String({ minLength: 2, maxLength: 2000 }),
  position: Position, edgeIds: T.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }),
  impact: T.Union([T.Literal('BLOCK'), T.Literal('CAUTION')]),
  startsAt: DateTime, expectedEndAt: T.Optional(DateTime), source: Source,
  reason: T.String({ minLength: 2, maxLength: 500 }), reportId: T.Optional(Id),
});
export type ConstructionInput = Static<typeof ConstructionCreate>;
export type Construction = ConstructionInput & {
  id: string; version: number; status: 'ACTIVE' | 'RESOLVED'; createdAt: string; resolvedAt?: string;
};
export const ResolveConstruction = obj({ expectedVersion: T.Integer({ minimum: 1 }), reason: T.String({ minLength: 2, maxLength: 500 }) });
export const ReportCreate = obj({
  title: T.String({ minLength: 2, maxLength: 100 }), description: T.String({ minLength: 10, maxLength: 2000 }), position: Position,
  type: T.Union([T.Literal('CONSTRUCTION'), T.Literal('POOR_LIGHTING'), T.Literal('FACILITY_FAILURE'), T.Literal('OBSTACLE'), T.Literal('ROAD_DAMAGE'), T.Literal('DANGER')]),
  photos: T.Optional(T.Array(T.String({ maxLength: 700000, pattern: '^data:image/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$' }), { maxItems: 2 })),
});
export type ReportInput = Static<typeof ReportCreate>;
export type Report = ReportInput & {
  id: string; authorId: string; createdAt: string; status: 'PENDING' | 'VERIFIED' | 'HIDDEN'; version: number;
};
export const ReportReview = obj({ expectedVersion: T.Integer({ minimum: 1 }), status: T.Union([T.Literal('VERIFIED'), T.Literal('HIDDEN')]), reason: T.String({ minLength: 2, maxLength: 500 }) });
export const Nearby = obj({ lat: Position.properties.lat, lng: Position.properties.lng, radiusM: T.Number({ minimum: 1, maximum: 500, default: 500 }) });
export const NightCheck = obj({
  position: Position, accuracyM: T.Number({ minimum: 0, maximum: 10000 }), measuredAt: DateTime,
  recentAlerts: T.Array(obj({ facilityId: Id, alertedAt: DateTime }), { maxItems: 100, default: [] }),
});
export type NightCheck = Static<typeof NightCheck>;
export const BboxQuery = obj({ bbox: T.Optional(T.String({ maxLength: 150 })), types: T.Optional(T.String({ maxLength: 150 })),offset:T.Integer({minimum:0,maximum:20000,default:0}),limit:T.Integer({minimum:1,maximum:1000,default:500}) });
export const ListReports = obj({ type: T.Optional(ReportCreate.properties.type), limit: T.Integer({ minimum: 1, maximum: 100, default: 20 }), offset: T.Integer({ minimum: 0, maximum: 100000, default: 0 }) });
export const EndpointParams = obj({ id: Id });
export const SaveRoute = obj({ name: T.String({ minLength: 1, maxLength: 80 }), search: RouteRequest });
export const SearchPlaces = obj({ q: T.String({ minLength: 2, maxLength: 100 }) });
export const Idempotency = T.Object({ 'idempotency-key': T.String({ format: 'uuid' }) }, { required: ['idempotency-key'] });
