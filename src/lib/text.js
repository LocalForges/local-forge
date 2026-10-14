// 文本 / 编码工具箱引擎 —— 零新增依赖，全部使用浏览器原生能力。
//
// 为什么这类功能必须"纯本地"：开发者日常贴进去的是 API Key、JWT、数据库口令、客户数据，
// 丢给任何在线工具都等于泄露。放在 LocalForge 里，浏览器即边界，天然不外传。
// 实现要点：
//   - Base64 用 TextEncoder/TextDecoder 做 UTF-8 桥接（原生 btoa/atob 只吃 Latin-1，直接吃中文会炸）
//   - 哈希用 Web Crypto (SubtleCrypto)，不自己实现任何密码学算法
//   - 正则测试限制输入规模并捕获异常，防止灾难性回溯把页面卡死

const enc = () => new TextEncoder()
const dec = () => new TextDecoder()

function bytesToBin(u8) {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH))
  return s
}

/* ---------------- Base64 / Base64URL / Hex ---------------- */
export function base64Encode(text) {
  return btoa(bytesToBin(enc().encode(String(text ?? ''))))
}
export function base64Decode(b64) {
  const clean = String(b64 ?? '').replace(/\s+/g, '')
  const bin = atob(clean)
  const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return dec().decode(u8)
}
export function base64UrlEncode(text) {
  return base64Encode(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function base64UrlDecode(s) {
  let t = String(s ?? '').replace(/-/g, '+').replace(/_/g, '/')
  while (t.length % 4) t += '='
  return base64Decode(t)
}
export function hexEncode(text) {
  const u8 = enc().encode(String(text ?? ''))
  return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('')
}
export function hexDecode(hex) {
  const clean = String(hex ?? '').replace(/[^0-9a-fA-F]/g, '')
  if (clean.length % 2) throw new Error('十六进制长度必须为偶数')
  const u8 = new Uint8Array(clean.length / 2)
  for (let i = 0; i < u8.length; i++) u8[i] = parseInt(clean.substr(i * 2, 2), 16)
  return dec().decode(u8)
}

/* ---------------- JSON ---------------- */
export function jsonFormat(text, indent = 2) {
  const obj = JSON.parse(String(text ?? ''))
  return JSON.stringify(obj, null, Number(indent) || 0)
}
export function jsonMinify(text) {
  return JSON.stringify(JSON.parse(String(text ?? '')))
}
// 校验并给出人类可读的错误（含大致位置），失败时不抛异常，由调用方决定展示方式
export function jsonValidate(text) {
  try {
    const v = JSON.parse(String(text ?? ''))
    const type = Array.isArray(v) ? '数组' : v === null ? 'null' : typeof v === 'object' ? '对象' : typeof v
    let count = null
    if (v && typeof v === 'object') count = Array.isArray(v) ? v.length : Object.keys(v).length
    return { ok: true, type, count }
  } catch (e) {
    const m = /position (\d+)/.exec(e.message)
    let pos = m ? Number(m[1]) : null
    let line = null
    if (pos != null) {
      line = String(text).slice(0, pos).split('\n').length
    }
    return { ok: false, error: e.message, pos, line }
  }
}

/* ---------------- JWT ---------------- */
export function jwtParse(token) {
  const t = String(token ?? '').trim().replace(/^Bearer\s+/i, '')
  const parts = t.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1]) throw new Error('不是合法的 JWT（应为 header.payload.signature 三段）')
  let header
  let payload
  try {
    header = JSON.parse(base64UrlDecode(parts[0]))
    payload = JSON.parse(base64UrlDecode(parts[1]))
  } catch (e) {
    throw new Error('JWT 内容解码失败（Base64URL 或 JSON 不合法）：' + e.message)
  }
  const now = Math.floor(Date.now() / 1000)
  const flags = []
  if (payload.exp != null) flags.push({ k: '过期时间 exp', v: new Date(payload.exp * 1000).toLocaleString(), state: payload.exp < now ? 'warn' : 'ok' })
  if (payload.iat != null) flags.push({ k: '签发时间 iat', v: new Date(payload.iat * 1000).toLocaleString(), state: 'ok' })
  if (payload.nbf != null && payload.nbf > now) flags.push({ k: '生效时间 nbf', v: new Date(payload.nbf * 1000).toLocaleString(), state: 'warn' })
  if (payload.iss) flags.push({ k: '签发者 iss', v: payload.iss, state: 'ok' })
  if (payload.sub) flags.push({ k: '主体 sub', v: payload.sub, state: 'ok' })
  if (payload.aud) flags.push({ k: '受众 aud', v: String(payload.aud), state: 'ok' })
  return { header, payload, signature: parts[2], expired: payload.exp != null && payload.exp < now, flags }
}

