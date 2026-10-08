# HTTPS 배포

준비물: Docker Compose가 설치된 서버, 그 서버를 가리키는 도메인, 80/443 포트, Kakao 앱 키, Supabase 이메일 로그인 프로젝트(또는 호환되는 JWT 서비스).

1. 이 저장소를 서버에 복사합니다. `deploy/.env.example`을 `deploy/.env`로 복사합니다.
2. `APP_DOMAIN`에 프로토콜 없이 실제 도메인을 입력합니다.
3. 카카오 JavaScript 키와 REST 키를 각각 지정합니다. 카카오에 `https://해당도메인`을 등록합니다.
4. Supabase URL/public anon 키를 입력합니다. `JWT_ISSUER`는 `https://프로젝트.supabase.co/auth/v1`, `JWT_JWKS_URL`은 `https://프로젝트.supabase.co/auth/v1/.well-known/jwks.json`입니다. 프로젝트의 비대칭 서명 키/JWKS 구성을 사용합니다. 프론트에 service_role 키를 넣지 마세요.
5. 관리 기능이 필요하면 운영자 계정 subject를 `ADMIN_SUBJECTS`에 지정합니다. 미지정이면 관리자 권한을 주지 않습니다.

```sh
cd deploy
docker compose --env-file .env config --quiet
docker compose --env-file .env up --build -d
```

Caddy가 인증서를 발급받아 프론트와 `/api`를 같은 HTTPS 주소로 서비스합니다. 백엔드 포트는 외부로 게시하지 않습니다. 최초 빈 DB에만 실제 월계1동 스냅샷을 반입하며 재시작 때 운영 자료를 덮어쓰지 않습니다. SQLite는 `app_data`, TLS 자료는 `caddy_data` 볼륨에 남습니다. `down -v`는 데이터를 지우므로 사용하지 마세요. 데이터 갱신 전 DB 백업과 공사 구간 참조 검토가 필요합니다.

검증: `https://도메인/health`, 지도 표시, 장소 검색, 출발·도착 선택, 제보 로그인/등록, Android Chrome 홈 화면 추가, GPS 허용·거부와 네트워크 단절을 확인합니다. 공개키 설정을 바꾸면 web 이미지를 다시 빌드합니다.

현재 작업 환경에는 Docker가 없어 컨테이너 빌드와 TLS 발급은 실행 검증하지 못했습니다. TypeScript 빌드·백엔드 테스트·로컬 웹 흐름은 별도 검증했습니다. 도메인/서버/키가 준비되기 전에는 외부 휴대폰에서 열 수 있는 배포 URL이 생기지 않습니다.
