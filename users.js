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
    
    // Хранилище для данных пользователей Discord
    const discordDataCache = new Map();
    const pendingBatchRequests = new Map();
    const failedRequests = new Map(); // Храним информацию о неудачных запросах
    const CACHE_TTL = 30 * 60 * 1000; // 30 минут
    const FAILED_COOLDOWN = 5 * 60 * 1000; // 5 минут после ошибки не пытаемся снова
    
    // Флаг для отслеживания загрузки черновых данных
    let draftDataLoaded = false;
    let draftUsers = [];
    let draftAdminDiscordIds = [];
    
    class AvatarQueue {
        constructor(maxConcurrent = 1, delayBetweenBatches = 1000) {
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
    
    const cacheQueue = new AvatarQueue(5, 100);
    const updateQueue = new AvatarQueue(1, 500);
    const avatarPromises = new Map();
    
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
    
    function isOnCooldown(discordId) {
        const failed = failedRequests.get(discordId);
        if (!failed) return false;
        if (Date.now() - failed.timestamp < FAILED_COOLDOWN) {
            return true;
        }
        failedRequests.delete(discordId);
        return false;
    }
    
    // Загрузка аватара напрямую
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
    
    // Загрузка аватара через прокси
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
    
    // Загрузка аватара с fallback
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
    
    // Индивидуальный запрос с ретраями и обработкой 500 ошибок
    async function fetchSingleDiscordUser(discordId, retryCount = 0) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) return null;
        
        // Проверяем не на кулдауне ли ID
        if (isOnCooldown(discordId)) {
            console.warn(`${discordId} is on cooldown, using cached data if available`);
            const cached = discordDataCache.get(discordId);
            return cached ? cached.data : null;
        }
        
        const maxRetries = 3;
        const baseDelay = 1000;
        
        try {
            const url = `${config.discordApiBase}${discordId}`;
            const response = await fetchWithTimeout(addCacheBuster(url), 10000);
            
            if (response.status === 429) {
                // Rate limit - ждем дольше
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
                // Успешно - сохраняем в кэш
                discordDataCache.set(discordId, {
                    data: data,
                    timestamp: Date.now()
                });
                try {
                    localStorage.setItem(`discord_user_${discordId}`, JSON.stringify({
                        data: data,
                        timestamp: Date.now()
                    }));
                } catch (e) {}
                // Удаляем из failed если было
                failedRequests.delete(discordId);
                return data;
            }
            return null;
            
        } catch (error) {
            console.warn(`Fetch failed for ${discordId} (attempt ${retryCount + 1}/${maxRetries + 1}):`, error.message);
            
            if (retryCount < maxRetries) {
                // Экспоненциальная задержка
                const delay = baseDelay * Math.pow(2, retryCount);
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchSingleDiscordUser(discordId, retryCount + 1);
            }
            
            // Все попытки провалились
            failedRequests.set(discordId, {
                timestamp: Date.now(),
                error: error.message
            });
            
            // Пробуем вернуть кэшированные данные (даже просроченные)
            const cached = discordDataCache.get(discordId);
            if (cached && cached.data && !isDataCorrupted(cached.data)) {
                console.warn(`Using stale cached data for ${discordId}`);
                return cached.data;
            }
            
            return null;
        }
    }
    
    // fetch с таймаутом
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
    
    // Batch запрос нескольких пользователей с улучшенной обработкой ошибок
    async function fetchMultipleDiscordUsers(discordIds) {
        const uniqueIds = [...new Set(discordIds.filter(id => id && typeof id === 'string' && id.match(/^\d{17,19}$/)))];
        if (uniqueIds.length === 0) return [];
        
        // Проверяем какие ID уже есть в кэше и валидны
        const idsToFetch = uniqueIds.filter(id => {
            const cached = discordDataCache.get(id);
            if (!cached) return true;
            if (isCacheValid(cached) && !isDataCorrupted(cached.data)) return false;
            if (isOnCooldown(id)) return false;
            return true;
        });
        
        if (idsToFetch.length === 0) return [];
        
        const batchKey = idsToFetch.sort().join(',');
        if (pendingBatchRequests.has(batchKey)) {
            return pendingBatchRequests.get(batchKey);
        }
        
        const promise = (async () => {
            const results = [];
            
            // Разбиваем на маленькие пачки по 10-20 ID чтобы избежать 500 ошибок
            const chunkSize = 5;
            for (let i = 0; i < idsToFetch.length; i += chunkSize) {
                const chunk = idsToFetch.slice(i, i + chunkSize);
                
                try {
                    const idsParam = chunk.join(',');
                    const batchUrl = `${config.discordBatchApi}?ids=${encodeURIComponent(idsParam)}`;
                    
                    console.log(`Batch request for ${chunk.length} users`);
                    
                    const response = await fetchWithTimeout(addCacheBuster(batchUrl), 15000);
                    
                    if (response.status === 500) {
                        console.warn(`Batch 500 error, falling back to individual requests for chunk`);
                        // При 500 ошибке пробуем индивидуально каждый ID
                        for (const id of chunk) {
                            try {
                                const singleData = await fetchSingleDiscordUser(id);
                                if (singleData) {
                                    results.push({ user_id: id, data: singleData, success: true });
                                }
                            } catch (e) {
                                console.warn(`Individual fetch failed for ${id}`);
                            }
                            // Небольшая задержка между индивидуальными запросами
                            await new Promise(resolve => setTimeout(resolve, 100));
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
                                discordDataCache.set(result.user_id, {
                                    data: result.data,
                                    timestamp: Date.now()
                                });
                                try {
                                    localStorage.setItem(`discord_user_${result.user_id}`, JSON.stringify({
                                        data: result.data,
                                        timestamp: Date.now()
                                    }));
                                } catch (e) {}
                                results.push(result);
                                failedRequests.delete(result.user_id);
                            } else if (!result.success) {
                                console.warn(`Batch failed for ${result.user_id}: ${result.error || 'Unknown'}`);
                                // Помечаем как failed
                                failedRequests.set(result.user_id, {
                                    timestamp: Date.now(),
                                    error: result.error || 'Unknown error'
                                });
                            }
                        }
                    }
                } catch (chunkError) {
                    console.error(`Batch chunk error:`, chunkError.message);
                    // При ошибке пачки, пробуем индивидуально
                    for (const id of chunk) {
                        try {
                            const singleData = await fetchSingleDiscordUser(id);
                            if (singleData) {
                                results.push({ user_id: id, data: singleData, success: true });
                            }
                        } catch (e) {
                            console.warn(`Individual fetch failed for ${id}`);
                        }
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
                
                // Задержка между пачками чтобы не перегружать API
                if (i + chunkSize < idsToFetch.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            return results;
        })();
        
        pendingBatchRequests.set(batchKey, promise);
        const result = await promise;
        pendingBatchRequests.delete(batchKey);
        return result;
    }
    
    // Получение данных пользователя
    async function getDiscordUserData(discordId, forceRefresh = false) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) return null;
        
        const cached = discordDataCache.get(discordId);
        
        if (!forceRefresh && cached && isCacheValid(cached)) {
            if (cached.data && !isDataCorrupted(cached.data)) {
                return cached.data;
            }
            if (cached.data && isDataCorrupted(cached.data)) {
                forceRefresh = true;
            }
        }
        
        // Если на кулдауне и не forceRefresh - используем кэш
        if (!forceRefresh && isOnCooldown(discordId) && cached && cached.data) {
            return cached.data;
        }
        
        if (forceRefresh || !cached || !isCacheValid(cached)) {
            const freshData = await fetchSingleDiscordUser(discordId);
            if (freshData && !isDataCorrupted(freshData)) {
                return freshData;
            }
            
            // Используем старый кэш если есть
            if (cached && cached.data && !isDataCorrupted(cached.data)) {
                console.warn(`Using stale cache for ${discordId}`);
                return cached.data;
            }
            
            // Пробуем localStorage
            try {
                const stored = localStorage.getItem(`discord_user_${discordId}`);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.data && !isDataCorrupted(parsed.data)) {
                        discordDataCache.set(discordId, {
                            data: parsed.data,
                            timestamp: parsed.timestamp
                        });
                        return parsed.data;
                    }
                }
            } catch (e) {}
        }
        
        return cached ? cached.data : null;
    }
    
    // Очередь для batch загрузки имен
    let pendingBatchUserIds = [];
    let batchTimeout = null;
    let batchInProgress = false;
    
    async function processBatchQueue() {
        if (batchInProgress) return;
        if (pendingBatchUserIds.length === 0) return;
        
        batchInProgress = true;
        const idsToFetch = [...new Set(pendingBatchUserIds)];
        pendingBatchUserIds = [];
        
        try {
            await fetchMultipleDiscordUsers(idsToFetch);
        } catch (error) {
            console.error('Batch processing error:', error);
        } finally {
            batchInProgress = false;
            if (pendingBatchUserIds.length > 0) {
                processBatchQueue();
            }
        }
    }
    
    async function queueDiscordUsersForBatch(discordIds) {
        const validIds = discordIds.filter(id => id && id.match(/^\d{17,19}$/));
        if (validIds.length === 0) return;
        
        const newIds = validIds.filter(id => {
            const cached = discordDataCache.get(id);
            if (isOnCooldown(id) && cached && cached.data) return false;
            return !cached || !isCacheValid(cached) || isDataCorrupted(cached.data);
        });
        
        if (newIds.length === 0) return;
        
        pendingBatchUserIds.push(...newIds);
        
        if (batchTimeout) clearTimeout(batchTimeout);
        batchTimeout = setTimeout(() => {
            processBatchQueue();
        }, 200); // Увеличил задержку для лучшего накопления
    }
    
    async function loadDiscordUsername(discordId, usernameElement, originalName) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) {
            if (usernameElement) usernameElement.textContent = originalName || 'No ID';
            return;
        }
        
        if (usernameElement) {
            usernameElement.textContent = 'Loading...';
        }
        
        try {
            await queueDiscordUsersForBatch([discordId]);
            const userData = await getDiscordUserData(discordId);
            
            let displayName = originalName;
            if (userData && userData.username) {
                displayName = userData.username;
                if (userData.discriminator && userData.discriminator !== '0') {
                    displayName = `${userData.username}#${userData.discriminator}`;
                }
            } else if (userData && userData.global_name) {
                displayName = userData.global_name;
            } else {
                displayName = originalName || discordId.slice(0, 8);
            }
            
            if (usernameElement) {
                usernameElement.textContent = displayName;
            }
            return displayName;
        } catch (error) {
            console.warn(`Error loading username for ${discordId}:`, error.message);
            if (usernameElement) {
                usernameElement.textContent = originalName || discordId.slice(0, 8);
            }
            return originalName;
        }
    }
    
    async function loadDiscordAvatar(discordId, elementId, username) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) return;
        
        if (avatarPromises.has(discordId)) return avatarPromises.get(discordId);
        
        const promise = (async () => {
            try {
                const avatarElement = document.getElementById(elementId);
                const cacheKey = `avatar_${discordId}`;
                
                if (avatarElement) {
                    avatarElement.src = '';
                    avatarElement.removeAttribute('src');
                }
                
                cacheQueue.add(async () => {
                    const cachedAvatar = localStorage.getItem(cacheKey);
                    if (cachedAvatar && avatarElement) {
                        try {
                            await tryLoadImage(cachedAvatar, 3000);
                            avatarElement.src = cachedAvatar;
                            avatarElement.style.opacity = '1';
                        } catch (cacheError) {
                            localStorage.removeItem(cacheKey);
                        }
                    }
                });
                
                updateQueue.add(async () => {
                    try {
                        await queueDiscordUsersForBatch([discordId]);
                        const userData = await getDiscordUserData(discordId);
                        
                        if (userData && userData.avatar && avatarElement) {
                            const avatarHash = userData.avatar;
                            const cachedAvatar = localStorage.getItem(cacheKey);
                            const isSameAvatar = cachedAvatar && cachedAvatar.includes(avatarHash);
                            
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
                                }
                            } else if (cachedAvatar) {
                                avatarElement.src = cachedAvatar;
                                avatarElement.style.opacity = '1';
                            }
                        } else if (!userData || !userData.avatar) {
                            localStorage.removeItem(cacheKey);
                            if (avatarElement && avatarElement.src !== './images/none.png') {
                                avatarElement.src = './images/none.png';
                            }
                        }
                    } catch (error) {
                        console.warn(`Avatar error for ${discordId}:`, error.message);
                    }
                });
            } finally {
                avatarPromises.delete(discordId);
            }
        })();
        
        avatarPromises.set(discordId, promise);
        return promise;
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
    
    function addCacheBuster(url) {
        return url + (url.includes('?') ? '&' : '?') + 't=' + new Date().getTime();
    }
    
    async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
        try {
            const response = await fetch(addCacheBuster(url), options);
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
    
    // Функция загрузки черновых данных (без Discord API)
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
            
            // Показываем черновые данные сразу
            displayUsers(draftUsers, draftAdminDiscordIds);
            draftDataLoaded = true;
            console.log('Черновые данные загружены и отображены');
            
            // Возвращаем данные для дальнейшей работы с кэшем и API
            return { draftUsers, draftAdminDiscordIds, discord, bans };
            
        } catch (error) {
            console.error('Ошибка загрузки черновых данных:', error);
            document.getElementById('adminListTitle').textContent = 'Ошибка загрузки данных';
            return null;
        }
    }
    
    // Функция обновления данных из кэша и API
    async function updateWithCacheAndApi(draftResult) {
        if (!draftResult) return;
        
        const { discord, bans } = draftResult;
        
        // Собираем все Discord ID для batch-запроса
        const allDiscordIds = [];
        
        draftUsers.forEach(user => {
            if (user.sid && user.sid.match(/^\d{17,19}$/)) {
                allDiscordIds.push(user.sid);
            }
        });
        
        // Загружаем данные из localStorage в кэш
        console.log('Загрузка данных из localStorage в кэш...');
        for (const discordId of allDiscordIds) {
            try {
                const stored = localStorage.getItem(`discord_user_${discordId}`);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.data && !isDataCorrupted(parsed.data)) {
                        discordDataCache.set(discordId, {
                            data: parsed.data,
                            timestamp: parsed.timestamp
                        });
                    }
                }
            } catch (e) {}
        }
        
        // Обновляем имена и аватары через API (асинхронно, не блокируя отображение)
        if (allDiscordIds.length > 0) {
            console.log('Обновление данных из API...');
            
            // Обновляем данные через batch API
            await fetchMultipleDiscordUsers(allDiscordIds);
            
            // Обновляем отображение с новыми данными
            const updatedUsers = [...draftUsers];
            
            // Обновляем отображение (но уже с загруженными данными из API)
            // Находим все элементы с именами и аватарами и обновляем их
            updatedUsers.forEach(user => {
                if (user.sid && user.sid.match(/^\d{17,19}$/)) {
                    const usernameSpanId = `username-${(user.sid).replace(/[^a-zA-Z0-9-]/g, '_')}`;
                    const usernameSpan = document.getElementById(usernameSpanId);
                    if (usernameSpan && usernameSpan.textContent === 'Loading...') {
                        loadDiscordUsername(user.sid, usernameSpan, user.name);
                    }
                    
                    // Обновляем аватар
                    loadDiscordAvatar(user.sid, `user-${user.sid}-avatar`, user.name);
                }
            });
            
            console.log('Данные из API загружены и применены');
        }
    }
    
    function displayUsers(users, adminDiscordIds) {
        const adminListTitle = document.getElementById('adminListTitle');
        const adminListBlocks = document.getElementById('adminListBlocks');
        
        const activeUsers = users.filter(user => user.is_active && (!user.banStatus || !user.banStatus.isBanned));
        const bannedUsers = users.filter(user => user.banStatus && user.banStatus.isBanned);
        
        adminListTitle.textContent = `Подписки: ${activeUsers.length} ー Баны: ${bannedUsers.length}`;
        adminListBlocks.innerHTML = '';
        
        const avatarPromisesList = [];
        const usernamePromisesList = [];
        
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
                endText = `До ${new Date(user.end * 1000).toLocaleDateString('ru-RU')}`;
            } else if (user.end > 0 && user.end * 1000 <= Date.now()) {
                endText = 'Истек';
            }
            
            let banText = '', banEnd = '', banReason = '';
            if (banStatus) {
                if (banStatus.isBanned) {
                    banText = 'Блок';
                    banEnd = banStatus.isPermanent ? 'Навсегда' : `До ${banStatus.banEnd.toLocaleDateString('ru-RU')}`;
                    banReason = `Причина: ${banStatus.reason}`;
                } else if (banStatus.wasBanned) {
                    banText = 'Блок истек';
                    banEnd = `До ${banStatus.banEnd.toLocaleDateString('ru-RU')}`;
                    banReason = `Причина: ${banStatus.reason}`;
                }
            }
            
            const usernameSpanId = `username-${(user.sid || user.hwid).replace(/[^a-zA-Z0-9-]/g, '_')}`;
            
            userCard.innerHTML = `
            <div id="admins_card">
                <div class="adminlist_info">
                    <div class="avatar_block">
                        <div class="avatar_letter">${user.name.charAt(0).toUpperCase()}</div>
                        <div style="display: flex; gap: 3px; flex-direction: column;">
                            <a href="./profile?hwid=${user.name}" target="_blank">
                                <img class="admins_avatar" id="user-${user.sid}-avatar" src="./images/none.png" alt="">
                            </a>
                        </div>
                    </div>
                    <div class="adminlist_buttons">
                        <div id="admins_info">
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
                                    <svg viewBox="0 0 24 24"><path d="M14.82 4.26a10.14 10.14 0 0 0-.53 1.1 14.66 14.66 0 0 0-4.58 0 10.14 10.14 0 0 0-.53-1.1 16 16 0 0 0-4.13 1.3 17.33 17.33 0 0 0-3 11.59 16.6 16.6 0 0 0 5.07 2.59A12.89 12.89 0 0 0 8.23 18a9.65 9.65 0 0 1-1.71-.83 3.39 3.39 0 0 0 .42-.33 11.66 11.66 0 0 0 10.12 0c.14.09.28.19.42.33a10.14 10.14 0 0 1-1.71.83 12.89 12.89 0 0 0 1.08 1.78 16.44 16.44 0 0 0 5.06-2.59 17.22 17.22 0 0 0-3-11.59 16.09 16.09 0 0 0-4.09-1.35zM8.68 14.81a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.93 1.93 0 0 1 1.8 2 1.93 1.93 0 0 1-1.8 2zm6.64 0a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.92 1.92 0 0 1 1.8 2 1.92 1.92 0 0 1-1.8 2z"/></svg>
                                    <span class="discord-username" id="${usernameSpanId}">Loading...</span>
                                </a>` : ''}
                                ${user.telegramId ? `<a 
                                target="_blank"
                                id="link_prof"
                                class="discord-link telegram-link TG"
                                data-discord-id="${user.sid}"
                                data-original-name="${user.name}">
                                    <svg viewBox="0 0 100 100"><path d="M89.442 11.418c-12.533 5.19-66.27 27.449-81.118 33.516-9.958 3.886-4.129 7.529-4.129 7.529s8.5 2.914 15.786 5.1 11.172-.243 11.172-.243l34.244-23.073c12.143-8.257 9.229-1.457 6.315 1.457-6.315 6.315-16.758 16.272-25.501 24.287-3.886 3.4-1.943 6.315-.243 7.772 6.315 5.343 23.558 16.272 24.53 17.001 5.131 3.632 15.223 8.861 16.758-2.186l6.072-38.13c1.943-12.872 3.886-24.773 4.129-28.173.728-8.257-8.015-4.857-8.015-4.857z"/></svg>
                                    <span class="discord-username">ID: ${user.telegramId}</span>
                                </a>` : ''}` : 
                                `${!(banStatus && !banStatus.wasBanned) ? `<a 
                                target="_blank" 
                                id="link_prof" 
                                style="max-width: 100%;" 
                                class="discord-link">
                                    <p id="no-link">Без привязки</p>
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
            
            if (user.sid && user.sid.match(/^\d{17,19}$/)) {
                avatarPromisesList.push(loadDiscordAvatar(user.sid, `user-${user.sid}-avatar`, user.name));
                const usernameSpan = document.getElementById(usernameSpanId);
                if (usernameSpan) {
                    usernamePromisesList.push(loadDiscordUsername(user.sid, usernameSpan, user.name));
                }
            }
        });
        
        Promise.allSettled([...avatarPromisesList, ...usernamePromisesList]).then(() => console.log('Все данные загружены'));
    }
    
    async function init() {
        // Сначала загружаем черновые данные и показываем их
        const draftResult = await loadDraftData();
        
        // Затем, не блокируя интерфейс, загружаем данные из кэша и API
        if (draftResult) {
            // Небольшая задержка перед обновлением, чтобы не мешать первоначальному отображению
            setTimeout(() => {
                updateWithCacheAndApi(draftResult);
            }, 100);
        }
    }
    
    init();
});