/* ---------------- 正则测试 ---------------- */
export function regexTest(pattern, flags, text) {
  const src = String(text ?? '')
  if (src.length > 20000) throw new Error('测试文本过长（上限 20000 字符），请精简后再试')
  let re
  try {
    re = new RegExp(pattern ?? '', flags || '')
  } catch (e) {
    throw new Error('正则表达式不合法：' + e.message)
  }
  const matches = []
  if (flags && flags.includes('g')) {
    let m
    let guard = 0
    while ((m = re.exec(src)) !== null && guard++ < 1000) {
      matches.push({ match: m[0], index: m.index, groups: m.slice(1) })
      if (m[0] === '') re.lastIndex++ // 防止空匹配死循环
    }
  } else {
    const m = re.exec(src)
    if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1) })
  }
  return { count: matches.length, matches: matches.slice(0, 200) }
}

/* ---------------- 时间 ---------------- */
export function timestampToDate(ts) {
  const n = Number(String(ts ?? '').trim())
  if (!isFinite(n)) throw new Error('时间戳不是有效数字')
  // 自动识别秒 / 毫秒：13 位视为毫秒
  const ms = Math.abs(n) >= 1e12 ? n : n * 1000
  const d = new Date(ms)
  if (isNaN(d.getTime())) throw new Error('时间戳超出可表示范围')
  return { iso: d.toISOString(), local: d.toLocaleString(), utc: d.toUTCString(), ms: d.getTime(), seconds: Math.floor(d.getTime() / 1000) }
}
export function dateToTimestamp(dateStr) {
  const d = new Date(String(dateStr ?? '').trim())
  if (isNaN(d.getTime())) throw new Error('日期格式无法解析（示例：2026-10-13 16:30:00）')
  return { seconds: Math.floor(d.getTime() / 1000), ms: d.getTime() }
}

