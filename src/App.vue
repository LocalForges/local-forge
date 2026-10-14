<script setup>
import { ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()
const menuOpen = ref(false)
// 路由变化时收起抽屉，避免停留在新页面时菜单还开着
watch(() => route.fullPath, () => { menuOpen.value = false })
</script>

<template>
  <div class="app">
    <header class="topbar">
      <RouterLink to="/" class="brand" @click="menuOpen = false">
        <i class="bi bi-box-seam"></i>
        <span>Local<b>Forge</b></span>
      </RouterLink>

      <nav class="nav" :class="{ open: menuOpen }" @click="menuOpen = false">
        <RouterLink to="/zip-compress"><i class="bi bi-file-earmark-zip"></i> 压缩</RouterLink>
        <RouterLink to="/zip-extract"><i class="bi bi-door-open"></i> 解压</RouterLink>
        <RouterLink to="/archive"><i class="bi bi-archive"></i> 归档</RouterLink>
        <RouterLink to="/media-convert"><i class="bi bi-arrow-left-right"></i> 媒体</RouterLink>
        <RouterLink to="/image-convert"><i class="bi bi-image"></i> 图片</RouterLink>
        <RouterLink to="/pdf-tools"><i class="bi bi-file-earmark-pdf"></i> PDF</RouterLink>
        <RouterLink to="/share-files"><i class="bi bi-share"></i> 分享</RouterLink>
        <RouterLink to="/qr-code"><i class="bi bi-qr-code"></i> 二维码</RouterLink>
        <RouterLink to="/hash"><i class="bi bi-shield-check"></i> 哈希</RouterLink>
        <RouterLink to="/text"><i class="bi bi-code-slash"></i> 文本</RouterLink>
        <RouterLink to="/exif"><i class="bi bi-eraser"></i> 隐私清理</RouterLink>
        <RouterLink to="/ocr"><i class="bi bi-card-text"></i> OCR</RouterLink>
      </nav>

      <div class="topbar-right">
        <span class="badge"><i class="bi bi-shield-lock"></i> 本地处理 · 零上传</span>
        <button
          class="nav-toggle"
          type="button"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          aria-label="打开/关闭导航菜单"
          @click="menuOpen = !menuOpen"
        >
          <i class="bi" :class="menuOpen ? 'bi-x-lg' : 'bi-list'"></i>
        </button>
      </div>
    </header>

    <main class="content">
      <RouterView />
    </main>

    <footer class="footer">
      <nav class="foot-nav">
        <RouterLink to="/about">关于</RouterLink>
        <RouterLink to="/privacy">隐私协议</RouterLink>
        <a href="https://github.com/javaeer/local-forge" target="_blank" rel="noopener">GitHub</a>
      </nav>
      <div>纯前端实现 · 文件全程在浏览器本地处理，不上传任何服务器 · 由 zip.js · libarchive.js · ffmpeg.wasm 驱动</div>
    </footer>
  </div>
</template>

<style scoped>
/* 工具入口较多，窄屏时允许换行，避免顶栏溢出 */
.nav { flex-wrap: wrap; }
.topbar-right { display: flex; align-items: center; gap: 12px; margin-left: auto; }

/* 汉堡按钮：仅移动端显示 */
.nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px; height: 40px;
  border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  border-radius: 10px;
  background: var(--panel-2, rgba(28,37,60,.75));
  color: var(--txt, #e8edf7);
  cursor: pointer; font-size: 20px;
  transition: .15s;
}
.nav-toggle:hover { border-color: var(--accent, #38bdf8); color: var(--accent, #38bdf8); }
.nav-toggle:focus-visible { outline: 2px solid var(--accent, #38bdf8); outline-offset: 2px; }

.foot-nav {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.foot-nav a {
  color: var(--accent, #38bdf8);
  text-decoration: none;
  font-size: 13px;
}
.foot-nav a:hover { text-decoration: underline; }

/* ---------- 响应式：≤1024px 切换为汉堡抽屉 ---------- */
@media (max-width: 1024px) {
  .topbar { flex-wrap: wrap; align-items: center; padding: 10px 14px; gap: 10px; }
  .brand { flex: 1 1 auto; order: 1; }
  .topbar-right { order: 2; margin-left: 0; }
  .nav-toggle { display: inline-flex; }

  /* 抽屉默认隐藏，打开时覆盖在内容之上 */
  .nav {
    order: 3;
    flex-basis: 100%;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    margin: 0;
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 30;
    padding: 10px;
    background: rgba(8, 12, 22, 0.97);
    backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--line, rgba(120,150,200,.16));
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
    max-height: calc(100vh - 64px);
    overflow: auto;
  }
  .nav.open { display: flex; }
  .nav a {
    padding: 12px 14px;
    font-size: 15px;
    border-radius: 10px;
  }
  .badge { display: none; }
}
@media (max-width: 520px) {
  .topbar { padding: 10px 12px; }
}
</style>
