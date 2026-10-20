/* ==========================================================================
   ElainaChat Mod · 深浅色切换
   三态：auto（跟随设备）/ light / dark，选择写入 localStorage。
   脚本在 <head> 中同步执行，页面绘制前就落好主题，避免刷新时闪一下。
   ========================================================================== */
(function () {
  'use strict';

  var MODE_KEY = 'elainaSiteThemeMode';
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var COLORS = { light: '#f6f1e8', dark: '#10140f' };

  function readMode() {
    try {
      var saved = localStorage.getItem(MODE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {
      /* 无痕模式 / 禁用存储：回落到跟随设备 */
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

  function syncControls() {
    var nodes = document.querySelectorAll('[data-mode]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('aria-pressed', String(nodes[i].getAttribute('data-mode') === mode));
    }
  }

  function syncColorMeta() {
    var meta = document.getElementById('theme-color');
    if (!meta) return;
    meta.setAttribute('content', isDark() ? COLORS.dark : COLORS.light);
  }

  function apply() {
    var theme = isDark() ? 'dark' : 'light';
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    syncControls();
    syncColorMeta();
  }

  apply();

  function onSystemChange() {
    if (mode === 'auto') apply();
  }
  if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
  else if (mq.addListener) mq.addListener(onSystemChange);

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var el = target.closest('[data-mode]');
    if (!el) return;
    mode = el.getAttribute('data-mode');
    writeMode(mode);
    apply();
  });

  window.addEventListener('storage', function (event) {
    if (event.key !== MODE_KEY) return;
    mode = readMode();
    apply();
  });

  document.addEventListener('DOMContentLoaded', syncControls);
})();
