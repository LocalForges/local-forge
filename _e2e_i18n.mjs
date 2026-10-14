// B-4 多语言 e2e：验证中日英韩西五种语言的切换、<html lang> 同步、持久化，
// 以及关键文案确实随语言变化（不是回退到中文）。
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await wait(700)

  // 语言菜单应列出 5 种语言
  await page.evaluate(() => document.querySelector('.topbar [data-testid=locale-toggle]').click())
  await wait(250)
  const menu = await page.evaluate(() => Array.from(document.querySelectorAll('.lang-menu .lang-item')).map((x) => x.textContent.trim()))
  check('B4：语言菜单列出 5 种语言', menu.length === 5, menu.join(' | '))
  check('B4：含中文/English/日本語/한국어/Español',
    ['中文', 'English', '日本語', '한국어', 'Español'].every((n) => menu.some((m) => m.includes(n))), menu.join(' | '))
  // 关闭菜单，保证后续循环从「关闭态」开始
  await page.evaluate(() => document.querySelector('.topbar [data-testid=locale-toggle]').click())
  await wait(200)

  const cases = [
    { name: 'English', lang: 'en', expect: /search/i, where: 'ts-text' },
    { name: '日本語', lang: 'ja-JP', expect: /ツール/, where: 'ts-text' },
    { name: '한국어', lang: 'ko-KR', expect: /도구/, where: 'ts-text' },
    { name: 'Español', lang: 'es-ES', expect: /Buscar/, where: 'ts-text' },
    { name: '中文', lang: 'zh-CN', expect: /搜索/, where: 'ts-text' },
  ]

  for (const c of cases) {
    // 打开菜单并点击目标语言
    await page.evaluate(() => document.querySelector('.topbar [data-testid=locale-toggle]').click())
    await wait(200)
    await page.evaluate((nm) => {
      const item = Array.from(document.querySelectorAll('.lang-menu .lang-item')).find((x) => x.textContent.includes(nm))
      if (item) item.click()
    }, c.name)
    await wait(350)
    const got = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute('lang'),
      stored: localStorage.getItem('lf-locale'),
      text: (document.querySelector('.top-search .ts-text') || {}).textContent || '',
      title: document.title,
    }))
    check(`B4：切到 ${c.name} → <html lang>`, got.lang === c.lang, got.lang)
    check(`B4：切到 ${c.name} → 持久化`, got.stored === c.lang, got.stored)
    check(`B4：切到 ${c.name} → 搜索文案本地化`, c.expect.test(got.text), got.text)
  }

  // 刷新后保持上次语言（中文）
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(500)
  const afterReload = await page.evaluate(() => ({
    lang: document.documentElement.getAttribute('lang'),
    search: (document.querySelector('.top-search .ts-text') || {}).textContent || '',
  }))
  check('B4：刷新后保持语言偏好', afterReload.lang === 'zh-CN' && /搜索/.test(afterReload.search), `${afterReload.lang} / ${afterReload.search}`)

} finally {
  await browser.close()
}

console.log(`\n===== B-4 多语言 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }