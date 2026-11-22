-- 접속 지역(도시) 기록: 사용자가 설정에서 동의한 경우만 저장한다(wheelmap.cityConsent = 'yes'). IP 주소는 저장하지 않는다.
-- Cloudflare가 요청에 붙여 주는 대략적인 지역(city·regionCode·country)만 담고, 동의를 거두면(설정 저장) NULL로 지운다.
-- 접속 기록(visits)은 30일, 기기 요약(user_devices)은 90일 뒤 기존 정리 규칙으로 함께 지워진다.
ALTER TABLE visits ADD COLUMN city TEXT;
ALTER TABLE visits ADD COLUMN region_code TEXT;
ALTER TABLE visits ADD COLUMN country TEXT;
ALTER TABLE user_devices ADD COLUMN city TEXT;
ALTER TABLE user_devices ADD COLUMN region_code TEXT;
ALTER TABLE user_devices ADD COLUMN country TEXT;
