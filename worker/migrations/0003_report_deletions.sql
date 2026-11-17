-- 지운 제보의 표시(tombstone): 이미 제보를 받아 간 기기가 변경분 받기(/reports?since=)로 삭제도 알 수 있게 한다.
-- 제보 행 자체는 지우고(사진·내용 남기지 않음) id와 지운 시각만 둔다. 30일 지난 표시는 관리 삭제 때 함께 정리한다.
CREATE TABLE report_deletions (
  id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
CREATE INDEX idx_report_deletions_at ON report_deletions(deleted_at);
