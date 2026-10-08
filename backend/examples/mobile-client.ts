// React Native / TypeScript integration example. No secret API key in the app.
// Flutter/Swift/Kotlin can generate clients from ../openapi.json instead.
import type { RouteRequest, RouteResult, NightCheck, ReportInput } from '../src/contracts.js';
type Envelope<T>={data:T;meta:{isDemo:boolean;graphVersion:string}};
export class WolgyeApi {
  constructor(private baseUrl:string,private getAccessToken:()=>Promise<string|undefined>){}
  private async request<T>(path:string,method='GET',body?:unknown,idempotencyKey?:string):Promise<Envelope<T>> {
    const token=await this.getAccessToken();
    const response=await fetch(`${this.baseUrl}/api/v1${path}`,{method,headers:{
      ...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`} : {}),
      ...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{}),
    },body:body?JSON.stringify(body):undefined});
    const result=await response.json();
    if(!response.ok)throw Object.assign(new Error(result.error?.message??'요청 실패'),{status:response.status,code:result.error?.code});
    return result;
  }
  routes(search:RouteRequest){return this.request<RouteResult>('/routes/search','POST',search);}
  coverage(){return this.request('/coverage');}
  mapItems(){return this.request('/map/items');}
  nightCheck(input:NightCheck){return this.request('/night/check','POST',input);}
  report(input:ReportInput,requestUuid:string){return this.request('/reports','POST',input,requestUuid);}
  savedRoutes(){return this.request('/me/routes');}
}
