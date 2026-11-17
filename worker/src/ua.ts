// User-Agent에서 폰 종류·OS·브라우저를 간단히 가려낸다(정확한 분석이 아니라 「어떤 환경에서 난 문제인지」 짐작용).
export type UaInfo = { device: string; os: string; browser: string }

const major = (v: string | undefined) => (v ? v.split('.')[0] : '')
const cut = (s: string, n: number) => [...s].slice(0, n).join('')

export function parseUa(ua: string): UaInfo {
  const s = ua || ''
  let device = '알 수 없음'
  let os = '알 수 없음'
  const ios = /\b(iPhone|iPad|iPod)\b.*?OS (\d+)[_.](\d+)/.exec(s) ?? /\b(iPhone|iPad|iPod)\b/.exec(s)
  const android = /Android (\d+(?:\.\d+)*)/.exec(s)
  if (ios) {
    device = ios[1] === 'iPod' ? 'iPhone' : ios[1]
    os = ios[2] ? `iOS ${ios[2]}` : 'iOS'
  } else if (android) {
    os = `Android ${major(android[1])}`
    // 모델명: "Android 14; SM-S918N" 꼴. 최신 크롬은 모델을 가려 "K"만 보인다.
    const model = /Android [\d.]+; ([^;)]+)/.exec(s)?.[1]?.trim().replace(/ Build\/.*/, '')
    const phone = /Mobile/.test(s)
    device = model && model !== 'K' && !/^wv$/i.test(model) ? cut(model, 40) : phone ? 'Android 폰' : 'Android 태블릿'
  } else if (/Windows NT/.test(s)) {
    device = 'Windows PC'
    os = 'Windows'
  } else if (/Macintosh|Mac OS X/.test(s)) {
    device = 'Mac'
    os = 'macOS'
  } else if (/CrOS/.test(s)) {
    device = 'Chromebook'
    os = 'ChromeOS'
  } else if (/Linux|X11/.test(s)) {
    device = 'Linux PC'
    os = 'Linux'
  }

  let browser = '알 수 없음'
  const m = (re: RegExp) => re.exec(s)
  let r: RegExpExecArray | null
  if (/KAKAOTALK/i.test(s)) browser = '카카오톡 앱 브라우저'
  else if (/NAVER\(inapp/i.test(s)) browser = '네이버 앱 브라우저'
  else if (/Instagram/i.test(s)) browser = '인스타그램 앱 브라우저'
  else if (/FBAN|FBAV/.test(s)) browser = '페이스북 앱 브라우저'
  else if ((r = m(/(?:EdgiOS|EdgA|Edg|Edge)\/(\d+)/))) browser = `Edge ${r[1]}`
  else if ((r = m(/(?:OPR|OPiOS)\/(\d+)/))) browser = `Opera ${r[1]}`
  else if ((r = m(/SamsungBrowser\/(\d+)/))) browser = `삼성 인터넷 ${r[1]}`
  else if ((r = m(/(?:Firefox|FxiOS)\/(\d+)/))) browser = `Firefox ${r[1]}`
  else if ((r = m(/(?:CriOS|Chrome)\/(\d+)/))) browser = /; wv\)/.test(s) ? `Android 웹뷰 ${r[1]}` : `Chrome ${r[1]}`
  else if ((r = m(/Version\/(\d+)[\d.]* .*Safari/))) browser = `Safari ${r[1]}`
  else if (/Safari/.test(s)) browser = 'Safari'
  return { device, os, browser }
}