/* ---------------- UUID / 随机密码 / 强度 ---------------- */
export function uuidV4() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`
}

const WEAK = ['123456', 'password', '12345678', 'qwerty', '123456789', '111111', '123123', 'abc123', 'admin', 'iloveyou', '654321', '000000']

export function randomPassword({ length = 16, upper = true, lower = true, digits = true, symbols = true } = {}) {
  const sets = []
  if (lower) sets.push('abcdefghijkmnopqrstuvwxyz')
  if (upper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ')
  if (digits) sets.push('23456789')
  if (symbols) sets.push('!@#$%^&*()-_=+[]{};:,.<>?')
  if (!sets.length) throw new Error('至少选择一种字符类型')
  const all = sets.join('')
  const n = Math.max(4, Math.min(128, Number(length) || 16))
  const buf = new Uint32Array(n)
  crypto.getRandomValues(buf)
  const chars = []
  // 先保证每种启用的字符类型都出现一次
  sets.forEach((s, i) => chars.push(s[buf[i] % s.length]))
  for (let i = sets.length; i < n; i++) chars.push(all[buf[i] % all.length])
  // 洗牌，避免"每类一个"的规律前缀
  for (let i = chars.length - 1; i > 0; i--) {
    const j = buf[(i + 7) % buf.length] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('').slice(0, n)
}

export function passwordStrength(pwd) {
  const p = String(pwd ?? '')
  if (!p) return { score: 0, level: 'empty', label: '未输入', tips: ['请输入密码'] }
  const lower = WEAK.includes(p.toLowerCase())
  const kinds = (/[a-z]/.test(p) ? 1 : 0) + (/[A-Z]/.test(p) ? 1 : 0) + (/[0-9]/.test(p) ? 1 : 0) + (/[^A-Za-z0-9]/.test(p) ? 1 : 0)
  const seq = /(.)\1{2,}/.test(p) || /(0123|1234|2345|abcd|qwer)/i.test(p)
  let score = 0
  score += Math.min(40, p.length * 3)
  score += (kinds - 1) * 12
  if (p.length >= 12) score += 10
  if (seq) score -= 15
  if (kinds === 1) score -= 10
  score = Math.max(0, Math.min(100, score))
  const tips = []
  if (p.length < 12) tips.push('建议至少 12 位')
  if (kinds < 3) tips.push('混合大小写、数字与符号')
  if (seq) tips.push('避免连续或重复字符')
  if (lower) tips.push('该密码在常见弱口令字典中')
  let level = 'weak'
  let label = '弱'
  if (lower) { level = 'weak'; label = '极弱（常见弱口令）' }
  else if (score >= 80) { level = 'verystrong'; label = '很强' }
  else if (score >= 60) { level = 'strong'; label = '强' }
  else if (score >= 35) { level = 'medium'; label = '中等' }
  return { score, level, label, tips }
}

/* ---------------- 文本哈希（Web Crypto） ---------------- */
export async function shaDigest(text, algo = 'SHA-256') {
  const list = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']
  const out = {}
  for (const a of Array.isArray(algo) ? algo : [algo]) {
    if (!list.includes(a)) throw new Error('Web Crypto 不支持：' + a)
    const buf = await crypto.subtle.digest(a, enc().encode(String(text ?? '')))
    out[a] = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return out
}

/* ---------------- 自检 ---------------- */
export async function selfTest() {
  const items = []
  const T = async (id, title, fn) => {
    try {
      const detail = await fn()
      items.push({ id, title, ok: true, detail })
    } catch (e) {
      items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
    }
  }

  await T('json', 'JSON 格式化 / 压缩 / 校验', async () => {
    const raw = '{"a":1,"b":[1,2],"c":{"d":"中文"}}'
    const pretty = jsonFormat(raw, 2)
    if (!pretty.includes('\n')) throw new Error('格式化未换行')
    const min = jsonMinify(pretty)
    if (min !== raw) throw new Error('压缩结果不一致：' + min)
    const v = jsonValidate(raw)
    if (!v.ok || v.type !== '对象') throw new Error('校验失败')
    return `类型 ${v.type}，${v.count} 个键`
  })
  await T('json-error', '非法 JSON 明确报错', async () => {
    const v = jsonValidate('{"a":1,}')
    if (v.ok) throw new Error('非法 JSON 被判为合法')
    if (!v.error) throw new Error('缺少错误信息')
    return v.error
  })
  await T('base64-utf8', 'Base64 中文往返', async () => {
    const s = '会宁县会师镇 · LocalForge'
    const b = base64Encode(s)
    if (base64Decode(b) !== s) throw new Error('Base64 往返不一致')
    const u = base64UrlEncode(s)
    if (/[+/=]/.test(u)) throw new Error('Base64URL 含非法字符：' + u)
    if (base64UrlDecode(u) !== s) throw new Error('Base64URL 往返不一致')
    return b
  })
  await T('hex', 'Hex 往返', async () => {
    const s = 'LocalForge 本地工具箱'
    const h = hexEncode(s)
    if (!/^[0-9a-f]+$/.test(h)) throw new Error('Hex 编码格式错误')
    if (hexDecode(h) !== s) throw new Error('Hex 往返不一致')
    return h.slice(0, 24) + '…'
  })
  await T('url-codec', 'URL 编解码', async () => {
    const s = 'https://a.cn/p?name=会师镇&x=1 2'
    const e = encodeURIComponent(s)
    if (decodeURIComponent(e) !== s) throw new Error('URL 往返不一致')
    return '往返一致'
  })
  await T('jwt', 'JWT 解析', async () => {
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const future = Math.floor(Date.now() / 1000) + 3600
    const payload = base64UrlEncode(JSON.stringify({ sub: 'tester', exp: future, iss: 'local-forge' }))
    const token = `${header}.${payload}.sig`
    const r = jwtParse(token)
    if (r.header.alg !== 'HS256') throw new Error('header 解析错误')
    if (r.payload.sub !== 'tester') throw new Error('payload 解析错误')
    if (r.expired) throw new Error('未过期的 token 被判为过期')
    const past = `${header}.${base64UrlEncode(JSON.stringify({ exp: 1000 }))}.sig`
    if (!jwtParse(past).expired) throw new Error('已过期 token 未识别')
    return `alg=${r.header.alg} sub=${r.payload.sub}，过期判定正确`
  })
  await T('regex', '正则测试', async () => {
    const r = regexTest('(\\d{4})-(\\d{2})', 'g', '日期 2026-10 与 2025-01')
    if (r.count !== 2) throw new Error('应匹配 2 处，实际 ' + r.count)
    if (r.matches[0].groups[0] !== '2026') throw new Error('分组捕获错误')
    let msg = ''
    try { regexTest('(', 'g', 'x') } catch (e) { msg = e.message }
    if (!msg) throw new Error('非法正则未报错')
    return `${r.count} 处匹配 + 非法正则可捕获`
  })
  await T('timestamp', '时间戳转换', async () => {
    const r = timestampToDate(0)
    if (!r.iso.startsWith('1970-01-01')) throw new Error('0 应对应 1970-01-01，实际 ' + r.iso)
    const ms = timestampToDate(1700000000000) // 毫秒自动识别
    if (ms.seconds !== 1700000000) throw new Error('毫秒识别错误')
    const back = dateToTimestamp('2026-10-13 16:30:00')
    if (!isFinite(back.seconds)) throw new Error('日期转时间戳失败')
    return `0→${r.iso}，毫秒/秒自动识别正常`
  })
  await T('uuid', 'UUID v4', async () => {
    const a = uuidV4()
    const b = uuidV4()
    if (a === b) throw new Error('两次生成相同（随机源异常）')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a)) {
      throw new Error('UUID 格式不符合 v4：' + a)
    }
    return a
  })
  await T('password', '密码生成与强度', async () => {
    const p = randomPassword({ length: 20 })
    if (p.length !== 20) throw new Error('长度不符：' + p.length)
    const s = passwordStrength(p)
    if (s.score < 60) throw new Error('20 位随机密码被判为不够强：' + s.score)
    const w = passwordStrength('123456')
    if (w.score > 30) throw new Error('弱口令未被判弱：' + w.score)
    if (!w.tips.length) throw new Error('弱口令未给出改进建议')
    return `随机密码强度 ${s.score}（${s.label}），弱口令 ${w.score}（${w.label}）`
  })
  await T('sha', '文本哈希（Web Crypto）', async () => {
    const r = await shaDigest('abc', ['SHA-256'])
    if (r['SHA-256'] !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
      throw new Error('SHA-256 不符：' + r['SHA-256'])
    }
    return r['SHA-256'].slice(0, 20) + '…'
  })

  return { module: '文本', items }
}
