document.addEventListener('DOMContentLoaded', function() {
    const config = {
        adminsJsonUrl: 'https://lisikme.github.io/Nixware-allowed/admins.json',
        hwidJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/hwid4.json',
        tempJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/temps.json',
        discordJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/discords.json',
        telegramJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/telegrams.json',
        bansJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/bans.json',
        discordApiBase: 'https://dis-api.sakuri.ru/api/discord/user/',
        discordBatchApi: 'https://dis-api.sakuri.ru/api/discord/users',
        proxy: 'https://proxy.sakuri.ru/api/proxy?url='
    };
    
    // Кэш данные
    const discordDataCache = new Map();
    
    // Константы кэширования
    const CACHE_TTL = 60 * 60 * 1000; // 1 час
    const LAST_UPDATE_KEY = 'last_discord_update';
    const UPDATE_INTERVAL = 60 * 60 * 1000; // Обновлять кэш раз в час
    
    // Флаг что обновление уже запущено
    let updateInProgress = false;
    let draftDataLoaded = false;
    let draftUsers = [];
    let draftAdminDiscordIds = [];
    
    // Карта для отслеживания загружаемых аватаров
    const loadingAvatars = new Map();
    const loadedAvatars = new Set();
    
    class AvatarQueue {
        constructor(maxConcurrent = 3, delayBetweenBatches = 500) {
            this.maxConcurrent = maxConcurrent;
            this.delayBetweenBatches = delayBetweenBatches;
            this.current = 0;
            this.queue = [];
            this.lastBatchTime = 0;
        }
        
        add(task) {
            return new Promise((resolve, reject) => {
                this.queue.push({ task, resolve, reject });
                this.run();
            });
        }
        
        async run() {
            const now = Date.now();
            const timeSinceLastBatch = now - this.lastBatchTime;
            
            if (timeSinceLastBatch < this.delayBetweenBatches) {
                setTimeout(() => this.run(), this.delayBetweenBatches - timeSinceLastBatch);
                return;
            }
            
            if (this.current >= this.maxConcurrent || this.queue.length === 0) return;
            
            this.lastBatchTime = Date.now();
            const batchSize = Math.min(this.maxConcurrent - this.current, this.queue.length);
            const batch = this.queue.splice(0, batchSize);
            
            this.current += batch.length;
            
            batch.forEach(async ({ task, resolve, reject }) => {
                try {
                    resolve(await task());
                } catch (error) {
                    reject(error);
                } finally {
                    this.current--;
                    this.run();
                }
            });
        }
    }
    
    const avatarLoadQueue = new AvatarQueue(3, 300);
    
    function isCacheValid(cachedItem) {
        if (!cachedItem) return false;
        if (!cachedItem.data) return false;
        if (Date.now() - cachedItem.timestamp > CACHE_TTL) return false;
        return true;
    }
    
    function isDataCorrupted(data) {
        if (!data) return true;
        if (!data.username && !data.global_name && !data.id) return true;
        return false;
    }
    
    function shouldUpdateCache() {
        const lastUpdate = localStorage.getItem(LAST_UPDATE_KEY);
        if (!lastUpdate) return true;
        const timeSinceLastUpdate = Date.now() - parseInt(lastUpdate);
        return timeSinceLastUpdate >= UPDATE_INTERVAL;
    }
    
    function setLastUpdateTime() {
        localStorage.setItem(LAST_UPDATE_KEY, Date.now().toString());
    }
    
    async function loadImageDirect(url, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`Direct timeout ${timeoutMs}ms`));
            }, timeoutMs);
            
            function cleanup() {
                clearTimeout(timeout);
                img.onload = null;
                img.onerror = null;
            }
            
            img.onload = () => { cleanup(); resolve(url); };
            img.onerror = () => { cleanup(); reject(new Error('Direct load error')); };
            img.src = url;
        });
    }
    
    async function loadImageViaProxy(url, timeoutMs = 10000) {
        const proxyUrl = `${config.proxy}"${url}"`;
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
    
    async function loadAvatarWithFallback(discordCdnUrl, timeoutMs = 8000) {
        try {
            return await loadImageDirect(discordCdnUrl, timeoutMs);
        } catch (directError) {
            console.warn(`Direct load failed, trying proxy...`, directError.message);
            try {
                return await loadImageViaProxy(discordCdnUrl, timeoutMs + 2000);
            } catch (proxyError) {
                throw new Error(`Both failed: ${proxyError.message}`);
            }
        }
    }
    
    async function fetchSingleDiscordUser(discordId, retryCount = 0) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) return null;
        
        const maxRetries = 3;
        const baseDelay = 1000;
        
        try {
            const url = `${config.discordApiBase}${discordId}`;
            const response = await fetchWithTimeout(url, 10000);
            
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After') || 5;
                console.warn(`Rate limited for ${discordId}, waiting ${retryAfter}s`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return fetchSingleDiscordUser(discordId, retryCount);
            }
            
            if (response.status === 500) {
                throw new Error(`HTTP 500 Internal Server Error for ${discordId}`);
            }
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data && (data.username || data.global_name)) {
                return data;
            }
            return null;
            
        } catch (error) {
            console.warn(`Fetch failed for ${discordId} (attempt ${retryCount + 1}/${maxRetries + 1}):`, error.message);
            
            if (retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchSingleDiscordUser(discordId, retryCount + 1);
            }
            
            return null;
        }
    }
    
    async function fetchWithTimeout(url, timeoutMs = 10000) {
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
    
    // ИНДИВИДУАЛЬНАЯ ЗАГРУЗКА АВАТАРА СРАЗУ ПОСЛЕ ПОЛУЧЕНИЯ ДАННЫХ
    async function loadAvatarForUser(discordId, userData) {
        if (!discordId || !userData || loadedAvatars.has(discordId)) return;
        
        const avatarElement = document.getElementById(`user-${discordId}-avatar`);
        if (!avatarElement) return;
        
        const cacheKey = `avatar_${discordId}`;
        
        // Проверяем, есть ли уже сохраненный аватар
        const cachedAvatar = localStorage.getItem(cacheKey);
        if (cachedAvatar) {
            try {
                await tryLoadImage(cachedAvatar, 3000);
                avatarElement.src = cachedAvatar;
                avatarElement.style.opacity = '1';
                loadedAvatars.add(discordId);
            } catch (cacheError) {
                localStorage.removeItem(cacheKey);
            }
        }
        
        // Если есть данные об аватаре, загружаем новый
        if (userData.avatar) {
            const avatarHash = userData.avatar;
            const cachedAvatarCurrent = localStorage.getItem(cacheKey);
            const isSameAvatar = cachedAvatarCurrent && cachedAvatarCurrent.includes(avatarHash);
            
            if (!isSameAvatar) {
                let avatarUrl = null;
                const discordCdnGif = `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.gif`;
                const discordCdnPng = `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`;
                
                try {
                    avatarUrl = await loadAvatarWithFallback(discordCdnGif, 5000);
                } catch {
                    try {
                        avatarUrl = await loadAvatarWithFallback(discordCdnPng, 5000);
                    } catch (pngError) {
                        console.warn(`Failed to load avatar for ${discordId}`);
                    }
                }
                
                if (avatarUrl) {
                    avatarElement.src = avatarUrl;
                    avatarElement.style.opacity = '1';
                    localStorage.setItem(cacheKey, avatarUrl);
                    loadedAvatars.add(discordId);
                }
            }
        } else {
            // Если нет аватара, оставляем изображение по умолчанию
            if (avatarElement.src !== './images/none.png' && !avatarElement.src.includes('none.png')) {
                avatarElement.src = './images/none.png';
            }
        }
    }
    
    // ОБРАБОТКА ОТДЕЛЬНОГО РЕЗУЛЬТАТА СРАЗУ ПОСЛЕ ПОЛУЧЕНИЯ
    async function processUserDataResult(result) {
        if (!result.success || !result.data) return;
        
        const discordId = result.user_id;
        const userData = result.data;
        
        // Сохраняем в кэш
        discordDataCache.set(discordId, {
            data: userData,
            timestamp: Date.now()
        });
        
        // Сохраняем в localStorage
        try {
            localStorage.setItem(`discord_user_${discordId}`, JSON.stringify({
                data: userData,
                timestamp: Date.now()
            }));
        } catch (e) {}
        
        // Обновляем имя пользователя на странице
        updateUsernameOnPage(discordId, userData);
        
        // СРАЗУ ЗАГРУЖАЕМ АВАТАР
        await loadAvatarForUser(discordId, userData);
    }
    
    // Обновление имени на странице
    function updateUsernameOnPage(discordId, userData) {
        const usernameElements = document.querySelectorAll(`.discord-link[data-discord-id="${discordId}"] .discord-username`);
        
        let displayName = discordId.slice(0, 8);
        if (userData.username) {
            displayName = userData.username;
            if (userData.discriminator && userData.discriminator !== '0') {
                displayName = `${userData.username}#${userData.discriminator}`;
            }
        } else if (userData.global_name) {
            displayName = userData.global_name;
        }
        
        usernameElements.forEach(element => {
            element.textContent = displayName;
        });
    }
    
    async function fetchMultipleDiscordUsers(discordIds) {
        const uniqueIds = [...new Set(discordIds.filter(id => id && typeof id === 'string' && id.match(/^\d{17,19}$/)))];
        if (uniqueIds.length === 0) return [];
        
        const results = [];
        
        // Разбиваем на маленькие пачки по 10 ID для более быстрой обработки
        const chunkSize = 50;
        for (let i = 0; i < uniqueIds.length; i += chunkSize) {
            const chunk = uniqueIds.slice(i, i + chunkSize);
            
            try {
                const idsParam = chunk.join(',');
                const batchUrl = `${config.discordBatchApi}?ids=${encodeURIComponent(idsParam)}`;
                
                console.log(`Batch request for ${chunk.length} users`);
                
                const response = await fetchWithTimeout(batchUrl, 15000);
                
                if (response.status === 500) {
                    console.warn(`Batch 500 error, falling back to individual requests for chunk`);
                    // Индивидуальные запросы с немедленной обработкой
                    for (const id of chunk) {
                        try {
                            const singleData = await fetchSingleDiscordUser(id);
                            if (singleData) {
                                const result = { user_id: id, data: singleData, success: true };
                                results.push(result);
                                // СРАЗУ ОБРАБАТЫВАЕМ РЕЗУЛЬТАТ
                                await processUserDataResult(result);
                            }
                        } catch (e) {
                            console.warn(`Individual fetch failed for ${id}`);
                        }
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    continue;
                }
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const batchData = await response.json();
                
                if (batchData.results && Array.isArray(batchData.results)) {
                    for (const result of batchData.results) {
                        if (result.success && result.data) {
                            results.push(result);
                            // СРАЗУ ОБРАБАТЫВАЕМ КАЖДЫЙ РЕЗУЛЬТАТ
                            await processUserDataResult(result);
                        }
                    }
                }
            } catch (chunkError) {
                console.error(`Batch chunk error:`, chunkError.message);
                // Индивидуальные запросы при ошибке
                for (const id of chunk) {
                    try {
                        const singleData = await fetchSingleDiscordUser(id);
                        if (singleData) {
                            const result = { user_id: id, data: singleData, success: true };
                            results.push(result);
                            await processUserDataResult(result);
                        }
                    } catch (e) {
                        console.warn(`Individual fetch failed for ${id}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
            
            // Уменьшаем задержку между пачками до 200мс
            if (i + chunkSize < uniqueIds.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        return results;
    }
    
    function getDiscordUserDataFromCache(discordId) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) return null;
        
        const cached = discordDataCache.get(discordId);
        if (cached && cached.data && !isDataCorrupted(cached.data)) {
            return cached.data;
        }
        
        return null;
    }
    
    function loadDiscordUsernameSync(discordId, originalName) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) {
            return originalName || 'No ID';
        }
        
        const userData = getDiscordUserDataFromCache(discordId);
        
        if (userData && userData.username) {
            let displayName = userData.username;
            if (userData.discriminator && userData.discriminator !== '0') {
                displayName = `${userData.username}#${userData.discriminator}`;
            }
            return displayName;
        } else if (userData && userData.global_name) {
            return userData.global_name;
        }
        
        return originalName || discordId.slice(0, 8);
    }
    
    async function loadDiscordUsernameAsync(discordId, usernameElement, originalName) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) {
            if (usernameElement) usernameElement.textContent = originalName || 'No ID';
            return;
        }
        
        const userData = getDiscordUserDataFromCache(discordId);
        
        let displayName = originalName;
        if (userData && userData.username) {
            displayName = userData.username;
            if (userData.discriminator && userData.discriminator !== '0') {
                displayName = `${userData.username}#${userData.discriminator}`;
            }
        } else if (userData && userData.global_name) {
            displayName = userData.global_name;
        } else if (userData && !isDataCorrupted(userData)) {
            displayName = userData.username || userData.global_name || originalName;
        } else {
            displayName = originalName || discordId.slice(0, 8);
        }
        
        if (usernameElement && usernameElement.textContent === 'Loading...') {
            usernameElement.textContent = displayName;
        }
        return displayName;
    }
    
    async function loadDiscordAvatar(discordId, elementId, username) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) return;
        if (loadedAvatars.has(discordId)) return;
        
        const avatarElement = document.getElementById(elementId);
        if (!avatarElement) return;
        
        const userData = getDiscordUserDataFromCache(discordId);
        if (userData) {
            await loadAvatarForUser(discordId, userData);
        }
    }
    
    function tryLoadImage(url, timeoutMs) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`Timeout ${timeoutMs}ms`));
            }, timeoutMs);
            
            function cleanup() {
                clearTimeout(timeout);
                img.onload = null;
                img.onerror = null;
            }
            
            img.onload = () => { cleanup(); resolve(url); };
            img.onerror = () => { cleanup(); reject(new Error('Load error')); };
            img.src = url;
        });
    }
    
    async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
        try {
            const response = await fetch(url, options);
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
    
    function getUserRole(discordId, adminList) {
        if (discordId === '470573716711931905') return 'creator';
        if (discordId === '1393856315067203635') return 'bot';
        return adminList.includes(discordId) ? 'admin' : 'player';
    }
    
    async function fetchJsonData(url) {
        try {
            return await fetchWithRetry(url);
        } catch (error) {
            console.error(`Ошибка загрузки ${url}:`, error);
            return null;
        }
    }
    
    function parseDateToTimestamp(dateString) {
        try {
            if (typeof dateString === 'number') return dateString;
            return Math.floor(new Date(dateString).getTime() / 1000);
        } catch (e) {
            return 0;
        }
    }
    
    function getBanStatus(userHwid, bansData) {
        if (!bansData || typeof bansData !== 'object') return null;
        
        const banInfo = bansData[userHwid];
        if (!banInfo) return null;
        
        const now = new Date();
        const banTime = new Date(banInfo.ban_time);
        const banTemp = banInfo.ban_temp;
        
        if (banTemp === "-1") {
            return { isBanned: true, isPermanent: true, reason: banInfo.ban_reason || 'Не указана', banTime, banInfo };
        }
        
        const banEnd = new Date(banTemp);
        if (banEnd > now) {
            return {
                isBanned: true,
                isPermanent: false,
                reason: banInfo.ban_reason || 'Не указана',
                banTime,
                banEnd,
                remainingTime: Math.ceil((banEnd - now) / (1000 * 60 * 60 * 24)),
                banInfo
            };
        }
        
        return { isBanned: false, wasBanned: true, reason: banInfo.ban_reason, banTime, banEnd, banInfo };
    }
    
    function loadCacheFromLocalStorage(discordIds) {
        console.log('Загрузка кэша из localStorage...');
        let loadedCount = 0;
        for (const discordId of discordIds) {
            try {
                const stored = localStorage.getItem(`discord_user_${discordId}`);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.data && !isDataCorrupted(parsed.data) && isCacheValid(parsed)) {
                        discordDataCache.set(discordId, {
                            data: parsed.data,
                            timestamp: parsed.timestamp
                        });
                        loadedCount++;
                        
                        // СРАЗУ ЗАГРУЖАЕМ АВАТАР ИЗ КЭША
                        setTimeout(() => {
                            loadAvatarForUser(discordId, parsed.data);
                        }, 100);
                    }
                }
            } catch (e) {}
        }
        console.log(`Загружено ${loadedCount} записей из кэша`);
    }
    
    // ОБНОВЛЕНИЕ КЭША С НЕМЕДЛЕННОЙ ЗАГРУЗКОЙ АВАТАРОВ
    async function updateDiscordCache() {
        if (updateInProgress) {
            console.log('Обновление кэша уже выполняется, пропускаем');
            return;
        }
        
        updateInProgress = true;
        console.log('Начинаем плановое обновление кэша Discord...');
        
        try {
            const allDiscordIds = [];
            draftUsers.forEach(user => {
                if (user.sid && user.sid.match(/^\d{17,19}$/)) {
                    allDiscordIds.push(user.sid);
                }
            });
            
            if (allDiscordIds.length === 0) {
                console.log('Нет Discord ID для обновления');
                return;
            }
            
            console.log(`Обновляем кэш для ${allDiscordIds.length} пользователей...`);
            
            // Запрашиваем данные с немедленной обработкой каждого результата
            const results = await fetchMultipleDiscordUsers(allDiscordIds);
            
            console.log(`Обновлено ${results.length} записей в кэше`);
            setLastUpdateTime();
            
        } catch (error) {
            console.error('Ошибка при обновлении кэша Discord:', error);
        } finally {
            updateInProgress = false;
        }
    }
    
    function refreshDisplayWithCache() {
        document.querySelectorAll('.discord-username').forEach(element => {
            if (element.textContent === 'Loading...') {
                const link = element.closest('.discord-link');
                if (link && link.dataset.discordId) {
                    const discordId = link.dataset.discordId;
                    const originalName = link.dataset.originalName;
                    const displayName = loadDiscordUsernameSync(discordId, originalName);
                    element.textContent = displayName;
                }
            }
        });
    }
    
    async function loadDraftData() {
        try {
            console.log('Загрузка черновых данных...');
            
            const [adminsData, hwidData, tempData, discordData, telegramData, bansData] = await Promise.allSettled([
                fetchJsonData(config.adminsJsonUrl),
                fetchJsonData(config.hwidJsonUrl),
                fetchJsonData(config.tempJsonUrl),
                fetchJsonData(config.discordJsonUrl),
                fetchJsonData(config.telegramJsonUrl),
                fetchJsonData(config.bansJsonUrl)
            ]);
            
            const admins = adminsData.status === 'fulfilled' ? adminsData.value : { "Admins": [] };
            const hwid = hwidData.status === 'fulfilled' ? hwidData.value : { "users:": [] };
            const temp = tempData.status === 'fulfilled' ? tempData.value : {};
            const discord = discordData.status === 'fulfilled' ? discordData.value : { "hwids": [] };
            const telegram = telegramData.status === 'fulfilled' ? telegramData.value : { "bindings": [] };
            const bans = bansData.status === 'fulfilled' ? bansData.value : {};
            
            draftAdminDiscordIds = admins.Admins || [];
            
            function getDiscordIdByHwid(hwid, discordData) {
                if (discordData.hwids && Array.isArray(discordData.hwids)) {
                    const entry = discordData.hwids.find(e => e.HWID === hwid);
                    return entry ? `${entry.DISCORD}` : null;
                }
                return null;
            }
            
            function getTelegramIdByHwid(hwid, telegramData) {
                if (telegramData.bindings && Array.isArray(telegramData.bindings)) {
                    const entry = telegramData.bindings.find(e => e.HWID === hwid);
                    return entry ? `${entry.TELEGRAM}` : null;
                }
                return null;
            }
            
            const usersList = [];
            const bannedUsersList = [];
            const activeUsers = hwid["users:"] || hwid.users || [];
            
            activeUsers.forEach((username) => {
                const discordId = getDiscordIdByHwid(username, discord);
                const telegramId = getTelegramIdByHwid(username, telegram);
                const endTime = temp[username] || 0;
                const banStatus = getBanStatus(username, bans);
                
                const userData = {
                    id: usersList.length + bannedUsersList.length + 1,
                    sid: discordId,
                    telegramId: telegramId,
                    hwid: username,
                    name: username,
                    flags: '999',
                    immunity: 0,
                    group_id: 'HWID',
                    end: parseDateToTimestamp(endTime),
                    server_id: 0,
                    is_active: true,
                    banStatus
                };
                
                if (banStatus && banStatus.isBanned) {
                    bannedUsersList.push(userData);
                } else {
                    usersList.push(userData);
                }
            });
            
            if (bans && typeof bans === 'object') {
                Object.keys(bans).forEach(bannedHwid => {
                    const alreadyExists = [...usersList, ...bannedUsersList].some(user => user.hwid === bannedHwid);
                    
                    if (!alreadyExists) {
                        const banStatus = getBanStatus(bannedHwid, bans);
                        
                        if (banStatus && banStatus.isBanned) {
                            const discordId = getDiscordIdByHwid(bannedHwid, discord);
                            const telegramId = getTelegramIdByHwid(bannedHwid, telegram);
                            
                            bannedUsersList.push({
                                id: usersList.length + bannedUsersList.length + 1,
                                sid: discordId,
                                telegramId: telegramId,
                                hwid: bannedHwid,
                                name: bannedHwid,
                                flags: '0',
                                immunity: 0,
                                group_id: 'Блокировка',
                                end: 0,
                                server_id: 0,
                                is_active: false,
                                banStatus
                            });
                        }
                    }
                });
            }
            
            draftUsers = [...usersList, ...bannedUsersList];
            
            draftUsers.sort((a, b) => {
                const aRole = getUserRole(a.sid, draftAdminDiscordIds);
                const bRole = getUserRole(b.sid, draftAdminDiscordIds);
                
                if (aRole === 'creator') return -1;
                if (bRole === 'creator') return 1;
                if (aRole === 'bot') return -1;
                if (bRole === 'bot') return 1;
                if (aRole === 'admin' && bRole !== 'admin') return -1;
                if (bRole === 'admin' && aRole !== 'admin') return 1;
                if (a.banStatus?.isBanned && !b.banStatus?.isBanned) return 1;
                if (!a.banStatus?.isBanned && b.banStatus?.isBanned) return -1;
                if (a.is_active && !b.is_active) return -1;
                if (!a.is_active && b.is_active) return 1;
                return 0;
            });
            
            // Загружаем кэш из localStorage
            const allDiscordIds = [];
            draftUsers.forEach(user => {
                if (user.sid && user.sid.match(/^\d{17,19}$/)) {
                    allDiscordIds.push(user.sid);
                }
            });
            loadCacheFromLocalStorage(allDiscordIds);
            
            // Показываем черновые данные
            displayUsers(draftUsers, draftAdminDiscordIds);
            draftDataLoaded = true;
            console.log('Черновые данные загружены и отображены');
            
            // Проверяем нужно ли обновить кэш
            if (shouldUpdateCache()) {
                console.log('Прошёл час, обновляем кэш Discord...');
                setTimeout(() => {
                    updateDiscordCache();
                }, 1000);
            } else {
                console.log('Кэш актуален, обновление не требуется');
                const lastUpdate = localStorage.getItem(LAST_UPDATE_KEY);
                if (lastUpdate) {
                    const timeLeft = Math.round((UPDATE_INTERVAL - (Date.now() - parseInt(lastUpdate))) / 60000);
                    console.log(`Следующее обновление через ${timeLeft} минут`);
                }
            }
            
            return { draftUsers, draftAdminDiscordIds, discord, bans };
            
        } catch (error) {
            console.error('Ошибка загрузки черновых данных:', error);
            document.getElementById('adminListTitle').textContent = 'Ошибка загрузки данных';
            return null;
        }
    }
    
    function displayUsers(users, adminDiscordIds) {
        const adminListTitle = document.getElementById('adminListTitle');
        const adminListBlocks = document.getElementById('adminListBlocks');
        
        const activeUsers = users.filter(user => user.is_active && (!user.banStatus || !user.banStatus.isBanned));
        const bannedUsers = users.filter(user => user.banStatus && user.banStatus.isBanned);
        
        adminListTitle.textContent = `Подписки: ${activeUsers.length} ー Баны: ${bannedUsers.length}`;
        adminListBlocks.innerHTML = '';
        
        users.forEach(user => {
            const userRole = getUserRole(user.sid, adminDiscordIds);
            const banStatus = user.banStatus;
            
            const userCard = document.createElement('div');
            userCard.className = 'admin_card';
            userCard.id = `block-${userRole}`;
            if (banStatus?.isBanned) userCard.classList.add('banned-user');
            
            let endText = 'Не указано';
            if (user.end === 0) {
                endText = user.is_active ? 'Навсегда' : 'Навсегда';
            } else if (user.end > 0 && user.end * 1000 > Date.now()) {
                endText = `До ${new Date(user.end * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}`;
            } else if (user.end > 0 && user.end * 1000 <= Date.now()) {
                endText = 'Истек';
            }
            
            let banText = '', banEnd = '', banReason = '';
            if (banStatus) {
                if (banStatus.isBanned) {
                    banText = 'Блок';
                    banEnd = banStatus.isPermanent ? 'Навсегда' : `До ${banStatus.banEnd.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}`;
                    banReason = `Причина: ${banStatus.reason}`;
                } else if (banStatus.wasBanned) {
                    banText = 'Блок истек';
                    banEnd = `До ${banStatus.banEnd.toLocaleDateString('ru-RU')}`;
                    banReason = `Причина: ${banStatus.reason}`;
                }
            }
            
            const usernameSpanId = `username-${(user.sid || user.hwid).replace(/[^a-zA-Z0-9-]/g, '_')}`;
            const cachedUsername = user.sid ? loadDiscordUsernameSync(user.sid, user.name) : user.name;
            
            userCard.innerHTML = `
            <div id="admins_card">
                                        <div class="admin_term">
                                <div class="adminlist_button steam_button" id="tag-${banStatus && !banStatus.wasBanned ? 'banned' : userRole}">
                                    <span>${userRole === 'creator' ? 'Создатель' : (userRole === 'admin' ? 'Партнёр' : (userRole === 'bot' ? 'Менеджер' : (banStatus && !banStatus.wasBanned ? 'Забанен' : 'Игрок')))}</span>
                                </div>
                                ${!(banStatus && !banStatus.wasBanned) ? `
                                <div class="admin_group">
                                <span class="admin_group_text">${user.group_id}</span>
                            </div>`:``
                            }
                            <span class="admin_term_text">${banText ? banEnd : endText}</span>
                        </div>
                <div class="adminlist_info">
                    <a href="./profile?hwid=${user.name}">
                        <div class="avatar_block">
                            <div class="avatar_letter">${user.name.charAt(0).toUpperCase()}</div>
                            <div class='avatar-img'>
                                <img class="admins_avatar" id="user-${user.sid}-avatar" src="./images/none.png" alt="">
                            </div>
                        </div>
                        <get-avatar></get-avatar>
                    </a>
                    <div class="adminlist_buttons">
                        <div id="admins_info">
                        <span class="admin_nickname">${user.name}</span>
                            ${!(banStatus && !banStatus.wasBanned) && (user.sid || user.telegramId) ? 
                            `${user.sid ? `<div id="link_block">
                                <a 
                                href="https://discord.com/users/${user.sid}" 
                                target="_blank" 
                                id="link_prof" 
                                class="discord-link DS" 
                                data-discord-id="${user.sid}" 
                                data-original-name="${user.name}">
                                    <svg viewBox="0 0 24 24" style='display: none;'><path d="M14.82 4.26a10.14 10.14 0 0 0-.53 1.1 14.66 14.66 0 0 0-4.58 0 10.14 10.14 0 0 0-.53-1.1 16 16 0 0 0-4.13 1.3 17.33 17.33 0 0 0-3 11.59 16.6 16.6 0 0 0 5.07 2.59A12.89 12.89 0 0 0 8.23 18a9.65 9.65 0 0 1-1.71-.83 3.39 3.39 0 0 0 .42-.33 11.66 11.66 0 0 0 10.12 0c.14.09.28.19.42.33a10.14 10.14 0 0 1-1.71.83 12.89 12.89 0 0 0 1.08 1.78 16.44 16.44 0 0 0 5.06-2.59 17.22 17.22 0 0 0-3-11.59 16.09 16.09 0 0 0-4.09-1.35zM8.68 14.81a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.93 1.93 0 0 1 1.8 2 1.93 1.93 0 0 1-1.8 2zm6.64 0a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.92 1.92 0 0 1 1.8 2 1.92 1.92 0 0 1-1.8 2z"/></svg>
                                    <svg viewBox="0 0 48 48" fill="none">
                                        <use href="./content/svg/link-discord.svg"></use>
                                    </svg>
                                    <span class="discord-username" id="${usernameSpanId}">${cachedUsername}</span>
                                </a>` : ''}
                                ${user.telegramId ? `<a 
                                target="_blank"
                                id="link_prof"
                                class="discord-link telegram-link TG"
                                data-discord-id="${user.sid}"
                                data-original-name="${user.name}">
                                    <svg viewBox="0 0 100 100" style='display: none;'><path d="M89.442 11.418c-12.533 5.19-66.27 27.449-81.118 33.516-9.958 3.886-4.129 7.529-4.129 7.529s8.5 2.914 15.786 5.1 11.172-.243 11.172-.243l34.244-23.073c12.143-8.257 9.229-1.457 6.315 1.457-6.315 6.315-16.758 16.272-25.501 24.287-3.886 3.4-1.943 6.315-.243 7.772 6.315 5.343 23.558 16.272 24.53 17.001 5.131 3.632 15.223 8.861 16.758-2.186l6.072-38.13c1.943-12.872 3.886-24.773 4.129-28.173.728-8.257-8.015-4.857-8.015-4.857z"/></svg>
                                    <svg viewBox="0 0 48 48" fill="none">
                                        <use href="./content/svg/link-telegram.svg"></use>
                                    </svg>
                                    <span class="discord-username">ID: ${user.telegramId}</span>
                                </a>` : ''}` : 
                                `${!(banStatus && !banStatus.wasBanned) ? `<a 
                                target="_blank" 
                                id="link_prof" 
                                style="max-width: 100%;" 
                                class="no-link">
                                    <p id="no-link">Без привязки!</p>
                                </a>` : ''}
                                ${banStatus && !banStatus.wasBanned ? `<div 
                                class="admin_term_reason">
                                    ${banStatus.reason}
                                </div>` : ''}
                            </div>`
                            }
                        </div>
                    </div>
                </div>
            </div>`;
            
            adminListBlocks.appendChild(userCard);
            
            // Загружаем аватар, если данные уже в кэше
            if (user.sid && user.sid.match(/^\d{17,19}$/)) {
                const userData = getDiscordUserDataFromCache(user.sid);
                if (userData) {
                    loadAvatarForUser(user.sid, userData);
                }
            }
        });
    }
    
    async function init() {
        await loadDraftData();
    }
    
    init();
});