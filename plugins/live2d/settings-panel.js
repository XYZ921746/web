/* ============================================================================
 * Live2D 设置面板的行为（从宿主 app-07-init.js 搬来）
 *
 * ★ 为什么整段包成 init(host) 函数：
 *   原代码在宿主里是**顶层立即执行**的（一堆 document.getElementById(...).addEventListener），
 *   那时面板 HTML 已在 index.html 里。搬进插件后 HTML 由插槽在**被点开时**才插入 DOM ——
 *   顶层执行会全部拿到 null。所以这里只定义、不执行，由 register.js 在渲染完成后调用。
 *
 * ★ 宿主全局已换成 host API（showCustomAlert → host.alert，window.confirm → host.confirm）：
 *   插件不该直接摸宿主内部实现，否则宿主重构就会悄悄弄坏插件。
 * ========================================================================== */
function initLive2DSettingsPanel(host) {
    'use strict';

    // ===== Live2D 设置：模型列表 / 上传 / 测试 =====
    let live2dModelList = [];   // 最近一次拉到的模型列表，重命名时要用
    // 服务端返回的可能不是 JSON（例如服务还是旧版本时，/api/live2d/rename 落到静态处理器返回纯文本 "Not found"）。
    // 直接 res.json() 会抛 "Unexpected token 'N'..."，用户完全看不懂，所以这里统一兜一层。
    async function readJsonSafe(res) {
        const text = await res.text();
        try { return JSON.parse(text); } catch { /* 非 JSON */ }
        return {
            ok: false,
            message: res.status === 404
                ? '服务端没有这个接口（HTTP 404）。多半是 serve.mjs 改了但服务没重启 —— 到 cmd 窗口按 Ctrl+C，再重新双击「启动.bat」。'
                : '服务端返回了非预期的内容（HTTP ' + res.status + '）：' + text.slice(0, 80),
        };
    }
    /**
     * 模型选择：2×2 图片网格（2026-10，用户要求）。
     *
     * 每格 = 模型图片（来自「Live2D 引擎与模型」的资源）+ 下方名字；
     * 悬停出原生 tooltip 显示详情；选中的一格带「已选择」角标与描边。
     * 超过 4 个时容器内部滚动 —— 可视高度故意比两行高一点点，
     * 第三行露出一截，不用说明也能看出下面还有（右侧滚动条常驻）。
     */
    async function refreshLive2DSettingList() {
        const grid = document.getElementById('settingLive2DModelGrid');
        if (!grid) return;
        const empty = document.getElementById('settingLive2DModelEmpty');
        try {
            const res = await fetch('/api/live2d/models', { cache: 'no-store' });
            const json = await readJsonSafe(res);
            live2dModelList = json.models || [];
        } catch (e) {
            console.warn('[Live2D] 列表失败', e);
            live2dModelList = [];
        }

        const current = (window.Live2DCall && typeof window.Live2DCall.getSelectedModel === 'function')
            ? window.Live2DCall.getSelectedModel() : '';
        const detail = (m) => (m.exps ? m.exps.length : 0) + ' 个表情 · '
            + (m.motions ? m.motions.length : 0) + ' 个动作 · '
            + ((Number(m.sizeBytes) || 0) / 1048576).toFixed(1) + ' MB · '
            + (m.fileCount || 0) + ' 个文件' + (m.vtube ? ' · 带 vtube' : '');

        // 没有“正在使用”这一说时（通话还没初始化），把第一个当默认展示选中态，
        // 但**不**写回 selectedModel —— 只有用户真的点了一格才算做了选择。
        const list = live2dModelList.filter((m) => m && m.name);
        if (empty) empty.classList.toggle('hidden', list.length > 0);

        grid.innerHTML = list.map((m) => {
            const name = String(m.name);
            const escName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            // 图片：服务端给的是相对模型根目录的路径，走 ElainaLive2DModels.assetUrl
            // （按真实安装目录算，不写死 /mods/live2d-models/）
            const icon = (m.icon && window.ElainaLive2DModels
                && typeof window.ElainaLive2DModels.assetUrl === 'function')
                ? window.ElainaLive2DModels.assetUrl(m.name, m.icon, m.bundled) : '';
            const isSel = name === current;
            const img = icon
                ? '<img src="' + icon + '" alt="" loading="lazy" class="w-full h-full object-cover"'
                    + ' onerror="this.style.display=\'none\'">'
                : '';
            return '<button type="button" data-model-name="' + escName + '"'
                + ' title="' + escName + '\n' + detail(m).replace(/"/g, '&quot;') + '"'
                + ' class="l2d-model-cell group relative flex flex-col rounded-xl overflow-hidden'
                + ' border-2 transition-colors cursor-pointer text-left'
                + (isSel
                    ? ' border-pink-500 bg-pink-50/70'
                    : ' border-white/60 bg-white/50 hover:border-indigo-300') + '"'
                + ' style="padding:0">'
                // ★ 图片区**固定高度**（128px），不用 aspect-square ——
                //   aspect-square 在半宽容器里会把格子撑到近 300px 高，
                //   2×2 变成一大行，一眼只能看见 2 个（实测踩到）。
                //   固定高 + object-cover：任何图片都正好填满，四格恒定两行。
                //   128px：用户反馈 96px 时"模型看不全"（模型是立绘，越高越看得清脸）。
                + '<span class="block w-full bg-white/60 overflow-hidden" style="height:128px">' + img + '</span>'
                // 名字：一格一行，超长省略
                + '<span class="block w-full text-[11px] font-medium text-indigo-800 px-1.5 py-1 truncate text-center">'
                    + escName + '</span>'
                // 选中角标
                + (isSel
                    ? '<span class="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded-full'
                        + ' bg-pink-500 text-white shadow">已选择</span>'
                    : '')
                + '</button>';
        }).join('');

        // 点一格 = 选它。同步通话界面、更新右侧详情区、通话开着就立刻换人。
        const detailName = document.getElementById('settingLive2DModelDetailName');
        const detailInfo = document.getElementById('settingLive2DModelDetailInfo');
        /** 右侧详情区跟随选中项（默认显示当前选中的那个）。
         *  ★「打开文件夹」按钮已删（2026-10 用户要求）：管理动作统一收进
         *    「📦 管理模型」，详情区只读、不放操作，界面更简单。 */
        const showDetail = (m) => {
            if (!m) {
                if (detailName) detailName.textContent = '（未选择）';
                if (detailInfo) detailInfo.textContent = '选一个模型看详情。';
                return;
            }
            if (detailName) detailName.textContent = m.name;
            if (detailInfo) detailInfo.textContent = detail(m);
        };
        showDetail(list.find((m) => m.name === current) || list[0] || null);

        grid.querySelectorAll('.l2d-model-cell').forEach((cell) => {
            cell.addEventListener('click', () => {
                const n = cell.getAttribute('data-model-name');
                if (window.Live2DCall && typeof window.Live2DCall.setSelectedModel === 'function') {
                    window.Live2DCall.setSelectedModel(n);
                }
                showDetail(live2dModelList.find((m) => m.name === n));
                // 本地选中态立刻刷新（不等下次拉列表）
                grid.querySelectorAll('.l2d-model-cell').forEach((c) => {
                    const on = c === cell;
                    c.classList.toggle('border-pink-500', on);
                    c.classList.toggle('bg-pink-50/70', on);
                    c.classList.toggle('border-white/60', !on);
                    c.classList.toggle('hover:border-indigo-300', !on);
                    const badge = c.querySelector('.absolute');
                    if (on && !badge) {
                        const b = document.createElement('span');
                        b.className = 'absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded-full bg-pink-500 text-white shadow';
                        b.textContent = '已选择';
                        c.appendChild(b);
                    } else if (!on && badge) {
                        badge.remove();
                    }
                });
            });
        });
    }

    // ★ 2026-10：模型的上传 / 重命名 / 删除**已搬到「Live2D 引擎与模型」**（用户要求）。
    //   这里是『用哪个模型』的界面；模型是那个资源包的资产 ——
    //   视频通话只是消费方，卸载它不该把模型一起带走。
    document.getElementById("settingLive2DManage")?.addEventListener("click", () => {
        const openers = window.__modSettingsOpeners || {};
        const open = openers["live2d-models"];
        if (typeof open === "function") { open(); return; }
        // 资源包没启用 / 没注册设置时，说清楚该去哪，别让按钮点了没反应
        host.alert("「Live2D 引擎与模型」没有可打开的设置。\n\n"
            + "请到「设置 → 插件」确认它已启用（它是模型资源的宿主，装模型要在那儿操作）。",
            "管理模型");
    });

    // ===== 背景（图片 + 场景背景图资源包） =====
    // ★ 2026-10 移除了预设渐变 / 纯色 / 自定义颜色（用户要求）：那些是『填满画面』的
    //   临时方案，真正想要的背景是图。现在只留上传图片 + 从资源包里挑 + 清除。
    let bgToastTimer = null;
    function bgToast(msg) {
        let el = document.getElementById("live2d-bg-toast");
        if (!el) {
            el = document.createElement("div");
            el.id = "live2d-bg-toast";
            el.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:100001;background:rgba(15,23,42,.92);color:#fff;padding:8px 16px;border-radius:999px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.35);transition:opacity .25s;pointer-events:none;white-space:nowrap";
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = "1";
        clearTimeout(bgToastTimer);
        bgToastTimer = setTimeout(() => { el.style.opacity = "0"; }, 1600);
    }

    /** 场景背景图选择区：装了「场景背景图」资源包才显示 */
    function renderSceneBackgrounds() {
        const wrap = document.getElementById("live2dBgScenesWrap");
        const box = document.getElementById("live2dBgScenes");
        if (!wrap || !box) return;
        const sb = window.ElainaSceneBackgrounds;
        // 资源包不在（没装/没启用）→ 整块隐藏；上面的提示文案会告诉用户去装一个
        if (!sb || typeof sb.list !== "function") { wrap.classList.add("hidden"); return; }
        let items = [];
        try { items = sb.list() || []; } catch (e) { items = []; }
        if (!items.length) { wrap.classList.add("hidden"); return; }
        wrap.classList.remove("hidden");
        box.innerHTML = "";
        const cur = window.Live2DCall?.getBackground ? window.Live2DCall.getBackground() : "";
        for (const it of items) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "l2d-bg-opt";
            b.dataset.bg = "url(" + it.url + ")";
            b.title = it.label;
            b.style.cssText = "background-image:url(" + it.url + ");background-size:cover;background-position:center;"
                + "width:52px;height:34px;border-radius:9px;border:2px solid rgba(255,255,255,.25);cursor:pointer";
            if (b.dataset.bg === cur) b.classList.add("selected");
            b.addEventListener("click", () => {
                if (window.Live2DCall?.setBackground) window.Live2DCall.setBackground(b.dataset.bg);
                box.querySelectorAll(".l2d-bg-opt").forEach((x) => x.classList.toggle("selected", x === b));
                bgToast("✅ 背景已应用：" + it.label);
            });
            box.appendChild(b);
        }
    }

    document.getElementById("settingLive2DBgImage")?.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (window.Live2DCall?.setBackground) window.Live2DCall.setBackground("url(" + reader.result + ")");
            document.querySelectorAll("#live2dBgScenes .l2d-bg-opt").forEach((x) => x.classList.remove("selected"));
            bgToast("✅ 背景图片已应用");
        };
        reader.readAsDataURL(file);
        e.target.value = "";
    });
    document.getElementById("settingLive2DBgClear")?.addEventListener("click", () => {
        if (window.Live2DCall?.setBackground) window.Live2DCall.setBackground("");
        document.querySelectorAll("#live2dBgScenes .l2d-bg-opt").forEach((x) => x.classList.remove("selected"));
        bgToast("已恢复默认背景");
    });
    document.getElementById("settingLive2DTest")?.addEventListener("click", () => {
        if (window.Live2DCall) window.Live2DCall.open();
    });
    // 鼠标跟随开关：状态由 live2d 模块存在 localStorage，勾选即时生效
    function syncMouseFollowBox() {
        const box = document.getElementById('settingMouseFollow');
        if (box) box.checked = window.Live2DCall?.isMouseFollow ? window.Live2DCall.isMouseFollow() : true;
    }


    // ===== 鼠标跟随幅度 =====
    // 滑块 0-10 是标准范围，10 = 原始幅度（×1.0）；右侧数字框可以填更大的数字解锁更高倍率。
    // 需要它的原因：同一个 ParamAngleX=20，不同模型的实际视觉幅度能差约 7 倍，
    // 敏感度低的模型要调高、敏感度高的要调低，否则"同样的设置"在不同模型上完全不是一个效果。
    const MOUSE_SCALE_FALLBACK_MAX = 100;
    const MOUSE_SCALE_BASE = 10;   // 滑块满格 / 数字框里的 10 = ×1.0
    function mouseScaleMax() {
        const m = Number(window.Live2DCall?.getMouseFollowScaleMax?.());
        return Number.isFinite(m) && m > 0 ? m : MOUSE_SCALE_FALLBACK_MAX;
    }
    function mouseScaleCurrent() {
        const v = Number(window.Live2DCall?.getMouseFollowScale?.());
        return Number.isFinite(v) && v >= 0 ? v : MOUSE_SCALE_BASE;
    }
    // keepNumValue：用户在数字框里打字时不要把正在输入的内容覆盖掉（否则「1」还没打完就被改成别的）
    function renderMouseFollowScale(keepNumValue) {
        const level = mouseScaleCurrent();
        const slider = document.getElementById('settingMouseFollowScale');
        const num = document.getElementById('settingMouseFollowScaleNum');
        const label = document.getElementById('mouseFollowScaleLabel');
        const hint = document.getElementById('mouseFollowScaleHint');
        const wrap = document.getElementById('settingMouseFollowScaleWrap');
        const on = document.getElementById('settingMouseFollow')?.checked !== false;
        if (slider) {
            const max = Number(slider.max) || MOUSE_SCALE_BASE;
            slider.value = String(Math.min(level, max));
            updateSliderFill(slider);
            slider.disabled = !on;
        }
        if (num) {
            if (!keepNumValue) num.value = String(level);
            num.max = String(mouseScaleMax());
            num.disabled = !on;
        }
        if (label) label.textContent = '×' + (level / MOUSE_SCALE_BASE).toFixed(1);
        if (hint) {
            if (level === 0) hint.textContent = '已归零，模型不跟随';
            else if (level > MOUSE_SCALE_BASE) {
                // 头部幅度被模型自身参数量程锁死，超过上限后只有身体跟随还会继续变大。
                // 这里把上限直接告诉用户，免得他以为"数字填了没用"是 bug。
                const info = window.Live2DCall?.getFollowAmpInfo?.();
                if (info && info.loaded && info.headSaturateAt) {
                    hint.textContent = `头部上限 ×${info.headSaturateAt}，更高倍率由身体跟随补足`;
                } else if (info && info.loaded) {
                    hint.textContent = '已解锁更高幅度';
                } else {
                    hint.textContent = '已解锁更高幅度（开始通话后生效）';
                }
            } else hint.textContent = '标准范围';
        }
        if (wrap) wrap.style.opacity = on ? '1' : '0.45';
    }
    function syncMouseFollowControls() {
        syncMouseFollowBox();
        renderMouseFollowScale();
    }
    document.getElementById('settingMouseFollow')?.addEventListener('change', (e) => {
        if (window.Live2DCall?.setMouseFollow) window.Live2DCall.setMouseFollow(e.target.checked);
        renderMouseFollowScale();
    });
    // 滑块：拖完立刻生效，数字框跟着同步
    document.getElementById('settingMouseFollowScale')?.addEventListener('input', (e) => {
        if (window.Live2DCall?.setMouseFollowScale) window.Live2DCall.setMouseFollowScale(e.target.value);
        renderMouseFollowScale();
    });
    // 数字框：可以填超出滑块范围的值（解锁更高倍率），超出上限时按上限处理
    const mouseScaleNum = document.getElementById('settingMouseFollowScaleNum');
    mouseScaleNum?.addEventListener('input', (e) => {
        if (e.target.value === '') return;   // 清空时先不动，等用户输完
        if (window.Live2DCall?.setMouseFollowScale) window.Live2DCall.setMouseFollowScale(e.target.value);
        renderMouseFollowScale(true);
    });
    // 失焦 / 回车：把实际生效的值（已按上限截断）写回输入框
    mouseScaleNum?.addEventListener('blur', () => renderMouseFollowScale());
    mouseScaleNum?.addEventListener('keydown', (e) => { if (e.key === 'Enter') renderMouseFollowScale(); });
    syncMouseFollowControls();

    // 面板刚渲染出来，先把三处状态同步一遍（原来是靠包装 window.openSettings 做的）
    void refreshLive2DSettingList();
    renderSceneBackgrounds();
    syncMouseFollowControls();
}

// 暴露给 register.js（经典脚本共享全局作用域，不 export）
window.__live2dInitSettingsPanel = initLive2DSettingsPanel;