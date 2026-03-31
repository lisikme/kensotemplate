// price.js - данные о ценах и функция отображения

// Функция для отображения цен в таблице
function renderPricingTable() {
    const tableBody = document.querySelector('.pricing-table tbody');
    if (!tableBody) return;
    
    // Очищаем существующие строки
    tableBody.innerHTML = '';
    
    // Функция для вычисления старой цены на основе скидки
    function getOriginalPrice(currentPrice, discountPercent) {
        if (!discountPercent || discountPercent === 0) return null;
        // currentPrice - это строка вида "70 Руб" или "400 РУБ"
        const priceMatch = currentPrice.match(/(\d+)/);
        if (!priceMatch) return null;
        const price = parseInt(priceMatch[0]);
        const discountedPrice = Math.round(price * (1 - discountPercent / 100));
        return discountedPrice + ' ' + currentPrice.replace(/\d+/, '').trim();
    }
    
    // Добавляем строки из pricelist, но пропускаем те, у которых item_discount === -1
    pricelist.forEach(item => {
        // Скрываем лот, если скидка равна -1
        if (item.item_discount === -1) {
            return; // пропускаем этот элемент, не добавляем в таблицу
        }
        
        const row = document.createElement('tr');
        row.className = 'price-row';
        
        const priceCell = document.createElement('td');
        priceCell.className = 'price-cell';
        
        const termCell = document.createElement('td');
        termCell.className = 'term-cell';
        
        // Проверяем наличие скидки
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

// Запускаем отображение при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    renderPricingTable();
    updateBuyButton(0);
});















const buyBtn = document.getElementById('buyBtn');
const buyMenu = document.getElementById('buyMenu');

// Открытие/закрытие меню по клику на кнопку
buyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    buyMenu.classList.toggle('active');
});

// Закрытие меню при клике вне его области
document.addEventListener('click', (e) => {
    if (!buyMenu.contains(e.target) && e.target !== buyBtn) {
        buyMenu.classList.remove('active');
    }
});
















