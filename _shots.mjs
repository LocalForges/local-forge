import puppeteer from 'puppeteer-core'
const BASE = 'http://127.0.0.1:4173/'
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] })
const page = await browser.newPage()
const shot = (name) => page.screenshot({ path: `/workspace/shots/${name}.png` })

await page.setViewport({ width: 1280, height: 900 })
await page.goto(BASE, { waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 400))
await shot('desktop-home')

await page.setViewport({ width: 390, height: 844 })
await page.goto(BASE, { waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 400))
await shot('mobile-home-closed')

await page.click('.nav-toggle'); await new Promise(r => setTimeout(r, 300))
await shot('mobile-home-menu')

await page.goto(BASE + 'qr-code', { waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 400))
await shot('mobile-qr')

await browser.close()
console.log('shots saved')
