// 布局 / 响应式 e2e：验证顶栏在桌面与手机宽度下的折叠行为，以及无横向溢出
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

try {
  const page = await browser.newPage()

  // ---------- 桌面宽度 ----------
  await page.setViewport({ width: 1280, height: 900 })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 300))

  const desk = await page.evaluate(() => {
    const nav = document.querySelector('.nav')
    const toggle = document.querySelector('.nav-toggle')
    const badge = document.querySelector('.badge')
    const cs = (el) => (el ? getComputedStyle(el).display : 'null')
    return { nav: cs(nav), toggle: cs(toggle), badge: cs(badge), scrollW: document.documentElement.scrollWidth, win: window.innerWidth }
  })
  check('桌面：导航内联可见', desk.nav === 'flex', `nav.display=${desk.nav}`)
  check('桌面：汉堡按钮隐藏', desk.toggle === 'none', `toggle.display=${desk.toggle}`)
  check('桌面：零上传徽标可见', desk.badge !== 'none', `badge.display=${desk.badge}`)
  check('桌面：无横向溢出', desk.scrollW <= desk.win + 1, `scrollW=${desk.scrollW} win=${desk.win}`)

  // ---------- 手机宽度 ----------
  await page.setViewport({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 300))

  const mobClosed = await page.evaluate(() => {
    const nav = document.querySelector('.nav')
    const toggle = document.querySelector('.nav-toggle')
    const cs = (el) => (el ? getComputedStyle(el).display : 'null')
    return { nav: cs(nav), toggle: cs(toggle), badge: cs(document.querySelector('.badge')), scrollW: document.documentElement.scrollWidth, win: window.innerWidth }
  })
  check('手机：汉堡按钮可见', mobClosed.toggle !== 'none', `toggle.display=${mobClosed.toggle}`)
  check('手机：抽屉默认收起', mobClosed.nav === 'none', `nav.display=${mobClosed.nav}`)
  check('手机：徽标让位隐藏', mobClosed.badge === 'none', `badge.display=${mobClosed.badge}`)
  check('手机：无横向溢出', mobClosed.scrollW <= mobClosed.win + 1, `scrollW=${mobClosed.scrollW} win=${mobClosed.win}`)

  // 点击汉堡 → 抽屉展开
  await page.click('.nav-toggle')
  await new Promise((r) => setTimeout(r, 200))
  const mobOpen = await page.evaluate(() => getComputedStyle(document.querySelector('.nav')).display)
  check('手机：点击汉堡后抽屉展开', mobOpen === 'flex', `nav.display=${mobOpen}`)

  // 点击某个导航项 → 抽屉收起 + 路由跳转
  await page.click('.nav a[href="/qr-code"]')
  await new Promise((r) => setTimeout(r, 400))
  const afterNav = await page.evaluate(() => ({
    nav: getComputedStyle(document.querySelector('.nav')).display,
    path: location.pathname,
  }))
  check('手机：点击入口后抽屉收起', afterNav.nav === 'none', `nav.display=${afterNav.nav}`)
  check('手机：点击入口后正确跳转', afterNav.path === '/qr-code', `path=${afterNav.path}`)

  // 二维码页在手机宽度下应为单栏（.qr-grid 折叠）
  const qrCols = await page.evaluate(() => {
    const g = document.querySelector('.qr-grid')
    return g ? getComputedStyle(g).gridTemplateColumns : 'absent'
  })
  check('手机：二维码工作台折叠为单栏', qrCols === 'absent' || qrCols.split(' ').length === 1, `gridTemplateColumns="${qrCols}"`)

  // ---------- 平板宽度（768）也应走汉堡 ----------
  await page.setViewport({ width: 768, height: 1024 })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 300))
  const tab = await page.evaluate(() => ({
    toggle: getComputedStyle(document.querySelector('.nav-toggle')).display,
    nav: getComputedStyle(document.querySelector('.nav')).display,
  }))
  check('平板：汉堡按钮可见', tab.toggle !== 'none', `toggle.display=${tab.toggle}`)
  check('平板：抽屉默认收起', tab.nav === 'none', `nav.display=${tab.nav}`)
} finally {
  await browser.close()
}

console.log(`\n布局 e2e：${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
