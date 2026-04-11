// profile-nav.js - мини-профиль аккаунта в меню пользователя (ИСПРАВЛЕННАЯ ВЕРСИЯ)

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
        
        // Получаем информацию о HWID через универсальный модуль
        const userInfo = await window.ProfileData.fetchUserByDiscordId(String(discordUser.id));
        
        if (!userInfo) {
            console.log('ProfileNav: Пользователь не найден в базе');
            return;
        }
        
        // Сохраняем HWID текущего пользователя глобально для использования в openFullProfile
        window.currentUserHwid = userInfo.hwid;
        
        // Получаем Discord данные для аватара и имени
        let discordData = null;
        if (userInfo.discordId) {
            discordData = await window.ProfileData.getDiscordUserData(userInfo.discordId);
        }
        
        const subscription = window.ProfileData.getSubscriptionStatus(userInfo);
        const displayName = window.ProfileData.getDisplayName(userInfo, discordData);
        const shortHwid = window.ProfileData.getShortHwid(userInfo.hwid, 16);
        const avatarLetter = window.ProfileData.getAvatarLetter(displayName);
        
        // Ищем или создаем секцию профиля
        let profileSection = contextMenu.querySelector('#contextHwidInfo');
        
        if (!profileSection) {
            profileSection = document.createElement('div');
            profileSection.className = 'context-menu-hwid';
            profileSection.id = 'contextHwidInfo';
            
            const firstChild = contextMenu.firstChild;
            if (firstChild) {
                contextMenu.insertBefore(profileSection, firstChild);
            } else {
                contextMenu.appendChild(profileSection);
            }
        }
        
        // Определяем класс для статуса
        let statusClass = subscription.status;
        let statusText = subscription.text;
        
        // Обновляем содержимое
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
        
        // Загружаем аватар
        if (discordData && discordData.avatar) {
            const avatarImg = profileSection.querySelector('#navProfileAvatar');
            if (avatarImg) {
                const avatarUrl = await window.ProfileData.getDiscordAvatarUrl(discordData.id, discordData.avatar);
                if (avatarUrl) {
                    avatarImg.src = avatarUrl;
                    avatarImg.style.opacity = '1';
                    const letterDiv = profileSection.querySelector('.profile-nav-avatar-letter');
                    if (letterDiv) letterDiv.style.opacity = '0';
                }
            }
        }
    }

    // НОВАЯ ФУНКЦИЯ: Открытие профиля текущего пользователя с обновлением URL
    window.openFullProfile = function(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        closeContextMenu();
        
        // Получаем HWID текущего пользователя
        const hwid = window.currentUserHwid;
        
        if (!hwid) {
            console.error('ProfileNav: HWID не найден');
            return;
        }
        
        // Проверяем, доступен ли ProfileModal
        if (window.ProfileModal && window.ProfileModal.openByHwid) {
            // ProfileModal сам обновит URL через updateURLParams
            window.ProfileModal.openByHwid(hwid);
        } else {
            console.error('ProfileNav: ProfileModal не загружен');
        }
    };

    // Обновление при открытии меню
    function setupMenuOpenHandler() {
        // Переопределяем глобальную функцию toggleContextMenu
        const originalToggle = window.toggleContextMenu;
        
        window.toggleContextMenu = function(event) {
            if (originalToggle) originalToggle(event);
            
            const contextMenu = document.querySelector('.context-menu');
            const overlay = document.querySelector('.context-menu-overlay');
            
            if (contextMenu && contextMenu.classList.contains('active')) {
                // Меню открыто - обновляем данные
                setTimeout(async () => {
                    await updateNavProfile();
                }, 50);
            }
        };
    }

    // Инициализация
    async function initNavProfile() {
        // Ждем загрузки ProfileData модуля
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
        
        // Инициализируем переменную для HWID
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