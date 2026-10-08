import { ApiError } from './errors.js';
export async function searchKakao(q:string,key:string,fetcher:typeof fetch=fetch) {
  const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
  url.searchParams.set('query',q);url.searchParams.set('x','127.061');url.searchParams.set('y','37.623');url.searchParams.set('radius','3000');url.searchParams.set('size','15');
  let response:Response;
  try{response=await fetcher(url,{headers:{Authorization:`KakaoAK ${key}`},signal:AbortSignal.timeout(5000)});}catch{throw new ApiError(503,'MAP_PROVIDER_UNAVAILABLE','장소 검색 연결에 실패했습니다.');}
  if(!response.ok)throw new ApiError(503,'MAP_PROVIDER_UNAVAILABLE','장소 검색 공급자 설정 또는 호출 한도를 확인하세요.');
  const body=await response.json() as {documents?:Record<string,string>[]};
  if(!Array.isArray(body.documents))throw new ApiError(503,'MAP_PROVIDER_UNAVAILABLE','장소 검색 응답을 확인할 수 없습니다.');
  return body.documents.filter(x=>Number.isFinite(Number(x.x))&&Number.isFinite(Number(x.y))).map(x=>({id:x.id,name:x.place_name,address:x.road_address_name||x.address_name,position:{lng:Number(x.x),lat:Number(x.y)},provider:'KAKAO',url:x.place_url}));
}
