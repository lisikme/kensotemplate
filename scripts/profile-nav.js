// profile-nav.js - мини-профиль аккаунта в меню пользователя (Версия 4.1 - мгновенное обновление всех элементов)

(function() {
    // Функция закрытия меню
    function closeContextMenu() {
        const contextMenu = document.querySelector('.context-menu');
        const overlay = document.querySelector('.context-menu-overlay');
        if (contextMenu) contextMenu.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    }

    // Мгновенное получение пользователя из кеша (синхронно)
    function getUserFromCacheSync(discordId) {
        if (!window.ProfileData || !discordId) return null;
        
        // Пытаемся получить из кеша localStorage
        try {
            const cached = localStorage.getItem('users_list_cache_v5');
            if (cached) {
                const cache = JSON.parse(cached);
                if (cache.users && Array.isArray(cache.users)) {
                    const user = cache.users.find(u => u.discordId === discordId);
                    if (user) return user;
                }
            }
        } catch (e) {
            console.warn('Ошибка чтения кеша:', e);
        }
        
        return null;
    }

    // Мгновенное обновление btn_logout (синхронно из кеша)
    function updateBtnLogoutFromCache(userInfo, btnLogout) {
        if (!btnLogout || !userInfo) return;
        
        const displayName = window.ProfileData.getDisplayName(userInfo);
        const navTitle = btnLogout.querySelector('.nav-bt-title');
        const navRole = btnLogout.querySelector('.nav-bt-title-hwid');
        
        if (navTitle) {
            navTitle.textContent = displayName;
        }
        
        if (navRole) {
            navRole.textContent = userInfo.roleText;
            navRole.className = `nav-bt-title-hwid role-${userInfo.roleClass}`;
        }
        
        // Обновляем аватар в btn_logout если есть в кеше
        const avatarImg = btnLogout.querySelector('.avatar-account .avatar');
        if (avatarImg && userInfo.discordId && userInfo.avatarHash) {
            const cachedAvatar = window.ProfileData.getCachedAvatarUrl(userInfo.discordId);
            if (cachedAvatar) {
                avatarImg.src = cachedAvatar;
                avatarImg.style.visibility = 'visible';
            }
        }
    }

    // Рендер профиля из данных (синхронный, без задержек)
    function renderProfileFromData(userInfo, profileSection, btnLogout = null) {
        if (!profileSection) return;
        
        const displayName = window.ProfileData.getDisplayName(userInfo);
        const shortHwid = window.ProfileData.getShortHwid(userInfo.hwid, 16);
        const avatarLetter = window.ProfileData.getAvatarLetter(displayName);
        
        const subscription = window.ProfileData.getSubscriptionStatus(userInfo);
        
        // Определяем класс и текст для статуса
        let statusClass = subscription.status;
        let statusText = subscription.text;
        
        if (subscription.status === 'active' && subscription.formattedTime) {
            statusText = subscription.formattedTime;
        } else if (userInfo.isForever) {
            statusText = 'Навсегда';
            statusClass = 'forever';
        } else if (userInfo.isBanned) {
            statusText = 'Забанен';
            statusClass = 'banned';
        } else if (userInfo.isExpired) {
            statusText = 'Истекла';
            statusClass = 'expired';
        } else if (userInfo.noLicense) {
            statusText = 'Нет лицензии';
            statusClass = 'nolicense';
        }
        
        // Рендерим макет профиля
        profileSection.innerHTML = `
            <div class="profile-nav-header">
                <div class="profile-nav-avatar">
                    <img id="navProfileAvatar" src="" alt="" style="opacity: 0;">
                    <div class="profile-nav-avatar-letter">${window.ProfileData.escapeHtml(avatarLetter)}</div>
                </div>
                <div class="profile-nav-info">
                    <div class="profile-nav-name">${window.ProfileData.escapeHtml(displayName)}</div>
                    <div class="profile-nav-hwid" title="${window.ProfileData.escapeHtml(userInfo.hwid || '')}">HWID: ${window.ProfileData.escapeHtml(shortHwid)}</div>
                </div>
            </div>
            <div class="profile-nav-status">
                <div>
                    Роль:
                    <span class="profile-nav-role ${userInfo.roleClass}">
                        ${window.ProfileData.escapeHtml(userInfo.roleText)}
                    </span>
                </div>
                <div>
                    Статус подписки:
                    <span class="profile-nav-badge ${statusClass}">
                        ${window.ProfileData.escapeHtml(statusText)}
                    </span>
                </div>
            </div>
            ${subscription.status === 'active' && subscription.daysLeft > 0 && subscription.daysLeft <= 30 ? `
            <div class="profile-nav-progress">
                <div class="profile-nav-progress-bar">
                    <div class="profile-nav-progress-fill" style="width: ${Math.min(100, (subscription.daysLeft / 30) * 100)}%;"></div>
                </div>
                <div class="profile-nav-progress-text">Осталось ${subscription.daysLeft} ${window.ProfileData.getDaysWord(subscription.daysLeft)}</div>
            </div>
            ` : ''}
            ${userInfo.isBanned && userInfo.banReason ? `
            <div class="profile-nav-ban-info">
                <span style='font-weight: 500; font-size: 9px; color: #ff5d5d'>Причина:</span><br>
                ${window.ProfileData.escapeHtml(userInfo.banReason.length > 60 ? userInfo.banReason.substring(0, 60) + '...' : userInfo.banReason)}
            </div>
            ` : ''}
        `;
        
        // Мгновенно обновляем btn_logout
        if (btnLogout) {
            updateBtnLogoutFromCache(userInfo, btnLogout);
        }
        
        // Загружаем аватар асинхронно (не блокируем отображение)
        if (userInfo.discordId && userInfo.avatarHash) {
            const navProfileAvatar = profileSection.querySelector('#navProfileAvatar');
            if (navProfileAvatar) {
                // Проверяем кеш аватара
                const cachedAvatar = window.ProfileData.getCachedAvatarUrl(userInfo.discordId);
                if (cachedAvatar) {
                    navProfileAvatar.src = cachedAvatar;
                    navProfileAvatar.style.opacity = '1';
                    const letterDiv = profileSection.querySelector('.profile-nav-avatar-letter');
                    if (letterDiv) letterDiv.style.opacity = '0';
                } else {
                    // Асинхронная загрузка
                    window.ProfileData.getDiscordAvatarUrl(userInfo.discordId, userInfo.avatarHash).then(avatarUrl => {
                        if (avatarUrl && navProfileAvatar) {
                            navProfileAvatar.src = avatarUrl;
                            navProfileAvatar.style.opacity = '1';
                            const letterDiv = profileSection.querySelector('.profile-nav-avatar-letter');
                            if (letterDiv) letterDiv.style.opacity = '0';
                        }
                    }).catch(e => console.warn('Ошибка загрузки аватара:', e));
                }
            }
            
            // Также обновляем аватар в btn_logout
            if (btnLogout) {
                const avatarImg = btnLogout.querySelector('.avatar-account .avatar');
                if (avatarImg) {
                    const cachedAvatar = window.ProfileData.getCachedAvatarUrl(userInfo.discordId);
                    if (cachedAvatar) {
                        avatarImg.src = cachedAvatar;
                        avatarImg.style.visibility = 'visible';
                    } else {
                        window.ProfileData.getDiscordAvatarUrl(userInfo.discordId, userInfo.avatarHash).then(avatarUrl => {
                            if (avatarUrl && avatarImg) {
                                avatarImg.src = avatarUrl;
                                avatarImg.style.visibility = 'visible';
                            }
                        }).catch(() => {
                            if (avatarImg) avatarImg.style.visibility = 'hidden';
                        });
                    }
                }
            }
        }
    }

    // Фоновая проверка и обновление данных из API (без блокировки интерфейса)
    async function backgroundUpdate(discordId, profileSection, btnLogout) {
        try {
            // Запрашиваем свежие данные из API (через ProfileData, который обновляет кеш)
            const freshUserInfo = await window.ProfileData.fetchUserByDiscordId(String(discordId));
            
            if (freshUserInfo) {
                // Сохраняем HWID глобально
                window.currentUserHwid = freshUserInfo.hwid;
                
                // Обновляем отображение с новыми данными
                renderProfileFromData(freshUserInfo, profileSection, btnLogout);
            }
        } catch (error) {
            console.warn('ProfileNav: Фоновое обновление не удалось:', error);
        }
    }

    // Предварительная загрузка профиля в btn_logout при загрузке страницы (из кеша)
    function preloadProfileFromCache() {
        const btnLogout = document.querySelector('.btn_logout');
        if (!btnLogout) return;
        
        const discordUser = CookieManager ? CookieManager.get('discord_user') : null;
        if (!discordUser || !discordUser.id) return;
        
        const cachedUser = getUserFromCacheSync(String(discordUser.id));
        if (cachedUser) {
            // Мгновенно обновляем btn_logout при загрузке страницы
            updateBtnLogoutFromCache(cachedUser, btnLogout);
            window.currentUserHwid = cachedUser.hwid;
            console.log('ProfileNav: btn_logout обновлён из кеша при загрузке');
            
            // Фоновое обновление
            setTimeout(() => {
                window.ProfileData.fetchUserByDiscordId(String(discordUser.id)).catch(() => {});
            }, 500);
        }
    }

    // Обновление мини-профиля в меню (мгновенно из кеша + фоном из API)
    async function updateNavProfile() {
        const btnLogout = document.querySelector('.btn_logout');
        const contextMenu = document.querySelector('.context-menu');
        
        if (!btnLogout || !contextMenu) return;
        
        // Получаем данные пользователя из Cookie
        const discordUser = CookieManager ? CookieManager.get('discord_user') : null;
        if (!discordUser || !discordUser.id) {
            console.log('ProfileNav: Нет данных пользователя');
            return;
        }
        
        // Находим или создаём секцию профиля
        let profileSection = contextMenu.querySelector('.context-menu-hwid');
        if (!profileSection) {
            profileSection = document.createElement('div');
            profileSection.className = 'context-menu-hwid';
            contextMenu.insertBefore(profileSection, contextMenu.firstChild);
        }
        
        // ========== ШАГ 1: МГНОВЕННОЕ ОТОБРАЖЕНИЕ ИЗ КЕША ==========
        const cachedUser = getUserFromCacheSync(String(discordUser.id));
        
        if (cachedUser) {
            // Мгновенно показываем данные из кеша
            window.currentUserHwid = cachedUser.hwid;
            renderProfileFromData(cachedUser, profileSection, btnLogout);
            console.log('ProfileNav: Отображено из кеша мгновенно');
            
            // Запускаем фоновое обновление (без ожидания)
            backgroundUpdate(discordUser.id, profileSection, btnLogout);
        } else {
            // Если кеша нет - показываем загрузку и грузим из API
            profileSection.innerHTML = `
                <div class="profile-nav-loading">
                    <div class="profile-nav-spinner"></div>
                    <div>Загрузка профиля...</div>
                </div>
            `;
            
            try {
                const userInfo = await window.ProfileData.fetchUserByDiscordId(String(discordUser.id));
                
                if (userInfo) {
                    window.currentUserHwid = userInfo.hwid;
                    renderProfileFromData(userInfo, profileSection, btnLogout);
                } else {
                    profileSection.innerHTML = `
                        <div class="profile-nav-error">
                            <div>Пользователь не найден</div>
                            <div style="font-size: 10px; margin-top: 4px; opacity: 0.7;">
                                Ваш аккаунт не привязан к HWID
                            </div>
                        </div>
                    `;
                }
            } catch (error) {
                console.error('ProfileNav: Ошибка загрузки:', error);
                profileSection.innerHTML = `
                    <div class="profile-nav-error">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none"/>
                        </svg>
                        <div>Ошибка загрузки</div>
                    </div>
                `;
            }
        }
    }

    // Открытие профиля текущего пользователя
    window.openFullProfile = function(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        closeContextMenu();
        
        const hwid = window.currentUserHwid;
        
        if (!hwid) {
            console.error('ProfileNav: HWID не найден');
            return;
        }
        
        if (window.ProfileModal && window.ProfileModal.openByHwid) {
            window.ProfileModal.openByHwid(hwid);
        } else {
            console.error('ProfileNav: ProfileModal не загружен');
        }
    };

    // Добавляем стили для загрузки и ошибки
    function injectStyles() {
        if (document.getElementById('profile-nav-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'profile-nav-styles';
        style.textContent = `
            .profile-nav-loading {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 15px;
                text-align: center;
                color: #888;
                gap: 8px;
            }
            .profile-nav-spinner {
                width: 24px;
                height: 24px;
                border: 2px solid #2a2a2a;
                border-top-color: #ff6b6b;
                border-radius: 50%;
                animation: profileNavSpin 0.8s linear infinite;
            }
            @keyframes profileNavSpin {
                to { transform: rotate(360deg); }
            }
            .profile-nav-error {
                padding: 12px;
                text-align: center;
                color: #ff5d5d;
                font-size: 12px;
            }
            .profile-nav-error svg {
                width: 24px;
                height: 24px;
                margin-bottom: 6px;
            }
        `;
        document.head.appendChild(style);
    }

    // Обновление при открытии меню
    function setupMenuOpenHandler() {
        const originalToggle = window.toggleContextMenu;
        
        window.toggleContextMenu = function(event) {
            if (originalToggle) originalToggle(event);
            
            const contextMenu = document.querySelector('.context-menu');
            if (contextMenu && contextMenu.classList.contains('active')) {
                updateNavProfile();
            }
        };
    }

    // Наблюдатель за изменениями DOM для btn_logout (на случай если он появляется позже)
    function observeBtnLogout() {
        const observer = new MutationObserver(() => {
            const btnLogout = document.querySelector('.btn_logout');
            if (btnLogout && window.ProfileData) {
                preloadProfileFromCache();
                observer.disconnect();
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Таймаут на всякий случай
        setTimeout(() => observer.disconnect(), 10000);
    }

    // Инициализация
    async function initNavProfile() {
        injectStyles();
        
        if (!window.ProfileData) {
            console.log('ProfileNav: Ожидание загрузки ProfileData...');
            const checkInterval = setInterval(() => {
                if (window.ProfileData) {
                    clearInterval(checkInterval);
                    initNavProfile();
                }
            }, 100);
            return;
        }
        
        window.currentUserHwid = null;
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                // Предварительная загрузка btn_logout из кеша
                setTimeout(() => {
                    preloadProfileFromCache();
                }, 100);
                setupMenuOpenHandler();
                observeBtnLogout();
            });
        } else {
            setTimeout(() => {
                preloadProfileFromCache();
            }, 100);
            setupMenuOpenHandler();
            observeBtnLogout();
        }
        
        window.addEventListener('storage', function(e) {
            if (e.key === 'discord_user') {
                updateNavProfile();
                preloadProfileFromCache();
            }
        });
    }
    
    initNavProfile();
})();