// profile-data.js - универсальный модуль для работы с данными профиля
// Версия 2.1

(function() {
    // ==================== КОНФИГУРАЦИЯ ====================
    const PROFILE_DATA_CONFIG = {
        // API для получения данных пользователей
        hwidApiUrl: 'https://hwid-api.fascord.workers.dev/1hYhAb_3EVcHmj7c8cgAjXMoF6HCqqjUeb9SSKXHs8TA?gid=834339051',
        // API для Discord данных
        discordApiBase: 'https://dis-api.sakuri.ru/api/discord/user/',
        discordBatchApi: 'https://dis-api.sakuri.ru/api/discord/users',
        // Прокси для обхода CORS
        proxy: 'https://gentle-cell-c591.fascord.workers.dev/proxy?url=',
        // Настройки кэширования
        cacheTTL: 60 * 60 * 1000, // 1 час для обычного кэша
        discordCacheTTL: 24 * 60 * 60 * 1000, // 24 часа для Discord данных (1 день)
        requestTimeout: 15000,
        discordRequestTimeout: 8000,
        avatarTimeout: 5000
    };

    // Ключи для localStorage
    const STORAGE_KEYS = {
        DISCORD_LAST_UPDATE: 'discord_last_update_timestamp',
        DISCORD_USER_PREFIX: 'discord_user_'
    };

    // ==================== КЭШ ====================
    const discordDataCache = new Map();
    const userDataCache = new Map();
    const avatarCache = new Map();
    let lastDiscordUpdate = null;
    let updateInProgress = false;

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
            
            // Формат "DD.MM.YYYY" или "DD.MM.YY"
            const dotPattern = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;
            const dotMatch = dateString.match(dotPattern);
            if (dotMatch) {
                let day = parseInt(dotMatch[1]);
                let month = parseInt(dotMatch[2]) - 1;
                let year = parseInt(dotMatch[3]);
                if (year < 100) year += 2000;
                return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
            }
            
            // Формат "YYYY-MM-DD"
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
        
        const isBanned = role === 'Забанен';
        const hasLicense = licenseStatus === 'ЕСТЬ';
        const isExpired = remainingTime === 'Истёк';
        const noLicense = licenseStatus === 'НЕТ';
        const isForever = limitType === 'ВЫКЛ' && !noLicense && !isBanned;
        const isActiveLicense = !isBanned && !noLicense && hasLicense && !isExpired;

        // Парсим дату окончания
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

        // Определяем категорию лицензии
        let licenseCategory = 'unknown';
        if (isBanned) licenseCategory = 'banned';
        else if (isForever) licenseCategory = 'forever';
        else if (isActiveLicense) licenseCategory = 'active';
        else if (isExpired) licenseCategory = 'expired';
        else if (noLicense) licenseCategory = 'nolicense';

        // Определяем роль для CSS класса
        let roleClass = 'player';
        if (isBanned) roleClass = 'banned';
        else if (role === 'Создатель') roleClass = 'creator';
        else if (role === 'Менеджер') roleClass = 'manager';
        else if (role === 'Админ') roleClass = 'admin';
        else if (role === 'Партнёр') roleClass = 'partner';
        else if (role === 'Медиа') roleClass = 'media';
        else if (role === 'Игрок') roleClass = 'player';

        return {
            // Основные данные
            hwid: hwid,
            discordId: discordId,
            telegramId: telegramId,
            
            // Статусные флаги
            isBanned: isBanned,
            isActiveLicense: isActiveLicense,
            isForever: isForever,
            isExpired: isExpired,
            noLicense: noLicense,
            hasLicense: hasLicense,
            
            // Роли и текст
            roleRaw: role,
            roleText: isBanned ? 'Забанен' : role,
            roleClass: roleClass,
            licenseCategory: licenseCategory,
            
            // Данные лицензии
            licenseStatus: licenseStatus,
            limitType: limitType,
            remainingTime: remainingTime,
            endDateRaw: endDateRaw,
            endTimestamp: endTimestamp,
            formattedEndDate: formattedEndDate,
            
            // Бан
            banReason: banReason,
            
            // Дополнительные поля
            displayStatus: (!isBanned && isActiveLicense) ? 'HWID' : '',
            termId: isBanned ? 'term-banned' : 
                    (isForever ? 'term-forever' : 
                    (isActiveLicense ? 'term-active' : 
                    (isExpired ? 'term-expired' : 'term-nolicense')))
        };
    }

    // ==================== УПРАВЛЕНИЕ ВРЕМЕНЕМ ОБНОВЛЕНИЯ DISCORD ====================
    
    /**
     * Получить timestamp последнего обновления Discord данных
     * @returns {number|null} timestamp в миллисекундах или null
     */
    function getLastDiscordUpdateTime() {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.DISCORD_LAST_UPDATE);
            if (stored) {
                const timestamp = parseInt(stored);
                if (!isNaN(timestamp)) {
                    lastDiscordUpdate = timestamp;
                    return timestamp;
                }
            }
            return null;
        } catch (e) {
            console.warn('Ошибка чтения времени последнего обновления:', e);
            return null;
        }
    }

    /**
     * Установить timestamp последнего обновления Discord данных
     */
    function setLastDiscordUpdateTime() {
        const timestamp = Date.now();
        lastDiscordUpdate = timestamp;
        try {
            localStorage.setItem(STORAGE_KEYS.DISCORD_LAST_UPDATE, timestamp.toString());
        } catch (e) {
            console.warn('Ошибка сохранения времени обновления:', e);
        }
    }

    /**
     * Проверить, нужно ли обновлять Discord данные (прошло более 1 дня)
     * @returns {boolean} true если нужно обновить
     */
    function shouldUpdateDiscordData() {
        const lastUpdate = getLastDiscordUpdateTime();
        
        // Если никогда не обновляли - нужно обновить
        if (!lastUpdate) {
            console.log('Discord данные никогда не обновлялись, требуется обновление');
            return true;
        }
        
        const timeSinceLastUpdate = Date.now() - lastUpdate;
        const needsUpdate = timeSinceLastUpdate >= PROFILE_DATA_CONFIG.discordCacheTTL;
        
        if (needsUpdate) {
            const hoursPassed = Math.floor(timeSinceLastUpdate / (60 * 60 * 1000));
            console.log(`Прошло ${hoursPassed} часов с последнего обновления Discord данных, требуется обновление`);
        } else {
            const hoursLeft = Math.floor((PROFILE_DATA_CONFIG.discordCacheTTL - timeSinceLastUpdate) / (60 * 60 * 1000));
            console.log(`Следующее обновление Discord данных через ${hoursLeft} часов`);
        }
        
        return needsUpdate;
    }

    /**
     * Получить время до следующего обновления в читаемом формате
     * @returns {string}
     */
    function getTimeUntilNextDiscordUpdate() {
        const lastUpdate = getLastDiscordUpdateTime();
        if (!lastUpdate) return 'требуется обновление';
        
        const timeSinceLastUpdate = Date.now() - lastUpdate;
        if (timeSinceLastUpdate >= PROFILE_DATA_CONFIG.discordCacheTTL) {
            return 'требуется обновление';
        }
        
        const timeLeft = PROFILE_DATA_CONFIG.discordCacheTTL - timeSinceLastUpdate;
        const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
        const minutesLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
        
        if (hoursLeft > 0) {
            return `${hoursLeft} ч ${minutesLeft} мин`;
        }
        return `${minutesLeft} мин`;
    }

    // ==================== РАБОТА СО СТАТУСОМ ПОДПИСКИ ====================
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

    async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
        try {
            const response = await fetchWithTimeout(url, options.timeout || PROFILE_DATA_CONFIG.requestTimeout);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchWithRetry(url, options, retries - 1, delay * 2);
            }
            throw error;
        }
    }

    // ==================== ЗАГРУЗКА ДАННЫХ ПОЛЬЗОВАТЕЛЕЙ ====================
    async function fetchAllUsers() {
        try {
            const response = await fetchWithTimeout(PROFILE_DATA_CONFIG.hwidApiUrl, PROFILE_DATA_CONFIG.requestTimeout);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!Array.isArray(data)) return [];
            
            return data.map(item => parseUserFromApiItem(item));
        } catch (error) {
            console.error('Ошибка загрузки пользователей:', error);
            return [];
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

    // ==================== DISCORD ДАННЫЕ ====================
    
    /**
     * Проверить, актуален ли кэш Discord данных для конкретного пользователя
     * @param {string} discordId 
     * @returns {boolean}
     */
    function isDiscordCacheValid(discordId) {
        try {
            const stored = localStorage.getItem(`${STORAGE_KEYS.DISCORD_USER_PREFIX}${discordId}`);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed.timestamp) {
                    const age = Date.now() - parsed.timestamp;
                    return age < PROFILE_DATA_CONFIG.discordCacheTTL;
                }
            }
        } catch (e) {}
        return false;
    }

    async function fetchSingleDiscordUser(discordId, retryCount = 0) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) return null;
        const maxRetries = 3;
        
        try {
            const url = `${PROFILE_DATA_CONFIG.discordApiBase}${discordId}`;
            const response = await fetchWithTimeout(url, PROFILE_DATA_CONFIG.discordRequestTimeout);
            
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After') || 5;
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return fetchSingleDiscordUser(discordId, retryCount);
            }
            
            if (!response.ok) return null;
            const data = await response.json();
            if (data && (data.username || data.global_name)) {
                return data;
            }
            return null;
        } catch (error) {
            if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                return fetchSingleDiscordUser(discordId, retryCount + 1);
            }
            return null;
        }
    }

    async function fetchMultipleDiscordUsers(discordIds) {
        const uniqueIds = [...new Set(discordIds.filter(id => id && id.match(/^\d{17,19}$/)))];
        if (uniqueIds.length === 0) return [];
        
        const results = [];
        const chunkSize = 5;
        
        for (let i = 0; i < uniqueIds.length; i += chunkSize) {
            const chunk = uniqueIds.slice(i, i + chunkSize);
            
            for (const id of chunk) {
                const data = await fetchSingleDiscordUser(id);
                if (data) {
                    results.push({ discordId: id, data: data });
                    discordDataCache.set(id, {
                        data: data,
                        timestamp: Date.now()
                    });
                    // Сохраняем в localStorage
                    try {
                        localStorage.setItem(`${STORAGE_KEYS.DISCORD_USER_PREFIX}${id}`, JSON.stringify({
                            data: data,
                            timestamp: Date.now()
                        }));
                    } catch(e) {}
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            if (i + chunkSize < uniqueIds.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        return results;
    }

    /**
     * Получить Discord данные пользователя
     * @param {string} discordId 
     * @param {boolean} forceRefresh - принудительное обновление (игнорирует проверку 1 дня)
     * @returns {Promise<Object|null>}
     */
    async function getDiscordUserData(discordId, forceRefresh = false) {
        if (!discordId) return null;
        
        // Если принудительное обновление - игнорируем кэш
        if (!forceRefresh) {
            // Проверяем кэш в памяти
            const cached = discordDataCache.get(discordId);
            if (cached && Date.now() - cached.timestamp < PROFILE_DATA_CONFIG.discordCacheTTL) {
                return cached.data;
            }
            
            // Проверяем localStorage
            try {
                const stored = localStorage.getItem(`${STORAGE_KEYS.DISCORD_USER_PREFIX}${discordId}`);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.data && Date.now() - parsed.timestamp < PROFILE_DATA_CONFIG.discordCacheTTL) {
                        discordDataCache.set(discordId, parsed);
                        return parsed.data;
                    }
                }
            } catch(e) {}
        }
        
        // Проверяем, нужно ли обновлять (если не forceRefresh и прошло меньше 1 дня с последнего общего обновления)
        if (!forceRefresh && !shouldUpdateDiscordData()) {
            console.log(`Discord данные для ${discordId} не обновляются: прошло менее 1 дня с последнего обновления`);
            return null;
        }
        
        // Загружаем свежие данные
        console.log(`Загрузка свежих Discord данных для ${discordId}...`);
        const data = await fetchSingleDiscordUser(discordId);
        if (data) {
            discordDataCache.set(discordId, {
                data: data,
                timestamp: Date.now()
            });
            try {
                localStorage.setItem(`${STORAGE_KEYS.DISCORD_USER_PREFIX}${discordId}`, JSON.stringify({
                    data: data,
                    timestamp: Date.now()
                }));
            } catch(e) {}
        }
        return data;
    }

    /**
     * Массовое обновление Discord данных (только если прошло более 1 дня)
     * @param {string[]} discordIds 
     * @param {Function} onProgress 
     * @param {boolean} forceRefresh - принудительное обновление
     * @returns {Promise<Object[]>}
     */
    async function refreshAllDiscordData(discordIds, onProgress, forceRefresh = false) {
        // Проверяем, нужно ли обновление
        if (!forceRefresh && !shouldUpdateDiscordData()) {
            console.log('Массовое обновление Discord данных пропущено: прошло менее 1 дня с последнего обновления');
            if (onProgress) {
                onProgress({ skipped: true, reason: 'not_needed', nextUpdateIn: getTimeUntilNextDiscordUpdate() });
            }
            return [];
        }
        
        if (updateInProgress && !forceRefresh) {
            console.log('Обновление уже выполняется');
            return [];
        }
        
        updateInProgress = true;
        const uniqueIds = [...new Set(discordIds.filter(id => id && id.match(/^\d{17,19}$/)))];
        const results = [];
        
        console.log(`Начинаем массовое обновление Discord данных для ${uniqueIds.length} пользователей...`);
        
        for (let i = 0; i < uniqueIds.length; i++) {
            const id = uniqueIds[i];
            if (onProgress) {
                onProgress({ current: i + 1, total: uniqueIds.length, discordId: id });
            }
            
            const data = await fetchSingleDiscordUser(id);
            if (data) {
                results.push({ discordId: id, data: data });
                discordDataCache.set(id, {
                    data: data,
                    timestamp: Date.now()
                });
                try {
                    localStorage.setItem(`${STORAGE_KEYS.DISCORD_USER_PREFIX}${id}`, JSON.stringify({
                        data: data,
                        timestamp: Date.now()
                    }));
                } catch(e) {}
            }
            
            // Задержка между запросами
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Обновляем время последнего обновления
        setLastDiscordUpdateTime();
        updateInProgress = false;
        
        console.log(`Обновление завершено. Обновлено ${results.length} из ${uniqueIds.length} пользователей`);
        
        if (onProgress) {
            onProgress({ completed: true, updated: results.length, total: uniqueIds.length });
        }
        
        return results;
    }

    // ==================== АВАТАРЫ ====================
    async function loadAvatarWithFallback(discordCdnUrl, timeoutMs = PROFILE_DATA_CONFIG.avatarTimeout) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Timeout'));
            }, timeoutMs);
            
            function cleanup() {
                clearTimeout(timeout);
                img.onload = null;
                img.onerror = null;
            }
            
            img.onload = () => { cleanup(); resolve(discordCdnUrl); };
            img.onerror = () => { cleanup(); reject(new Error('Load error')); };
            img.src = discordCdnUrl;
        });
    }

    async function loadAvatarViaProxy(discordCdnUrl, timeoutMs = 8000) {
        const proxyUrl = `${PROFILE_DATA_CONFIG.proxy}"${discordCdnUrl}"`;
        return new Promise((resolve, reject) => {
            const img = new Image();
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`Proxy timeout ${timeoutMs}ms`));
            }, timeoutMs);
            
            function cleanup() {
                clearTimeout(timeout);
                img.onload = null;
                img.onerror = null;
            }
            
            img.onload = () => { cleanup(); resolve(proxyUrl); };
            img.onerror = () => { cleanup(); reject(new Error('Proxy load error')); };
            img.src = proxyUrl;
        });
    }

    async function getDiscordAvatarUrl(discordId, avatarHash) {
        if (!discordId || !avatarHash) return null;
        
        const cacheKey = `avatar_${discordId}`;
        const cached = avatarCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < PROFILE_DATA_CONFIG.cacheTTL) {
            return cached.url;
        }
        
        const discordCdnPng = `https://divine-surf-da82.fascord.workers.dev/avatars/${discordId}/${avatarHash}.png`;
        const discordCdnGif = `https://divine-surf-da82.fascord.workers.dev/avatars/${discordId}/${avatarHash}.gif`;
        
        try {
            await loadAvatarWithFallback(discordCdnGif, 3000);
            avatarCache.set(cacheKey, { url: discordCdnGif, timestamp: Date.now() });
            return discordCdnGif;
        } catch {
            try {
                await loadAvatarWithFallback(discordCdnPng, 3000);
                avatarCache.set(cacheKey, { url: discordCdnPng, timestamp: Date.now() });
                return discordCdnPng;
            } catch {
                return null;
            }
        }
    }

    // ==================== ФОРМАТИРОВАНИЕ ДАННЫХ ДЛЯ ОТОБРАЖЕНИЯ ====================
    function getDisplayName(userInfo, discordData) {
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

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    function init() {
        // Загружаем время последнего обновления при старте
        getLastDiscordUpdateTime();
        console.log('ProfileData модуль инициализирован');
        console.log(`Discord кэш действителен в течение: ${PROFILE_DATA_CONFIG.discordCacheTTL / (60 * 60 * 1000)} часов`);
        console.log(`Последнее обновление Discord: ${lastDiscordUpdate ? new Date(lastDiscordUpdate).toLocaleString() : 'никогда'}`);
    }

    // ==================== ЭКСПОРТ ====================
    window.ProfileData = {
        // Конфиг
        config: PROFILE_DATA_CONFIG,
        
        // Парсинг
        parseUserFromApiItem: parseUserFromApiItem,
        getSubscriptionStatus: getSubscriptionStatus,
        
        // Получение данных
        fetchAllUsers: fetchAllUsers,
        fetchUserByHwid: fetchUserByHwid,
        fetchUserByDiscordId: fetchUserByDiscordId,
        fetchUserByTelegramId: fetchUserByTelegramId,
        
        // Discord данные
        getDiscordUserData: getDiscordUserData,
        fetchMultipleDiscordUsers: fetchMultipleDiscordUsers,
        refreshAllDiscordData: refreshAllDiscordData,
        
        // Управление временем обновления Discord
        shouldUpdateDiscordData: shouldUpdateDiscordData,
        getLastDiscordUpdateTime: getLastDiscordUpdateTime,
        setLastDiscordUpdateTime: setLastDiscordUpdateTime,
        getTimeUntilNextDiscordUpdate: getTimeUntilNextDiscordUpdate,
        isDiscordCacheValid: isDiscordCacheValid,
        
        // Аватары
        getDiscordAvatarUrl: getDiscordAvatarUrl,
        loadAvatarWithFallback: loadAvatarWithFallback,
        
        // Форматирование
        getDisplayName: getDisplayName,
        getShortHwid: getShortHwid,
        getAvatarLetter: getAvatarLetter,
        getDaysWord: getDaysWord,
        formatDate: formatDate,
        
        // Утилиты
        escapeHtml: escapeHtml,
        fetchWithTimeout: fetchWithTimeout,
        
        // Кэш
        clearCache: () => {
            discordDataCache.clear();
            userDataCache.clear();
            avatarCache.clear();
        }
    };
    
    // Автоматическая инициализация
    init();
})();