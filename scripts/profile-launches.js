// profile-launches.js - модуль для отображения истории запусков
// Версия 1.1 (с поддержкой Steam аватаров и никнеймов)

(function() {
    // Кэш для данных Steam (steamId -> { avatar, username })
    const steamCache = new Map();
    
    // Функция для форматирования даты из "DD.MM.YYYY HH:MM:SS" в более читаемый вид
    function formatLaunchDate(dateString) {
        if (!dateString) return 'Неизвестно';
        return dateString;
    }
    
    // Получение данных Steam с кэшированием
    async function fetchSteamData(steamId) {
        if (!steamId) return null;
        
        // Проверяем кэш
        if (steamCache.has(steamId)) {
            return steamCache.get(steamId);
        }
        
        try {
            const response = await fetch(`https://lucky-math-046d.fascord.workers.dev/api/${steamId}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            
            const steamData = {
                avatar: data.avatar || null,
                username: data.username || steamId,
                steamId: data.steamId || steamId
            };
            
            // Сохраняем в кэш
            steamCache.set(steamId, steamData);
            return steamData;
        } catch (error) {
            console.error(`Ошибка загрузки данных Steam для ${steamId}:`, error);
            const fallbackData = { avatar: null, username: steamId, steamId };
            steamCache.set(steamId, fallbackData);
            return fallbackData;
        }
    }
    
    // Создание HTML для одного элемента запуска (асинхронно, но возвращаем промис)
    async function createLaunchItemHTML(launch) {
        let steamHtml = '';
        
        if (launch.steamId) {
            const steamData = await fetchSteamData(launch.steamId);
            const avatarHtml = steamData.avatar 
                ? `<img class="profile-launch-avatar" src="${window.ProfileData.escapeHtml(steamData.avatar)}" alt="Avatar" loading="lazy" onerror="this.style.display='none'">`
                : '';
            
            steamHtml = `
                <a class="profile-launch-steam-info" href="https://steamcommunity.com/profiles/${window.ProfileData.escapeHtml(launch.steamId)}" target="_blank">
                    ${avatarHtml}
                    <div class="profile-launch-steam-details">
                        <span class="profile-launch-username">${window.ProfileData.escapeHtml(steamData.username)}</span>
                        <div class="profile-launch-steamid">
                            ${window.ProfileData.escapeHtml(launch.steamId)}
                        </div>
                    </div>
                </a>
            `;
        }
        
        return `
            <div class="profile-launch-item">
                <div class="profile-launch-box">
                    <div class="profile-launch-time">
                        ${window.ProfileData.escapeHtml(formatLaunchDate(launch.timestamp))}
                    </div>
                    ${launch.version ? `
                        <div class="profile-launch-version">
                            ${window.ProfileData.escapeHtml(launch.version)}
                        </div>` : ''
                    }
                </div>
                <div class="profile-launch-details">
                    ${steamHtml}
                </div>
            </div>
        `;
    }
    
    // Создание HTML для блока запусков (с параллельной загрузкой Steam данных)
    async function createLaunchesHTML(launches) {
        if (!launches || launches.length === 0) {
            return `
                <div class="profile-launches-empty">
                    <span>История запусков не найдена</span>
                </div>
            `;
        }
        
        // Параллельно загружаем данные для всех запусков с Steam ID
        const itemsHtml = await Promise.all(launches.map(launch => createLaunchItemHTML(launch)));
        
        return `
            <div class="profile-launches-list">
                ${itemsHtml.join('')}
            </div>
            <div class="profile-launches-header">
                <span>Найдено записей (${launches.length})</span>
            </div>
        `;
    }
    
    // Основная функция для загрузки и отображения запусков
    async function loadAndDisplayLaunches(hwid, containerElement) {
        if (!hwid || !containerElement) {
            console.warn('loadAndDisplayLaunches: HWID или контейнер не указан');
            return;
        }
        
        // Показываем индикатор загрузки
        containerElement.innerHTML = `
            <div class="profile-launches-loading">
                <div class="profile-launches-spinner"></div>
                <span>Загрузка истории запусков...</span>
            </div>
        `;
        
        try {
            const launches = await window.ProfileData.fetchLaunchesByHwid(hwid);
            const html = await createLaunchesHTML(launches);
            containerElement.innerHTML = html;
        } catch (error) {
            console.error('Ошибка загрузки истории запусков:', error);
            containerElement.innerHTML = `
                <div class="profile-launches-error">
                    <span>Ошибка загрузки истории запусков</span>
                </div>
            `;
        }
    }
    
    // Экспортируем функцию
    window.ProfileLaunches = {
        loadAndDisplayLaunches: loadAndDisplayLaunches,
        // Дополнительно: функция для очистки кэша Steam (при необходимости)
        clearSteamCache: () => steamCache.clear()
    };
})();