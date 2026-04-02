// main.js - обновленный скрипт для галереи с прокруткой колесиком в модальном окне

// price.js - данные о ценах и функция отображения

// Функция для отображения цен в таблице
function renderPricingTable() {
    const tableBody = document.querySelector('.pricing-table tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    function getOriginalPrice(currentPrice, discountPercent) {
        if (!discountPercent || discountPercent === 0) return null;
        const priceMatch = currentPrice.match(/(\d+)/);
        if (!priceMatch) return null;
        const price = parseInt(priceMatch[0]);
        const discountedPrice = Math.round(price * (1 - discountPercent / 100));
        return discountedPrice + ' ' + currentPrice.replace(/\d+/, '').trim();
    }
    
    pricelist.forEach(item => {
        if (item.item_discount === -1) return;
        
        const row = document.createElement('tr');
        row.className = 'price-row';
        
        const priceCell = document.createElement('td');
        priceCell.className = 'price-cell';
        
        const termCell = document.createElement('td');
        termCell.className = 'term-cell';
        
        const discount = item.item_discount || 0;
        const hasDiscount = discount > 0;
        
        if (hasDiscount) {
            const originalPrice = getOriginalPrice(item.item_price, discount);
            priceCell.innerHTML = `
                <div class="price-with-discount">
                    <span class="old-price">${item.item_price}</span>
                    <span class="discount-badge">${discount}%</span>
                    <span class="new-price"><strong>${originalPrice || item.item_price}</strong></span>
                </div>
            `;
        } else {
            priceCell.innerHTML = `<strong>${item.item_price}</strong>`;
        }
        
        termCell.innerHTML = `<span class="${item.item_term.includes('Навсегда') ? 'forever' : ''}">${item.item_term}</span>`;
        
        row.appendChild(priceCell);
        row.appendChild(termCell);
        tableBody.appendChild(row);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    renderPricingTable();
});

// Меню покупки
const buyBtn = document.getElementById('buyBtn');
const buyMenu = document.getElementById('buyMenu');

if (buyBtn && buyMenu) {
    buyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        buyMenu.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!buyMenu.contains(e.target) && e.target !== buyBtn) {
            buyMenu.classList.remove('active');
        }
    });
}

// Toggle features menu
document.addEventListener('DOMContentLoaded', function() {
    const toggleBtn = document.getElementById('toggleFeaturesBtn');
    const featuresTable = document.querySelector('.dropdown-wrapper2');
    
    if (featuresTable) {
        featuresTable.classList.remove('active');
    }
    
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            const isHidden = featuresTable.classList.toggle('active');
            
            if (isHidden) {
                toggleBtn.classList.replace('unactive', 'active');
            } else {
                toggleBtn.classList.replace('active', 'unactive');
            }
        });
    }
});

