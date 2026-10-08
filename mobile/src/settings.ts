import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
export type Settings={apiUrl:string;kakaoKey:string};
export function validApiUrl(value:string){
  if(!value.trim())return '';
  const url=new URL(value.trim());
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('서버 주소는 경로 없이 입력하세요.');
  const local=url.hostname==='localhost'||url.hostname==='127.0.0.1'||/^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname)||/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname)||/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new Error('배포 서버에는 HTTPS 주소를 사용하세요.');
  return url.origin;
}
export function validKakaoKey(value:string){const key=value.trim();if(key&&!/^[a-fA-F0-9]{32}$/.test(key))throw new Error('카카오 JavaScript 키 32자리를 입력하세요.');return key;}
export async function loadSettings():Promise<Settings>{
  const {value}=await Preferences.get({key:'connection'});
  try{if(value){const s=JSON.parse(value);return {apiUrl:validApiUrl(s.apiUrl),kakaoKey:validKakaoKey(s.kakaoKey)};}}catch{/* invalid old preferences: use defaults */}
  return {apiUrl:import.meta.env.VITE_API_URL||(Capacitor.isNativePlatform()?'http://127.0.0.1:4101':''),kakaoKey:import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY||''};
}
export async function saveSettings(s:Settings){await Preferences.set({key:'connection',value:JSON.stringify({apiUrl:validApiUrl(s.apiUrl),kakaoKey:validKakaoKey(s.kakaoKey)})});}
