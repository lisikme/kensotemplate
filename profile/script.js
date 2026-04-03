// Конфигурация
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
const failedRequests = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 минут
const FAILED_COOLDOWN = 5 * 60 * 1000; // 5 минут

// Флаг для отслеживания загрузки черновых данных
let draftDataLoaded = false;
let draftUserData = null;
let draftBanStatus = null;

// Очередь для batch загрузки
let pendingBatchUserIds = [];
let batchTimeout = null;
let batchInProgress = false;

function addCacheBuster(url) {
    return url + (url.includes('?') ? '&' : '?') + 't=' + new Date().getTime();
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

async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
    try {
        const cacheBustedUrl = addCacheBuster(url);
        const response = await fetchWithTimeout(cacheBustedUrl, 10000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        if (retries > 0) {
            console.log(`Повторная попытка загрузки (${4-retries}/${3}): ${url}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, retries - 1, delay * 2);
        }
        throw error;
    }
}

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

// Индивидуальный запрос с ретраями
async function fetchSingleDiscordUser(discordId, retryCount = 0) {
    if (!discordId || !discordId.match(/^\d{17,19}$/)) return null;
    
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
            failedRequests.delete(discordId);
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
        
        failedRequests.set(discordId, {
            timestamp: Date.now(),
            error: error.message
        });
        
        const cached = discordDataCache.get(discordId);
        if (cached && cached.data && !isDataCorrupted(cached.data)) {
            console.warn(`Using stale cached data for ${discordId}`);
            return cached.data;
        }
        
        return null;
    }
}

// Batch запрос нескольких пользователей
async function fetchMultipleDiscordUsers(discordIds) {
    const uniqueIds = [...new Set(discordIds.filter(id => id && typeof id === 'string' && id.match(/^\d{17,19}$/)))];
    if (uniqueIds.length === 0) return [];
    
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
        const chunkSize = 5;
        
        for (let i = 0; i < idsToFetch.length; i += chunkSize) {
            const chunk = idsToFetch.slice(i, i + chunkSize);
            
            try {
                const idsParam = chunk.join(',');
                const batchUrl = `${config.discordBatchApi}?ids=${encodeURIComponent(idsParam)}`;
                
                console.log(`Batch request for ${chunk.length} users`);
                
                const response = await fetchWithTimeout(addCacheBuster(batchUrl), 15000);
                
                if (response.status === 500) {
                    console.warn(`Batch 500 error, falling back to individual requests`);
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
                            failedRequests.set(result.user_id, {
                                timestamp: Date.now(),
                                error: result.error || 'Unknown error'
                            });
                        }
                    }
                }
            } catch (chunkError) {
                console.error(`Batch chunk error:`, chunkError.message);
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
    }, 200);
}

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
    
    if (!forceRefresh && isOnCooldown(discordId) && cached && cached.data) {
        return cached.data;
    }
    
    if (forceRefresh || !cached || !isCacheValid(cached)) {
        const freshData = await fetchSingleDiscordUser(discordId);
        if (freshData && !isDataCorrupted(freshData)) {
            return freshData;
        }
        
        if (cached && cached.data && !isDataCorrupted(cached.data)) {
            console.warn(`Using stale cache for ${discordId}`);
            return cached.data;
        }
        
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

// Функция загрузки черновых данных (без Discord API)
async function loadDraftProfileData(hwid) {
    try {
        console.log('Загрузка черновых данных профиля...');
        
        const [adminsData, hwidData, tempData, discordData, telegramData, bansData] = await Promise.allSettled([
            fetchJsonData(config.adminsJsonUrl),
            fetchJsonData(config.hwidJsonUrl),
            fetchJsonData(config.tempJsonUrl),
            fetchJsonData(config.discordJsonUrl),
            fetchJsonData(config.telegramJsonUrl),
            fetchJsonData(config.bansJsonUrl)
        ]);
        
        const admins = adminsData.status === 'fulfilled' ? adminsData.value : { "Admins": [] };
        const hwidList = hwidData.status === 'fulfilled' ? hwidData.value : { "users:": [] };
        const temp = tempData.status === 'fulfilled' ? tempData.value : {};
        const discord = discordData.status === 'fulfilled' ? discordData.value : { "hwids": [] };
        const telegram = telegramData.status === 'fulfilled' ? telegramData.value : { "bindings": [] };
        const bans = bansData.status === 'fulfilled' ? bansData.value : {};
        
        const adminDiscordIds = admins.Admins || [];
        
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
        
        function getUserRole(discordId, adminList, isBanned) {
            if (isBanned) return 'banned';
            if (discordId === '470573716711931905') return 'creator';
            if (discordId === '1393856315067203635') return 'bot';
            return adminList.includes(discordId) ? 'admin' : 'player';
        }
        
        function parseDateToTimestamp(dateString) {
            try {
                if (typeof dateString === 'number') return dateString;
                if (dateString && dateString.includes('T')) {
                    return Math.floor(new Date(dateString).getTime() / 1000);
                } else if (dateString) {
                    return Math.floor(new Date(dateString).getTime() / 1000);
                }
                return 0;
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
                return {
                    isBanned: true,
                    isPermanent: true,
                    reason: banInfo.ban_reason || 'Причина не указана',
                    banTime: banTime,
                    remainingTime: null
                };
            }
            
            const banEnd = new Date(banTemp);
            if (banEnd > now) {
                const remainingDays = Math.ceil((banEnd - now) / (1000 * 60 * 60 * 24));
                return {
                    isBanned: true,
                    isPermanent: false,
                    reason: banInfo.ban_reason || 'Причина не указана',
                    banTime: banTime,
                    banEnd: banEnd,
                    remainingTime: remainingDays
                };
            } else {
                return {
                    isBanned: false,
                    wasBanned: true,
                    reason: banInfo.ban_reason,
                    banTime: banTime,
                    banEnd: banEnd
                };
            }
        }
        
        const activeUsers = hwidList["users:"] || hwidList.users || [];
        const userIndex = activeUsers.findIndex(username => username === hwid);
        const banStatus = getBanStatus(hwid, bans);
        
        let userData;
        let discordId = null;
        let telegramId = null;
        
        if (userIndex !== -1) {
            const username = activeUsers[userIndex];
            discordId = getDiscordIdByHwid(username, discord);
            telegramId = getTelegramIdByHwid(username, telegram);
            const endTime = temp[username] || 0;
            
            userData = {
                id: userIndex + 1,
                hwid: username,
                name: username,
                discordId: discordId,
                telegramId: telegramId,
                end: parseDateToTimestamp(endTime),
                group_id: 'Активная подписка',
                flags: '999',
                immunity: 0,
                role: getUserRole(discordId, adminDiscordIds, false)
            };
        } else if (banStatus && banStatus.isBanned) {
            discordId = getDiscordIdByHwid(hwid, discord);
            telegramId = getTelegramIdByHwid(hwid, telegram);
            
            userData = {
                id: 0,
                hwid: hwid,
                name: hwid,
                discordId: discordId,
                telegramId: telegramId,
                end: 0,
                group_id: 'Забанен',
                flags: '0',
                immunity: 0,
                role: 'banned'
            };
        } else {
            return null;
        }
        
        draftUserData = userData;
        draftBanStatus = banStatus;
        draftDataLoaded = true;
        
        console.log('Черновые данные профиля загружены');
        return { userData, banStatus, discordId, discord, bans };
        
    } catch (error) {
        console.error('Ошибка загрузки черновых данных профиля:', error);
        return null;
    }
}

// Функция обновления данных из кэша и API
async function updateProfileWithCacheAndApi(draftResult, hwid) {
    if (!draftResult) return;
    
    const { discordId, discord, bans } = draftResult;
    
    if (!discordId) return;
    
    // Загружаем данные из localStorage в кэш
    console.log('Загрузка данных из localStorage в кэш...');
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
    
    // Обновляем данные через API
    console.log('Обновление данных из API...');
    await queueDiscordUsersForBatch([discordId]);
    await fetchMultipleDiscordUsers([discordId]);
    
    // Обновляем отображение с новыми данными
    const updatedUserData = { ...draftUserData };
    const updatedBanStatus = draftBanStatus;
    
    // Получаем свежие данные Discord
    const freshDiscordData = await getDiscordUserData(discordId);
    
    if (freshDiscordData) {
        // Обновляем роль если нужно (хотя роль обычно не меняется)
        // Но мы можем обновить имя для отображения
    }
    
    // Обновляем отображение с загруженными данными
    await displayProfile(updatedUserData, updatedBanStatus);
    
    console.log('Данные профиля из API загружены и применены');
}

async function fetchJsonData(url) {
    try {
        return await fetchWithRetry(url);
    } catch (error) {
        console.error(`Ошибка загрузки данных из ${url}:`, error);
        return null;
    }
}

function formatDate(timestamp) {
    if (timestamp === 0) return 'Навсегда';
    const date = new Date(timestamp * 1000);
    return `До ${date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}`;
}

function getSubscriptionStatus(endTime) {
    if (endTime === 0) return { status: 'forever', text: 'Безлимит' };
    const now = Math.floor(Date.now() / 1000);
    if (endTime > now) {
        const daysLeft = Math.ceil((endTime - now) / (60 * 60 * 24));
        return { status: 'active', text: `${daysLeft} дн.` };
    } else {
        return { status: 'expired', text: 'Истекла' };
    }
}

function formatBanDate(date) {
    return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Очередь для загрузки аватаров
const avatarQueue = [];
let isProcessingQueue = false;

function loadAvatarSequentially(discordId, imgElement, avatarUrl) {
    return new Promise((resolve) => {
        const task = async () => {
            try {
                if (!avatarUrl) {
                    resolve(null);
                    return;
                }
                
                try {
                    await tryLoadImage(avatarUrl, 5000);
                    if (imgElement) {
                        imgElement.src = avatarUrl;
                        imgElement.style.opacity = '1';
                        localStorage.setItem(`avatar_profile_${discordId}`, avatarUrl);
                    }
                    resolve(avatarUrl);
                    return;
                } catch (directError) {
                    try {
                        const proxyUrl = `${config.proxy}"${encodeURIComponent(avatarUrl)}"`;
                        await tryLoadImage(proxyUrl, 5000);
                        if (imgElement) {
                            imgElement.src = proxyUrl;
                            imgElement.style.opacity = '1';
                            localStorage.setItem(`avatar_profile_${discordId}`, proxyUrl);
                        }
                        resolve(proxyUrl);
                        return;
                    } catch (proxyError) {
                        console.warn(`Не удалось загрузить аватар для ${discordId}`);
                        if (imgElement) {
                            imgElement.style.opacity = '1';
                        }
                        resolve(null);
                    }
                }
            } catch (error) {
                console.warn(`Ошибка загрузки аватара для ${discordId}:`, error.message);
                if (imgElement) {
                    imgElement.style.opacity = '1';
                }
                resolve(null);
            }
        };
        
        avatarQueue.push(task);
        processAvatarQueue();
    });
}

function processAvatarQueue() {
    if (isProcessingQueue || avatarQueue.length === 0) return;
    
    isProcessingQueue = true;
    
    const processNext = async () => {
        if (avatarQueue.length === 0) {
            isProcessingQueue = false;
            return;
        }
        
        const task = avatarQueue.shift();
        await task();
        
        setTimeout(processNext, 200);
    };
    
    processNext();
}

function tryLoadImage(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Таймаут ${timeoutMs}ms`));
        }, timeoutMs);
        
        function cleanup() {
            clearTimeout(timeout);
            img.onload = null;
            img.onerror = null;
        }
        
        img.onload = () => { cleanup(); resolve(url); };
        img.onerror = () => { cleanup(); reject(new Error('Ошибка загрузки')); };
        img.src = url.includes('?') ? `${url}&_=${Date.now()}` : `${url}?_=${Date.now()}`;
    });
}

