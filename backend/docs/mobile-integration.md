# 피그마 디자인 → 모바일 앱 API 연결

기본 주소 `http://127.0.0.1:4100/api/v1`. 실제 기기의 localhost는 개발 PC가 아니므로 PC LAN IP 또는 HTTPS 개발 주소를 사용합니다. native SDK 설정은 앱 기술 선택 후 Android/iOS 각각 적용합니다. 카카오 REST 키는 서버에만 둡니다.

## 화면별 연결

| 첨부 디자인/화면 | API | 앱 처리 |
|---|---|---|
| 첫 실행 | GET `/config`, `/coverage` | 지원 bbox, 시연 표시, 등록된 지도 연결점 확보 (OPEN_MAP은 현장 미확인) |
| 검색창 | GET `/places?q=광운대학교` | 키 없으면 등록 지점만 검색. 미연동 상태 표시 |
| 출발·도착 | GET `/coverage/nearby?lat=…&lng=…&radiusM=500` | 지도·검색에서 장소 선택. `/routes/plan`이 100m 이내에서 서로 연결되는 도로 지점을 탐색. 장소~도로 간 직선 구간은 보행 경로로 생성하지 않음 |
| 레이어·가로등·CCTV | GET `/map/items?bbox=…&types=STREETLIGHT,CCTV,CONSTRUCTION` | 카카오 마커, 출처/상태, truncated면 영역 축소 |
| 반딧불 추천 경로 | POST `/routes/plan` | NIGHT 카드와 FAST 카드 비교, 선택 GeoJSON을 노란 선으로 표시 |
| 약 N분 / 가로등 N / CCTV N | 경로의 `estimatedDurationSec`, `facilities` | 시간은 올림해 분 표시. 시설은 등록 수이며 실시간 작동 수가 아님 |
| 출발! | 앱 위치 권한 + POST `/night/check` | 활성 앱에서 위치/정확도/측정시각 전달. 서버 위치 이력 저장 없음 |
| 공사 경고 | 경로 `segments[].constructionIds`, GET `/constructions` | CAUTION과 통행 차단 표시. 데이터 버전 변경 시 재검색 |
| 저장 아이콘 / 저장한 길 | POST/GET/DELETE `/me/routes` | 로그인 필요. 저장된 search로 이동 시 재탐색 |
| 밤길 제보 | POST `/reports`, GET `/reports` | UUID 요청 키 유지, 확인/취소 API 연결 |
| 내 정보 | 앱 인증 SDK + GET `/me/reports` | 로그인/로그아웃은 선택한 인증 공급자가 담당 |
| 안심 도움 | GET `/facilities/nearby`, config의 `help.phoneUri` | 네이티브 공유/전화는 사용자 조작으로 실행 |

## 경로 요청

```json
{
  "originNodeId": "demo-start",
  "destinationNodeId": "demo-end",
  "profile": "WHEELCHAIR",
  "avoidStairs": true,
  "preference": "NIGHT",
  "maxDetourRatio": 1.5
}
```

응답 `{data,meta}`. `data.status`는 OK / NO_MATCHING_ROUTE / ALREADY_ARRIVED. `data.routes`는 최대 2개. 같은 길이면 labels에 FAST/NIGHT가 함께 있고 카드 하나만 표시합니다. 각 route의 `geometry.coordinates`는 **[경도, 위도]** 순서입니다. 지도 SDK의 LatLng 생성자 순서에 맞게 변환합니다. `meta.isDemo`는 지도·경로 카드에 상시 표시합니다.

`lighting`은 관찰된 밝음/어둠/미확인 구간 길이입니다. 실제 실시간 조도나 안전등급이 아닙니다. 시설 개수는 중복 제거된 등록 수. 예상시간은 1m/s 계산임을 안내합니다. API의 실제 전체 요청·경로 응답 스키마는 `openapi.json`에 있습니다.

## 위치 안내

```json
{
  "position": {"lat": 37.622, "lng": 127.0614},
  "accuracyM": 10,
  "measuredAt": "현재 기기가 측정한 ISO 8601 시각",
  "recentAlerts": []
}
```

`measuredAt`은 실제 timestamp를 넣어야 합니다. 오차 50m 초과, 수신 30초 초과, 미래 5초 초과면 PAUSED. 최근 시설 안내는 `recentAlerts`에 `{facilityId,alertedAt}`로 최대 100개 전달해 60초 중복 억제. 앱은 80m 밖으로 이탈 후 재진입했는지 추가 관리하고, 조명 구간 warnings도 edgeId별로 말풍선 중복을 억제합니다. 서버가 반환하는 직선 근접은 건너편 도로나 건물 내부 접근 가능성을 의미하지 않습니다.

