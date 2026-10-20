/* 目录页搜索与筛选：模型区、插件商店共用。
   列表由各自页面的脚本渲染，这里只负责显示/隐藏与无障碍状态。 */
(function () {
  'use strict';

  window.ElainaCatalog = function (options) {
    var toolbar = document.querySelector(options.toolbar);
    var list = document.querySelector(options.list);
    var search = document.querySelector(options.search);
    var status = document.querySelector(options.status);
    var empty = document.querySelector(options.empty);
    if (!toolbar || !list || !search || !status || !empty) return null;

    var buttons = Array.prototype.slice.call(toolbar.querySelectorAll('[data-filter]'));
    var cards = [];
    var activeFilter = 'all';

    function apply() {
      var query = (search.value || '').trim().toLowerCase();
      var filtering = query !== '' || activeFilter !== 'all';
      var shown = 0;

      cards.forEach(function (card) {
        var matchesKind = activeFilter === 'all' || card.getAttribute('data-kind') === activeFilter;
        var haystack = (card.getAttribute('data-search') || '').toLowerCase();
        var matchesQuery = !query || haystack.indexOf(query) !== -1;
        var visible = matchesKind && matchesQuery;
        card.hidden = !visible;
        if (visible) shown += 1;
      });

      if (!filtering) {
        status.textContent = '可搜索名称、作者或说明。';
      } else {
        status.textContent = shown ? '找到 ' + shown + ' 个匹配项。' : '没有匹配项。';
      }
      empty.hidden = !filtering || shown !== 0;
    }

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        activeFilter = button.getAttribute('data-filter') || 'all';
        buttons.forEach(function (item) {
          item.setAttribute('aria-pressed', String(item === button));
        });
        apply();
      });
    });
    search.addEventListener('input', apply);

    return function activate() {
      cards = Array.prototype.slice.call(list.querySelectorAll('[data-catalog-card]'));
      if (!cards.length) return;
      toolbar.hidden = false;
      list.setAttribute('aria-busy', 'false');
      apply();
    };
  };
})();
