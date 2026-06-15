// profile-launches.js - финальная версия
// Версия 3.0 - работает с любыми SteamID

(function() {
    const steamCache = new Map();
    
    function formatLaunchDate(dateString) {
        if (!dateString) return 'Неизвестно';
        return dateString;
    }
    
    async function fetchSteamData(steamId) {
        if (!steamId) return { username: steamId, avatar: null };
        
        // Проверяем кэш
        if (steamCache.has(steamId)) {
            const cached = steamCache.get(steamId);
            if (Date.now() - cached.timestamp < 3600000) {
                return cached.data;
            }
        }
        
        try {
            const response = await fetch(`https://steam-api.fascord.workers.dev/api/${steamId}`, {
                cache: 'no-store'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            const result = {
                username: data.username || steamId,
                avatar: data.avatar || null,
                exists: data.exists !== false
            };
            
            steamCache.set(steamId, { data: result, timestamp: Date.now() });
            return result;
            
        } catch (error) {
            console.warn(`Ошибка загрузки Steam ${steamId}:`, error);
            return { username: steamId, avatar: null, error: true };
        }
    }
    
    async function preloadSteamDataForLaunches(launches) {
        const steamIds = [...new Set(
            launches
                .filter(l => l.steamId && l.steamId.trim())
                .map(l => l.steamId)
        )];
        
        if (steamIds.length === 0) return;
        
        console.log(`Загрузка Steam данных для ${steamIds.length} ID...`);
        
        // Загружаем последовательно, без спама
        for (const steamId of steamIds) {
            if (!steamCache.has(steamId)) {
                await fetchSteamData(steamId);
                await new Promise(r => setTimeout(r, 100));
            }
        }
    }
    
    function createLaunchItemHTML(launch, steamData) {
        let steamHtml = '';
        
        if (launch.steamId && steamData) {
            const avatarHtml = steamData.avatar 
                ? `<img class="profile-launch-avatar" src="${steamData.avatar}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : '';
            
            steamHtml = `
                <a class="profile-launch-steam-info" href="https://steamcommunity.com/profiles/${launch.steamId}" target="_blank">
                    ${avatarHtml}
                    <div class="profile-launch-steam-details">
                        <span class="profile-launch-username">${escapeHtml(steamData.username)}</span>
                        <div class="profile-launch-steamid">${escapeHtml(launch.steamId)}</div>
                    </div>
                </a>
            `;
        } else if (launch.steamId) {
            steamHtml = `
                <a class="profile-launch-steam-info" href="https://steamcommunity.com/profiles/${launch.steamId}" target="_blank">
                    <div class="profile-launch-steam-details">
                        <span class="profile-launch-username">${escapeHtml(launch.steamId)}</span>
                        <div class="profile-launch-steamid">${escapeHtml(launch.steamId)}</div>
                    </div>
                </a>
            `;
        }
        
        return `
            <div class="profile-launch-item">
                <div class="profile-launch-box">
                    <div class="profile-launch-time">${escapeHtml(formatLaunchDate(launch.timestamp))}</div>
                    ${launch.version ? `<div class="profile-launch-version">${escapeHtml(launch.version)}</div>` : ''}
                </div>
                <div class="profile-launch-details">${steamHtml}</div>
            </div>
        `;
    }
    
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }
    
    async function createLaunchesHTML(launches) {
        if (!launches || launches.length === 0) {
            return `<div class="profile-launches-empty"><span>История запусков не найдена</span></div>`;
        }
        
        await preloadSteamDataForLaunches(launches);
        
        const itemsHtml = launches.map(launch => {
            const steamData = steamCache.get(launch.steamId)?.data;
            return createLaunchItemHTML(launch, steamData);
        });
        
        return `
            <div class="profile-launches-list">${itemsHtml.join('')}</div>
            <div class="profile-launches-header"><span>Найдено записей (${launches.length})</span></div>
        `;
    }
    
    async function loadAndDisplayLaunches(hwid, containerElement) {
        if (!hwid || !containerElement) return;
        
        containerElement.innerHTML = `<div class="profile-launches-loading"><div class="profile-launches-spinner"></div><span>Загрузка истории запусков...</span></div>`;
        
        try {
            const launches = await window.ProfileData.fetchLaunchesByHwid(hwid);
            const html = await createLaunchesHTML(launches);
            containerElement.innerHTML = html;
        } catch (error) {
            console.error('Ошибка:', error);
            containerElement.innerHTML = `<div class="profile-launches-error"><span>Ошибка загрузки</span></div>`;
        }
    }
    
    window.ProfileLaunches = {
        loadAndDisplayLaunches: loadAndDisplayLaunches,
        clearCache: () => steamCache.clear()
    };
})();