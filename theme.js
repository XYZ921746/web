/* ==========================================================================
   ElainaChat Mod · 站点深浅色切换（首页与插件商店共用）
   ── 与应用顶栏同一套语言：连体三态胶囊（跟随设备 / 浅色 / 深色） ──

   ★ 站点只保留**一套配色**（应用的默认主题「暖米绿」），所以这里只管深浅，
     不再有「主题模板」—— 那一排色点已按需求取消。

   选择写在 localStorage，下次打开保持；「跟随设备」跟随系统深浅色，
   系统切换时即时重应用（不用刷新）。
   本脚本在 <head> 里**同步**引入（不加 defer），所以它会在页面绘制前就把属性
   打到 <html> 上 —— 否则刷新时会先闪一下默认主题。
   ========================================================================== */
(function () {
  'use strict';

  var MODE_KEY = 'elainaSiteThemeMode';  // auto | light | dark
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  function readMode() {
    try {
      var saved = localStorage.getItem(MODE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {
      /* 无痕 / 禁用存储：回落到跟随设备，不影响浏览 */
    }
    return 'auto';
  }
  function writeMode(value) {
    try { localStorage.setItem(MODE_KEY, value); } catch (e) { /* 同上 */ }
  }

  var mode = readMode();

  function isDark() {
    return mode === 'dark' || (mode === 'auto' && mq.matches);
  }

  /* 选中态同步到胶囊上（aria-pressed 既给样式用，也是无障碍状态） */
  function syncControls() {
    var nodes = document.querySelectorAll('[data-mode]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('aria-pressed', String(nodes[i].getAttribute('data-mode') === mode));
    }
  }

  function apply() {
    root.setAttribute('data-theme', isDark() ? 'dark' : 'light');
    syncControls();
  }

  apply();  // 绘制前先落地，避免闪主题

  function onSystemChange() {
    if (mode === 'auto') apply();
  }
  if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
  else if (mq.addListener) mq.addListener(onSystemChange);

  document.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var el = target.closest('[data-mode]');
      if (!el) return;
      mode = el.getAttribute('data-mode');
      writeMode(mode);
      apply();
    });
  });
})();
