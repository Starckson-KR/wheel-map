# ODsay 국내 중계 (relay)

배포판 Worker `/transit`이 ODsay를 직접 부르면 포털 방화벽이 Cloudflare(해외) 요청을 막습니다. 이 작은 서버를 국내 클라우드(rocky-8.10)에 두고, Worker가 이 서버를 거쳐 ODsay를 부르게 합니다.

- 파일: `server.mjs` 하나(의존성 없음, Node 18 이상).
- 받는 요청: `GET /odsay/path?SX=&SY=&EX=&EY=` (출발·도착 좌표 4개만) + 헤더 `x-relay-secret`. 그 밖의 경로·파라미터는 거절(404/400), 비밀이 틀리면 401, 분당 상한 초과 429.
- ODsay 키(`ODSAY_KEY`)는 이 서버 환경변수에만 둡니다. 로그·응답에는 값이 나오지 않습니다.
- Worker는 `TRANSIT_RELAY_URL`과 `TRANSIT_RELAY_SECRET`이 둘 다 있을 때만 이 서버를 씁니다. 없으면 예전처럼 ODsay를 직접 부릅니다(캐시·하루 상한·IP 제한·출처 확인은 그대로).

## 서버에서 할 일 (순서대로)

1. **바깥에서 이 서버에 닿는지 먼저 확인합니다.** 승인 안내에는 공인 IP·열린 포트·도메인 설명이 없었습니다(확인 필요). 서버 안에서 `curl -s ifconfig.me`로 공인 IP를 보고, 6번까지 끝낸 뒤 내 PC(또는 휴대폰 데이터)에서 `curl http://공인IP:8787/health`가 되는지 봅니다. 안 되면 클라우드 관리 화면의 보안그룹·방화벽에서 포트를 열 수 있는지 확인합니다. 어떤 방법으로도 바깥에서 못 닿으면 이 방식은 쓸 수 없습니다.
2. Node 설치(확인 필요: rocky-8.10에서 `dnf`로 설치 가능한지): `sudo dnf module install -y nodejs:20` 또는 `sudo dnf install -y nodejs`. `node -v`가 18 이상이면 됩니다. 인터넷 접속이 막혀 있으면 설치가 안 될 수 있습니다.
3. 파일 올리기: `server.mjs`를 서버의 `/opt/relay/server.mjs`로 복사합니다(`scp`).
4. 환경변수 파일 만들기 `/etc/relay.env` (값은 직접 채우고, 채팅·git에 올리지 않습니다):
   ```
   RELAY_SECRET=길고 무작위인 문자열
   ODSAY_KEY=ODsay 키
   PORT=8787
   ```
   `sudo chmod 600 /etc/relay.env`로 본인만 읽게 합니다.
5. systemd 등록 `/etc/systemd/system/relay.service`:
   ```
   [Unit]
   Description=ODsay relay
   After=network-online.target

   [Service]
   EnvironmentFile=/etc/relay.env
   ExecStart=/usr/bin/node /opt/relay/server.mjs
   Restart=always
   User=nobody

   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl daemon-reload && sudo systemctl enable --now relay` 후 `systemctl status relay`로 실행 중인지 봅니다(`node` 경로는 `which node`로 확인).
6. 방화벽 포트 열기(서버 안, firewalld가 켜져 있을 때): `sudo firewall-cmd --permanent --add-port=8787/tcp && sudo firewall-cmd --reload`. 클라우드 관리 화면의 보안그룹에도 같은 포트를 열어야 할 수 있습니다(확인 필요).
7. 동작 확인(서버 안에서):
   - `curl -s localhost:8787/health` → `{"ok":true}`
   - 비밀 없이: `curl -s -o /dev/null -w "%{http_code}\n" "localhost:8787/odsay/path?SX=126.9097&SY=35.182&EX=126.9005&EY=35.1722"` → `401`
   - 비밀 있이(ODsay 상한이 1회 줄어듭니다): `curl -s -H "x-relay-secret: 비밀" "localhost:8787/odsay/path?SX=126.9097&SY=35.182&EX=126.9005&EY=35.1722"` → ODsay JSON(`result` 또는 `error`). 방화벽 차단 HTML이 오면 이 서버에서도 막힌 것입니다.
8. Worker에 연결(사용자가 직접): `cd worker`에서 `npx wrangler secret put TRANSIT_RELAY_SECRET`(위 RELAY_SECRET과 같은 값), 주소는 `wrangler.toml`의 `[vars]`에 `TRANSIT_RELAY_URL = "https://…"`. 그 뒤 배포. 되돌리려면 `TRANSIT_RELAY_URL`을 지우면 예전 방식으로 돌아갑니다.

## https가 필요할 때

Worker가 `http://공인IP:8787`을 부를 수 있는지는 확인 필요입니다(Cloudflare Worker의 http·비표준 포트 호출 제한 가능성). 안 되거나 비밀 헤더를 평문으로 보내기 싫으면 둘 중 하나:

- **Cloudflare Tunnel (`cloudflared`)**: 서버에서 바깥으로만 연결하므로 포트를 열 필요가 없고 https 주소가 생깁니다. 다만 Cloudflare 계정과 도메인 설정이 필요하고, 이 경우 중계 앞단이 Cloudflare를 지나므로 ODsay 쪽 차단과는 무관합니다(서버에서 ODsay로 나가는 길은 국내 IP 그대로). 이때 `HOST=127.0.0.1`로 둡니다.
- **Caddy**: 서버 앞에 두면 도메인이 있을 때 https 인증서를 자동으로 받습니다. 도메인 필요(확인 필요: 무료 도메인이 제공되는지).

## 로컬 시험(가짜 ODsay)

`ODSAY_ENDPOINT=http://127.0.0.1:9911/api RELAY_SECRET=x ODSAY_KEY=y PORT=8799 node server.mjs` 로 띄우고, 간단한 가짜 서버를 9911에 둡니다. 실제 ODsay는 호출하지 않습니다.
