// Node에서 src/lib의 .ts 모듈(확장자 없는 import, JSON import)을 그대로 불러오기 위한 해석 도우미.
// 앱 코드는 Vite 기준으로 확장자 없이 import하므로, 스크립트에서는 이 훅을 먼저 등록한다. 앱 코드는 고치지 않는다.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.json')) {
    return nextResolve(specifier, { ...context, importAttributes: { ...context.importAttributes, type: 'json' } })
  }
  try {
    return await nextResolve(specifier, context)
  } catch (e) {
    if (specifier.startsWith('.') && e && e.code === 'ERR_MODULE_NOT_FOUND') return nextResolve(specifier + '.ts', context)
    throw e
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) return nextLoad(url, { ...context, format: 'json', importAttributes: { ...context.importAttributes, type: 'json' } })
  return nextLoad(url, context)
}
