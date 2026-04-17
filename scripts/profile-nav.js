// profile-nav.js - мини-профиль аккаунта в меню пользователя (Версия 4.3 - добавлена статистика убийств)

function openCenteredPopup() {
  var url = 'https://docs.google.com/spreadsheets/d/1hYhAb_3EVcHmj7c8cgAjXMoF6HCqqjUeb9SSKXHs8TA/edit?gid=834339051#gid=834339051';
  
  // Используем screen.width и screen.height для полного экрана
  var width = screen.width;
  var height = screen.height;
  
  var left = 0;
  var top = 0;
  
  var popup = window.open(url, 'popup', 'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',toolbar=yes,scrollbars=yes,resizable=yes');
  
  // Дополнительно пытаемся перевести в полноэкранный режим
  if (popup) {
    popup.moveTo(0, 0);
    popup.resizeTo(screen.width, screen.height);
  }
}

// Форматирование числа убийств
function formatKills(kills) {
    if (!kills || kills === 0) return '0';
    if (kills >= 1000000) return (kills / 1000000).toFixed(1) + 'm';
    if (kills >= 1000) return (kills / 1000).toFixed(1) + 'k';
    return kills.toString();
}

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
        
        const avatarImg = btnLogout.querySelector('.avatar-account .avatar');
        if (avatarImg && userInfo.discordId && userInfo.avatarHash) {
            const cachedAvatar = window.ProfileData.getCachedAvatarUrl(userInfo.discordId);
            if (cachedAvatar) {
                avatarImg.src = cachedAvatar;
                avatarImg.style.visibility = 'visible';
            }
        }
    }

    // Загрузка убийств для мини-профиля
    async function loadKillsForNavProfile(hwid, killsElement) {
        if (!hwid || !killsElement) return;
        
        try {
            const kills = await window.ProfileData.fetchKillsByHwid(hwid);
            killsElement.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="10" height="10">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/>
                </svg>
                <span>${formatKills(kills)}</span>
            `;
        } catch (error) {
            console.warn('Ошибка загрузки убийств для мини-профиля:', error);
            killsElement.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="10" height="10">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/>
                </svg>
                <span>0</span>
            `;
        }
    }

    // Рендер профиля из данных (синхронный, без задержек)
    function renderProfileFromData(userInfo, profileSection, btnLogout = null) {
        if (!profileSection) return;
        const contextMenu = document.querySelector('.context-menu');
        let profileSectionbtn = contextMenu.querySelector('.button-ctn');
        let profileSectionbtnrow = profileSectionbtn.querySelector('.menu-row');
        
        const displayName = window.ProfileData.getDisplayName(userInfo);
        const shortHwid = window.ProfileData.getShortHwid(userInfo.hwid, 16);
        const avatarLetter = window.ProfileData.getAvatarLetter(displayName);
        
        const subscription = window.ProfileData.getSubscriptionStatus(userInfo);
        
        let statusClass = subscription.status;
        let statusText = subscription.text;
        
        if (subscription.status === 'active' && subscription.formattedTime) {
            statusText = subscription.formattedTime;
        } else if (userInfo.isForever) {
            statusText = 'Навсегда';
            statusClass = 'forever';
        } else if (userInfo.isBanned) {
            statusText = `Заблокирована`;
            statusClass = 'banned';
        } else if (userInfo.isExpired) {
            statusText = 'Истекла';
            statusClass = 'expired';
        } else if (userInfo.noLicense) {
            statusText = 'Нет лицензии';
            statusClass = 'nolicense';
        }
        
        // Блок с причиной бана (как в profile-modal)
        let banReasonHtml = '';
        if (userInfo.isBanned) {
            if (userInfo.banReason && userInfo.banReason.trim() !== '') {
                banReasonHtml = `
                    <div class="profile-ban-reason2">
                        <div class="label">Причина бана:</div>
                        <div class="reason">${window.ProfileData.escapeHtml(userInfo.banReason)}</div>
                    </div>
                `;
            } else {
                banReasonHtml = `
                    <div class="profile-ban-reason2">
                        <div class="label">Причина бана:</div>
                        <div class="reason">Не указана администратором!</div>
                    </div>
                `;
            }
        }
        
        // Создаем элемент для убийств
        const killsHtml = `
            <div class="profile-nav-kills" id="navProfileKills">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="10" height="10">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/>
                </svg>
                <span>...</span>
            </div>
        `;
        
        profileSectionbtnrow.innerHTML = `
            <div class="context-menu-item profile-item" onclick="openFullProfile(event)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <use href="./content/svg/ico-user.svg"></use>
                </svg>
                <span>Профиль</span>
            </div>
            <div class="context-menu-item profile-item" onclick="openCenteredPopup()">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <use href="./content/svg/ico-app.svg"></use>
                </svg>
                <span>Менеджер</span>
            </div>
        `;
        
        profileSection.innerHTML = `
            <div class="profile-nav-header" onclick="openFullProfile(event)" style="cursor: pointer;">
                <div class="profile-nav-avatar">
                    <img id="navProfileAvatar" src="" alt="" style="opacity: 0;">
                    <div class="profile-nav-avatar-letter">${window.ProfileData.escapeHtml(avatarLetter)}</div>
                </div>
                <div class="profile-nav-info">
                    <div class="profile-nav-name">${window.ProfileData.escapeHtml(displayName)}</div>
                    <div class="profile-nav-hwid" title="${window.ProfileData.escapeHtml(userInfo.hwid || '')}">HWID: ${window.ProfileData.escapeHtml(shortHwid)}</div>
                </div>
                ${killsHtml}
            </div>
            <div class="profile-nav-status">
                <div>
                    Роль:
                    <span class="profile-nav-role ${userInfo.roleClass}">
                        ${window.ProfileData.escapeHtml(userInfo.roleText)}
                    </span>
                </div>
                <div>
                    Подписка:
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
            ${userInfo.isBanned && banReasonHtml ? banReasonHtml : ''}
        `;
        
        if (btnLogout) {
            updateBtnLogoutFromCache(userInfo, btnLogout);
        }
        
        // Загружаем убийства асинхронно
        const killsElement = document.getElementById('navProfileKills');
        if (killsElement && userInfo.hwid) {
            loadKillsForNavProfile(userInfo.hwid, killsElement);
        }
        
        if (userInfo.discordId && userInfo.avatarHash) {
            const navProfileAvatar = profileSection.querySelector('#navProfileAvatar');
            if (navProfileAvatar) {
                const cachedAvatar = window.ProfileData.getCachedAvatarUrl(userInfo.discordId);
                if (cachedAvatar) {
                    navProfileAvatar.src = cachedAvatar;
                    navProfileAvatar.style.opacity = '1';
                    const letterDiv = profileSection.querySelector('.profile-nav-avatar-letter');
                    if (letterDiv) letterDiv.style.opacity = '0';
                } else {
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

    async function backgroundUpdate(discordId, profileSection, btnLogout) {
        try {
            const freshUserInfo = await window.ProfileData.fetchUserByDiscordId(String(discordId));
            
            if (freshUserInfo) {
                window.currentUserHwid = freshUserInfo.hwid;
                renderProfileFromData(freshUserInfo, profileSection, btnLogout);
            }
        } catch (error) {
            console.warn('ProfileNav: Фоновое обновление не удалось:', error);
        }
    }

    function preloadProfileFromCache() {
        const btnLogout = document.querySelector('.btn_logout');
        if (!btnLogout) return;
        
        const discordUser = CookieManager ? CookieManager.get('discord_user') : null;
        if (!discordUser || !discordUser.id) return;
        
        const cachedUser = getUserFromCacheSync(String(discordUser.id));
        if (cachedUser) {
            updateBtnLogoutFromCache(cachedUser, btnLogout);
            window.currentUserHwid = cachedUser.hwid;
            console.log('ProfileNav: btn_logout обновлён из кеша при загрузке');
            
            setTimeout(() => {
                window.ProfileData.fetchUserByDiscordId(String(discordUser.id)).catch(() => {});
            }, 500);
        }
    }

    async function updateNavProfile() {
        const btnLogout = document.querySelector('.btn_logout');
        const contextMenu = document.querySelector('.context-menu');
        
        if (!btnLogout || !contextMenu) return;
        
        const discordUser = CookieManager ? CookieManager.get('discord_user') : null;
        if (!discordUser || !discordUser.id) {
            console.log('ProfileNav: Нет данных пользователя');
            return;
        }
        
        let profileSection = contextMenu.querySelector('.context-menu-hwid');
        if (!profileSection) {
            profileSection = document.createElement('div');
            profileSection.className = 'context-menu-hwid';
            contextMenu.insertBefore(profileSection, contextMenu.firstChild);
        }
        
        const cachedUser = getUserFromCacheSync(String(discordUser.id));
        
        if (cachedUser) {
            window.currentUserHwid = cachedUser.hwid;
            renderProfileFromData(cachedUser, profileSection, btnLogout);
            console.log('ProfileNav: Отображено из кеша мгновенно');
            backgroundUpdate(discordUser.id, profileSection, btnLogout);
        } else {
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
                        <div>Ошибка загрузки</div>
                    </div>
                `;
            }
        }
    }

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

    function observeBtnLogout() {
        const observer = new MutationObserver(() => {
            const btnLogout = document.querySelector('.btn_logout');
            if (btnLogout && window.ProfileData) {
                preloadProfileFromCache();
                observer.disconnect();
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 10000);
    }

    async function initNavProfile() {
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