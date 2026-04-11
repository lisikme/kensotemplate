// users.js - полная версия с интеграцией profile-data модуля
// Версия 2.0

document.addEventListener('DOMContentLoaded', function() {
    // ==================== ОЧЕРЕДЬ ЗАГРУЗКИ АВАТАРОВ ====================
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
    
    // ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
    const avatarLoadQueue = new AvatarQueue(3, 300);
    let draftDataLoaded = false;
    let draftUsers = [];
    const loadedAvatars = new Set();
    let updateInProgress = false;
    
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
    
    /**
     * Получить приоритет сортировки пользователя
     */
    function getSortPriority(user) {
        if (user.isBanned) return 999;
        if (user.licenseCategory === 'nolicense') return 500;
        if (user.licenseCategory === 'expired') return 400;
        return ROLE_PRIORITY[user.roleRaw] || 99;
    }
    
    /**
     * Загрузить аватар для пользователя
     */
    async function loadAvatarForUser(discordId, userData) {
        if (!discordId || !userData || loadedAvatars.has(discordId)) return;
        
        const avatarElement = document.getElementById(`user-${discordId}-avatar`);
        if (!avatarElement) return;
        
        if (userData.avatar) {
            avatarLoadQueue.add(async () => {
                const avatarUrl = await window.ProfileData.getDiscordAvatarUrl(discordId, userData.avatar);
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
        } else {
            if (avatarElement.src !== './images/none.png' && !avatarElement.src.includes('none.png')) {
                avatarElement.src = './images/none.png';
            }
        }
    }
    
    /**
     * Обновить имя пользователя на странице
     */
    function updateUsernameOnPage(discordId, userData) {
        const usernameElements = document.querySelectorAll(`.discord-link[data-discord-id="${discordId}"] .discord-username`);
        let displayName = window.ProfileData.getDisplayName(null, userData);
        
        usernameElements.forEach(element => {
            element.textContent = displayName;
        });
    }
    
    /**
     * Синхронная загрузка имени из кэша
     */
    function loadDiscordUsernameSync(discordId, originalName) {
        if (!discordId || !discordId.match(/^\d{17,19}$/)) {
            return originalName || 'No ID';
        }
        return originalName || discordId.slice(0, 8);
    }
    
    /**
     * Обработка полученных Discord данных
     */
    async function processUserDataResult(discordId, userData) {
        if (!userData) return;
        updateUsernameOnPage(discordId, userData);
        await loadAvatarForUser(discordId, userData);
    }
    
    /**
     * Загрузка кэша из localStorage
     */
    function loadCacheFromLocalStorage(discordIds) {
        console.log('Загрузка кэша Discord из localStorage...');
        let loadedCount = 0;
        
        for (const discordId of discordIds) {
            try {
                const stored = localStorage.getItem(`discord_user_${discordId}`);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.data && Date.now() - parsed.timestamp < window.ProfileData.config.discordCacheTTL) {
                        setTimeout(() => {
                            processUserDataResult(discordId, parsed.data);
                        }, 100);
                        loadedCount++;
                    }
                }
            } catch(e) {}
        }
        console.log(`Загружено ${loadedCount} записей из кэша`);
    }
    
    /**
     * Отображение списка пользователей
     */
    function displayUsers(users) {
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
        // const foreverUsers = users.filter(user => user.licenseCategory === 'forever');
        const allUsers = users;
        
        // Формирование заголовка со статистикой
        const parts = [];
        
        if (activeUsers.length > 0) parts.push(`
            <div id="activeUsers" class="stat-badge stat-active" title="Активные лицензии">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <polyline points="9 15 11 17 16 12"></polyline>
                </svg>
                <span>${activeUsers.length}</span>
            </div>
        `);
        
        // if (foreverUsers.length > 0) parts.push(`
        //     <div id="foreverUsers" class="stat-badge stat-forever" title="Бессрочные лицензии">
        //         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        //             <path d="M12 2L15 9H22L16 14L19 21L12 16.5L5 21L8 14L2 9H9L12 2Z" stroke="currentColor" fill="none"/>
        //         </svg>
        //         <span>${foreverUsers.length}</span>
        //     </div>
        // `);
        
        if (bannedUsers.length > 0) parts.push(`
            <div id="bannedUsers" class="stat-badge stat-banned" title="Забаненные пользователи">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                </svg>
                <span>${bannedUsers.length}</span>
            </div>
        `);
        
        if (expiredUsers.length > 0) parts.push(`
            <div id="expiredUsers" class="stat-badge stat-expired" title="Истекшие лицензии">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span>${expiredUsers.length}</span>
            </div>
        `);
        
        if (nolicenseUsers.length > 0) parts.push(`
            <div id="nolicenseUsers" class="stat-badge stat-nolicense" title="Без лицензии">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="8" y1="12" x2="16" y2="18"></line>
                    <line x1="16" y1="12" x2="8" y2="18"></line>
                </svg>
                <span>${nolicenseUsers.length}</span>
            </div>
        `);
        
        // Обновляем заголовок
        adminListTitle.innerHTML = `Лицензии<div class="adminlist_box">
            <div id="allUsers" class="stat-badge stat-all" title="Все пользователи">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="8" y="8" width="12" height="12" rx="2"></rect>
                    <rect x="4" y="4" width="12" height="12" rx="2"></rect>
                </svg>
                <span>${allUsers.length}</span>
            </div>
        ${parts.join('')}</div>`;
        
        // Очищаем контейнер с карточками
        adminListBlocks.innerHTML = '';
        
        // Создаем карточки для каждого пользователя
        users.forEach(user => {
            const userCard = document.createElement('div');
            
            // Определяем ID карточки в зависимости от роли
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
            
            // Определяем тег роли
            let tagId = 'player';
            if (user.roleRaw === 'Создатель') tagId = 'creator';
            else if (user.roleRaw === 'Менеджер') tagId = 'manager';
            else if (user.roleRaw === 'Админ') tagId = 'admin';
            else if (user.roleRaw === 'Партнёр') tagId = 'partner';
            else if (user.roleRaw === 'Медиа') tagId = 'media';
            else if (user.roleRaw === 'Игрок') tagId = 'player';
            else if (user.isBanned) tagId = 'banned';
            
            const usernameSpanId = `username-${(user.discordId || user.hwid).replace(/[^a-zA-Z0-9-]/g, '_')}`;
            const cachedUsername = user.discordId ? loadDiscordUsernameSync(user.discordId, user.hwid) : user.hwid;
            
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
                        linksHtml += `<a href="https://discord.com/users/${user.discordId}" target="_blank" id="link_prof" class="discord-link DS" data-discord-id="${user.discordId}" data-original-name="${user.hwid}">
                                        <svg viewBox="0 0 48 48" fill="none">
                                            <use href="./content/svg/link-discord.svg"></use>
                                        </svg>
                                        <span class="discord-username" id="${usernameSpanId}">${window.ProfileData.escapeHtml(cachedUsername)}</span>
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
            
            // Формируем карточку
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
                            <div class="avatar_letter">${window.ProfileData.escapeHtml(user.hwid.charAt(0).toUpperCase())}</div>
                            <div class='avatar-img'>
                                <img class="admins_avatar" id="user-${user.discordId}-avatar" src="./images/none.png" alt="">
                            </div>
                        </div>
                        <get-avatar></get-avatar>
                    </a>
                    <div class="adminlist_buttons">
                        <div id="admins_info">
                            <span class="admin_nickname">${window.ProfileData.escapeHtml(window.ProfileData.getShortHwid(user.hwid, 20))}</span>
                            ${!user.isBanned ? `<div id="link_block">${linksHtml}</div>` : ''}
                            ${banReasonHtml}
                        </div>
                    </div>
                </div>
            </div>`;
            
            adminListBlocks.appendChild(userCard);
            
            // Асинхронно загружаем Discord данные для этого пользователя
            if (user.discordId && user.discordId.match(/^\d{17,19}$/)) {
                window.ProfileData.getDiscordUserData(user.discordId).then(discordData => {
                    if (discordData) {
                        loadAvatarForUser(user.discordId, discordData);
                        updateUsernameOnPage(user.discordId, discordData);
                    }
                });
            }
        });
    }
    
    /**
     * Основная загрузка данных
     */
    async function loadDraftData() {
        try {
            console.log('Загрузка данных из API...');
            const users = await window.ProfileData.fetchAllUsers();
            
            if (!users || users.length === 0) {
                console.error('Не удалось загрузить данные');
                const adminListTitle = document.getElementById('adminListTitle');
                if (adminListTitle) adminListTitle.textContent = 'Ошибка загрузки данных';
                return null;
            }
            
            console.log(`Загружено ${users.length} записей из API`);
            
            // Сортируем пользователей
            users.sort((a, b) => {
                const priorityA = getSortPriority(a);
                const priorityB = getSortPriority(b);
                if (priorityA !== priorityB) return priorityA - priorityB;
                return a.hwid.localeCompare(b.hwid);
            });
            
            draftUsers = users;
            
            // Загружаем кэш Discord данных из localStorage
            const allDiscordIds = [];
            draftUsers.forEach(user => {
                if (user.discordId && user.discordId.match(/^\d{17,19}$/)) {
                    allDiscordIds.push(user.discordId);
                }
            });
            loadCacheFromLocalStorage(allDiscordIds);
            
            // Отображаем пользователей
            displayUsers(draftUsers);
            draftDataLoaded = true;
            console.log('Данные загружены и отображены');
            
            // Фоновое обновление Discord данных (только если прошло более 1 дня)
            setTimeout(async () => {
                if (window.ProfileData.shouldUpdateDiscordData()) {
                    console.log('Прошло более 1 дня, выполняем фоновое обновление Discord данных...');
                    
                    const discordIds = draftUsers
                        .filter(u => u.discordId && u.discordId.match(/^\d{17,19}$/))
                        .map(u => u.discordId);
                    
                    if (discordIds.length > 0) {
                        const results = await window.ProfileData.refreshAllDiscordData(discordIds, (progress) => {
                            if (progress.current) {
                                console.log(`Обновление Discord: ${progress.current}/${progress.total}`);
                            } else if (progress.skipped) {
                                console.log(`Обновление пропущено: ${progress.reason}`);
                                console.log(`Следующее обновление через: ${progress.nextUpdateIn}`);
                            } else if (progress.completed) {
                                console.log(`Обновление завершено. Обновлено ${progress.updated} из ${progress.total} пользователей`);
                            }
                        });
                        
                        // Обновляем отображение для обновленных пользователей
                        for (const result of results) {
                            if (result.data) {
                                await processUserDataResult(result.discordId, result.data);
                            }
                        }
                        
                        if (results.length > 0) {
                            console.log(`Фоновое обновление завершено. Обновлено ${results.length} пользователей`);
                        }
                    }
                } else {
                    const nextUpdateIn = window.ProfileData.getTimeUntilNextDiscordUpdate();
                    console.log(`Discord данные актуальны. Следующее обновление через: ${nextUpdateIn}`);
                    
                    // Показываем информацию в консоли о времени последнего обновления
                    const lastUpdate = window.ProfileData.getLastDiscordUpdateTime();
                    if (lastUpdate) {
                        console.log(`Последнее обновление Discord: ${new Date(lastUpdate).toLocaleString()}`);
                    }
                }
            }, 2000);
            
            return { draftUsers: users };
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
            const adminListTitle = document.getElementById('adminListTitle');
            if (adminListTitle) adminListTitle.textContent = 'Ошибка загрузки данных';
            return null;
        }
    }
    
    /**
     * Обновление данных в реальном времени (опционально)
     */
    async function refreshData() {
        if (updateInProgress) {
            console.log('Обновление уже выполняется');
            return;
        }
        
        updateInProgress = true;
        console.log('Ручное обновление данных...');
        
        try {
            const users = await window.ProfileData.fetchAllUsers();
            if (users && users.length > 0) {
                users.sort((a, b) => {
                    const priorityA = getSortPriority(a);
                    const priorityB = getSortPriority(b);
                    if (priorityA !== priorityB) return priorityA - priorityB;
                    return a.hwid.localeCompare(b.hwid);
                });
                draftUsers = users;
                displayUsers(draftUsers);
                console.log('Данные обновлены');
            }
        } catch (error) {
            console.error('Ошибка обновления:', error);
        } finally {
            updateInProgress = false;
        }
    }
    
    /**
     * Инициализация
     */
    async function init() {
        // Ждем загрузки ProfileData модуля
        if (!window.ProfileData) {
            console.log('Users: Ожидание загрузки ProfileData...');
            const checkInterval = setInterval(() => {
                if (window.ProfileData) {
                    clearInterval(checkInterval);
                    init();
                }
            }, 100);
            return;
        }
        
        console.log('Users: ProfileData загружен, инициализация...');
        await loadDraftData();
        
        // Добавляем кнопку обновления, если она существует
        const refreshBtn = document.getElementById('refreshDataBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', refreshData);
        }
    }
    
    // Запускаем инициализацию
    init();
});