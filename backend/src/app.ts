import Fastify, { LogController } from 'fastify';
import {terrainFeatures,extraMapFeatures} from './map-features.js';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Type as T, type Static } from '@sinclair/typebox';
import type { Config } from './config.js';
import { validateConfig } from './config.js';
import { Store } from './store.js';
import { demoDataset } from './demo.js';
import { createAuth } from './auth.js';
import { ResidentAuth } from './resident-auth.js';
import { ApiError } from './errors.js';
import { activeConstructions, isFresh } from './routing.js';
import { distance, insideDataset, inside, parseBbox } from './geo.js';
import { nearbyFacilities, checkNight } from './night.js';
import { searchKakao } from './kakao.js';
import * as S from './schemas.js';
import { RouteEnvelope } from './contracts.js';
import { readNotices } from './construction-notices.js';
import { constructionPlan, constructionRevision, constructionRoutes } from './construction-routing.js';
import { journeyRoutes } from './journey.js';
import { planRoute } from './route-planner.js';

export async function buildApp(config:Config,options:{store?:Store;now?:()=>Date;fetcher?:typeof fetch;logger?:boolean}={}) {
  validateConfig(config);
  const store=options.store??new Store(config.databasePath),now=options.now??(()=>new Date());
  if(!store.dataset()&&config.demoMode)store.importDataset(demoDataset(now()));
  if(store.dataset()?.isDemo&&!config.demoMode)throw new Error('Demo database cannot run with DEMO_MODE=false. Use a separate real database.');
  const residents=!config.production&&!config.jwksUrl?new ResidentAuth(store):undefined;
  const auth=createAuth(config,residents?token=>residents.identity(token,now()):undefined);
  const app=Fastify({logger:options.logger??false,logController:new LogController({disableRequestLogging:true}),bodyLimit:256*1024,ajv:{customOptions:{removeAdditional:false}},requestTimeout:15000});
  await app.register(helmet);
  await app.register(cors,{origin:config.corsOrigins,credentials:false,methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']});
  await app.register(rateLimit,{max:120,timeWindow:'1 minute'});
  await app.register(swagger,{openapi:{info:{title:'월계온 모바일 API',version:'0.1.0',description:'공사 우회·조명 기반 밤길 비교. 시연 데이터는 isDemo=true. GeoJSON 좌표는 [lng,lat].'},components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'}}}}});
  await app.register(swaggerUI,{routePrefix:'/docs'});
  app.setErrorHandler((error,req,reply)=>{
    const e=error as any;const status=e.validation?400:(e.statusCode??500);
    reply.code(status).send({error:{code:e.validation?'VALIDATION_ERROR':e.code??(status===429?'RATE_LIMITED':'INTERNAL_ERROR'),message:status>=500&&!(e instanceof ApiError)?'서버 요청 처리에 실패했습니다.':e.message},requestId:req.id});
  });
  app.setNotFoundHandler((_req,reply)=>reply.code(404).send({error:{code:'NOT_FOUND',message:'없는 API 경로입니다.'}}));
  app.addHook('onClose',async()=>{if(!options.store)store.close();});
  const wrap=(data:unknown)=>({data,meta:{isDemo:store.dataset()?.isDemo??false,graphVersion:store.revision()}});
  const secured=[{bearerAuth:[]}];
  const schema=(summary:string,extra:Record<string,unknown>={})=>({summary,...extra});
  const visibleReport=(id:string)=>{const r=store.getReport(id);if(r.status==='HIDDEN')throw new ApiError(404,'NOT_FOUND','제보를 찾을 수 없습니다.');return store.publicReport(r);};
  const publicConstruction=(c:S.Construction)=>{const {reason:_reason,reportId:_report,...publicData}=c;const edges=store.dataset()?.edges??[];return {...publicData,segments:edges.filter(e=>c.edgeIds.includes(e.id)).map(e=>({edgeId:e.id,coordinates:e.geometry.map(p=>[p.lng,p.lat])})),needsRecheck:!isFresh(c.source,now())||!!(c.expectedEndAt&&+new Date(c.expectedEndAt)<+now())};};

  app.get('/health',{schema:schema('서버 상태')},async()=>({status:'ok',dataReady:!!store.dataset(),isDemo:store.dataset()?.isDemo??false}));
  const credentials={email:T.String({format:'email',maxLength:254}),password:T.String({minLength:10,maxLength:128})};
  app.get('/api/v1/auth/method',{schema:schema('회원 인증 방식')},async()=>wrap({provider:residents?'LOCAL':'JWT'}));
  if(residents){
    app.post<{Body:{email:string;password:string;nickname:string;district:string}}>('/api/v1/auth/signup',{schema:schema('월계동 주민 회원가입',{body:T.Object({...credentials,nickname:T.String({minLength:1,maxLength:30}),district:T.Union([T.Literal('월계1동'),T.Literal('월계2동'),T.Literal('월계3동'),T.Literal('월계동 생활권')])},{additionalProperties:false})}),config:{rateLimit:{max:5,timeWindow:'1 hour'}}},async(req,reply)=>{const result=await residents.signup(req.body);reply.code(201);return wrap(result);});
    app.post<{Body:{email:string;password:string}}>('/api/v1/auth/login',{schema:schema('주민 로그인',{body:T.Object(credentials,{additionalProperties:false})}),config:{rateLimit:{max:10,timeWindow:'15 minutes'}}},async(req,reply)=>{reply.header('Cache-Control','no-store');return wrap(await residents.login(req.body.email,req.body.password,now()));});
    app.post('/api/v1/auth/logout',{schema:schema('현재 로그인 세션 종료',{security:secured})},async(req,reply)=>{await auth(req);residents.logout(req.headers.authorization!.slice(7));return reply.code(204).send();});
  }
  app.get('/api/v1/config',{schema:schema('모바일 앱 설정·조사 범위')},async()=>wrap({mapProvider:'KAKAO',placeSearchConfigured:!!config.kakaoKey,coverage:store.dataset()?.bbox??null,coordinateOrder:'GeoJSON [lng,lat]',features:{constructionDetours:true,nightRoutes:true,photos:true,backgroundNavigation:false},help:{phone:'112',phoneUri:'tel:112'},demoNotice:store.dataset()?.isDemo?'가상 데이터입니다. 실제 길 안내에 사용하지 마세요.':null}));
  app.get('/api/v1/coverage',{schema:schema('등록된 지도 연결 지점. 앱에서 사용자가 출입 지점을 선택')},async()=>wrap({dataset:store.requireDataset().name,nodes:store.requireDataset().nodes}));
  app.get('/api/v1/map/coverage',{schema:schema('앱 지도에 표시할 행정 경계와 연결점. 카카오 지도 타일은 앱 SDK 사용')},async()=>{
    const d=store.requireDataset();return wrap({dataset:d.name,bbox:d.bbox,boundary:d.boundary,nodes:d.nodes});
  });
  app.get('/api/v1/me',{schema:schema('검증된 로그인 사용자와 운영 권한',{security:secured})},async req=>{
    const user=await auth(req);return wrap(user);
  });
  app.get<{Querystring:Static<typeof S.Nearby>}>('/api/v1/coverage/nearby',{schema:schema('인근 지도 연결 지점 후보. 자동 도로 연결 없음',{querystring:S.Nearby})},async req=>{
    const p={lat:req.query.lat,lng:req.query.lng};const d=store.requireDataset();
    if(!insideDataset(p,d))throw new ApiError(422,'OUT_OF_COVERAGE','조사 영역 밖입니다.');
    return wrap(d.nodes.map(n=>({...n,distanceM:distance(p,n.position)})).filter(n=>n.distanceM<=req.query.radiusM).sort((a,b)=>a.distanceM-b.distanceM).slice(0,10).map(n=>({...n,distanceM:Math.round(n.distanceM),requiresUserSelection:true,connectorSurveyed:false})));
  });
  app.get<{Querystring:Static<typeof S.SearchPlaces>}>('/api/v1/places',{schema:schema('카카오 장소 검색. 키가 없으면 등록 지점 검색',{querystring:S.SearchPlaces})},async req=>{
    if(config.kakaoKey)return wrap({provider:'KAKAO',items:await searchKakao(req.query.q,config.kakaoKey,options.fetcher)});
    return wrap({provider:'LOCAL_NODES_ONLY',items:store.requireDataset().nodes.filter(n=>n.name.includes(req.query.q)),notice:'월계동 지도에 등록된 장소를 검색했어요.'});
  });
  app.get<{Querystring:Static<typeof S.BboxQuery>}>('/api/v1/map/items',{schema:schema('공사·야간 시설·주민 제보 지도 데이터',{querystring:S.BboxQuery})},async req=>{
    const d=store.requireDataset(),bbox=parseBbox(req.query.bbox),types=req.query.types?.split(',');
    const allowed=['CONSTRUCTION','STREETLIGHT','CCTV','EMERGENCY_BELL','REPORT','STAIRS','SLOPE','ELEVATOR'];
    if(types?.some(t=>!allowed.includes(t)))throw new ApiError(400,'INVALID_FILTER','지원하지 않는 지도 유형입니다.');
    const items=[...activeConstructions(store.constructions(),now()).map(c=>({...publicConstruction(c),kind:'CONSTRUCTION'})),...d.facilities.map(f=>({...f,kind:f.type,needsRecheck:!isFresh(f.source,now())})),...terrainFeatures(d),...extraMapFeatures(d),...store.reports().filter(r=>r.status!=='HIDDEN').map(r=>({...store.publicReport(r),kind:'REPORT'}))].filter(x=>(!bbox||inside(x.position,bbox))&&(!types||types.includes(x.kind)));
    const end=req.query.offset+req.query.limit;
    return wrap({items:items.slice(req.query.offset,end),truncated:end<items.length,nextOffset:end<items.length?end:null,total:items.length});
  });
  app.get('/api/v1/constructions',{schema:schema('공사 목록·최신성. 예정 종료 후에도 해결 전까지 유지')},async()=>wrap(store.constructions().map(publicConstruction)));
  app.get('/api/v1/construction-notices',{schema:schema('서울시 월계동 도로굴착 공개자료. 허가기간과 보행통제를 구분')},async()=>wrap(readNotices(now())));
  app.post<{Body:S.RouteRequest}>('/api/v1/routes/search',{schema:schema('경유지와 공사를 반영한 보행 경로 비교',{body:S.RouteRequest,response:{200:RouteEnvelope}})},async req=>wrap(journeyRoutes(store.requireDataset(),store.constructions(),req.body,store.revision(),now())));
  app.post<{Body:S.RoutePlan}>('/api/v1/routes/plan',{schema:schema('장소 주변의 실제 연결된 도로를 찾아 조건별 경로 계획',{body:S.RoutePlan,response:{200:RouteEnvelope}})},async req=>wrap(planRoute(store.requireDataset(),store.constructions(),req.body,store.revision(),now())));
  app.get('/api/v1/routes/version',{schema:schema('공사 공개자료·기간·통제 변경 재탐색용 버전')},async()=>wrap({graphVersion:constructionRevision(store.revision(),constructionPlan(store.requireDataset(),store.constructions(),now())),rulesVersion:'place-routing-v3'}));
  app.get<{Querystring:Static<typeof S.Nearby>}>('/api/v1/facilities/nearby',{schema:schema('최대 500m 시설·직선거리',{querystring:S.Nearby})},async req=>wrap(nearbyFacilities(store.requireDataset(),req.query,req.query.radiusM,now())));
  app.post<{Body:S.NightCheck}>('/api/v1/night/check',{schema:schema('반딧불이 근접 알림. 위치를 저장하지 않음',{body:S.NightCheck})},async req=>wrap(checkNight(store.requireDataset(),req.body,now())));
  app.get<{Querystring:Static<typeof S.ListReports>}>('/api/v1/reports',{schema:schema('공개 제보 목록',{querystring:S.ListReports})},async req=>{
    const list=store.reports().filter(r=>r.status!=='HIDDEN'&&(!req.query.type||r.type===req.query.type));
    return wrap({items:list.slice(req.query.offset,req.query.offset+req.query.limit).map(r=>store.publicReport(r)),total:list.length,nextOffset:req.query.offset+req.query.limit<list.length?req.query.offset+req.query.limit:null});
  });
  app.get<{Params:{id:string}}>('/api/v1/reports/:id',{schema:schema('제보 상세',{params:S.EndpointParams})},async req=>wrap(visibleReport(req.params.id)));
  app.get('/api/v1/reports/summary',async()=>{const rows=store.reports().filter(r=>r.status!=='HIDDEN');return wrap({verified:rows.filter(r=>r.status==='VERIFIED').length,pending:rows.filter(r=>r.status==='PENDING').length,total:rows.length});});
  app.post<{Params:{id:string};Body:{reason:string}}>('/api/v1/reports/:id/flags',{schema:schema('부적절한 제보 신고',{params:S.EndpointParams,body:T.Object({reason:T.String({minLength:2,maxLength:500})},{additionalProperties:false}),security:secured}),config:{rateLimit:{max:10,timeWindow:'1 hour'}}},async req=>wrap(store.flagReport(req.params.id,(await auth(req)).subject,req.body.reason,now().toISOString())));
  app.get('/api/v1/admin/report-flags',{schema:schema('운영자 제보 신고 목록',{security:secured})},async req=>{await auth(req,true);return wrap(store.db.prepare('SELECT report,reason,at FROM report_flags ORDER BY at DESC').all());});
  app.post<{Body:S.ReportInput}>('/api/v1/reports',{bodyLimit:1500000,schema:schema('현장 제보 등록. 미확인 제보는 경로를 차단하지 않음',{body:S.ReportCreate,headers:S.Idempotency,security:secured}),config:{rateLimit:{max:10,timeWindow:'1 hour'}}},async(req,reply)=>{
    const user=await auth(req);const r=store.createReport(req.body,user.subject,String(req.headers['idempotency-key']),now().toISOString());
    reply.code(201);return wrap(store.publicReport(r));
  });
  for(const method of ['PUT','DELETE'] as const)app.route<{Params:{id:string}}>({method,url:'/api/v1/reports/:id/confirmation',schema:schema(method==='PUT'?'나도 확인했어요':'주민 확인 취소',{params:S.EndpointParams,security:secured}),handler:async req=>wrap(store.confirm(req.params.id,(await auth(req)).subject,method==='PUT'))});
  app.post<{Body:S.ConstructionInput}>('/api/v1/admin/constructions',{schema:schema('운영자가 공사를 보행 구간에 적용',{body:S.ConstructionCreate,headers:S.Idempotency,security:secured})},async(req,reply)=>{const user=await auth(req,true);const c=store.createConstruction(req.body,user.subject,String(req.headers['idempotency-key']),now().toISOString());reply.code(201);return wrap(publicConstruction(c));});
  app.post<{Params:{id:string};Body:Static<typeof S.ResolveConstruction>}>('/api/v1/admin/constructions/:id/resolve',{schema:schema('운영 확인 후 통제 해제',{params:S.EndpointParams,body:S.ResolveConstruction,security:secured})},async req=>wrap(publicConstruction(store.resolveConstruction(req.params.id,req.body.expectedVersion,(await auth(req,true)).subject,req.body.reason,now().toISOString()))));
  app.patch<{Params:{id:string};Body:Static<typeof S.ReportReview>}>('/api/v1/admin/reports/:id',{schema:schema('제보 확인·숨김. 통제 연결은 별도 공사 API',{params:S.EndpointParams,body:S.ReportReview,security:secured})},async req=>wrap(store.review(req.params.id,req.body.expectedVersion,req.body.status,(await auth(req,true)).subject,req.body.reason,now().toISOString())));
  app.get('/api/v1/admin/reports',{schema:schema('운영자 전체 제보 목록',{security:secured})},async req=>{await auth(req,true);return wrap(store.reports().map(r=>store.publicReport(r)));});
  app.get('/api/v1/admin/audit',{schema:schema('운영 조치 이력 최근 100건',{security:secured})},async req=>{await auth(req,true);return wrap(store.db.prepare('SELECT * FROM audit ORDER BY rowid DESC LIMIT 100').all());});
  app.get('/api/v1/me/reports',{schema:schema('내 제보',{security:secured})},async req=>{const user=await auth(req);return wrap(store.reports().filter(r=>r.authorId===user.subject).map(r=>store.publicReport(r)));});
  app.get('/api/v1/me/confirmations',{schema:schema('내가 현장 확인한 공개 제보',{security:secured})},async req=>wrap(store.confirmedReports((await auth(req)).subject)));
  app.get('/api/v1/me/routes',{schema:schema('저장한 길. 이용 시 최신 버전으로 다시 계산',{security:secured})},async req=>wrap(store.savedRoutes((await auth(req)).subject)));
  app.post<{Body:Static<typeof S.SaveRoute>}>('/api/v1/me/routes',{schema:schema('길찾기 조건 저장',{body:S.SaveRoute,security:secured})},async(req,reply)=>{const user=await auth(req);reply.code(201);return wrap(store.saveRoute(user.subject,req.body.name,req.body.search));});
  app.delete<{Params:{id:string}}>('/api/v1/me/routes/:id',{schema:schema('내 저장 경로 삭제',{params:S.EndpointParams,security:secured})},async(req,reply)=>{store.deleteSavedRoute(req.params.id,(await auth(req)).subject);return reply.code(204).send();});
  app.get('/api/v1/openapi.json',{schema:{hide:true}},async()=>app.swagger());
  await app.ready();return app;
}
