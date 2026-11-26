-- 앱 전체에 한 번에 적용되는 값(개인 자료 아님). 지금은 발표용 「크리스마스 모드」 하나: key='xmas', value='on'|'off', updated_at=바꾼 시각.
CREATE TABLE app_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
