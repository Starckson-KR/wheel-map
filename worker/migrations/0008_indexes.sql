-- 색인 추가(전수점검 D-13): 정리 삭제·계정별 조회가 표 전체를 훑지 않게 한다. 앱 동작은 그대로다.
-- 이미 있는 색인(sessions.user_id, reports.updated_at, rt_tickets.expires_at, report_deletions.deleted_at, 접속·오류 기록)은 넣지 않는다.
CREATE INDEX IF NOT EXISTS idx_reports_author ON reports(author_id);
CREATE INDEX IF NOT EXISTS idx_photos_owner ON photos(owner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_throttle_window ON throttle(window_start);
CREATE INDEX IF NOT EXISTS idx_write_quota_day ON write_quota(day);
CREATE INDEX IF NOT EXISTS idx_bis_cache_fetched ON bis_cache(fetched_at);
