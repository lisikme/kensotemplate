// auth.js - единая система авторизации для всех страниц

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
    let authInitialized = false;
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
        // Сохраняем текущий URL перед переходом
        CookieManager.set('redirect_before_login', window.location.pathname + window.location.search, 1);
        window.location.href = window.location.origin + AUTH_PATH;
    }
    
    function logout() {
        CookieManager.delete('discord_user');
        CookieManager.delete('redirect_before_login');
        localStorage.removeItem('current_hwid');
        currentUser = null;
        // Перезагружаем страницу для обновления UI
        window.location.reload();
    }
    
    // Подписка на изменение состояния авторизации
    function onAuthChange(callback) {
        if (typeof callback === 'function') {
            authCallbacks.push(callback);
        }
    }
    
    function notifyAuthChange() {
        const isAuth = isAuthenticated();
        authCallbacks.forEach(callback => {
            try {
                callback(isAuth, currentUser);
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
    
    let cachedHwidInfo = null;
    
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
        if (cachedHwidInfo) return cachedHwidInfo;
        
        let hwid = localStorage.getItem('current_hwid');
        const discordUser = getCurrentUser();
        
        // Автоматический поиск HWID по Discord ID
        if (!hwid && discordUser?.id) {
            const discordData = await fetchJson(HWID_CONFIG.discordJsonUrl);
            const entry = discordData?.hwids?.find(e => String(e.DISCORD) === String(discordUser.id));
            if (entry) {
                hwid = entry.HWID;
                localStorage.setItem('current_hwid', hwid);
            }
        }
        
        if (!hwid) return null;
        
        // Загрузка всех данных параллельно
        const [admins, hwidList, temp, bans] = await Promise.all([
            fetchJson(HWID_CONFIG.adminsJsonUrl).then(d => d?.Admins || []),
            fetchJson(HWID_CONFIG.hwidJsonUrl).then(d => d?.["users:"] || d?.users || []),
            fetchJson(HWID_CONFIG.tempJsonUrl).then(d => d || {}),
            fetchJson(HWID_CONFIG.bansJsonUrl).then(d => d || {})
        ]);
        
        // Поиск Discord ID для роли
        const discordData = await fetchJson(HWID_CONFIG.discordJsonUrl);
        const userDiscordId = discordData?.hwids?.find(e => e.HWID === hwid)?.DISCORD || null;
        
        // Проверка бана
        const banInfo = bans[hwid];
        const isBanned = banInfo && (banInfo.ban_temp === "-1" || new Date(banInfo.ban_temp) > new Date());
        
        const role = getUserRole(userDiscordId, admins, isBanned);
        const endTs = parseDateToTimestamp(temp[hwid] || 0);
        const sub = getSubscriptionStatus(endTs);
        
        return cachedHwidInfo = { 
            hwid, 
            userDiscordId, 
            endTs, 
            isBanned, 
            role, 
            roleText: roleNames[role], 
            sub, 
            banReason: banInfo?.ban_reason 
        };
    }
    
    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    function init() {
        currentUser = getCurrentUser();
        authInitialized = true;
        notifyAuthChange();
        
        // Обработка возврата с /auth (если есть параметры в URL)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('auth_success') === '1') {
            // Очищаем параметр и обновляем данные
            window.history.replaceState({}, document.title, window.location.pathname);
            currentUser = getCurrentUser();
            notifyAuthChange();
            // Перезагружаем HWID информацию
            cachedHwidInfo = null;
            loadHwidInfo();
        }
    }
    
    // Экспорт в глобальное пространство
    window.KensoAuth = {
        getCurrentUser,
        isAuthenticated,
        login,
        logout,
        onAuthChange,
        loadHwidInfo,
        getHwidInfo: () => cachedHwidInfo,
        refreshHwid: () => { cachedHwidInfo = null; return loadHwidInfo(); }
    };
    
    // Автоматическая инициализация
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();