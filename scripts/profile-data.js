// profile-data.js - универсальный модуль для работы с данными профиля
// Версия 5.0 - БЕСКОНЕЧНЫЙ КЕШ ТАБЛИЦЫ + обновление при каждом заходе

(function() {
    // ==================== КОНФИГУРАЦИЯ ====================
    const PROFILE_DATA_CONFIG = {
        // API для получения данных пользователей
        hwidApiUrl: 'https://hwid-api.fascord.workers.dev/1hYhAb_3EVcHmj7c8cgAjXMoF6HCqqjUeb9SSKXHs8TA?gid=834339051',
        // Настройки кэширования
        tableCacheTTL: Infinity,        // Бесконечный кеш для таблицы (до обновления при заходе)
        avatarCacheTTL: 60 * 60 * 1000, // 1 час для аватаров
        requestTimeout: 15000,
        avatarTimeout: 5000
    };

    // Ключи для localStorage
    const STORAGE_KEYS = {
        USERS_CACHE_KEY: 'users_list_cache_v5',      // новая версия
        AVATAR_CACHE_KEY: 'avatar_url_cache_v5',     // новая версия
        LAST_UPDATE_KEY: 'last_table_update_time'    // время последнего обновления таблицы
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
        const userName = apiItem.Tab9 || null;
        const avatarHash = apiItem.Tab10 || null;
        
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
            let formattedDate = endDateRaw;
            if (endDateRaw && endDateRaw.match(/\d{2}\.\d{2}\.\d{4}/)) {
                formattedDate = endDateRaw.replace(/(\d{2}\.\d{2}\.)\d{2}(\d{2})/, '$1$2');
            }
            formattedEndDate = `До ${formattedDate}`;
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
            userName: userName,
            avatarHash: avatarHash,
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

    // Загрузка кэша пользователей из localStorage (бесконечный, пока не обновится)
    function loadUsersFromCache() {
        try {
            const cached = localStorage.getItem(STORAGE_KEYS.USERS_CACHE_KEY);
            if (cached) {
                const cache = JSON.parse(cached);
                // Бесконечный кеш - проверяем только наличие данных
                if (cache.users && cache.users.length > 0) {
                    console.log(`Загружено ${cache.users.length} пользователей из бесконечного кэша`);
                    return cache.users;
                }
            }
        } catch (e) {
            console.warn('Ошибка загрузки кэша пользователей:', e);
        }
        return null;
    }

    // Сохранение кэша пользователей (бесконечный)
    function saveUsersToCache(users) {
        try {
            localStorage.setItem(STORAGE_KEYS.USERS_CACHE_KEY, JSON.stringify({
                users: users,
                timestamp: Date.now()  // сохраняем для информации, но не используем для TTL
            }));
            localStorage.setItem(STORAGE_KEYS.LAST_UPDATE_KEY, Date.now().toString());
            console.log(`Сохранено ${users.length} пользователей в бесконечный кэш`);
        } catch (e) {
            console.warn('Ошибка сохранения кэша пользователей:', e);
        }
    }

    // Основная функция: всегда обновляем кеш при заходе на сайт
    async function getUsersTable(forceRefresh = false) {
        // Всегда пытаемся обновить данные при вызове (при заходе на сайт)
        try {
            console.log('Обновление таблицы пользователей при заходе на сайт...');
            const freshUsers = await fetchAllUsers();
            
            if (freshUsers && freshUsers.length > 0) {
                saveUsersToCache(freshUsers);
                // Обновляем Map кэш
                freshUsers.forEach(user => {
                    if (user.hwid) {
                        userDataCache.set(user.hwid, {
                            data: user,
                            timestamp: Date.now()
                        });
                    }
                });
                return freshUsers;
            } else {
                // Если API вернул пустой массив, пробуем взять из кэша
                console.warn('API вернул пустой массив, использую кэш');
                const cached = loadUsersFromCache();
                if (cached) return cached;
                return [];
            }
        } catch (error) {
            console.error('Ошибка обновления таблицы:', error);
            // При ошибке сети используем кэш
            const cached = loadUsersFromCache();
            if (cached) {
                console.log('Использую сохранённый кэш из-за ошибки сети');
                return cached;
            }
            return [];
        }
    }

    async function fetchUserByHwid(hwid) {
        if (!hwid) return null;
        
        // Проверяем кэш в памяти
        const cached = userDataCache.get(hwid);
        if (cached && cached.data) {
            return cached.data;
        }
        
        // Загружаем всю таблицу (с обновлением)
        const users = await getUsersTable();
        const user = users.find(u => u.hwid === hwid);
        
        if (user) {
            userDataCache.set(hwid, {
                data: user,
                timestamp: Date.now()
            });
        }
        
        return user || null;
    }

    async function fetchUserByDiscordId(discordId) {
        if (!discordId) return null;
        
        const users = await getUsersTable();
        return users.find(u => u.discordId === discordId) || null;
    }

    async function fetchUserByTelegramId(telegramId) {
        if (!telegramId) return null;
        
        const users = await getUsersTable();
        return users.find(u => u.telegramId === telegramId) || null;
    }

    // ==================== АВАТАРЫ (обновление не чаще 1 часа) ====================
    
    // Загрузка кэша аватаров из localStorage
    function loadAvatarCache() {
        try {
            const cached = localStorage.getItem(STORAGE_KEYS.AVATAR_CACHE_KEY);
            if (cached) {
                const cache = JSON.parse(cached);
                const now = Date.now();
                // Проверяем TTL для аватаров (1 час)
                if (cache.timestamp && (now - cache.timestamp) < PROFILE_DATA_CONFIG.avatarCacheTTL) {
                    return cache.urls || {};
                }
                // Если кеш устарел, возвращаем пустой объект (будет обновлён)
                if (cache.timestamp && (now - cache.timestamp) >= PROFILE_DATA_CONFIG.avatarCacheTTL) {
                    console.log('Кеш аватаров устарел (>1 часа), будет обновлён');
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
            
            img.src = `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=128`;
        });
    }

    async function getDiscordAvatarUrl(discordId, avatarHash) {
        if (!discordId || !avatarHash) return null;
        
        const cacheKey = `avatar_${discordId}`;
        
        // Проверяем кэш в памяти (с учётом TTL)
        const cached = avatarCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < PROFILE_DATA_CONFIG.avatarCacheTTL) {
            return cached.url;
        }
        
        // Проверяем localStorage кэш (с учётом TTL)
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
    
    function getDisplayName(userInfo, discordData = null) {
        if (userInfo && userInfo.userName && userInfo.userName.trim() !== '') {
            return userInfo.userName;
        }
        
        if (discordData) {
            if (discordData.username) {
                if (discordData.discriminator && discordData.discriminator !== '0') {
                    return `${discordData.username}#${discordData.discriminator}`;
                }
                return discordData.username;
            }
            if (discordData.global_name) return discordData.global_name;
        }
        
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
            localStorage.removeItem(STORAGE_KEYS.LAST_UPDATE_KEY);
            console.log('Весь кэш очищен');
        } catch(e) {}
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    // Автоматически обновляем таблицу при загрузке модуля
    async function autoRefreshOnLoad() {
        console.log('ProfileData: Автоматическое обновление таблицы при загрузке страницы...');
        try {
            const users = await fetchAllUsers();
            if (users && users.length > 0) {
                saveUsersToCache(users);
                // Обновляем Map кэш
                users.forEach(user => {
                    if (user.hwid) {
                        userDataCache.set(user.hwid, {
                            data: user,
                            timestamp: Date.now()
                        });
                    }
                });
                console.log(`ProfileData: Таблица обновлена, сохранено ${users.length} записей в бесконечный кэш`);
            }
        } catch (error) {
            console.error('ProfileData: Ошибка автообновления таблицы:', error);
            // При ошибке используем существующий кэш
            const cached = loadUsersFromCache();
            if (cached) {
                console.log(`ProfileData: Использую существующий кэш (${cached.length} записей)`);
            }
        }
    }

    function init() {
        console.log('ProfileData модуль инициализирован (Версия 5.0 - бесконечный кеш таблицы)');
        console.log('- Кеш таблицы: бесконечный, обновляется при каждом заходе на сайт');
        console.log('- Кеш аватаров: 1 час');
        
        // Запускаем автообновление
        autoRefreshOnLoad();
    }
    
    init();

    // ==================== ЭКСПОРТ ====================
    window.ProfileData = {
        config: PROFILE_DATA_CONFIG,
        parseUserFromApiItem: parseUserFromApiItem,
        getSubscriptionStatus: getSubscriptionStatus,
        fetchAllUsers: getUsersTable,           // Теперь возвращает обновлённые данные
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
        clearCache: clearAllCache,
        parseDateToTimestamp: parseDateToTimestamp,
        // Дополнительные методы для управления кешем
        forceRefreshTable: getUsersTable,       // Принудительное обновление таблицы
        getLastUpdateTime: () => localStorage.getItem(STORAGE_KEYS.LAST_UPDATE_KEY)
    };
})();