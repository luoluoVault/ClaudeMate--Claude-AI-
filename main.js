let quotePreviewBox;
let quotePreviewText;
let closeQuoteBtn;

document.addEventListener('DOMContentLoaded', () => {
    quotePreviewBox = document.getElementById('quote-preview-box');
    quotePreviewText = document.getElementById('quote-preview-text');
    closeQuoteBtn = document.getElementById('close-quote-btn');

    function saveChatSessionsToLocal() {
        const jsonStr = JSON.stringify(chatSessions, (key, value) => {
            if (key === 'html') return undefined;
            return value;
        });
        localStorage.setItem('chatSessions', jsonStr);
    }

    // --- 知识库 IndexedDB 初始化 ---
    let db;
    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('KnowledgeBaseDB', 3);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('documents')) {
                    const store = db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('characterId', 'characterId', { unique: false });
                    store.createIndex('fileName', 'fileName', { unique: false });
                }
                if (!db.objectStoreNames.contains('chatHTMLs')) {
                    db.createObjectStore('chatHTMLs', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('skills')) {
                    db.createObjectStore('skills', { keyPath: 'name' });
                }
            };
            request.onsuccess = (event) => { db = event.target.result; resolve(db); };
            request.onerror = (event) => { console.error('IndexedDB 初始化失败:', event.target.error); reject(event.target.error); };
        });
    }
    initDB().then(() => {
        let needsMigrationSave = false;
        const tx = db.transaction(['chatHTMLs'], 'readwrite');
        const store = tx.objectStore('chatHTMLs');
        for (const charId in chatSessions) {
            const session = chatSessions[charId];
            if (session.branches) {
                for (const branchName in session.branches) {
                    const branch = session.branches[branchName];
                    if (branch.html !== undefined) {
                        if (branch.html !== '') {
                            store.put({ id: `${charId}_${branchName}`, html: branch.html });
                        }
                        delete branch.html;
                        needsMigrationSave = true;
                    }
                }
            }
        }
        tx.oncomplete = () => {
            if (needsMigrationSave) saveChatSessionsToLocal();
            renderChatList();
            loadSession(currentChatId);
            
            // 初始化默认 Skill
            const skillsTx = db.transaction(['skills'], 'readwrite');
            const skillsStore = skillsTx.objectStore('skills');
            const countReq = skillsStore.count();
            countReq.onsuccess = () => {
                if (countReq.result === 0) {
                    skillsStore.add({
                        name: '翻译助手',
                        description: '将用户输入翻译为英文',
                        content: '# 翻译助手\n\n你现在是一个专业的翻译助手。请将我接下来的所有输入都翻译为地道、流畅的英文。不要输出任何解释，只输出翻译结果。'
                    });
                }
            };
        };
    }).catch(console.error);

    // ============ 分支数据辅助函数 ============
    function ensureBranches(session) {
        if (!session.branches) {
            // 迁移旧数据
            session.branches = { "默认分支": { history: session.history || [], html: session.html || '' } };
            delete session.history;
            delete session.html;
            session.activeBranch = "默认分支";
        }
        if (!session.activeBranch) session.activeBranch = "默认分支";
        if (!session.branches[session.activeBranch]) {
            session.branches[session.activeBranch] = { history: [], html: '' };
        }
    }
    function getCurrentBranchData(session) {
        ensureBranches(session);
        return session.branches[session.activeBranch];
    }
    function getCurrentHistory(session) {
        return getCurrentBranchData(session).history;
    }
    // 1. 侧边栏与遮罩层逻辑
    const toggleRightBtn = document.getElementById('toggle-right-panel');
    const toggleLeftBtn = document.getElementById('toggle-left-panel');
    const rightPanel = document.getElementById('right-panel');
    const leftPanel = document.querySelector('.sidebar-left');
    const overlay = document.getElementById('overlay');

    function showToast(message, duration = 2000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.style.cssText = `background-color: rgba(0, 0, 0, 0.8); color: white; padding: 8px 16px; border-radius: 20px; font-size: 14px; opacity: 0; transition: opacity 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);`;
        toast.textContent = message;
        container.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; });
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
    }
    window.showToast = showToast;

    toggleRightBtn.addEventListener('click', () => {
        rightPanel.classList.toggle('collapsed');
        if (window.innerWidth <= 1024 && !rightPanel.classList.contains('collapsed')) {
            overlay.classList.add('active'); leftPanel.classList.remove('active');
        } else if (window.innerWidth <= 1024) { overlay.classList.remove('active'); }
    });
    if (toggleLeftBtn) {
        toggleLeftBtn.addEventListener('click', () => {
            leftPanel.classList.toggle('active');
            if (leftPanel.classList.contains('active')) { overlay.classList.add('active'); rightPanel.classList.add('collapsed'); }
            else { overlay.classList.remove('active'); }
        });
    }
    overlay.addEventListener('click', () => {
        if (window.innerWidth <= 1024) rightPanel.classList.add('collapsed');
        if (window.innerWidth <= 768) leftPanel.classList.remove('active');
        overlay.classList.remove('active');
    });

    function iosSmoothScrollToBottom(element) {
        if (!element) return;
        requestAnimationFrame(() => {
            const targetScrollTop = element.scrollHeight - element.clientHeight;
            if (targetScrollTop > 0) {
                element.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
            }
        });
    }

    let lastWindowWidth = window.innerWidth;
    function handleResize() {
        if (window.innerWidth === lastWindowWidth) return;
        lastWindowWidth = window.innerWidth;
        if (window.innerWidth > 1024) { overlay.classList.remove('active'); leftPanel.classList.remove('active'); rightPanel.classList.remove('collapsed'); }
        else if (window.innerWidth > 768 && window.innerWidth <= 1024) { rightPanel.classList.add('collapsed'); leftPanel.classList.remove('active'); overlay.classList.remove('active'); }
        else { rightPanel.classList.add('collapsed'); leftPanel.classList.remove('active'); overlay.classList.remove('active'); }
    }
    window.addEventListener('resize', handleResize);

    const chatInputArea = document.querySelector('.chat-input-area');
    if (window.visualViewport && chatInputArea) {
        const initialPaddingBottom = 28, keyboardPaddingBottom = 8;
        function handleVisualViewportChange() {
            const vv = window.visualViewport;
            if (vv.height < window.innerHeight - 100) { chatInputArea.style.paddingBottom = `${keyboardPaddingBottom}px`; document.body.classList.add('keyboard-open'); }
            else { chatInputArea.style.paddingBottom = `calc(${initialPaddingBottom}px + env(safe-area-inset-bottom, 0px))`; document.body.classList.remove('keyboard-open'); }
        }
        window.visualViewport.addEventListener('resize', handleVisualViewportChange);
        window.visualViewport.addEventListener('scroll', handleVisualViewportChange);
    }
    const chatTextarea = document.querySelector('.input-wrapper textarea');
    if (chatTextarea) {
        chatTextarea.addEventListener('blur', () => {
            setTimeout(() => { if (!window.visualViewport || window.visualViewport.height >= window.innerHeight - 100) document.body.classList.remove('keyboard-open'); }, 100);
        });
        chatTextarea.addEventListener('focus', () => {
            if (window.innerWidth <= 768) document.body.classList.add('keyboard-open');
            const msgList = document.querySelector('.message-list');
            if (msgList) setTimeout(() => iosSmoothScrollToBottom(msgList), 300);
        });
    }
    lastWindowWidth = -1; handleResize();

    const tempSlider = document.getElementById('temp-slider');
    const tempValue = document.getElementById('temp-value');
    if (tempSlider && tempValue) { tempSlider.addEventListener('input', (e) => { tempValue.textContent = parseFloat(e.target.value).toFixed(1); }); }

    // 3. 角色管理与聊天记录管理
    const messageList = document.querySelector('.message-list');
    const chatListContainer = document.getElementById('chat-list-container');
    let chatSessions = JSON.parse(localStorage.getItem('chatSessions') || '{}');
    let worldbooks = JSON.parse(localStorage.getItem('worldbooks') || '{}');
    let currentChatId = 'Alice';

    // ====== 预设管理 (Completion Presets) ======
    let presets = JSON.parse(localStorage.getItem('completion_presets') || '[]');
    if (presets.length === 0) {
        presets.push({
            id: 'default',
            name: 'Default Claude',
            system_prompt: 'You are a helpful assistant.',
            context_template: '',
            reasoning_template: '',
            temperature: 0.8,
            top_p: 1.0,
            top_k: 0,
            repetition_penalty: 1.0
        });
        localStorage.setItem('completion_presets', JSON.stringify(presets));
    }
    let currentPresetId = localStorage.getItem('current_preset_id') || presets[0].id;

    // ====== 正则管理 (Regex Scripts) ======
    let regexScripts = JSON.parse(localStorage.getItem('regex_scripts') || '[]');
    let currentQuoteText = '';
    let chatHistory = [];

    const defaultCharacters = [
        { id: 'Alice', name: 'Alice', avatarColor: '#d4a373', avatarText: 'A', preview: '你好，今天过得怎么样？', desc: '你是一个乐于助人的AI助手，名字叫Alice。你的性格开朗、幽默，喜欢用轻松的语气交流。', greeting: '你好，今天过得怎么样？' },
        { id: 'Bob', name: 'Bob', avatarColor: '#5784d9', avatarText: 'B', preview: '那个项目进展如何了？', desc: '你是一个严谨的程序员，名字叫Bob。你说话简明扼要，直击要害。', greeting: '那个项目进展如何了？' },
        { id: 'Claude', name: 'Claude', avatarColor: '#57d98d', avatarText: 'C', preview: '我已经准备好协助你了。', desc: '你是Claude，一个由Anthropic训练的AI助手。你非常聪明、客观且乐于助人。', greeting: '我已经准备好协助你了。' }
    ];

    // 数据清洗与兼容 & 分支迁移
    function saveWorldbooksToLocal() {
        localStorage.setItem('worldbooks', JSON.stringify(worldbooks));
    }

    let needsSave = false;
    Object.keys(chatSessions).forEach(id => {
        const session = chatSessions[id];
        // 分支迁移：如果旧数据没有 branches，自动迁移
        ensureBranches(session);
        if (!session.settings) {
            const defaultChar = defaultCharacters.find(c => c.id === id);
            const name = defaultChar ? defaultChar.name : id;
            session.settings = {
                name: name, desc: defaultChar ? defaultChar.desc : `你是一个名为 ${name} 的角色。`,
                greeting: defaultChar ? defaultChar.greeting : `你好，我是 ${name}。`,
                avatarColor: defaultChar ? defaultChar.avatarColor : '#8b5cf6',
                avatarText: name.charAt(0).toUpperCase(), temperature: 0.8, altGreetings: [], isFavorite: false
            };
            needsSave = true;
        } else {
            if (!session.settings.avatarColor) { session.settings.avatarColor = '#8b5cf6'; needsSave = true; }
            if (!session.settings.avatarText) { session.settings.avatarText = (session.settings.name || id).charAt(0).toUpperCase(); needsSave = true; }
            if (session.settings.temperature === undefined) { session.settings.temperature = 0.8; needsSave = true; }
            if (!session.settings.altGreetings) { session.settings.altGreetings = []; needsSave = true; }
            if (session.settings.isFavorite === undefined) { session.settings.isFavorite = false; needsSave = true; }
            if (session.settings.worldbook === undefined) { session.settings.worldbook = ''; needsSave = true; }
        }
    });

    if (Object.keys(chatSessions).length === 0) {
        defaultCharacters.forEach(char => {
            chatSessions[char.id] = {
                settings: {
                    name: char.name, desc: char.desc, greeting: char.greeting,
                    avatarColor: char.avatarColor, avatarText: char.avatarText,
                    temperature: 0.8, altGreetings: [], isFavorite: false
                },
                branches: { "默认分支": { history: [], html: char.id === 'Alice' ? messageList.innerHTML : '' } },
                activeBranch: "默认分支"
            };
        });
        needsSave = true;
    }
    if (needsSave) saveChatSessionsToLocal();

    function saveCurrentSession() {
        if (!chatSessions[currentChatId]) chatSessions[currentChatId] = { settings: {}, branches: {}, activeBranch: "默认分支" };
        ensureBranches(chatSessions[currentChatId]);
        chatSessions[currentChatId].branches[chatSessions[currentChatId].activeBranch].history = chatHistory;
        saveChatSessionsToLocal();
        if (db) {
            const tx = db.transaction(['chatHTMLs'], 'readwrite');
            tx.objectStore('chatHTMLs').put({ id: `${currentChatId}_${chatSessions[currentChatId].activeBranch}`, html: messageList.innerHTML });
        }
    }

    // ============ 分支切换下拉菜单渲染 ============
    function renderBranchDropdown() {
        const dropdown = document.getElementById('branch-dropdown');
        const btn = document.getElementById('branch-switch-btn');
        if (!dropdown || !btn) return;
        const session = chatSessions[currentChatId];
        if (!session) return;
        ensureBranches(session);
        const branchNames = Object.keys(session.branches);
        const currentBranch = session.activeBranch;

        // 只有一个分支时隐藏按钮
        if (branchNames.length <= 1) {
            btn.style.display = 'none';
            dropdown.style.display = 'none';
            return;
        }
        btn.style.display = '';

        dropdown.innerHTML = '';
        branchNames.forEach(name => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: pointer; border-radius: 6px; transition: background 0.15s;';
            if (name === currentBranch) item.style.background = 'var(--bg-hover)';
            item.innerHTML = `
                <span style="flex: 1; font-size: 14px; ${name === currentBranch ? 'font-weight: 600;' : ''}">${name}${name === currentBranch ? ' ✓' : ''}</span>
            `;
            // 删除按钮（至少保留一个分支）
            if (branchNames.length > 1) {
                const delBtn = document.createElement('button');
                delBtn.style.cssText = 'background: none; border: none; cursor: pointer; padding: 2px 6px; color: var(--text-tertiary); border-radius: 4px;';
                delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                delBtn.title = `删除分支"${name}"`;
                delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteBranch(name); });
                item.appendChild(delBtn);
            }
            item.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                switchBranch(name);
                dropdown.style.display = 'none';
            });
            // hover效果
            item.addEventListener('mouseenter', () => { if (name !== currentBranch) item.style.background = 'var(--bg-tertiary)'; });
            item.addEventListener('mouseleave', () => { if (name !== currentBranch) item.style.background = ''; });
            dropdown.appendChild(item);
        });
    }

    async function switchBranch(branchName) {
        const session = chatSessions[currentChatId];
        if (!session) return;
        ensureBranches(session);
        if (!session.branches[branchName]) return;
        // 保存当前分支
        session.branches[session.activeBranch].history = chatHistory;
        if (db) {
            const tx = db.transaction(['chatHTMLs'], 'readwrite');
            tx.objectStore('chatHTMLs').put({ id: `${currentChatId}_${session.activeBranch}`, html: messageList.innerHTML });
        }
        // 切换
        session.activeBranch = branchName;
        // 加载新分支
        const branchData = session.branches[branchName];
        chatHistory = branchData.history || [];
        
        let branchHtml = '';
        if (db) {
            branchHtml = await new Promise(resolve => {
                const tx = db.transaction(['chatHTMLs'], 'readonly');
                const req = tx.objectStore('chatHTMLs').get(`${currentChatId}_${branchName}`);
                req.onsuccess = () => resolve(req.result ? req.result.html : '');
                req.onerror = () => resolve('');
            });
        }

        if (branchHtml) { messageList.innerHTML = branchHtml; }
        else if (chatHistory.length > 0) {
            renderHistoryToDOM(chatHistory);
            if (db) {
                const tx = db.transaction(['chatHTMLs'], 'readwrite');
                tx.objectStore('chatHTMLs').put({ id: `${currentChatId}_${branchName}`, html: messageList.innerHTML });
            }
        }
        else {
            messageList.innerHTML = '';
            if (session.settings.greeting) {
                const timeString = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                messageList.innerHTML = `<div class="message received"><div class="avatar" style="background-color: ${session.settings.avatarColor || '#10a37f'};">${session.settings.avatarText || 'A'}</div><div class="message-content"><div class="message-author">${session.settings.name || currentChatId} <span class="message-time">${timeString}</span></div><div class="message-bubble" data-raw-content="${encodeURIComponent(session.settings.greeting)}">${session.settings.greeting.replace(/\n/g, '<br>')}</div></div></div>`;
                chatHistory = [{ role: 'assistant', content: session.settings.greeting }];
            }
        }
        saveCurrentSession();
        renderBranchDropdown();
        setTimeout(() => {
            messageList.scrollTop = messageList.scrollHeight;
        }, 50);
        showToast(`已切换到分支: ${branchName}`);
    }

    async function deleteBranch(branchName) {
        const session = chatSessions[currentChatId];
        if (!session) return;
        ensureBranches(session);
        const branchNames = Object.keys(session.branches);
        if (branchNames.length <= 1) { showToast('至少保留一个分支'); return; }
        // 如果删除的是当前分支，先切换到另一个
        if (session.activeBranch === branchName) {
            const other = branchNames.find(n => n !== branchName);
            session.activeBranch = other;
            chatHistory = session.branches[other].history || [];
            
            let otherHtml = '';
            if (db) {
                otherHtml = await new Promise(resolve => {
                    const tx = db.transaction(['chatHTMLs'], 'readonly');
                    const req = tx.objectStore('chatHTMLs').get(`${currentChatId}_${other}`);
                    req.onsuccess = () => resolve(req.result ? req.result.html : '');
                    req.onerror = () => resolve('');
                });
            }

            if (otherHtml) {
                messageList.innerHTML = otherHtml;
            } else if (chatHistory.length > 0) {
                renderHistoryToDOM(chatHistory);
                if (db) {
                    const tx = db.transaction(['chatHTMLs'], 'readwrite');
                    tx.objectStore('chatHTMLs').put({ id: `${currentChatId}_${other}`, html: messageList.innerHTML });
                }
            } else {
                messageList.innerHTML = '';
            }
        }
        delete session.branches[branchName];
        if (db) {
            const tx = db.transaction(['chatHTMLs'], 'readwrite');
            tx.objectStore('chatHTMLs').delete(`${currentChatId}_${branchName}`);
        }
        saveCurrentSession();
        renderBranchDropdown();
        showToast(`已删除分支: ${branchName}`);
    }

    // 通用：从 history 重新渲染 messageList HTML
    function renderHistoryToDOM(historyData) {
        messageList.innerHTML = '';
        if (!historyData || historyData.length === 0) return;
        const session = chatSessions[currentChatId];
        const settings = session?.settings || {};
        const avatarColor = settings.avatarColor || '#10a37f';
        const avatarText = settings.avatarText || (settings.name ? settings.name.charAt(0).toUpperCase() : 'A');
        const name = settings.name || currentChatId;
        const avatarHTML = settings.avatarImage
            ? `<div class="avatar" style="background-image:url(${settings.avatarImage});background-size:cover;background-position:center;"></div>`
            : `<div class="avatar" style="background-color:${avatarColor};">${avatarText}</div>`;

        historyData.forEach(msg => {
            if (msg.role === 'system') return;
            const timeString = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            let displayHTML = msg.content.replace(/\n/g, '<br>');
            if (typeof marked !== 'undefined') displayHTML = marked.parse(msg.content);
            if (msg.role === 'user') {
                messageList.insertAdjacentHTML('beforeend',
                    `<div class="message sent"><div class="avatar" style="background-color:#8b5cf6;">U</div><div class="message-content"><div class="message-author">You <span class="message-time">${timeString}</span></div><div class="message-bubble" data-raw-content="${encodeURIComponent(msg.content)}">${displayHTML}</div></div></div>`);
            } else {
                const ddMenuHTML = `<div class="message-dropdown-menu">
                    <button class="dropdown-item regen-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>重新生成</button>
                    <button class="dropdown-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>编辑</button>
                    <button class="dropdown-item fork-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>从此处分叉</button>
                    <button class="dropdown-item delete-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>删除</button>
                </div>`;
                messageList.insertAdjacentHTML('beforeend',
                    `<div class="message received">${avatarHTML}<div class="message-content"><div class="message-author">${name} <span class="message-time">${timeString}</span></div><div class="message-more-container"><button class="message-more-btn" title="更多选项"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg></button>${ddMenuHTML}</div><div class="message-bubble" data-raw-content="${encodeURIComponent(msg.content)}">${displayHTML}</div><div class="message-actions"><button class="action-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button><button class="action-btn" title="播放"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"></path></svg></button><button class="action-btn" title="赞同"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg></button><button class="action-btn" title="反对"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg></button></div></div></div>`);
            }
        });
    }

    function forkBranchFromMessage(messageEl, newBranchName) {
        const session = chatSessions[currentChatId];
        if (!session) { showToast('会话不存在'); return; }
        ensureBranches(session);
        if (session.branches[newBranchName]) { showToast('分支名已存在，请换一个'); return; }

        // 1. 保存当前分支的完整状态，确保原分支不受影响
        session.branches[session.activeBranch].history = chatHistory;
        if (db) {
            const tx = db.transaction(['chatHTMLs'], 'readwrite');
            tx.objectStore('chatHTMLs').put({ id: `${currentChatId}_${session.activeBranch}`, html: messageList.innerHTML });
        }

        // 2. 获取当前消息在 chatHistory 中的位置索引
        // chatHistory[0] 是 system prompt，DOM 消息从 chatHistory[1] 开始
        const allMessages = Array.from(messageList.querySelectorAll('.message'));
        const msgDomIndex = allMessages.indexOf(messageEl);
        if (msgDomIndex === -1) { showToast('无法定位消息'); return; }
        const chatHistoryIndex = msgDomIndex + 1; // +1 跳过 system prompt

        // 3. 从对话开头截取到当前消息为止（含），作为新分支的 history
        const newHistory = chatHistory.slice(0, chatHistoryIndex + 1);

        // 4. 截取当前 messageList 中对应部分的 HTML，作为新分支的 html
        // 临时移除当前消息之后的所有消息，获取截断后的 HTML
        for (let i = allMessages.length - 1; i > msgDomIndex; i--) {
            allMessages[i].remove();
        }
        const truncatedHtml = messageList.innerHTML;

        // 5. 将新分支存入 branches[新分支名]
        session.branches[newBranchName] = { history: newHistory };
        if (db) {
            const tx = db.transaction(['chatHTMLs'], 'readwrite');
            tx.objectStore('chatHTMLs').put({ id: `${currentChatId}_${newBranchName}`, html: truncatedHtml });
        }

        // 6. 自动切换：把 activeBranch 设成新分支名
        session.activeBranch = newBranchName;
        chatHistory = newHistory;
        saveCurrentSession();

        // 7. 调用 loadSession 刷新界面
        loadSession(currentChatId);
        showToast(`已创建分支: ${newBranchName}`);
    }

    // 分支切换按钮点击
    const branchSwitchBtn = document.getElementById('branch-switch-btn');
    const branchDropdown = document.getElementById('branch-dropdown');
    if (branchSwitchBtn && branchDropdown) {
        branchSwitchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            renderBranchDropdown();
            branchDropdown.style.display = branchDropdown.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#branch-switcher')) branchDropdown.style.display = 'none';
        });
    }

    function renderChatList() {
        if (!chatListContainer) return;
        chatListContainer.innerHTML = '';
        Object.keys(chatSessions).forEach(id => {
            const session = chatSessions[id];
            const settings = session.settings || {};
            const name = settings.name || id;
            const avatarColor = settings.avatarColor || '#8b5cf6';
            const avatarText = settings.avatarText || name.charAt(0).toUpperCase();
            const avatarImage = settings.avatarImage;
            ensureBranches(session);
            const curHistory = getCurrentHistory(session);
            let preview = settings.greeting || '新对话';
            if (curHistory.length > 0) {
                const lastMsg = curHistory[curHistory.length - 1];
                preview = lastMsg.content;
                if (typeof preview === 'string' && preview.length > 15) preview = preview.substring(0, 15) + '...';
            }
            const item = document.createElement('div');
            item.className = `chat-item ${id === currentChatId ? 'active' : ''}`;
            item.dataset.id = id;
            let avatarHTML = avatarImage
                ? `<div class="avatar" style="background-image: url(${avatarImage}); background-size: cover; background-position: center;"></div>`
                : `<div class="avatar" style="background-color: ${avatarColor};">${avatarText}</div>`;
            item.innerHTML = `${avatarHTML}<div class="chat-info"><div class="chat-name">${name}</div><div class="chat-preview">${preview}</div></div><button class="chat-item-more-btn" title="更多选项"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg></button>`;
            item.addEventListener('click', (e) => {
                if (window.isListLongPressTriggered) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                saveCurrentSession(); loadSession(id); renderChatList();
            });
            chatListContainer.appendChild(item);
        });
        const items = Array.from(chatListContainer.children);
        items.sort((a, b) => {
            const pinA = chatSessions[a.dataset.id].settings.pinnedAt || 0;
            const pinB = chatSessions[b.dataset.id].settings.pinnedAt || 0;
            if (pinA && pinB) return pinB - pinA;
            else if (pinA) return -1; else if (pinB) return 1; return 0;
        });
        chatListContainer.innerHTML = '';
        let hasPinned = false, hasUnpinned = false;
        items.forEach(item => {
            const id = item.dataset.id;
            const isPinned = chatSessions[id].settings.pinnedAt > 0;
            if (isPinned) hasPinned = true;
            else if (hasPinned && !hasUnpinned) {
                const divider = document.createElement('div');
                divider.style.cssText = 'height:1px;background-color:var(--border-color);margin:4px 12px;';
                chatListContainer.appendChild(divider); hasUnpinned = true;
            }
            chatListContainer.appendChild(item);
        });
    }

    async function loadSession(chatId) {
        currentChatId = chatId;
        const session = chatSessions[chatId];
        if (!session) return;
        ensureBranches(session);
        chatHistory = getCurrentHistory(session);
        const settings = session.settings || {};
        const headerInfo = document.querySelector('.current-chat-info');
        if (headerInfo) { const h2 = headerInfo.querySelector('h2'); if (h2) h2.textContent = settings.name || chatId; }
        const textarea = document.querySelector('.input-wrapper textarea');
        if (textarea) textarea.placeholder = `Reply to ${settings.name || chatId}...`;
        const nameInput = document.getElementById('char-name-input');
        const descInput = document.getElementById('char-desc-input');
        const greetingInput = document.getElementById('char-greeting-input');
        const charTempSlider = document.getElementById('char-temp-slider');
        const charTempValue = document.getElementById('char-temp-value');
        const charWorldbookSelect = document.getElementById('char-worldbook-select');
        const favoriteBtn = document.getElementById('favorite-char-btn');
        if (nameInput) nameInput.value = settings.name || chatId;
        if (descInput) descInput.value = settings.desc || '';
        if (greetingInput) greetingInput.value = settings.greeting || '';
        if (charTempSlider && charTempValue) { charTempSlider.value = settings.temperature !== undefined ? settings.temperature : 0.8; charTempValue.textContent = parseFloat(charTempSlider.value).toFixed(1); }
        if (charWorldbookSelect) {
            charWorldbookSelect.innerHTML = '<option value="">不使用世界书</option>';
            Object.keys(worldbooks).forEach(wbName => {
                const opt = document.createElement('option');
                opt.value = wbName;
                opt.textContent = wbName;
                charWorldbookSelect.appendChild(opt);
            });
            charWorldbookSelect.value = settings.worldbook || '';
        }
        const tokenCountEl = document.querySelector('.token-count');
        function updateTokenCount() {
            if (!tokenCountEl) return;
            const desc = (descInput ? descInput.value : (settings.desc || '')) || '';
            const greeting = (greetingInput ? greetingInput.value : (settings.greeting || '')) || '';
            const text = desc + '\n' + greeting;
            if (!text) { tokenCountEl.textContent = '0 Tokens'; return; }
            let tokens = 0;
            for (let i = 0; i < text.length; i++) {
                const charCode = text.charCodeAt(i);
                if (charCode >= 0x4e00 && charCode <= 0x9fa5) {
                    tokens += 1.5;
                } else {
                    tokens += 0.3; // 简单将英文按字符估算，大约3-4个字符一个单词(1.3 token)
                }
            }
            tokenCountEl.textContent = `${Math.ceil(tokens)} Tokens`;
        }
        updateTokenCount();
        if (descInput) descInput.addEventListener('input', updateTokenCount);
        if (greetingInput) greetingInput.addEventListener('input', updateTokenCount);

        const charAvatarLarge = document.querySelector('.character-avatar-large');
        if (charAvatarLarge) {
            if (settings.avatarImage) { charAvatarLarge.innerHTML = ''; charAvatarLarge.style.backgroundImage = `url(${settings.avatarImage})`; charAvatarLarge.style.backgroundSize = 'cover'; charAvatarLarge.style.backgroundPosition = 'center'; charAvatarLarge.style.border = 'none'; }
            else { charAvatarLarge.style.backgroundImage = ''; charAvatarLarge.style.border = '1px dashed var(--border-color)'; charAvatarLarge.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'; }
        }
        if (favoriteBtn) {
            if (settings.isFavorite) { favoriteBtn.style.color = '#f59e0b'; favoriteBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'; }
            else { favoriteBtn.style.color = ''; favoriteBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'; }
        }
        
        let curHtml = '';
        if (db) {
            curHtml = await new Promise(resolve => {
                const tx = db.transaction(['chatHTMLs'], 'readonly');
                const req = tx.objectStore('chatHTMLs').get(`${chatId}_${session.activeBranch}`);
                req.onsuccess = () => resolve(req.result ? req.result.html : '');
                req.onerror = () => resolve('');
            });
        }

        if (curHtml) { messageList.innerHTML = curHtml; }
        else if (chatHistory.length > 0) {
            renderHistoryToDOM(chatHistory);
            if (db) {
                const tx = db.transaction(['chatHTMLs'], 'readwrite');
                tx.objectStore('chatHTMLs').put({ id: `${chatId}_${session.activeBranch}`, html: messageList.innerHTML });
            }
        }
        else {
            messageList.innerHTML = '';
            if (settings.greeting && chatHistory.length === 0) {
                const timeString = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const avatarColor = settings.avatarColor || '#10a37f';
                const avatarText = settings.avatarText || (settings.name ? settings.name.charAt(0).toUpperCase() : 'A');
                const name = settings.name || chatId;
                let avatarHTML = settings.avatarImage ? `<div class="avatar" style="background-image: url(${settings.avatarImage}); background-size: cover; background-position: center;"></div>` : `<div class="avatar" style="background-color: ${avatarColor};">${avatarText}</div>`;
                messageList.innerHTML = `<div class="message received">${avatarHTML}<div class="message-content"><div class="message-author">${name} <span class="message-time">${timeString}</span></div><div class="message-bubble" data-raw-content="${encodeURIComponent(settings.greeting)}">${settings.greeting.replace(/\n/g, '<br>')}</div></div></div>`;
                chatHistory = [{ role: 'assistant', content: settings.greeting }];
                saveCurrentSession();
            }
        }
        renderBranchDropdown();
        setTimeout(() => {
            messageList.scrollTop = messageList.scrollHeight;
        }, 50);
    }

    renderChatList(); loadSession(currentChatId);

    // 保存角色设定按钮
    const saveCharSettingsBtn = document.getElementById('save-char-settings-btn');
    if (saveCharSettingsBtn) {
        saveCharSettingsBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('char-name-input');
            const descInput = document.getElementById('char-desc-input');
            const greetingInput = document.getElementById('char-greeting-input');
            const tempSlider = document.getElementById('char-temp-slider');
            if (chatSessions[currentChatId]) {
                if (!chatSessions[currentChatId].settings) chatSessions[currentChatId].settings = {};
                const newName = nameInput.value.trim();
                chatSessions[currentChatId].settings.name = newName;
                chatSessions[currentChatId].settings.desc = descInput.value.trim();
                chatSessions[currentChatId].settings.greeting = greetingInput.value.trim();
                chatSessions[currentChatId].settings.avatarText = newName.charAt(0).toUpperCase();
                if (tempSlider) chatSessions[currentChatId].settings.temperature = parseFloat(tempSlider.value);
                const charWorldbookSelect = document.getElementById('char-worldbook-select');
                if (charWorldbookSelect) chatSessions[currentChatId].settings.worldbook = charWorldbookSelect.value;
                saveCurrentSession(); renderChatList();
                const headerInfo = document.querySelector('.current-chat-info h2');
                if (headerInfo) headerInfo.textContent = newName;
                const receivedMessages = document.querySelectorAll('.message.received');
                receivedMessages.forEach(msg => {
                    const authorEl = msg.querySelector('.message-author');
                    if (authorEl) { const timeSpan = authorEl.querySelector('.message-time'); authorEl.innerHTML = `${newName} `; if (timeSpan) authorEl.appendChild(timeSpan); }
                    const avatarEl = msg.querySelector('.avatar');
                    if (avatarEl && !avatarEl.style.backgroundImage && avatarEl.textContent !== '') avatarEl.textContent = newName.charAt(0).toUpperCase();
                });
                if (chatHistory.length > 0 && chatHistory[0].role === 'system') { chatHistory[0].content = buildSystemPrompt(); saveCurrentSession(); }
                showToast('角色设定已保存');
            }
        });
    }

    const exportCharBtn = document.getElementById('export-char-btn');
    const favoriteCharBtn = document.getElementById('favorite-char-btn');
    const importChatInput = document.getElementById('import-chat-input');
    const importChatConfirmModal = document.getElementById('import-chat-confirm-modal');
    const confirmImportChatBtn = document.getElementById('confirm-import-chat-btn');
    let pendingImportData = null;
    const importChatJsonlInput = document.getElementById('import-chat-jsonl-input');
    const importJsonlMismatchModal = document.getElementById('import-jsonl-mismatch-modal');
    const importJsonlMismatchText = document.getElementById('import-jsonl-mismatch-text');
    const confirmImportJsonlBtn = document.getElementById('confirm-import-jsonl-btn');
    let pendingJsonlImportData = null;
    const openWorldbookBtn = document.getElementById('open-worldbook-btn');
    const openAdvSettingsBtn = document.getElementById('open-adv-settings-btn');
    const charActionSelect = document.getElementById('char-action-select');
    const advSettingsHeader = document.getElementById('adv-settings-header');
    const advSettingsContent = document.getElementById('adv-settings-content');
    const charTempSlider = document.getElementById('char-temp-slider');
    const charTempValue = document.getElementById('char-temp-value');

    if (exportCharBtn) {
        exportCharBtn.addEventListener('click', () => {
            const session = chatSessions[currentChatId]; if (!session) return;
            const exportData = { name: session.settings.name, description: session.settings.desc, first_mes: session.settings.greeting, avatar_color: session.settings.avatarColor, temperature: session.settings.temperature, alternate_greetings: session.settings.altGreetings || [] };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
            const a = document.createElement('a'); a.setAttribute("href", dataStr); a.setAttribute("download", `${session.settings.name || 'character'}.json`); document.body.appendChild(a); a.click(); a.remove();
            showToast('角色已导出');
        });
    }

    if (favoriteCharBtn) {
        favoriteCharBtn.addEventListener('click', () => {
            const session = chatSessions[currentChatId]; if (!session) return;
            session.settings.isFavorite = !session.settings.isFavorite; saveCurrentSession();
            if (session.settings.isFavorite) { favoriteCharBtn.style.color = '#f59e0b'; favoriteCharBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'; showToast('已收藏'); }
            else { favoriteCharBtn.style.color = ''; favoriteCharBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'; showToast('已取消收藏'); }
        });
    }

    if (openWorldbookBtn) {
        openWorldbookBtn.addEventListener('click', () => {
            const gsModal = document.getElementById('global-settings-modal');
            if (gsModal) { gsModal.classList.add('active'); const tbs = document.querySelectorAll('.tab-btn'); const tps = document.querySelectorAll('.tab-pane'); tbs.forEach(b => b.classList.remove('active')); tps.forEach(p => p.classList.remove('active')); const wb = document.querySelector('.tab-btn[data-tab="tab-worldbook"]'); const wp = document.getElementById('tab-worldbook'); if (wb) wb.classList.add('active'); if (wp) wp.classList.add('active'); }
        });
    }

    if (openAdvSettingsBtn && advSettingsHeader && advSettingsContent) {
        openAdvSettingsBtn.addEventListener('click', () => { advSettingsContent.style.display = advSettingsContent.style.display === 'none' ? 'block' : 'none'; advSettingsHeader.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
        advSettingsHeader.addEventListener('click', () => { advSettingsContent.style.display = advSettingsContent.style.display === 'none' ? 'block' : 'none'; });
    }

    if (charTempSlider && charTempValue) { charTempSlider.addEventListener('input', (e) => { charTempValue.textContent = parseFloat(e.target.value).toFixed(1); }); }

    const deleteCharConfirmModal = document.getElementById('delete-char-confirm-modal');
    const confirmDeleteCharBtn = document.getElementById('confirm-delete-char-btn');
    const deleteCharNameSpan = document.getElementById('delete-char-name-span');

    if (charActionSelect) {
        charActionSelect.addEventListener('change', async (e) => {
            const action = e.target.value; e.target.value = "";
            const session = chatSessions[currentChatId];
            if (action === 'export_chat') {
                if (!session) return;
                const curHistory = getCurrentHistory(session);
                let curHtml = '';
                if (db) {
                    try {
                        curHtml = await new Promise(resolve => {
                            const tx = db.transaction(['chatHTMLs'], 'readonly');
                            const req = tx.objectStore('chatHTMLs').get(`${currentChatId}_${session.activeBranch}`);
                            req.onsuccess = () => resolve(req.result ? req.result.html : '');
                            req.onerror = () => resolve('');
                        });
                    } catch(err) {}
                }
                if (!curHistory || curHistory.length === 0) { showToast('当前没有聊天记录可导出'); return; }
                const exportData = { characterId: currentChatId, characterName: session.settings.name, exportTime: new Date().toISOString(), history: curHistory, html: curHtml };
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
                const a = document.createElement('a'); a.setAttribute("href", dataStr); a.setAttribute("download", `${session.settings.name || 'chat'}_history.json`); document.body.appendChild(a); a.click(); a.remove();
                showToast('聊天记录已导出(当前分支)');
            } else if (action === 'export_chat_jsonl') {
                if (!session) return;
                const curHistory = getCurrentHistory(session);
                if (!curHistory || curHistory.length === 0) { showToast('当前没有聊天记录可导出'); return; }
                const userName = document.querySelector('.user-name')?.textContent || 'User';
                const charName = session.settings.name || currentChatId;
                let jsonlContent = JSON.stringify({ chat_metadata: { main_chat: true, integrity: true }, user_name: userName, character_name: charName }) + '\n';
                curHistory.forEach(msg => { if (msg.role === 'system') return; jsonlContent += JSON.stringify({ name: msg.role === 'user' ? userName : charName, is_user: msg.role === 'user', send_date: Date.now(), mes: msg.content }) + '\n'; });
                const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.setAttribute("href", url); const now = new Date(); a.setAttribute("download", `酒馆_${charName}_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}.jsonl`);
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                showToast('已导出为 SillyTavern (.jsonl) (当前分支)');
            } else if (action === 'import_chat') { if (importChatInput) importChatInput.click(); }
            else if (action === 'import_chat_jsonl') { if (importChatJsonlInput) importChatJsonlInput.click(); }
            else if (action === 'copy') {
                if (!session) return;
                const newId = 'char_' + Date.now();
                const newName = (session.settings.name || 'Character') + ' (Copy)';
                chatSessions[newId] = { settings: { ...JSON.parse(JSON.stringify(session.settings)), name: newName }, branches: { "默认分支": { history: [], html: '' } }, activeBranch: "默认分支" };
                saveCurrentSession(); currentChatId = newId; renderChatList(); loadSession(newId);
                showToast('角色已复制');
            } else if (action === 'delete') {
                if (Object.keys(chatSessions).length <= 1) { showToast('至少需要保留一个角色'); return; }
                if (deleteCharConfirmModal) { if (deleteCharNameSpan) deleteCharNameSpan.textContent = chatSessions[currentChatId].settings.name || currentChatId; deleteCharConfirmModal.classList.add('active'); }
            }
        });
    }

    function deleteCharacter(chatId) {
        if (Object.keys(chatSessions).length <= 1) { showToast('至少需要保留一个角色'); return; }
        if (db) { 
            const tx = db.transaction(['documents', 'chatHTMLs'], 'readwrite'); 
            const store = tx.objectStore('documents'); 
            const idx = store.index('characterId'); 
            const req = idx.getAll(chatId); 
            req.onsuccess = () => { req.result.forEach(c => store.delete(c.id)); }; 
            
            const htmlStore = tx.objectStore('chatHTMLs');
            const session = chatSessions[chatId];
            if (session && session.branches) {
                Object.keys(session.branches).forEach(branchName => {
                    htmlStore.delete(`${chatId}_${branchName}`);
                });
            }
        }
        delete chatSessions[chatId]; saveChatSessionsToLocal();
        if (currentChatId === chatId) { currentChatId = Object.keys(chatSessions)[0]; loadSession(currentChatId); }
        renderChatList(); showToast('角色已删除');
    }

    if (confirmDeleteCharBtn && deleteCharConfirmModal) {
        confirmDeleteCharBtn.addEventListener('click', () => { const tid = deleteCharConfirmModal.dataset.targetId || currentChatId; deleteCharacter(tid); deleteCharConfirmModal.classList.remove('active'); deleteCharConfirmModal.dataset.targetId = ''; });
    }

    const chatItemMenu = document.getElementById('chat-item-menu');
    let currentTargetChatItemId = null;
    function hideChatItemMenu() { if (chatItemMenu) { chatItemMenu.classList.remove('active'); chatItemMenu.style.display = 'none'; } currentTargetChatItemId = null; }
    function showChatItemMenu(x, y, chatId) {
        if (!chatItemMenu) return; currentTargetChatItemId = chatId;
        const pinBtn = document.getElementById('cim-pin'); if (pinBtn) { const isP = chatSessions[chatId].settings.pinnedAt > 0; pinBtn.textContent = isP ? '取消置顶' : '置顶'; }
        
        const menuWidth = 160; 
        const menuHeight = 120; 
        
        // 围绕真实的物理点击坐标 (x, y) 来定位
        // 让其恰好显示在点击位置的正下方偏左
        let posX = x - menuWidth + 24; 
        if (posX < 12) posX = 12; // 防止超出左侧屏幕
        if (posX + menuWidth > window.innerWidth - 12) posX = window.innerWidth - menuWidth - 12; // 防止超出右侧
        
        let posY = y + 12; 
        
        // 边界检测：如果下方高度不够
        if (posY + menuHeight > window.innerHeight - 12) {
            // 则尝试显示在按钮上方
            posY = y - menuHeight - 12;
            
            // 极端情况下的最终保底
            if (posY < 12) {
                posY = window.innerHeight - menuHeight - 12;
                if (posY < 12) posY = 12;
            }
        }
        
        chatItemMenu.style.left = `${posX}px`; 
        chatItemMenu.style.top = `${posY}px`;
        
        chatItemMenu.style.display = 'flex'; 
        chatItemMenu.classList.add('active');
    }

    if (chatListContainer) {
        chatListContainer.addEventListener('scroll', hideChatItemMenu, { passive: true });
        chatListContainer.addEventListener('click', (e) => {
            const moreBtn = e.target.closest('.chat-item-more-btn');
            if (moreBtn) { 
                e.stopPropagation(); 
                const ci = moreBtn.closest('.chat-item'); 
                // 直接传递真实的鼠标物理点击坐标
                if (ci) showChatItemMenu(e.clientX, e.clientY, ci.dataset.id); 
            }
        });
        let listLongPressTimer = null;
        window.isListLongPressTriggered = false;
        chatListContainer.addEventListener('touchstart', (e) => {
            const ci = e.target.closest('.chat-item');
            if (ci && window.innerWidth <= 1024) {
                window.isListLongPressTriggered = false;
                // 保存触摸点的真实物理坐标
                const touchX = e.touches[0].clientX;
                const touchY = e.touches[0].clientY;
                listLongPressTimer = setTimeout(() => {
                    window.isListLongPressTriggered = true;
                    if (e.cancelable) e.preventDefault();
                    // 长按触发时传入真实物理坐标
                    showChatItemMenu(touchX, touchY, ci.dataset.id);
                    if (navigator.vibrate) navigator.vibrate(50);
                }, 500);
            }
        });
        chatListContainer.addEventListener('touchend', (e) => {
            if (listLongPressTimer) clearTimeout(listLongPressTimer);
            if (window.isListLongPressTriggered) {
                if (e.cancelable) e.preventDefault();
                setTimeout(() => { window.isListLongPressTriggered = false; }, 300);
            }
        });
        chatListContainer.addEventListener('touchmove', () => {
            if (listLongPressTimer) clearTimeout(listLongPressTimer);
            window.isListLongPressTriggered = false;
        });
    }

    document.addEventListener('click', (e) => { if (!e.target.closest('#chat-item-menu') && !e.target.closest('.chat-item-more-btn')) hideChatItemMenu(); });

    document.getElementById('cim-pin')?.addEventListener('click', () => {
        if (currentTargetChatItemId && chatSessions[currentTargetChatItemId]) {
            const s = chatSessions[currentTargetChatItemId];
            if (s.settings.pinnedAt > 0) { s.settings.pinnedAt = 0; showToast('已取消置顶'); } else { s.settings.pinnedAt = Date.now(); showToast('已置顶'); }
            saveCurrentSession(); renderChatList();
        } hideChatItemMenu();
    });
    document.getElementById('cim-clear')?.addEventListener('click', () => {
        if (currentTargetChatItemId && chatSessions[currentTargetChatItemId]) {
            const s = chatSessions[currentTargetChatItemId]; ensureBranches(s);
            s.branches[s.activeBranch].history = []; 
            if (db) {
                const tx = db.transaction(['chatHTMLs'], 'readwrite');
                tx.objectStore('chatHTMLs').delete(`${currentTargetChatItemId}_${s.activeBranch}`);
            }
            if (currentTargetChatItemId === currentChatId) loadSession(currentChatId);
            else saveChatSessionsToLocal();
            renderChatList(); showToast('已清空聊天记录(当前分支)');
        } hideChatItemMenu();
    });
    document.getElementById('cim-delete')?.addEventListener('click', () => {
        if (currentTargetChatItemId) {
            if (Object.keys(chatSessions).length <= 1) { showToast('至少需要保留一个角色'); hideChatItemMenu(); return; }
            if (deleteCharConfirmModal) { if (deleteCharNameSpan) deleteCharNameSpan.textContent = chatSessions[currentTargetChatItemId].settings.name || currentTargetChatItemId; deleteCharConfirmModal.dataset.targetId = currentTargetChatItemId; deleteCharConfirmModal.classList.add('active'); }
        } hideChatItemMenu();
    });

    // 导入聊天记录（导入到当前分支）
    if (importChatInput) {
        importChatInput.addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if ((!data.history || !Array.isArray(data.history)) && !data.html) throw new Error('无效格式');
                    pendingImportData = data;
                    if (importChatConfirmModal) importChatConfirmModal.classList.add('active');
                } catch (err) { console.error(err); showToast('导入失败：文件格式不正确'); }
            }; reader.readAsText(file); e.target.value = '';
        });
    }

    if (confirmImportChatBtn && importChatConfirmModal) {
        confirmImportChatBtn.addEventListener('click', () => {
            if (pendingImportData && chatSessions[currentChatId]) {
                ensureBranches(chatSessions[currentChatId]);
                const branchData = chatSessions[currentChatId].branches[chatSessions[currentChatId].activeBranch];
                if (pendingImportData.history && Array.isArray(pendingImportData.history)) { branchData.history = pendingImportData.history; chatHistory = pendingImportData.history; }
                else if (pendingImportData.html) { messageList.innerHTML = pendingImportData.html; chatHistory = rebuildChatHistoryFromDOM(); branchData.history = chatHistory; }
                
                let htmlToSave = '';
                if (pendingImportData.html && pendingImportData.history && Array.isArray(pendingImportData.history)) htmlToSave = pendingImportData.html;
                else if (!pendingImportData.html) htmlToSave = '';
                else htmlToSave = pendingImportData.html;

                if (db && htmlToSave !== undefined) {
                    const tx = db.transaction(['chatHTMLs'], 'readwrite');
                    if (htmlToSave) {
                        tx.objectStore('chatHTMLs').put({ id: `${currentChatId}_${chatSessions[currentChatId].activeBranch}`, html: htmlToSave });
                    } else {
                        tx.objectStore('chatHTMLs').delete(`${currentChatId}_${chatSessions[currentChatId].activeBranch}`);
                    }
                }
                saveCurrentSession(); loadSession(currentChatId);
                importChatConfirmModal.classList.remove('active'); showToast('聊天记录导入成功(当前分支)'); pendingImportData = null;
            }
        });
    }

    if (importChatJsonlInput) {
        importChatJsonlInput.addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const text = event.target.result; const lines = text.split('\n');
                    let charName = '', parsedHistory = [];
                    for (const line of lines) { if (!line.trim()) continue; try { const d = JSON.parse(line); if (d.chat_metadata) charName = d.character_name || ''; else if (d.mes !== undefined) parsedHistory.push({ role: d.is_user ? 'user' : 'assistant', content: d.mes }); } catch (err) { console.warn('解析行失败', err); } }
                    if (parsedHistory.length === 0) throw new Error('未找到有效记录');
                    pendingJsonlImportData = parsedHistory;
                    const curName = chatSessions[currentChatId]?.settings?.name || currentChatId;
                    if (charName && charName !== curName) { if (importJsonlMismatchText) importJsonlMismatchText.textContent = `此记录属于[${charName}]，当前角色是[${curName}]。是否继续导入？`; if (importJsonlMismatchModal) importJsonlMismatchModal.classList.add('active'); }
                    else executeJsonlImport();
                } catch (err) { console.error(err); showToast('导入失败：文件格式不正确'); }
            }; reader.readAsText(file); e.target.value = '';
        });
    }

    function executeJsonlImport() {
        if (pendingJsonlImportData && chatSessions[currentChatId]) {
            ensureBranches(chatSessions[currentChatId]);
            const branchData = chatSessions[currentChatId].branches[chatSessions[currentChatId].activeBranch];
            let sysPrompt = null;
            if (branchData.history.length > 0 && branchData.history[0].role === 'system') sysPrompt = branchData.history[0];
            let newHistory = sysPrompt ? [sysPrompt, ...pendingJsonlImportData] : [...pendingJsonlImportData];
            branchData.history = newHistory; 
            if (db) {
                const tx = db.transaction(['chatHTMLs'], 'readwrite');
                tx.objectStore('chatHTMLs').delete(`${currentChatId}_${chatSessions[currentChatId].activeBranch}`);
            }
            chatHistory = newHistory; saveCurrentSession(); loadSession(currentChatId);
            messageList.innerHTML = '';
            newHistory.forEach(msg => {
                if (msg.role === 'system') return;
                const timeString = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                let displayHTML = msg.content.replace(/\n/g, '<br>');
                if (typeof marked !== 'undefined') displayHTML = marked.parse(msg.content);
                if (msg.role === 'user') {
                    messageList.insertAdjacentHTML('beforeend', `<div class="message sent"><div class="avatar" style="background-color:#8b5cf6;">U</div><div class="message-content"><div class="message-author">You <span class="message-time">${timeString}</span></div><div class="message-bubble" data-raw-content="${encodeURIComponent(msg.content)}">${displayHTML}</div></div></div>`);
                } else {
                    const settings = chatSessions[currentChatId].settings || {};
                    const avatarColor = settings.avatarColor || '#10a37f';
                    const avatarText = settings.avatarText || 'A';
                    const name = settings.name || currentChatId;
                    const avatarHTML = settings.avatarImage ? `<div class="avatar" style="background-image:url(${settings.avatarImage});background-size:cover;background-position:center;"></div>` : `<div class="avatar" style="background-color:${avatarColor};">${avatarText}</div>`;
                    messageList.insertAdjacentHTML('beforeend', `<div class="message received">${avatarHTML}<div class="message-content"><div class="message-author">${name} <span class="message-time">${timeString}</span></div><div class="message-more-container"><button class="message-more-btn" title="更多选项"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg></button><div class="message-dropdown-menu"><button class="dropdown-item regen-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>重新生成</button><button class="dropdown-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>编辑</button><button class="dropdown-item fork-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>从此处分叉</button><button class="dropdown-item delete-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>删除</button></div></div><div class="message-bubble" data-raw-content="${encodeURIComponent(msg.content)}">${displayHTML}</div><div class="message-actions"><button class="action-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button><button class="action-btn" title="播放"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"></path></svg></button><button class="action-btn" title="赞同"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg></button><button class="action-btn" title="反对"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg></button></div></div></div>`);
                }
            });
            if (db) {
                const tx = db.transaction(['chatHTMLs'], 'readwrite');
                tx.objectStore('chatHTMLs').put({ id: `${currentChatId}_${chatSessions[currentChatId].activeBranch}`, html: messageList.innerHTML });
            }
            saveCurrentSession();
            setTimeout(() => { messageList.scrollTop = messageList.scrollHeight; }, 50);
            showToast('JSONL 聊天记录导入成功(当前分支)'); pendingJsonlImportData = null;
        }
    }

    if (confirmImportJsonlBtn && importJsonlMismatchModal) {
        confirmImportJsonlBtn.addEventListener('click', () => { importJsonlMismatchModal.classList.remove('active'); executeJsonlImport(); });
    }

    // ============ 备用开场白 ============
    const altGreetingsBtn = document.getElementById('alt-greetings-btn');
    const altGreetingsModal = document.getElementById('alt-greetings-modal');
    const altGreetingsList = document.getElementById('alt-greetings-list');
    const addAltGreetingBtn = document.getElementById('add-alt-greeting-btn');

    function renderAltGreetings() {
        if (!altGreetingsList) return; altGreetingsList.innerHTML = '';
        const session = chatSessions[currentChatId]; if (!session?.settings) return;
        const greetings = session.settings.altGreetings || [];
        if (greetings.length === 0) { altGreetingsList.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">暂无备用开场白</div>'; return; }
        greetings.forEach((g, i) => {
            const item = document.createElement('div');
            item.style.cssText = 'border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;';
            item.innerHTML = `<textarea class="text-input alt-greeting-textarea" rows="3" style="margin-bottom:8px;">${g}</textarea><div style="display:flex;justify-content:flex-end;gap:8px;"><button class="secondary-btn set-main-greeting-btn" data-index="${i}" style="padding:4px 8px;font-size:12px;">设为主开场白</button><button class="icon-btn delete-alt-greeting-btn" data-index="${i}" style="color:#dc2626;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div>`;
            item.querySelector('.alt-greeting-textarea').addEventListener('change', (e) => { session.settings.altGreetings[i] = e.target.value; saveCurrentSession(); });
            item.querySelector('.set-main-greeting-btn').addEventListener('click', () => {
                const mi = document.getElementById('char-greeting-input');
                if (mi) { const old = mi.value; mi.value = session.settings.altGreetings[i]; session.settings.greeting = mi.value; session.settings.altGreetings[i] = old; saveCurrentSession(); renderAltGreetings(); showToast('已更新主开场白'); }
            });
            item.querySelector('.delete-alt-greeting-btn').addEventListener('click', () => { session.settings.altGreetings.splice(i, 1); saveCurrentSession(); renderAltGreetings(); });
            altGreetingsList.appendChild(item);
        });
    }

    if (altGreetingsBtn && altGreetingsModal) { altGreetingsBtn.addEventListener('click', () => { renderAltGreetings(); altGreetingsModal.classList.add('active'); }); }
    if (addAltGreetingBtn) {
        addAltGreetingBtn.addEventListener('click', () => {
            const session = chatSessions[currentChatId]; if (!session) return;
            if (!session.settings.altGreetings) session.settings.altGreetings = [];
            session.settings.altGreetings.push("新的备用开场白..."); saveCurrentSession(); renderAltGreetings();
            if (altGreetingsList) altGreetingsList.scrollTop = altGreetingsList.scrollHeight;
        });
    }

    // ============ 新建角色 ============
    const createCharBtn = document.getElementById('create-character-btn');
    const createCharModal = document.getElementById('create-character-modal');
    const confirmCreateCharBtn = document.getElementById('confirm-create-char-btn');
    const newCharNameInput = document.getElementById('new-char-name');

    if (createCharBtn && createCharModal) { createCharBtn.addEventListener('click', () => { createCharModal.classList.add('active'); if (newCharNameInput) { newCharNameInput.value = ''; newCharNameInput.focus(); } }); }
    if (confirmCreateCharBtn && newCharNameInput) {
        confirmCreateCharBtn.addEventListener('click', () => {
            const newName = newCharNameInput.value.trim(); if (!newName) { showToast('请输入角色名称'); return; }
            const newId = 'char_' + Date.now();
            const colors = ['#d4a373','#5784d9','#57d98d','#e07a5f','#81b29a','#f2cc8f'];
            saveCurrentSession();
            chatSessions[newId] = { settings: { name: newName, desc: `你是一个名为 ${newName} 的角色。`, greeting: `你好，我是 ${newName}。`, avatarColor: colors[Math.floor(Math.random()*colors.length)], avatarText: newName.charAt(0).toUpperCase() }, branches: { "默认分支": { history: [], html: '' } }, activeBranch: "默认分支" };
            currentChatId = newId; saveCurrentSession(); createCharModal.classList.remove('active');
            renderChatList(); loadSession(newId);
            if (window.innerWidth > 1024) rightPanel.classList.remove('collapsed');
            showToast('角色创建成功');
        });
    }

    // 4. 文本框自动调整高度
    const textarea = document.querySelector('.input-wrapper textarea');
    textarea.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; });

    // 5. 滚动到底部按钮
    const scrollBottomBtn = document.querySelector('.scroll-bottom-btn');
    const handleScroll = () => {
        let isNearBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 100;
        if (!isNearBottom) scrollBottomBtn.classList.add('visible'); else scrollBottomBtn.classList.remove('visible');
    };
    messageList.addEventListener('scroll', handleScroll);
    const scrollToBottom = (e) => { if (e) { e.preventDefault(); e.stopPropagation(); } iosSmoothScrollToBottom(messageList); };
    scrollBottomBtn.addEventListener('click', scrollToBottom); scrollBottomBtn.addEventListener('pointerdown', scrollToBottom);

    // 6. 思维链
    const thinkingSheet = document.getElementById('thinking-sheet');
    const thinkingOverlay = document.getElementById('thinking-sheet-overlay');
    const closeThinkingBtn = document.getElementById('close-thinking-sheet');
    window.currentActiveThinkingId = null;
    function openThinkingSheet() { thinkingSheet.classList.add('active'); thinkingOverlay.classList.add('active'); }
    function closeThinkingSheet() { thinkingSheet.classList.remove('active'); thinkingOverlay.classList.remove('active'); window.currentActiveThinkingId = null; }
    document.addEventListener('click', (e) => {
        const tc = e.target.closest('.thinking-chain');
        if (tc) { window.currentActiveThinkingId = tc.id; const hr = tc.querySelector('.hidden-reasoning'); const sheetContent = document.querySelector('#thinking-sheet .sheet-content'); if (sheetContent) { sheetContent.innerHTML = `<p style="white-space:pre-wrap;font-family:monospace;font-size:13px;">${hr ? hr.textContent : '思考中...'}</p>`; sheetContent.scrollTop = sheetContent.scrollHeight; } openThinkingSheet(); }
    });
    if (closeThinkingBtn) closeThinkingBtn.addEventListener('click', closeThinkingSheet);
    if (thinkingOverlay) thinkingOverlay.addEventListener('click', closeThinkingSheet);

    // 7. Modal
    const userProfileBtn = document.getElementById('user-profile-btn');
    const globalSettingsBtn = document.getElementById('global-settings-btn');
    const userSettingsModal = document.getElementById('user-settings-modal');
    const globalSettingsModal = document.getElementById('global-settings-modal');
    const openKbBtn = document.getElementById('open-kb-btn');
    const kbModal = document.getElementById('kb-modal');
    const openSkillsBtn = document.getElementById('open-skills-btn');
    const skillsModal = document.getElementById('skills-modal');
    const closeBtns = document.querySelectorAll('.close-modal-btn, .save-modal-btn');
    function openModal(m) { if (m) m.classList.add('active'); }
    function closeModal(m) { if (m) m.classList.remove('active'); }
    if (userProfileBtn) userProfileBtn.addEventListener('click', () => openModal(userSettingsModal));
    if (globalSettingsBtn) globalSettingsBtn.addEventListener('click', () => openModal(globalSettingsModal));
    if (openKbBtn) openKbBtn.addEventListener('click', () => { openModal(kbModal); if (typeof renderKbFilesList === 'function') renderKbFilesList(); });
    if (openSkillsBtn) openSkillsBtn.addEventListener('click', async () => { 
        if (!db) {
            console.log('[Skills] db 未初始化，等待...');
            await initDB();
        }
        openModal(skillsModal); 
        if (typeof renderSkillsList === 'function') renderSkillsList(); 
    });
    closeBtns.forEach(btn => { btn.addEventListener('click', (e) => { closeModal(e.target.closest('.modal-overlay')); }); });
    document.querySelectorAll('.modal-overlay').forEach(m => { m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); }); });

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    tabBtns.forEach(btn => { btn.addEventListener('click', () => { tabBtns.forEach(b => b.classList.remove('active')); tabPanes.forEach(p => p.classList.remove('active')); btn.classList.add('active'); const tp = document.getElementById(btn.getAttribute('data-tab')); if (tp) tp.classList.add('active'); }); });

    // ====== 对话补全预设子 Tab 切换 ======
    const presetSubTabs = document.querySelectorAll('.preset-sub-tab');
    const presetSubPanes = document.querySelectorAll('.preset-sub-pane');
    presetSubTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            presetSubTabs.forEach(b => b.classList.remove('active'));
            presetSubPanes.forEach(p => p.style.display = 'none');
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-subtab');
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.style.display = 'block';
        });
    });

    // ====== 预设管理 ======
    const presetSelect = document.getElementById('completion-preset-select');
    const presetNameInput = document.getElementById('preset-name-input');
    const presetSysPrompt = document.getElementById('preset-system-prompt');
    const presetCtxTemp = document.getElementById('preset-context-template');
    const presetReasoningTemp = document.getElementById('preset-reasoning-template');
    const presetTempSlider = document.getElementById('preset-temp-slider');
    const presetTempVal = document.getElementById('preset-temp-val');
    const presetTopPSlider = document.getElementById('preset-topp-slider');
    const presetTopPVal = document.getElementById('preset-topp-val');
    const presetTopKInput = document.getElementById('preset-topk-input');
    const presetRepPenSlider = document.getElementById('preset-rep-pen-slider');
    const presetRepPenVal = document.getElementById('preset-rep-pen-val');

    function savePresets() {
        localStorage.setItem('completion_presets', JSON.stringify(presets));
        localStorage.setItem('current_preset_id', currentPresetId);
    }

    function renderPresetSelect() {
        if (!presetSelect) return;
        presetSelect.innerHTML = '';
        presets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            presetSelect.appendChild(opt);
        });
        presetSelect.value = currentPresetId;
    }

    function loadPresetToUI(presetId) {
        const p = presets.find(x => x.id === presetId);
        if (!p) return;
        if (presetNameInput) presetNameInput.value = p.name || '';
        if (presetSysPrompt) presetSysPrompt.value = p.system_prompt || '';
        if (presetCtxTemp) presetCtxTemp.value = p.context_template || '';
        if (presetReasoningTemp) presetReasoningTemp.value = p.reasoning_template || '';
        if (presetTempSlider && presetTempVal) {
            presetTempSlider.value = p.temperature !== undefined ? p.temperature : 0.8;
            presetTempVal.textContent = parseFloat(presetTempSlider.value).toFixed(2);
        }
        if (presetTopPSlider && presetTopPVal) {
            presetTopPSlider.value = p.top_p !== undefined ? p.top_p : 1.0;
            presetTopPVal.textContent = parseFloat(presetTopPSlider.value).toFixed(2);
        }
        if (presetTopKInput) presetTopKInput.value = p.top_k || 0;
        if (presetRepPenSlider && presetRepPenVal) {
            presetRepPenSlider.value = p.repetition_penalty !== undefined ? p.repetition_penalty : 1.0;
            presetRepPenVal.textContent = parseFloat(presetRepPenSlider.value).toFixed(2);
        }
    }

    function saveCurrentPresetFromUI() {
        const p = presets.find(x => x.id === currentPresetId);
        if (!p) return;
        if (presetNameInput) p.name = presetNameInput.value.trim() || '未命名预设';
        if (presetSysPrompt) p.system_prompt = presetSysPrompt.value;
        if (presetCtxTemp) p.context_template = presetCtxTemp.value;
        if (presetReasoningTemp) p.reasoning_template = presetReasoningTemp.value;
        if (presetTempSlider) p.temperature = parseFloat(presetTempSlider.value);
        if (presetTopPSlider) p.top_p = parseFloat(presetTopPSlider.value);
        if (presetTopKInput) p.top_k = parseInt(presetTopKInput.value) || 0;
        if (presetRepPenSlider) p.repetition_penalty = parseFloat(presetRepPenSlider.value);
        savePresets();
        
        // 更新 select 中的文字
        const opt = presetSelect.querySelector(`option[value="${currentPresetId}"]`);
        if (opt) opt.textContent = p.name;
    }

    if (presetSelect) {
        presetSelect.addEventListener('change', (e) => {
            currentPresetId = e.target.value;
            loadPresetToUI(currentPresetId);
            savePresets();
        });
    }

    const presetInputs = [presetNameInput, presetSysPrompt, presetCtxTemp, presetReasoningTemp, presetTopKInput];
    presetInputs.forEach(el => {
        if (el) el.addEventListener('change', saveCurrentPresetFromUI);
    });

    if (presetTempSlider) {
        presetTempSlider.addEventListener('input', (e) => {
            if (presetTempVal) presetTempVal.textContent = parseFloat(e.target.value).toFixed(2);
        });
        presetTempSlider.addEventListener('change', saveCurrentPresetFromUI);
    }
    if (presetTopPSlider) {
        presetTopPSlider.addEventListener('input', (e) => {
            if (presetTopPVal) presetTopPVal.textContent = parseFloat(e.target.value).toFixed(2);
        });
        presetTopPSlider.addEventListener('change', saveCurrentPresetFromUI);
    }
    if (presetRepPenSlider) {
        presetRepPenSlider.addEventListener('input', (e) => {
            if (presetRepPenVal) presetRepPenVal.textContent = parseFloat(e.target.value).toFixed(2);
        });
        presetRepPenSlider.addEventListener('change', saveCurrentPresetFromUI);
    }

    // 初始化渲染
    renderPresetSelect();
    loadPresetToUI(currentPresetId);

    // 新建/删除/导入/导出预设
    const presetNewBtn = document.getElementById('preset-new-btn');
    const presetDeleteBtn = document.getElementById('preset-delete-btn');
    const presetImportBtn = document.getElementById('preset-import-btn');
    const presetExportBtn = document.getElementById('preset-export-btn');
    const presetImportInput = document.getElementById('preset-import-input');
    const createPresetModal = document.getElementById('create-preset-modal');
    const confirmCreatePresetBtn = document.getElementById('confirm-create-preset-btn');
    const newPresetNameInput = document.getElementById('new-preset-name');

    if (presetNewBtn) presetNewBtn.addEventListener('click', () => openModal(createPresetModal));
    if (confirmCreatePresetBtn) {
        confirmCreatePresetBtn.addEventListener('click', () => {
            const name = newPresetNameInput.value.trim();
            if (!name) return;
            const newId = 'preset_' + Date.now();
            presets.push({
                id: newId, name: name, system_prompt: '', context_template: '', reasoning_template: '',
                temperature: 0.8, top_p: 1.0, top_k: 0, repetition_penalty: 1.0
            });
            currentPresetId = newId;
            savePresets();
            renderPresetSelect();
            loadPresetToUI(currentPresetId);
            closeModal(createPresetModal);
            newPresetNameInput.value = '';
            showToast('已新建预设');
        });
    }

    if (presetDeleteBtn) {
        presetDeleteBtn.addEventListener('click', () => {
            if (presets.length <= 1) { showToast('至少需保留一个预设'); return; }
            if (confirm('确定要删除当前预设吗？')) {
                presets = presets.filter(p => p.id !== currentPresetId);
                currentPresetId = presets[0].id;
                savePresets();
                renderPresetSelect();
                loadPresetToUI(currentPresetId);
                showToast('已删除预设');
            }
        });
    }

    if (presetExportBtn) {
        presetExportBtn.addEventListener('click', () => {
            const p = presets.find(x => x.id === currentPresetId);
            if (!p) return;
            // 导出 ST 兼容格式
            const exportObj = {
                name: p.name,
                system_prompt: p.system_prompt || '',
                temperature: p.temperature !== undefined ? p.temperature : 0.8,
                top_p: p.top_p !== undefined ? p.top_p : 1.0,
                top_k: p.top_k || 0,
                repetition_penalty: p.repetition_penalty !== undefined ? p.repetition_penalty : 1.0,
                context_template: p.context_template || '',
                reasoning_template: p.reasoning_template || ''
            };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
            const a = document.createElement('a');
            a.href = dataStr; a.download = `${p.name}_preset.json`;
            document.body.appendChild(a); a.click(); a.remove();
            showToast('预设已导出');
        });
    }

    if (presetImportBtn && presetImportInput) {
        presetImportBtn.addEventListener('click', () => presetImportInput.click());
        presetImportInput.addEventListener('change', (e) => {
            const f = e.target.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!data.name && !data.system_prompt) throw new Error('无效的预设文件');
                    const newId = 'preset_' + Date.now();
                    presets.push({
                        id: newId,
                        name: data.name || 'Imported Preset',
                        system_prompt: data.system_prompt || '',
                        context_template: data.context_template || '',
                        reasoning_template: data.reasoning_template || '',
                        temperature: data.temperature !== undefined ? data.temperature : 0.8,
                        top_p: data.top_p !== undefined ? data.top_p : 1.0,
                        top_k: data.top_k || 0,
                        repetition_penalty: data.repetition_penalty !== undefined ? data.repetition_penalty : 1.0
                    });
                    currentPresetId = newId;
                    savePresets();
                    renderPresetSelect();
                    loadPresetToUI(currentPresetId);
                    showToast('预设导入成功');
                } catch (err) {
                    showToast('导入失败：文件格式不正确');
                }
            };
            r.readAsText(f);
            e.target.value = '';
        });
    }

    // ====== 正则管理 ======
    const regexListContainer = document.getElementById('regex-list-container');
    const regexAddBtn = document.getElementById('regex-add-btn');
    const regexImportBtn = document.getElementById('regex-import-btn');
    const regexExportBtn = document.getElementById('regex-export-btn');
    const regexImportInput = document.getElementById('regex-import-input');

    const regexEditModal = document.getElementById('regex-edit-modal');
    const saveRegexBtn = document.getElementById('save-regex-btn');
    const regexEditId = document.getElementById('regex-edit-id');
    const regexEditName = document.getElementById('regex-edit-name');
    const regexEditPattern = document.getElementById('regex-edit-pattern');
    const regexEditReplacement = document.getElementById('regex-edit-replacement');
    const regexEditPlacement = document.getElementById('regex-edit-placement');

    function saveRegexScripts() {
        localStorage.setItem('regex_scripts', JSON.stringify(regexScripts));
    }

    function renderRegexList() {
        if (!regexListContainer) return;
        regexListContainer.innerHTML = '';
        if (regexScripts.length === 0) {
            regexListContainer.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">暂无正则表达式</div>';
            return;
        }

        regexScripts.forEach(rs => {
            const item = document.createElement('div');
            item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-sm);';
            item.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;overflow:hidden;flex:1;">
                    <label class="toggle-switch">
                        <input type="checkbox" class="regex-toggle" ${rs.enabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                    <div style="display:flex;flex-direction:column;overflow:hidden;">
                        <span style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${rs.name} <span style="font-size:10px;color:white;background:var(--accent-primary);padding:2px 4px;border-radius:4px;">${rs.placement === 'input' ? '输入' : '输出'}</span></span>
                        <span style="font-size:12px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:monospace;">${rs.pattern}</span>
                    </div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0;">
                    <button class="icon-btn edit-regex-btn" title="编辑"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    <button class="icon-btn delete-regex-btn" title="删除" style="color:#dc2626;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            `;
            item.querySelector('.regex-toggle').addEventListener('change', (e) => {
                rs.enabled = e.target.checked;
                saveRegexScripts();
            });
            item.querySelector('.edit-regex-btn').addEventListener('click', () => {
                regexEditId.value = rs.id;
                regexEditName.value = rs.name;
                regexEditPattern.value = rs.pattern;
                regexEditReplacement.value = rs.replacement;
                regexEditPlacement.value = rs.placement;
                document.getElementById('regex-modal-title').textContent = '编辑正则';
                openModal(regexEditModal);
            });
            item.querySelector('.delete-regex-btn').addEventListener('click', () => {
                if (confirm('确定要删除这条正则吗？')) {
                    regexScripts = regexScripts.filter(r => r.id !== rs.id);
                    saveRegexScripts();
                    renderRegexList();
                }
            });
            regexListContainer.appendChild(item);
        });
    }

    if (regexAddBtn) {
        regexAddBtn.addEventListener('click', () => {
            regexEditId.value = '';
            regexEditName.value = '';
            regexEditPattern.value = '';
            regexEditReplacement.value = '';
            regexEditPlacement.value = 'output';
            document.getElementById('regex-modal-title').textContent = '添加正则';
            openModal(regexEditModal);
        });
    }

    if (saveRegexBtn) {
        saveRegexBtn.addEventListener('click', () => {
            const name = regexEditName.value.trim();
            const pattern = regexEditPattern.value.trim();
            if (!name || !pattern) { showToast('名称和正则表达式不能为空'); return; }
            try { new RegExp(pattern); } catch (e) { showToast('正则表达式语法错误'); return; }

            const id = regexEditId.value;
            if (id) {
                const rs = regexScripts.find(r => r.id === id);
                if (rs) {
                    rs.name = name;
                    rs.pattern = pattern;
                    rs.replacement = regexEditReplacement.value;
                    rs.placement = regexEditPlacement.value;
                }
            } else {
                regexScripts.push({
                    id: 'regex_' + Date.now(),
                    name: name,
                    pattern: pattern,
                    replacement: regexEditReplacement.value,
                    placement: regexEditPlacement.value,
                    enabled: true
                });
            }
            saveRegexScripts();
            renderRegexList();
            closeModal(regexEditModal);
        });
    }

    if (regexExportBtn) {
        regexExportBtn.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(regexScripts, null, 2));
            const a = document.createElement('a');
            a.href = dataStr; a.download = `regex_scripts.json`;
            document.body.appendChild(a); a.click(); a.remove();
            showToast('正则已导出');
        });
    }

    if (regexImportBtn && regexImportInput) {
        regexImportBtn.addEventListener('click', () => regexImportInput.click());
        regexImportInput.addEventListener('change', (e) => {
            const f = e.target.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!Array.isArray(data)) throw new Error('无效的正则文件');
                    data.forEach(d => {
                        if (d.pattern) {
                            regexScripts.push({
                                id: 'regex_' + Date.now() + Math.random().toString(36).substring(2,7),
                                name: d.name || 'Imported Regex',
                                pattern: d.pattern,
                                replacement: d.replacement || '',
                                placement: d.placement === 'input' ? 'input' : 'output',
                                enabled: d.enabled !== undefined ? d.enabled : true
                            });
                        }
                    });
                    saveRegexScripts();
                    renderRegexList();
                    showToast('正则导入成功');
                } catch (err) {
                    showToast('导入失败：文件格式不正确');
                }
            };
            r.readAsText(f);
            e.target.value = '';
        });
    }

    renderRegexList();

    // 9. API 配置
    const addApiConfigBtn = document.getElementById('add-api-config-btn');
    const exportApiConfigsBtn = document.getElementById('export-api-configs-btn');
    const importApiConfigsBtn = document.getElementById('import-api-configs-btn');
    const importApiConfigsInput = document.getElementById('import-api-configs-input');
    const cancelApiConfigBtn = document.getElementById('cancel-api-config-btn');
    const saveApiConfigBtn = document.getElementById('save-api-config-btn');
    const apiListView = document.getElementById('api-list-view');
    const apiEditView = document.getElementById('api-edit-view');
    const apiListContainer = document.getElementById('api-list-container');
    const apiListEmptyMsg = document.getElementById('api-list-empty-msg');
    let currentEditingConfigId = null;
    let apiConfigs = JSON.parse(localStorage.getItem('apiConfigs') || '[]');

    if (exportApiConfigsBtn) {
        exportApiConfigsBtn.addEventListener('click', () => {
            if (apiConfigs.length === 0) {
                showToast('暂无配置可导出');
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(apiConfigs, null, 2));
            const a = document.createElement('a');
            const now = new Date();
            const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
            a.setAttribute("href", dataStr);
            a.setAttribute("download", `api-configs-${dateStr}.json`);
            document.body.appendChild(a);
            a.click();
            a.remove();
            showToast('API 配置已导出');
        });
    }

    if (importApiConfigsBtn && importApiConfigsInput) {
        importApiConfigsBtn.addEventListener('click', () => importApiConfigsInput.click());
        importApiConfigsInput.addEventListener('change', (e) => {
            const f = e.target.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!Array.isArray(data)) throw new Error('无效的配置文件');
                    
                    // 追加到现有配置，生成新 ID 避免冲突
                    data.forEach(cfg => {
                        const newCfg = { ...cfg };
                        newCfg.id = 'api_' + Date.now() + Math.random().toString(36).substring(2,7);
                        // 如果当前没有配置，将第一个导入的设为激活
                        newCfg.isActive = (apiConfigs.length === 0);
                        apiConfigs.push(newCfg);
                        // 如果有多个导入的且被设为激活了，其他都重置（保证只有一个 active）
                        if (newCfg.isActive) {
                             apiConfigs.forEach(c => { if(c.id !== newCfg.id) c.isActive = false; });
                        }
                    });
                    
                    saveConfigsToLocal();
                    renderApiConfigs();
                    showToast('导入成功，已刷新列表');
                } catch (err) {
                    showToast('导入失败：文件格式不正确');
                }
            };
            r.readAsText(f);
            e.target.value = '';
        });
    }
    function saveConfigsToLocal() { localStorage.setItem('apiConfigs', JSON.stringify(apiConfigs)); }
    function renderApiConfigs() {
        if (!apiListContainer) return; apiListContainer.innerHTML = '';
        if (apiConfigs.length === 0) { if (apiListEmptyMsg) apiListEmptyMsg.style.display = 'block'; return; }
        if (apiListEmptyMsg) apiListEmptyMsg.style.display = 'none';
        apiConfigs.forEach(config => {
            const item = document.createElement('div'); item.className = 'worldbook-item'; item.style.display = 'flex'; item.style.alignItems = 'center'; item.style.justifyContent = 'space-between';
            item.innerHTML = `<div style="display:flex;align-items:center;gap:12px;"><input type="radio" name="active-api" class="api-active-radio" ${config.isActive?'checked':''} title="设为当前激活" style="cursor:pointer;width:16px;height:16px;"><div style="display:flex;flex-direction:column;gap:4px;"><span class="config-name" style="font-weight:600;">${config.name}</span><span style="font-size:12px;color:var(--text-tertiary);">${config.url||'无端点'}</span></div></div><div style="display:flex;gap:4px;"><button class="icon-btn edit-config-btn" title="编辑"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="icon-btn delete-config-btn" title="删除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div>`;
            item.querySelector('.api-active-radio').addEventListener('change', () => { apiConfigs.forEach(c => c.isActive = false); config.isActive = true; saveConfigsToLocal(); });
            item.querySelector('.edit-config-btn').addEventListener('click', () => {
                currentEditingConfigId = config.id; apiListView.style.display = 'none'; apiEditView.style.display = 'block';
                const cn = apiEditView.querySelector('input[placeholder*="配置组名称"]');
                const ui = apiEditView.querySelector('input[placeholder*="http://localhost:1234/v1"]');
                if (cn) cn.value = config.name; if (ui) ui.value = config.url || '';
                const kl = document.getElementById('api-keys-list'); const ke = document.getElementById('api-keys-empty');
                if (kl) kl.innerHTML = '';
                if (config.key) { if (ke) ke.style.display = 'none'; const ki = document.createElement('div'); ki.className = 'api-key-item'; ki.innerHTML = `<input type="password" placeholder="sk-..." class="text-input" value="${config.key}"><button class="icon-btn delete-key-btn" title="删除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`; ki.querySelector('.delete-key-btn').addEventListener('click',()=>{ki.remove();if(kl.children.length===0&&ke)ke.style.display='block';}); kl.appendChild(ki); }
                else { if (ke) ke.style.display = 'block'; }
                const ms = document.getElementById('api-model-select');
                if (ms) { if (config.model) { ms.innerHTML = `<option value="${config.model}">${config.model}</option>`; ms.value = config.model; ms.disabled = false; } else { ms.innerHTML = '<option value="">请先点击连接获取模型</option>'; ms.disabled = true; } }
            });
            item.querySelector('.delete-config-btn').addEventListener('click', () => { apiConfigs = apiConfigs.filter(c => c.id !== config.id); if (config.isActive && apiConfigs.length > 0) apiConfigs[0].isActive = true; saveConfigsToLocal(); renderApiConfigs(); });
            apiListContainer.appendChild(item);
        });
    }
    renderApiConfigs();

    if (addApiConfigBtn && cancelApiConfigBtn && apiListView && apiEditView) {
        addApiConfigBtn.addEventListener('click', () => {
            currentEditingConfigId = null; apiListView.style.display = 'none'; apiEditView.style.display = 'block';
            apiEditView.querySelectorAll('input[type="text"]').forEach(i => i.value = '');
            const kl = document.getElementById('api-keys-list'); if (kl) kl.innerHTML = '';
            const ke = document.getElementById('api-keys-empty'); if (ke) ke.style.display = 'block';
            const ms = document.getElementById('api-model-select'); if (ms) { ms.innerHTML = '<option value="">请先点击连接获取模型</option>'; ms.disabled = true; }
        });
        cancelApiConfigBtn.addEventListener('click', () => { apiEditView.style.display = 'none'; apiListView.style.display = 'block'; });
        if (saveApiConfigBtn) {
            saveApiConfigBtn.addEventListener('click', () => {
                const cn = apiEditView.querySelector('input[placeholder*="配置组名称"]'); const cname = cn ? cn.value.trim() : '未命名';
                const ui = apiEditView.querySelector('input[placeholder*="http://localhost:1234/v1"]'); const burl = ui ? ui.value.trim() : '';
                const fki = document.querySelector('.api-key-item input[type="password"]'); const akey = fki ? fki.value.trim() : '';
                const ms = document.getElementById('api-model-select'); const smodel = ms ? ms.value : '';
                const ws = document.getElementById('api-web-search-toggle'); const dt = document.getElementById('api-deep-think-toggle'); const vt = document.getElementById('api-vision-toggle');
                if (!cname) { alert('请输入配置组名称'); return; }
                if (currentEditingConfigId) { const cf = apiConfigs.find(c => c.id === currentEditingConfigId); if (cf) { cf.name = cname; cf.url = burl; cf.key = akey; cf.model = smodel; cf.webSearch = ws?.checked||false; cf.deepThink = dt?.checked||false; cf.vision = vt?.checked||false; } }
                else { apiConfigs.push({ id: Date.now().toString(), name: cname, url: burl, key: akey, model: smodel, webSearch: ws?.checked||false, deepThink: dt?.checked||false, vision: vt?.checked||false, isActive: apiConfigs.length===0 }); }
                saveConfigsToLocal(); renderApiConfigs(); apiEditView.style.display = 'none'; apiListView.style.display = 'block';
            });
        }
    }

    const addKeyBtn = document.getElementById('add-key-btn');
    const pasteMultiKeysBtn = document.getElementById('paste-multi-keys-btn');
    const pasteKeysModal = document.getElementById('paste-keys-modal');
    const pasteKeysTextarea = document.getElementById('paste-keys-textarea');
    const confirmPasteKeysBtn = document.getElementById('confirm-paste-keys-btn');
    const apiKeysList = document.getElementById('api-keys-list');
    const apiKeysEmpty = document.getElementById('api-keys-empty');
    if (addKeyBtn && apiKeysList && apiKeysEmpty) {
        addKeyBtn.addEventListener('click', () => { apiKeysEmpty.style.display = 'none'; const ki = document.createElement('div'); ki.className = 'api-key-item'; ki.innerHTML = `<input type="password" placeholder="sk-..." class="text-input"><button class="icon-btn delete-key-btn" title="删除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`; ki.querySelector('.delete-key-btn').addEventListener('click',()=>{ki.remove();if(apiKeysList.children.length===0)apiKeysEmpty.style.display='block';}); apiKeysList.appendChild(ki); });
    }
    
    if (pasteMultiKeysBtn && pasteKeysModal) {
        pasteMultiKeysBtn.addEventListener('click', () => {
            if (pasteKeysTextarea) pasteKeysTextarea.value = '';
            openModal(pasteKeysModal);
        });
    }

    if (confirmPasteKeysBtn && pasteKeysTextarea) {
        confirmPasteKeysBtn.addEventListener('click', () => {
            const keysStr = pasteKeysTextarea.value;
            const keys = keysStr.split('\n').map(k => k.trim()).filter(k => k);
            if (keys.length === 0) {
                showToast('未检测到有效的 Key');
                return;
            }
            if (apiKeysEmpty) apiKeysEmpty.style.display = 'none';
            keys.forEach(k => {
                const ki = document.createElement('div'); 
                ki.className = 'api-key-item'; 
                ki.innerHTML = `<input type="password" placeholder="sk-..." class="text-input" value="${k}"><button class="icon-btn delete-key-btn" title="删除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`; 
                ki.querySelector('.delete-key-btn').addEventListener('click',()=>{ki.remove();if(apiKeysList.children.length===0)apiKeysEmpty.style.display='block';}); 
                apiKeysList.appendChild(ki);
            });
            closeModal(pasteKeysModal);
            showToast(`成功添加 ${keys.length} 个 Key`);
        });
    }

    // 11. API 连接
    const apiConnectBtn = document.getElementById('api-connect-btn');
    const apiTestMessageBtn = document.getElementById('api-test-message-btn');
    const apiModelSelect = document.getElementById('api-model-select');
    const apiModelHint = document.getElementById('api-model-hint');
    if (apiConnectBtn && apiModelSelect) {
        apiConnectBtn.addEventListener('click', async () => {
            const ui = document.querySelector('input[placeholder*="http://localhost:1234/v1"]'); let burl = ui ? ui.value.trim() : '';
            const fki = document.querySelector('.api-key-item input[type="password"]'); const akey = fki ? fki.value.trim() : '';
            if (!burl) { alert('请输入自定义端点'); return; }
            const murl = burl.endsWith('/') ? `${burl}models` : `${burl}/models`;
            apiConnectBtn.textContent = '连接中...'; apiConnectBtn.disabled = true;
            if (apiModelHint) { apiModelHint.textContent = '正在请求模型列表...'; apiModelHint.style.color = 'var(--text-tertiary)'; }
            try {
                const headers = { 'Content-Type': 'application/json' }; if (akey) headers['Authorization'] = `Bearer ${akey}`;
                const resp = await fetch(murl, { method: 'GET', headers });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json(); let models = [];
                if (data?.data && Array.isArray(data.data)) models = data.data; else if (Array.isArray(data)) models = data;
                if (models.length === 0) throw new Error('未找到模型');
                apiModelSelect.innerHTML = ''; models.forEach(m => { const o = document.createElement('option'); o.value = m.id||m.name||m; o.textContent = m.id||m.name||m; apiModelSelect.appendChild(o); });
                if (currentEditingConfigId) { const cf = apiConfigs.find(c => c.id === currentEditingConfigId); if (cf?.model) apiModelSelect.value = cf.model; }
                apiConnectBtn.textContent = '已连接'; apiConnectBtn.disabled = false; apiConnectBtn.style.backgroundColor = 'var(--accent-primary)'; apiConnectBtn.style.color = 'white'; apiConnectBtn.style.borderColor = 'var(--accent-primary)'; apiModelSelect.disabled = false;
                if (apiModelHint) { apiModelHint.textContent = `成功获取 ${models.length} 个模型！`; apiModelHint.style.color = '#10b981'; }
            } catch (err) { console.error(err); apiConnectBtn.textContent = '连接失败'; apiConnectBtn.disabled = false; apiConnectBtn.style.backgroundColor = ''; apiConnectBtn.style.color = ''; apiConnectBtn.style.borderColor = ''; if (apiModelHint) { apiModelHint.textContent = `连接失败: ${err.message}`; apiModelHint.style.color = '#dc2626'; } apiModelSelect.innerHTML = '<option value="">获取失败</option>'; apiModelSelect.disabled = true; }
        });
    }

    if (apiTestMessageBtn) {
        apiTestMessageBtn.addEventListener('click', async () => {
            const ui = document.querySelector('input[placeholder*="http://localhost:1234/v1"]'); let burl = ui ? ui.value.trim() : '';
            const fki = document.querySelector('.api-key-item input[type="password"]'); const akey = fki ? fki.value.trim() : '';
            const smodel = apiModelSelect ? apiModelSelect.value : '';
            
            if (!burl) { showToast('发送失败：请输入自定义端点'); return; }
            if (!smodel) { showToast('发送失败：请先连接并选择一个模型'); return; }

            const chatUrl = burl.endsWith('/') ? `${burl}chat/completions` : `${burl}/chat/completions`;
            
            const originalText = apiTestMessageBtn.textContent;
            apiTestMessageBtn.textContent = '测试中...';
            apiTestMessageBtn.disabled = true;

            try {
                const headers = { 'Content-Type': 'application/json' }; 
                if (akey) headers['Authorization'] = `Bearer ${akey}`;
                
                const requestBody = {
                    model: smodel,
                    messages: [{ role: "user", content: "请回复 OK" }],
                    max_tokens: 10
                };

                const resp = await fetch(chatUrl, { method: 'POST', headers, body: JSON.stringify(requestBody) });
                
                if (!resp.ok) {
                    let errorMsg = `HTTP ${resp.status}`;
                    try {
                        const errData = await resp.json();
                        if (errData.error && errData.error.message) errorMsg = errData.error.message;
                    } catch(e) {}
                    throw new Error(errorMsg);
                }
                
                showToast('连接成功');
            } catch (err) {
                showToast(`连接失败: ${err.message}`, 4000);
            } finally {
                apiTestMessageBtn.textContent = originalText;
                apiTestMessageBtn.disabled = false;
            }
        });
    }

    // ============ 世界书管理 ============
    const globalWorldbookSelect = document.getElementById('global-worldbook-select');
    const wbCreateBtn = document.getElementById('wb-create-btn');
    const wbImportBtn = document.getElementById('wb-import-btn');
    const wbExportBtn = document.getElementById('wb-export-btn');
    const wbDeleteBtn = document.getElementById('wb-delete-btn');
    const wbImportInput = document.getElementById('wb-import-input');
    const wbEntriesGroup = document.getElementById('wb-entries-group');
    const wbEntriesList = document.getElementById('wb-entries-list');
    const wbAddEntryBtn = document.getElementById('wb-add-entry-btn');

    const createWbModal = document.getElementById('create-worldbook-modal');
    const newWbNameInput = document.getElementById('new-wb-name');
    const confirmCreateWbBtn = document.getElementById('confirm-create-wb-btn');

    const wbEntryModal = document.getElementById('worldbook-entry-modal');
    const wbEntryModalTitle = document.getElementById('wb-entry-modal-title');
    const wbEntryUid = document.getElementById('wb-entry-uid');
    const wbEntryKeys = document.getElementById('wb-entry-keys');
    const wbEntryContent = document.getElementById('wb-entry-content');
    const wbEntryComment = document.getElementById('wb-entry-comment');
    const wbEntryConstant = document.getElementById('wb-entry-constant');
    const wbEntryOrder = document.getElementById('wb-entry-order');
    const saveWbEntryBtn = document.getElementById('save-wb-entry-btn');

    let currentWorldbookName = '';

    function renderGlobalWorldbookSelect() {
        if (!globalWorldbookSelect) return;
        const currentVal = globalWorldbookSelect.value;
        globalWorldbookSelect.innerHTML = '<option value="">选择世界书</option>';
        Object.keys(worldbooks).forEach(wbName => {
            const opt = document.createElement('option');
            opt.value = wbName;
            opt.textContent = wbName;
            globalWorldbookSelect.appendChild(opt);
        });
        if (worldbooks[currentVal]) {
            globalWorldbookSelect.value = currentVal;
            currentWorldbookName = currentVal;
        } else {
            globalWorldbookSelect.value = '';
            currentWorldbookName = '';
        }
        updateWorldbookUI();
    }

    function updateWorldbookUI() {
        if (currentWorldbookName && worldbooks[currentWorldbookName]) {
            if (wbEntriesGroup) wbEntriesGroup.style.display = 'block';
            if (wbExportBtn) wbExportBtn.disabled = false;
            if (wbDeleteBtn) wbDeleteBtn.disabled = false;
            renderWorldbookEntries();
        } else {
            if (wbEntriesGroup) wbEntriesGroup.style.display = 'none';
            if (wbExportBtn) wbExportBtn.disabled = true;
            if (wbDeleteBtn) wbDeleteBtn.disabled = true;
        }
        
        // 更新角色面板里的下拉框
        const charWbSelect = document.getElementById('char-worldbook-select');
        if (charWbSelect) {
            const currentSelected = charWbSelect.value;
            charWbSelect.innerHTML = '<option value="">不使用世界书</option>';
            Object.keys(worldbooks).forEach(wbName => {
                const opt = document.createElement('option');
                opt.value = wbName;
                opt.textContent = wbName;
                charWbSelect.appendChild(opt);
            });
            if (worldbooks[currentSelected]) charWbSelect.value = currentSelected;
            else charWbSelect.value = '';
        }
    }

    function renderWorldbookEntries() {
        if (!wbEntriesList) return;
        wbEntriesList.innerHTML = '';
        const wb = worldbooks[currentWorldbookName];
        if (!wb || !wb.entries || wb.entries.length === 0) {
            wbEntriesList.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">暂无条目</div>';
            return;
        }
        
        Object.values(wb.entries).sort((a,b) => (a.order||100) - (b.order||100)).forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'worldbook-item';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.padding = '8px';
            item.style.backgroundColor = 'var(--bg-secondary)';
            item.style.borderRadius = 'var(--radius-sm)';
            
            const keysStr = Array.isArray(entry.keys) ? entry.keys.join(', ') : '';
            let contentPreview = entry.content || '';
            if (contentPreview.length > 50) contentPreview = contentPreview.substring(0, 50) + '...';
            
            const badgeHTML = entry.constant ? '<span style="background-color:var(--accent-primary);color:white;font-size:10px;padding:2px 4px;border-radius:4px;margin-left:4px;">恒生效</span>' : '';

            item.innerHTML = `
                <div style="display:flex;flex-direction:column;overflow:hidden;flex:1;margin-right:8px;">
                    <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">[${keysStr}]${badgeHTML}</div>
                    <div style="font-size:12px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${entry.content}">${contentPreview}</div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0;">
                    <button class="icon-btn edit-entry-btn" title="编辑"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    <button class="icon-btn delete-entry-btn" title="删除" style="color:#dc2626;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            `;
            
            item.querySelector('.edit-entry-btn').addEventListener('click', () => {
                openWbEntryModal(entry.uid);
            });
            item.querySelector('.delete-entry-btn').addEventListener('click', () => {
                delete wb.entries[entry.uid];
                saveWorldbooksToLocal();
                renderWorldbookEntries();
            });
            
            wbEntriesList.appendChild(item);
        });
    }

    if (globalWorldbookSelect) {
        globalWorldbookSelect.addEventListener('change', (e) => {
            currentWorldbookName = e.target.value;
            updateWorldbookUI();
        });
    }

    if (wbCreateBtn && createWbModal) {
        wbCreateBtn.addEventListener('click', () => {
            if (newWbNameInput) newWbNameInput.value = '';
            openModal(createWbModal);
        });
    }

    if (confirmCreateWbBtn && newWbNameInput) {
        confirmCreateWbBtn.addEventListener('click', () => {
            const name = newWbNameInput.value.trim();
            if (!name) { showToast('请输入世界书名称'); return; }
            if (worldbooks[name]) { showToast('同名世界书已存在'); return; }
            
            worldbooks[name] = {
                name: name,
                entries: {}
            };
            saveWorldbooksToLocal();
            renderGlobalWorldbookSelect();
            globalWorldbookSelect.value = name;
            currentWorldbookName = name;
            updateWorldbookUI();
            closeModal(createWbModal);
            showToast('世界书创建成功');
        });
    }

    if (wbDeleteBtn) {
        wbDeleteBtn.addEventListener('click', () => {
            if (!currentWorldbookName || !worldbooks[currentWorldbookName]) return;
            if (confirm(`确定要删除世界书 "${currentWorldbookName}" 吗？此操作不可恢复。`)) {
                delete worldbooks[currentWorldbookName];
                saveWorldbooksToLocal();
                
                // 清理绑定了该世界书的角色设定
                Object.values(chatSessions).forEach(session => {
                    if (session.settings && session.settings.worldbook === currentWorldbookName) {
                        session.settings.worldbook = '';
                    }
                });
                saveChatSessionsToLocal();
                
                currentWorldbookName = '';
                renderGlobalWorldbookSelect();
                showToast('世界书已删除');
            }
        });
    }

    if (wbExportBtn) {
        wbExportBtn.addEventListener('click', () => {
            if (!currentWorldbookName || !worldbooks[currentWorldbookName]) return;
            const wb = worldbooks[currentWorldbookName];
            const exportData = {
                name: wb.name,
                entries: Object.values(wb.entries)
            };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
            const a = document.createElement('a'); 
            a.setAttribute("href", dataStr); 
            a.setAttribute("download", `${wb.name}_worldbook.json`); 
            document.body.appendChild(a); 
            a.click(); 
            a.remove();
            showToast('世界书已导出');
        });
    }

    if (wbImportBtn && wbImportInput) {
        wbImportBtn.addEventListener('click', () => wbImportInput.click());
        wbImportInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    
                    let entriesData = data.entries;
                    // 如果 entries 是对象，转换为数组
                    if (entriesData && typeof entriesData === 'object' && !Array.isArray(entriesData)) {
                        entriesData = Object.values(entriesData);
                    }
                    
                    if (!Array.isArray(entriesData)) {
                        throw new Error('格式错误：未找到有效的 entries 数组');
                    }
                    
                    let importName = data.name || file.name.replace(/\.json$/i, '');
                    // 处理重名
                    if (worldbooks[importName]) {
                        importName = `${importName}_导入_${Date.now()}`;
                    }
                    
                    const newWb = { name: importName, entries: {} };
                    entriesData.forEach(entry => {
                        const uid = entry.uid || Date.now().toString() + Math.random().toString(36).substring(2, 9);
                        
                        let mergedKeys = [];
                        if (Array.isArray(entry.key)) mergedKeys = mergedKeys.concat(entry.key);
                        else if (typeof entry.key === 'string' && entry.key.trim() !== '') mergedKeys.push(entry.key);
                        
                        if (Array.isArray(entry.keys)) mergedKeys = mergedKeys.concat(entry.keys);
                        else if (typeof entry.keys === 'string' && entry.keys.trim() !== '') mergedKeys.push(entry.keys);
                        
                        mergedKeys = [...new Set(mergedKeys)];

                        newWb.entries[uid] = {
                            uid: uid,
                            keys: mergedKeys,
                            content: entry.content || '',
                            comment: entry.comment || '',
                            disable: !!entry.disable,
                            constant: !!entry.constant,
                            order: typeof entry.order === 'number' ? entry.order : 100
                        };
                    });
                    
                    worldbooks[importName] = newWb;
                    saveWorldbooksToLocal();
                    renderGlobalWorldbookSelect();
                    globalWorldbookSelect.value = importName;
                    currentWorldbookName = importName;
                    updateWorldbookUI();
                    showToast('世界书导入成功');
                    
                } catch (err) {
                    console.error(err);
                    showToast('导入失败：JSON格式错误，需符合SillyTavern规范');
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    function openWbEntryModal(uid = null) {
        if (!wbEntryModal) return;
        if (uid && worldbooks[currentWorldbookName] && worldbooks[currentWorldbookName].entries[uid]) {
            const entry = worldbooks[currentWorldbookName].entries[uid];
            wbEntryModalTitle.textContent = '编辑条目';
            wbEntryUid.value = entry.uid;
            wbEntryKeys.value = (entry.keys || []).join(', ');
            wbEntryContent.value = entry.content || '';
            wbEntryComment.value = entry.comment || '';
            wbEntryConstant.checked = !!entry.constant;
            wbEntryOrder.value = entry.order || 100;
        } else {
            wbEntryModalTitle.textContent = '添加新条目';
            wbEntryUid.value = '';
            wbEntryKeys.value = '';
            wbEntryContent.value = '';
            wbEntryComment.value = '';
            wbEntryConstant.checked = false;
            wbEntryOrder.value = '100';
        }
        openModal(wbEntryModal);
    }

    if (wbAddEntryBtn) {
        wbAddEntryBtn.addEventListener('click', () => openWbEntryModal());
    }

    if (saveWbEntryBtn) {
        saveWbEntryBtn.addEventListener('click', () => {
            if (!currentWorldbookName || !worldbooks[currentWorldbookName]) return;
            const keysStr = wbEntryKeys.value.trim();
            const content = wbEntryContent.value.trim();
            if (!keysStr) { showToast('请输入触发词'); return; }
            if (!content) { showToast('请输入内容'); return; }
            
            const keys = keysStr.split(',').map(k => k.trim()).filter(k => k);
            if (keys.length === 0) { showToast('请输入有效的触发词'); return; }

            const uid = wbEntryUid.value || Date.now().toString() + Math.random().toString(36).substring(2, 9);
            
            worldbooks[currentWorldbookName].entries[uid] = {
                uid: uid,
                keys: keys,
                content: content,
                comment: wbEntryComment.value.trim(),
                constant: wbEntryConstant.checked,
                order: parseInt(wbEntryOrder.value) || 100
            };
            
            saveWorldbooksToLocal();
            renderWorldbookEntries();
            closeModal(wbEntryModal);
            showToast('条目已保存');
        });
    }

    // 初始化下拉框
    renderGlobalWorldbookSelect();

    // 12. 全局保存/导入导出
    const globalSaveBtn = document.getElementById('global-save-btn');
    const exportAllDataBtn = document.getElementById('export-all-data-btn');
    const importAllDataBtn = document.getElementById('import-all-data-btn');
    const importAllDataInput = document.getElementById('import-all-data-input');
    if (exportAllDataBtn) {
        exportAllDataBtn.addEventListener('click', () => {
            const ad = { chatSessions: JSON.parse(localStorage.getItem('chatSessions')||'{}'), apiConfigs: JSON.parse(localStorage.getItem('apiConfigs')||'[]') };
            const ds = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(ad, null, 2));
            const a = document.createElement('a'); a.setAttribute("href", ds); a.setAttribute("download", `tavern_backup_${new Date().toISOString().slice(0,10)}.json`); document.body.appendChild(a); a.click(); a.remove();
            showToast('全部数据已导出');
        });
    }
    if (importAllDataBtn && importAllDataInput) {
        importAllDataBtn.addEventListener('click', () => importAllDataInput.click());
        importAllDataInput.addEventListener('change', (e) => {
            const f = e.target.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => { try { const d = JSON.parse(ev.target.result); if (d.chatSessions) { localStorage.setItem('chatSessions', JSON.stringify(d.chatSessions)); chatSessions = d.chatSessions; } if (d.apiConfigs) { localStorage.setItem('apiConfigs', JSON.stringify(d.apiConfigs)); apiConfigs = d.apiConfigs; } showToast('数据导入成功，正在刷新...'); setTimeout(() => window.location.reload(), 1000); } catch (err) { showToast('导入失败：文件格式不正确'); } };
            r.readAsText(f); e.target.value = '';
        });
    }
    if (globalSaveBtn) {
        globalSaveBtn.addEventListener('click', () => { const ot = globalSaveBtn.textContent; globalSaveBtn.textContent = '保存成功！'; globalSaveBtn.style.backgroundColor = '#10b981'; setTimeout(() => { globalSaveBtn.textContent = ot; globalSaveBtn.style.backgroundColor = ''; closeModal(globalSaveBtn.closest('.modal-overlay')); }, 1000); });
    }

    // 12.6 技能管理 (Skills)
    const importSkillsBtn = document.getElementById('import-skills-btn');
    const skillsFileInput = document.getElementById('skills-file-input');
    const skillsList = document.getElementById('skills-list');
    const skillsStatus = document.getElementById('skills-status');

    async function getActiveSkillsFromText(text) {
        let found = [];
        let notFound = [];
        let strippedText = text;
        if (!db) return { found, notFound, strippedText };
        
        const skillRegex = /\$([a-zA-Z0-9_\-\u4e00-\u9fa5]+)/g;
        let match;
        const skillNames = [];
        while ((match = skillRegex.exec(strippedText)) !== null) {
            skillNames.push(match[1]);
        }
        
        await new Promise(resolve => {
            const tx = db.transaction(['skills'], 'readonly');
            const store = tx.objectStore('skills');
            const req = store.getAll();
            req.onsuccess = () => {
                const allSkills = req.result || [];
                skillNames.forEach(name => {
                    const s = allSkills.find(x => x.name === name);
                    if (s) {
                        if (!found.some(x => x.name === s.name)) found.push(s);
                    } else {
                        notFound.push(name);
                    }
                });
                
                allSkills.forEach(s => {
                    if (s.enabled) {
                        if (!found.some(x => x.name === s.name)) found.push(s);
                    }
                });
                resolve();
            };
            req.onerror = () => resolve();
        });
        
        if (found.length > 0) {
            strippedText = strippedText.replace(skillRegex, '').trim();
        }
        return { found, notFound, strippedText };
    }

    window.openSkillEditModal = function(skillName) {
        if (!db) return;
        const tx = db.transaction(['skills'], 'readonly');
        const req = tx.objectStore('skills').get(skillName);
        req.onsuccess = () => {
            const skill = req.result;
            if (skill) {
                document.getElementById('skill-edit-old-name').value = skill.name;
                document.getElementById('skill-edit-name').value = skill.name;
                document.getElementById('skill-edit-desc').value = skill.description || '';
                document.getElementById('skill-edit-content').value = skill.content || '';
                window._currentEditSkillEnabled = skill.enabled;
                openModal(document.getElementById('skill-edit-modal'));
            }
        };
    };

    const saveSkillBtn = document.getElementById('save-skill-btn');
    if (saveSkillBtn) {
        saveSkillBtn.addEventListener('click', () => {
            const oldName = document.getElementById('skill-edit-old-name').value;
            const newName = document.getElementById('skill-edit-name').value.trim();
            const newDesc = document.getElementById('skill-edit-desc').value.trim();
            const newContent = document.getElementById('skill-edit-content').value.trim();
            
            if (!newName || !newContent) {
                showToast('名称和内容不能为空');
                return;
            }

            const tx = db.transaction(['skills'], 'readwrite');
            const store = tx.objectStore('skills');
            
            if (oldName && oldName !== newName) store.delete(oldName);
            
            store.put({
                name: newName,
                description: newDesc,
                content: newContent,
                enabled: window._currentEditSkillEnabled || false
            });

            tx.oncomplete = () => {
                showToast('技能已保存');
                closeModal(document.getElementById('skill-edit-modal'));
                if (typeof renderSkillsList === 'function') renderSkillsList();
            };
        });
    }

    window.renderSkillsList = async function() {
        console.log('[Skills] 刷新列表调用');
        if (!db || !skillsList) return;
        const tx = db.transaction(['skills'], 'readonly');
        const st = tx.objectStore('skills');
        const req = st.getAll();
        req.onsuccess = () => {
            const skills = req.result;
            skillsList.innerHTML = '';
            if (skills.length === 0) {
                skillsList.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">暂无技能</div>';
                return;
            }
            skills.forEach(skill => {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;background-color:var(--bg-secondary);border-radius:var(--radius-sm);cursor:pointer;';
                item.innerHTML = `
                    <div style="display:flex;align-items:center;gap:12px;overflow:hidden;flex:1;">
                        <label class="toggle-switch" style="flex-shrink:0;" onclick="event.stopPropagation()">
                            <input type="checkbox" class="skill-toggle" ${skill.enabled ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                        <div class="skill-info" style="display:flex;flex-direction:column;overflow:hidden;flex:1;">
                            <span style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${skill.name}</span>
                            <span style="font-size:12px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${skill.description || '无描述'}</span>
                        </div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;">
                        <button class="icon-btn edit-skill-btn" title="查看/编辑" onclick="event.stopPropagation()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                        <button class="icon-btn delete-skill-btn" title="删除" style="color:#dc2626;" onclick="event.stopPropagation()">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                `;
                item.querySelector('.skill-toggle').addEventListener('change', (e) => {
                    const dtx = db.transaction(['skills'], 'readwrite');
                    skill.enabled = e.target.checked;
                    dtx.objectStore('skills').put(skill);
                });
                const onEdit = () => { openSkillEditModal(skill.name); };
                item.querySelector('.edit-skill-btn').addEventListener('click', onEdit);
                item.querySelector('.skill-info').addEventListener('click', onEdit);
                item.querySelector('.delete-skill-btn').addEventListener('click', () => {
                    const dtx = db.transaction(['skills'], 'readwrite');
                    dtx.objectStore('skills').delete(skill.name);
                    dtx.oncomplete = () => { showToast(`已删除技能: ${skill.name}`); renderSkillsList(); };
                });
                skillsList.appendChild(item);
            });
        };
    };

    if (importSkillsBtn && skillsFileInput) {
        importSkillsBtn.addEventListener('click', () => skillsFileInput.click());
        skillsFileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            console.log(`[Skills] 文件选择触发: ${Array.from(files).map(f => f.name).join(', ')}`);
            if (skillsStatus) { skillsStatus.textContent = '导入中...'; skillsStatus.style.color = 'var(--text-tertiary)'; }
            
            let processedCount = 0;
            let successCount = 0;

            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const content = ev.target.result;
                    console.log(`[Skills] 文件读取完成, 内容前100字: ${content.substring(0, 100).replace(/\n/g, '\\n')}`);
                    let name = file.name.replace(/\.md$/i, '');
                    let description = '';
                    let actualContent = content;

                    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (yamlMatch) {
                        const frontmatter = yamlMatch[1];
                        const nameMatch = frontmatter.match(/^name:\s*(.+)/m);
                        if (nameMatch) name = nameMatch[1].trim();
                        const descMatch = frontmatter.match(/^description:\s*(.+)/m);
                        if (descMatch) description = descMatch[1].trim();
                        actualContent = content.substring(yamlMatch[0].length).trim();
                    }
                    if (!description) {
                        const titleMatch = actualContent.match(/^#\s+(.+)/m);
                        if (titleMatch) description = titleMatch[1].trim();
                    }

                    console.log('[Skills] 准备写入数据库');
                    const tx = db.transaction(['skills'], 'readwrite');
                    tx.objectStore('skills').put({ name, description, content: actualContent, enabled: false });
                    tx.oncomplete = () => {
                        console.log(`[Skills] 写入成功: ${name}`);
                        successCount++;
                        checkDone();
                    };
                    tx.onerror = (err) => {
                        console.log(`[Skills] 写入失败: ${err.target && err.target.error ? err.target.error : '未知错误'}`);
                        checkDone();
                    };
                };
                reader.readAsText(file);
            });

            function checkDone() {
                processedCount++;
                if (processedCount === files.length) {
                    if (skillsStatus) {
                        skillsStatus.textContent = `成功导入 ${successCount} 个技能`;
                        skillsStatus.style.color = '#10b981';
                        setTimeout(() => skillsStatus.textContent = '', 3000);
                    }
                    showToast(`成功导入 ${successCount} 个技能`);
                    renderSkillsList();
                    skillsFileInput.value = '';
                }
            }
        });
    }

    // 12.5 知识库
    const uploadKbBtn = document.getElementById('upload-kb-btn');
    const kbFileInput = document.getElementById('kb-file-input');
    const kbFilesList = document.getElementById('kb-files-list');
    const kbStatus = document.getElementById('kb-status');
    window.renderKbFilesList = function() {
        if (!db || !kbFilesList) return;
        const tx = db.transaction(['documents'], 'readonly'); const st = tx.objectStore('documents'); const ix = st.index('characterId'); const req = ix.getAll(currentChatId);
        req.onsuccess = () => { const chunks = req.result; kbFilesList.innerHTML = ''; if (chunks.length===0) { kbFilesList.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">暂无文档</div>'; return; }
            const fm = {}; chunks.forEach(c => { if (!fm[c.fileName]) fm[c.fileName] = 0; fm[c.fileName]++; });
            Object.keys(fm).forEach(fn => {
                const fi = document.createElement('div'); fi.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;background-color:var(--bg-secondary);border-radius:var(--radius-sm);';
                fi.innerHTML = `<div style="display:flex;align-items:center;gap:8px;overflow:hidden;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg><div style="display:flex;flex-direction:column;overflow:hidden;"><span style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${fn}</span><span style="font-size:12px;color:var(--text-tertiary);">${fm[fn]} 个片段</span></div></div><button class="icon-btn delete-kb-file-btn" title="删除" style="color:#dc2626;flex-shrink:0;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
                fi.querySelector('.delete-kb-file-btn').addEventListener('click', () => { const dtx = db.transaction(['documents'],'readwrite'); const dst = dtx.objectStore('documents'); const dix = dst.index('characterId'); const dr = dix.getAll(currentChatId); dr.onsuccess = () => { dr.result.forEach(c => { if(c.fileName===fn)dst.delete(c.id); }); }; dtx.oncomplete = () => { showToast(`已删除文档: ${fn}`); renderKbFilesList(); }; });
                kbFilesList.appendChild(fi);
            });
        };
    };
    if (uploadKbBtn && kbFileInput) {
        uploadKbBtn.addEventListener('click', () => kbFileInput.click());
        kbFileInput.addEventListener('change', (e) => {
            const f = e.target.files[0]; if (!f) return;
            if (kbStatus) { kbStatus.textContent = '处理中...'; kbStatus.style.color = 'var(--text-tertiary)'; }
            const r = new FileReader();
            r.onload = (ev) => { const t = ev.target.result; let rc = t.split(/\n\s*\n/); let chunks = [];
                rc.forEach(c => { let tr = c.trim(); if (!tr) return; if (tr.length > 800) { for (let i=0;i<tr.length;i+=800)chunks.push(tr.substring(i,i+800)); } else chunks.push(tr); });
                if (chunks.length===0) { if (kbStatus) kbStatus.textContent = '文件内容为空'; return; }
                const tx = db.transaction(['documents'],'readwrite'); const st = tx.objectStore('documents');
                chunks.forEach((c,i) => st.add({ characterId: currentChatId, fileName: f.name, content: c, chunkIndex: i }));
                tx.oncomplete = () => { if (kbStatus) { kbStatus.textContent = '上传成功'; kbStatus.style.color = '#10b981'; setTimeout(()=>kbStatus.textContent='',2000); } showToast(`已添加文档: ${f.name} (${chunks.length}个片段)`); renderKbFilesList(); };
                tx.onerror = (err) => { console.error(err); if (kbStatus) { kbStatus.textContent = '上传失败'; kbStatus.style.color = '#dc2626'; } };
            };
            r.readAsText(f); e.target.value = '';
        });
    }

    // 辅助函数
    function buildSystemPrompt() {
        const currentPreset = presets.find(x => x.id === currentPresetId);
        const presetSysPrompt = currentPreset ? (currentPreset.system_prompt || '') : '';

        const si = document.querySelector('#tab-completion textarea[placeholder*="系统提示词"]');
        const gsp = si?.value.trim() || "";
        let cd = ""; 
        let wbName = "";
        if (chatSessions[currentChatId]?.settings) {
            cd = chatSessions[currentChatId].settings.desc || "";
            wbName = chatSessions[currentChatId].settings.worldbook || "";
        }
        let fsp = "You are a helpful assistant.";
        if (gsp && cd) fsp = `${gsp}\n\n${cd}`; else if (gsp) fsp = gsp; else if (cd) fsp = cd;
        
        if (presetSysPrompt) fsp = presetSysPrompt + '\n\n' + fsp;

        fsp += "\n\n你可以使用 [文字]{颜色代码} 的格式来输出彩色文字，例如：[红色字]{#ff0000} 或 [蓝色字]{blue}。";
        const now = new Date(); fsp += `\n\n[系统信息] 当前时间是：${now.toLocaleString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'})}（北京时间）。你可以根据时间调整你的语气和回答内容。`;
        
        // 注入世界书逻辑
        if (wbName && worldbooks[wbName] && worldbooks[wbName].entries) {
            const wb = worldbooks[wbName];
            const entries = Object.values(wb.entries);
            if (entries.length > 0) {
                // 取最近 8 条消息作为触发上下文 (4轮对话)
                const recentMessages = chatHistory.slice(-8);
                const recentText = recentMessages.map(m => {
                    if (typeof m.content === 'string') return m.content;
                    if (Array.isArray(m.content)) return m.content.find(i=>i.type==='text')?.text || '';
                    return '';
                }).join('\n').toLowerCase();
                
                const matchedEntries = [];
                entries.forEach(entry => {
                    if (entry.constant) {
                        matchedEntries.push(entry);
                        return;
                    }
                    if (entry.keys && Array.isArray(entry.keys)) {
                        const isMatch = entry.keys.some(key => recentText.includes(key.toLowerCase()));
                        if (isMatch) matchedEntries.push(entry);
                    }
                });
                
                if (matchedEntries.length > 0) {
                    matchedEntries.sort((a, b) => (a.order || 100) - (b.order || 100));
                    fsp += `\n\n[世界书设定]`;
                    matchedEntries.forEach(entry => {
                        if (entry.constant) {
                            fsp += `\n恒生效条目匹配：\n${entry.content}`;
                        } else {
                            // 找出命中的具体 trigger
                            const matchedKeys = entry.keys.filter(key => recentText.includes(key.toLowerCase()));
                            fsp += `\n触发词 "${matchedKeys.join(', ')}" 匹配：\n${entry.content}`;
                        }
                    });
                }
            }
        }
        
        return fsp;
    }

    function rebuildChatHistoryFromDOM() {
        const messages = [];
        messages.push({ role: "system", content: buildSystemPrompt() });
        document.querySelectorAll('.message-list .message').forEach(el => {
            const b = el.querySelector('.message-bubble'); if (!b || b.querySelector('.typing-indicator')) return;
            const rc = b.getAttribute('data-raw-content'); let c = rc ? decodeURIComponent(rc) : b.innerText.trim();
            if (!c) return;
            if (el.classList.contains('sent')) messages.push({ role: "user", content: c });
            else if (el.classList.contains('received')) messages.push({ role: "assistant", content: c });
        });
        return messages;
    }

    function searchKnowledgeBase(query, characterId) {
        return new Promise((resolve) => {
            if (!db) { resolve([]); return; }
            const tx = db.transaction(['documents'], 'readonly'); const st = tx.objectStore('documents'); const ix = st.index('characterId'); const req = ix.getAll(characterId);
            req.onsuccess = () => { const chunks = req.result; if (chunks.length===0) { resolve([]); return; }
                const bw = query.toLowerCase().split(/[\s,.;!?，。！？、]+/); let ws = new Set();
                function processChinese(str, s) { for (let i=0;i<str.length;i++)s.add(str[i]); for (let i=0;i<str.length-1;i++)s.add(str[i]+str[i+1]); if(str.length>2)s.add(str); }
                bw.forEach(w => { if (!w) return; ws.add(w); let cc = ""; for (let i=0;i<w.length;i++){const ch=w[i];if(ch>='\u4e00'&&ch<='\u9fa5')cc+=ch;else{if(cc.length>0){processChinese(cc,ws);cc="";}}} if(cc.length>0)processChinese(cc,ws); });
                const vw = Array.from(ws).filter(w => { if(/^\d+$/.test(w)) return false; if(!/[a-z\u4e00-\u9fa5]/i.test(w)) return false; if(/^[a-z]+$/i.test(w)&&w.length<2)return false; return true; });
                if (vw.length===0) { resolve([]); return; }
                const sc = chunks.map(c => { const cl = c.content.toLowerCase(); let s = 0; vw.forEach(w => { s += cl.split(w).length-1; }); return {...c,score:s}; });
                resolve(sc.filter(c=>c.score>0).sort((a,b)=>b.score-a.score).slice(0,3));
            };
            req.onerror = () => resolve([]);
        });
    }

    // ============ 13. 发送消息与流式回复 ============
    if (typeof marked !== 'undefined') {
        window.copyCode = function(btn) {
            const codeBlock = btn.closest('.code-block');
            const code = decodeURIComponent(codeBlock.getAttribute('data-code'));
            navigator.clipboard.writeText(code).then(() => {
                if(window.showToast) window.showToast('已复制代码');
            }).catch(() => {
                if(window.showToast) window.showToast('复制失败');
            });
        };

        window.toggleFullScreenCode = function(btn) {
            const codeBlock = btn.closest('.code-block');
            codeBlock.classList.toggle('fullscreen-mode');
            if (codeBlock.classList.contains('fullscreen-mode')) {
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3h3M21 8h-3V5M3 16h3v3M16 21v-3h3"></path></svg>`;
                btn.setAttribute('title', '退出全屏');
            } else {
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2-2h3"></path></svg>`;
                btn.setAttribute('title', '全屏');
            }
        };

        window.downloadCode = function(btn) {
            const codeBlock = btn.closest('.code-block');
            const code = decodeURIComponent(codeBlock.getAttribute('data-code'));
            let lang = codeBlock.getAttribute('data-lang').toLowerCase();
            const extMap = { 'javascript': 'js', 'python': 'py', 'typescript': 'ts', 'markdown': 'md', 'c++': 'cpp', 'c#': 'cs', 'ruby': 'rb', 'html': 'html', 'css': 'css', 'json': 'json', 'java': 'java', 'go': 'go', 'rust': 'rs', 'php': 'php', 'bash': 'sh', 'shell': 'sh' };
            const ext = extMap[lang] || lang || 'txt';
            const fileName = `code_${Date.now()}.${ext}`;
            const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = fileName;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            if(window.showToast) window.showToast('代码已下载');
        };

        window.runCode = function(btn) {
            const codeBlock = btn.closest('.code-block');
            const code = decodeURIComponent(codeBlock.getAttribute('data-code'));
            const lang = codeBlock.getAttribute('data-lang').toLowerCase();
            let htmlContent = code;
            if (lang === 'javascript' || lang === 'js') {
                htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>JS Run</title></head><body><script>${code}<\/script></body></html>`;
            } else if (lang === 'css') {
                htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${code}</style></head><body><div class="test-element"><h1>CSS 预览</h1><p>这是一个测试元素。</p></div></body></html>`;
            }
            let modal = document.getElementById('code-run-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'code-run-modal';
                modal.className = 'modal-overlay';
                modal.innerHTML = `
                    <div class="modal-container modal-lg" style="height: 90vh; max-width: 90vw; display: flex; flex-direction: column;">
                        <div class="modal-header">
                            <h2>运行预览</h2>
                            <button class="icon-btn close-run-modal-btn"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                        </div>
                        <div class="modal-content" style="flex: 1; padding: 0; background: white;">
                            <iframe id="code-run-iframe" style="width: 100%; height: 100%; border: none; background: white;" sandbox="allow-scripts allow-modals allow-popups allow-forms allow-same-origin"></iframe>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                modal.querySelector('.close-run-modal-btn').addEventListener('click', () => { modal.classList.remove('active'); document.getElementById('code-run-iframe').srcdoc = ''; });
                modal.addEventListener('click', (e) => { if (e.target === modal) { modal.classList.remove('active'); document.getElementById('code-run-iframe').srcdoc = ''; } });
            }
            document.getElementById('code-run-iframe').srcdoc = htmlContent;
            modal.classList.add('active');
        };

        const renderer = new marked.Renderer();
        renderer.code = function(code, language) {
            const lang = language || 'Code';
            const encodedCode = encodeURIComponent(code);
            const escapedCode = code.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"').replace(/'/g,'&#039;');
            const isRunnable = ['html', 'javascript', 'js', 'css'].includes(lang.toLowerCase());
            let runBtnHtml = isRunnable ? `<button class="action-btn" title="运行" onclick="runCode(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>` : '';
            return `<div class="code-block" data-code="${encodedCode}" data-lang="${lang}">
                        <div class="code-header">
                            <span class="code-lang">${lang}</span>
                            <div class="code-actions">
                                ${runBtnHtml}
                                <button class="action-btn" title="下载" onclick="downloadCode(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>
                                <button class="action-btn" title="全屏" onclick="toggleFullScreenCode(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2-2h3"></path></svg></button>
                                <button class="action-btn" title="复制" onclick="copyCode(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
                            </div>
                        </div>
                        <pre><code>${escapedCode}</code></pre>
                    </div>`;
        };
        marked.setOptions({ renderer, gfm: true, breaks: true, sanitize: false });
    }

    async function fetchAIResponse(tempSkillContent = null) {
        const savedConfigs = JSON.parse(localStorage.getItem('apiConfigs')||'[]');
        const ac = savedConfigs.find(c => c.isActive);
        if (!ac?.url || !ac?.model) { alert('请先在全局设置中添加、连接并激活一个完整的 API 配置（包含模型）！'); return; }
        const baseUrl = ac.url, apiKey = ac.key, model = ac.model;
        const chatUrl = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
        const webSearch = ac.webSearch||false, deepThink = ac.deepThink||false;

        const aiTimeString = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const aiMessageId = 'ai-msg-' + Date.now();
        const thinkingChainId = 'thinking-' + Date.now();
        const currentActiveItem = document.querySelector('.chat-item.active');
        const aiAvatarEl = currentActiveItem?.querySelector('.avatar');
        let aiAvatarHTML = '';
        if (aiAvatarEl?.style.backgroundImage) aiAvatarHTML = `<div class="avatar" style="background-image:${aiAvatarEl.style.backgroundImage};background-size:cover;background-position:center;"></div>`;
        else { const c = aiAvatarEl?.style.backgroundColor || '#10a37f'; const t = aiAvatarEl?.textContent || 'AI'; aiAvatarHTML = `<div class="avatar" style="background-color:${c};">${t}</div>`; }
        const aiName = currentActiveItem?.querySelector('.chat-name')?.textContent || 'Assistant';

        // message-dropdown-menu includes fork item
        const ddMenuHTML = `
            <div class="message-dropdown-menu">
                <button class="dropdown-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>重新生成</button>
                <button class="dropdown-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>编辑</button>
                <button class="dropdown-item fork-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>从此处分叉</button>
                <button class="dropdown-item delete-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>删除</button>
            </div>`;

        const aiMessageHTML = `<div class="message received">${aiAvatarHTML}<div class="message-content"><div class="message-author">${aiName} <span class="message-time">${aiTimeString}</span></div><div class="message-more-container"><button class="message-more-btn" title="更多选项"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg></button>${ddMenuHTML}</div><div class="thinking-chain" id="${thinkingChainId}" style="display:none;cursor:pointer;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 1-9 9"></path><polyline points="12 7 12 12 15 15"></polyline><path d="M8 4.5h.01M5 7.5h.01M3.5 11.5h.01" stroke-width="3"></path></svg><span class="thinking-status">正在思考...</span><svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg><div class="hidden-reasoning" style="display:none;"></div></div><div class="message-bubble" id="${aiMessageId}"><span class="typing-indicator" style="color:var(--text-tertiary);font-style:italic;">等待响应...</span></div><div class="message-actions"><button class="action-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button><button class="action-btn" title="播放"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"></path></svg></button><button class="action-btn" title="赞同"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg></button><button class="action-btn" title="反对"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg></button><button class="action-btn" title="重试"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg></button></div></div></div>`;
        messageList.insertAdjacentHTML('beforeend', aiMessageHTML);
        iosSmoothScrollToBottom(messageList);

        const aiBubble = document.getElementById(aiMessageId);
        const thinkingChainUI = document.getElementById(thinkingChainId);
        const thinkingStatus = thinkingChainUI.querySelector('.thinking-status');
        let fullReply = "", fullReasoning = "", isThinking = false;

        function getThinkingSummary(reasoning) {
            if (!reasoning) return "思考完成";
            const sentences = reasoning.split(/[。！？\n.!?]+/).filter(s => s.trim().length>0);
            if (sentences.length>0) { let s = sentences[sentences.length-1].trim(); if (s.length>30) s = s.substring(0,30)+'...'; return s; }
            return "思考完成";
        }

        try {
            const headers = { 'Content-Type': 'application/json' }; if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            let temperature = 0.8;
            const cts = document.getElementById('char-temp-slider'); const gts = document.querySelector('#tab-completion input[type="range"]');
            if (cts) temperature = parseFloat(cts.value); else if (gts) temperature = parseFloat(gts.value);
            
            const currentPreset = presets.find(x => x.id === currentPresetId);
            if (currentPreset) {
                if (currentPreset.temperature !== undefined) temperature = currentPreset.temperature;
            }

            // 构建发送给 API 的 messages 数组
            let apiMessages = JSON.parse(JSON.stringify(chatHistory));
            
            // 应用 Context Template
            if (currentPreset && currentPreset.context_template) {
                apiMessages.forEach(msg => {
                    if (msg.role !== 'system') {
                        if (typeof msg.content === 'string') {
                            msg.content = currentPreset.context_template.replace('{{text}}', msg.content);
                        } else if (Array.isArray(msg.content)) {
                            const textItem = msg.content.find(item => item.type === 'text');
                            if (textItem) {
                                textItem.text = currentPreset.context_template.replace('{{text}}', textItem.text);
                            }
                        }
                    }
                });
            }

            if (tempSkillContent && apiMessages.length > 0) {
                // 找到最后一条 user 消息，将技能内容注入到最前面
                for (let i = apiMessages.length - 1; i >= 0; i--) {
                    if (apiMessages[i].role === 'user') {
                        if (typeof apiMessages[i].content === 'string') {
                            apiMessages[i].content = tempSkillContent + apiMessages[i].content;
                        } else if (Array.isArray(apiMessages[i].content)) {
                            // 处理多模态数组格式
                            const textItem = apiMessages[i].content.find(item => item.type === 'text');
                            if (textItem) {
                                textItem.text = tempSkillContent + textItem.text;
                            } else {
                                apiMessages[i].content.unshift({ type: 'text', text: tempSkillContent });
                            }
                        }
                        break;
                    }
                }
            }

            const requestBody = { model, messages: apiMessages, temperature, stream: true };
            if (currentPreset && currentPreset.top_p !== undefined) requestBody.top_p = currentPreset.top_p;
            if (currentPreset && currentPreset.repetition_penalty !== undefined) requestBody.frequency_penalty = currentPreset.repetition_penalty;
            if (webSearch) requestBody.tools = [{ type: "web_search" }];
            if (deepThink) requestBody.reasoning_effort = "high";
            const response = await fetch(chatUrl, { method: 'POST', headers, body: JSON.stringify(requestBody) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            aiBubble.innerHTML = '';
            const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8");
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                const chunk = decoder.decode(value, { stream: true }); const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices?.[0]?.delta) {
                                const delta = data.choices[0].delta;
                                let isNearBottom = messageList.scrollHeight-messageList.scrollTop-messageList.clientHeight<100;
                                if (delta.reasoning_content) {
                                    if (!isThinking) { isThinking = true; thinkingChainUI.style.display = 'flex'; aiBubble.innerHTML = ''; }
                                    fullReasoning += delta.reasoning_content;
                                    const ss = fullReasoning.length>15 ? fullReasoning.slice(-15).replace(/\n/g,' ')+'...' : fullReasoning.replace(/\n/g,' ');
                                    thinkingStatus.textContent = ss || '正在深入思考...';
                                    const hr = thinkingChainUI.querySelector('.hidden-reasoning'); if (hr) hr.textContent = fullReasoning;
                                    if (window.currentActiveThinkingId === thinkingChainId) { const sc = document.querySelector('#thinking-sheet .sheet-content'); if (sc) { const nb = sc.scrollHeight-sc.scrollTop-sc.clientHeight<50; sc.innerHTML = `<p style="white-space:pre-wrap;font-family:monospace;font-size:13px;">${fullReasoning}</p>`; if (nb) sc.scrollTop = sc.scrollHeight; } }
                                }
                                if (delta.content) {
                                    if (isThinking) { isThinking = false; thinkingStatus.textContent = getThinkingSummary(fullReasoning); }
                                    fullReply += delta.content;
                                    const pr = fullReply.replace(/\[(.*?)\]\{(.*?)\}/g, '<span style="color:$2;">$1</span>');
                                    if (typeof marked !== 'undefined') aiBubble.innerHTML = marked.parse(pr); else aiBubble.innerHTML = pr.replace(/\n/g,'<br>');
                                    aiBubble.setAttribute('data-raw-content', encodeURIComponent(fullReply));
                                }
                                if (isNearBottom) iosSmoothScrollToBottom(messageList);
                            }
                        } catch(e) {}
                    }
                }
            }
            if (isThinking) thinkingStatus.textContent = getThinkingSummary(fullReasoning);
            let ibn = messageList.scrollHeight-messageList.scrollTop-messageList.clientHeight<150;
            if (ibn) iosSmoothScrollToBottom(messageList);
            
            // --- 输出正则清洗 ---
            regexScripts.forEach(rs => {
                if (rs.enabled && rs.placement === 'output') {
                    try {
                        const re = new RegExp(rs.pattern, 'g');
                        fullReply = fullReply.replace(re, rs.replacement);
                    } catch(e) { console.error('正则表达式执行错误:', rs.name, e); }
                }
            });
            // 重新渲染清理后的 HTML
            const pr = fullReply.replace(/\[(.*?)\]\{(.*?)\}/g, '<span style="color:$2;">$1</span>');
            if (typeof marked !== 'undefined') aiBubble.innerHTML = marked.parse(pr); else aiBubble.innerHTML = pr.replace(/\n/g,'<br>');
            aiBubble.setAttribute('data-raw-content', encodeURIComponent(fullReply));

            chatHistory.push({ role: "assistant", content: fullReply }); saveCurrentSession();
        } catch (error) { console.error(error); aiBubble.innerHTML = `<span style="color:#dc2626;">请求失败: ${error.message}</span>`; saveCurrentSession(); }
    }

    window.downloadFile = function(element, fileName) {
        const bubble = element.closest('.message-bubble'); if (!bubble) return;
        const rc = decodeURIComponent(bubble.getAttribute('data-raw-content')||'');
        const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`【文件 ${escapeRegExp(fileName)} 内容如下】:\\n([\\s\\S]*?)(?:\\n\\n【文件|$)`);
        const match = rc.match(regex); let content = match ? match[1] : '';
        const blob = new Blob([content], { type: 'text/plain' }); const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    };

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, tag => ({'&':'&','<':'<','>':'>',"'":'&#39;','"':'"'}[tag]||tag));
    }

    async function sendMessage(customText = null) {
        let text = customText !== null ? customText : textarea.value.trim();

        // --- 输入正则清洗 ---
        regexScripts.forEach(rs => {
            if (rs.enabled && rs.placement === 'input') {
                try {
                    const re = new RegExp(rs.pattern, 'g');
                    text = text.replace(re, rs.replacement);
                } catch(e) { console.error('正则表达式执行错误:', rs.name, e); }
            }
        });
        
        // 提取并处理 Skills
        let tempSkillContent = null;
        
        if (!db) {
            console.log('[Skills] db 未初始化，等待...');
            await initDB();
        }
        
        const { found: skillsFound, notFound: skillsNotFound, strippedText } = await getActiveSkillsFromText(text);
        text = strippedText;

        if (skillsNotFound.length > 0) {
            showToast(`手动触发技能不存在: ${skillsNotFound.join(', ')}`);
        }

        if (skillsFound.length > 0) {
            tempSkillContent = '';
            skillsFound.forEach(skill => {
                tempSkillContent += `[已启用技能: ${skill.name}]\n${skill.content}\n\n`;
            });
        }

        let attachmentMarkdown = '', imageAttachments = [];
        if (pendingAttachments.length > 0) {
            pendingAttachments.forEach(att => { if (att.type==='image') { attachmentMarkdown += `![${att.name}](${att.dataUrl})\n\n`; imageAttachments.push(att); } else { attachmentMarkdown += `[FILE:${att.name}]\n\n`; text += `\n\n【文件 ${att.name} 内容如下】:\n${att.content}\n`; } });
            pendingAttachments = []; renderAttachmentPreview();
        }
        if (!text && !attachmentMarkdown) return;
        const now = new Date(); const timeString = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        let safeText = escapeHTML(text);
        let processedText = safeText.replace(/\[(.*?)\]\{(.*?)\}/g, '<span style="color:$2;">$1</span>');
        let fullContentToRender = attachmentMarkdown + processedText;
        let displayHTML = fullContentToRender.replace(/\n/g, '<br>');
        if (typeof marked !== 'undefined') displayHTML = marked.parse(fullContentToRender);
        displayHTML = displayHTML.replace(/\[FILE:(.*?)\]/g, '<div class="file-attachment-bubble" onclick="downloadFile(this,\'$1\')" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;margin:4px 0;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg><span style="color:var(--accent-primary);text-decoration:underline;">$1</span></div>');
        let finalDisplayHTML = displayHTML, finalRawContent = text;
        if (imageAttachments.length > 0) finalRawContent += '\n\n[用户发送了一张图片]';
        if (currentQuoteText) { finalDisplayHTML = `<div class="message-quote-block">${currentQuoteText}</div>` + displayHTML; finalRawContent = `> ${currentQuoteText.replace(/\n/g, '\n> ')}\n\n${finalRawContent}`; }
        messageList.insertAdjacentHTML('beforeend', `<div class="message sent"><div class="avatar" style="background-color:#8b5cf6;">U</div><div class="message-content"><div class="message-author">You <span class="message-time">${timeString}</span></div><div class="message-bubble" data-raw-content="${encodeURIComponent(finalRawContent)}">${finalDisplayHTML}</div></div></div>`);
        if (customText === null) { textarea.value = ''; textarea.style.height = 'auto'; currentQuoteText = ''; if (quotePreviewBox) { quotePreviewBox.style.display = 'none'; if (quotePreviewText) quotePreviewText.textContent = ''; } }
        iosSmoothScrollToBottom(messageList);

        const finalSystemPrompt = buildSystemPrompt();
        if (chatHistory.length===0 || chatHistory[0].role!=='system') chatHistory.unshift({ role:"system", content:finalSystemPrompt });
        else chatHistory[0].content = finalSystemPrompt;

        let finalApiText = text;
        try { const kbr = await searchKnowledgeBase(text, currentChatId); if (kbr?.length>0) { let kc = "[知识库参考资料]\n"; kbr.forEach(r => kc += `【${r.fileName}】\n${r.content}\n\n`); finalApiText = kc + text; } } catch(err){}
        const sc = JSON.parse(localStorage.getItem('apiConfigs')||'[]'); const ac = sc.find(c=>c.isActive); const sv = ac ? (ac.vision||false) : false;
        let apiContent = finalApiText;
        if (imageAttachments.length>0) { if (sv) { apiContent = [{type:"text",text:finalApiText}]; imageAttachments.forEach(a=>apiContent.push({type:"image_url",image_url:{url:a.dataUrl}})); } else { imageAttachments.forEach(()=>apiContent+='\n\n[用户发送了一张图片]'); } }
        chatHistory.push({ role:"user", content:apiContent }); saveCurrentSession();
        await fetchAIResponse(tempSkillContent);
        if (imageAttachments.length>0 && sv) { for (let i=chatHistory.length-1;i>=0;i--) { if (chatHistory[i].role==='user' && Array.isArray(chatHistory[i].content)) { let tc = finalApiText; imageAttachments.forEach(()=>tc+='\n\n[用户发送了一张图片]'); chatHistory[i].content = tc; saveCurrentSession(); break; } } }
    }

    const sendBtn = document.querySelector('.send-btn-black');
    sendBtn.addEventListener('click', () => sendMessage());
    textarea.addEventListener('keydown', (e) => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

    // ============ 14. 消息菜单逻辑（包含分叉处理） ============
    const contextMenu = document.getElementById('context-menu');
    const deleteConfirmModal = document.getElementById('delete-confirm-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const createBranchModal = document.getElementById('create-branch-modal');
    const confirmCreateBranchBtn = document.getElementById('confirm-create-branch-btn');
    const newBranchNameInput = document.getElementById('new-branch-name');
    let currentTargetMessage = null, longPressTimer = null, isLongPressTriggered = false;

    function hideAllMenus() { if (contextMenu) { contextMenu.classList.remove('active'); contextMenu.style.display = 'none'; } currentTargetMessage = null; }

    function showContextMenu(x, y, messageEl, isMobile = false) {
        if (!contextMenu) return; currentTargetMessage = messageEl;
        const mw = 160, mh = 160; // 使用固定值，避免 display: flex 时触发强制回流导致高宽计算错乱卡屏边缘
        const ww = window.innerWidth, wh = window.innerHeight;
        let px, py;
        if (isMobile) { 
            px = x - (mw/2); 
            py = y + 12; 
        } else { 
            px = x + 8; 
            py = y - (mh/2); 
        }
        if (px<10) px=10; if (px+mw>ww-10) px=ww-mw-10; 
        if (py<10) py=10; if (py+mh>wh-10) py=wh-mh-10;
        
        contextMenu.style.left = `${px}px`; contextMenu.style.top = `${py}px`;
        contextMenu.style.display = 'flex'; contextMenu.classList.add('active');
    }

    document.addEventListener('contextmenu', (e) => { 
        const b = e.target.closest('.message-bubble'); 
        if (b) {
            e.preventDefault();
            if (window.innerWidth>1024) showContextMenu(e.clientX,e.clientY,b.closest('.message'),false);
        } else if (window.innerWidth>1024) {
            hideAllMenus(); 
        }
    });
    document.addEventListener('touchstart', (e) => { 
        if (contextMenu && contextMenu.classList.contains('active') && !e.target.closest('.context-menu')) { hideAllMenus(); }
        const b = e.target.closest('.message-bubble'); 
        if (b && window.innerWidth<=1024) { 
            isLongPressTriggered = false; 
            longPressTimer = setTimeout(() => { 
                isLongPressTriggered = true; 
                showContextMenu(e.touches[0].clientX,e.touches[0].clientY,b.closest('.message'),true); 
                if (navigator.vibrate) navigator.vibrate(50); 
            }, 500); 
        } 
    });
    document.addEventListener('touchend', (e) => { 
        if (longPressTimer) clearTimeout(longPressTimer); 
        if (isLongPressTriggered) {
            if (e.cancelable) e.preventDefault();
            setTimeout(() => { isLongPressTriggered = false; }, 10);
        }
    });
    document.addEventListener('touchmove', () => { 
        if (longPressTimer) clearTimeout(longPressTimer); 
        isLongPressTriggered = false;
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.context-menu') && !e.target.closest('.modal-overlay')) hideAllMenus(); });

    function handleMenuAction(action) {
        if (!currentTargetMessage) return;
        const bubble = currentTargetMessage.querySelector('.message-bubble');
        const textContent = bubble ? bubble.innerText : '';
        switch (action) {
            case 'copy': navigator.clipboard.writeText(textContent).then(()=>showToast('已复制')).catch(()=>showToast('复制失败')); break;
            case 'delete': if (deleteConfirmModal) deleteConfirmModal.classList.add('active'); break;
            case 'share': if (navigator.share) navigator.share({title:'分享消息',text:textContent}).catch(console.error); else { navigator.clipboard.writeText(textContent); showToast('已复制，可去粘贴分享'); } break;
            case 'edit':
                const oh = bubble.innerHTML;
                bubble.innerHTML = `<textarea class="edit-textarea" style="width:100%;min-height:60px;background:transparent;border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:8px;color:inherit;font-family:inherit;resize:vertical;outline:none;">${textContent}</textarea><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;"><button class="secondary-btn cancel-edit-btn" style="padding:4px 12px;font-size:12px;">取消</button><button class="primary-btn save-edit-btn" style="padding:4px 12px;font-size:12px;width:auto;">保存</button></div>`;
                const et = bubble.querySelector('.edit-textarea'); et.focus();
                bubble.querySelector('.cancel-edit-btn').addEventListener('click', () => { bubble.innerHTML = oh; });
                bubble.querySelector('.save-edit-btn').addEventListener('click', () => { const nt = et.value.trim(); if (!nt) return; const pt = nt.replace(/\[(.*?)\]\{(.*?)\}/g,'<span style="color:$2;">$1</span>'); bubble.innerHTML = typeof marked!=='undefined'?marked.parse(pt):pt.replace(/\n/g,'<br>'); bubble.setAttribute('data-raw-content',encodeURIComponent(nt)); saveCurrentSession(); showToast('已保存修改'); });
                break;
            case 'fork':
                if (createBranchModal && newBranchNameInput) {
                    newBranchNameInput.value = '';
                    createBranchModal.classList.add('active');
                    newBranchNameInput.focus();
                }
                break;
        }
        if (action !== 'delete' && action !== 'fork') hideAllMenus();
        else if (action === 'fork') {
            if (contextMenu) { contextMenu.classList.remove('active'); contextMenu.style.display = 'none'; }
            document.querySelectorAll('.message-dropdown-menu.active').forEach(m=>{m.classList.remove('active');m.style.display='';});
        }
    }

    document.getElementById('cm-edit')?.addEventListener('click', () => handleMenuAction('edit'));
    document.getElementById('cm-copy')?.addEventListener('click', () => handleMenuAction('copy'));
    document.getElementById('cm-share')?.addEventListener('click', () => handleMenuAction('share'));
    document.getElementById('cm-delete')?.addEventListener('click', () => handleMenuAction('delete'));

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', () => { if (currentTargetMessage) { currentTargetMessage.remove(); saveCurrentSession(); showToast('消息已删除'); } if (deleteConfirmModal) deleteConfirmModal.classList.remove('active'); hideAllMenus(); });
    }

    if (confirmCreateBranchBtn && newBranchNameInput && createBranchModal) {
        confirmCreateBranchBtn.addEventListener('click', () => {
            const branchName = newBranchNameInput.value.trim();
            if (!branchName) { showToast('请输入分支名称'); return; }
            if (currentTargetMessage) {
                forkBranchFromMessage(currentTargetMessage, branchName);
                createBranchModal.classList.remove('active');
            }
        });
    }

    // ============ 15. 附件与语音 ============
    const attachBtn = document.querySelector('.attach-btn');
    const attachmentMenu = document.getElementById('attachment-menu');
    const voiceBtn = document.querySelector('.input-actions-right .icon-btn[title="语音输入"]');
    const voiceOverlay = document.getElementById('voice-recording-overlay');
    const attachmentPreviewArea = document.getElementById('attachment-preview-area');
    let pendingAttachments = [];

    function renderAttachmentPreview() {
        if (!attachmentPreviewArea) return; attachmentPreviewArea.innerHTML = '';
        if (pendingAttachments.length===0) { attachmentPreviewArea.style.display='none'; return; }
        attachmentPreviewArea.style.display='flex';
        pendingAttachments.forEach((att,i) => {
            const item = document.createElement('div'); item.className = 'attachment-preview-item';
            let ih = att.type==='image' ? `<img src="${att.dataUrl}" alt="preview">` : `<div class="file-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg></div>`;
            item.innerHTML = `${ih}<span title="${att.name}">${att.name}</span><button class="remove-btn" data-index="${i}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
            item.querySelector('.remove-btn').addEventListener('click',(e)=>{e.stopPropagation();pendingAttachments.splice(i,1);renderAttachmentPreview();});
            attachmentPreviewArea.appendChild(item);
        });
    }

    const cancelVoiceBtn = document.getElementById('cancel-voice-btn');
    const finishVoiceBtn = document.getElementById('finish-voice-btn');

    if (attachBtn && attachmentMenu) {
        attachBtn.addEventListener('click', (e) => { e.stopPropagation(); attachmentMenu.classList.toggle('active'); });
        document.addEventListener('click', (e) => { if (!e.target.closest('.attachment-menu') && !e.target.closest('.attach-btn')) attachmentMenu.classList.remove('active'); });
        const ais = document.getElementById('attach-image-input'), afs = document.getElementById('attach-file-input'), acs = document.getElementById('attach-camera-input');
        attachmentMenu.querySelectorAll('.attachment-item').forEach(item => { item.addEventListener('click', () => { const t = item.querySelector('span').textContent; attachmentMenu.classList.remove('active'); if (t==='图片'&&ais) ais.click(); else if (t==='文件'&&afs) afs.click(); else if (t==='拍照'&&acs) acs.click(); }); });
        function handleAttachmentSelection(e, type) { const files = e.target.files; if (!files?.length) return; Array.from(files).forEach(file => { if (type==='image'||type==='camera') { const r = new FileReader(); r.onload=(ev)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');const MW=800,MH=800;let w=img.width,h=img.height;if(w>h){if(w>MW){h*=MW/w;w=MW;}}else{if(h>MH){w*=MH/h;h=MH;}}c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);pendingAttachments.push({type:'image',file,dataUrl:c.toDataURL('image/jpeg',0.7),name:file.name});renderAttachmentPreview();};img.src=ev.target.result;};r.readAsDataURL(file);} else { const r = new FileReader(); r.onload=(ev)=>{pendingAttachments.push({type:'file',file,content:ev.target.result,name:file.name});renderAttachmentPreview();};r.readAsText(file);} }); e.target.value=''; }
        if (ais) ais.addEventListener('change', (e) => handleAttachmentSelection(e,'image'));
        if (afs) afs.addEventListener('change', (e) => handleAttachmentSelection(e,'file'));
        if (acs) acs.addEventListener('change', (e) => handleAttachmentSelection(e,'camera'));
    }

    let speechRecognition = null, voiceTranscript = '', isRecording = false;
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    function initSpeechRecognition() { if (!SpeechRecognitionAPI) return null; const sr = new SpeechRecognitionAPI(); sr.continuous=true;sr.interimResults=true;sr.lang='zh-CN'; sr.onstart=()=>{isRecording=true;voiceTranscript='';updateVoiceStatus('正在聆听...');}; sr.onresult=(e)=>{let it='',ft='';for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)ft+=e.results[i][0].transcript;else it+=e.results[i][0].transcript;}voiceTranscript+=ft;updateVoiceTranscript(voiceTranscript+it);}; sr.onerror=(e)=>{isRecording=false;let m='语音识别出错';switch(e.error){case'no-speech':m='未检测到语音';break;case'aborted':return;case'audio-capture':m='无法访问麦克风';break;case'not-allowed':m='请允许麦克风权限';break;case'network':m='网络错误';break;}updateVoiceStatus(m);showToast(m);}; sr.onend=()=>{isRecording=false;if(voiceOverlay.classList.contains('active')&&!voiceTranscript)updateVoiceStatus('点击麦克风开始说话');}; return sr; }
    function updateVoiceStatus(t) { const s = voiceOverlay.querySelector('.voice-status'); if (s) s.textContent = t; }
    function updateVoiceTranscript(t) { let te = voiceOverlay.querySelector('.voice-transcript'); if (!te) { te = document.createElement('div'); te.className='voice-transcript'; te.style.cssText='margin-top:12px;padding:12px 16px;background:rgba(255,255,255,0.1);border-radius:12px;max-width:280px;max-height:120px;overflow-y:auto;font-size:15px;line-height:1.5;color:white;text-align:center;word-break:break-word;'; const s = voiceOverlay.querySelector('.voice-status'); if (s) s.after(te); } te.textContent = t||'...'; }
    function clearVoiceTranscript() { const te = voiceOverlay.querySelector('.voice-transcript'); if (te) te.remove(); }

    if (voiceBtn && voiceOverlay) {
        voiceBtn.addEventListener('click', () => { if (!SpeechRecognitionAPI) { showToast('不支持语音输入'); return; } if (!speechRecognition) speechRecognition=initSpeechRecognition(); voiceTranscript='';clearVoiceTranscript();voiceOverlay.classList.add('active'); try{speechRecognition.start();}catch(e){try{speechRecognition.stop();setTimeout(()=>speechRecognition.start(),100);}catch(err){showToast('无法启动语音识别');}} });
        if (cancelVoiceBtn) cancelVoiceBtn.addEventListener('click', () => { if (speechRecognition&&isRecording) try{speechRecognition.stop();}catch(e){} voiceOverlay.classList.remove('active'); clearVoiceTranscript(); showToast('已取消录音'); });
        if (finishVoiceBtn) finishVoiceBtn.addEventListener('click', () => { if (speechRecognition&&isRecording) try{speechRecognition.stop();}catch(e){} voiceOverlay.classList.remove('active'); const ft = voiceTranscript.trim(); if (ft) { const ta = document.querySelector('.input-wrapper textarea'); if (ta) { ta.value = ft; ta.focus(); ta.dispatchEvent(new Event('input')); } showToast('语音已转文字'); } else showToast('未识别到语音'); clearVoiceTranscript(); });
    }

    // ============ 16. AI气泡操作栏 & 内联菜单（含分叉处理） ============
    messageList.addEventListener('click', async (e) => {
        const moreBtn = e.target.closest('.message-more-btn');
        if (moreBtn) { const menu = moreBtn.nextElementSibling; if (menu?.classList.contains('message-dropdown-menu')) { document.querySelectorAll('.message-dropdown-menu.active').forEach(m=>{if(m!==menu)m.classList.remove('active');}); menu.classList.toggle('active'); menu.style.display = menu.classList.contains('active')?'block':''; } return; }

        const dropdownItem = e.target.closest('.dropdown-item');
        if (dropdownItem) {
            const messageEl = dropdownItem.closest('.message');
            const text = dropdownItem.textContent.trim();
            const menu = dropdownItem.closest('.message-dropdown-menu'); menu.classList.remove('active'); menu.style.display = '';
            currentTargetMessage = messageEl;
            if (text.includes('重新生成')) { const rb = messageEl.querySelector('.action-btn[title="重试"]'); if (rb) rb.click(); }
            else if (text.includes('编辑')) handleMenuAction('edit');
            else if (text.includes('删除')) handleMenuAction('delete');
            else if (text.includes('从此处分叉')) { e.stopPropagation(); handleMenuAction('fork'); }
            return;
        }

        if (!e.target.closest('.message-more-container')) { document.querySelectorAll('.message-dropdown-menu.active').forEach(m=>{m.classList.remove('active');m.style.display='';}); }

        const actionBtn = e.target.closest('.action-btn'); 
        if (!actionBtn) return;

        if (actionBtn.closest('.code-actions')) {
            const title = actionBtn.getAttribute('title');
            if (title === '复制') window.copyCode(actionBtn);
            else if (title === '全屏' || title === '退出全屏') window.toggleFullScreenCode(actionBtn);
            else if (title === '下载') window.downloadCode(actionBtn);
            else if (title === '运行') window.runCode(actionBtn);
            return;
        }

        const messageEl = actionBtn.closest('.message'); if (!messageEl) return;
        const bubble = messageEl.querySelector('.message-bubble');
        const textContent = bubble ? bubble.innerText : '';
        const title = actionBtn.getAttribute('title');

        if (title==='复制') { navigator.clipboard.writeText(textContent).then(()=>showToast('已复制')).catch(()=>showToast('复制失败')); }
        else if (title==='引用') { const ta = document.querySelector('.input-wrapper textarea'); if (ta && quotePreviewBox && quotePreviewText) { currentQuoteText=textContent; quotePreviewText.textContent=textContent; quotePreviewBox.style.display='flex'; ta.focus(); showToast('已添加引用'); } }
        else if (title==='播放'||title==='停止播放') {
            if (window.currentUtterance && window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); actionBtn.setAttribute('title','播放'); actionBtn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"></path></svg>'; actionBtn.style.color=''; return; }
            if (!window.speechSynthesis) { showToast('不支持语音播报'); return; }
            window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(textContent); u.lang='zh-CN'; window.currentUtterance=u;
            u.onstart=()=>{actionBtn.setAttribute('title','停止播放');actionBtn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';actionBtn.style.color='var(--accent-primary)';};
            u.onend=()=>{actionBtn.setAttribute('title','播放');actionBtn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"></path></svg>';actionBtn.style.color='';};
            u.onerror=()=>{actionBtn.setAttribute('title','播放');actionBtn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"></path></svg>';actionBtn.style.color='';showToast('播报出错');};
            window.speechSynthesis.speak(u);
        }
        else if (title==='赞同') { actionBtn.classList.toggle('active'); if (actionBtn.classList.contains('active')) { actionBtn.style.color='#10b981'; showToast('已提交反馈'); const db=actionBtn.parentElement.querySelector('[title="反对"]');if(db){db.classList.remove('active');db.style.color='';} } else actionBtn.style.color=''; saveCurrentSession(); }
        else if (title==='反对') { actionBtn.classList.toggle('active'); if (actionBtn.classList.contains('active')) { actionBtn.style.color='#dc2626'; showToast('已提交反馈'); const lb=actionBtn.parentElement.querySelector('[title="赞同"]');if(lb){lb.classList.remove('active');lb.style.color='';} } else actionBtn.style.color=''; saveCurrentSession(); }
        else if (title==='重试') { 
            let ns = messageEl.nextElementSibling; 
            while (ns) { const tr = ns; ns = ns.nextElementSibling; tr.remove(); } 
            messageEl.remove(); 
            chatHistory = rebuildChatHistoryFromDOM(); 
            saveCurrentSession(); 
            if (chatHistory.length>0 && chatHistory[chatHistory.length-1].role==='user') { 
                showToast('正在重新生成...'); 
                
                // 重新生成时也需要解析技能
                let tempSkillContent = null;
                const lastUserMsg = chatHistory[chatHistory.length-1].content;
                let textToParse = typeof lastUserMsg === 'string' ? lastUserMsg : (Array.isArray(lastUserMsg) ? lastUserMsg.find(i=>i.type==='text')?.text || '' : '');
                
                if (!db) {
                    console.log('[Skills] db 未初始化，等待...');
                    await initDB();
                }
                
                const { found: skillsFound } = await getActiveSkillsFromText(textToParse);
                if (skillsFound.length > 0) {
                    tempSkillContent = '';
                    skillsFound.forEach(skill => {
                        tempSkillContent += `[已启用技能: ${skill.name}]\n${skill.content}\n\n`;
                    });
                    
                    const skillRegex = /\$([a-zA-Z0-9_\-\u4e00-\u9fa5]+)/g;
                    if (typeof chatHistory[chatHistory.length-1].content === 'string') {
                        chatHistory[chatHistory.length-1].content = chatHistory[chatHistory.length-1].content.replace(skillRegex, '').trim();
                    } else if (Array.isArray(chatHistory[chatHistory.length-1].content)) {
                        const textItem = chatHistory[chatHistory.length-1].content.find(i=>i.type==='text');
                        if (textItem) textItem.text = textItem.text.replace(skillRegex, '').trim();
                    }
                    saveCurrentSession();
                }
                fetchAIResponse(tempSkillContent);
            } else {
                showToast('无法重试'); 
            }
        }
    });

    // 17. 头像上传
    const avatarUploadInput = document.getElementById('avatar-upload-input');
    const avatarCropModal = document.getElementById('avatar-crop-modal');
    const cropImage = document.getElementById('crop-image');
    const confirmCropBtn = document.getElementById('confirm-crop-btn');
    const charAvatarLarge = document.querySelector('.character-avatar-large');
    let cropState = { scale: 1, x: 0, y: 0, startX: 0, startY: 0, isDragging: false, minScale: 0.1 };

    if (charAvatarLarge && avatarUploadInput) {
        charAvatarLarge.addEventListener('click', () => avatarUploadInput.click());
        avatarUploadInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload=(ev)=>{cropImage.src=ev.target.result;cropImage.onload=()=>{const cs=300,crs=200;const sx=crs/cropImage.naturalWidth,sy=crs/cropImage.naturalHeight;cropState.minScale=Math.max(sx,sy);cropState.scale=cropState.minScale;cropState.x=(cs-cropImage.naturalWidth*cropState.scale)/2;cropState.y=(cs-cropImage.naturalHeight*cropState.scale)/2;updateCropImageTransform();avatarCropModal.classList.add('active');};};r.readAsDataURL(f);} e.target.value=''; });
    }

    function updateCropImageTransform() { if (cropImage) cropImage.style.transform = `translate(${cropState.x}px,${cropState.y}px) scale(${cropState.scale})`; }
    if (cropImage) {
        cropImage.addEventListener('mousedown', startDrag); cropImage.addEventListener('touchstart', (e) => startDrag(e.touches[0]), { passive: false });
        document.addEventListener('mousemove', drag); document.addEventListener('touchmove', (e) => { if (cropState.isDragging) { e.preventDefault(); drag(e.touches[0]); } }, { passive: false });
        document.addEventListener('mouseup', endDrag); document.addEventListener('touchend', endDrag);
        const cc = document.getElementById('crop-container'); if (cc) cc.addEventListener('wheel', (e) => { e.preventDefault(); const d=-e.deltaY*0.001; let ns=cropState.scale*(1+d); ns=Math.max(cropState.minScale,ns); const cs=300;const cx=cs/2,cy=cs/2;cropState.x=cx-(cx-cropState.x)*(ns/cropState.scale);cropState.y=cy-(cy-cropState.y)*(ns/cropState.scale);cropState.scale=ns;checkCropBounds();updateCropImageTransform(); }, { passive: false });
    }
    function startDrag(e) { cropState.isDragging=true;cropState.startX=e.clientX-cropState.x;cropState.startY=e.clientY-cropState.y; }
    function drag(e) { if(!cropState.isDragging)return;cropState.x=e.clientX-cropState.startX;cropState.y=e.clientY-cropState.startY;checkCropBounds();updateCropImageTransform(); }
    function endDrag() { cropState.isDragging=false; }
    function checkCropBounds() { const cs=300,crs=200,m=(cs-crs)/2;const iw=cropImage.naturalWidth*cropState.scale,ih=cropImage.naturalHeight*cropState.scale;if(cropState.x>m)cropState.x=m;if(cropState.x+iw<cs-m)cropState.x=cs-m-iw;if(cropState.y>m)cropState.y=m;if(cropState.y+ih<cs-m)cropState.y=cs-m-ih; }
    if (confirmCropBtn) {
        confirmCropBtn.addEventListener('click', () => { const c=document.createElement('canvas');const crs=200;c.width=crs;c.height=crs;const ctx=c.getContext('2d');const cs=300,m=(cs-crs)/2;const sx=(m-cropState.x)/cropState.scale,sy=(m-cropState.y)/cropState.scale,sw=crs/cropState.scale,sh=crs/cropState.scale;ctx.drawImage(cropImage,sx,sy,sw,sh,0,0,crs,crs);const b64=c.toDataURL('image/jpeg',0.9);if(chatSessions[currentChatId]){chatSessions[currentChatId].settings.avatarImage=b64;saveCurrentSession();updateAvatarUI(currentChatId,b64);avatarCropModal.classList.remove('active');showToast('头像已更新');} });
    }
    function updateAvatarUI(chatId, b64) { const s=chatSessions[chatId];if(!s)return;const cal=document.querySelector('.character-avatar-large');if(cal){if(b64){cal.innerHTML='';cal.style.backgroundImage=`url(${b64})`;cal.style.backgroundSize='cover';cal.style.backgroundPosition='center';cal.style.border='none';}else{cal.style.backgroundImage='';cal.style.border='1px dashed var(--border-color)';cal.innerHTML='<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';}}renderChatList();if(chatId===currentChatId){document.querySelectorAll('.message.received .avatar').forEach(a=>{if(b64){a.textContent='';a.style.backgroundImage=`url(${b64})`;a.style.backgroundSize='cover';a.style.backgroundPosition='center';}else{a.style.backgroundImage='';a.textContent=s.settings.avatarText;}});} }
});
