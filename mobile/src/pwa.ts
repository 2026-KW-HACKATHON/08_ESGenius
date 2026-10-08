type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
let installEvent:InstallEvent|undefined;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e as InstallEvent;});
window.addEventListener('appinstalled',()=>{installEvent=undefined;});
export async function installApp(){
  if(matchMedia('(display-mode: standalone)').matches)return '이미 홈 화면 앱으로 사용 중입니다.';
  if(installEvent){await installEvent.prompt();const result=await installEvent.userChoice;installEvent=undefined;return result.outcome==='accepted'?'홈 화면에 추가했어요.':'나중에 다시 추가할 수 있어요.';}
  return 'Android Chrome 메뉴(⋮) → 홈 화면에 추가 → 설치 또는 바로가기 만들기를 선택하세요. HTTPS 주소에서 열어주세요.';
}
if(import.meta.env.PROD&&'serviceWorker' in navigator&&window.isSecureContext){
  window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{/* installation is optional; the online app remains usable */});});
}
