// profile-data.js - универсальный модуль для работы с данными профиля
// Версия 5.2 - добавлена поддержка Steam

(function() {
    // ==================== КОНФИГУРАЦИЯ ====================
    const PROFILE_DATA_CONFIG = {
        // API для получения данных пользователей
        hwidApiUrl: 'https://hwid-api.fascord.workers.dev/1hYhAb_3EVcHmj7c8cgAjXMoF6HCqqjUeb9SSKXHs8TA?gid=834339051',
        // API для получения истории запусков
        launchesApiUrl: 'https://hwid-api.fascord.workers.dev/1QkxxCV3wXIJ4erRZykyIn7Se9qhqOD2k-5H3WD4waFY/edit?gid=834339051',
        // Настройки кэширования
        tableCacheTTL: Infinity,        // Бесконечный кеш для таблицы (до обновления при заходе)
        launchesCacheTTL: 5 * 60 * 1000, // 5 минут для истории запусков
        avatarCacheTTL: 60 * 60 * 1000, // 1 час для аватаров
        steamCacheTTL: 60 * 60 * 1000,  // 1 час для Steam данных
        requestTimeout: 15000,
        avatarTimeout: 5000
    };

    // Ключи для localStorage
    const STORAGE_KEYS = {
        USERS_CACHE_KEY: 'users_list_cache_v5',
        AVATAR_CACHE_KEY: 'avatar_url_cache_v5',
        LAUNCHES_CACHE_KEY: 'launches_cache_v1',
        STEAM_CACHE_KEY: 'steam_data_cache_v1',  // Кэш Steam данных
        LAST_UPDATE_KEY: 'last_table_update_time'
    };

    // ==================== КЭШ ====================
    const userDataCache = new Map();
    const avatarCache = new Map();
    const launchesCache = new Map();
    const steamCache = new Map(); // Кэш Steam: ключ - steamId

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
        const steamId = apiItem.Tab11 || null; // Добавляем Steam ID из таблицы
        
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

        let roleClass = 'other';
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
            steamId: steamId,  // Добавляем Steam ID
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

    // ==================== STEAM API ====================
    
    // Парсинг XML ответа Steam
    function parseSteamXML(xmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        // Проверка на ошибку
        const errorDiv = xmlDoc.querySelector('div');
        if (errorDiv && errorDiv.textContent.includes('The profile is not public')) {
            return { error: 'private', message: 'Профиль Steam скрыт' };
        }
        
        const profile = xmlDoc.querySelector('profile');
        if (!profile) {
            return { error: 'not_found', message: 'Профиль не найден' };
        }
        
        const steamId = profile.querySelector('steamID64')?.textContent || '';
        const username = profile.querySelector('steamID')?.textContent || '';
        const avatarIcon = profile.querySelector('avatarIcon')?.textContent || '';
        const avatarMedium = profile.querySelector('avatarMedium')?.textContent || '';
        const avatarFull = profile.querySelector('avatarFull')?.textContent || '';
        const realName = profile.querySelector('realname')?.textContent || '';
        const location = profile.querySelector('location')?.textContent || '';
        const memberSince = profile.querySelector('memberSince')?.textContent || '';
        
        return {
            steamId: steamId,
            username: username,
            avatarIcon: avatarIcon,
            avatarMedium: avatarMedium,
            avatarFull: avatarFull,
            realName: realName,
            location: location,
            memberSince: memberSince,
            profileUrl: `https://steamcommunity.com/profiles/${steamId}/`,
            error: null
        };
    }
    
    // Загрузка данных Steam через XML API
    async function fetchSteamData(steamId) {
        if (!steamId) return null;
        
        // Проверяем кэш в памяти
        if (steamCache.has(steamId)) {
            const cached = steamCache.get(steamId);
            if (Date.now() - cached.timestamp < PROFILE_DATA_CONFIG.steamCacheTTL) {
                console.log(`Steam данные для ${steamId} из кэша памяти`);
                return cached.data;
            }
        }
        
        // Проверяем localStorage кэш
        try {
            const cachedData = localStorage.getItem(STORAGE_KEYS.STEAM_CACHE_KEY);
            if (cachedData) {
                const cache = JSON.parse(cachedData);
                if (cache[steamId] && (Date.now() - cache[steamId].timestamp) < PROFILE_DATA_CONFIG.steamCacheTTL) {
                    console.log(`Steam данные для ${steamId} из localStorage`);
                    steamCache.set(steamId, { data: cache[steamId].data, timestamp: cache[steamId].timestamp });
                    return cache[steamId].data;
                }
            }
        } catch (e) {
            console.warn('Ошибка чтения кэша Steam:', e);
        }
        
        try {
            const xmlUrl = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
            console.log(`Загрузка Steam данных для ${steamId}...`);
            
            const response = await fetchWithTimeout(xmlUrl, 8000);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const xmlText = await response.text();
            const parsed = parseSteamXML(xmlText);
            
            if (parsed.error) {
                console.warn(`Steam ошибка для ${steamId}: ${parsed.message}`);
                // Сохраняем ошибку в кэш, чтобы не запрашивать часто
                const errorData = { error: parsed.error, message: parsed.message, timestamp: Date.now() };
                steamCache.set(steamId, { data: errorData, timestamp: Date.now() });
                saveSteamToCache(steamId, errorData);
                return errorData;
            }
            
            console.log(`Steam данные загружены для ${steamId}: ${parsed.username}`);
            
            // Сохраняем в кэш
            steamCache.set(steamId, { data: parsed, timestamp: Date.now() });
            saveSteamToCache(steamId, parsed);
            
            return parsed;
        } catch (error) {
            console.error(`Ошибка загрузки Steam данных для ${steamId}:`, error);
            const errorData = { error: 'network', message: 'Ошибка сети', timestamp: Date.now() };
            return errorData;
        }
    }
    
    // Сохранение Steam данных в localStorage
    function saveSteamToCache(steamId, data) {
        try {
            const existingCache = localStorage.getItem(STORAGE_KEYS.STEAM_CACHE_KEY);
            const newCache = existingCache ? JSON.parse(existingCache) : {};
            newCache[steamId] = { data: data, timestamp: Date.now() };
            localStorage.setItem(STORAGE_KEYS.STEAM_CACHE_KEY, JSON.stringify(newCache));
        } catch (e) {
            console.warn('Ошибка сохранения кэша Steam:', e);
        }
    }
    
    // Получение кэшированных Steam данных
    function getCachedSteamData(steamId) {
        try {
            const cachedData = localStorage.getItem(STORAGE_KEYS.STEAM_CACHE_KEY);
            if (cachedData) {
                const cache = JSON.parse(cachedData);
                if (cache[steamId] && (Date.now() - cache[steamId].timestamp) < PROFILE_DATA_CONFIG.steamCacheTTL) {
                    return cache[steamId].data;
                }
            }
        } catch (e) {
            console.warn('Ошибка чтения кэша Steam:', e);
        }
        return null;
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

    function saveUsersToCache(users) {
        try {
            localStorage.setItem(STORAGE_KEYS.USERS_CACHE_KEY, JSON.stringify({
                users: users,
                timestamp: Date.now()
            }));
            localStorage.setItem(STORAGE_KEYS.LAST_UPDATE_KEY, Date.now().toString());
            console.log(`Сохранено ${users.length} пользователей в бесконечный кэш`);
        } catch (e) {
            console.warn('Ошибка сохранения кэша пользователей:', e);
        }
    }

    async function getUsersTable(forceRefresh = false) {
        try {
            console.log('Обновление таблицы пользователей при заходе на сайт...');
            const freshUsers = await fetchAllUsers();
            
            if (freshUsers && freshUsers.length > 0) {
                saveUsersToCache(freshUsers);
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
                console.warn('API вернул пустой массив, использую кэш');
                const cached = loadUsersFromCache();
                if (cached) return cached;
                return [];
            }
        } catch (error) {
            console.error('Ошибка обновления таблицы:', error);
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
        
        const cached = userDataCache.get(hwid);
        if (cached && cached.data) {
            return cached.data;
        }
        
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

    // ==================== ЗАГРУЗКА ИСТОРИИ ЗАПУСКОВ ====================
    async function fetchAllLaunches() {
        try {
            console.log('Загрузка истории запусков...');
            const response = await fetchWithTimeout(PROFILE_DATA_CONFIG.launchesApiUrl, PROFILE_DATA_CONFIG.requestTimeout);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            if (!Array.isArray(data)) {
                throw new Error('Ответ не является массивом');
            }
            console.log(`Загружено ${data.length} записей запусков`);
            return data;
        } catch (error) {
            console.error('Ошибка загрузки истории запусков:', error);
            return [];
        }
    }

    async function fetchLaunchesByHwid(hwid) {
        if (!hwid) return [];

        if (launchesCache.has(hwid)) {
            const cached = launchesCache.get(hwid);
            if (Date.now() - cached.timestamp < PROFILE_DATA_CONFIG.launchesCacheTTL) {
                console.log(`Возвращаем ${cached.launches.length} запусков для ${hwid} из кэша`);
                return cached.launches;
            }
        }

        try {
            const cachedData = localStorage.getItem(STORAGE_KEYS.LAUNCHES_CACHE_KEY);
            if (cachedData) {
                const cache = JSON.parse(cachedData);
                if (cache[hwid] && (Date.now() - cache[hwid].timestamp) < PROFILE_DATA_CONFIG.launchesCacheTTL) {
                    console.log(`Возвращаем ${cache[hwid].launches.length} запусков для ${hwid} из localStorage`);
                    launchesCache.set(hwid, { launches: cache[hwid].launches, timestamp: cache[hwid].timestamp });
                    return cache[hwid].launches;
                }
            }
        } catch (e) {
            console.warn('Ошибка чтения кэша запусков:', e);
        }

        const allLaunches = await fetchAllLaunches();
        const userLaunches = allLaunches
            .filter(launch => launch.Tab1 === hwid)
            .map(launch => ({
                timestamp: launch.Tab0,
                steamId: launch.Tab2,
                version: launch.Tab3
            }))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        launchesCache.set(hwid, { launches: userLaunches, timestamp: Date.now() });
        
        try {
            const existingCache = localStorage.getItem(STORAGE_KEYS.LAUNCHES_CACHE_KEY);
            const newCache = existingCache ? JSON.parse(existingCache) : {};
            newCache[hwid] = { launches: userLaunches, timestamp: Date.now() };
            localStorage.setItem(STORAGE_KEYS.LAUNCHES_CACHE_KEY, JSON.stringify(newCache));
        } catch (e) {
            console.warn('Ошибка сохранения кэша запусков:', e);
        }

        console.log(`Найдено ${userLaunches.length} запусков для HWID: ${hwid}`);
        return userLaunches;
    }

    // ==================== АВАТАРЫ ====================
    
    function loadAvatarCache() {
        try {
            const cached = localStorage.getItem(STORAGE_KEYS.AVATAR_CACHE_KEY);
            if (cached) {
                const cache = JSON.parse(cached);
                const now = Date.now();
                if (cache.timestamp && (now - cache.timestamp) < PROFILE_DATA_CONFIG.avatarCacheTTL) {
                    return cache.urls || {};
                }
            }
        } catch (e) {
            console.warn('Ошибка загрузки кэша аватаров:', e);
        }
        return {};
    }
    
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
    
    function getCachedAvatarUrl(discordId) {
        const cache = loadAvatarCache();
        return cache[discordId] || null;
    }

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
        
        const cached = avatarCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < PROFILE_DATA_CONFIG.avatarCacheTTL) {
            return cached.url;
        }
        
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
        launchesCache.clear();
        steamCache.clear();
        try {
            localStorage.removeItem(STORAGE_KEYS.USERS_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.AVATAR_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.LAUNCHES_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.STEAM_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.LAST_UPDATE_KEY);
            console.log('Весь кэш очищен');
        } catch(e) {}
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    async function autoRefreshOnLoad() {
        console.log('ProfileData: Автоматическое обновление таблицы при загрузке страницы...');
        try {
            const users = await fetchAllUsers();
            if (users && users.length > 0) {
                saveUsersToCache(users);
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
            const cached = loadUsersFromCache();
            if (cached) {
                console.log(`ProfileData: Использую существующий кэш (${cached.length} записей)`);
            }
        }
    }

    function init() {
        console.log('ProfileData модуль инициализирован (Версия 5.2 - добавлена поддержка Steam)');
        console.log('- Кеш таблицы: бесконечный, обновляется при каждом заходе на сайт');
        console.log('- Кеш аватаров: 1 час');
        console.log('- Кеш запусков: 5 минут');
        console.log('- Кеш Steam: 1 час');
        
        autoRefreshOnLoad();
    }
    
    init();


    
    // ==================== ЭКСПОРТ ====================
    window.ProfileData = {
        config: PROFILE_DATA_CONFIG,
        parseUserFromApiItem: parseUserFromApiItem,
        getSubscriptionStatus: getSubscriptionStatus,
        fetchAllUsers: getUsersTable,
        fetchUserByHwid: fetchUserByHwid,
        fetchUserByDiscordId: fetchUserByDiscordId,
        fetchUserByTelegramId: fetchUserByTelegramId,
        fetchLaunchesByHwid: fetchLaunchesByHwid,
        fetchSteamData: fetchSteamData,           // Новая функция
        getCachedSteamData: getCachedSteamData,   // Новая функция
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
        forceRefreshTable: getUsersTable,
        getLastUpdateTime: () => localStorage.getItem(STORAGE_KEYS.LAST_UPDATE_KEY)
    };
})();