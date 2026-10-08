# 실제 월계동 데이터 반입

현재 제공되는 실제 스냅샷은 data/wolgye1.dataset.json이며 npm run data:load로 반입합니다. 출처와 현장 미확인 범위는 [월계1동 자료 안내](wolgye1-data.md)를 참조하세요. source.type=OPEN_MAP과 dateMeaning, 선택적인 boundary Polygon을 지원합니다.

현재 `data/demo.dataset.json`은 구조 예시용 가상 자료입니다. 원본 자료를 확보하지 않은 시설·공사 좌표를 실제 정보로 배포하지 않습니다.

## 1. 데이터 준비

`data/dataset.schema.json`에 맞는 JSON을 만듭니다. 필수 구성:

- `id`, `name`, `isDemo:false`, `bbox:[minLng,minLat,maxLng,maxLat]`.
- nodes: 실제 조사한 교차·횡단·출입 지점 ID, 명칭, position.
- edges: from/to, 실제 선형 geometry, bidirectional, stairs, wheelchair/stroller 판정, 불편도, 조명 관찰, source, facilityIds.
- facilities: CCTV/STREETLIGHT/EMERGENCY_BELL, 실제 좌표, 작동 상태 WORKING/BROKEN/UNKNOWN, source.
- source: OFFICIAL/FIELD_SURVEY, 제공기관/조사명, 원본 URL(OFFICIAL 필수), observedAt, recheckAt.

경사·폭·턱에 대한 현장조사 근거로 wheelchair/stroller PASS/BLOCKED/UNKNOWN을 판정해야 합니다. 조명은 현장 관찰 또는 신뢰할 수 있는 구간 자료로 LIT/DARK/UNKNOWN을 설정합니다. 가로등과 가깝다는 이유만으로 LIT로 바꾸지 않습니다. 현재 형식은 조사 결과 판정을 저장하며, 경사·폭·턱의 원시 수치까지 별도 계산하지는 않습니다.

지도 SDK 배경 도로의 임의 트레이싱·스크래핑을 데이터 확보 방식으로 가정하지 않습니다. 적법하게 사용할 수 있는 공개 보행망 또는 직접 조사한 형상을 사용하고 해당 출처의 이용 조건을 확인합니다. 같은 좌표 주변의 차도·보도·고가·지하를 잘못 연결하지 않게 현장에서 확인합니다. facilityIds는 같은 통행 구간에서 참고할 수 있다고 검토한 시설만 연결합니다.

## 2. 별도 실제 DB로 검증

로컬 검증에서는 NODE_ENV=development를 유지할 수 있지만 아래 두 값을 변경합니다.

```dotenv
DEMO_MODE=false
DATABASE_PATH=./data/wolgye-real.sqlite
```

```powershell
npm.cmd run data:import -- .\data\wolgye-survey.json
```

스키마, 좌표 범위, 중복 ID, 엣지 시작·끝 형상, 시설 참조, 계단 판정, 출처 일자, 실제/시연 혼합을 검증합니다. 모든 교차로의 지형적 연결을 자동 검증하는 것은 아니므로 현장 확인이 필요합니다. 같은 DB에 재반입 시 활성 공사가 참조하는 엣지를 삭제할 수 없습니다. ID는 조사 업데이트에도 유지해야 합니다.

단일 로컬 SQLite 파일을 사용하므로 DB/WAL 파일을 실행 중 임의 복사하지 말고 SQLite 일관성 있는 백업 절차 또는 서버 정지 후 백업을 사용합니다. 배포 시 영속 볼륨이 필요합니다. 실제 DB를 시연 DB로 덮어쓰지 않습니다.

## 3. 공사 반영

운영자 인증 후 POST `/api/v1/admin/constructions`에 위치, 영향 edgeIds, BLOCK/CAUTION, 시작·종료 예정, 출처, 운영 확인 사유를 등록합니다. Idempotency-Key UUID 필요. 공공 공사명만 보고 보행로 전체를 자동 폐쇄하지 않습니다. 어떤 보도·횡단·출입구가 영향을 받는지 확인합니다.

```json
{
  "title": "시연용 통행 제한",
  "description": "계약 예시입니다. 실제 공사 정보가 아닙니다.",
  "position": {"lat": 37.622, "lng": 127.061},
  "edgeIds": ["dark-1"],
  "impact": "BLOCK",
  "startsAt": "2026-10-01T00:00:00Z",
  "expectedEndAt": "2026-10-02T00:00:00Z",
  "source": {
    "type": "DEMO", "name": "시연용",
    "observedAt": "2026-10-01T00:00:00Z",
    "recheckAt": "2026-10-08T00:00:00Z"
  },
  "reason": "시연 공사 등록"
}
```

위 예시는 시연 모드에서만 수용됩니다. 실제 반입에서는 FIELD_SURVEY/OFFICIAL과 실제 데이터 ID·날짜로 작성합니다. 종료 예정일이 지나면 needsRecheck=true가 되지만 BLOCK을 유지합니다. 확인 후 POST `/admin/constructions/:id/resolve`에 `expectedVersion`, `reason`을 보내야 해제됩니다. 신규 공사·해제 시 graphVersion 증가. 예정 시작 시각 진입은 DB 변경이 아니므로 앱은 시간에 따른 재검색도 수행합니다.

원본 공공데이터 공급자·API 키가 아직 지정되지 않았으므로 자동 수집기는 이번 버전에 포함하지 않았습니다. 현재는 검증된 정규화 JSON 반입과 운영자 공사 API가 실제 데이터 입력 경로입니다.

## 4. 현장 검증 체크

출발·도착 1쌍에서 실제로 걸어보며 계단/차단 회피, 밤길 후보의 조명 상태, 조사 출입구 접근, GPS 오차를 확인합니다. 최소 약 5개 생활동선 목표와 연결부·우회 동선을 확보합니다. 지도 시설 배치나 경로 선이 예쁘게 나오는 것만으로 완료 처리하지 않습니다.
