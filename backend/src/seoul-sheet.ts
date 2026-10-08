/** Parse Seoul's public sheet notation as data, never execute downloaded code. */
export function parseSheet(text:string):{result:string;page?:{totalCount:number};list:Record<string,string>[]} {
  let normalized='',quoted=false,escape=false;
  for(const c of text){
    if(quoted&&c.charCodeAt(0)<32){normalized+=JSON.stringify(c).slice(1,-1);continue;}
    normalized+=c;if(c==='"'&&!escape)quoted=!quoted;escape=c==='\\'&&!escape;
  }
  normalized=normalized.replace(/("(?:\\.|[^"\\])*")|([A-Za-z_]\w*)(\s*:)/g,(_all,s,key,colon)=>s??JSON.stringify(key)+colon)
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g,(_all,s,end)=>s??end);
  const data=JSON.parse(normalized);
  if(data.result!=='ok'||!Array.isArray(data.list))throw new Error('Invalid public sheet response');
  return data;
}
