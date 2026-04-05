// header.js - единый компонент шапки для всех страниц

(function() {
    // ==================== КОНФИГУРАЦИЯ ====================
    const CLIENT_ID = '1488460305519476756';
    const AUTH_PATH = '/auth';
    
    // Cookie Manager
    const CookieManager = {
        set: (name, value, days = 7) => {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            document.cookie = `${name}=${JSON.stringify(value)};expires=${date.toUTCString()};path=/;SameSite=Lax`;
        },
        get: (name) => {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return JSON.parse(parts.pop().split(';').shift());
            return null;
        },
        delete: (name) => {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        }
    };
    
    // Состояние
    let currentUser = null;
    let currentHwidInfo = null;
    let authCallbacks = [];
    
    // ==================== ОСНОВНЫЕ ФУНКЦИИ ====================
    
    function getCurrentUser() {
        return CookieManager.get('discord_user');
    }
    
    function isAuthenticated() {
        const user = getCurrentUser();
        return user && user.id && user.username;
    }
    
    function login() {
        CookieManager.set('redirect_before_login', window.location.pathname + window.location.search, 1);
        window.location.href = window.location.origin + AUTH_PATH;
    }
    
    function logout() {
        CookieManager.delete('discord_user');
        CookieManager.delete('redirect_before_login');
        localStorage.removeItem('current_hwid');
        currentUser = null;
        currentHwidInfo = null;
        window.location.reload();
    }
    
    function onAuthChange(callback) {
        if (typeof callback === 'function') {
            authCallbacks.push(callback);
        }
    }
    
    function notifyAuthChange() {
        authCallbacks.forEach(callback => {
            try {
                callback(isAuthenticated(), currentUser);
            } catch(e) {}
        });
    }
    
    // ==================== HWID ЛОГИКА ====================
    const HWID_CONFIG = {
        adminsJsonUrl: 'https://lisikme.github.io/Nixware-allowed/admins.json',
        hwidJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/hwid4.json',
        tempJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/temps.json',
        discordJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/discords.json',
        bansJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/bans.json'
    };
    
    function addCacheBuster(url) {
        return url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    }
    
    async function fetchJson(url, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const res = await fetch(addCacheBuster(url));
                if (!res.ok) throw new Error();
                return await res.json();
            } catch { 
                if (i === retries - 1) return null; 
                await new Promise(r => setTimeout(r, 1000 * (i + 1))); 
            }
        }
    }
    
    function parseDateToTimestamp(dateString) {
        try {
            if (typeof dateString === 'number') return dateString;
            if (!dateString) return 0;
            return Math.floor(new Date(dateString).getTime() / 1000);
        } catch (e) { return 0; }
    }
    
    function getSubscriptionStatus(endTimestamp) {
        if (endTimestamp === 0) return { status: 'forever', text: 'Навсегда', daysLeft: null };
        const now = Math.floor(Date.now() / 1000);
        if (endTimestamp > now) {
            const daysLeft = Math.ceil((endTimestamp - now) / (60 * 60 * 24));
            return { status: 'active', text: daysLeft <= 7 ? `Осталось ${daysLeft} дн.` : 'Активна', daysLeft };
        }
        return { status: 'expired', text: 'Истекла', daysLeft: 0 };
    }
    
    function getUserRole(discordId, adminList, isBanned) {
        if (isBanned) return 'banned';
        if (discordId === '470573716711931905') return 'creator';
        if (discordId === '1393856315067203635') return 'bot';
        return adminList.includes(discordId) ? 'admin' : 'player';
    }
    
    const roleNames = { creator: 'Создатель', admin: 'Партнёр', bot: 'Менеджер', player: 'Игрок', banned: 'Забанен' };
    
    async function loadHwidInfo() {
        if (currentHwidInfo) return currentHwidInfo;
        
        let hwid = localStorage.getItem('current_hwid');
        const discordUser = getCurrentUser();
        
        if (!hwid && discordUser?.id) {
            const discordData = await fetchJson(HWID_CONFIG.discordJsonUrl);
            const entry = discordData?.hwids?.find(e => String(e.DISCORD) === String(discordUser.id));
            if (entry) {
                hwid = entry.HWID;
                localStorage.setItem('current_hwid', hwid);
            }
        }
        
        if (!hwid) return null;
        
        const [admins, hwidList, temp, bans] = await Promise.all([
            fetchJson(HWID_CONFIG.adminsJsonUrl).then(d => d?.Admins || []),
            fetchJson(HWID_CONFIG.hwidJsonUrl).then(d => d?.["users:"] || d?.users || []),
            fetchJson(HWID_CONFIG.tempJsonUrl).then(d => d || {}),
            fetchJson(HWID_CONFIG.bansJsonUrl).then(d => d || {})
        ]);
        
        const discordData = await fetchJson(HWID_CONFIG.discordJsonUrl);
        const userDiscordId = discordData?.hwids?.find(e => e.HWID === hwid)?.DISCORD || null;
        
        const banInfo = bans[hwid];
        const isBanned = banInfo && (banInfo.ban_temp === "-1" || new Date(banInfo.ban_temp) > new Date());
        
        const role = getUserRole(userDiscordId, admins, isBanned);
        const endTs = parseDateToTimestamp(temp[hwid] || 0);
        const sub = getSubscriptionStatus(endTs);
        
        currentHwidInfo = { 
            hwid, 
            userDiscordId, 
            endTs, 
            isBanned, 
            role, 
            roleText: roleNames[role], 
            sub, 
            banReason: banInfo?.ban_reason 
        };
        
        return currentHwidInfo;
    }
    
    // ==================== HTML ШАБЛОН ШАПКИ ====================
    function getHeaderHTML() {
        return `
<header class="site-header">
    <div class="header-container">
        <a href="/">
            <div style="display: flex; gap: 8px; align-items: center;">
                <img src="/logo.png" style="border: 1px solid #222; width: 35px; height: 35px; border-radius: 5px;" alt="Logo">
                <div class="logo">
                    <div class="site-name">KensoUltra+</div>
                    <span class="by-kelix">For nixware.cc - by Kelix.me</span>
                </div>
            </div>
        </a>
        
        <nav class="header-nav">
            <a href="https://vk.com/kensolua" class="nav-link social" target="_blank">
                <img src="/vk.svg" width="12" height="12" alt="VK">
            </a>
            <a href="https://discord.gg/5BM4XD3qxM" class="nav-link social" target="_blank">
                <img src="/discord.svg" width="12" height="12" alt="Discord">
            </a>
            
            <div class="nav-account">
                <div class="user-profile btn_login" id="kensoLoginBtn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M17 7L15.59 8.41L18.17 11H8V13H18.17L15.59 15.58L17 17L22 12L17 7ZM4 5H12V3H4C2.9 3 2 3.9 2 5V19C2 20.1 2.9 21 4 21H12V19H4V5Z" fill="currentColor"/>
                    </svg>
                    <div class="nav-bt-title">ВХОД</div>
                </div>
                <div class="user-profile btn_logout" id="kensoLogoutBtn" style="display: none;">
                    <div class="avatar-account"><img class="avatar" id="kensoAvatar" onerror="this.style.visibility = 'hidden'"></div>
                    <div>
                        <div class="nav-bt-title" id="kensoUsername">Гость</div>
                        <div class="nav-bt-title-hwid" id="kensoRoleBadge"></div>
                    </div>
                    <div class="context-menu" id="kensoContextMenu">
                        <div id="contextHwidInfo" class="context-menu-hwid">
                            <div class="hwid-loading">Загрузка информации...</div>
                        </div>
                        <div class="button-ctn">
                            <div class="context-menu-item profile-item" id="kensoProfileBtn">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                    <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill="currentColor"/>
                                </svg>
                                <span>Профиль</span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M9 18l6-6-6-6" stroke="currentColor" fill="none"/>
                                </svg>
                            </div>
                            <div class="context-menu-item logout-item" id="kensoLogoutMenuItem">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                    <path d="M17 7L15.59 8.41L18.17 11H8V13H18.17L15.59 15.58L17 17L22 12L17 7ZM4 5H12V3H4C2.9 3 2 3.9 2 5V19C2 20.1 2.9 21 4 21H12V19H4V5Z" fill="currentColor"/>
                                </svg>
                                <span>Выйти</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="context-menu-overlay" id="kensoContextOverlay"></div>
            </div>
        </nav>
    </div>
</header>

<style>
.site-header {
    position: fixed;
    background: rgba(0, 0, 0, 0.349);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid #303030;
    left: 0px;
    right: 0px;
    top: 0px;
    z-index: 1000;
    padding: 5px 20px;
}

.header-container {
    max-width: 1600px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.site-name {
    color: #d7fe7b;
    margin: 0;
    font-size: 18px;
    font-weight: 500;
    line-height: 25px;
    text-shadow: 0 0 10px rgba(215, 254, 123, 0.3);
}

.logo {
    display: flex;
    flex-direction: column;
}

.by-kelix {
    color: #ff7777;
    position: relative;
    font-size: 10px;
    top: -3px;
}

.header-nav {
    display: flex;
    gap: 5px;
    align-items: center;
}

.nav-link {
    font-size: 10px;
    display: flex;
    height: 26px;
    align-items: center;
    padding: 0px 5px;
    border-radius: 3px !important;
    gap: 5px;
    color: #efefef;
    text-decoration: none;
    transition: all 0.3s ease;
    background: #00000075;
    border: 1px solid #ffffff30;
}

.nav-link.social {
    justify-content: center;
    height: 26px;
    width: 26px;
    padding: 0px;
}

.nav-link:hover {
    color: #d7fe7b;
    background: rgba(215, 254, 123, 0.1);
}

/* Стили для аккаунта */
.nav-account {
    display: flex;
    align-items: center;
}

.user-profile {
    display: none;
    align-items: center;
    gap: 8px;
    height: 26px;
    background: #00000090;
    border: 1px solid #ffffff30;
    border-radius: 3px;
    cursor: pointer;
    position: relative;
}

.avatar-account {
    overflow: hidden;
    border-radius: 2px;
    height: 22px;
    aspect-ratio: 1/1;
    background: #181818;
}

.avatar {
    height: 100%;
    width: 100%;
    object-fit: cover;
}

.user-profile.btn_login {
    padding: 0px 6px;
}

.user-profile.btn_login > svg {
    fill: #000 !important;
    color: #000;
}

.user-profile.btn_login.active {
    gap: 2px;
    display: flex;
    background: #D7FE7B;
}

.user-profile.btn_login.active > .nav-bt-title {
    font-size: 16px;
    color: #000;
}

.user-profile.btn_logout {
    padding: 0;
    padding-left: 2px;
    padding-right: 8px;
}

.user-profile.btn_logout.active {
    display: flex;
}

.nav-bt-title {
    font-size: 10px;
    line-height: 10px;
    color: #ffffff;
}

.nav-bt-title-hwid {
    line-height: 10px;
    color: #a0a0a0;
    font-size: 10px;
    display: flex;
    gap: 3px;
}

/* Контекстное меню */
.context-menu {
    position: absolute;
    top: 100%;
    right: -1px;
    margin-top: 5px;
    background: #0a0a0a;
    border: 1px solid #333;
    backdrop-filter: blur(10px);
    border-radius: 3px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    display: none;
    overflow: hidden;
    min-width: 260px;
}

.context-menu.active {
    display: block;
    animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}

.context-menu-hwid {
    background: #0e0e0e;
    border-bottom: 1px solid #2a2a2a;
}

.hwid-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    padding: 4px 0;
    font-weight: 500;
    background: #000;
    justify-content: center;
    color: #d7fe7b;
    margin: 0;
    border-bottom: 1px solid #303030;
    text-align: center;
}

.hwid-code {
    background: #000000;
    border: 1px solid #6d6dff;
    color: #a6deff;
    padding: 4px 0px;
    border-radius: 3px;
    font-family: "Unbounded", sans-serif;
    text-align: center;
    word-break: break-all;
}

.hwid-status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    gap: 3px;
    background: #000;
    background: linear-gradient(135deg, rgba(50, 120, 255, 0.2), rgba(106, 17, 203, 0.2));
    border: 1px solid #6d6dff;
    padding: 2px 2px;
    border-radius: 3px;
    width: 100%;
    flex-direction: column;
}

.hwid-status .label {
    color: #bfc0ff;
}

.hwid-status .value {
    padding: 4px 0px;
    width: 100%;
    font-size: 8px;
    border-radius: 2px;
    background: #000000ce;
    text-align: center;
}

.hwid-status .value.active { color: #66ff66; }
.hwid-status .value.expired { color: #ff6666; }
.hwid-status .value.forever { color: #d7fe7b !important; }

.hwid-role {
    display: inline-block;
    padding: 4px 0px;
    width: 100%;
    text-align: center;
    border-radius: 2px;
    font-size: 8px;
    font-weight: 500;
    background: #05060C;
}

.hwid-role.creator { color: #FFB6E1; }
.hwid-role.admin { color: #FFB347; }
.hwid-role.bot { color: #61EDFF; }
.hwid-role.player { color: #A7FF54; }
.hwid-role.banned { color: #FF5454; }

.hwid-expire-bar {
    height: 1px;
    border-radius: 0px;
    margin-top: 2px;
    overflow: hidden;
    display: flex;
}

.hwid-expire-progress {
    height: 100%;
    background: #d7fe7b;
    transition: width 0.3s;
}

.context-menu-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    color: #fff;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.2s;
}

.context-menu-item:hover { background: #2a2a2a; }
.context-menu-item.profile-item { background: #000000; }
.context-menu-item.profile-item:hover { background: #0c0c0c; }
.context-menu-item.logout-item { color: #ff7c7c; }
.context-menu-item.logout-item:hover { background: #2a1a1a; }

.button-ctn {
    display: flex;
    flex-direction: row-reverse;
}

.button-ctn > div { width: 100%; }

.context-menu-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999;
    display: none;
}

.context-menu-overlay.active { display: block; }

.nav-bt-title-hwid.creator {
    background: linear-gradient(45deg, rgb(255, 90, 173), rgb(255, 182, 225));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    font-weight: 600;
}

.nav-bt-title-hwid.bot {
    background: linear-gradient(45deg, rgb(97, 237, 255), rgb(220, 250, 255));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    font-weight: 600;
}

.nav-bt-title-hwid.player {
    background: linear-gradient(45deg, rgb(46, 197, 41), rgb(167, 255, 84));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    font-weight: 600;
}

.nav-bt-title-hwid.banned {
    background: linear-gradient(45deg, rgb(255, 84, 84), rgb(255, 139, 139));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    font-weight: 600;
}

.hwid-info { padding: 5px; }
.hwid-info > #infr { display: flex; gap: 3px; margin-top: 3px; }
.hwid-loading { text-align: center; padding: 8px; font-size: 10px; color: #888; }

@media (max-width: 768px) {
    .site-header { padding: 5px 10px; }
    .header-nav { gap: 3px; }
}
</style>
        `;
    }
    
    // ==================== ИНИЦИАЛИЗАЦИЯ UI ====================
    let initialized = false;
    
    async function initHeaderUI() {
        if (initialized) return;
        initialized = true;
        
        const btnLogin = document.getElementById('kensoLoginBtn');
        const btnLogout = document.getElementById('kensoLogoutBtn');
        const avatar = document.getElementById('kensoAvatar');
        const usernameSpan = document.getElementById('kensoUsername');
        const roleBadge = document.getElementById('kensoRoleBadge');
        const contextMenu = document.getElementById('kensoContextMenu');
        const overlay = document.getElementById('kensoContextOverlay');
        const profileBtn = document.getElementById('kensoProfileBtn');
        const logoutMenuItem = document.getElementById('kensoLogoutMenuItem');
        const hwidContainer = document.getElementById('contextHwidInfo');
        
        function updateUI() {
            const user = getCurrentUser();
            const isAuth = isAuthenticated();
            
            if (btnLogin) btnLogin.classList.toggle('active', !isAuth);
            if (btnLogout) btnLogout.classList.toggle('active', isAuth);
            
            if (isAuth && user) {
                if (avatar) avatar.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
                if (usernameSpan) usernameSpan.textContent = user.username;
            } else {
                if (usernameSpan) usernameSpan.textContent = 'Гость';
                if (roleBadge) roleBadge.innerHTML = '';
            }
            
            refreshHwidInfo();
        }
        
        async function refreshHwidInfo() {
            if (!hwidContainer) return;
            
            hwidContainer.innerHTML = '<div class="hwid-loading">Загрузка...</div>';
            
            const info = await loadHwidInfo();
            currentHwidInfo = info;
            
            if (roleBadge) {
                if (info) {
                    roleBadge.classList.add(info.role);
                    roleBadge.innerHTML = info.roleText;
                } else {
                    roleBadge.innerHTML = '';
                }
            }
            
            if (!info) {
                hwidContainer.innerHTML = `
                    <div class="hwid-loading">
                        <div style="font-size: 10px; color: #ff6666;">HWID не привязан!</div>
                        <div style="font-size: 8px; margin-top: 4px;">Купите подписку!</div>
                    </div>`;
                return;
            }
            
            const progress = info.endTs === 0 ? 100 : info.sub.daysLeft ? Math.min(100, (info.sub.daysLeft / 30) * 100) : 0;
            
            hwidContainer.innerHTML = `
                <div class="hwid-header">
                    <span>Информация HWID</span>
                    ${info.isBanned ? '<span style="color: #ff6666;">BANNED</span>' : ''}
                </div>
                <div class="hwid-info">
                    <div class="hwid-code">${info.hwid}</div>
                    <div id="infr">
                        <div class="hwid-status">
                            <span class="label">Статус:</span>
                            <span class="value ${info.isBanned ? 'expired' : info.sub.status}">
                                ${info.isBanned ? 'Блок' : info.sub.text}
                            </span>
                        </div>
                        <div class="hwid-status">
                            <span class="label">Роль:</span>
                            <span class="hwid-role ${info.role}">${info.roleText}</span>
                        </div>
                    </div>
                </div>
                ${!info.isBanned ? `
                    <div class="hwid-expire-bar">
                        <div class="hwid-expire-progress" style="width: ${progress}%;"></div>
                    </div>` : `
                    <div class="hwid-status" style="margin-top: 5px;">
                        <span class="label">Причина:</span>
                        <span class="value" style="font-size: 9px; color: #ff8888;">
                            ${info.banReason || 'N/A'}
                        </span>
                    </div>
                `}
            `;
        }
        
        function toggleContextMenu(event) {
            event?.stopPropagation();
            if (isAuthenticated()) {
                contextMenu?.classList.toggle('active');
                overlay?.classList.toggle('active');
            }
        }
        
        function closeContextMenu() {
            contextMenu?.classList.remove('active');
            overlay?.classList.remove('active');
        }
        
        function openProfile() {
            if (currentHwidInfo?.hwid) {
                window.location.href = `/profile?hwid=${encodeURIComponent(currentHwidInfo.hwid)}`;
            }
        }
        
        // Назначаем обработчики
        if (btnLogin) btnLogin.onclick = () => login();
        if (btnLogout) btnLogout.onclick = toggleContextMenu;
        if (profileBtn) profileBtn.onclick = openProfile;
        if (logoutMenuItem) logoutMenuItem.onclick = () => logout();
        if (overlay) overlay.onclick = closeContextMenu;
        
        // Закрытие меню при клике вне
        document.addEventListener('click', (e) => {
            if (contextMenu?.classList.contains('active') && 
                !btnLogout?.contains(e.target) && 
                !contextMenu.contains(e.target)) {
                closeContextMenu();
            }
        });
        
        // Подписка на изменения
        onAuthChange(() => updateUI());
        
        // Первоначальное обновление
        updateUI();
        
        // Проверка параметра auth_success
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('auth_success') === '1') {
            window.history.replaceState({}, document.title, window.location.pathname);
            refreshHwidInfo();
        }
    }
    
    // ==================== ВСТАВКА ШАПКИ НА СТРАНИЦУ ====================
    function injectHeader() {
        // Проверяем, есть ли уже шапка
        if (document.querySelector('.site-header')) return;
        
        // Вставляем HTML шапки в начало body
        document.body.insertAdjacentHTML('afterbegin', getHeaderHTML());
        
        // Инициализируем UI после вставки
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initHeaderUI);
        } else {
            initHeaderUI();
        }
    }
    
    // Экспортируем API в глобальное пространство
    window.KensoHeader = {
        getCurrentUser,
        isAuthenticated,
        login,
        logout,
        loadHwidInfo,
        getHwidInfo: () => currentHwidInfo,
        refreshHwid: () => { currentHwidInfo = null; return loadHwidInfo(); }
    };
    
    // Автоматическая вставка шапки
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectHeader);
    } else {
        injectHeader();
    }
})();