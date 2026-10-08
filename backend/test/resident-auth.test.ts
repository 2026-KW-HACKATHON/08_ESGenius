import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { Store } from '../src/store.js';

const config={databasePath:':memory:',demoMode:true,production:false,host:'127.0.0.1',port:4100,jwtAudience:'authenticated',adminSubjects:[],corsOrigins:[]};
test('resident registration, password validation, account isolation, expiry and revocation',async t=>{
  let now=new Date('2026-10-08T01:00:00Z');
  const store=new Store(':memory:');const app=await buildApp(config,{store,now:()=>now});t.after(async()=>{await app.close();store.close();});
  const credentials={email:'resident@example.test',password:'Test-Only-Password!'};
  const input={...credentials,nickname:'월계 이웃',district:'월계1동'};
  const post=(url:string,payload:object)=>app.inject({method:'POST',url:'/api/v1/auth/'+url,payload});
  assert.equal((await post('signup',{...input,password:'short'})).statusCode,400);
  assert.equal((await post('signup',{...input,admin:true})).statusCode,400);
  assert.equal((await post('signup',input)).statusCode,201);
  assert.equal((await post('signup',input)).statusCode,409);
  const stored=store.db.prepare('SELECT * FROM residents').get() as any;
  assert.notEqual(stored.password_hash,credentials.password);assert.equal(stored.salt.length,32);
  assert.equal((await post('login',{...credentials,password:'wrong-password'})).statusCode,401);
  const login=await post('login',{...credentials,email:'RESIDENT@example.test'});assert.equal(login.statusCode,200);
  const {token,user}=login.json().data;assert.equal(user.admin,false);assert.equal(user.nickname,input.nickname);assert.equal(user.password_hash,undefined);
  const headers={authorization:'Bearer '+token};
  assert.equal((await app.inject({url:'/api/v1/me',headers})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/admin/audit',headers})).statusCode,403);
  assert.equal((await app.inject({url:'/api/v1/me',headers:{authorization:'Bearer resident_forged'}})).statusCode,401);
  await post('signup',{...input,email:'second@example.test'});
  const second=(await post('login',{...credentials,email:'second@example.test'})).json().data;
  assert.notEqual(second.user.subject,user.subject);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers})).statusCode,204);
  assert.equal((await app.inject({url:'/api/v1/me',headers})).statusCode,401);
  assert.equal((await app.inject({url:'/api/v1/me',headers:{authorization:'Bearer '+second.token}})).statusCode,200);
  now=new Date(+now+13*60*60*1000);
  assert.equal((await app.inject({url:'/api/v1/me',headers:{authorization:'Bearer '+second.token}})).statusCode,401);
});
test('production JWT configuration does not enable local account endpoints',async t=>{
  const app=await buildApp({...config,demoMode:false,production:true,jwtIssuer:'https://issuer.example',jwksUrl:'https://issuer.example/jwks'});t.after(()=>app.close());
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/signup',payload:{}})).statusCode,404);
});
