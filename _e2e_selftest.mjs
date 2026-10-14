// 组件级回显层测试（真实浏览器）：打开首页 → 点「运行全部自检」→ 点「视图渲染自检」，
// 断言结果树渲染、无 FAIL、无运行期错误、无 pageerror。
// 这是「只测函数不测组件」盲区的永久兜底：逐路由隔离挂载会复现模板渲染期错误（如 ImageConvert 的 URL bug）。
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH || '/usr/bin/chromium'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=SharedArrayBuffer'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' })

  // 1) 运行全部自检
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.btn')].find((x) => x.textContent.includes('运行全部自检'))
    if (b) b.click()
  })
  await page.waitForFunction(
    () => { const el = document.querySelector('.st-summary'); return el && el.textContent.includes('子测试') },
    { timeout: 300000 }, // 含 ffmpeg 内核加载（可能两次），留足时间
  )

  // 2) 视图渲染自检
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.btn')].find((x) => x.textContent.includes('视图渲染自检'))
    if (b) b.click()
  })
  await page.waitForFunction(
    () => document.querySelectorAll('.st-views .item-row').length > 0,
    { timeout: 180000 },
  )

  const info = await page.evaluate(() => {
    const summary = (document.querySelector('.st-summary')?.textContent || '').replace(/\s+/g, ' ').trim()
    const fails = [...document.querySelectorAll('.item-row.fail')].map((r) => r.textContent.replace(/\s+/g, ' ').trim())
    const runtime = [...document.querySelectorAll('.st-runtime .err-block')].map((r) => r.textContent.replace(/\s+/g, ' ').trim())
    return { summary, failCount: fails.length, fails: fails.slice(0, 6), runtime: runtime.slice(0, 6) }
  })

  console.log('=== 回显层测试结果 ===')
  console.log('汇总:', info.summary)
  console.log('FAIL 行数:', info.failCount)
  if (info.fails.length) console.log('失败项:\n' + info.fails.join('\n'))
  console.log('运行期错误:', info.runtime.length ? '\n' + info.runtime.join('\n') : '无')
  console.log('PAGE ERRORS:', errors.length ? '\n' + errors.join('\n') : '无')

  const pass = info.failCount === 0 && info.runtime.length === 0 && errors.length === 0
  console.log(pass ? '\n✅ 回显层渲染 + 自检全绿' : '\n❌ 存在失败/错误')
  await browser.close()
  process.exit(pass ? 0 : 1)
} catch (e) {
  console.log('测试异常:', e.message)
  if (errors.length) console.log('捕获错误:', errors)
  await browser.close()
  process.exit(1)
}
