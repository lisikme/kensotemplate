// profile-data.js - универсальный модуль для работы с данными профиля
// Версия 6.2 - исправлен CORS, используется Steam API Worker

(function() {
    // ==================== КОНФИГУРАЦИЯ ====================
    const PROFILE_DATA_CONFIG = {
        spreadsheetId: '1hYhAb_3EVcHmj7c8cgAjXMoF6HCqqjUeb9SSKXHs8TA',
        sheetGid: '834339051',
        usersCsvUrl: 'https://docs.google.com/spreadsheets/d/1hYhAb_3EVcHmj7c8cgAjXMoF6HCqqjUeb9SSKXHs8TA/gviz/tq?tqx=out:csv&gid=834339051',
        launchesCsvUrl: 'https://docs.google.com/spreadsheets/d/1QkxxCV3wXIJ4erRZykyIn7Se9qhqOD2k-5H3WD4waFY/gviz/tq?tqx=out:csv&gid=834339051',
        killsCsvUrl: 'https://docs.google.com/spreadsheets/d/1QkxxCV3wXIJ4erRZykyIn7Se9qhqOD2k-5H3WD4waFY/gviz/tq?tqx=out:csv&gid=1739800569',
        // Steam API Worker URL
        steamApiUrl: 'https://steam-api.fascord.workers.dev/api',
        tableCacheTTL: 5 * 60 * 1000,
        launchesCacheTTL: 60 * 1000,
        avatarCacheTTL: 60 * 60 * 1000,
        steamCacheTTL: 60 * 60 * 1000,
        killsCacheTTL: 60 * 1000,
        requestTimeout: 15000,
        avatarTimeout: 5000
    };

    const STORAGE_KEYS = {
        USERS_CACHE_KEY: 'users_list_cache_v6',
        AVATAR_CACHE_KEY: 'avatar_url_cache_v5',
        LAUNCHES_CACHE_KEY: 'launches_cache_v3',
        STEAM_CACHE_KEY: 'steam_data_cache_v2',
        KILLS_CACHE_KEY: 'kills_stats_cache_v7',
        KILLS_FETCHED_KEY: 'kills_fetched_flag',
        LAST_UPDATE_KEY: 'last_table_update_time'
    };

    const userDataCache = new Map();
    const avatarCache = new Map();
    const launchesCache = new Map();
    const steamCache = new Map();
    let killsMap = new Map();
    let killsLoaded = false;
    let killsLoadPromise = null;
    let lastKillsFetchTime = 0;
    let lastLaunchesFetchTime = 0;
    let launchesLoadPromise = null;
    
    // Очередь для Steam запросов (дедупликация)
    let steamPendingRequests = new Map();

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

    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }

    function parseCSVToRows(csvText) {
        const rows = [];
        let currentRow = [];
        let currentField = '';
        let inQuotes = false;
        
        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = csvText[i + 1];
            
            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    currentField += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                currentRow.push(currentField);
                currentField = '';
            } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                if (char === '\r') i++;
            } else if (char === '\r' && !inQuotes) {
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
            } else {
                currentField += char;
            }
        }
        
        if (currentField !== '' || currentRow.length > 0) {
            currentRow.push(currentField);
            rows.push(currentRow);
        }
        
        while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
            rows.pop();
        }
        
        return rows;
    }

    function parseUserFromCsvRow(row, headers) {
        let idx0 = 0, idx1 = 1, idx2 = 2, idx3 = 3, idx4 = 4, idx5 = 5;
        let idx6 = 6, idx7 = 7, idx8 = 8, idx9 = 9, idx10 = 10, idx11 = 11;
        
        if (headers && headers.length > 0) {
            const headerMap = {};
            headers.forEach((h, i) => { headerMap[h.toLowerCase()] = i; });
            
            idx0 = headerMap['hwid'] ?? headerMap['tab0'] ?? 0;
            idx1 = headerMap['license'] ?? headerMap['tab1'] ?? 1;
            idx2 = headerMap['role'] ?? headerMap['tab2'] ?? 2;
            idx3 = headerMap['limit'] ?? headerMap['tab3'] ?? 3;
            idx4 = headerMap['timeleft'] ?? headerMap['tab4'] ?? 4;
            idx5 = headerMap['enddate'] ?? headerMap['tab5'] ?? 5;
            idx6 = headerMap['discord'] ?? headerMap['tab6'] ?? 6;
            idx7 = headerMap['telegram'] ?? headerMap['tab7'] ?? 7;
            idx8 = headerMap['banreason'] ?? headerMap['tab8'] ?? 8;
            idx9 = headerMap['username'] ?? headerMap['tab9'] ?? 9;
            idx10 = headerMap['avatarhash'] ?? headerMap['tab10'] ?? 10;
            idx11 = headerMap['steamid'] ?? headerMap['tab11'] ?? 11;
        }
        
        const hwid = row[idx0] || '';
        const licenseStatus = row[idx1] || '';
        const role = row[idx2] || 'Игрок';
        const limitType = row[idx3] || '';
        const remainingTime = row[idx4] || '';
        const endDateRaw = row[idx5] || '';
        const discordId = row[idx6] || null;
        const telegramId = row[idx7] || null;
        const banReason = row[idx8] || null;
        const userName = row[idx9] || null;
        const avatarHash = row[idx10] || null;
        const steamId = row[idx11] || null;
        
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
        else if (role === 'Партнёр - RE:HVH') roleClass = 'partner-rehvh';
        else if (role === 'Менеджер') roleClass = 'manager';
        else if (role === 'Админ') roleClass = 'admin';
        else if (role === 'Партнёр') roleClass = 'partner';
        else if (role === 'Медиа') roleClass = 'media';
        else if (role === 'Игрок') roleClass = 'player';

        return {
            hwid: hwid,
            discordId: discordId,
            telegramId: telegramId,
            steamId: steamId,
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

    // ==================== ЗАГРУЗКА ПОЛЬЗОВАТЕЛЕЙ ====================
    async function fetchAllUsers(retryCount = 0) {
        const maxRetries = 5;
        const retryDelays = [1000, 2000, 3000, 5000, 10000];
        
        try {
            console.log(`Загрузка пользователей из Google Sheets (попытка ${retryCount + 1}/${maxRetries})...`);
            const cacheBuster = `&_nocache=${Date.now()}`;
            const csvUrl = PROFILE_DATA_CONFIG.usersCsvUrl + (PROFILE_DATA_CONFIG.usersCsvUrl.includes('?') ? cacheBuster : `?t=${Date.now()}`);
            
            const response = await fetchWithTimeout(csvUrl, PROFILE_DATA_CONFIG.requestTimeout);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const csvText = await response.text();
            const rows = parseCSVToRows(csvText);
            
            if (rows.length < 2) {
                console.log('Получен пустой CSV');
                if (retryCount < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelays[retryCount]));
                    return fetchAllUsers(retryCount + 1);
                }
                return [];
            }
            
            const headers = rows[0].map(h => String(h || '').trim());
            const users = [];
            
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;
                if (row[0] && row[0].trim() !== '') {
                    const user = parseUserFromCsvRow(row, headers);
                    if (user.hwid) {
                        users.push(user);
                    }
                }
            }
            
            console.log(`Успешно загружено ${users.length} пользователей из Google Sheets`);
            return users;
            
        } catch (error) {
            console.error(`Ошибка загрузки из Google Sheets (попытка ${retryCount + 1}):`, error);
            if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelays[retryCount]));
                return fetchAllUsers(retryCount + 1);
            }
            return [];
        }
    }

    function loadUsersFromCache() {
        try {
            const cached = localStorage.getItem(STORAGE_KEYS.USERS_CACHE_KEY);
            if (cached) {
                const cache = JSON.parse(cached);
                const cacheAge = Date.now() - (cache.timestamp || 0);
                if (cacheAge < PROFILE_DATA_CONFIG.tableCacheTTL && cache.users && cache.users.length > 0) {
                    console.log(`Загружено ${cache.users.length} пользователей из кэша`);
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
            console.log(`Сохранено ${users.length} пользователей в кэш`);
        } catch (e) {
            console.warn('Ошибка сохранения кэша пользователей:', e);
        }
    }

    async function getUsersTable(forceRefresh = false) {
        try {
            if (!forceRefresh) {
                const cachedUsers = loadUsersFromCache();
                if (cachedUsers && cachedUsers.length > 0) {
                    cachedUsers.forEach(user => {
                        if (user.hwid) {
                            userDataCache.set(user.hwid, { data: user, timestamp: Date.now() });
                        }
                    });
                    return cachedUsers;
                }
            }
            
            const freshUsers = await fetchAllUsers();
            if (freshUsers && freshUsers.length > 0) {
                saveUsersToCache(freshUsers);
                freshUsers.forEach(user => {
                    if (user.hwid) {
                        userDataCache.set(user.hwid, { data: user, timestamp: Date.now() });
                    }
                });
                return freshUsers;
            } else {
                const cached = loadUsersFromCache();
                if (cached) return cached;
                return [];
            }
        } catch (error) {
            console.error('Ошибка получения таблицы пользователей:', error);
            const cached = loadUsersFromCache();
            if (cached) return cached;
            return [];
        }
    }

    async function fetchUserByHwid(hwid) {
        if (!hwid) return null;
        const cached = userDataCache.get(hwid);
        if (cached && cached.data) return cached.data;
        const users = await getUsersTable();
        const user = users.find(u => u.hwid === hwid);
        if (user) userDataCache.set(hwid, { data: user, timestamp: Date.now() });
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

    // ==================== ЗАГРУЗКА СТАТИСТИКИ УБИЙСТВ ====================
    function isKillsCacheExpired() {
        if (lastKillsFetchTime === 0) return true;
        return (Date.now() - lastKillsFetchTime) >= PROFILE_DATA_CONFIG.killsCacheTTL;
    }
    
    async function loadAllKillsOnce(forceRefresh = false) {
        if (forceRefresh) {
            killsLoaded = false;
            killsLoadPromise = null;
            killsMap.clear();
        }
        
        if (killsLoadPromise) {
            return killsLoadPromise;
        }
        
        if (killsLoaded && !isKillsCacheExpired() && killsMap.size > 0) {
            console.log(`Убийства уже загружены (${killsMap.size} записей)`);
            return killsMap;
        }
        
        if (isKillsCacheExpired() && killsMap.size > 0) {
            console.log('Кэш убийств устарел, обновляем...');
            killsMap.clear();
            killsLoaded = false;
        }
        
        try {
            const cachedData = localStorage.getItem(STORAGE_KEYS.KILLS_CACHE_KEY);
            if (cachedData && !forceRefresh) {
                const cache = JSON.parse(cachedData);
                const cacheAge = Date.now() - (cache.timestamp || 0);
                if (cacheAge < PROFILE_DATA_CONFIG.killsCacheTTL) {
                    console.log(`Загружено убийств из localStorage кэша`);
                    killsMap = new Map(Object.entries(cache.data || {}));
                    killsLoaded = true;
                    lastKillsFetchTime = cache.timestamp || Date.now();
                    return killsMap;
                }
            }
        } catch (e) {
            console.warn('Ошибка чтения кэша убийств:', e);
        }
        
        killsLoadPromise = (async () => {
            try {
                console.log('Загрузка статистики убийств из Google Sheets...');
                const cacheBuster = `&_nocache=${Date.now()}`;
                const csvUrl = PROFILE_DATA_CONFIG.killsCsvUrl + (PROFILE_DATA_CONFIG.killsCsvUrl.includes('?') ? cacheBuster : `?t=${Date.now()}`);
                
                const response = await fetchWithTimeout(csvUrl, PROFILE_DATA_CONFIG.requestTimeout);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                const csvText = await response.text();
                const rows = parseCSVToRows(csvText);
                
                if (rows.length < 2) {
                    console.log('Нет данных убийств в CSV');
                    return killsMap;
                }
                
                console.log(`Загружено ${rows.length - 1} записей статистики убийств`);
                
                const newMap = new Map();
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.length < 2) continue;
                    const hwid = row[0] || '';
                    let kills = parseInt(row[1]) || 0;
                    if (hwid && !isNaN(kills)) {
                        newMap.set(String(hwid).trim(), kills);
                    }
                }
                
                console.log(`Построен Map убийств: ${newMap.size} уникальных HWID`);
                
                try {
                    const cacheData = {
                        data: Object.fromEntries(newMap),
                        timestamp: Date.now()
                    };
                    localStorage.setItem(STORAGE_KEYS.KILLS_CACHE_KEY, JSON.stringify(cacheData));
                } catch (e) {
                    console.warn('Ошибка сохранения кэша убийств:', e);
                }
                
                killsMap = newMap;
                killsLoaded = true;
                lastKillsFetchTime = Date.now();
                return killsMap;
                
            } catch (error) {
                console.error('Ошибка загрузки статистики убийств:', error);
                return killsMap;
            } finally {
                killsLoadPromise = null;
            }
        })();
        
        return killsLoadPromise;
    }
    
    async function fetchKillsByHwid(hwid, forceRefresh = false) {
        if (!hwid) return 0;
        if (forceRefresh) {
            await loadAllKillsOnce(true);
        } else {
            await loadAllKillsOnce();
        }
        const kills = killsMap.get(String(hwid).trim()) || 0;
        return kills;
    }
    
    function getCachedKills(hwid) {
        if (!hwid) return null;
        if (isKillsCacheExpired()) return null;
        if (killsLoaded && killsMap.has(String(hwid).trim())) {
            return killsMap.get(String(hwid).trim());
        }
        try {
            const cachedData = localStorage.getItem(STORAGE_KEYS.KILLS_CACHE_KEY);
            if (cachedData) {
                const cache = JSON.parse(cachedData);
                const cacheAge = Date.now() - (cache.timestamp || 0);
                if (cacheAge < PROFILE_DATA_CONFIG.killsCacheTTL && cache.data && cache.data[hwid] !== undefined) {
                    return cache.data[hwid];
                }
            }
        } catch (e) {}
        return null;
    }
    
    async function refreshKills() {
        console.log('Принудительное обновление статистики убийств...');
        await loadAllKillsOnce(true);
    }

    // ==================== ЗАГРУЗКА ИСТОРИИ ЗАПУСКОВ ====================
    function isLaunchesCacheExpired() {
        if (lastLaunchesFetchTime === 0) return true;
        return (Date.now() - lastLaunchesFetchTime) >= PROFILE_DATA_CONFIG.launchesCacheTTL;
    }
    
    async function loadAllLaunchesOnce(forceRefresh = false) {
        if (forceRefresh) {
            launchesCache.clear();
            launchesLoadPromise = null;
            lastLaunchesFetchTime = 0;
        }
        
        if (launchesLoadPromise) {
            return launchesLoadPromise;
        }
        
        if (!isLaunchesCacheExpired() && launchesCache.size > 0) {
            console.log(`Логи уже загружены (${launchesCache.size} пользователей)`);
            return launchesCache;
        }
        
        if (isLaunchesCacheExpired() && launchesCache.size > 0) {
            console.log('Кэш логов устарел, обновляем...');
            launchesCache.clear();
        }
        
        try {
            const cachedData = localStorage.getItem(STORAGE_KEYS.LAUNCHES_CACHE_KEY);
            if (cachedData && !forceRefresh) {
                const cache = JSON.parse(cachedData);
                const cacheAge = Date.now() - (cache.timestamp || 0);
                if (cacheAge < PROFILE_DATA_CONFIG.launchesCacheTTL) {
                    console.log(`Загружено логов из localStorage кэша`);
                    for (const [hwid, launches] of Object.entries(cache.data || {})) {
                        launchesCache.set(hwid, { launches: launches, timestamp: cache.timestamp });
                    }
                    lastLaunchesFetchTime = cache.timestamp || Date.now();
                    return launchesCache;
                }
            }
        } catch (e) {
            console.warn('Ошибка чтения кэша логов:', e);
        }
        
        launchesLoadPromise = (async () => {
            try {
                console.log('Загрузка истории запусков из Google Sheets...');
                const cacheBuster = `&_nocache=${Date.now()}`;
                const csvUrl = PROFILE_DATA_CONFIG.launchesCsvUrl + (PROFILE_DATA_CONFIG.launchesCsvUrl.includes('?') ? cacheBuster : `?t=${Date.now()}`);
                
                const response = await fetchWithTimeout(csvUrl, PROFILE_DATA_CONFIG.requestTimeout);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                const csvText = await response.text();
                const rows = parseCSVToRows(csvText);
                
                if (rows.length < 2) {
                    console.log('Нет данных логов в CSV');
                    return launchesCache;
                }
                
                console.log(`Загружено ${rows.length - 1} записей истории запусков`);
                
                const groupedByHwid = new Map();
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.length < 2) continue;
                    const hwid = row[1] || '';
                    if (!hwid) continue;
                    
                    if (!groupedByHwid.has(hwid)) {
                        groupedByHwid.set(hwid, []);
                    }
                    groupedByHwid.get(hwid).push({
                        timestamp: row[0] || '',
                        steamId: row[2] || null,
                        version: row[3] || null
                    });
                }
                
                const newCache = new Map();
                for (const [hwid, launches] of groupedByHwid) {
                    launches.sort((a, b) => {
                        const dateA = new Date(a.timestamp);
                        const dateB = new Date(b.timestamp);
                        return dateB - dateA;
                    });
                    newCache.set(hwid, { launches: launches, timestamp: Date.now() });
                }
                
                console.log(`Построен кэш логов: ${newCache.size} уникальных HWID`);
                
                try {
                    const cacheData = {
                        data: Object.fromEntries(
                            Array.from(newCache.entries()).map(([hwid, value]) => [hwid, value.launches])
                        ),
                        timestamp: Date.now()
                    };
                    localStorage.setItem(STORAGE_KEYS.LAUNCHES_CACHE_KEY, JSON.stringify(cacheData));
                } catch (e) {
                    console.warn('Ошибка сохранения кэша логов:', e);
                }
                
                for (const [hwid, value] of newCache) {
                    launchesCache.set(hwid, value);
                }
                lastLaunchesFetchTime = Date.now();
                return launchesCache;
                
            } catch (error) {
                console.error('Ошибка загрузки истории запусков:', error);
                return launchesCache;
            } finally {
                launchesLoadPromise = null;
            }
        })();
        
        return launchesLoadPromise;
    }
    
    async function fetchLaunchesByHwid(hwid, forceRefresh = false) {
        if (!hwid) return [];
        if (forceRefresh) {
            await loadAllLaunchesOnce(true);
        } else {
            await loadAllLaunchesOnce();
        }
        const cached = launchesCache.get(hwid);
        if (cached && cached.launches) {
            return cached.launches;
        }
        return [];
    }
    
    async function refreshLaunches() {
        console.log('Принудительное обновление истории запусков...');
        await loadAllLaunchesOnce(true);
    }

    // ==================== STEAM API ЧЕРЕЗ WORKER (без CORS) ====================
    
    function isSteamCacheValid(steamId) {
        const cached = steamCache.get(steamId);
        if (!cached) return false;
        return (Date.now() - cached.timestamp) < PROFILE_DATA_CONFIG.steamCacheTTL;
    }
    
    async function fetchSteamData(steamId) {
        if (!steamId) return null;
        
        // Проверяем кэш в памяти
        if (isSteamCacheValid(steamId)) {
            return steamCache.get(steamId).data;
        }
        
        // Дедупликация запросов
        if (steamPendingRequests.has(steamId)) {
            return steamPendingRequests.get(steamId);
        }
        
        // Проверяем localStorage кэш
        try {
            const cachedData = localStorage.getItem(STORAGE_KEYS.STEAM_CACHE_KEY);
            if (cachedData) {
                const cache = JSON.parse(cachedData);
                if (cache[steamId] && (Date.now() - cache[steamId].timestamp) < PROFILE_DATA_CONFIG.steamCacheTTL) {
                    const data = cache[steamId].data;
                    steamCache.set(steamId, { data: data, timestamp: cache[steamId].timestamp });
                    return data;
                }
            }
        } catch (e) {
            console.warn('Ошибка чтения кэша Steam:', e);
        }
        
        const promise = (async () => {
            try {
                // Используем Steam API Worker вместо прямого запроса к Steam
                const url = `${PROFILE_DATA_CONFIG.steamApiUrl}/${steamId}`;
                console.log(`Запрос Steam данных через Worker: ${url}`);
                
                const response = await fetchWithTimeout(url, 10000);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                
                // Форматируем данные в единый формат
                const formattedData = {
                    steamId: data.steamId || steamId,
                    username: data.username || steamId,
                    avatar: data.avatar || data.avatarIcon || null,
                    avatarMedium: data.avatarMedium || null,
                    avatarFull: data.avatarFull || null,
                    profileUrl: data.profileUrl || `https://steamcommunity.com/profiles/${steamId}/`,
                    realName: data.realName || null,
                    location: data.location || null,
                    memberSince: data.memberSince || null,
                    personaState: data.personaState || null,
                    isPublic: data.isPublic !== false,
                    error: data.error || null
                };
                
                // Сохраняем в кэши
                steamCache.set(steamId, { data: formattedData, timestamp: Date.now() });
                saveSteamToCache(steamId, formattedData);
                
                return formattedData;
                
            } catch (error) {
                console.error(`Ошибка загрузки Steam данных для ${steamId}:`, error);
                const errorData = { 
                    error: 'network', 
                    message: 'Ошибка сети',
                    steamId: steamId,
                    username: steamId
                };
                steamCache.set(steamId, { data: errorData, timestamp: Date.now() });
                return errorData;
            } finally {
                steamPendingRequests.delete(steamId);
            }
        })();
        
        steamPendingRequests.set(steamId, promise);
        return promise;
    }
    
    // Пакетная загрузка Steam данных
    async function fetchSteamDataBatch(steamIds) {
        if (!steamIds || steamIds.length === 0) return new Map();
        
        const uniqueIds = [...new Set(steamIds.filter(id => id && id.trim()))];
        const results = new Map();
        
        console.log(`Пакетная загрузка Steam данных для ${uniqueIds.length} ID`);
        
        // Загружаем параллельно с ограничением
        const batchSize = 5;
        const delayBetweenBatches = 200;
        
        for (let i = 0; i < uniqueIds.length; i += batchSize) {
            const batch = uniqueIds.slice(i, i + batchSize);
            
            const batchResults = await Promise.all(
                batch.map(async (steamId) => {
                    try {
                        const data = await fetchSteamData(steamId);
                        return { steamId, data };
                    } catch (error) {
                        console.error(`Ошибка загрузки Steam для ${steamId}:`, error);
                        return { 
                            steamId, 
                            data: { error: 'network', message: 'Ошибка сети', username: steamId }
                        };
                    }
                })
            );
            
            for (const { steamId, data } of batchResults) {
                results.set(steamId, data);
            }
            
            if (i + batchSize < uniqueIds.length) {
                await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
            }
        }
        
        return results;
    }
    
    function saveSteamToCache(steamId, data) {
        try {
            const existingCache = localStorage.getItem(STORAGE_KEYS.STEAM_CACHE_KEY);
            const newCache = existingCache ? JSON.parse(existingCache) : {};
            newCache[steamId] = { data: data, timestamp: Date.now() };
            // Ограничиваем размер кэша (храним не более 1000 записей)
            const keys = Object.keys(newCache);
            if (keys.length > 1000) {
                const sortedKeys = keys.sort((a, b) => newCache[a].timestamp - newCache[b].timestamp);
                for (let i = 0; i < 200; i++) {
                    delete newCache[sortedKeys[i]];
                }
            }
            localStorage.setItem(STORAGE_KEYS.STEAM_CACHE_KEY, JSON.stringify(newCache));
        } catch (e) {
            console.warn('Ошибка сохранения кэша Steam:', e);
        }
    }
    
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
        } catch (e) {}
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
        } catch (e) {}
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
            img.src = `https://proxy4.krcorp.ru/api/proxy?url=https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=128`;
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
        const avatarUrl = `https://proxy4.krcorp.ru/api/proxy?url=https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=128`;
        try {
            await loadAvatarFromCdn(discordId, avatarHash);
            saveAvatarToCache(discordId, avatarUrl);
            avatarCache.set(cacheKey, { url: avatarUrl, timestamp: Date.now() });
            return avatarUrl;
        } catch (error) {
            return null;
        }
    }

    // ==================== ФОРМАТИРОВАНИЕ ====================
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

    function getSubscriptionStatus(userInfo) {
        if (!userInfo) return { status: 'expired', text: 'Нет данных', daysLeft: null, formattedTime: null };
        if (userInfo.isBanned) return { status: 'banned', text: 'Блокировка', daysLeft: null, formattedTime: null };
        if (userInfo.noLicense) return { status: 'nolicense', text: 'Нет лицензии', daysLeft: null, formattedTime: null };
        if (userInfo.isForever) return { status: 'forever', text: 'Навсегда', daysLeft: null, formattedTime: null };
        if (userInfo.isExpired) return { status: 'expired', text: 'Истёк', daysLeft: 0, formattedTime: null };
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

    function clearAllCache() {
        userDataCache.clear();
        avatarCache.clear();
        launchesCache.clear();
        steamCache.clear();
        steamPendingRequests.clear();
        killsMap.clear();
        killsLoaded = false;
        lastKillsFetchTime = 0;
        killsLoadPromise = null;
        lastLaunchesFetchTime = 0;
        launchesLoadPromise = null;
        try {
            localStorage.removeItem(STORAGE_KEYS.USERS_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.AVATAR_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.LAUNCHES_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.STEAM_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.KILLS_CACHE_KEY);
            localStorage.removeItem(STORAGE_KEYS.KILLS_FETCHED_KEY);
            localStorage.removeItem(STORAGE_KEYS.LAST_UPDATE_KEY);
            console.log('Весь кэш очищен');
        } catch(e) {}
    }

    async function init() {
        console.log('ProfileData модуль инициализирован (Версия 6.2 - исправлен CORS)');
        loadAllKillsOnce().catch(e => console.warn('Ошибка предзагрузки убийств:', e));
        loadAllLaunchesOnce().catch(e => console.warn('Ошибка предзагрузки логов:', e));
        const users = await getUsersTable();
        if (users && users.length > 0) {
            console.log(`Инициализация завершена, загружено ${users.length} пользователей`);
        }
    }
    
    init();

    window.ProfileData = {
        config: PROFILE_DATA_CONFIG,
        parseUserFromApiItem: (item) => parseUserFromCsvRow([item.Tab0, item.Tab1, item.Tab2, item.Tab3, item.Tab4, item.Tab5, item.Tab6, item.Tab7, item.Tab8, item.Tab9, item.Tab10, item.Tab11], null),
        getSubscriptionStatus: getSubscriptionStatus,
        fetchAllUsers: getUsersTable,
        fetchUserByHwid: fetchUserByHwid,
        fetchUserByDiscordId: fetchUserByDiscordId,
        fetchUserByTelegramId: fetchUserByTelegramId,
        fetchLaunchesByHwid: fetchLaunchesByHwid,
        refreshLaunches: refreshLaunches,
        fetchSteamData: fetchSteamData,
        fetchSteamDataBatch: fetchSteamDataBatch,
        getCachedSteamData: getCachedSteamData,
        fetchKillsByHwid: fetchKillsByHwid,
        getCachedKills: getCachedKills,
        refreshKills: refreshKills,
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
        forceRefreshTable: () => getUsersTable(true),
        getLastUpdateTime: () => localStorage.getItem(STORAGE_KEYS.LAST_UPDATE_KEY)
    };
})();