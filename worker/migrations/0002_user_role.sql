-- 개발자 권한: 역할은 DB에서 직접만 바꾼다(API 없음). 기본값은 일반 계정 'user'.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