async function getDiscordAvatarUrl(discordId) {
    if (!discordId) return null;
    
    const cachedAvatar = localStorage.getItem(`avatar_profile_${discordId}`);
    if (cachedAvatar) return cachedAvatar;
    
    const userData = await getDiscordUserData(discordId);
    if (userData && userData.avatar) {
        return `https://cdn.discordapp.com/avatars/${discordId}/${userData.avatar}.png?size=256`;
    }
    
    return null;
}

async function getDiscordDisplayName(discordId, fallbackName) {
    if (!discordId) return fallbackName;
    
    const cachedName = localStorage.getItem(`discord_name_profile_${discordId}`);
    if (cachedName && cachedName !== 'undefined') {
        return cachedName;
    }
    
    const userData = await getDiscordUserData(discordId);
    if (userData) {
        let displayName = fallbackName;
        if (userData.username) {
            displayName = userData.username;
            if (userData.discriminator && userData.discriminator !== '0') {
                displayName = `${userData.username}#${userData.discriminator}`;
            }
        } else if (userData.global_name) {
            displayName = userData.global_name;
        }
        localStorage.setItem(`discord_name_profile_${discordId}`, displayName);
        return displayName;
    }
    
    return fallbackName;
}

async function displayProfile(userData, banStatus) {
    const profileContent = document.getElementById('profileContent');
    
    if (!userData) {
        profileContent.innerHTML = `
            <div class="error">
                <p>Пользователь не найден</p>
                <p>Проверьте правильность HWID в URL</p>
            </div>
        `;
        return;
    }
    
    const subscriptionStatus = getSubscriptionStatus(userData.end);
    const discordUsername = userData.discordId ? await getDiscordDisplayName(userData.discordId, userData.name) : null;
    
    let userRole = userData.role;
    let roleText = userRole === 'creator' ? 'Создатель' : 
        userRole === 'admin' ? 'Партнёр' : 
        userRole === 'bot' ? 'Служба' : 
        userRole === 'banned' ? 'Забанен' : 'Игрок';
    
    const roleClass = `profile-role ${userRole === 'banned' ? 'banned' : userRole}`;
    
    const avatarUrl = userData.discordId ? await getDiscordAvatarUrl(userData.discordId) : null;
    
    profileContent.innerHTML = `
        <div class="profile-header">
            <div class="profile-avatar">
                ${avatarUrl ? 
                    `<img src="${avatarUrl}" alt="${userData.name}" id="profileAvatar" style="opacity: 0;">` : 
                    `<div class="avatar-letter">${userData.name.charAt(0).toUpperCase()}</div>`
                }
            </div>
            <div class="profile-info">
                <h1 class="profile-name">${userData.name}</h1>
                <div class="${roleClass}">${roleText}</div>
                <div class="profile-links">
                    ${userData.discordId ? 
                        `<a href="https://discord.com/users/${userData.discordId}" target="_blank" class="profile-link">
                            <svg viewBox="0 0 24 24">
                                <path d="M14.82 4.26a10.14 10.14 0 0 0-.53 1.1 14.66 14.66 0 0 0-4.58 0 10.14 10.14 0 0 0-.53-1.1 16 16 0 0 0-4.13 1.3 17.33 17.33 0 0 0-3 11.59 16.6 16.6 0 0 0 5.07 2.59A12.89 12.89 0 0 0 8.23 18a9.65 9.65 0 0 1-1.71-.83 3.39 3.39 0 0 0 .42-.33 11.66 11.66 0 0 0 10.12 0c.14.09.28.19.42.33a10.14 10.14 0 0 1-1.71.83 12.89 12.89 0 0 0 1.08 1.78 16.44 16.44 0 0 0 5.06-2.59 17.22 17.22 0 0 0-3-11.59 16.09 16.09 0 0 0-4.09-1.35zM8.68 14.81a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.93 1.93 0 0 1 1.8 2 1.93 1.93 0 0 1-1.8 2zm6.64 0a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.92 1.92 0 0 1 1.8 2 1.92 1.92 0 0 1-1.8 2z"/>
                            </svg>
                            <span>${discordUsername || 'Discord'}</span>
                        </a>` : 
                        ''
                    }
                    ${userData.telegramId ? 
                        `<a href="#" class="profile-link telegram-link">
                            <svg viewBox="0 0 100 100">
                                <path d="M89.442 11.418c-12.533 5.19-66.27 27.449-81.118 33.516-9.958 3.886-4.129 7.529-4.129 7.529s8.5 2.914 15.786 5.1 11.172-.243 11.172-.243l34.244-23.073c12.143-8.257 9.229-1.457 6.315 1.457-6.315 6.315-16.758 16.272-25.501 24.287-3.886 3.4-1.943 6.315-.243 7.772 6.315 5.343 23.558 16.272 24.53 17.001 5.131 3.632 15.223 8.861 16.758-2.186l6.072-38.13c1.943-12.872 3.886-24.773 4.129-28.173.728-8.257-8.015-4.857-8.015-4.857z"/>
                            </svg>
                            <span>ID: ${userData.telegramId}</span>
                        </a>` : 
                        ''
                    }
                    ${!userData.discordId && !userData.telegramId ? 
                        `<span class="no-link">Без привязки</span>` : 
                        ''
                    }
                </div>
            </div>
        </div>
        
        <div class="profile-details">
            ${banStatus && banStatus.isBanned ? `
            <div class="profile-card ban-info-card">
                <h3>Информация о блокировке</h3>
                ${!banStatus.isPermanent ? `
                <div class="info-row">
                    <span class="info-label">До окончания:</span>
                    <span class="info-value subscription-status active">${banStatus.remainingTime} дн.</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Срок блокировки:</span>
                    <span class="info-value">До ${formatBanDate(banStatus.banEnd)}</span>
                </div>
                ` : `
                <div class="info-row">
                    <span class="info-label">До окончания:</span>
                    <span class="info-value subscription-status forever">Безлимит</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Срок блокировки:</span>
                    <span class="info-value">Навсегда</span>
                </div>
                `}
                <div class="ban-reason">
                    <strong style='color: #ff6666'>Причина:</strong><br>${banStatus.reason}
                </div>
            </div>
            ` : ''}
            
            ${banStatus && banStatus.wasBanned ? `
            <div class="profile-card ban-info-card">
                <h3>ℹ️ История блокировок</h3>
                <div class="info-row">
                    <span class="info-label">Статус:</span>
                    <span class="info-value ban-status expired">Блокировка истекла</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Дата блокировки:</span>
                    <span class="info-value">${formatBanDate(banStatus.banTime)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Дата окончания:</span>
                    <span class="info-value">${formatBanDate(banStatus.banEnd)}</span>
                </div>
                <div class="ban-reason">
                    <strong>Причина:</strong> ${banStatus.reason}
                </div>
            </div>
            ` : ''}
            
            <div class="profile-card">
                <h3>Основная информация</h3>
                <div class="info-row">
                    <span class="info-label">HWID:</span>
                    <span class="info-value">${userData.hwid}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Статус:</span>
                    <span class="info-value">${userData.group_id}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">До окончания:</span>
                    <span class="info-value subscription-status ${subscriptionStatus.status}">${subscriptionStatus.text}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Срок подписки:</span>
                    <span class="info-value">${formatDate(userData.end)}</span>
                </div>
            </div>
            
            <div class="profile-card">
                <h3>Привязки аккаунтов</h3>
                <div class="info-row">
                    <span class="info-label">Discord ID:</span>
                    <span class="info-value">${userData.discordId || 'Не привязан'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Telegram ID:</span>
                    <span class="info-value">${userData.telegramId || 'Не привязан'}</span>
                </div>
            </div>
        </div>
    `;
    
    if (userData.discordId && avatarUrl) {
        const avatarElement = document.getElementById('profileAvatar');
        if (avatarElement) {
            loadAvatarSequentially(userData.discordId, avatarElement, avatarUrl);
        }
    }
}

async function loadProfileData() {
    const urlParams = new URLSearchParams(window.location.search);
    const hwid = urlParams.get('hwid');
    
    if (!hwid) {
        displayProfile(null);
        return;
    }
    
    // Сначала загружаем черновые данные и показываем их
    const draftResult = await loadDraftProfileData(hwid);
    
    if (!draftResult) {
        displayProfile(null);
        return;
    }
    
    const { userData, banStatus, discordId } = draftResult;
    
    // Показываем черновые данные сразу
    await displayProfile(userData, banStatus);
    
    // Затем, не блокируя интерфейс, загружаем данные из кэша и API
    if (discordId) {
        setTimeout(() => {
            updateProfileWithCacheAndApi(draftResult, hwid);
        }, 100);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    loadProfileData();
});