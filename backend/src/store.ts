import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Construction, ConstructionInput, Dataset, Report, ReportInput, RouteRequest } from './schemas.js';
import { ApiError } from './errors.js';
import { distance, insideDataset, inside } from './geo.js';

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;
  return JSON.stringify(v);
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO meta VALUES ('revision','0');
      CREATE TABLE IF NOT EXISTS constructions (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, author TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS confirmations (report TEXT NOT NULL REFERENCES reports(id), subject TEXT NOT NULL, PRIMARY KEY(report,subject));
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, subject TEXT NOT NULL, resource TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dedup (subject TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(subject,operation,key));
      CREATE TABLE IF NOT EXISTS saved_routes (id TEXT PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS report_flags (report TEXT NOT NULL REFERENCES reports(id), subject TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(report,subject));
      PRAGMA user_version=1;`);
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const v = fn(); this.db.exec('COMMIT'); return v; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  revision() { return String((this.db.prepare("SELECT value FROM meta WHERE key='revision'").get() as any).value); }
  bump() { this.db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run(); }
  dataset(): Dataset | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key='dataset'").get() as any;
    return row ? JSON.parse(row.value) : undefined;
  }
  requireDataset(): Dataset {
    const data = this.dataset();
    if (!data) throw new ApiError(503, 'DATA_NOT_READY', '조사된 보행망을 아직 등록하지 않았습니다.');
    return data;
  }
  importDataset(data: Dataset) {
    validateDataset(data);
    this.transaction(() => {
      const old = this.dataset();
      if (old && old.isDemo !== data.isDemo) throw new ApiError(409, 'DATASET_MODE_MISMATCH', '실제 데이터는 새 데이터베이스에 반입하세요.');
      const ids = new Set(data.edges.map(e=>e.id));
      if (this.constructions().some(c=>c.status==='ACTIVE' && c.edgeIds.some(id=>!ids.has(id)))) throw new ApiError(409, 'ACTIVE_CONSTRUCTION_EDGE', '활성 공사 구간을 제거할 수 없습니다.');
      this.db.prepare("INSERT INTO meta(key,value) VALUES('dataset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(data));
      this.bump();
    });
  }
  audit(subject: string, resource: string, action: string, reason: string, now: string) {
    this.db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(randomUUID(), subject, resource, action, reason, now);
  }
  idempotent<T>(subject: string, op: string, key: string, input: unknown, fn:()=>T): T {
    return this.transaction(()=>{
      const hash = createHash('sha256').update(canonical(input)).digest('hex');
      const row = this.db.prepare('SELECT hash,result FROM dedup WHERE subject=? AND operation=? AND key=?').get(subject,op,key) as any;
      if (row) {
        if (row.hash !== hash) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','같은 요청 키에 다른 내용이 전달됐습니다.');
        return JSON.parse(row.result);
      }
      const result = fn();
      this.db.prepare('INSERT INTO dedup VALUES(?,?,?,?,?)').run(subject,op,key,hash,JSON.stringify(result));
      return result;
    });
  }
  constructions(): Construction[] { return (this.db.prepare('SELECT body FROM constructions ORDER BY id').all() as any[]).map(x=>JSON.parse(x.body)); }
  createConstruction(input: ConstructionInput, subject: string, key: string, now: string) {
    return this.idempotent(subject,'construction',key,input,()=>{
      const d = this.requireDataset();
      if (!insideDataset(input.position,d) || input.edgeIds.some(id=>!d.edges.some(e=>e.id===id))) throw new ApiError(422,'INVALID_CONSTRUCTION_LOCATION','공사 위치·연결 구간을 확인하세요.');
      validateSource(input.source, d.isDemo);
      if (input.expectedEndAt && +new Date(input.expectedEndAt) <= +new Date(input.startsAt)) throw new ApiError(400,'INVALID_DATES','종료 예정일은 시작일 이후여야 합니다.');
      if (input.reportId) this.getReport(input.reportId);
      const c: Construction = {...input,id:randomUUID(),version:1,status:'ACTIVE',createdAt:now};
      this.db.prepare('INSERT INTO constructions VALUES(?,?)').run(c.id,JSON.stringify(c));
      this.audit(subject,c.id,'CREATE_CONSTRUCTION',input.reason,now); this.bump(); return c;
    });
  }
  resolveConstruction(id: string, version: number, subject: string, reason: string, now: string) {
    return this.transaction(()=>{
      const c = this.constructions().find(x=>x.id===id);
      if (!c) throw new ApiError(404,'NOT_FOUND','공사를 찾을 수 없습니다.');
      if (c.version!==version) throw new ApiError(409,'VERSION_CONFLICT','다른 운영자가 수정했습니다.');
      c.status='RESOLVED'; c.resolvedAt=now; c.version++;
      this.db.prepare('UPDATE constructions SET body=? WHERE id=?').run(JSON.stringify(c),id);
      this.audit(subject,id,'RESOLVE_CONSTRUCTION',reason,now); this.bump(); return c;
    });
  }
  reports(): Report[] { return (this.db.prepare('SELECT body FROM reports ORDER BY rowid DESC').all() as any[]).map(x=>JSON.parse(x.body)); }
  getReport(id: string): Report {
    const row = this.db.prepare('SELECT body FROM reports WHERE id=?').get(id) as any;
    if (!row) throw new ApiError(404,'NOT_FOUND','제보를 찾을 수 없습니다.');
    return JSON.parse(row.body);
  }
  createReport(input: ReportInput, subject: string, key: string, now: string) {
    return this.idempotent(subject,'report',key,input,()=>{
      if (!insideDataset(input.position,this.requireDataset())) throw new ApiError(422,'OUT_OF_COVERAGE','지원 영역 밖입니다.');
      if (!input.title.trim() || input.description.trim().length<10) throw new ApiError(400,'VALIDATION_ERROR','제목과 설명을 입력하세요.');
      for (const photo of input.photos ?? []) {
        const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
        const bytes = Buffer.from(match?.[2] ?? '', 'base64');
        const valid = match?.[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
        if (!match || !valid || bytes.length < 20 || bytes.length > 512000) throw new ApiError(400,'INVALID_PHOTO','사진은 500KB 이하의 JPEG 또는 PNG 파일이어야 합니다.');
      }
      const r: Report = {...input,id:randomUUID(),authorId:subject,createdAt:now,status:'PENDING',version:1};
      this.db.prepare('INSERT INTO reports VALUES(?,?,?)').run(r.id,subject,JSON.stringify(r)); return r;
    });
  }
  confirmedReports(subject:string) {
    const rows=this.db.prepare('SELECT r.body FROM reports r JOIN confirmations c ON c.report=r.id WHERE c.subject=? ORDER BY r.rowid DESC').all(subject) as {body:string}[];
    return rows.map(row=>JSON.parse(row.body) as Report).filter(r=>r.status!=='HIDDEN').map(r=>this.publicReport(r));
  }
  flagReport(id:string, subject:string, reason:string, at:string) {
    const r=this.getReport(id);
    if(r.status==='HIDDEN') throw new ApiError(404,'NOT_FOUND','제보를 찾을 수 없습니다.');
    this.db.prepare('INSERT INTO report_flags VALUES(?,?,?,?) ON CONFLICT(report,subject) DO UPDATE SET reason=excluded.reason,at=excluded.at').run(id,subject,reason,at);
    return {received:true};
  }
  publicReport(r: Report) {
    const {authorId: _private, ...body} = r;
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM confirmations WHERE report=?').get(r.id) as any;
    return {...body, confirmationCount:count.n, sourceType:'RESIDENT'};
  }
  confirm(id: string, subject: string, active: boolean) {
    return this.transaction(()=>{
      const r=this.getReport(id);
      if(r.status==='HIDDEN') throw new ApiError(404,'NOT_FOUND','제보를 찾을 수 없습니다.');
      if(r.authorId===subject) throw new ApiError(403,'SELF_CONFIRMATION','다른 주민의 제보에 확인을 남길 수 있습니다.');
      if(active) this.db.prepare('INSERT OR IGNORE INTO confirmations VALUES(?,?)').run(id,subject);
      else this.db.prepare('DELETE FROM confirmations WHERE report=? AND subject=?').run(id,subject);
      return {...this.publicReport(r),viewerConfirmed:active};
    });
  }
  review(id: string, version: number, status: Report['status'], subject: string, reason: string, now: string) {
    return this.transaction(()=>{
      const r=this.getReport(id);
      if(r.version!==version) throw new ApiError(409,'VERSION_CONFLICT','제보가 수정되었습니다.');
      r.status=status;r.version++;
      this.db.prepare('UPDATE reports SET body=? WHERE id=?').run(JSON.stringify(r),id);
      this.audit(subject,id,'REVIEW_REPORT',reason,now);return this.publicReport(r);
    });
  }
  saveRoute(subject: string, name: string, search: RouteRequest) {
    const d=this.requireDataset();
    if([search.originNodeId,...(search.viaNodeIds??[]),search.destinationNodeId].some(id=>!d.nodes.some(n=>n.id===id))) throw new ApiError(422,'UNSURVEYED_CONNECTION','조사된 출입 지점을 선택하세요.');
    const r={id:randomUUID(),name,search};
    this.db.prepare('INSERT INTO saved_routes VALUES(?,?,?)').run(r.id,subject,JSON.stringify(r));return r;
  }
  savedRoutes(subject: string) { return (this.db.prepare('SELECT body FROM saved_routes WHERE subject=?').all(subject) as any[]).map(x=>JSON.parse(x.body)); }
  deleteSavedRoute(id: string, subject: string) { this.db.prepare('DELETE FROM saved_routes WHERE id=? AND subject=?').run(id,subject); }
}
export function validateSource(s: Dataset['edges'][number]['source'], isDemo: boolean) {
  if ((s.type==='DEMO')!==isDemo) throw new ApiError(400,'SOURCE_MODE_MISMATCH','실제·시연 출처를 혼합할 수 없습니다.');
  if (+new Date(s.recheckAt)<=+new Date(s.observedAt)) throw new ApiError(400,'INVALID_DATES','재확인 시점은 조사 이후여야 합니다.');
  if((s.type==='OFFICIAL'||s.type==='OPEN_MAP')&&!s.url) throw new ApiError(400,'SOURCE_URL_REQUIRED','공공정보 원본 URL이 필요합니다.');
}
export function validateDataset(d: Dataset) {
  const [x1,y1,x2,y2]=d.bbox;
  if(x1>=x2||y1>=y2||x1<124||x2>132||y1<33||y2>39) throw new ApiError(400,'INVALID_BBOX','대한민국 내 유효한 조사 범위를 지정하세요.');
  for(const list of [d.nodes,d.edges,d.facilities]) if(new Set(list.map(x=>x.id)).size!==list.length) throw new ApiError(400,'DUPLICATE_ID','중복 ID가 있습니다.');
  for(const n of d.nodes) if(!insideDataset(n.position,d)) throw new ApiError(400,'OUT_OF_COVERAGE','노드가 영역 밖입니다.');
  for(const f of d.facilities) { validateSource(f.source,d.isDemo);if(!insideDataset(f.position,d)) throw new ApiError(400,'OUT_OF_COVERAGE','시설이 영역 밖입니다.'); }
  for(const e of d.edges) {
    validateSource(e.source,d.isDemo);
    const a=d.nodes.find(n=>n.id===e.from),b=d.nodes.find(n=>n.id===e.to);
    if(!a||!b||a.id===b.id||distance(e.geometry[0]!,a.position)>1||distance(e.geometry.at(-1)!,b.position)>1||e.geometry.some(p=>!insideDataset(p,d))) throw new ApiError(400,'INVALID_EDGE','엣지 연결·형상을 확인하세요.');
    if(e.facilityIds.some(id=>!d.facilities.some(f=>f.id===id))) throw new ApiError(400,'INVALID_FACILITY_LINK','시설 연결을 확인하세요.');
    if(e.stairs&&(e.wheelchair==='PASS'||e.stroller==='PASS')) throw new ApiError(400,'INVALID_ACCESSIBILITY','계단을 휠체어/유모차 통과로 표시할 수 없습니다.');
  }
}