// ========== ГАЛЕРЕЯ-КАРУСЕЛЬ С БЕСКОНЕЧНОЙ ПРОКРУТКОЙ ==========
(function() {
    // Данные слайдов (оригинальные)
    const originalSlides = [
        { type: 'video', youtubeId: 'Lch7Ve9ntsA', img: '/images/1.png', label: 'ВИДЕО' },
        { type: 'image', img: '/images/promo.png', label: 'АКЦИЯ' },
        { type: 'image', img: '/images/2.png', label: null },
        { type: 'image', img: '/images/3.png', label: null },
        { type: 'image', img: '/images/4.png', label: null },
        { type: 'image', img: '/images/5.png', label: null },
        { type: 'image', img: '/images/6.png', label: null },
        { type: 'image', img: '/images/7.png', label: null },
        { type: 'image', img: '/images/8.png', label: null },
        { type: 'image', img: '/images/9.png', label: null },
        { type: 'image', img: '/images/10.png', label: null },
        { type: 'image', img: '/images/11.png', label: null },
        { type: 'image', img: '/images/12.png', label: null },
        { type: 'image', img: '/images/13.png', label: null },
        { type: 'image', img: '/images/14.png', label: null },
        { type: 'image', img: '/images/15.png', label: null },
        { type: 'image', img: '/images/16.png', label: null },
        { type: 'image', img: '/images/17.png', label: null },
        { type: 'image', img: '/images/18.png', label: null }
    ];
    
    // Для бесконечной прокрутки добавляем клоны: последний в начало, первый в конец
    const slides = [
        originalSlides[originalSlides.length - 1], // клон последнего в начало
        ...originalSlides,
        originalSlides[0]  // клон первого в конец
    ];
    
    let currentIndex = 1; // начинаем с первого реального слайда (индекс 1)
    let isAnimating = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    let autoResetTimeout = null;
    
    // DOM элементы
    const galleryContainer = document.querySelector('.product-gallery');
    if (!galleryContainer) return;
    
    // Создаем структуру карусели
    galleryContainer.innerHTML = `
        <div class="gallery-carousel">
            <div class="carousel-container">
                <div class="carousel-track" id="carouselTrack"></div>
                <button class="carousel-btn prev" id="carouselPrev">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-linecap="round"/>
                    </svg>
                </button>
                <button class="carousel-btn next" id="carouselNext">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-linecap="round"/>
                    </svg>
                </button>
                <div class="carousel-counter" id="carouselCounter">1 / ${originalSlides.length}</div>
            </div>
        </div>
    `;
    
    const track = document.getElementById('carouselTrack');
    const prevBtn = document.getElementById('carouselPrev');
    const nextBtn = document.getElementById('carouselNext');
    const counterEl = document.getElementById('carouselCounter');
    
    // Функция для получения реального индекса (без клонов)
    function getRealIndex(clonedIndex) {
        if (clonedIndex === 0) return originalSlides.length - 1;
        if (clonedIndex === slides.length - 1) return 0;
        return clonedIndex - 1;
    }
    
    // Обновление счетчика
    function updateCounter() {
        if (counterEl) {
            const realIndex = getRealIndex(currentIndex);
            counterEl.textContent = `${realIndex + 1} / ${originalSlides.length}`;
        }
    }
    
    // Создаем слайды
    function buildSlides() {
        track.innerHTML = '';
        slides.forEach((slide, idx) => {
            const slideDiv = document.createElement('div');
            slideDiv.className = 'carousel-slide';
            slideDiv.setAttribute('data-index', idx);
            slideDiv.setAttribute('data-type', slide.type);
            if (slide.type === 'video') {
                slideDiv.setAttribute('data-youtube-id', slide.youtubeId);
            }
            
            const img = document.createElement('img');
            img.src = slide.img;
            img.alt = `Скриншот ${idx + 1}`;
            img.loading = 'lazy';
            slideDiv.appendChild(img);
            
            if (slide.label) {
                const labelSpan = document.createElement('span');
                labelSpan.className = 'video-label';
                labelSpan.textContent = slide.label;
                slideDiv.appendChild(labelSpan);
            }
            
            const overlay = document.createElement('div');
            overlay.className = 'gallery-overlay';
            overlay.innerHTML = '<span>Открыть</span>';
            slideDiv.appendChild(overlay);
            
            // Открытие модалки с реальным индексом
            slideDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                const realIndex = getRealIndex(idx);
                openModalByIndex(realIndex);
            });
            
            track.appendChild(slideDiv);
        });
    }
    
    // Установка позиции без анимации
    function setPositionWithoutAnimation(index) {
        if (!track) return;
        const slideWidth = track.parentElement.clientWidth;
        const offset = -index * slideWidth;
        track.style.transition = 'none';
        track.style.transform = `translateX(${offset}px)`;
        // Форсируем reflow
        void track.offsetHeight;
        track.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    }
    
    // Плавный переход к слайду
    function goToSlide(newIndex, skipReset = false) {
        if (isAnimating) return;
        
        isAnimating = true;
        const oldIndex = currentIndex;
        currentIndex = newIndex;
        
        const slideWidth = track.parentElement.clientWidth;
        const offset = -currentIndex * slideWidth;
        
        track.style.transform = `translateX(${offset}px)`;
        updateCounter();
        
        // После анимации проверяем, не нужно ли сделать "телепорт" для бесконечности
        setTimeout(() => {
            isAnimating = false;
            
            // Если дошли до клона последнего (индекс 0) - телепортируем на реальный последний
            if (currentIndex === 0) {
                currentIndex = originalSlides.length;
                setPositionWithoutAnimation(currentIndex);
                updateCounter();
            }
            // Если дошли до клона первого (индекс slides.length-1) - телепортируем на реальный первый
            else if (currentIndex === slides.length - 1) {
                currentIndex = 1;
                setPositionWithoutAnimation(currentIndex);
                updateCounter();
            }
        }, 400);
    }
    
    // Следующий слайд
    function nextSlide() {
        if (isAnimating) return;
        goToSlide(currentIndex + 1);
    }
    
    // Предыдущий слайд
    function prevSlide() {
        if (isAnimating) return;
        goToSlide(currentIndex - 1);
    }
    
    // Обработчик ресайза
    function handleResize() {
        if (isAnimating) return;
        const slideWidth = track.parentElement.clientWidth;
        const offset = -currentIndex * slideWidth;
        track.style.transition = 'none';
        track.style.transform = `translateX(${offset}px)`;
        setTimeout(() => {
            track.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        }, 50);
    }
    
    // ========== СВАЙПЫ ==========
    function handleTouchStart(e) {
        if (isAnimating) return;
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }
    
    function handleTouchEnd(e) {
        if (isAnimating) return;
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 30) {
            if (deltaX > 0) {
                prevSlide();
            } else {
                nextSlide();
            }
        }
    }
    
    // ========== МОДАЛЬНОЕ ОКНО С ПОДДЕРЖКОЙ КОЛЕСИКА МЫШИ ==========
    let modalWheelTimeout = null;
    let modalWheelDelta = 0;
    let isModalWheelScrolling = false;
    
    function openModalByIndex(index) {
        const slide = originalSlides[index];
        if (!slide) return;
        
        let modal = document.getElementById('galleryModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'galleryModal';
            modal.innerHTML = `
                <button id="closeModal">
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
                    </svg>
                </button>
                <div class="modal-content" id="modalContent">
                    <img id="modalImage" src="" alt="">
                    <div id="modalVideo" class="modal-video-container" style="display: none;">
                        <iframe id="youtubePlayer" class="modal-video" src="" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                    </div>
                </div>
                <button class="modal-nav" id="modalPrev">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round">
                        <path d="M15 18l-6-6 6-6"/>
                    </svg>
                </button>
                <div class="modal-counter">
                    <span id="modalCounter">0 / 0</span>
                </div>
                <button class="modal-nav" id="modalNext">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </button>
            `;
            document.body.appendChild(modal);
        }
        
        const modalImage = document.getElementById('modalImage');
        const modalVideo = document.getElementById('modalVideo');
        const youtubePlayer = document.getElementById('youtubePlayer');
        const modalCounter = document.getElementById('modalCounter');
        
        let modalCurrentIndex = index;
        
        // Функция для проверки, находится ли мышь над iframe YouTube
        function isMouseOverYouTubeIframe(e) {
            if (!youtubePlayer) return false;
            const iframe = youtubePlayer;
            const rect = iframe.getBoundingClientRect();
            const mouseX = e.clientX;
            const mouseY = e.clientY;
            return mouseX >= rect.left && mouseX <= rect.right && mouseY >= rect.top && mouseY <= rect.bottom;
        }
        
        // Функция для обновления контента модального окна
        function updateModalContent() {
            const currentSlide = originalSlides[modalCurrentIndex];
            if (modalImage) modalImage.style.display = 'none';
            if (modalVideo) modalVideo.style.display = 'none';
            if (youtubePlayer) youtubePlayer.src = '';
            
            if (currentSlide.type === 'video') {
                if (modalVideo) modalVideo.style.display = 'block';
                if (youtubePlayer) {
                    youtubePlayer.src = `https://www.youtube.com/embed/${currentSlide.youtubeId}?autoplay=0&modestbranding=1&rel=0&controls=1&showinfo=0`;
                }
            } else {
                if (modalImage) {
                    modalImage.style.display = 'block';
                    modalImage.src = currentSlide.img;
                }
            }
            
            if (modalCounter) {
                modalCounter.textContent = `${modalCurrentIndex + 1} / ${originalSlides.length}`;
            }
        }
        
        // Функции навигации
        function modalNext() {
            if (modalCurrentIndex < originalSlides.length - 1) {
                modalCurrentIndex++;
                updateModalContent();
            } else if (modalCurrentIndex === originalSlides.length - 1) {
                // Бесконечная прокрутка: с последнего на первый
                modalCurrentIndex = 0;
                updateModalContent();
            }
        }
        
        function modalPrev() {
            if (modalCurrentIndex > 0) {
                modalCurrentIndex--;
                updateModalContent();
            } else if (modalCurrentIndex === 0) {
                // Бесконечная прокрутка: с первого на последний
                modalCurrentIndex = originalSlides.length - 1;
                updateModalContent();
            }
        }
        
        // Обработчик колесика мыши для модального окна
        function handleModalWheel(e) {
            // Проверяем, находится ли мышь над iframe YouTube
            if (isMouseOverYouTubeIframe(e)) {
                // Если мышь над YouTube iframe - не переключаем слайды
                return;
            }
            
            e.preventDefault();
            
            // Накопление дельты для более плавного скролла
            modalWheelDelta += e.deltaY;
            
            if (modalWheelTimeout) clearTimeout(modalWheelTimeout);
            
            // Порог срабатывания (чувствительность)
            const threshold = 50;
            
            if (modalWheelDelta >= threshold) {
                modalWheelDelta = 0;
                if (!isModalWheelScrolling) {
                    isModalWheelScrolling = true;
                    modalNext();
                    setTimeout(() => {
                        isModalWheelScrolling = false;
                    }, 50);
                }
            } else if (modalWheelDelta <= -threshold) {
                modalWheelDelta = 0;
                if (!isModalWheelScrolling) {
                    isModalWheelScrolling = true;
                    modalPrev();
                    setTimeout(() => {
                        isModalWheelScrolling = false;
                    }, 50);
                }
            }
            
            // Сброс накопленной дельты через некоторое время бездействия
            modalWheelTimeout = setTimeout(() => {
                modalWheelDelta = 0;
            }, 200);
        }
        
        function closeModal() {
            modal.classList.remove('active');
            document.body.classList.remove('modal-open');
            
            // Удаляем обработчик колесика
            if (modal) {
                modal.removeEventListener('wheel', handleModalWheel);
            }
            
            setTimeout(() => {
                modal.style.display = 'none';
                if (youtubePlayer) youtubePlayer.src = '';
                modalWheelDelta = 0;
                isModalWheelScrolling = false;
            }, 300);
        }
        
        modalCurrentIndex = index;
        updateModalContent();
        
        modal.style.display = 'flex';
        setTimeout(() => {
            modal.classList.add('active');
            document.body.classList.add('modal-open');
            
            // Добавляем обработчик колесика мыши
            modal.addEventListener('wheel', handleModalWheel, { passive: false });
        }, 10);
        
        const closeModalBtn = document.getElementById('closeModal');
        const modalPrevBtn = document.getElementById('modalPrev');
        const modalNextBtn = document.getElementById('modalNext');
        
        const closeHandler = () => closeModal();
        const prevHandler = () => modalPrev();
        const nextHandler = () => modalNext();
        
        closeModalBtn.removeEventListener('click', closeHandler);
        modalPrevBtn.removeEventListener('click', prevHandler);
        modalNextBtn.removeEventListener('click', nextHandler);
        
        closeModalBtn.addEventListener('click', closeHandler);
        modalPrevBtn.addEventListener('click', prevHandler);
        modalNextBtn.addEventListener('click', nextHandler);
        
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };
        
        function keyHandler(e) {
            if (!modal.classList.contains('active')) return;
            if (e.key === 'Escape') closeModal();
            if (e.key === 'ArrowRight') modalNext();
            if (e.key === 'ArrowLeft') modalPrev();
        }
        
        document.removeEventListener('keydown', keyHandler);
        document.addEventListener('keydown', keyHandler);
    }
    
    // Инициализация
    function init() {
        buildSlides();
        
        // Устанавливаем начальную позицию (первый реальный слайд, индекс 1)
        setTimeout(() => {
            const slideWidth = track.parentElement.clientWidth;
            const offset = -currentIndex * slideWidth;
            track.style.transform = `translateX(${offset}px)`;
            updateCounter();
        }, 50);
        
        if (prevBtn) prevBtn.addEventListener('click', prevSlide);
        if (nextBtn) nextBtn.addEventListener('click', nextSlide);
        
        window.addEventListener('resize', handleResize);
        
        const carouselContainer = document.querySelector('.carousel-container');
        if (carouselContainer) {
            carouselContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
            carouselContainer.addEventListener('touchend', handleTouchEnd);
        }
    }
    
    init();
})();

