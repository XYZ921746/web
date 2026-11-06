// 桌宠（mod）：悬浮立绘 + 聊天气泡 + 输入条，回复情绪自动切表情；应用内浮层、自建 DOM（可插拔，不需要宿主页面配合）。
// 立绘与情绪识别与 Galgame 共用 window.ElainaAvatar（词表只有一份）；发送走 host.sendUserMessage，与主界面同链路。
// 桌面形态走 Document Picture-in-Picture（Chromium 系浏览器）：应用内浮层盖不到其它应用，只有系统级窗口才能常驻桌面置顶；
// 没有该 API 的环境（Firefox / 旧内核）不出现入口，留在应用内浮层。
(function () {
    'use strict';

    const MOD_ID = 'pet';

    window.ElainaMods.register(MOD_ID, function (host) {
        // 资源路径与持久化都走宿主（D1 / D2）：不自己拼插件资源路径，也不直接读写浏览器本地存储。
        function get(k, d) {
            try { return host.storage.get(k, d); } catch (e) { return d; }
        }
        function set(k, v) {
            try { host.storage.set(k, v); } catch (e) { /* 忽略 */ }
        }

        let root = null, avatarEl = null, bubbleEl = null, inputEl = null;
        let typeTimer = null, emoTimer = null, dragState = null;
        let enabled = false;

        // 桌面置顶小窗（Document Picture-in-Picture）。pipWin 指向小窗 window；returningToPage 标记
        // 「我们主动关的小窗」—— 用户自己关小窗是「不要桌宠了」（要收起），主动回页面则桌宠留下，两种关法语义不同。
        const pipSupported = Boolean(window.documentPictureInPicture
            && typeof documentPictureInPicture.requestWindow === 'function');
        let pipWin = null;
        let returningToPage = false;

        // 原生透明桌宠（桌面壳 WebView2 宿主）：壳开「无边框透明置顶窗」，桌宠页与本页同源，
        // 情绪/气泡经 BroadcastChannel 同步。纯浏览器没有壳桥，🖥 自动落到 PiP 兜底。
        const CH_NAME = 'elaina-pet';
        let deskChan = null;      // 与透明桌宠页的通道
        let nativePet = false;    // 原生透明窗是否在场
        let curEmotion = 'calm';  // 最近一次情绪（透明页 hello 时要补发当前状态）
        let offNativeClosed = null;

        // 立绘与情绪（公共依赖）

        function avatarApi() {
            return (window.ElainaAvatar && typeof window.ElainaAvatar.src === 'function')
                ? window.ElainaAvatar : null;
        }
        function avatarSrc(key) {
            const api = avatarApi();
            return api ? api.src(key) : '';
        }
        function emotionFrom(text) {
            const api = avatarApi();
            if (api && typeof api.fromText === 'function') {
                try { return api.fromText(text); } catch (e) { /* 回落 */ }
            }
            return null;
        }
        /** 情绪键 → 立绘 URL 全表（发给透明桌宠页，全部解析成绝对地址）。
         * URL 优先取 require 拿到的**注册表内**实例的 src()：并发装载时被顶掉的是 window 全局，
         * 注册表里的 api 是工厂设好基址的那份，不受影响；也不能自己拼基址——
         * require 给的 base 是带 img/ 的立绘基址，再拼一层就是 404。 */
        function emotionMap() {
            const api = avatarApi();
            let srcFn = null;
            try {
                const req = host.require('elaina-avatar');
                if (req && req.ok && req.api && typeof req.api.src === 'function') srcFn = (k) => req.api.src(k);
            } catch (e) { /* 忽略，回落全局 */ }
            if (!srcFn && api && typeof api.src === 'function') srcFn = (k) => api.src(k);
            const keys = api && Array.isArray(api.EMOTIONS) ? api.EMOTIONS : ['calm'];
            const out = {};
            for (const k of keys) {
                try {
                    const rel = srcFn ? srcFn(k) : '';
                    if (rel) out[k] = new URL(rel, location.href).href;
                } catch (e) { /* 单键失败不拖累其余 */ }
            }
            return out;
        }
        /** 壳桥是否可用（host.desktopWindow 是能力组成员，manifest 未声明时是 undefined） */
        function nativeAvailable() {
            const dw = host.desktopWindow;
            return Boolean(dw && typeof dw.available === 'function' && dw.available());
        }
        // 切换表情：桌宠是"短暂反应"，显示几秒后自动回到 calm（Galgame 保持到剧情变化）。
        function setEmotion(key, holdMs) {
            const k0 = key == null ? 'calm' : key;
            const api = avatarApi();
            const list = api ? api.EMOTIONS : ['calm'];
            const k = list.indexOf(k0) >= 0 ? k0 : 'calm';
            curEmotion = k;
            // 透明桌宠页没有自己的情绪识别：主页面每切一次就推一次
            if (nativePet && deskChan) {
                try { deskChan.postMessage({ type: 'emotion', key: k }); } catch (e) { /* 忽略 */ }
            }
            if (!avatarEl) return;
            const src = avatarSrc(k);
            if (src && avatarEl.getAttribute('src') !== src) {
                avatarEl.setAttribute('src', src);
                avatarEl.classList.remove('emo-swap');
                void avatarEl.offsetWidth;
                avatarEl.classList.add('emo-swap');
            }
            if (emoTimer) clearTimeout(emoTimer);
            if (k !== 'calm') {
                emoTimer = setTimeout(() => setEmotion('calm'), holdMs || 4200);
            }
        }

        function build() {
            if (root) return;
            root = document.createElement('div');
            root.id = 'petLayer';
            // 位置：右下角悬浮。用户拖动后位置会被记住。
            const pos = get('pos', '');
            root.style.cssText = 'position:fixed;z-index:44;display:none;'
                + 'right:18px;bottom:18px;width:min(360px,88vw);'
                + 'filter:drop-shadow(0 18px 40px rgba(0,0,0,.35))';
            root.innerHTML =
                '<div id="petDrag" style="height:26px;cursor:move;display:flex;align-items:center;justify-content:center;'
                  + 'position:relative;'
                  + 'border-radius:14px 14px 0 0;background:rgba(255,255,255,.55);backdrop-filter:blur(10px);'
                  + 'font-size:11px;color:#6366f1;user-select:none">'
                  + '<span id="petDragHint">⠿ 按住拖动</span>'
                  + '<span style="position:absolute;right:6px;top:3px;display:flex;gap:4px;align-items:center">'
                  // 桌面入口只在有系统级置顶能力时渲染（壳的原生透明窗 / 浏览器的 PiP），否则显示了也点不出想要的效果。
                  + ((pipSupported || nativeAvailable())
                      ? '<button id="petDesktop" type="button" title="浮到桌面（透明桌宠 / 置顶小窗）" '
                        + 'style="height:20px;padding:0 7px;border-radius:10px;'
                        + 'border:1px solid rgba(99,102,241,.35);background:rgba(255,255,255,.6);cursor:pointer;'
                        + 'font-size:10px;color:#6366f1;line-height:18px">🖥 桌面</button>'
                      : '')
                  // 主动搭话开关：默认关闭 —— 会主动发消息、还会读电脑状态的功能必须用户明确开启。
                  + '<button id="petProactive" type="button" title="主动搭话：定时看看你在忙什么，主动说句话" '
                    + 'style="height:20px;padding:0 7px;border-radius:10px;'
                    + 'border:1px solid rgba(99,102,241,.35);background:rgba(255,255,255,.6);cursor:pointer;'
                    + 'font-size:10px;color:#6366f1;line-height:18px">主动搭话</button>'
                  + '</span>'
                + '</div>'
                + '<div id="petCard" style="border-radius:0 0 18px 18px;overflow:hidden;'
                  + 'background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.55));'
                  + 'backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.7);border-top:0">'
                  + '<div id="petBubbles" style="max-height:190px;overflow-y:auto;padding:10px 12px 4px;display:flex;flex-direction:column;gap:8px"></div>'
                  + '<div style="position:relative;height:190px;display:flex;align-items:flex-end;justify-content:center;pointer-events:none">'
                    + '<img id="petAvatar" src="' + avatarSrc('calm') + '" alt="伊蕾娜" '
                    + 'style="max-height:100%;max-width:82%;object-fit:contain;object-position:bottom center;'
                    + 'animation:pet-breathe 6.5s ease-in-out infinite">'
                  + '</div>'
                  + '<div style="display:flex;gap:6px;padding:8px 10px 12px;align-items:center">'
                    + '<button id="petMic" type="button" title="语音输入" '
                      + 'style="flex:none;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.8);'
                      + 'background:rgba(255,255,255,.7);cursor:pointer;font-size:15px">🎤</button>'
                    + '<input id="petInput" type="text" placeholder="和伊蕾娜说点什么…" autocomplete="off" '
                      + 'style="flex:1;min-width:0;padding:8px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.9);'
                      + 'background:rgba(255,255,255,.8);font-size:13px;color:#1e1b4b;outline:none">'
                    + '<button id="petSend" type="button" '
                      + 'style="flex:none;width:34px;height:34px;border-radius:50%;border:0;cursor:pointer;'
                      + 'background:linear-gradient(135deg,#f472b6,#a78bfa);color:#fff;font-size:15px">➤</button>'
                    + '<button id="petClose" type="button" title="收起桌宠" '
                      + 'style="flex:none;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.8);'
                      + 'background:rgba(255,255,255,.7);cursor:pointer;font-size:14px">✕</button>'
                  + '</div>'
                + '</div>';

            document.body.appendChild(root);
            avatarEl = root.querySelector('#petAvatar');
            bubbleEl = root.querySelector('#petBubbles');
            inputEl = root.querySelector('#petInput');

            // 拖动（记住位置）
            const dragBar = root.querySelector('#petDrag');
            dragBar.addEventListener('pointerdown', (ev) => {
                // 桌面小窗形态整窗由系统拖动：自绘拖拽只属于应用内浮层，且它的边界算的是主窗口尺寸，在小窗里会把坐标算错。
                if (root.classList.contains('pet-desktop')) return;
                const r = root.getBoundingClientRect();
                dragState = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
                dragBar.setPointerCapture(ev.pointerId);
            });
            dragBar.addEventListener('pointermove', (ev) => {
                if (!dragState) return;
                // 用 left/top 定位，并把 right/bottom 清掉（否则两者同时生效会互相拉扯）
                const x = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dragState.dx));
                const y = Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dragState.dy));
                root.style.left = x + 'px';
                root.style.top = y + 'px';
                root.style.right = 'auto';
                root.style.bottom = 'auto';
            });
            dragBar.addEventListener('pointerup', () => {
                if (!dragState) return;
                dragState = null;
                set('pos', root.style.left + ',' + root.style.top);
            });

            root.querySelector('#petClose').addEventListener('click', () => collapseAndSyncOff());
            const deskBtn = root.querySelector('#petDesktop');
            if (deskBtn) {
                deskBtn.addEventListener('click', (ev) => {
                    // 阻止冒泡：它在拖动条里，不拦的话点按钮会触发拖拽
                    ev.stopPropagation();
                    if (nativePet) {
                        // 原生桌宠在场：按钮当「收起」，与窗内 ✕ 同语义（关窗回发 closed 统一收口）
                        try { host.desktopWindow.close(MOD_ID); } catch (e) { /* 忽略 */ }
                    } else if (pipWin) {
                        backToPage();
                    } else if (!openNative()) {
                        void toDesktop({ fromClick: true });
                    }
                });
            }
            root.querySelector('#petMic').addEventListener('click', startVoice);
            root.querySelector('#petSend').addEventListener('click', send);
            inputEl.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.stopPropagation(); send(); }
            });
            inputEl.addEventListener('click', (ev) => ev.stopPropagation());

            const proBtn = root.querySelector('#petProactive');
            const paintProactive = () => {
                if (!proBtn) return;
                const on = isProactive();
                proBtn.textContent = on ? '主动搭话 · 开' : '主动搭话';
                proBtn.style.background = on ? 'rgba(99,102,241,.9)' : 'rgba(255,255,255,.6)';
                proBtn.style.color = on ? '#fff' : '#6366f1';
            };
            proBtn.addEventListener('click', async (ev) => {
                // 阻止冒泡：它在拖动条里，不拦的话点按钮会触发拖拽
                ev.stopPropagation();
                const next = !isProactive();
                if (!next) {
                    setProactive(false);
                    paintProactive();
                    addBubble('那我就不打扰你了', 'ai');
                    return;
                }
                paintProactive();
                // 顺序很重要：先 setProactive 再 paint；只等它返回的这一次执行结果，自己再截屏会重复截图并弹重复气泡。
                const r = await setProactive(true);
                paintProactive();
                if (!r || r.skipped === 'no-screenshot' || r.skipped === 'needs-restart') {
                    // 截不了屏就如实说明并把开关关回去：开着却什么都不发生比明说"没有这个能力"更糟。
                    // 文案由 proactiveOnce 按具体原因弹（没重启 / 没有服务端），这里不再重复。
                    setProactive(false);
                    paintProactive();
                    return;
                }
                if (r.skipped === 'no-conversation') {
                    addBubble('还没有对话呢，先开一个对话我才能跟你说话～', 'ai');
                    return;
                }
                if (r.sent) addBubble('好呀，我会时不时看看你的屏幕，有事就叫你～', 'ai');
                else addBubble('发送失败了，可能对话已经不在了', 'ai');
            });
            paintProactive();

            // 恢复上次位置
            const p = String(pos).split(',');
            if (p.length === 2 && p[0].endsWith('px') && p[1].endsWith('px')) {
                root.style.left = p[0];
                root.style.top = p[1];
                root.style.right = 'auto';
                root.style.bottom = 'auto';
            }
        }

        function addBubble(text, who) {
            const div = document.createElement('div');
            const mine = who === 'me';
            div.style.cssText = 'max-width:88%;padding:7px 11px;border-radius:14px;font-size:13px;line-height:1.6;'
                + (mine
                    ? 'align-self:flex-end;background:linear-gradient(135deg,rgba(244,114,182,.9),rgba(167,139,250,.9));color:#fff'
                    : 'align-self:flex-start;background:rgba(255,255,255,.92);color:#1e1b4b;border:1px solid rgba(255,255,255,.9)');
            const speak = document.createElement('div');
            speak.style.cssText = 'font-size:10px;font-weight:700;opacity:.75;margin-bottom:2px';
            speak.textContent = mine ? '你' : '伊蕾娜';
            const msg = document.createElement('div');
            msg.style.cssText = 'white-space:pre-wrap;word-break:break-word';
            msg.textContent = text;
            div.appendChild(speak);
            div.appendChild(msg);
            bubbleEl.appendChild(div);
            bubbleEl.scrollTop = bubbleEl.scrollHeight;
            // 只留最近 12 条，避免长对话把气泡区撑爆
            while (bubbleEl.children.length > 12) bubbleEl.removeChild(bubbleEl.firstChild);
            // 透明桌宠页只显示 AI 的话（用户自己的话已经在主输入框里看到了）
            if (nativePet && deskChan && !mine) {
                try { deskChan.postMessage({ type: 'bubble', text }); } catch (e) { /* 忽略 */ }
            }
            return msg;
        }

        /** 打字机效果（桌宠气泡用纯文本 —— 气泡很小，Markdown 反而挤） */
        function typewrite(el, text) {
            if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
            let i = 0;
            el.textContent = '';
            const full = String(text || '');
            typeTimer = setInterval(() => {
                i += 2;
                el.textContent = full.slice(0, i);
                bubbleEl.scrollTop = bubbleEl.scrollHeight;
                if (i >= full.length) { clearInterval(typeTimer); typeTimer = null; }
            }, 26);
        }

        // 与主对话同步

        let lastMsgKey = '';

        function msgKey(m) { return m ? (m.id + ':' + (m.text || '').length) : ''; }

        // 把主对话最新一条回复显示到桌宠气泡：桌宠不自己维护对话，读 host.getMessages() 共用同一份数据。
        function syncFromState() {
            const msgs = host.getMessages().filter((m) => m && m.text && m.role !== 'system');
            if (!msgs.length) return;
            const last = msgs[msgs.length - 1];
            const key = msgKey(last);
            if (key === lastMsgKey) return;
            lastMsgKey = key;
            addBubble(last.text, last.role === 'user' ? 'me' : 'ai');
            if (last.role !== 'user') {
                setEmotion(emotionFrom(last.text));
                // 桌宠朗读：走宿主 TTS（供应商/Key 未配置时静默跳过）；应用自己的语音模式若也开着，
                // 两边会各念各的——不想要叠加就在桌宠设置里关掉「朗读」。
                if (get('petTts', '1') === '1' && typeof host.speechConfigured === 'function' && host.speechConfigured()) {
                    try { host.speak(last.text); } catch (e) { /* 忽略 */ }
                }
            } else {
                setEmotion('calm');
            }
        }

        // 主动搭话（随机截屏版）：到点抓一张屏幕截图发给 AI，让它就画面内容自然搭一句。
        // 截屏在服务端半边（server.mjs，PowerShell 抓屏）——浏览器拿不到桌面画面。
        // 服务端路由只在服务启动时注册：插件「启用后没重启」时接口是 404，与「没有服务端能力」
        // 是两件事，必须分开告诉用户，否则会被当成功能坏了。
        async function captureScreen() {
            let res;
            try { res = await fetch('/api/pet/screenshot', { method: 'POST' }); }
            catch (e) { return { error: 'offline' }; }
            if (res.status === 404) return { error: 'needs-restart' };
            const j = await res.json().catch(() => null);
            return (j && j.ok && j.image) ? { image: j.image } : { error: 'failed', message: j && j.message };
        }

        async function proactiveOnce() {
            const shot = await captureScreen();
            if (shot.error) {
                const text = shot.error === 'needs-restart'
                    ? '截屏接口还没生效：请重启一次应用（服务端接口只在启动时注册）'
                    : '截屏失败：需要电脑版服务端在运行';
                addBubble(text, 'ai');
                return { sent: false, skipped: shot.error === 'needs-restart' ? 'needs-restart' : 'no-screenshot' };
            }
            const conv = host.getConversation();
            if (!conv) {
                addBubble('还没有对话呢，先开一个对话我才能跟你说话～', 'ai');
                return { sent: false, skipped: 'no-conversation' };
            }
            const prompt = [
                '（系统提示：下面这张图是用户电脑屏幕的随机截图。请以伊蕾娜的身份，就截图里你看到的内容',
                '自然地搭一句话，像瞟到屏幕随口点评。不要逐条描述画面、不要提「系统提示」「截图」这类字眼，',
                '一句话，口语化，30 字以内。）',
            ].join('\n');
            const sent = host.sendUserMessage(prompt, { imageDataUrl: shot.image });
            if (!sent) addBubble('发送失败：截图没能进对话', 'ai');
            return { sent };
        }

        // 频率窗口（秒）：快=5 分钟内 / 中=30 分钟内 / 慢=1 小时内 / 自定义=用户给的分钟数。
        // 下一次搭话的时点在窗口的后 70% 区间随机取——「5 分钟以内搭一次」= 1.5~5 分钟之间随机，避免机械感。
        function proactiveWindowSec() {
            const f = get('proactiveFreq', 'fast');
            if (f === 'medium') return 30 * 60;
            if (f === 'slow') return 60 * 60;
            if (f === 'custom') return Math.max(60, Number(get('proactiveCustomMin', 15)) * 60);
            return 5 * 60;
        }

        let proactiveTimer = null;

        function scheduleNextProactive() {
            if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
            if (!isProactive()) return;
            const win = proactiveWindowSec();
            const delaySec = Math.max(30, Math.round(win * (0.3 + 0.7 * Math.random())));
            proactiveTimer = setTimeout(async () => {
                proactiveTimer = null;
                // 桌宠不在场（收起）就不搭话，也不续排——下一次打开时会重新排
                // 桌宠不在场就不搭话（收起时也不续排）：原生透明窗模式下应用内浮层是隐藏的，
                // 在场判据必须以 nativePet 为准，只看 display 会让桌面桌宠永远不触发。
                if (!enabled || !(nativePet || (root && root.style.display !== 'none'))) return;
                try { await proactiveOnce(); } catch (e) { /* 单次失败不影响下一次 */ }
                scheduleNextProactive();
            }, delaySec * 1000);
        }

        // 开关主动搭话（默认关闭）。immediate 默认 true：用户点开关时立即截屏搭一次（否则要等随机时点以为坏了），恢复定时器时传 false。
        function setProactive(on, immediate) {
            set('proactive', on ? '1' : '0');
            // 透明桌宠菜单上的开关标签靠这条消息翻转（应用内按钮走它自己的 paintProactive）
            if (nativePet && deskChan) {
                try { deskChan.postMessage({ type: 'proactive', on: !!on }); } catch (e) { /* 忽略 */ }
            }
            if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
            if (!on) return null;
            const runNow = immediate !== false;
            const first = runNow ? proactiveOnce() : null;
            scheduleNextProactive();
            return first;
        }

        function isProactive() { return get('proactive', '0') === '1'; }

        /** 透明桌宠设置面板的当前配置（菜单「设置」→ 面板，改完经 settings-set 落回存储） */
        function petSettings() {
            return {
                freq: get('proactiveFreq', 'fast'),
                customMin: Number(get('proactiveCustomMin', 15)) || 15,
                tts: get('petTts', '1') === '1',
            };
        }

        function send() {
            const v = (inputEl && inputEl.value || '').trim();
            if (!v) return;
            inputEl.value = '';
            // 先把自己的话显示出来（不等宿主回灌，手感更跟手）
            addBubble(v, 'me');
            setEmotion('calm');
            if (!host.sendUserMessage(v)) {
                addBubble('发送失败：没有当前对话', 'ai');
            }
        }

        function startVoice() {
            try {
                // 从可见的麦克风入口找：隐藏的按钮用户看不到反馈
                const btn = document.querySelector('.conversation-mic-btn')
                    || document.querySelector('.initial-conversation-mic-btn')
                    || document.querySelector('[id*="mic" i]');
                if (btn) {
                    btn.click();
                    addBubble('语音识别中…结果会出现在主输入框', 'ai');
                    return;
                }
                addBubble('未找到语音入口，请在主界面使用麦克风', 'ai');
            } catch (e) { addBubble('语音启动失败', 'ai'); }
        }

        // 桌面置顶小窗（Document Picture-in-Picture）

        /** 收起桌宠并同步关 mod 系统的开关：界面与开关必须一致，否则设置里显示"已启用"、界面却不在，下次刷新又冒出来。 */
        function collapseAndSyncOff() {
            setEnabled(false);
            try {
                if (window.ElainaMods && typeof window.ElainaMods.setEnabled === 'function') {
                    window.ElainaMods.setEnabled(MOD_ID, false);
                }
            } catch (e) { /* 忽略 */ }
            host.log('桌宠已收起');
        }

        /** 关掉置顶小窗（若开着）。root 由 pagehide 搬回主文档，这里只负责标记与关窗。 */
        function closePipWindow() {
            if (!pipWin) return;
            const w = pipWin;
            pipWin = null;
            returningToPage = true;
            try { w.close(); } catch (e) { /* 已在关闭中 */ }
        }

        /** 从小窗回到应用内浮层（🖥 按钮的回程） */
        function backToPage() {
            closePipWindow();
        }

        /**
         * 浮出为桌面置顶小窗。requestWindow 需要用户手势：点「🖥 桌面」或从设置启用的点击链路里可能成功；
         * 页面加载后的自动恢复没有手势，会 NotAllowedError —— 此时留在应用内浮层，不打扰用户。
         */
        async function toDesktop(opts) {
            if (!pipSupported || pipWin || !root) return;
            const fromClick = Boolean(opts && opts.fromClick);
            try {
                const w = await documentPictureInPicture.requestWindow({ width: 340, height: 470 });
                const doc = w.document;
                doc.title = '伊蕾娜 · 桌宠';
                doc.body.style.cssText = 'margin:0;overflow:hidden;height:100vh;'
                    + 'font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;'
                    + 'background:linear-gradient(180deg,#eef0ff,#e4e6f7)';
                // 样式表要给小窗文档单独一份：keyframes/形态类都定义在里面，主文档的 <link> 对另一个文档无效。
                const link = doc.createElement('link');
                link.rel = 'stylesheet';
                link.href = host.assetUrl('style.css');
                doc.head.appendChild(link);
                root.classList.add('pet-desktop');
                doc.body.appendChild(root);
                w.addEventListener('pagehide', onPipHidden);
                pipWin = w;
                host.log('桌宠已浮出为桌面置顶小窗');
            } catch (e) {
                // 自动尝试失败是常态（无手势），静默；用户点了按钮却失败才需要解释。
                if (fromClick) host.warn('置顶小窗打开失败：' + ((e && e.message) || e));
            }
        }

        /** 小窗关闭的统一收口：root 搬回主文档、去掉桌面形态类；用户自己关的（非主动回页面）等于不要桌宠了。 */
        function onPipHidden() {
            const wasReturning = returningToPage;
            pipWin = null;
            returningToPage = false;
            if (!root) return;
            try { document.body.appendChild(root); } catch (e) { /* 主页面也在卸载 */ }
            root.classList.remove('pet-desktop');
            if (!wasReturning) collapseAndSyncOff();
        }

        // 原生透明桌宠（桌面壳）

        function lastAiText() {
            try {
                const msgs = host.getMessages()
                    .filter((m) => m && m.text && m.role !== 'system' && m.role !== 'user');
                return msgs.length ? String(msgs[msgs.length - 1].text) : '';
            } catch (e) { return ''; }
        }

        /** 开原生透明窗。返回 false = 没有壳能力，调用方落 PiP 兜底。 */
        function openNative() {
            const dw = host.desktopWindow;
            if (!dw || !nativeAvailable()) return false;
            // 通道先于开窗建立：窗加载完就发 hello，建晚了会错过
            if (!deskChan) {
                try { deskChan = new BroadcastChannel(CH_NAME); } catch (e) { return false; }
                deskChan.onmessage = (ev) => {
                    const d = ev.data || {};
                    if (d.type === 'hello') {
                        deskChan.postMessage({
                            type: 'init', emotions: emotionMap(), emotion: curEmotion,
                            bubble: lastAiText(), proactive: isProactive(),
                        });
                    } else if (d.type === 'close-request') {
                        // 窗里的 ✕ 与用户直接关窗同语义：壳关窗后回发 closed，状态由 onClosed 统一收口
                        try { dw.close(MOD_ID); } catch (e) { /* 忽略 */ }
                    } else if (d.type === 'focus-request') {
                        try { dw.focusMain(); } catch (e) { /* 忽略 */ }
                    } else if (d.type === 'settings-request') {
                        // 桌宠本地设置面板：配置直接回推到透明窗里改，不跳主应用设置、不打开后台软件
                        try { deskChan.postMessage({ type: 'show-settings', settings: petSettings() }); } catch (e) { /* 忽略 */ }
                    } else if (d.type === 'settings-set') {
                        const cfg = d.settings || {};
                        if (cfg.freq) set('proactiveFreq', String(cfg.freq));
                        set('proactiveCustomMin', String(Math.max(1, Math.min(720, Number(cfg.customMin) || 15))));
                        set('petTts', cfg.tts ? '1' : '0');
                        // 频率变了要重排下一次搭话的随机时点
                        if (isProactive()) scheduleNextProactive();
                        try { deskChan.postMessage({ type: 'settings', settings: petSettings() }); } catch (e) { /* 忽略 */ }
                    } else if (d.type === 'chat-send') {
                        const text = String(d.text || '').trim();
                        if (!text) return;
                        if (!host.getConversation()) {
                            addBubble('还没有对话呢，先开一个对话我才能跟你说话～', 'ai');
                        } else if (!host.sendUserMessage(text)) {
                            addBubble('发送失败：对话可能已经不在了', 'ai');
                        }
                    } else if (d.type === 'proactive-toggle') {
                        // 菜单里的开关：新状态由 setProactive 内部经频道回推，菜单标签自会翻转
                        setProactive(!isProactive());
                    }
                };
            }
            if (!dw.open({
                id: MOD_ID,
                // 壳的窗口要的是绝对地址；assetUrl 给的是站点根相对路径，这里按当前页面解析成绝对
                url: new URL(host.assetUrl('overlay.html'), location.href).href,
                width: 300,
                height: 400,
            })) return false;
            nativePet = true;
            if (typeof dw.onClosed === 'function' && !offNativeClosed) {
                offNativeClosed = dw.onClosed((id) => {
                    if (id !== MOD_ID) return;
                    // 用户/系统关窗 = 不要桌宠了：收起并同步关 mod 开关（与 ✕、关 PiP 小窗同语义）
                    collapseAndSyncOff();
                });
            }
            // 原生桌宠在场时，应用内浮层就是第二个伊蕾娜：藏掉（DOM 保留，同步轮询照常驱动转发）
            if (root) root.style.display = 'none';
            host.log('桌宠已浮出为透明置顶窗');
            return true;
        }

        /** 摘掉原生桌宠的全部状态（订阅、通道、关窗请求）。幂等；窗不在时壳侧忽略关窗请求。 */
        function closeNativeChannel() {
            nativePet = false;
            if (offNativeClosed) { try { offNativeClosed(); } catch (e) { /* 忽略 */ } offNativeClosed = null; }
            if (deskChan) { try { deskChan.close(); } catch (e) { /* 忽略 */ } deskChan = null; }
            try {
                if (host.desktopWindow && host.desktopWindow.available()) host.desktopWindow.close(MOD_ID);
            } catch (e) { /* 忽略 */ }
        }

        // 开关

        let pollTimer = null;

        function open() {
            build();
            root.style.display = 'block';
            // 首次打开时把最近几条对话铺上去（否则气泡区是空的）
            const msgs = host.getMessages().filter((m) => m && m.text && m.role !== 'system').slice(-4);
            bubbleEl.innerHTML = '';
            if (!msgs.length) {
                addBubble('你好呀，我是伊蕾娜～', 'ai');
            } else {
                for (const m of msgs) addBubble(m.text, m.role === 'user' ? 'me' : 'ai');
            }
            const last = msgs[msgs.length - 1];
            if (last) {
                lastMsgKey = msgKey(last);
                setEmotion(last.role !== 'user' ? emotionFrom(last.text) : 'calm');
            }
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(() => {
                // 只挡「没建过 DOM」：原生桌宠模式下应用内浮层被藏起（display none），但同步轮询
                // 是透明页的更新引擎，不能停。
                if (!root) return;
                try { syncFromState(); } catch (e) { /* 忽略 */ }
            }, 700);
            // 打开桌宠时按用户设置恢复定时器，传 immediate=false：后台恢复不该立刻发一条消息（用户没点开关）。
            if (isProactive()) setProactive(true, false);
            // 打开即浮出：原生透明窗不需要用户手势（壳里启用＝立刻看到桌宠）；非壳环境落 PiP
            // 自动尝试——没有手势时 requestWindow 拒绝，toDesktop 里静默兜底在应用内浮层。
            if (!openNative() && pipSupported) void toDesktop();
        }

        function close() {
            // 先关两路桌宠窗：PiP 的 root 不能留在即将销毁的文档里（pagehide 搬回），原生窗直接请求壳关掉。
            closePipWindow();
            closeNativeChannel();
            if (root) root.style.display = 'none';
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
            if (emoTimer) { clearTimeout(emoTimer); emoTimer = null; }
            // 关掉桌宠就停掉主动搭话 —— 看不见的宠物不该在后台发消息
            if (proactiveTimer) { clearInterval(proactiveTimer); proactiveTimer = null; }
        }

        function setEnabled(on) {
            enabled = !!on;
            set('enabled', on ? '1' : '0');
            if (on) open(); else close();
        }

        // 初始化

        // 不读自己那份 enabled：双重开关会让用户从设置启用 mod 后界面却不出现；语义应是「mod 启用 = 界面出现」。
        enabled = true;
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => open());
        else open();
        host.log('已就绪（立绘走 elaina-avatar，与 Galgame 同源）');

        return {
            setEnabled,
            isOpen: () => Boolean(nativePet || (root && root.style.display !== 'none')),
            toggle: () => setEnabled(!enabled),
            /** 供其他 mod / 宿主主动推一条 AI 回复进来 */
            onReply: (text) => {
                if (!root) return;
                addBubble(String(text || ''), 'ai');
                setEmotion(emotionFrom(text));
            },
            showTip: (text) => {
                if (!root) return;
                addBubble(String(text || ''), 'ai');
            },
            setEmotion,
            /** 立即主动搭话一次（忽略随机时点；用于用户点"现在说一句"） */
            proactiveNow: () => proactiveOnce(),
            /** 开关主动搭话（默认关闭） */
            setProactive,
            isProactive,
        };
    });
})();
