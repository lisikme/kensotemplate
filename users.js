document.addEventListener('DOMContentLoaded', function() {
    const config = {
        adminsJsonUrl: 'https://lisikme.github.io/Nixware-allowed/admins.json',
        hwidJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/hwid4.json',
        tempJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/temps.json',
        discordJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/discords.json',
        telegramJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/telegrams.json',
        bansJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/bans.json',
        discordApiBase: 'https://dis-api.sakuri.ru/api/discord/user/',
        proxy: 'https://proxy.sakuri.ru/api/proxy?url='
    };
    
    // Хранилище для имен пользователей Discord
    const discordUsernames = new Map();
    const usernamePromises = new Map();
    
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
    const discordNameQueue = new AvatarQueue(3, 1000); // Очередь для запросов имен
    
    async function loadDiscordAvatar(discordId, elementId, username) {
        if (!discordId) return;
        
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
                        const cachedAvatar = localStorage.getItem(cacheKey);
                        const userData = await fetchWithRetry(addCacheBuster(`${config.proxy}"${config.discordApiBase}${discordId}"`));
                        
                        if (userData.avatar && avatarElement) {
                            let avatarUrl = null;
                            const avatarHash = userData.avatar;
                            const discord_cdn = `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}`;
                            const isSameAvatar = cachedAvatar && cachedAvatar.includes(avatarHash);
                            
                            if (!isSameAvatar) {
                                try {
                                    avatarUrl = await tryLoadImage(`${config.proxy}"${discord_cdn}.gif"`, 8000);
                                } catch {
                                    avatarUrl = await tryLoadImage(`${config.proxy}"${discord_cdn}.png"`, 5000);
                                }
                                
                                if (avatarUrl) {
                                    avatarElement.src = avatarUrl;
                                    avatarElement.style.opacity = '1';
                                    localStorage.setItem(cacheKey, avatarUrl);
                                }
                            }
                        } else if (!userData.avatar) {
                            localStorage.removeItem(cacheKey);
                            if (avatarElement) {
                                avatarElement.src = '';
                                avatarElement.removeAttribute('src');
                            }
                        }
                    } catch (error) {
                        console.warn(`Ошибка для ${discordId}:`, error.message);
                    }
                });
            } finally {
                avatarPromises.delete(discordId);
            }
        })();
        
        avatarPromises.set(discordId, promise);
        return promise;
    }
    
    // Функция для получения имени пользователя Discord
    async function loadDiscordUsername(discordId, usernameElement, originalName) {
        if (!discordId) return;
        
        // Проверяем кэш
        if (discordUsernames.has(discordId)) {
            const cachedName = discordUsernames.get(discordId);
            if (usernameElement) {
                usernameElement.textContent = cachedName;
            }
            return;
        }
        
        // Проверяем, не идет ли уже запрос
        if (usernamePromises.has(discordId)) {
            const name = await usernamePromises.get(discordId);
            if (usernameElement) {
                usernameElement.textContent = name;
            }
            return;
        }
        
        const promise = discordNameQueue.add(async () => {
            try {
                // Проверяем localStorage кэш
                const cacheKey = `discord_name_${discordId}`;
                const cachedName = localStorage.getItem(cacheKey);
                
                if (cachedName && cachedName !== 'undefined') {
                    discordUsernames.set(discordId, cachedName);
                    if (usernameElement) {
                        usernameElement.textContent = cachedName;
                    }
                    return cachedName;
                }
                
                // Запрос к API
                const userData = await fetchWithRetry(addCacheBuster(`${config.proxy}"${config.discordApiBase}${discordId}"`));
                
                let displayName = originalName;
                if (userData && userData.username) {
                    displayName = userData.username;
                    if (userData.discriminator && userData.discriminator !== '0') {
                        displayName = `${userData.username}#${userData.discriminator}`;
                    }
                    // Сохраняем в кэш
                    localStorage.setItem(cacheKey, displayName);
                    discordUsernames.set(discordId, displayName);
                } else if (userData && userData.global_name) {
                    displayName = userData.global_name;
                    localStorage.setItem(cacheKey, displayName);
                    discordUsernames.set(discordId, displayName);
                } else {
                    // Если не удалось получить имя, используем ID
                    displayName = `${user.name}`;
                }
                
                if (usernameElement) {
                    usernameElement.textContent = displayName;
                }
                return displayName;
            } catch (error) {
                console.warn(`Ошибка получения имени для ${discordId}:`, error.message);
                const fallbackName = `${user.name}`;
                if (usernameElement) {
                    usernameElement.textContent = fallbackName;
                }
                return fallbackName;
            }
        });
        
        usernamePromises.set(discordId, promise);
        const result = await promise;
        usernamePromises.delete(discordId);
        return result;
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
        
        adminListTitle.textContent = `Subscribers: ${activeUsers.length} | Banned: ${bannedUsers.length}`;
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
            
            // Генерируем уникальный ID для элемента username
            const usernameSpanId = `username-${user.sid || user.hwid}`.replace(/[^a-zA-Z0-9-]/g, '_');
            
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
            
            // Загружаем аватар
            if (user.sid) {
                avatarPromisesList.push(loadDiscordAvatar(user.sid, `user-${user.sid}-avatar`, user.name));
            }
            
            // Загружаем имя пользователя Discord
            if (user.sid) {
                const usernameSpan = document.getElementById(usernameSpanId);
                if (usernameSpan) {
                    // Сразу показываем ID, потом заменим на имя
                    usernamePromisesList.push(loadDiscordUsername(user.sid, usernameSpan, user.name));
                }
            }
        });
        
        Promise.allSettled([...avatarPromisesList, ...usernamePromisesList]).then(() => console.log('Все данные загружены'));
    }
    
    function init() {
        loadUsersData();
    }
    
    init();
});