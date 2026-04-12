// profile-nav.js - мини-профиль аккаунта в меню пользователя (Версия 3.0 - данные из таблицы)

(function() {
    // Функция закрытия меню
    function closeContextMenu() {
        const contextMenu = document.querySelector('.context-menu');
        const overlay = document.querySelector('.context-menu-overlay');
        if (contextMenu) contextMenu.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    }

    // Обновление мини-профиля в меню
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
            // Вставляем в начало контекстного меню
            contextMenu.insertBefore(profileSection, contextMenu.firstChild);
        }
        
        // Показываем индикатор загрузки

        
        // Получаем информацию о пользователе с повторными попытками
        let userInfo = null;
        let retries = 0;
        const maxRetries = 10;
        
        while (!userInfo && retries < maxRetries) {
            try {
                userInfo = await window.ProfileData.fetchUserByDiscordId(String(discordUser.id));
                if (!userInfo) {
                    retries++;
                    if (retries < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
            } catch (error) {
                console.warn(`ProfileNav: Попытка ${retries + 1} не удалась:`, error);
                retries++;
                if (retries < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }
        
        if (!userInfo) {
            console.log('ProfileNav: Пользователь не найден в базе после всех попыток');
            profileSection.innerHTML = `
                <div class="profile-nav-error">
                    <div>Пользователь не найден</div>
                    <div style="font-size: 10px; margin-top: 4px; opacity: 0.7;">
                        Ваш аккаунт не привязан к HWID
                    </div>
                </div>
            `;
            return;
        }
        
        // Сохраняем HWID текущего пользователя глобально
        window.currentUserHwid = userInfo.hwid;
        
        // Получаем отображаемое имя
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
        
        // Обновляем также основную информацию в btn_logout
        const avatarImg = btnLogout.querySelector('.avatar-account .avatar');
        const navTitle = btnLogout.querySelector('.nav-bt-title');
        const navRole = btnLogout.querySelector('.nav-bt-title-hwid');
        
        if (navTitle) {
            navTitle.textContent = displayName;
        }
        
        if (navRole) {
            navRole.textContent = userInfo.roleText;
            navRole.className = `nav-bt-title-hwid role-${userInfo.roleClass}`;
        }
        
        // Загружаем аватар
        if (avatarImg && userInfo.discordId && userInfo.avatarHash) {
            const avatarUrl = await window.ProfileData.getDiscordAvatarUrl(userInfo.discordId, userInfo.avatarHash);
            if (avatarUrl) {
                avatarImg.src = avatarUrl;
                avatarImg.style.visibility = 'visible';
                
                // Также обновляем аватар в макете
                const navProfileAvatar = profileSection.querySelector('#navProfileAvatar');
                if (navProfileAvatar) {
                    navProfileAvatar.src = avatarUrl;
                    navProfileAvatar.style.opacity = '1';
                    const letterDiv = profileSection.querySelector('.profile-nav-avatar-letter');
                    if (letterDiv) letterDiv.style.opacity = '0';
                }
            }
        } else if (avatarImg) {
            avatarImg.style.visibility = 'hidden';
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
    }

    // Обновление при открытии меню
    function setupMenuOpenHandler() {
        const originalToggle = window.toggleContextMenu;
        
        window.toggleContextMenu = function(event) {
            if (originalToggle) originalToggle(event);
            
            const contextMenu = document.querySelector('.context-menu');
            if (contextMenu && contextMenu.classList.contains('active')) {
                // Запускаем обновление без блокировки интерфейса
                updateNavProfile().catch(error => {
                    console.error('ProfileNav: Ошибка обновления профиля:', error);
                    const profileSection = contextMenu.querySelector('.context-menu-hwid');
                    if (profileSection) {
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
                });
            }
        };
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
                setTimeout(updateNavProfile, 500);
                setupMenuOpenHandler();
            });
        } else {
            setTimeout(updateNavProfile, 500);
            setupMenuOpenHandler();
        }
        
        window.addEventListener('storage', function(e) {
            if (e.key === 'discord_user') {
                setTimeout(updateNavProfile, 500);
            }
        });
    }
    
    initNavProfile();
})();