<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header class="topbar">
      <RouterLink to="/" class="brand">
        <i class="bi bi-box-seam"></i>
        <span>Local<b>Forge</b></span>
      </RouterLink>
      <nav class="nav">
        <RouterLink to="/zip-compress"><i class="bi bi-file-earmark-zip"></i> 压缩</RouterLink>
        <RouterLink to="/zip-extract"><i class="bi bi-door-open"></i> 解压</RouterLink>
        <RouterLink to="/archive"><i class="bi bi-archive"></i> 归档</RouterLink>
        <RouterLink to="/media-convert"><i class="bi bi-arrow-left-right"></i> 媒体</RouterLink>
        <RouterLink to="/image-convert"><i class="bi bi-image"></i> 图片</RouterLink>
        <RouterLink to="/pdf-tools"><i class="bi bi-file-earmark-pdf"></i> PDF</RouterLink>
        <RouterLink to="/share-files"><i class="bi bi-share"></i> 分享</RouterLink>
      </nav>
      <span class="badge"><i class="bi bi-shield-lock"></i> 本地处理 · 零上传</span>
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
</style>
