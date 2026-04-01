document.addEventListener('DOMContentLoaded', function() {
    const config = {
        adminsJsonUrl: 'https://lisikme.github.io/Nixware-allowed/admins.json',
        hwidJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/hwid4.json',
        tempJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/temps.json',
        discordJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/discords.json',
        telegramJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/telegrams.json',
        bansJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/bans.json',
        discordApiBase: 'https://dis-api.sakuri.ru/api/discord',
        proxy: 'https://proxy.sakuri.ru/api/proxy?url='
    };
    
    // Кэш для данных пользователей Discord (сроком на 1 час)
    const CACHE_DURATION = 60 * 60 * 1000; // 1 час в миллисекундах
    const DISCORD_DATA_CACHE_KEY = 'discord_users_batch_cache';
    const PROXY_FAILURE_CACHE_KEY = 'proxy_failure_cache';
    
    // Хранилище для имен пользователей Discord
    const discordUsernames = new Map();
    const discordAvatars = new Map();
    let batchUserData = null; // Данные из batch-запроса
    
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
    
    // Функция для получения данных пользователей Discord через batch-запрос
    async function fetchBatchDiscordUsers(discordIds) {
        if (!discordIds || discordIds.length === 0) return {};
        
        const uniqueIds = [...new Set(discordIds.filter(id => id && id !== 'null'))];
        if (uniqueIds.length === 0) return {};
        
        // Проверяем кэш
        const cachedData = getCachedDiscordData();
        if (cachedData) {
            console.log('Используем кэшированные данные Discord');
            return cachedData;
        }
        
        console.log(`Загружаем данные для ${uniqueIds.length} пользователей Discord`);
        
        // Пробуем сначала без прокси
        let response = null;
        let usedProxy = false;
        
        try {
            // Используем POST запрос для batch получения
            const url = `${config.discordApiBase}/users`;
            const directResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: uniqueIds })
            });
            
            if (directResponse.ok) {
                response = await directResponse.json();
            } else {
                throw new Error(`HTTP ${directResponse.status}`);
            }
        } catch (error) {
            console.warn('Прямой запрос не удался, используем прокси:', error.message);
            usedProxy = true;
            
            try {
                const proxyUrl = `${config.proxy}"${encodeURIComponent(`${config.discordApiBase}/users`)}"`;
                const proxyResponse = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ids: uniqueIds })
                });
                
                if (proxyResponse.ok) {
                    response = await proxyResponse.json();
                } else {
                    throw new Error(`Proxy HTTP ${proxyResponse.status}`);
                }
            } catch (proxyError) {
                console.error('Ошибка при запросе через прокси:', proxyError);
                return {};
            }
        }
        
        // Обрабатываем ответ
        const userDataMap = {};
        
        if (response && response.results) {
            for (const result of response.results) {
                if (result.success && result.data) {
                    const userId = result.user_id || result.data.id;
                    userDataMap[userId] = {
                        username: result.data.username,
                        global_name: result.data.global_name,
                        discriminator: result.data.discriminator,
                        avatar: result.data.avatar,
                        avatar_url: result.data.avatar_url,
                        bot: result.data.bot || false
                    };
                }
            }
        }
        
        // Сохраняем в кэш
        saveCachedDiscordData(userDataMap);
        
        return userDataMap;
    }
    
    // Сохранение данных Discord в кэш
    function saveCachedDiscordData(data) {
        const cacheData = {
            timestamp: Date.now(),
            data: data
        };
        localStorage.setItem(DISCORD_DATA_CACHE_KEY, JSON.stringify(cacheData));
    }
    
    // Получение данных из кэша
    function getCachedDiscordData() {
        const cached = localStorage.getItem(DISCORD_DATA_CACHE_KEY);
        if (!cached) return null;
        
        try {
            const cacheData = JSON.parse(cached);
            const now = Date.now();
            
            if (now - cacheData.timestamp < CACHE_DURATION) {
                return cacheData.data;
            }
        } catch (e) {
            console.warn('Ошибка чтения кэша:', e);
        }
        
        return null;
    }
    
    // Функция для получения аватарки из кэша или batch данных
    function getDiscordAvatar(discordId) {
        if (!discordId) return null;
        
        // Проверяем кэш аватарок
        const cachedAvatar = localStorage.getItem(`avatar_${discordId}`);
        if (cachedAvatar) return cachedAvatar;
        
        // Проверяем batch данные
        if (batchUserData && batchUserData[discordId]) {
            const userData = batchUserData[discordId];
            if (userData.avatar_url) return userData.avatar_url;
            if (userData.avatar) {
                return `https://cdn.discordapp.com/avatars/${discordId}/${userData.avatar}.png`;
            }
        }
        
        return null;
    }
    
    // Функция для получения имени пользователя из batch данных
    function getDiscordUsername(discordId, fallbackName) {
        if (!discordId) return fallbackName;
        
        // Проверяем Map
        if (discordUsernames.has(discordId)) {
            return discordUsernames.get(discordId);
        }
        
        // Проверяем кэш localStorage
        const cachedName = localStorage.getItem(`discord_name_${discordId}`);
        if (cachedName && cachedName !== 'undefined') {
            discordUsernames.set(discordId, cachedName);
            return cachedName;
        }
        
        // Проверяем batch данные
        if (batchUserData && batchUserData[discordId]) {
            const userData = batchUserData[discordId];
            let displayName = fallbackName;
            
            if (userData.username) {
                displayName = userData.username;
                if (userData.discriminator && userData.discriminator !== '0') {
                    displayName = `${userData.username}#${userData.discriminator}`;
                }
            } else if (userData.global_name) {
                displayName = userData.global_name;
            }
            
            discordUsernames.set(discordId, displayName);
            localStorage.setItem(`discord_name_${discordId}`, displayName);
            return displayName;
        }
        
        return fallbackName;
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
    
    const avatarQueue = new AvatarQueue(1, 30); // Последовательная загрузка аватаров
    
    async function loadDiscordAvatar(discordId, elementId) {
        if (!discordId) return;
        
        return avatarQueue.add(async () => {
            try {
                const avatarElement = document.getElementById(elementId);
                if (!avatarElement) return;
                
                // Показываем заглушку
                avatarElement.style.opacity = '0';
                
                // Получаем URL аватарки
                let avatarUrl = getDiscordAvatar(discordId);
                
                if (avatarUrl) {
                    // Пробуем загрузить изображение
                    try {
                        await tryLoadImage(avatarUrl, 5000);
                        avatarElement.src = avatarUrl;
                        avatarElement.style.opacity = '1';
                    } catch (imgError) {
                        // Если не удалось загрузить, пробуем через прокси
                        try {
                            const proxyUrl = `${config.proxy}"${encodeURIComponent(avatarUrl)}"`;
                            await tryLoadImage(proxyUrl, 5000);
                            avatarElement.src = proxyUrl;
                            avatarElement.style.opacity = '1';
                            localStorage.setItem(`avatar_${discordId}`, proxyUrl);
                        } catch (proxyError) {
                            console.warn(`Не удалось загрузить аватар для ${discordId}`);
                            avatarElement.style.opacity = '1';
                        }
                    }
                } else {
                    avatarElement.style.opacity = '1';
                }
            } catch (error) {
                console.warn(`Ошибка загрузки аватара для ${discordId}:`, error.message);
            }
        });
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
    
    async function loadUsersData() {
        try {
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
            
            const usersList = [];
            const bannedUsersList = [];
            const activeUsers = hwid["users:"] || hwid.users || [];
            
            // Собираем все Discord ID для batch-запроса
            const discordIdsToFetch = [];
            
            activeUsers.forEach((username) => {
                const discordId = getDiscordIdByHwid(username, discord);
                if (discordId) discordIdsToFetch.push(discordId);
            });
            
            // Дополнительно проверяем забаненных пользователей
            if (bans && typeof bans === 'object') {
                Object.keys(bans).forEach(bannedHwid => {
                    const discordId = getDiscordIdByHwid(bannedHwid, discord);
                    if (discordId && !discordIdsToFetch.includes(discordId)) {
                        discordIdsToFetch.push(discordId);
                    }
                });
            }
            
            // Загружаем данные Discord одним batch-запросом
            batchUserData = await fetchBatchDiscordUsers(discordIdsToFetch);
            
            // Формируем список пользователей
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
            
            const allUsers = [...usersList, ...bannedUsersList];
            
            allUsers.sort((a, b) => {
                const aRole = getUserRole(a.sid, adminDiscordIds);
                const bRole = getUserRole(b.sid, adminDiscordIds);
                
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
            
            displayUsers(allUsers, adminDiscordIds);
        } catch (error) {
            console.error('Ошибка загрузки:', error);
            document.getElementById('adminListTitle').textContent = 'Ошибка загрузки данных';
        }
    }
    
    function displayUsers(users, adminDiscordIds) {
        const adminListTitle = document.getElementById('adminListTitle');
        const adminListBlocks = document.getElementById('adminListBlocks');
        
        const activeUsers = users.filter(user => user.is_active && (!user.banStatus || !user.banStatus.isBanned));
        const bannedUsers = users.filter(user => user.banStatus && user.banStatus.isBanned);
        
        adminListTitle.textContent = `Подписки: ${activeUsers.length} - Баны: ${bannedUsers.length}`;
        adminListBlocks.innerHTML = '';
        
        const avatarPromisesList = [];
        
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
            
            const usernameSpanId = `username-${user.sid || user.hwid}`.replace(/[^a-zA-Z0-9-]/g, '_');
            const displayName = user.sid ? getDiscordUsername(user.sid, user.name) : user.name;
            
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
                                    <span class="discord-username" id="${usernameSpanId}">${displayName}</span>
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
            
            // Загружаем аватар последовательно
            if (user.sid) {
                avatarPromisesList.push(loadDiscordAvatar(user.sid, `user-${user.sid}-avatar`));
            }
        });
        
        // Не ждем загрузки всех аватаров, чтобы не блокировать отображение
        Promise.allSettled(avatarPromisesList).then(() => console.log('Все аватары загружены'));
    }
    
    function init() {
        loadUsersData();
    }
    
    init();
});