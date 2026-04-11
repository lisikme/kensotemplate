// profile-data.js - универсальный модуль для работы с данными профиля
// Версия 4.0 - ПОЛНОСТЬЮ НА ТАБЛИЦЕ (без dis-api)

(function() {
    // ==================== КОНФИГУРАЦИЯ ====================
    const PROFILE_DATA_CONFIG = {
        // API для получения данных пользователей
        hwidApiUrl: 'https://hwid-api.fascord.workers.dev/1hYhAb_3EVcHmj7c8cgAjXMoF6HCqqjUeb9SSKXHs8TA?gid=834339051',
        // Настройки кэширования
        cacheTTL: 5 * 60 * 1000, // 5 минут для кэша пользователей
        avatarCacheTTL: 7 * 24 * 60 * 60 * 1000, // 7 дней для аватаров
        requestTimeout: 15000,
        avatarTimeout: 5000
    };

    // Ключи для localStorage
    const STORAGE_KEYS = {
        USERS_CACHE_KEY: 'users_list_cache_v2',
        AVATAR_CACHE_KEY: 'avatar_url_cache_v3'
    };

    // ==================== КЭШ ====================
    const userDataCache = new Map();
    const avatarCache = new Map();

    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getDaysWord(days) {
        if (days >= 11 && days <= 19) return 'дней';
        const lastDigit = days % 10;
        if (lastDigit === 1) return 'день';
        if (lastDigit >= 2 && lastDigit <= 4) return 'дня';
        return 'дней';
    }

    function formatDate(timestamp, format = 'ru') {
        if (timestamp === 0 || !timestamp) return 'Навсегда';
        const date = new Date(timestamp * 1000);
        if (format === 'ru') {
            return date.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        }
        return date.toISOString().split('T')[0];
    }

    function parseDateToTimestamp(dateString) {
        if (!dateString) return 0;
        
        try {
            if (typeof dateString === 'number') return dateString;
            
            const dotPattern = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;
            const dotMatch = dateString.match(dotPattern);
            if (dotMatch) {
                let day = parseInt(dotMatch[1]);
                let month = parseInt(dotMatch[2]) - 1;
                let year = parseInt(dotMatch[3]);
                if (year < 100) year += 2000;
                return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
            }
            
            const isoPattern = /(\d{4})-(\d{1,2})-(\d{1,2})/;
            const isoMatch = dateString.match(isoPattern);
            if (isoMatch) {
                let year = parseInt(isoMatch[1]);
                let month = parseInt(isoMatch[2]) - 1;
                let day = parseInt(isoMatch[3]);
                return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
            }
            
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                return Math.floor(date.getTime() / 1000);
            }
            
            return 0;
        } catch (e) {
            console.warn('Ошибка парсинга даты:', dateString, e);
            return 0;
        }
    }

    function parseUserFromApiItem(apiItem) {
        const hwid = apiItem.Tab0 || '';
        const licenseStatus = apiItem.Tab1 || '';
        const role = apiItem.Tab2 || 'Игрок';
        const limitType = apiItem.Tab3 || '';
        const remainingTime = apiItem.Tab4 || '';
        const endDateRaw = apiItem.Tab5 || '';
        const discordId = apiItem.Tab6 || null;
        const telegramId = apiItem.Tab7 || null;
        const banReason = apiItem.Tab8 || null;
        const userName = apiItem.Tab9 || null;      // НОВОЕ: имя пользователя
        const avatarHash = apiItem.Tab10 || null;    // НОВОЕ: хеш аватара
        
        const isBanned = role === 'Забанен';
        const hasLicense = licenseStatus === 'ЕСТЬ';
        const isExpired = remainingTime === 'Истёк';
        const noLicense = licenseStatus === 'НЕТ';
        const isForever = limitType === 'ВЫКЛ' && !noLicense && !isBanned;
        const isActiveLicense = !isBanned && !noLicense && hasLicense && !isExpired;

        let endTimestamp = 0;
        let formattedEndDate = '';
        
        if (isBanned) {
            endTimestamp = 0;
            formattedEndDate = 'Блокировка';
        } else if (isForever) {
            endTimestamp = 0;
            formattedEndDate = 'Навсегда';
        } else if (isActiveLicense && endDateRaw && endDateRaw !== '') {
            endTimestamp = parseDateToTimestamp(endDateRaw);
            formattedEndDate = endDateRaw;
        } else if (isExpired) {
            endTimestamp = 0;
            formattedEndDate = 'Истекла';
        } else if (noLicense) {
            endTimestamp = 0;
            formattedEndDate = 'Нет лицензии';
        }

        let licenseCategory = 'unknown';
        if (isBanned) licenseCategory = 'banned';
        else if (isForever) licenseCategory = 'forever';
        else if (isActiveLicense) licenseCategory = 'active';
        else if (isExpired) licenseCategory = 'expired';
        else if (noLicense) licenseCategory = 'nolicense';

        let roleClass = 'player';
        if (isBanned) roleClass = 'banned';
        else if (role === 'Создатель') roleClass = 'creator';
        else if (role === 'Менеджер') roleClass = 'manager';
        else if (role === 'Админ') roleClass = 'admin';
        else if (role === 'Партнёр') roleClass = 'partner';
        else if (role === 'Медиа') roleClass = 'media';
        else if (role === 'Игрок') roleClass = 'player';

        return {
            hwid: hwid,
            discordId: discordId,
            telegramId: telegramId,
            userName: userName,           // НОВОЕ: имя из таблицы
            avatarHash: avatarHash,       // НОВОЕ: хеш аватара из таблицы
            isBanned: isBanned,
            isActiveLicense: isActiveLicense,
            isForever: isForever,
            isExpired: isExpired,
            noLicense: noLicense,
            hasLicense: hasLicense,
            roleRaw: role,
            roleText: isBanned ? 'Забанен' : role,
            roleClass: roleClass,
            licenseCategory: licenseCategory,
            licenseStatus: licenseStatus,
            limitType: limitType,
            remainingTime: remainingTime,
            endDateRaw: endDateRaw,
            endTimestamp: endTimestamp,
            formattedEndDate: formattedEndDate,
            banReason: banReason,
            displayStatus: (!isBanned && isActiveLicense) ? 'HWID' : '',
            termId: isBanned ? 'term-banned' : 
                    (isForever ? 'term-forever' : 
                    (isActiveLicense ? 'term-active' : 
                    (isExpired ? 'term-expired' : 'term-nolicense')))
        };
    }

    // ==================== HTTP ЗАПРОСЫ ====================
    async function fetchWithTimeout(url, timeoutMs = PROFILE_DATA_CONFIG.requestTimeout) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            return response;
        } catch (error) {
            clearTimeout(timeout);
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeoutMs}ms`);
            }
            throw error;
        }
    }

    // ==================== ЗАГРУЗКА ДАННЫХ ПОЛЬЗОВАТЕЛЕЙ ====================
    async function fetchAllUsers(retryCount = 0) {
        const maxRetries = 5;
        const retryDelays = [1000, 2000, 3000, 5000, 10000];
        
        try {
            console.log(`Загрузка пользователей (попытка ${retryCount + 1}/${maxRetries})...`);
            const response = await fetchWithTimeout(PROFILE_DATA_CONFIG.hwidApiUrl, PROFILE_DATA_CONFIG.requestTimeout);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!Array.isArray(data)) {
                throw new Error('Ответ не является массивом');
            }
            
            if (data.length === 0 && retryCount < maxRetries) {
                console.log('Получен пустой массив, повторная попытка...');
                await new Promise(resolve => setTimeout(resolve, retryDelays[retryCount]));
                return fetchAllUsers(retryCount + 1);
            }
            
            console.log(`Успешно загружено ${data.length} записей`);
            return data.map(item => parseUserFromApiItem(item));
            
        } catch (error) {
            console.error(`Ошибка загрузки (попытка ${retryCount + 1}):`, error);
            
            if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelays[retryCount]));
                return fetchAllUsers(retryCount + 1);
            }
            
            return [];
        }
    }

    // Загрузка кэша пользователей из localStorage
    function loadUsersFromCache() {
        try {
            const cached = localStorage.getItem(STORAGE_KEYS.USERS_CACHE_KEY);
            if (cached) {
                const cache = JSON.parse(cached);
                if (cache.timestamp && Date.now() - cache.timestamp < PROFILE_DATA_CONFIG.cacheTTL) {
                    console.log(`Загружено ${cache.users?.length || 0} пользователей из кэша`);
                    return cache.users || null;
                }
            }
        } catch (e) {
            console.warn('Ошибка загрузки кэша пользователей:', e);
        }
        return null;
    }

    // Сохранение кэша пользователей
    function saveUsersToCache(users) {
        try {
            localStorage.setItem(STORAGE_KEYS.USERS_CACHE_KEY, JSON.stringify({
                users: users,
                timestamp: Date.now()
            }));
            console.log(`Сохранено ${users.length} пользователей в кэш`);
        } catch (e) {
            console.warn('Ошибка сохранения кэша пользователей:', e);
        }
    }

    async function fetchUserByHwid(hwid) {
        if (!hwid) return null;
        
        // Проверяем кэш
        const cached = userDataCache.get(hwid);
        if (cached && Date.now() - cached.timestamp < PROFILE_DATA_CONFIG.cacheTTL) {
            return cached.data;
        }
        
        try {
            const users = await fetchAllUsers();
            const user = users.find(u => u.hwid === hwid);
            
            if (user) {
                userDataCache.set(hwid, {
                    data: user,
                    timestamp: Date.now()
                });
            }
            
            return user || null;
        } catch (error) {
            console.error('Ошибка получения пользователя по HWID:', error);
            return null;
        }
    }

    async function fetchUserByDiscordId(discordId) {
        if (!discordId) return null;
        
        try {
            const users = await fetchAllUsers();
            return users.find(u => u.discordId === discordId) || null;
        } catch (error) {
            console.error('Ошибка поиска по Discord ID:', error);
            return null;
        }
    }

    async function fetchUserByTelegramId(telegramId) {
        if (!telegramId) return null;
        
        try {
            const users = await fetchAllUsers();
            return users.find(u => u.telegramId === telegramId) || null;
        } catch (error) {
            console.error('Ошибка поиска по Telegram ID:', error);
            return null;
        }
    }

    // ==================== АВАТАРЫ (ИЗ ТАБЛИЦЫ) ====================
    
    // Загрузка кэша аватаров из localStorage
    function loadAvatarCache() {
        try {
            const cached = localStorage.getItem(STORAGE_KEYS.AVATAR_CACHE_KEY);
            if (cached) {
                const cache = JSON.parse(cached);
                if (cache.timestamp && Date.now() - cache.timestamp < PROFILE_DATA_CONFIG.avatarCacheTTL) {
                    return cache.urls || {};
                }
            }
        } catch (e) {
            console.warn('Ошибка загрузки кэша аватаров:', e);
        }
        return {};
    }
    
    // Сохранение URL аватара в кэш
    function saveAvatarToCache(discordId, avatarUrl) {
        try {
            const cache = loadAvatarCache();
            cache[discordId] = avatarUrl;
            localStorage.setItem(STORAGE_KEYS.AVATAR_CACHE_KEY, JSON.stringify({
                urls: cache,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('Ошибка сохранения кэша аватара:', e);
        }
    }
    
    // Получение кэшированного URL аватара
    function getCachedAvatarUrl(discordId) {
        const cache = loadAvatarCache();
        return cache[discordId] || null;
    }

    // Загрузка аватара из CDN (без прокси)
    async function loadAvatarFromCdn(discordId, avatarHash) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Timeout'));
            }, PROFILE_DATA_CONFIG.avatarTimeout);
            
            function cleanup() {
                clearTimeout(timeout);
                img.onload = null;
                img.onerror = null;
            }
            
            img.onload = () => { cleanup(); resolve(); };
            img.onerror = () => { cleanup(); reject(new Error('Load error')); };
            
            // Используем CDN без прокси
            img.src = `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=128`;
        });
    }

    async function getDiscordAvatarUrl(discordId, avatarHash) {
        if (!discordId || !avatarHash) return null;
        
        const cacheKey = `avatar_${discordId}`;
        
        // Проверяем кэш в памяти
        const cached = avatarCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < PROFILE_DATA_CONFIG.avatarCacheTTL) {
            return cached.url;
        }
        
        // Проверяем localStorage кэш
        const cachedUrl = getCachedAvatarUrl(discordId);
        if (cachedUrl) {
            avatarCache.set(cacheKey, { url: cachedUrl, timestamp: Date.now() });
            return cachedUrl;
        }
        
        const avatarUrl = `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=128`;
        
        try {
            await loadAvatarFromCdn(discordId, avatarHash);
            saveAvatarToCache(discordId, avatarUrl);
            avatarCache.set(cacheKey, { url: avatarUrl, timestamp: Date.now() });
            return avatarUrl;
        } catch (error) {
            console.warn(`Не удалось загрузить аватар для ${discordId}:`, error);
            return null;
        }
    }

    // ==================== ФОРМАТИРОВАНИЕ ДАННЫХ ДЛЯ ОТОБРАЖЕНИЯ ====================
    
    /**
     * Получить отображаемое имя пользователя
     * Приоритет: userName из таблицы > Discord данные > HWID
     */
    function getDisplayName(userInfo, discordData = null) {
        // 1. Сначала используем userName из таблицы (Tab9)
        if (userInfo && userInfo.userName && userInfo.userName.trim() !== '') {
            return userInfo.userName;
        }
        
        // 2. Если есть Discord данные (для обратной совместимости)
        if (discordData) {
            if (discordData.username) {
                if (discordData.discriminator && discordData.discriminator !== '0') {
                    return `${discordData.username}#${discordData.discriminator}`;
                }
                return discordData.username;
            }
            if (discordData.global_name) return discordData.global_name;
        }
        
        // 3. Иначе показываем HWID
        if (userInfo && userInfo.hwid) {
            return userInfo.hwid.substring(0, 20) + (userInfo.hwid.length > 20 ? '...' : '');
        }
        
        return 'Пользователь';
    }

    function getShortHwid(hwid, length = 16) {
        if (!hwid) return 'Не привязан';
        return hwid.substring(0, length) + (hwid.length > length ? '...' : '');
    }

    function getAvatarLetter(name) {
        if (!name) return '?';
        return name.charAt(0).toUpperCase();
    }

    // ==================== СТАТУС ПОДПИСКИ ====================
    function getSubscriptionStatus(userInfo) {
        if (!userInfo) return { status: 'expired', text: 'Нет данных', daysLeft: null, formattedTime: null };
        
        if (userInfo.isBanned) {
            return { status: 'banned', text: 'Блокировка', daysLeft: null, formattedTime: null };
        }

        if (userInfo.noLicense) {
            return { status: 'nolicense', text: 'Нет лицензии', daysLeft: null, formattedTime: null };
        }
        
        if (userInfo.isForever) {
            return { status: 'forever', text: 'Навсегда', daysLeft: null, formattedTime: null };
        }
        
        if (userInfo.isExpired) {
            return { status: 'expired', text: 'Истёк', daysLeft: 0, formattedTime: null };
        }
        
        if (userInfo.isActiveLicense && userInfo.endTimestamp > 0) {
            const now = Math.floor(Date.now() / 1000);
            if (userInfo.endTimestamp > now) {
                const diffSeconds = userInfo.endTimestamp - now;
                const totalDays = diffSeconds / (60 * 60 * 24);
                const months = Math.floor(totalDays / 30);
                const days = Math.floor(totalDays % 30);
                const hours = Math.floor((diffSeconds % (60 * 60 * 24)) / (60 * 60));
                const minutes = Math.floor((diffSeconds % (60 * 60)) / 60);

                const parts = [];
                if (months > 0) parts.push(`${months}мес.`);
                if (days > 0) parts.push(`${days}д.`);
                if (hours > 0) parts.push(`${hours}ч.`);
                if (minutes > 0 && months === 0 && days === 0) parts.push(`${minutes}мин.`);
                
                const formattedTime = parts.join(' ') || '1мин';
                
                return { 
                    status: 'active', 
                    text: formattedTime, 
                    daysLeft: Math.ceil(totalDays),
                    formattedTime: formattedTime,
                    endTimestamp: userInfo.endTimestamp
                };
            } else {
                return { status: 'expired', text: 'Истекла', daysLeft: 0, formattedTime: null };
            }
        }
        
        return { status: 'nolicense', text: 'Нет лицензии', daysLeft: null, formattedTime: null };
    }

    // ==================== ОЧИСТКА КЭША ====================
    function clearAllCache() {
        userDataCache.clear();
        avatarCache.clear();
        try {
            localStorage.removeItem(STORAGE_KEYS.USERS_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.AVATAR_CACHE_KEY);
            console.log('Весь кэш очищен');
        } catch(e) {}
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    function init() {
        console.log('ProfileData модуль инициализирован (Версия 4.0 - данные из таблицы)');
        console.log('Поля: Tab9 = UserName, Tab10 = AvatarHash');
    }

    // ==================== ЭКСПОРТ ====================
    window.ProfileData = {
        config: PROFILE_DATA_CONFIG,
        parseUserFromApiItem: parseUserFromApiItem,
        getSubscriptionStatus: getSubscriptionStatus,
        fetchAllUsers: fetchAllUsers,
        fetchUserByHwid: fetchUserByHwid,
        fetchUserByDiscordId: fetchUserByDiscordId,
        fetchUserByTelegramId: fetchUserByTelegramId,
        getDiscordAvatarUrl: getDiscordAvatarUrl,
        getDisplayName: getDisplayName,
        getShortHwid: getShortHwid,
        getAvatarLetter: getAvatarLetter,
        getDaysWord: getDaysWord,
        formatDate: formatDate,
        escapeHtml: escapeHtml,
        fetchWithTimeout: fetchWithTimeout,
        getCachedAvatarUrl: getCachedAvatarUrl,
        saveAvatarToCache: saveAvatarToCache,
        loadUsersFromCache: loadUsersFromCache,
        saveUsersToCache: saveUsersToCache,
        clearCache: clearAllCache
    };
    
    init();
})();