위치 수집 시작·종료는 앱이 관리합니다. MVP 제안 호출 빈도는 이동 중 5초 또는 10m 이동 시이며, 네트워크 단절 시 중단 상태를 보여줍니다. 백그라운드 서비스·권한·배터리 관리·회전별 음성 안내는 이 API가 구현하지 않습니다. 이탈 시 새 검색을 제안할 수 있으나 자동으로 미조사 연결선을 그리면 안 됩니다.

앱 복귀/출발 전/이동 중 60초 간격에 `/routes/version` 확인 → 기존 버전과 다르면 POST `/routes/search`. 버전이 같아도 `segments[].source.recheckAt` 경과나 예정 공사 시작 등 시간 조건은 바뀔 수 있으므로 60초마다 재검색하거나 가장 가까운 예정 시각에 재검색합니다. 서버는 매 검색에서 현재 시각으로 계산합니다.

## 오류와 인증

로그인 후 발급받은 access token을 `Authorization: Bearer …`로 전달합니다. 서버 JWT 검증 설정을 같은 인증 공급자에 맞춥니다. 로컬 개발 토큰은 PC에서만 사용하고 앱에 하드코딩하지 않습니다.

- 400: 입력 문제. error.message 표시.
- 401: 재로그인. 403: 권한 없음.
- 404: 없는/숨김 제보. 409: 상태 충돌 또는 재시도 키 충돌.
- 422: 조사 영역/출입 연결 문제. 429: 호출 간격 조절.
- 503 DATA_NOT_READY: 조사 자료 없음. MAP_PROVIDER_UNAVAILABLE: 외부 장소 검색 실패.
- HTTP 200 + NO_MATCHING_ROUTE: 시스템 고장과 구분하여 조건을 만족하는 조사 경로 없음 표시.

제보 생성은 `Idempotency-Key` UUID 필수. 타임아웃 재시도는 같은 본문·같은 키, 새 제보는 새 키. 사진은 최대 2장(JPEG/PNG, 장당 500KB 이하) 첨부하며 서버에서 형식·크기를 검사합니다.

## 출시 전 필요한 연결

카카오 앱 등록·Native 키, REST 키, 모바일 앱 인증 공급자, 실제 월계동 조사 보행망, 시설 출처·확인 시점, 운영자 계정, HTTPS 주소. 이 설정과 현장 검증 전에는 시연용입니다. 긴급전화의 실제 발신이나 위치 공유 전송은 테스트에서 자동 실행하지 않습니다.

## 장소 기반 경로 계획 (2026-10-08)

POST /api/v1/routes/plan은 origin, destination, via(최대 3개)의 {lat,lng}와 profile, preference(FAST/COMFORT/NIGHT), avoidStairs, avoidSlopes, dataPolicy(VERIFIED/REFERENCE), maxDetourRatio를 받습니다. 연결된 실제 도로망에서 방향·통제·계단·경사·접근성 조건을 먼저 적용하고, 각 장소 100m 안의 후보 중 연결 가능한 조합을 찾습니다. 장소와 도로 사이 거리 합을 우선 최소화하고 같으면 경로 길이로 선택합니다.

connections는 요청 장소와 실제 안내 시작/종료 도로, 직선 이격거리, connectorSurveyed=false를 반환합니다. 지도는 실제 도로 geometry만 그립니다. resolvedSearch는 저장 가능한 연결점 요청입니다. 기존 /routes/search의 연결점 입력도 지원합니다.

VERIFIED는 미확인 경사/접근성을 허용하지 않습니다. REFERENCE는 알려진 계단(회피 조건 활성 시), 급경사(6% 초과), 명시적 통행 불가와 공사 차단은 계속 제외하며 미확인 구간을 품질 정보로 제공합니다. 휠체어는 VERIFIED가 기본이고 화면에서 명시적으로 REFERENCE를 선택합니다.

NIGHT REFERENCE는 실제로 연결된 시설의 현재 확인 상태에 더해 등록 가로등/안심벨 위치 25m 근접 정보를 별도 가중치로 사용합니다. 이는 밝기 관찰·작동 확인·횡단 가능 여부를 뜻하지 않습니다. quality.registeredStreetlights/registeredBells와 lighting.unknownM, nightSafety.workingStreetlights/workingBells를 혼동하지 마세요. CCTV는 경로 비용에 사용하지 않습니다.
