-- 광주 BIS 저상버스 도착 중계: 같은 정류소 25초 캐시와 하루 호출 수.
-- (workers.dev 주소에서는 Cache API가 동작하지 않아 D1에 둔다. 키는 어디에도 저장하지 않는다.)
CREATE TABLE bis_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE bis_calls (
  day TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
