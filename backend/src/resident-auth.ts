import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Store } from './store.js';
import { ApiError } from './errors.js';

const hashToken=(token:string)=>createHash('sha256').update(token).digest('hex');
const derive=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
type Resident={id:string;email:string;nickname:string;district:string;salt:string;password_hash:string};
// Local membership for the current installation. Production keeps the configured JWT provider.
export class ResidentAuth {
  constructor(private store:Store){
    store.db.exec(`CREATE TABLE IF NOT EXISTS residents(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,nickname TEXT NOT NULL,district TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resident_sessions(hash TEXT PRIMARY KEY,resident_id TEXT NOT NULL REFERENCES residents(id),expires_at INTEGER NOT NULL);`);
  }
  async signup(input:{email:string;password:string;nickname:string;district:string}){
    const email=input.email.trim().toLowerCase(),nickname=input.nickname.trim();
    if(!nickname)throw new ApiError(400,'INVALID_NICKNAME','닉네임을 입력해주세요.');
    const salt=randomBytes(16).toString('hex'),passwordHash=(await derive(input.password,salt)).toString('hex');
    try{this.store.db.prepare('INSERT INTO residents VALUES(?,?,?,?,?,?)').run('resident-'+randomUUID(),email,nickname,input.district,salt,passwordHash);}
    catch(e){if((e as Error).message.includes('UNIQUE'))throw new ApiError(409,'ACCOUNT_EXISTS','가입 정보를 확인하거나 로그인해주세요.');throw e;}
    return {registered:true};
  }
  async login(email:string,password:string,now:Date){
    const user=this.store.db.prepare('SELECT * FROM residents WHERE email=?').get(email.trim().toLowerCase()) as Resident|undefined;
    const key=await derive(password,user?.salt??'00000000000000000000000000000000');
    if(!user||!timingSafeEqual(key,Buffer.from(user.password_hash,'hex')))throw new ApiError(401,'INVALID_LOGIN','이메일과 비밀번호를 확인해주세요.');
    const token='resident_'+randomBytes(32).toString('base64url'),expiresAt=+now+12*60*60*1000;
    this.store.db.prepare('DELETE FROM resident_sessions WHERE expires_at<=?').run(+now);
    this.store.db.prepare('INSERT INTO resident_sessions VALUES(?,?,?)').run(hashToken(token),user.id,expiresAt);
    return {token,expiresAt:new Date(expiresAt).toISOString(),user:this.publicUser(user)};
  }
  identity(token:string,now:Date){
    const user=this.store.db.prepare('SELECT r.* FROM residents r JOIN resident_sessions s ON s.resident_id=r.id WHERE s.hash=? AND s.expires_at>?').get(hashToken(token),+now) as Resident|undefined;
    return user?this.publicUser(user):undefined;
  }
  logout(token:string){this.store.db.prepare('DELETE FROM resident_sessions WHERE hash=?').run(hashToken(token));}
  private publicUser(user:Resident){return {subject:user.id,admin:false,nickname:user.nickname,district:user.district};}
}
