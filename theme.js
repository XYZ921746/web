/* ==========================================================================
   ElainaChat Mod · 站点外观切换（首页与插件商店共用）
   ── 与应用顶栏同一套语言：三态胶囊（跟随设备 / 浅色 / 深色）+ 主题模板圆点 ──

   选择结果写在 localStorage，下次打开保持；「跟随设备」跟随系统深浅色，
   系统切换时即时重应用（不用刷新）。
   本脚本在 <head> 里**同步**引入（不加 defer），所以它会在页面绘制前就把属性
   打到 <html> 上 —— 否则刷新时会先闪一下默认主题。
   ========================================================================== */
(function () {
  'use strict';

  var MODE_KEY = 'elainaSiteThemeMode';      // auto | light | dark
  var TPL_KEY = 'elainaSiteThemeTemplate';   // '' = 暖米绿（默认）| ios | claude | sage | sakura
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  function read(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      /* 无痕 / 禁用存储：回落到默认值即可，不影响浏览 */
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 同上 */ }
  }

  var mode = read(MODE_KEY, 'auto');
  if (mode !== 'light' && mode !== 'dark') mode = 'auto';
  var template = read(TPL_KEY, '');

  function isDark() {
    return mode === 'dark' || (mode === 'auto' && mq.matches);
  }

  /* 选中态同步到控件上（aria-pressed 既给样式用，也是无障碍状态） */
  function syncControls() {
    var nodes = document.querySelectorAll('[data-mode], [data-tpl]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var isMode = el.hasAttribute('data-mode');
      var value = isMode ? el.getAttribute('data-mode') : (el.getAttribute('data-tpl') || '');
      el.setAttribute('aria-pressed', String(value === (isMode ? mode : template)));
    }
  }

  function apply() {
    root.setAttribute('data-theme', isDark() ? 'dark' : 'light');
    if (template) root.setAttribute('data-theme-template', template);
    else root.removeAttribute('data-theme-template');
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
      var el = target.closest('[data-mode], [data-tpl]');
      if (!el) return;
      if (el.hasAttribute('data-mode')) {
        mode = el.getAttribute('data-mode');
        write(MODE_KEY, mode);
      } else {
        template = el.getAttribute('data-tpl') || '';
        write(TPL_KEY, template);
      }
      apply();
    });
  });
})();
