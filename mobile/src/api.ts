import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { Settings } from './settings';
export class ApiError extends Error {constructor(message:string,public status:number,public code?:string){super(message);}}
export class Api {
  token='';
  constructor(public settings:Settings){}
  async call<T>(path:string,method='GET',body?:unknown,key?:string):Promise<T>{
    const url=this.settings.apiUrl+'/api/v1'+path;
    const headers:Record<string,string>={Accept:'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(this.token)headers.Authorization='Bearer '+this.token;
    if(key)headers['Idempotency-Key']=key;
    let status:number,data:any;
    try{
      if(Capacitor.isNativePlatform()){
        const res=await CapacitorHttp.request({url,method,headers,data:body,connectTimeout:10000,readTimeout:15000,disableRedirects:true,responseType:'json'});
        status=res.status;data=res.data;
      }else{
        const res=await fetch(url,{method,headers,cache:'no-store',body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
        status=res.status;data=status===204?null:await res.json();
      }
    }catch{throw new Error('서버에 연결하지 못했어요. 서버 실행과 연결 설정을 확인해주세요.');}
    if(status===204)return null as T;
    if(status<200||status>=300)throw new ApiError(data?.error?.message||'요청을 처리하지 못했어요.',status,data?.error?.code);
    if(!data||!('data' in data))throw new Error('서버 응답 형식이 올바르지 않습니다.');
    return data.data as T;
  }
}
