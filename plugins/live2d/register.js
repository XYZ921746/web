/* ============================================================================
 * Live2D 视频通话（功能插件）—— 注册与界面装配
 *
 * 本文件负责"把插件挂到宿主界面上"：
 *   · settings.tabs 插槽  → 「设置 → Live2D」分栏（内容见 panel.html）
 *   · header.actions 插槽 → 顶部「视频通话」按钮
 *   · 模型资源            → 走 live2d-models（host.require）
 *
 * 具体实现分在几个文件里，各管一件事：
 *   index.js           实现主体（通话界面、口型、表情/动作驱动）—— 由 live2d-video.js 搬来
 *   settings-panel.js  设置面板的行为（模型列表/上传/重命名/背景/鼠标跟随）
 *   panel.html         设置面板的结构（从 index.html 原样搬来）
 *   style.css          设置面板用到的样式（.l2d-bg-opt 等）
 * ========================================================================== */
(function () {
    'use strict';

    const MOD_ID = 'live2d';

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

    window.ElainaMods.register(MOD_ID, function (host) {
        host.log('开始装配（引擎与模型来自 live2d-models）');

        // ---- ⓪ 先启动实现主体 ----
        //
        // 注册点只有一个（本文件）。index.js 与 settings-panel.js 都**不**自己注册 ——
        //   pendingRegistrations 是 Map，两个文件都调 register 的话后注册的会覆盖前一个，
        //   结果是"插件 ready，但只有一半装配生效"。
        //   它们只暴露 init 函数，由这里按顺序调用。
        if (typeof window.__live2dInitCore === 'function') {
            window.__live2dInitCore(host);
        } else {
            // 脚本没注入成功时要说清楚 —— 否则表现为"插件是 ready、但点了没反应"
            host.error('index.js 未就绪（__live2dInitCore 不存在），通话界面不可用');
        }

        // ---- ① 设置：独立成窗（不占主设置的分栏）----
        //
        // 2026-10 从 settings.tabs 改成 settings.modal（用户要求）：
        //   插件设置全堆在主设置里，插件一多就会堆一排分栏（外观/角色/对话/…/Live2D/插件），
        //   难找也难看。改成独立弹窗后，从插件卡片的齿轮按钮进入。
        //   render(container) 的契约与原来一样，所以面板代码不用改。
        host.slot('settings.modal', {
            id: MOD_ID,
            label: 'Live2D',
            title: 'Live2D 视频通话',
            // render 在**首次打开时**才调用（延迟渲染，不白占启动时间）
            async render(container) {
                container.innerHTML = '<div class="text-[11px] text-indigo-400 py-4">正在加载 Live2D 设置…</div>';
                let html;
                try {
                    html = await loadPanelHtml(host);
                } catch (e) {
                    // 面板是插件自带的静态文件，取不到说明插件装坏了 —— 说清楚，别留空白
                    container.innerHTML = '<div class="text-[11px] text-red-500 py-4 leading-relaxed">'
                        + 'Live2D 设置面板加载失败（' + String((e && e.message) || e) + '）。<br>'
                        + '请确认插件目录里有 <code>panel.html</code>，然后刷新页面重试。</div>';
                    host.error('设置面板加载失败', e);
                    return;
                }
                container.innerHTML = html;
                // 面板里的控件要靠 settings-panel.js 的绑定才有行为。
                try {
                    if (typeof window.__live2dInitSettingsPanel === 'function') {
                        window.__live2dInitSettingsPanel(host);
                    } else {
                        host.warn('settings-panel.js 未就绪，面板只有外观没有行为');
                    }
                } catch (e) {
                    host.error('设置面板初始化失败', e);
                }
            },
        });

        // ---- ② 顶部按钮：视频通话 ----
        host.slot('header.actions', {
            id: 'call',
            label: '视频通话',
            title: '视频通话（Live2D）',
            svg: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">'
                + '<path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>',
            onClick() {
                if (window.Live2DCall && typeof window.Live2DCall.open === 'function') {
                    window.Live2DCall.open();
                } else {
                    host.error('通话界面未就绪（index.js 未加载成功？）');
                }
            },
        });

        // ---- ③ 模型资源：拿一份引用，便于设置面板与提示词使用 ----
        const models = host.require('live2d-models');
        if (!models.ok) {
            // 正常情况下走不到这里 —— manifest.after 保证缺依赖时**拒绝加载**。
            // 留着是为了万一将来 after 被去掉时能自己说清楚。
            host.error('缺少资源插件：' + models.reason);
        } else {
            host.log('资源插件就绪（模型基址 ' + models.base() + '）');
        }

        // ---- ④ 把两个 Live2D 独有的操作追加进宿主的标签分发链 ----
        //   宿主 web/js/agent-tags.js 负责剥离与分发所有 [操作:] 标签；
        //   这里只注册"水印/静音"这两个只有本插件知道怎么做的操作。
        //   index.js 里已经调过 registerOperationHandler，此处不重复。

        return {
            /** 停用时收起通话界面（自建界面自己收，见 mods.js 的生命周期说明） */
            setEnabled(on) {
                if (!on && window.Live2DCall && typeof window.Live2DCall.close === 'function') {
                    try { window.Live2DCall.close(); } catch (e) { /* 忽略 */ }
                }
            },
            /** 供其它插件取通话状态 */
            isOpen: () => Boolean(window.Live2DCall && window.Live2DCall.isOpen && window.Live2DCall.isOpen()),
        };
    });
})();
