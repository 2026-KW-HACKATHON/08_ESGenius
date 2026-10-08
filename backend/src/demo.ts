import type { Dataset, Position } from './schemas.js';
export function demoDataset(now = new Date()): Dataset {
  const source = { type: 'DEMO' as const, name: '알고리즘 검증용 가상 데이터 · 현장 정보 아님', observedAt: now.toISOString(), recheckAt: new Date(+now + 86400000 * 30).toISOString() };
  const nodes = [
    { id: 'demo-start', name: '시연 출발점', position: { lat: 37.6220, lng: 127.0610 } },
    { id: 'demo-dark', name: '시연 조명 부족 연결점', position: { lat: 37.6228, lng: 127.0610 } },
    { id: 'demo-bright-1', name: '시연 조명 확인 연결점 1', position: { lat: 37.6220, lng: 127.0614 } },
    { id: 'demo-bright-2', name: '시연 조명 확인 연결점 2', position: { lat: 37.6236, lng: 127.0614 } },
    { id: 'demo-end', name: '시연 도착점', position: { lat: 37.6236, lng: 127.0610 } },
  ];
  const pos = (id: string): Position => nodes.find(n => n.id === id)!.position;
  const facilities = [
    { id: 'demo-lamp-1', name: '시연 가로등 1', type: 'STREETLIGHT' as const, status: 'WORKING' as const, position: pos('demo-bright-1'), source },
    { id: 'demo-lamp-2', name: '시연 가로등 2', type: 'STREETLIGHT' as const, status: 'WORKING' as const, position: pos('demo-bright-2'), source },
    { id: 'demo-cctv', name: '시연 CCTV', type: 'CCTV' as const, status: 'UNKNOWN' as const, position: pos('demo-bright-2'), source },
    { id: 'demo-bell', name: '시연 비상벨', type: 'EMERGENCY_BELL' as const, status: 'WORKING' as const, position: pos('demo-end'), source },
  ];
  const edge = (id: string, from: string, to: string, lighting: 'LIT' | 'DARK', facilityIds: string[] = [], stairs = false) => ({
    id, from, to, geometry: [pos(from), pos(to)], bidirectional: true, stairs,
    wheelchair: stairs ? 'BLOCKED' as const : 'PASS' as const, stroller: stairs ? 'BLOCKED' as const : 'PASS' as const,
    discomfort: lighting === 'DARK' ? 0.5 : 0, lighting, facilityIds, source,
  });
  return {
    id: 'wolgye-demo-v1', name: '월계동 부근 가상 보행망 (실제 도로와 무관)', isDemo: true,
    bbox: [127.045, 37.610, 127.075, 37.645], nodes, facilities,
    edges: [edge('dark-1','demo-start','demo-dark','DARK'), edge('dark-2','demo-dark','demo-end','DARK'),
      edge('bright-1','demo-start','demo-bright-1','LIT',['demo-lamp-1']),
      edge('bright-2','demo-bright-1','demo-bright-2','LIT',['demo-lamp-1','demo-lamp-2','demo-cctv']),
      edge('bright-3','demo-bright-2','demo-end','LIT',['demo-lamp-2','demo-bell']),
      edge('stairs','demo-start','demo-end','DARK',[],true)],
  };
}
