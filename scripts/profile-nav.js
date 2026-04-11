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
        
        // Сохраняем HWID текущего пользователя глобально
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
        
        // Определяем класс для статуса
        let statusClass = subscription.status;
        let statusText = subscription.text;
        
        // Если статус активный и есть форматированное время, показываем его
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
        
        // 1. Обновляем основную информацию в btn_logout
        const avatarImg = btnLogout.querySelector('.avatar-account .avatar');
        const navTitle = btnLogout.querySelector('.nav-bt-title');
        const navRole = btnLogout.querySelector('.nav-bt-title-hwid');
        
        if (navTitle) {
            navTitle.textContent = displayName;
        }
        
        if (navRole) {
            navRole.textContent = userInfo.roleText;
            // Обновляем класс роли
            navRole.className = `nav-bt-title-hwid role-${userInfo.roleClass}`;
        }
        
        // Обновляем аватар
        if (avatarImg && discordData && discordData.avatar) {
            const avatarUrl = await window.ProfileData.getDiscordAvatarUrl(discordData.id, discordData.avatar);
            if (avatarUrl) {
                avatarImg.src = avatarUrl;
                avatarImg.style.visibility = 'visible';
            }
        }
        
        // 2. Обновляем секцию contextHwidInfo (если существует)
        let hwidSection = contextMenu.querySelector('#contextHwidInfo');
        
        if (hwidSection) {
            // Обновляем существующую секцию, а не перезаписываем
            const hwidCode = hwidSection.querySelector('.hwid-code');
            const statusValue = hwidSection.querySelector('.hwid-status .value');
            const roleSpan = hwidSection.querySelector('.hwid-role');
            const progressBar = hwidSection.querySelector('.hwid-expire-progress');
            const expireBarContainer = hwidSection.querySelector('.hwid-expire-bar');
            
            if (hwidCode) {
                hwidCode.textContent = displayName;
            }
            
            if (statusValue) {
                statusValue.textContent = statusText;
                statusValue.className = `value ${statusClass}`;
            }
            
            if (roleSpan) {
                roleSpan.textContent = userInfo.roleText;
                roleSpan.className = `hwid-role ${userInfo.roleClass}`;
            }
            
            // Обновляем прогресс-бар для активной лицензии с остатком < 30 дней
            if (expireBarContainer) {
                if (subscription.status === 'active' && subscription.daysLeft > 0 && subscription.daysLeft <= 30) {
                    const percent = Math.min(100, (subscription.daysLeft / 30) * 100);
                    if (progressBar) {
                        progressBar.style.width = `${percent}%`;
                    }
                    expireBarContainer.style.display = 'block';
                } else {
                    expireBarContainer.style.display = 'none';
                }
            }
        } else {
            // Если секции нет, создаем её (для обратной совместимости)
            const newHwidSection = document.createElement('div');
            newHwidSection.id = 'contextHwidInfo';
            newHwidSection.className = 'context-menu-hwid';
            
            const progressStyle = (subscription.status === 'active' && subscription.daysLeft > 0 && subscription.daysLeft <= 30) 
                ? `style="width: ${Math.min(100, (subscription.daysLeft / 30) * 100)}%;"` 
                : 'style="width: 100%; display: none;"';
            
            const expireBarDisplay = (subscription.status === 'active' && subscription.daysLeft > 0 && subscription.daysLeft <= 30) 
                ? '' 
                : 'style="display: none;"';
            
            newHwidSection.innerHTML = `
                <div class="hwid-header">
                    <span>Информация HWID</span>
                </div>
                <div class="hwid-info">
                    <div class="hwid-code">${window.ProfileData.escapeHtml(displayName)}</div>
                    <div id="infr">
                        <div class="hwid-status">
                            <span class="label">Статус</span>
                            <span class="value ${statusClass}">${window.ProfileData.escapeHtml(statusText)}</span>
                        </div>
                        <div class="hwid-status">
                            <span class="label">Роль</span>
                            <span class="hwid-role ${userInfo.roleClass}">${window.ProfileData.escapeHtml(userInfo.roleText)}</span>
                        </div>
                    </div>
                </div>
                <div class="hwid-expire-bar" ${expireBarDisplay}>
                    <div class="hwid-expire-progress" ${progressStyle}></div>
                </div>
            `;
            
            // Вставляем в начало контекстного меню
            const firstChild = contextMenu.firstChild;
            if (firstChild) {
                contextMenu.insertBefore(newHwidSection, firstChild);
            } else {
                contextMenu.appendChild(newHwidSection);
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

    // Обновление при открытии меню
    function setupMenuOpenHandler() {
        const originalToggle = window.toggleContextMenu;
        
        window.toggleContextMenu = function(event) {
            if (originalToggle) originalToggle(event);
            
            const contextMenu = document.querySelector('.context-menu');
            if (contextMenu && contextMenu.classList.contains('active')) {
                setTimeout(async () => {
                    await updateNavProfile();
                }, 50);
            }
        };
    }

    // Инициализация
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