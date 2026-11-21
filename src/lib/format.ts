// 화면에 날짜·금액을 내는 공통 함수. 앱 안의 날짜는 모두 여기서 만든다.
//  - fmtDay: 「11/18」, 올해가 아니면 「2025/11/18」
//  - fmtDateTime: 「11/18 오후 10:19」, 올해가 아니면 「2025/11/18 오후 10:19」
// 기기 시간대 기준이다. 날짜로 읽히지 않는 값은 빈 글자를 낸다. `now`는 올해를 정하는 시험용 값이다.
const dayText = (d: Date, now: number) => {
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}/${md}`
}

export const fmtDay = (v: string | number, now: number = Date.now()): string => {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : dayText(d, now)
}

export const fmtDateTime = (v: string | number, now: number = Date.now()): string => {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const h = d.getHours()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${dayText(d, now)} ${h < 12 ? '오전' : '오후'} ${h12}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const won = (n: number) => n.toLocaleString('ko-KR')