// ========== АДМИН ЛИСТ И СКРОЛЛ ==========
const adminList = document.getElementById('adminListBlocks');
const scrollUp = document.getElementById('scrollUp');
const scrollDown = document.getElementById('scrollDown');
const gradientTop = document.getElementById('gradientTop');
const gradientBottom = document.getElementById('gradientBottom');
let scrollInterval;

function startScrolling(direction) {
    scrollInterval = setInterval(() => {
        adminList.scrollBy({ top: direction * 520, behavior: 'smooth' });
        checkScrollEffects();
    }, 30);
}

function stopScrolling() {
    clearInterval(scrollInterval);
}

function checkScrollEffects() {
    if (!adminList) return;
    const scrollTop = adminList.scrollTop;
    const scrollHeight = adminList.scrollHeight;
    const clientHeight = adminList.clientHeight;
    
    if (scrollTop <= 0) {
        if (scrollUp) scrollUp.classList.add('hidden');
        if (gradientTop) gradientTop.classList.add('hidden');
    } else {
        if (scrollUp) scrollUp.classList.remove('hidden');
        if (gradientTop) gradientTop.classList.remove('hidden');
    }
    
    if (scrollTop + clientHeight >= scrollHeight - 1) {
        if (scrollDown) scrollDown.classList.add('hidden');
        if (gradientBottom) gradientBottom.classList.add('hidden');
    } else {
        if (scrollDown) scrollDown.classList.remove('hidden');
        if (gradientBottom) gradientBottom.classList.remove('hidden');
    }
}

if (scrollUp) {
    scrollUp.addEventListener('mousedown', () => startScrolling(-1));
    scrollUp.addEventListener('mouseup', stopScrolling);
    scrollUp.addEventListener('mouseleave', stopScrolling);
}
if (scrollDown) {
    scrollDown.addEventListener('mousedown', () => startScrolling(1));
    scrollDown.addEventListener('mouseup', stopScrolling);
    scrollDown.addEventListener('mouseleave', stopScrolling);
}
if (adminList) {
    adminList.addEventListener('scroll', checkScrollEffects);
}

window.addEventListener('load', () => {
    setTimeout(checkScrollEffects, 500);
});