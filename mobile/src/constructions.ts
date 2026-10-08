import type { Construction, Route } from './types';
export function constructionStatus(c:Construction,now=Date.now()){
  if(c.status==='RESOLVED')return '통제 해제';
  if(Date.parse(c.startsAt)>now)return '예정';
  return c.impact==='BLOCK'?'통행 금지':'통행 주의';
}
export function constructionCautions(route:Route|undefined){return [...new Set(route?.segments?.flatMap(s=>s.constructionIds)??[])];}
export function constructionSummary(excluded:number,route:Route|undefined){
  const n=constructionCautions(route).length;
  return `${excluded?`등록된 통행 금지 ${excluded}개 구간을 제외해 계산했습니다.`:'등록된 통행 금지 구간을 반영해 계산합니다.'}${n?` 선택한 경로에 공사 주의 ${n}건이 포함됩니다.`:''}`;
}
