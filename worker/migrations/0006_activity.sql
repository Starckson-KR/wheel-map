-- 개발자 관리용 접속 기록·기기·오류 기록. IP는 저장하지 않는다(코드가 읽지 않는다). 지우는 기준은 worker/src/activity.ts.
-- 기기 한 대 = (사용자, 기기 id) 한 줄. 기기 id는 앱이 localStorage에 만든 무작위 값이다.
CREATE TABLE user_devices (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  count INTEGER NOT NULL,
  device TEXT NOT NULL,
  os TEXT NOT NULL,
  browser TEXT NOT NULL,
  ua TEXT NOT NULL,          -- 원문 User-Agent, 300자까지
  build TEXT NOT NULL,
  standalone INTEGER NOT NULL,
  screen TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX idx_user_devices_last ON user_devices(last_at);

-- 접속 기록: 앱을 열 때·30분 넘게 숨겨졌다 다시 보일 때·로그인·가입. 사용자당 최대 200건, 30일.
CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  build TEXT NOT NULL,
  standalone INTEGER NOT NULL,
  screen TEXT NOT NULL,
  device TEXT NOT NULL,
  os TEXT NOT NULL,
  browser TEXT NOT NULL
);
CREATE INDEX idx_visits_user ON visits(user_id, at);
CREATE INDEX idx_visits_at ON visits(at);

-- 앱 오류 기록: 같은 (메시지+빌드)는 기기당 하루 한 번, 사용자당 하루 20건, 30일.
CREATE TABLE client_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  build TEXT NOT NULL,
  key TEXT NOT NULL,         -- 메시지+빌드의 해시 앞 16자
  message TEXT NOT NULL,
  stack TEXT NOT NULL,
  route TEXT NOT NULL
);
CREATE INDEX idx_client_errors_user ON client_errors(user_id, at);
CREATE INDEX idx_client_errors_at ON client_errors(at);
