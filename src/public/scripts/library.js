// Состояние приложения
const state = {
    games: [],
    currentGameId: null,
    searchTerm: '',
    activeTab: 'activity',
    screenshots: [],
    logo: '',
};
// Группировка игр по периодам
function groupGamesByPeriod(games) {
    const now = new Date();
    const groups = {};
    // Создаем группу "Недавнее" (30 дней)
    const recentGames = [];
    
    // Создаем группы для месяцев и годов
    const monthGroups = {};
    const yearGroups = {};
    const noDataGames = [];
    games.forEach(game => {
        if (!game.lastPlayDate) {
            noDataGames.push(game);
            return;
        }
        const playDate = new Date(game.lastPlayDate);
        const daysDiff = Math.floor((now - playDate) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 30) {
            recentGames.push(game);
        } else {
            const monthKey = `${playDate.getFullYear()}-${playDate.getMonth()}`;
            const monthName = `${getMonthName(playDate.getMonth())} ${playDate.getFullYear()}`;
            
            if (!monthGroups[monthKey]) {
                monthGroups[monthKey] = {
                    title: monthName,
                    games: [],
                    date: playDate
                };
            }
            monthGroups[monthKey].games.push(game);
        }
    });
    // Добавляем группы в правильном порядке
    if (recentGames.length > 0) {
        groups['recent'] = { title: 'Недавнее', games: recentGames };
    }
    // Сортируем месяцы по дате (новые первыми)
    const sortedMonths = Object.entries(monthGroups)
        .sort((a, b) => b[1].date - a[1].date);
    sortedMonths.forEach(([key, group]) => {
        groups[key] = { title: group.title, games: group.games };
    });
    // Добавляем игры без данных в конце
    if (noDataGames.length > 0) {
        groups['no-data'] = { title: 'Нет данных', games: noDataGames };
    }
    return groups;
}
function getMonthName(monthIndex) {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return months[monthIndex];
}
// Создание элемента игры
async function createGameElement(game) {
    const div = document.createElement('div');
    div.className = 'game-item';
    div.dataset.gameId = game.id;
    
    // Создаем placeholder для изображения
    div.innerHTML = `
        <img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23333%22 width=%22100%22 height=%22100%22/%3E%3C/svg%3E" alt="${game.title}" class="game-icon">
        <span class="game-name">${game.title}</span>
    `;
    
    div.addEventListener('click', () => selectGame(game.id));
    
    // Асинхронно загружаем лого
    loadGameIcon(div, game.id);
    
    return div;
}
// Загрузка иконки игры
async function loadGameIcon(element, gameId) {
    try {
        const logoUrl = await window.electronAPI.games.getGameLogo(gameId);
        const img = element.querySelector('.game-icon');
        if (img && logoUrl) {
            img.src = logoUrl;
            img.onerror = () => {
                img.src = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23333%22 width=%22100%22 height=%22100%22/%3E%3C/svg%3E";
            };
        }
    } catch (error) {
        console.error('Ошибка загрузки лого:', error);
    }
}
// Обновление списка игр без полной перерисовки
async function updateGamesList(games) {
    const container = document.getElementById('games-list');
    const groups = groupGamesByPeriod(games);
    
    // Удаляем сообщение "Загрузка игр..." если оно есть
    const loadingMsg = container.querySelector('.loading');
    if (loadingMsg) {
        loadingMsg.remove();
    }
    
    // Фильтрация по поиску
    const filteredGames = state.searchTerm 
        ? games.filter(g => g.title.toLowerCase().includes(state.searchTerm.toLowerCase()))
        : games;
    // Получаем все существующие секции
    const existingSections = Array.from(container.querySelectorAll('.game-section'));
    const processedGroups = new Set();
    for (const [key, group] of Object.entries(groups)) {
        if (group.games.length === 0) continue;
        processedGroups.add(key);
        let section = container.querySelector(`[data-group="${key}"]`);
        
        if (!section) {
            // Создаем новую секцию
            section = document.createElement('div');
            section.className = 'game-section';
            section.dataset.group = key;
            section.innerHTML = `<div class="section-header">${group.title} (${group.games.length})</div>`;
            
            // Вставляем в правильное место (по порядку групп)
            const groupKeys = Object.keys(groups);
            const currentIndex = groupKeys.indexOf(key);
            let inserted = false;
            
            for (let i = currentIndex + 1; i < groupKeys.length; i++) {
                const nextSection = container.querySelector(`[data-group="${groupKeys[i]}"]`);
                if (nextSection) {
                    container.insertBefore(section, nextSection);
                    inserted = true;
                    break;
                }
            }
            
            if (!inserted) {
                container.appendChild(section);
            }
        }
        // Обновляем заголовок с количеством
        const header = section.querySelector('.section-header');
        const visibleGames = group.games.filter(g => 
            !state.searchTerm || g.title.toLowerCase().includes(state.searchTerm.toLowerCase())
        );
        header.textContent = `${group.title} (${visibleGames.length})`;
        // Получаем существующие элементы игр в секции
        const existingGameElements = Array.from(section.querySelectorAll('.game-item'));
        const existingGameIds = new Set(existingGameElements.map(el => el.dataset.gameId));
        // Обновляем/добавляем игры в секции
        for (let index = 0; index < group.games.length; index++) {
            const game = group.games[index];
            let gameElement = section.querySelector(`[data-game-id="${game.id}"]`);
            
            if (!gameElement) {
                // Создаем новый элемент (теперь это промис, поэтому await)
                gameElement = await createGameElement(game);
                
                // Вставляем в правильную позицию
                const nextGameElement = existingGameElements[index];
                if (nextGameElement) {
                    section.insertBefore(gameElement, nextGameElement);
                } else {
                    section.appendChild(gameElement);
                }
                
                // Анимация появления
                gameElement.style.opacity = '0';
                setTimeout(() => {
                    gameElement.style.transition = 'opacity 0.3s ease';
                    gameElement.style.opacity = '1';
                }, 10);
            } else {
                // Перемещаем существующий элемент если нужно
                const currentPosition = Array.from(section.children).indexOf(gameElement);
                const targetPosition = index + 1; // +1 из-за заголовка секции
                
                if (currentPosition !== targetPosition) {
                    const nextElement = section.children[targetPosition];
                    if (nextElement && nextElement !== gameElement) {
                        section.insertBefore(gameElement, nextElement);
                    }
                }
            }
            // Показываем/скрываем по поиску
            const isVisible = !state.searchTerm || 
                game.title.toLowerCase().includes(state.searchTerm.toLowerCase());
            gameElement.style.display = isVisible ? 'flex' : 'none';
        }
        // Удаляем элементы игр, которых больше нет в группе
        existingGameElements.forEach(el => {
            const gameId = el.dataset.gameId;
            if (!group.games.find(g => g.id == gameId)) {
                el.style.transition = 'opacity 0.3s ease';
                el.style.opacity = '0';
                setTimeout(() => el.remove(), 300);
            }
        });
        // Скрываем секцию если нет видимых игр
        section.style.display = visibleGames.length > 0 ? 'block' : 'none';
    }
    // Удаляем секции, которых больше нет
    existingSections.forEach(section => {
        const groupKey = section.dataset.group;
        if (!processedGroups.has(groupKey)) {
            section.style.transition = 'opacity 0.3s ease';
            section.style.opacity = '0';
            setTimeout(() => section.remove(), 300);
        }
    });
}
// Выбор игры
async function selectGame(gameId) {
    if (state.currentGameId === gameId) return;
    state.currentGameId = gameId;
    
    // Обновляем активный класс
    document.querySelectorAll('.game-item').forEach(item => {
        item.classList.toggle('active', item.dataset.gameId == gameId);
    });
    // Загружаем данные игры
    const game = state.games.find(g => g.id === gameId);
    if (!game) return;
    // Обновляем заголовок и фон
    const gameHeader = document.getElementById('game-header');
    const gameTitle = document.getElementById('game-title');
    
    gameTitle.textContent = game.title;
    
    // Загружаем скриншоты асинхронно
    try {
        const screenshots = await window.electronAPI.games.getGameScreenshots(game.id);
        const logoURL = await window.electronAPI.games.getGameLogo(game.id);
        state.screenshots = screenshots || [];
        state.logo = logoURL || '';
        
        // Используем первый скриншот как фон
        if (logoURL) {
            gameHeader.style.backgroundImage = `url('${logoURL}')`;
        } else {
            gameHeader.style.backgroundImage = '';
        }
        
        // Если открыта вкладка со скриншотами, обновляем их
        if (state.activeTab === 'screenshots') {
            loadScreenshots();
        }
    } catch (error) {
        console.error('Ошибка загрузки скриншотов:', error);
        state.screenshots = [];
    }
    // Обновляем информацию
    document.getElementById('cloud-status').textContent = game.isInstalled ? 'Синхронизированы' : 'Не установлена';
    document.getElementById('last-play').textContent = game.lastPlayDate 
        ? formatDate(game.lastPlayDate) 
        : 'Никогда';
    document.getElementById('playtime').textContent = game.playtime 
        ? `${game.playtime} ч.` 
        : '0 ч.';
    // Активируем кнопку играть
    const playButton = document.getElementById('btn-play');
    playButton.disabled = !game.isInstalled;
    playButton.textContent = game.isInstalled ? '▶ ИГРАТЬ' : '📥 УСТАНОВИТЬ';
}
// Форматирование даты
function formatDate(dateString) {
    if (!dateString) return 'Никогда';
    const date = new Date(dateString);
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 
                  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${date.getDate()} ${months[date.getMonth()]}.`;
}
// Загрузка скриншотов
function loadScreenshots() {
    const grid = document.getElementById('screenshots-grid');
    
    if (state.screenshots.length === 0) {
        grid.innerHTML = '<div class="loading">Нет скриншотов</div>';
        return;
    }
    grid.innerHTML = state.screenshots.map(url => `
        <div class="screenshot-item">
            <img src="${url}" alt="Screenshot" loading="lazy">
        </div>
    `).join('');
}
// Переключение табов
function switchTab(tabName) {
    state.activeTab = tabName;
    // Обновляем активный таб
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    // Показываем нужный контент
    document.getElementById('activity-content').style.display = 
        tabName === 'activity' ? 'block' : 'none';
    document.getElementById('screenshots-content').style.display = 
        tabName === 'screenshots' ? 'block' : 'none';
    if (tabName === 'screenshots') {
        loadScreenshots();
    }
}
// Поиск
const searchInput = document.getElementById('lib-search');
searchInput.addEventListener('input', (e) => {
    state.searchTerm = e.target.value;
    updateGamesList(state.games);
});
// Обработчики табов
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        switchTab(tab.dataset.tab);
    });
});
// Кнопка играть
document.getElementById('btn-play').addEventListener('click', async () => {
    if (!state.currentGameId) return;
    
    const game = state.games.find(g => g.id === state.currentGameId);
    if (!game || !game.isInstalled) return;
    // Здесь будет вызов запуска игры
    console.log('Запуск игры:', game.title);
    
    // Обновляем lastPlayDate
    game.lastPlayDate = new Date().toISOString();
    
    // Плавно перемещаем игру в "Недавнее" без полной перерисовки
    const gameElement = document.querySelector(`[data-game-id="${game.id}"]`);
    if (gameElement) {
        gameElement.classList.add('moving');
        setTimeout(() => {
            updateGamesList(state.games);
            gameElement.classList.remove('moving');
        }, 200);
    }
});
// Инициализация - загрузка игр
async function init() {
    // Показываем сообщение загрузки
    const container = document.getElementById('games-list');
    container.innerHTML = '<div class="loading">Загрузка игр...</div>';
    try {
        const games = await window.electronAPI.games.getAllGames();
        
        if (!games || games.length === 0) {
            container.innerHTML = '<div class="loading">Игры не найдены</div>';
            return;
        }
        state.games = games.sort((a, b) => {
            const dateA = a.lastPlayDate ? new Date(a.lastPlayDate) : new Date(0);
            const dateB = b.lastPlayDate ? new Date(b.lastPlayDate) : new Date(0);
            return dateB - dateA;
        });
        await updateGamesList(state.games);
        // Выбираем первую игру по умолчанию
        if (state.games.length > 0) {
            selectGame(state.games[0].id);
        }
        // Начинаем периодическую проверку новых игр
        startGameWatcher();
    } catch (error) {
        console.error('Ошибка загрузки игр:', error);
        container.innerHTML = '<div class="loading">Ошибка загрузки игр</div>';
    }
}
// Наблюдатель за новыми играми
let watcherInterval = null;

function startGameWatcher() {
    // Проверяем каждые 5 секунд
    watcherInterval = setInterval(async () => {
        try {
            const games = await window.electronAPI.games.getAllGames();
            
            if (!games) return;
            // Проверяем, есть ли новые игры
            const newGames = games.filter(game => 
                !state.games.find(g => g.id === game.id)
            );
            // Проверяем, были ли обновления в существующих играх
            const updatedGames = games.filter(game => {
                const existingGame = state.games.find(g => g.id === game.id);
                if (!existingGame) return false;
                
                return existingGame.lastPlayDate !== game.lastPlayDate ||
                       existingGame.playtime !== game.playtime ||
                       existingGame.isInstalled !== game.isInstalled;
            });
            if (newGames.length > 0 || updatedGames.length > 0) {
                // Обновляем состояние
                state.games = games.sort((a, b) => {
                    const dateA = a.lastPlayDate ? new Date(a.lastPlayDate) : new Date(0);
                    const dateB = b.lastPlayDate ? new Date(b.lastPlayDate) : new Date(0);
                    return dateB - dateA;
                });
                // Плавно обновляем UI
                await updateGamesList(state.games);
                // Если текущая игра была обновлена, обновляем её информацию
                if (state.currentGameId && updatedGames.find(g => g.id === state.currentGameId)) {
                    await selectGame(state.currentGameId);
                }
                console.log(`Обнаружено изменений: ${newGames.length} новых, ${updatedGames.length} обновленных`);
            }
        } catch (error) {
            console.error('Ошибка проверки игр:', error);
        }
    }, 5000);
}
// Останавливаем наблюдатель при закрытии страницы
window.addEventListener('beforeunload', () => {
    if (watcherInterval) {
        clearInterval(watcherInterval);
    }
});
// Запуск при загрузке страницы
init();