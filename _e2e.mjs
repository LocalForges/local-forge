// 引擎端到端验证（真实浏览器）：通过统一聚合器运行各模块自检，输出结构化报告。
import puppeteer from 'puppeteer-core'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: 'new',
  protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=SharedArrayBuffer'],
})
const page = await browser.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))

await page.goto(BASE_URL + '/', { waitUntil: 'networkidle0' })

const report = await page.evaluate(async () => {
  const { runAllSelfTests } = await import('/src/lib/selftest.js')
  return await runAllSelfTests()
})

let total = 0
let passed = 0
let failed = 0
for (const m of report.modules) {
  for (const it of (m.items || [])) {
    total++
    if (it.ok) passed++
    else failed++
  }
}

console.log(JSON.stringify(report, null, 2))
console.log(`\n汇总: 模块 ${report.modules.length} / 子测试 ${total} / 通过 ${passed} / 失败 ${failed}`)
console.log('RUNTIME ERRORS:', errors.length ? errors : 'none')

await browser.close()
process.exit(failed === 0 && errors.length === 0 ? 0 : 1)
