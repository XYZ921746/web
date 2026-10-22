/* ============================================================================
 * 情景演绎装配（Live2D 通话入口 + 设置面板）
 *
 * 这段装配原先住在独立的「Live2D 视频通话」插件里（register.js）。合并后它不再是
 * 注册点，而是由 galgame/index.js 在装配主界面的同时一并调用：
 *
 *   · settings.modal 插槽 → 「情景演绎设置」（内容见 panel.html）
 *   · 主界面的 ⚙ 设置 / 顶栏按钮 → 打开这个设置
 *   · Live2D 的提示词 → 交给 galgame 的 syncSceneHint 一起注入
 *
 * 为什么**不**再注册 header.actions：合并后入口只有一个 —— galgame 主界面上的
 * 「🎭 情景演绎」按钮，用户不必再记"顶栏还有个视频通话"。
 *
 * 注意：本文件不是注册点。index-live2d.js / settings-panel.js 都**不**自己调
 *   ElainaMods.register —— 注册表是 Map，多注册一次会覆盖掉 galgame 主界面。
 * ========================================================================== */
(function () {
    'use strict';
    // 合并包的标记：测试与排障靠它确认"这份代码是主包带进来的"，
    // 而不是旧版 live2d 插件还在。
    globalThis.ElainaMerge = true;

    /** 面板 HTML 只取一次（缓存住，重新挂载时复用） */
    let panelHtmlPromise = null;
    function loadPanelHtml(host) {
        if (!panelHtmlPromise) {
            panelHtmlPromise = fetch(host.assetUrl('panel.html'), { cache: 'no-store' })
                .then((r) => {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.text();
                })
                .catch((e) => {
                    panelHtmlPromise = null;      // 失败要能重试，别把坏结果缓存住
                    throw e;
                });
        }
        return panelHtmlPromise;
    }

    /**
     * 装配情景演绎的界面部分。由 galgame/index.js 调用（**不是**它自己调 register）。
     *
     * @param {object} host galgame 插件的 host API
     */
    function mountScenarioStage(host) {
        host.log('情景演绎：开始装配（引擎与模型来自 live2d-models）');

        // 引擎与模型的引用（缺它时 galgame 的 manifest.after 会先拦住；这里只是留个日志）
        const models = host.require('live2d-models');
        if (!models.ok) {
            host.error('情景演绎缺少资源插件：' + models.reason);
        } else {
            host.log('资源插件就绪（模型基址 ' + models.base() + '）');
        }

        // ---- 实现主体：全屏通话界面 ----
        if (typeof window.__live2dInitCore === 'function') {
            window.__live2dInitCore(host);
        } else {
            // 脚本没注入成功时要说清楚 —— 否则表现为"插件是 ready、但点了没反应"
            host.error('index-live2d.js 未就绪（__live2dInitCore 不存在），情景演绎不可用');
        }

        // ---- 设置：独立成窗（不占主设置的分栏）----
        host.slot('settings.modal', {
            id: 'scenario',
            label: '情景演绎',
            title: '情景演绎设置',
            async render(container) {
                container.innerHTML = '<div class="text-[11px] text-indigo-400 py-4">正在加载情景演绎设置…</div>';
                let html;
                try {
                    html = await loadPanelHtml(host);
                } catch (e) {
                    // 面板是包内静态文件，取不到说明装坏了 —— 说清楚，别留空白
                    container.innerHTML = '<div class="text-[11px] text-red-500 py-4 leading-relaxed">'
                        + '情景演绎设置面板加载失败（' + String((e && e.message) || e) + '）。<br>'
                        + '请确认插件目录里有 <code>panel.html</code>，然后刷新页面重试。</div>';
                    host.error('情景演绎设置面板加载失败', e);
                    return;
                }
                container.innerHTML = html;
                try {
                    if (typeof window.__live2dInitSettingsPanel === 'function') {
                        window.__live2dInitSettingsPanel(host);
                    } else {
                        host.warn('settings-panel.js 未就绪，面板只有外观没有行为');
                    }
                } catch (e) {
                    host.error('情景演绎设置面板初始化失败', e);
                }
            },
        });

        return {
            /** 停用时收起通话界面（自建界面自己收，见 mods.js 的生命周期说明） */
            closeCall() {
                if (window.Live2DCall && typeof window.Live2DCall.close === 'function') {
                    try { window.Live2DCall.close(); } catch (e) { /* 忽略 */ }
                }
            },
            isCallOpen: () => Boolean(window.Live2DCall && window.Live2DCall.isOpen && window.Live2DCall.isOpen()),
        };
    }

    window.__galgameMountScenarioStage = mountScenarioStage;
})();
