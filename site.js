/* ==========================================================================
   ElainaChat Mod · 站点交互
   移动端菜单、页头滚动状态、首页导航高亮。所有功能在没有 JS 时都能优雅降级：
   移动菜单默认隐藏，页头 / 导航本身不依赖脚本。
   ========================================================================== */
(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.menu-toggle');
  var menu = document.getElementById('mobile-menu');
  var desktop = window.matchMedia('(min-width: 961px)');

  /* ── 页头滚动状态 ── */
  var ticking = false;
  function onScroll() {
    if (!header) return;
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      header.classList.toggle('is-scrolled', window.scrollY > 6);
      updateSpy();
      ticking = false;
    });
  }

  /* ── 移动菜单 ── */
  function setMenu(open) {
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    menu.hidden = !open;
  }

  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function (event) {
      if (event.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        toggle.focus();
      }
    });
    document.addEventListener('click', function (event) {
      if (toggle.getAttribute('aria-expanded') !== 'true') return;
      if (header.contains(event.target)) return;
      setMenu(false);
    });
    if (desktop.addEventListener) {
      desktop.addEventListener('change', function (event) {
        if (event.matches) setMenu(false);
      });
    }
  }

  /* ── 首页导航高亮（只处理本页锚点） ── */
  var spyLinks = [];
  var links = document.querySelectorAll('.nav .nav-link[href^="#"], .mobile-nav .nav-link[href^="#"]');
  for (var i = 0; i < links.length; i++) {
    var id = links[i].getAttribute('href').slice(1);
    if (document.getElementById(id)) spyLinks.push({ el: links[i], id: id });
  }
  var sections = spyLinks
    .map(function (link) { return document.getElementById(link.id); })
    .filter(function (el, index, list) { return el && list.indexOf(el) === index; });

  var lastActive = null;
  function updateSpy() {
    if (!spyLinks.length) return;
    var line = window.scrollY + (header ? header.offsetHeight : 0) + 120;
    var current = '';
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].offsetTop <= line) current = sections[i].id;
    }
    if (current === lastActive) return;
    lastActive = current;
    for (var j = 0; j < spyLinks.length; j++) {
      var active = spyLinks[j].id === current;
      spyLinks[j].el.classList.toggle('is-active', active);
      if (active) spyLinks[j].el.setAttribute('aria-current', 'location');
      else spyLinks[j].el.removeAttribute('aria-current');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();
})();
