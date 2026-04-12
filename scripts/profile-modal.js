// profile-modal.js - модальное окно профиля (Версия 3.0 - данные из таблицы)

(function() {
    // Текущие параметры URL
    let currentParams = {
        'profile-hwid': null,
        'search-discord': null,
        'search-telegram': null
    };
    
    // Состояние модального окна
    let isModalOpen = false;
    let currentProfileData = null;
    
    // DOM элементы
    let modalOverlay = null;
    
    // Функции для работы с параметрами URL
    function updateURLParams(params) {
        const url = new URL(window.location.href);
        
        Object.keys(params).forEach(key => {
            const value = params[key];
            if (value && value !== 'null' && value !== 'undefined' && value !== '') {
                url.searchParams.set(key, value);
            } else {
                url.searchParams.delete(key);
            }
        });
        
        window.history.pushState({}, '', url.toString());
    }
    
    function getURLParams() {
        const url = new URL(window.location.href);
        return {
            'profile-hwid': url.searchParams.get('profile-hwid'),
            'search-discord': url.searchParams.get('search-discord'),
            'search-telegram': url.searchParams.get('search-telegram')
        };
    }
    
    function clearAllProfileParams() {
        const url = new URL(window.location.href);
        url.searchParams.delete('profile-hwid');
        url.searchParams.delete('search-discord');
        url.searchParams.delete('search-telegram');
        window.history.pushState({}, '', url.toString());
    }
    
    // Обработчик popstate
    window.addEventListener('popstate', function() {
        const params = getURLParams();
        
        if (params['profile-hwid']) {
            openProfileModalByHwid(params['profile-hwid']);
        } else if (params['search-discord']) {
            searchAndOpenProfileByDiscord(params['search-discord']);
        } else if (params['search-telegram']) {
            searchAndOpenProfileByTelegram(params['search-telegram']);
        } else if (isModalOpen) {
            closeProfileModal();
        }
    });
    
    // Загрузка аватара Discord
    async function loadDiscordAvatarToElement(discordId, avatarHash, imgElement) {
        if (!discordId || !avatarHash || !imgElement) return;
        
        const avatarUrl = await window.ProfileData.getDiscordAvatarUrl(discordId, avatarHash);
        if (avatarUrl) {
            imgElement.src = avatarUrl;
            imgElement.style.opacity = '1';
            const letterDiv = imgElement.parentElement?.querySelector('.profile-avatar-letter');
            if (letterDiv) letterDiv.style.opacity = '0';
        }
    }
    
    // Рендер модального окна
    async function renderProfileModal(userData) {
        if (!modalOverlay) return;
        
        const subscription = window.ProfileData.getSubscriptionStatus(userData);
        const isBanned = userData.isBanned;
        
        // Используем имя из таблицы (Tab9)
        const displayName = window.ProfileData.getDisplayName(userData);
        const avatarLetter = window.ProfileData.getAvatarLetter(displayName);
        const shortHwid = window.ProfileData.getShortHwid(userData.hwid, 16);
        
        // Определяем текст статуса
        let statusText = '';
        let statusText2 = '';
        let statusClass = subscription.status;
        
        if (userData.isBanned) {
            statusText = 'Заблокирован';
            statusText2 = 'Заблокирован';
            statusClass = 'banned';
        } else if (userData.isForever) {
            statusText = 'Активна - Навсегда';
            statusText2 = 'Навсегда';
            statusClass = 'forever';
        } else if (userData.isActiveLicense) {
            if (subscription.formattedTime) {
                const endDateFormatted = subscription.endTimestamp ? new Date(subscription.endTimestamp * 1000).toLocaleDateString('ru-RU') : 'неизвестно';
                statusText = `Активна - ${subscription.formattedTime}`;
                statusText2 = `До ${endDateFormatted}`;
            } else {
                statusText = 'Активна';
                statusText2 = 'Активна';
            }
            statusClass = 'active';
        } else if (userData.isExpired) {
            statusText = 'Истекла';
            statusText2 = 'Истекла';
            statusClass = 'expired';
        } else {
            statusText = 'Нет лицензии';
            statusText2 = 'Нет лицензии';
            statusClass = 'nolicense';
        }
        
        modalOverlay.innerHTML = `
            <div class="profile-modal-container">
                <div class="profile-modal-header">
                    <div class="profile-modal-title">
                        Профиль пользователя
                    </div>
                    <button class="profile-modal-close" id="profileModalClose">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="profile-modal-content">
                    <div class="admin_card" id="item-${userData.roleClass === 'other' ? 'player' : userData.roleClass}">
                        <div class="admin_term">
                            <div class="adminlist_button steam_button" id="tag-${userData.roleClass}">
                                <span>${window.ProfileData.escapeHtml(userData.roleText)}</span>
                            </div>
                            <span class="admin_term_text" id="term-${statusClass}">${window.ProfileData.escapeHtml(statusText2)}</span>
                        </div>
                        <div id="admins_card">
                            <div class="adminlist_info">
                                <a>
                                    <div class="avatar_block">
                                        <div class="avatar_letter" style="opacity: 1;">${window.ProfileData.escapeHtml(avatarLetter)}</div>
                                        <div class="avatar-img">
                                            <img id="profileAvatarImg" src="" alt="" style="opacity: 0;">
                                        </div>
                                    </div>
                                    <get-avatar></get-avatar>
                                </a>
                                <div class="adminlist_buttons">
                                    <div id="admins_info">
                                        <span class="admin_nickname">${window.ProfileData.escapeHtml(shortHwid)}</span>
                                        <div id="link_block">
                                            ${userData.discordId ? `
                                                <a href="https://discord.com/users/${userData.discordId}" target="_blank" id="link_prof" class="discord-link DS" data-discord-id="${userData.discordId}">
                                                    <svg viewBox="0 0 48 48" fill="none">
                                                        <use href="./content/svg/link-discord.svg"></use>
                                                    </svg>
                                                    <span class="discord-username">${window.ProfileData.escapeHtml(displayName)}</span>
                                                </a>
                                            ` : ''}
                                            ${userData.telegramId ? `
                                                <a target="_blank" id="link_prof" class="discord-link telegram-link TG">
                                                    <svg viewBox="0 0 48 48" fill="none">
                                                        <use href="./content/svg/link-telegram.svg"></use>
                                                    </svg>
                                                    <span class="discord-username">ID: ${window.ProfileData.escapeHtml(userData.telegramId)}</span>
                                                </a>
                                            ` : ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    
                    <!-- Статус и роль -->
                    <div class="profile-section">
                        <div class="profile-section-header">Информация</div>
                        <div class="profile-section-content">
                            <div class="profile-info-row">
                                <span class="profile-info-label">Подписка:</span>
                                <span class="profile-info-value">
                                    <span class="profile-status-badge ${statusClass}">${window.ProfileData.escapeHtml(statusText)}</span>
                                </span>
                            </div>
                            <div class="profile-info-row">
                                <span class="profile-info-label">Роль:</span>
                                <span class="profile-info-value">
                                    <div class="adminlist_button steam_button" id="tag-${userData.roleClass}">
                                        <span>${window.ProfileData.escapeHtml(userData.roleText)}</span>
                                    </div>
                                </span>
                            </div>
                            ${isBanned && userData.banReason ? `
                                <div class="profile-ban-reason">
                                <div class="label">Причина бана:</div>
                                <div class="reason">${window.ProfileData.escapeHtml(userData.banReason)}</div>
                                </div>
                            ` : ''}
                            <div class="profile-info-row">
                                <span class="profile-info-label">Discord:</span>
                                ${userData.discordId ? `
                                    <a href="https://discord.com/users/${userData.discordId}" target="_blank" id="link_prof" class="discord-link DS" data-discord-id="${userData.discordId}">
                                        <svg viewBox="0 0 48 48" fill="none">
                                            <use href="./content/svg/link-discord.svg"></use>
                                        </svg>
                                        <span class="discord-username">ID: ${userData.discordId}</span>
                                    </a>
                                ` : `
                                    <a id="link_prof" class="discord-link DS">
                                        <svg viewBox="0 0 48 48" fill="none">
                                            <use href="./content/svg/link-discord.svg"></use>
                                        </svg>
                                        <span class="discord-username">НЕТ</span>
                                    </a>
                                `}
                            </div>
                            <div class="profile-info-row">
                                <span class="profile-info-label">Telegram:</span>
                                ${userData.telegramId ? `
                                    <a id="link_prof" class="discord-link telegram-link TG">
                                        <svg viewBox="0 0 48 48" fill="none">
                                            <use href="./content/svg/link-telegram.svg"></use>
                                        </svg>
                                        <span class="discord-username">ID: ${window.ProfileData.escapeHtml(userData.telegramId)}</span>
                                    </a>
                                ` : `
                                    <a id="link_prof" class="discord-link telegram-link TG">
                                        <svg viewBox="0 0 48 48" fill="none">
                                            <use href="./content/svg/link-telegram.svg"></use>
                                        </svg>
                                        <span class="discord-username">НЕТ</span>
                                    </a>
                                `}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Добавляем обработчики
        const closeBtn = document.getElementById('profileModalClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeProfileModal);
        }
        
        // Загружаем аватар (используем avatarHash из таблицы Tab10)
        if (userData.discordId && userData.avatarHash) {
            const avatarImg = document.getElementById('profileAvatarImg');
            if (avatarImg) {
                await loadDiscordAvatarToElement(userData.discordId, userData.avatarHash, avatarImg);
            }
        }
        
        modalOverlay.classList.add('active');
        isModalOpen = true;
        document.body.style.overflow = 'hidden';
    }
    
    function showProfileLoader() {
        if (!modalOverlay) return;
        modalOverlay.innerHTML = `
            <div class="profile-modal-container">
                <div class="profile-modal-header">
                    <div class="profile-modal-title">

                        Профиль пользователя
                    </div>
                    <button class="profile-modal-close" id="profileModalCloseLoader">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="profile-modal-content">
                    <div class="profile-loader">
                        <div class="profile-spinner"></div>
                        <p>Загрузка данных...</p>
                    </div>
                </div>
            </div>
        `;
        const closeBtn = document.getElementById('profileModalCloseLoader');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeProfileModal);
        }
        modalOverlay.classList.add('active');
        isModalOpen = true;
        document.body.style.overflow = 'hidden';
    }
    
    function showProfileError(message) {
        if (!modalOverlay) return;
        modalOverlay.innerHTML = `
            <div class="profile-modal-container">
                <div class="profile-modal-header">
                    <div class="profile-modal-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                        </svg>
                        Ошибка
                    </div>
                    <button class="profile-modal-close" id="profileModalCloseError">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="profile-modal-content">
                    <div class="profile-error">
                        <p>${window.ProfileData.escapeHtml(message)}</p>
                    </div>
                </div>
            </div>
        `;
        const closeBtn = document.getElementById('profileModalCloseError');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeProfileModal);
        }
        modalOverlay.classList.add('active');
        isModalOpen = true;
        document.body.style.overflow = 'hidden';
    }
    
    // Основные функции открытия профиля
    async function openProfileModalByHwid(hwid) {
        if (!hwid) return;
        
        showProfileLoader();
        
        try {
            const userData = await window.ProfileData.fetchUserByHwid(hwid);
            if (!userData) {
                showProfileError('Пользователь с таким HWID не найден');
                return;
            }
            
            currentProfileData = userData;
            await renderProfileModal(userData);
        } catch (error) {
            console.error('Ошибка открытия профиля:', error);
            showProfileError('Ошибка загрузки данных профиля');
        }
    }
    
    async function searchAndOpenProfileByDiscord(discordId) {
        if (!discordId) return;
        
        showProfileLoader();
        
        try {
            const userData = await window.ProfileData.fetchUserByDiscordId(discordId);
            if (!userData) {
                showProfileError('Пользователь с таким Discord ID не найден');
                return;
            }
            
            updateURLParams({ 'profile-hwid': userData.hwid, 'search-discord': null });
            
            currentProfileData = userData;
            await renderProfileModal(userData);
        } catch (error) {
            console.error('Ошибка поиска по Discord:', error);
            showProfileError('Ошибка поиска пользователя');
        }
    }
    
    async function searchAndOpenProfileByTelegram(telegramId) {
        if (!telegramId) return;
        
        showProfileLoader();
        
        try {
            const userData = await window.ProfileData.fetchUserByTelegramId(telegramId);
            if (!userData) {
                showProfileError('Пользователь с таким Telegram ID не найден');
                return;
            }
            
            updateURLParams({ 'profile-hwid': userData.hwid, 'search-telegram': null });
            
            currentProfileData = userData;
            await renderProfileModal(userData);
        } catch (error) {
            console.error('Ошибка поиска по Telegram:', error);
            showProfileError('Ошибка поиска пользователя');
        }
    }
    
    function closeProfileModal() {
        if (modalOverlay) {
            modalOverlay.classList.remove('active');
        }
        isModalOpen = false;
        document.body.style.overflow = '';
        currentProfileData = null;
        
        clearAllProfileParams();
    }
    
    // Инициализация модального окна
    function initProfileModal() {
        // Создаем DOM элемент
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'profileModalOverlay';
        modalOverlay.className = 'profile-modal-overlay';
        document.body.appendChild(modalOverlay);
        
        // Закрытие по клику на оверлей
        modalOverlay.addEventListener('click', function(e) {
            if (e.target === modalOverlay) {
                closeProfileModal();
            }
        });
        
        // Закрытие по Escape
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && isModalOpen) {
                closeProfileModal();
            }
        });
        
        // Проверяем параметры URL при загрузке
        const params = getURLParams();
        if (params['profile-hwid']) {
            openProfileModalByHwid(params['profile-hwid']);
        } else if (params['search-discord']) {
            searchAndOpenProfileByDiscord(params['search-discord']);
        } else if (params['search-telegram']) {
            searchAndOpenProfileByTelegram(params['search-telegram']);
        }
    }
    
    // Экспортируем функции глобально
    window.ProfileModal = {
        openByHwid: openProfileModalByHwid,
        searchByDiscord: searchAndOpenProfileByDiscord,
        searchByTelegram: searchAndOpenProfileByTelegram,
        close: closeProfileModal
    };
    
    // Ждем загрузки ProfileData модуля
    function waitForProfileData() {
        if (window.ProfileData) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initProfileModal);
            } else {
                initProfileModal();
            }
        } else {
            console.log('ProfileModal: Ожидание загрузки ProfileData...');
            setTimeout(waitForProfileData, 100);
        }
    }
    
    waitForProfileData();
})();