document.addEventListener('DOMContentLoaded', function() {
    const toggleBtn = document.getElementById('toggleFeaturesBtn');
    const featuresTable = document.querySelector('.dropdown-wrapper2');
    const btnText = toggleBtn.querySelector('.btn-text');
    const btnIcon = toggleBtn.querySelector('.btn-icon');
    
    if (featuresTable) {
        // featuresTable.classList.add('active');
        featuresTable.classList.remove('active');
    }
    
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            const isHidden = featuresTable.classList.toggle('active');
            
            if (isHidden) {
                toggleBtn.classList.replace('unactive', 'active');
                if (btnIcon) btnIcon.classList.add('rotated');
            } else {
                toggleBtn.classList.replace('active', 'unactive');
                if (btnIcon) btnIcon.classList.remove('rotated');
            }
        });
    }
});

















        const adminList = document.getElementById('adminListBlocks');
        const scrollUp = document.getElementById('scrollUp');
        const scrollDown = document.getElementById('scrollDown');
        const gradientTop = document.getElementById('gradientTop');
        const gradientBottom = document.getElementById('gradientBottom');
        let scrollInterval;
        let currentMediaType = 'image'; 
        const modalVideo = document.getElementById('modalVideo');
        const youtubePlayer = document.getElementById('youtubePlayer');
        
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

        // Функционал для галереи
        const galleryContainer = document.getElementById('galleryContainer');
        const galleryModal = document.getElementById('galleryModal');
        const modalImage = document.getElementById('modalImage');
        const closeModal = document.getElementById('closeModal');
        const modalPrev = document.getElementById('modalPrev');
        const modalNext = document.getElementById('modalNext');
        const modalCounter = document.getElementById('modalCounter');
        
        const galleryScrollLeft = document.getElementById('galleryScrollLeft');
        const galleryScrollRight = document.getElementById('galleryScrollRight');
        const galleryGradientLeft = document.getElementById('galleryGradientLeft');
        const galleryGradientRight = document.getElementById('galleryGradientRight');
        
        const galleryItems = document.querySelectorAll('.gallery-item');
        let currentImageIndex = 0;
        let galleryScrollInterval;
        
        function startGalleryScrolling(direction) {
            galleryScrollInterval = setInterval(() => {
                if (galleryContainer) galleryContainer.scrollBy({ left: direction * 300, behavior: 'smooth' });
                checkGalleryScrollEffects();
            }, 30);
        }
        
        function stopGalleryScrolling() {
            clearInterval(galleryScrollInterval);
        }
        
        function checkGalleryScrollEffects() {
            if (!galleryContainer) return;
            const scrollLeft = galleryContainer.scrollLeft;
            const scrollWidth = galleryContainer.scrollWidth;
            const clientWidth = galleryContainer.clientWidth;
            
            if (scrollLeft <= 0) {
                if (galleryScrollLeft) galleryScrollLeft.classList.add('hidden');
                if (galleryGradientLeft) galleryGradientLeft.classList.add('hidden');
            } else {
                if (galleryScrollLeft) galleryScrollLeft.classList.remove('hidden');
                if (galleryGradientLeft) galleryGradientLeft.classList.remove('hidden');
            }
            
            if (scrollLeft + clientWidth >= scrollWidth - 1) {
                if (galleryScrollRight) galleryScrollRight.classList.add('hidden');
                if (galleryGradientRight) galleryGradientRight.classList.add('hidden');
            } else {
                if (galleryScrollRight) galleryScrollRight.classList.remove('hidden');
                if (galleryGradientRight) galleryGradientRight.classList.remove('hidden');
            }
        }
        
        if (galleryScrollLeft) {
            galleryScrollLeft.addEventListener('mousedown', () => startGalleryScrolling(-1));
            galleryScrollLeft.addEventListener('mouseup', stopGalleryScrolling);
            galleryScrollLeft.addEventListener('mouseleave', stopGalleryScrolling);
        }
        if (galleryScrollRight) {
            galleryScrollRight.addEventListener('mousedown', () => startGalleryScrolling(1));
            galleryScrollRight.addEventListener('mouseup', stopGalleryScrolling);
            galleryScrollRight.addEventListener('mouseleave', stopGalleryScrolling);
        }
        if (galleryContainer) {
            galleryContainer.addEventListener('scroll', checkGalleryScrollEffects);
        }
        
        function preloadImages() {
            galleryItems.forEach(item => {
                const img = item.querySelector('img');
                if (img) {
                    const preloadImg = new Image();
                    preloadImg.src = img.src;
                }
            });
        }
        
        galleryItems.forEach((item, index) => {
            item.addEventListener('click', () => {
                currentImageIndex = index;
                openModal();
            });
        });
        
        function openModal() {
            if (!galleryModal) return;
            const imgSrc = galleryItems[currentImageIndex].querySelector('img').src;
            if (modalImage) modalImage.src = imgSrc;
            updateModalCounter();
            
            galleryModal.style.display = 'flex';
            const currentItem = galleryItems[currentImageIndex];
            const mediaType = currentItem.getAttribute('data-type');
            currentMediaType = mediaType;
            
            setTimeout(() => {
                galleryModal.classList.add('active');
                document.body.classList.add('modal-open');
            }, 10);
            
            if (mediaType === 'video') {
                const youtubeId = currentItem.getAttribute('data-youtube-id');
                const videoUrl = `https://www.youtube.com/embed/${youtubeId}?autoplay=0&modestbranding=1&rel=0&controls=1&showinfo=0`;
                
                if (modalImage) modalImage.style.display = 'none';
                if (modalVideo) modalVideo.style.display = 'block';
                if (youtubePlayer) youtubePlayer.src = videoUrl;
            } else {
                if (modalImage) modalImage.style.display = 'block';
            }
        }

        function closeModalFunc() {
            if (!galleryModal) return;
            galleryModal.classList.remove('active');
            document.body.classList.remove('modal-open');
            
            setTimeout(() => {
                galleryModal.style.display = 'none';
                if (currentMediaType === 'video' && youtubePlayer) {
                    youtubePlayer.src = '';
                }
            }, 300);
        }
                
        function updateModalCounter() {
            if (modalCounter) {
                modalCounter.textContent = `${currentImageIndex + 1} / ${galleryItems.length}`;
            }
        }
        
        function showNextImage(e) {
            if (e) e.stopPropagation();
            currentImageIndex = (currentImageIndex + 1) % galleryItems.length;
            updateModalContent();
        }

        function showPrevImage(e) {
            if (e) e.stopPropagation();
            currentImageIndex = (currentImageIndex - 1 + galleryItems.length) % galleryItems.length;
            updateModalContent();
        }

        function updateModalContent() {
            const currentItem = galleryItems[currentImageIndex];
            const mediaType = currentItem.getAttribute('data-type');
            
            if (modalImage) modalImage.style.display = 'none';
            if (modalVideo) modalVideo.style.display = 'none';
            
            if (mediaType === 'video') {
                const youtubeId = currentItem.getAttribute('data-youtube-id');
                const videoUrl = `https://www.youtube.com/embed/${youtubeId}?autoplay=0&modestbranding=1&rel=0&controls=1&showinfo=0`;
                
                if (modalVideo) modalVideo.style.display = 'block';
                if (youtubePlayer) youtubePlayer.src = videoUrl;
            } else {
                const imgSrc = currentItem.querySelector('img').src;
                if (modalImage) {
                    modalImage.style.display = 'block';
                    modalImage.src = imgSrc;
                }
                if (youtubePlayer) youtubePlayer.src = '';
            }
            
            updateModalCounter();
        }
        
        if (closeModal) closeModal.addEventListener('click', function(e) {
            e.stopPropagation();
            closeModalFunc();
        });
        
        if (modalNext) modalNext.addEventListener('click', showNextImage);
        if (modalPrev) modalPrev.addEventListener('click', showPrevImage);
        
        if (galleryModal) {
            galleryModal.addEventListener('click', (e) => {
                if (e.target === galleryModal) {
                    closeModalFunc();
                }
            });
        }
        
        document.addEventListener('keydown', (e) => {
            if (galleryModal && galleryModal.classList.contains('active')) {
                e.preventDefault();
                e.stopPropagation();
                
                if (e.key === 'Escape') closeModalFunc();
                if (e.key === 'ArrowRight') showNextImage();
                if (e.key === 'ArrowLeft') showPrevImage();
            }
        });
        
        if (galleryModal) {
            galleryModal.addEventListener('wheel', (e) => {
                if (galleryModal.classList.contains('active')) {
                    e.stopPropagation();
                }
            });
        }
        
        if (galleryContainer) {
            galleryContainer.addEventListener('wheel', (e) => {
                if (!galleryModal || !galleryModal.classList.contains('active') && e.deltaY !== 0) {
                    e.preventDefault();
                    galleryContainer.scrollLeft += e.deltaY * 5;
                    checkGalleryScrollEffects();
                }
            });
        }
        
        let isDragging = false;
        let startX;
        let scrollLeft;
        
        if (galleryContainer) {
            galleryContainer.addEventListener('mousedown', (e) => {
                if (galleryModal && galleryModal.classList.contains('active')) return;
                
                isDragging = true;
                galleryContainer.style.cursor = 'grabbing';
                startX = e.pageX - galleryContainer.offsetLeft;
                scrollLeft = galleryContainer.scrollLeft;
            });
            
            galleryContainer.addEventListener('mouseleave', () => {
                isDragging = false;
                galleryContainer.style.cursor = 'grab';
            });
            
            galleryContainer.addEventListener('mouseup', () => {
                isDragging = false;
                galleryContainer.style.cursor = 'grab';
            });
            
            galleryContainer.addEventListener('mousemove', (e) => {
                if (!isDragging || (galleryModal && galleryModal.classList.contains('active'))) return;
                e.preventDefault();
                const x = e.pageX - galleryContainer.offsetLeft;
                const walk = (x - startX) * 2;
                galleryContainer.scrollLeft = scrollLeft - walk;
                checkGalleryScrollEffects();
            });
        }
        
        let touchStartX = 0;
        let touchEndX = 0;
        
        if (galleryContainer) {
            galleryContainer.addEventListener('touchstart', (e) => {
                if (galleryModal && galleryModal.classList.contains('active')) return;
                touchStartX = e.changedTouches[0].screenX;
            });
            
            galleryContainer.addEventListener('touchend', (e) => {
                if (galleryModal && galleryModal.classList.contains('active')) return;
                touchEndX = e.changedTouches[0].screenX;
                handleSwipe();
            });
        }
        
        function handleSwipe() {
            if (!galleryContainer) return;
            if (touchStartX - touchEndX > 50) {
                galleryContainer.scrollBy({ left: 300, behavior: 'smooth' });
            } else if (touchEndX - touchStartX > 50) {
                galleryContainer.scrollBy({ left: -300, behavior: 'smooth' });
            }
            setTimeout(checkGalleryScrollEffects, 100);
        }
        
        window.addEventListener('load', () => {
            preloadImages();
            setTimeout(checkGalleryScrollEffects, 500);
        });
        
        if (modalImage) modalImage.style.transition = 'opacity 0.3s ease';

        let lastWheelTime = 0;
        const WHEEL_DELAY = 50;

        if (galleryModal) {
            galleryModal.addEventListener('wheel', (e) => {
                if (galleryModal.classList.contains('active')) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const currentTime = Date.now();
                    if (currentTime - lastWheelTime < WHEEL_DELAY) {
                        return;
                    }
                    
                    lastWheelTime = currentTime;
                    
                    const isVerticalScroll = Math.abs(e.deltaY) > Math.abs(e.deltaX);
                    
                    if (isVerticalScroll) {
                        if (e.deltaY > 0) {
                            showNextImage();
                        } else if (e.deltaY < 0) {
                            showPrevImage();
                        }
                    } else {
                        if (e.deltaX > 0) {
                            showNextImage();
                        } else if (e.deltaX < 0) {
                            showPrevImage();
                        }
                    }
                }
            });
        }

        const modalContent = document.getElementById('modalContent');
        let touchStartXModal = 0;
        let touchEndXModal = 0;
        let touchStartYModal = 0;
        let touchEndYModal = 0;
        const MIN_SWIPE_DISTANCE = 50;

        if (modalContent) {
            modalContent.addEventListener('touchstart', (e) => {
                if (galleryModal && galleryModal.classList.contains('active')) {
                    touchStartXModal = e.changedTouches[0].screenX;
                    touchStartYModal = e.changedTouches[0].screenY;
                }
            }, { passive: true });

            modalContent.addEventListener('touchend', (e) => {
                if (galleryModal && galleryModal.classList.contains('active')) {
                    touchEndXModal = e.changedTouches[0].screenX;
                    touchEndYModal = e.changedTouches[0].screenY;
                    handleModalSwipe();
                }
            }, { passive: true });
        }

        function handleModalSwipe() {
            const deltaX = touchStartXModal - touchEndXModal;
            const deltaY = touchStartYModal - touchEndYModal;

            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > MIN_SWIPE_DISTANCE) {
                if (deltaX > 0) {
                    showNextImage();
                } else {
                    showPrevImage();
                }
            }
        }

        if (modalContent) {
            modalContent.addEventListener('touchmove', (e) => {
                if (galleryModal && galleryModal.classList.contains('active')) {
                    e.preventDefault();
                }
            }, { passive: false });
        }