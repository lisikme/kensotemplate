// profile-launches.js - модуль для отображения истории запусков
// Версия 1.0

(function() {
    // Функция для форматирования даты из "DD.MM.YYYY HH:MM:SS" в более читаемый вид
    function formatLaunchDate(dateString) {
        if (!dateString) return 'Неизвестно';
        // Можно оставить как есть или преобразовать, например, "16.04.2026 14:30:32"
        return dateString;
    }

    // Создание HTML для блока запусков
    function createLaunchesHTML(launches) {
        if (!launches || launches.length === 0) {
            return `
                <div class="profile-launches-empty">
                    <span>История запусков не найдена</span>
                </div>
            `;
        }

        const launchesList = launches.map(launch => `
            <div class="profile-launch-item">
                <div class="profile-launch-time">
                    ${window.ProfileData.escapeHtml(formatLaunchDate(launch.timestamp))}
                </div>
                <div id='nav-info-log'>
                    ${launch.version ? `<div class="profile-launch-version">${window.ProfileData.escapeHtml(launch.version)}</div>` : ''}
                    ${launch.steamId ? `<div class="profile-launch-steamid">${window.ProfileData.escapeHtml(launch.steamId)}</div>` : ''}
                </div>
            </div>
        `).join('');

        return `
            <div class="profile-launches-list">
                ${launchesList}
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
            containerElement.innerHTML = createLaunchesHTML(launches);
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
        loadAndDisplayLaunches: loadAndDisplayLaunches
    };
})();