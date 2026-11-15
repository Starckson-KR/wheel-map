-- 간편 계정 + 공유 제보 저장(피어 리뷰용). 끝난 뒤 전체 삭제 방법은 worker/README.md 참고.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 세션 토큰은 해시만 저장한다(원문은 사용자 기기에만 있다).
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 로그인 실패·가입 시도 횟수. key는 (이름+IP) 또는 이름 또는 IP의 해시라 원문 이름·IP는 남지 않는다.
CREATE TABLE throttle (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE prefs (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 제보 한 건 = JSON 한 행. 모두에게 공유된다.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_reports_updated ON reports(updated_at);

-- 사진은 테이블을 나눠 base64 문자열로 보관한다(D1 행 하나 2MB 한도 안).
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 계정별 하루 쓰기 횟수(UTC 날짜)
CREATE TABLE write_quota (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
