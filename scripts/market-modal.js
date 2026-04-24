// market-modal.js - модуль модального окна магазина
// Версия 1.0 - интеграция market.html в модальное окно с параметрами URL

(function() {
    // Конфигурация товаров (из price.js)
    const PRICE_LIST = [
        {
            item_id: 'kensolua-14d',
            item_discount: 28,
            item_price: '70 Руб',
            item_term: '2 нед. (14д)',
            pay_link: 'https://pay.cloudtips.ru/p/d97e09bd',
        },
        {
            item_id: 'kensolua-30d',
            item_discount: 50,
            item_price: '130 Руб',
            item_term: '1 мес. (30д)',
            pay_link: 'https://pay.cloudtips.ru/p/5805d96d',
        },
        {
            item_id: 'kensolua-90d',
            item_discount: 50,
            item_price: '170 Руб',
            item_term: '3 мес. (90д)',
            pay_link: 'https://pay.cloudtips.ru/p/039e249a',
        },
        {
            item_id: 'kensolua-180d',
            item_discount: 50,
            item_price: '250 Руб',
            item_term: '6 мес. (180д)',
            pay_link: 'https://pay.cloudtips.ru/p/1a5bda74',
        },
        {
            item_id: 'kensolua-365d',
            item_discount: 40,
            item_price: '500 Руб',
            item_term: '1 год. (365д)',
            pay_link: 'https://pay.cloudtips.ru/p/034c84f9',
        },
        {   
            item_id: 'kensolua-pro',
            item_discount: 75,
            item_price: '2000 Руб',
            item_term: 'Навсегда',
            pay_link: 'https://pay.cloudtips.ru/p/8c833222',
        },
        {   
            item_id: 'donate',
            item_discount: -1,
            item_price: 'Пожертвование',
            item_term: 'На развитие проекта',
            pay_link: 'https://pay.cloudtips.ru/p/c6fe8558',
        },
    ];

    // Доступные способы оплаты
    const PAYMENT_METHODS = [
        { id: 'cloudtips', name: 'CloudTips', icon: './content/svg/pay-cloudtips.svg', active: true },
        { id: 'ozonbank', name: 'Ozon Банк', icon: './content/svg/pay-ozonbank.svg', active: false },
        { id: 'yoomoney', name: 'ЮMoney', icon: './content/svg/pay-yoomoney.svg', active: false },
    ];

    // Текущее состояние
    let currentItemId = 'kensolua-30d';
    let currentPayMethod = 'cloudtips';
    let isModalOpen = false;
    
    // DOM элементы
    let modalOverlay = null;
    
    // Функции для работы с параметрами URL
    function updateMarketURLParams(params) {
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
    
    function getMarketURLParams() {
        const url = new URL(window.location.href);
        return {
            page: url.searchParams.get('page'),
            item: url.searchParams.get('item'),
            pay: url.searchParams.get('pay')
        };
    }
    
    function clearMarketParams() {
        const url = new URL(window.location.href);
        url.searchParams.delete('page');
        url.searchParams.delete('item');
        url.searchParams.delete('pay');
        window.history.pushState({}, '', url.toString());
    }
    
    // Получить товар по ID
    function getItemById(itemId) {
        return PRICE_LIST.find(item => item.item_id === itemId) || PRICE_LIST[1];
    }
    
    // Форматирование цены со скидкой
    function getOriginalPrice(currentPrice, discountPercent) {
        if (!discountPercent || discountPercent === 0) return null;
        const priceMatch = currentPrice.match(/(\d+)/);
        if (!priceMatch) return null;
        const price = parseInt(priceMatch[0]);
        const discountedPrice = Math.round(price * (1 - discountPercent / 100));
        return discountedPrice + ' ' + currentPrice.replace(/\d+/, '').trim();
    }
    
    // Рендер таблицы цен
    function renderPricingTable(container, selectedItemId) {
        if (!container) return;
        
        const tableHtml = `
            <div class="pricing-table modal">
                <div class="dropdown-title">Список товаров</div>
                <table>
                    <thead>
                        <tr><th>Стоимость</th><th>Срок действия</th></tr>
                    </thead>
                    <tbody>
                        ${PRICE_LIST.filter(item => item.item_discount !== -1).map(item => {
                            const isSelected = item.item_id === selectedItemId;
                            const discount = item.item_discount || 0;
                            const hasDiscount = discount > 0;
                            
                            let priceHtml = '';
                            if (hasDiscount) {
                                const originalPrice = getOriginalPrice(item.item_price, discount);
                                priceHtml = `
                                    <div class="price-with-discount">
                                        <span class="old-price">${item.item_price}</span>
                                        <span class="discount-badge">${discount}%</span>
                                        <span class="new-price"><strong>${originalPrice || item.item_price}</strong></span>
                                    </div>
                                `;
                            } else {
                                priceHtml = `<strong>${item.item_price}</strong>`;
                            }
                            
                            return `
                                <tr class="price-row market-item-row" data-item-id="${item.item_id}" style="cursor: pointer; ${isSelected ? 'background: rgba(215, 254, 123, 0.1);' : ''}">
                                    <td class="price-cell">${priceHtml}</td>
                                    <td class="term-cell"><span class="${item.item_term.includes('Навсегда') ? 'forever' : ''}">${item.item_term}</span></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        container.innerHTML = tableHtml;
        
        // Добавляем обработчики кликов на строки таблицы
        const rows = container.querySelectorAll('.market-item-row');
        rows.forEach(row => {
            row.addEventListener('click', () => {
                const itemId = row.getAttribute('data-item-id');
                if (itemId) {
                    selectItem(itemId);
                }
            });
        });
    }
    
    // Рендер селектора способов оплаты
    function renderPaySelector(container, selectedPayId) {
        if (!container) return;
        
        container.innerHTML = `
            <div class="market-pay-selector">
                ${PAYMENT_METHODS.map(method => `
                    <button class="market-pay-btn ${method.id === selectedPayId ? 'active' : ''} ${!method.active ? 'disabled-method' : ''}" 
                            data-pay-id="${method.id}"
                            ${!method.active ? 'disabled' : ''}>
                        ${method.icon ? `<img src="${method.icon}" alt="${method.name}" onerror="this.style.display='none'">` : ''}
                    </button>
                `).join('')}
            </div>
        `;
        
        const btns = container.querySelectorAll('.market-pay-btn:not([disabled])');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                const payId = btn.getAttribute('data-pay-id');
                if (payId) {
                    selectPayMethod(payId);
                }
            });
        });
    }
    
    // Выбор товара
    function selectItem(itemId) {
        currentItemId = itemId;
        
        // Обновляем URL параметр
        updateMarketURLParams({ page: 'market', item: itemId, pay: currentPayMethod });
        
        // Обновляем UI
        const itemSelector = document.getElementById('marketItemSelector');
        if (itemSelector) {
            const btns = itemSelector.querySelectorAll('.market-item-btn');
            btns.forEach(btn => {
                if (btn.getAttribute('data-item-id') === itemId) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
        
        // Обновляем подсветку в таблице
        const pricingContainer = document.getElementById('marketPricingContainer');
        if (pricingContainer) {
            const rows = pricingContainer.querySelectorAll('.market-item-row');
            rows.forEach(row => {
                if (row.getAttribute('data-item-id') === itemId) {
                    row.style.background = 'rgba(215, 254, 123, 0.1)';
                } else {
                    row.style.background = '';
                }
            });
        }
        
        // Обновляем информацию о выбранном товаре
        updateSelectedInfo();
    }
    
    // Выбор способа оплаты
    function selectPayMethod(payId) {
        const method = PAYMENT_METHODS.find(m => m.id === payId);
        if (!method || !method.active) return;
        
        currentPayMethod = payId;
        
        // Обновляем URL параметр
        updateMarketURLParams({ page: 'market', item: currentItemId, pay: payId });
        
        // Обновляем UI
        const paySelector = document.getElementById('marketPaySelector');
        if (paySelector) {
            const btns = paySelector.querySelectorAll('.market-pay-btn');
            btns.forEach(btn => {
                if (btn.getAttribute('data-pay-id') === payId) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
    }
    
    // Обновление информации о выбранном товаре
    function updateSelectedInfo() {
        const item = getItemById(currentItemId);
        const container = document.getElementById('marketSelectedInfo');
        if (!container || !item) return;
        
        const discount = item.item_discount || 0;
        let priceDisplay = item.item_price;
        if (discount > 0) {
            const originalPrice = getOriginalPrice(item.item_price, discount);
            if (originalPrice) priceDisplay = originalPrice;
        }
        
        container.innerHTML = `
            <div class="market-selected-info">
                <span class="market-selected-term">${item.item_term}</span>
                <span class="market-selected-price">${priceDisplay}</span>
            </div>
        `;
    }
    
    // Покупка (переход на оплату)
    function handleBuy() {
        const item = getItemById(currentItemId);
        if (!item) return;
        
        // Открываем ссылку на оплату
        if (item.pay_link) {
            window.open(item.pay_link, '_blank');
        } else {
            console.warn('Ссылка на оплату не найдена');
            // Можно показать уведомление
            const msgDiv = document.getElementById('marketMessage');
            if (msgDiv) {
                msgDiv.innerHTML = '<div class="message error" style="display:block;">Ссылка на оплату временно недоступна</div>';
                setTimeout(() => {
                    if (msgDiv) msgDiv.innerHTML = '';
                }, 3000);
            }
        }
    }
    
    // Рендер всего содержимого модального окна
    async function renderMarketModal(initialItemId = null, initialPayId = null) {
        if (!modalOverlay) return;
        
        // Устанавливаем начальные значения
        if (initialItemId && PRICE_LIST.some(i => i.item_id === initialItemId)) {
            currentItemId = initialItemId;
        } else {
            currentItemId = 'kensolua-30d';
        }
        
        if (initialPayId && PAYMENT_METHODS.some(m => m.id === initialPayId && m.active)) {
            currentPayMethod = initialPayId;
        } else {
            currentPayMethod = 'cloudtips';
        }
        
        modalOverlay.innerHTML = `
            <div class="market-modal-container">
                <div class="market-modal-header">
                    <div class="market-modal-title">
                        Магазин
                    </div>
                    <button class="market-modal-close" id="marketModalClose">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="market-modal-content" id="marketModalContent">
                    <div id="marketItemSelector"></div>
                    <div id="marketPricingContainer"></div>
                    <div id="marketPricingContainer">Перед оплатой согласуйте вычачу HWID!</div>
                    <div id="marketSelectedInfo"></div>
                    <div id="marketPaySelector"></div>
                    <div id="marketMessage"></div>
                    <button class="market-buy-btn" id="marketBuyBtn">
                        Перейти к оплате
                    </button>
                </div>
            </div>
        `;
        
        // Рендерим компоненты
        const itemSelector = document.getElementById('marketItemSelector');
        const pricingContainer = document.getElementById('marketPricingContainer');
        const paySelector = document.getElementById('marketPaySelector');
        
        // Используем оба варианта выбора товара
        renderPricingTable(pricingContainer, currentItemId);
        renderPaySelector(paySelector, currentPayMethod);
        updateSelectedInfo();
        
        // Обработчики
        const closeBtn = document.getElementById('marketModalClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeMarketModal);
        }
        
        const buyBtn = document.getElementById('marketBuyBtn');
        if (buyBtn) {
            buyBtn.addEventListener('click', handleBuy);
        }
        
        modalOverlay.classList.add('active');
        isModalOpen = true;
        document.body.style.overflow = 'hidden';
    }
    
    function showMarketLoader() {
        if (!modalOverlay) return;
        modalOverlay.innerHTML = `
            <div class="market-modal-container">
                <div class="market-modal-header">
                    <div class="market-modal-title">
                        Магазин
                    </div>
                    <button class="market-modal-close" id="marketModalCloseLoader">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="market-modal-content">
                    <div class="profile-loader">
                        <div class="profile-spinner"></div>
                        <p>Загрузка магазина...</p>
                    </div>
                </div>
            </div>
        `;
        const closeBtn = document.getElementById('marketModalCloseLoader');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeMarketModal);
        }
        modalOverlay.classList.add('active');
        isModalOpen = true;
        document.body.style.overflow = 'hidden';
    }
    
    // Открытие модального окна
    async function openMarketModal(itemId = null, payId = null) {
        showMarketLoader();
        
        try {
            await renderMarketModal(itemId, payId);
        } catch (error) {
            console.error('Ошибка открытия магазина:', error);
            if (modalOverlay) {
                modalOverlay.innerHTML = `
                    <div class="market-modal-container">
                        <div class="market-modal-header">
                            <div class="market-modal-title">Ошибка</div>
                            <button class="market-modal-close" id="marketModalCloseError">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 6L6 18M6 6l12 12"/>
                                </svg>
                            </button>
                        </div>
                        <div class="market-modal-content">
                            <div class="profile-error">
                                <p>Ошибка загрузки магазина</p>
                            </div>
                        </div>
                    </div>
                `;
                const closeBtn = document.getElementById('marketModalCloseError');
                if (closeBtn) closeBtn.addEventListener('click', closeMarketModal);
                modalOverlay.classList.add('active');
                isModalOpen = true;
                document.body.style.overflow = 'hidden';
            }
        }
    }
    
    function closeMarketModal() {
        if (modalOverlay) {
            modalOverlay.classList.remove('active');
        }
        isModalOpen = false;
        document.body.style.overflow = '';
        
        clearMarketParams();
    }
    
    // Обработка параметров URL
    function handleUrlParams() {
        const params = getMarketURLParams();
        
        if (params.page === 'market') {
            const itemId = params.item || null;
            const payId = params.pay || null;
            
            // Проверяем валидность payId
            let validPayId = payId;
            if (payId) {
                const method = PAYMENT_METHODS.find(m => m.id === payId);
                if (!method || !method.active) {
                    validPayId = null;
                }
            }
            
            openMarketModal(itemId, validPayId);
        }
    }
    
    // Инициализация модального окна
    function initMarketModal() {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'marketModalOverlay';
        modalOverlay.className = 'market-modal-overlay';
        document.body.appendChild(modalOverlay);
        
        modalOverlay.addEventListener('click', function(e) {
            if (e.target === modalOverlay) {
                closeMarketModal();
            }
        });
        
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && isModalOpen) {
                closeMarketModal();
            }
        });
        
        // Обрабатываем параметры URL при загрузке
        handleUrlParams();
    }
    
    // Обработчик popstate
    window.addEventListener('popstate', function() {
        const params = getMarketURLParams();
        
        if (params.page === 'market') {
            const itemId = params.item || null;
            const payId = params.pay || null;
            let validPayId = payId;
            if (payId) {
                const method = PAYMENT_METHODS.find(m => m.id === payId);
                if (!method || !method.active) validPayId = null;
            }
            openMarketModal(itemId, validPayId);
        } else if (isModalOpen) {
            closeMarketModal();
        }
    });
    
    // Экспортируем функции глобально
    window.MarketModal = {
        open: openMarketModal,
        close: closeMarketModal,
        selectItem: selectItem,
        selectPayMethod: selectPayMethod
    };
    
    // Ждем загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMarketModal);
    } else {
        initMarketModal();
    }
})();