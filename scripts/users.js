// users.js - полная версия с данными из таблицы (Tab9 = UserName, Tab10 = AvatarHash)
// Версия 3.0 - без dis-api

document.addEventListener('DOMContentLoaded', function() {
    // ==================== ОЧЕРЕДЬ ЗАГРУЗКИ АВАТАРОВ ====================
    class AvatarQueue {
        constructor(maxConcurrent = 5, delayBetweenBatches = 200) {
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
    
    // ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
    const avatarLoadQueue = new AvatarQueue(5, 200);
    let draftDataLoaded = false;
    let draftUsers = [];
    const loadedAvatars = new Set();
    let updateInProgress = false;
    
    // Ключи для localStorage кэша
    const USERS_CACHE_KEY = 'users_list_cache_v2';
    const USERS_CACHE_TTL = 5 * 60 * 1000; // 5 минут
    
    // Приоритеты ролей для сортировки
    const ROLE_PRIORITY = {
        'Создатель': 1,
        'Менеджер': 2,
        'Админ': 3,
        'Партнёр': 4,
        'Медиа': 5,
        'Игрок': 6,
        'Забанен': 999
    };
    
    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
    
    function getSortPriority(user) {
        if (user.isBanned) return 999;
        if (user.licenseCategory === 'nolicense') return 500;
        if (user.licenseCategory === 'expired') return 400;
        return ROLE_PRIORITY[user.roleRaw] || 99;
    }
    
    /**
     * Загрузить аватар для пользователя (из таблицы Tab10)
     */
    async function loadAvatarForUser(discordId, avatarHash) {
        if (!discordId || !avatarHash || loadedAvatars.has(discordId)) return;
        
        const avatarElement = document.getElementById(`user-${discordId}-avatar`);
        if (!avatarElement) return;
        
        // Проверяем кэш аватара
        const cachedAvatarUrl = window.ProfileData.getCachedAvatarUrl(discordId);
        if (cachedAvatarUrl) {
            avatarElement.src = cachedAvatarUrl;
            avatarElement.style.opacity = '1';
            loadedAvatars.add(discordId);
            
            const avatarBlock = avatarElement.closest('.avatar_block');
            if (avatarBlock) {
                const letterDiv = avatarBlock.querySelector('.avatar_letter');
                if (letterDiv) letterDiv.style.opacity = '0';
            }
            return;
        }
        
        // Загружаем через очередь
        avatarLoadQueue.add(async () => {
            const avatarUrl = await window.ProfileData.getDiscordAvatarUrl(discordId, avatarHash);
            if (avatarUrl) {
                avatarElement.src = avatarUrl;
                avatarElement.style.opacity = '1';
                loadedAvatars.add(discordId);
                
                // Скрываем букву
                const avatarBlock = avatarElement.closest('.avatar_block');
                if (avatarBlock) {
                    const letterDiv = avatarBlock.querySelector('.avatar_letter');
                    if (letterDiv) letterDiv.style.opacity = '0';
                }
            }
        });
    }
    
    /**
     * Получить отображаемое имя пользователя (из таблицы Tab9)
     */
    function getDisplayNameFromUser(user) {
        if (user.userName && user.userName.trim() !== '') {
            return user.userName;
        }
        // fallback на HWID
        return window.ProfileData.getShortHwid(user.hwid, 20);
    }
    
    /**
     * Загрузка кэша из localStorage
     */
    function loadUsersFromCache() {
        try {
            const cached = localStorage.getItem(USERS_CACHE_KEY);
            if (cached) {
                const cache = JSON.parse(cached);
                if (cache.timestamp && Date.now() - cache.timestamp < USERS_CACHE_TTL) {
                    console.log(`Загружено ${cache.users?.length || 0} пользователей из кэша`);
                    return cache.users || null;
                }
            }
        } catch (e) {
            console.warn('Ошибка загрузки кэша:', e);
        }
        return null;
    }
    
    function saveUsersToCache(users) {
        try {
            localStorage.setItem(USERS_CACHE_KEY, JSON.stringify({
                users: users,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('Ошибка сохранения кэша:', e);
        }
    }
    
    /**
     * Отображение списка пользователей
     */
    function displayUsers(users, isFromCache = false) {
        const adminListTitle = document.getElementById('adminListTitle');
        const adminListBlocks = document.getElementById('adminListBlocks');
        
        if (!adminListTitle || !adminListBlocks) {
            console.error('Элементы для отображения не найдены');
            return;
        }
        
        // Подсчет пользователей по категориям
        const activeUsers = users.filter(user => user.licenseCategory === 'active');
        const nolicenseUsers = users.filter(user => user.licenseCategory === 'nolicense');
        const bannedUsers = users.filter(user => user.licenseCategory === 'banned');
        const expiredUsers = users.filter(user => user.licenseCategory === 'expired');
        const allUsers = users;
        
        // Формирование заголовка со статистикой
        const parts = [];
        
        if (activeUsers.length > 0) parts.push(`
            <div id="activeUsers" class="stat-badge stat-active" title="Активные лицензии">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <polyline points="9 15 11 17 16 12"></polyline>
                </svg>
                <span>${activeUsers.length}</span>
            </div>
        `);
        
        if (bannedUsers.length > 0) parts.push(`
            <div id="bannedUsers" class="stat-badge stat-banned" title="Забаненные пользователи">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                </svg>
                <span>${bannedUsers.length}</span>
            </div>
        `);
        
        if (expiredUsers.length > 0) parts.push(`
            <div id="expiredUsers" class="stat-badge stat-expired" title="Истекшие лицензии">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span>${expiredUsers.length}</span>
            </div>
        `);
        
        if (nolicenseUsers.length > 0) parts.push(`
            <div id="nolicenseUsers" class="stat-badge stat-nolicense" title="Без лицензии">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="8" y1="12" x2="16" y2="18"></line>
                    <line x1="16" y1="12" x2="8" y2="18"></line>
                </svg>
                <span>${nolicenseUsers.length}</span>
            </div>
        `);
        
        const cacheIndicator = isFromCache ? '<span class="cache-indicator" title="Данные из кэша">📦</span>' : '';
        
        adminListTitle.innerHTML = `Лицензии${cacheIndicator}<div class="adminlist_box">
            <div id="allUsers" class="stat-badge stat-all" title="Все пользователи">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="8" y="8" width="12" height="12" rx="2"></rect>
                    <rect x="4" y="4" width="12" height="12" rx="2"></rect>
                </svg>
                <span>${allUsers.length}</span>
            </div>
        ${parts.join('')}</div>`;
        
        adminListBlocks.innerHTML = '';
        
        users.forEach(user => {
            const userCard = document.createElement('div');
            
            let cardId = 'item-player';
            if (user.roleRaw === 'Создатель') cardId = 'item-creator';
            else if (user.roleRaw === 'Менеджер') cardId = 'item-manager';
            else if (user.roleRaw === 'Админ') cardId = 'item-admin';
            else if (user.roleRaw === 'Партнёр') cardId = 'item-partner';
            else if (user.roleRaw === 'Медиа') cardId = 'item-media';
            else if (user.roleRaw === 'Игрок') cardId = 'item-player';
            else if (user.isBanned) cardId = 'item-banned';
            
            userCard.className = 'admin_card';
            userCard.id = cardId;
            
            let tagId = 'player';
            if (user.roleRaw === 'Создатель') tagId = 'creator';
            else if (user.roleRaw === 'Менеджер') tagId = 'manager';
            else if (user.roleRaw === 'Админ') tagId = 'admin';
            else if (user.roleRaw === 'Партнёр') tagId = 'partner';
            else if (user.roleRaw === 'Медиа') tagId = 'media';
            else if (user.roleRaw === 'Игрок') tagId = 'player';
            else if (user.isBanned) tagId = 'banned';
            
            const displayName = getDisplayNameFromUser(user);
            const escapedName = window.ProfileData.escapeHtml(displayName);
            const escapedHwid = window.ProfileData.escapeHtml(window.ProfileData.getShortHwid(user.hwid, 20));
            
            // Статус HWID
            let statusHtml = '';
            if (!user.isBanned && user.displayStatus) {
                const statusTagId = user.displayStatus === 'HWID' ? 'hwid' : 'not-hwid';
                statusHtml = `<div class="admin_group" id="tag-${statusTagId}">
                                <span class="admin_group_text">${user.displayStatus}</span>
                            </div>`;
            }
            
            // Причина бана
            let banReasonHtml = '';
            if (user.isBanned && user.banReason) {
                banReasonHtml = `<div class="admin_term_reason">${window.ProfileData.escapeHtml(user.banReason)}</div>`;
            }
            
            // Ссылки на соцсети
            let linksHtml = '';
            if (!user.isBanned) {
                if (user.discordId || user.telegramId) {
                    if (user.discordId) {
                        linksHtml += `<a href="https://discord.com/users/${user.discordId}" target="_blank" id="link_prof" class="discord-link DS" data-discord-id="${user.discordId}">
                                        <svg viewBox="0 0 48 48" fill="none">
                                            <use href="./content/svg/link-discord.svg"></use>
                                        </svg>
                                        <span class="discord-username">${escapedName}</span>
                                    </a>`;
                    }
                    if (user.telegramId) {
                        linksHtml += `<a target="_blank" id="link_prof" class="discord-link telegram-link TG" href="https://t.me/${user.telegramId}">
                                        <svg viewBox="0 0 48 48" fill="none">
                                            <use href="./content/svg/link-telegram.svg"></use>
                                        </svg>
                                        <span class="discord-username">ID: ${window.ProfileData.escapeHtml(user.telegramId)}</span>
                                    </a>`;
                    }
                } else {
                    linksHtml = `<a target="_blank" id="link_prof" style="max-width: 100%;" class="no-link">
                                    <p id="no-link">Без привязки!</p>
                                </a>`;
                }
            }
            
            userCard.innerHTML = `
            <div id="admins_card">
                <div class="admin_term">
                    <div class="adminlist_button steam_button" id="tag-${tagId}">
                        <span>${window.ProfileData.escapeHtml(user.roleText)}</span>
                    </div>
                    ${statusHtml}
                    <span class="admin_term_text" id="${user.termId}">${window.ProfileData.escapeHtml(user.formattedEndDate)}</span>
                </div>
                <div class="adminlist_info">
                    <a href="#" onclick="ProfileModal.openByHwid('${user.hwid}'); return false;">
                        <div class="avatar_block">
                            <div class="avatar_letter">${escapedName.charAt(0).toUpperCase()}</div>
                            <div class='avatar-img'>
                                <img class="admins_avatar" id="user-${user.discordId}-avatar" src="./images/none.png" alt="">
                            </div>
                        </div>
                        <get-avatar></get-avatar>
                    </a>
                    <div class="adminlist_buttons">
                        <div id="admins_info">
                            <span class="admin_nickname">${escapedHwid}</span>
                            ${!user.isBanned ? `<div id="link_block">${linksHtml}</div>` : ''}
                            ${banReasonHtml}
                        </div>
                    </div>
                </div>
            </div>`;
            
            adminListBlocks.appendChild(userCard);
            
            // Загружаем аватар из таблицы (Tab10)
            if (user.discordId && user.avatarHash) {
                // Проверяем кэш аватара
                const cachedAvatar = window.ProfileData.getCachedAvatarUrl(user.discordId);
                if (cachedAvatar) {
                    const avatarElement = document.getElementById(`user-${user.discordId}-avatar`);
                    if (avatarElement && avatarElement.src !== cachedAvatar) {
                        avatarElement.src = cachedAvatar;
                        avatarElement.style.opacity = '1';
                        const avatarBlock = avatarElement.closest('.avatar_block');
                        if (avatarBlock) {
                            const letterDiv = avatarBlock.querySelector('.avatar_letter');
                            if (letterDiv) letterDiv.style.opacity = '0';
                        }
                    }
                } else {
                    // Асинхронная загрузка
                    loadAvatarForUser(user.discordId, user.avatarHash);
                }
            }
        });
    }
    
    function showLoadingIndicator() {
        const adminListBlocks = document.getElementById('adminListBlocks');
        if (adminListBlocks && adminListBlocks.children.length === 0) {
            adminListBlocks.innerHTML = `
                <div class="loading-indicator" style="display: flex; justify-content: center; align-items: center; flex-direction: column; padding: 40px; text-align: center; color: #888;">
                    <div class="loading-spinner" style="width: 40px; height: 40px; border: 3px solid #2a2a2a; border-top-color: #ff6b6b; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 15px;"></div>
                    <span>Загрузка данных...</span>
                </div>
            `;
            if (!document.querySelector('#loading-spinner-style')) {
                const style = document.createElement('style');
                style.id = 'loading-spinner-style';
                style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
                document.head.appendChild(style);
            }
        }
    }
    
    function showErrorMessage(message) {
        const adminListBlocks = document.getElementById('adminListBlocks');
        if (adminListBlocks) {
            adminListBlocks.innerHTML = `
                <div class="error-message" style="display: flex; justify-content: center; align-items: center; flex-direction: column; padding: 40px; text-align: center; color: #ff5d5d;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none"/>
                    </svg>
                    <span style="margin-top: 15px;">${message}</span>
                    <button id="retryLoadBtn" style="margin-top: 20px; padding: 8px 20px; background: #ff6b6b; border: none; border-radius: 6px; color: white; cursor: pointer;">Повторить</button>
                </div>
            `;
            const retryBtn = document.getElementById('retryLoadBtn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => loadDraftData(true));
            }
        }
    }
    
    async function refreshDataFromAPI() {
        if (updateInProgress) {
            console.log('Обновление уже выполняется');
            return;
        }
        
        updateInProgress = true;
        console.log('Фоновое обновление данных из API...');
        
        try {
            const users = await window.ProfileData.fetchAllUsers();
            
            if (users && users.length > 0) {
                users.sort((a, b) => {
                    const priorityA = getSortPriority(a);
                    const priorityB = getSortPriority(b);
                    if (priorityA !== priorityB) return priorityA - priorityB;
                    return (a.hwid || '').localeCompare(b.hwid || '');
                });
                
                draftUsers = users;
                saveUsersToCache(users);
                displayUsers(draftUsers, false);
                console.log(`Данные обновлены: ${users.length} пользователей`);
            }
        } catch (error) {
            console.error('Ошибка фонового обновления:', error);
        } finally {
            updateInProgress = false;
        }
    }
    
    async function loadDraftData(forceRefresh = false) {
        try {
            const cachedUsers = !forceRefresh ? loadUsersFromCache() : null;
            
            if (cachedUsers && cachedUsers.length > 0) {
                console.log(`Отображаем ${cachedUsers.length} пользователей из кэша`);
                draftUsers = cachedUsers;
                displayUsers(draftUsers, true);
                draftDataLoaded = true;
                
                setTimeout(() => refreshDataFromAPI(), 100);
                return { draftUsers: cachedUsers, fromCache: true };
            }
            
            console.log('Кэш пуст, загружаем из API...');
            showLoadingIndicator();
            
            const users = await window.ProfileData.fetchAllUsers();
            
            if (!users || users.length === 0) {
                showErrorMessage('Не удалось загрузить данные.');
                return null;
            }
            
            console.log(`Загружено ${users.length} записей из API`);
            
            users.sort((a, b) => {
                const priorityA = getSortPriority(a);
                const priorityB = getSortPriority(b);
                if (priorityA !== priorityB) return priorityA - priorityB;
                return (a.hwid || '').localeCompare(b.hwid || '');
            });
            
            draftUsers = users;
            saveUsersToCache(users);
            displayUsers(draftUsers, false);
            draftDataLoaded = true;
            
            return { draftUsers: users, fromCache: false };
            
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
            showErrorMessage(`Ошибка загрузки: ${error.message || 'Неизвестная ошибка'}`);
            return null;
        }
    }
    
    function waitForDOM() {
        return new Promise((resolve) => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', resolve);
            } else {
                resolve();
            }
        });
    }
    
    async function init() {
        await waitForDOM();
        
        if (!window.ProfileData) {
            console.log('Users: Ожидание загрузки ProfileData...');
            const startTime = Date.now();
            const timeout = 10000;
            
            while (!window.ProfileData && (Date.now() - startTime) < timeout) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (!window.ProfileData) {
                console.error('ProfileData не загрузился');
                showErrorMessage('Не удалось загрузить модуль данных.');
                return;
            }
        }
        
        console.log('Users: ProfileData загружен, инициализация...');
        await loadDraftData();
        
        const refreshBtn = document.getElementById('refreshDataBtn');
        if (refreshBtn) {
            const newRefreshBtn = refreshBtn.cloneNode(true);
            refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
            newRefreshBtn.addEventListener('click', () => refreshDataFromAPI());
        }
    }
    
    init();
});