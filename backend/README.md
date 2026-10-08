# 월계온 TypeScript 백엔드

Node.js 24 + TypeScript + Fastify + SQLite로 만든 모바일 앱용 REST API입니다. 설치형 Android 앱은 상위 폴더의 `mobile/`에 있습니다. 이제 GitHub에는 `backend/`와 `mobile/`을 포함한 프로젝트 루트를 올립니다. 백엔드 실행 자체에는 Java/Android SDK가 필요 없습니다.

휴대폰 USB 개발은 `npm run setup` 후 `npm run mobile`을 사용하세요. 서버는 127.0.0.1:4101에서 실제 월계1동 자료를 별도 DB로 불러옵니다. [앱 설치·카카오 설정 안내](../mobile/README.md)를 따르세요. 이전 브라우저 전용 체험 화면과 역할 전환 API는 설치형 앱으로 대체했습니다.

## 실행

```sh
npm ci
npm run setup
npm run data:load
npm run dev
```

API: http://127.0.0.1:4100 · Swagger: http://127.0.0.1:4100/docs

`setup`은 로컬 .env와 무작위 개발용 토큰을 생성합니다. 기본 DEMO_MODE=false이며 data:load는 포함된 월계1동 실제 공개자료 스냅샷을 반입합니다. .env 및 SQLite DB는 Git에서 제외됩니다. npm run setup은 기존 .env를 덮어쓰지 않으므로 이전 시연 환경을 재사용할 경우 DEMO_MODE=false와 새 DATABASE_PATH를 지정하세요.

```sh
npm run check
npm test
npm run build
npm start
```

## 남겨 둔 파일

실제 월계동 도로굴착 공사 자료는 `data/wolgye-construction-notices.json`에 포함됩니다. `npm run data:constructions`로 서울시 공개자료를 다시 수집합니다. `GET /api/v1/construction-notices`는 공사 허가·기간을 제공하고, 기존 통제 API와 구분됩니다. 수집 범위·좌표 검증·갱신 방법은 [공사 자료 출처](data/CONSTRUCTION-SOURCES.md)를 참고하세요.

- src: 서버·인증·지도·공사·제보·저장 경로·야간 안내·경로 계산
- test: API와 경로, 월계1동 원자료·경계 검증
- scripts: 최초 설정·데이터 반입·명세 생성
- data: 실제 월계1동 JSON, 경계, 데이터 스키마와 명확히 표시된 테스트 예제
- docs / examples / openapi.json: 프론트 연동 명세와 클라이언트 예시
- package.json / package-lock.json / tsconfig.json: 재현 가능한 설치·빌드
- .env.example / .gitignore: 빈 설정 예시·제외 규칙. CI는 프로젝트 루트의 .github에 있습니다.

node_modules, dist, .env, 사용자 DB, SDK, APK, ZIP, 작업용 복사본은 업로드 파일에 포함하지 않습니다. `mobile/android`의 소스와 Gradle wrapper는 앱 빌드에 필요하므로 포함합니다. 의존성·빌드 결과·DB는 실행 명령으로 다시 생성합니다.

## 기능과 연동

기존 TypeScript 서버의 공사 차단/주의/해제, 최단·야간·편한 길 비교, 계단 회피, 보호 이동조건, 주민 제보/확인/검토, 시설 탐색, 저장 경로, 야간 근접 알림 API를 사용합니다.

- [프론트 연동](docs/mobile-integration.md)
- [데이터 반입](docs/data-import.md)
- [실제 월계1동 출처와 한계](docs/wolgye1-data.md)
- [OpenAPI](openapi.json)
- [모바일 TypeScript 클라이언트](examples/mobile-client.ts)

KAKAO_REST_API_KEY는 서버 .env에 설정하고 지도 화면용 JavaScript 키는 모바일 앱의 연결 설정에 넣습니다. 실제 로그인 공급자는 HTTPS JWT_JWKS_URL / JWT_ISSUER / JWT_AUDIENCE를 연결합니다. 운영 시 NODE_ENV=production, DEMO_MODE=false, 개발 토큰 제거가 필수입니다. 관리자 subject는 서버 ADMIN_SUBJECTS에서 지정합니다.

**이번 전환은 원래 TypeScript 구현을 기준으로 합니다.** Java 버전에 추가됐던 사진 업로드·자체 회원가입·신고 접수·프로필·오늘 소식·공사 자동 수집은 이 버전에 포함하지 않습니다. 프론트는 Java API가 아닌 이 폴더의 TypeScript OpenAPI에 맞춰 연결해야 합니다.

## 실제 데이터의 의미

실제 공개 좌표를 사용하지만 현장 검증 완료를 뜻하지 않습니다. 노드1,783개·구간1,886개·시설503개이며 조명·접근성은 미확인입니다. 시설은 조명 좌표17곳, 과거 보안등 주소290곳, CCTV190곳, 실내 비상벨 건물6곳입니다. 휠체어/유모차 통과 여부를 임의로 PASS로 만들지 않습니다. 공개자료의 기준일과 좌표 근거는 docs/wolgye1-data.md에서 확인할 수 있습니다. 공개 경계로 제보 위치를 검사합니다. OSM 도로는 실제 보도·출입구를 보장하지 않는 참고망입니다.

SQLite는 단일 인스턴스용입니다. 공개 서비스 전 HTTPS, 실제 인증 공급자, 현장 조사와 모바일 기기 검증이 필요합니다. 사진 업로드 지원 여부는 config의 photos=false로 표시합니다.

자동 검증은 `npm run check`, `npm test`, `npm run build`로 실행합니다. 앱용 행정경계 API와 검증된 사용자 조회, 경로 저장·제보 재시도·공사 통제 및 해제 흐름도 테스트합니다. 런타임 생성 파일은 삭제하지 않아도 Git에서 제외됩니다.

## 야간 경로 v2와 개발 서버 주민 계정

Edge에 선택 필드 passageWidthM(0~100m)을 추가했습니다. 구간 출처의 재확인 기한이 지난 폭 정보는 UNKNOWN으로 취급합니다. 야간 비용은 조명(LIT 1 / UNKNOWN 3 / DARK 4), 폭(2m 미만 +4 / 미확인 +1), 구간에 연결된 작동·유효 가로등 없음(+0.4), 작동·유효 안심벨 없음(+0.4)의 합에 거리를 곱합니다. CCTV 수로 안전성을 보증하거나 점수를 올리지 않습니다. 폭 2m는 제품 비교 기준이며 법적 안전 기준이 아닙니다. 기존 계단·접근성·공사 제외와 detour 제한을 유지합니다. 응답 nightSafety는 좁은 구간 거리, 폭 미확인 거리, 유효 시설 수를 제공합니다. 이 변경은 graphVersion에 반영됩니다.

JWT를 설정하지 않은 비production 서버에서만 /auth/signup, /auth/login, /auth/logout을 제공합니다. 운영 배포는 기존 JWT 공급자를 유지하며 외부 이메일 인증을 설정해야 합니다. 로컬 주민 정보는 기존 SQLite 파일의 residents / resident_sessions에 추가되며 지도 자료는 수정하지 않습니다. 계정은 운영 권한을 얻지 않습니다. 비밀번호 scrypt(N=32768,r=8,p=1)와 16바이트 salt, 32바이트 무작위 세션(서버에 해시만 저장), 12시간 만료, 엔드포인트별 속도 제한을 적용합니다. 로컬 이메일/생활권은 본인 인증 정보가 아닙니다.
