-- 실시간 연결(WebSocket)용 1회용 티켓. 해시만 저장하고, 쓰면 바로 지운다(만료 30초).
CREATE TABLE rt_tickets (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_rt_tickets_exp ON rt_tickets(expires_at);
