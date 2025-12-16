// Состояние приложения
const state = {
    games: [],
    currentGameId: null,
    currentGameSize: "Загрузка...",
    searchTerm: '',
    activeTab: 'activity',
    screenshots: [],
    logo: '',
    comments: [],
    availableDrives: [],
};

// Группировка игр по периодам
function groupGamesByPeriod(games) {
    const now = new Date();
    const groups = {};
    const recentGames = [];
    const monthGroups = {};
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
    
    if (recentGames.length > 0) {
        groups['recent'] = { title: 'Недавнее', games: recentGames };
    }
    
    const sortedMonths = Object.entries(monthGroups)
        .sort((a, b) => b[1].date - a[1].date);
    sortedMonths.forEach(([key, group]) => {
        groups[key] = { title: group.title, games: group.games };
    });
    
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
    
    div.innerHTML = `
        <img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23333%22 width=%22100%22 height=%22100%22/%3E%3C/svg%3E" alt="${game.title}" class="game-icon">
        <span class="game-name">${game.title}</span>
    `;
    
    div.addEventListener('click', () => selectGame(game.id));
    loadGameIcon(div, game.id);
    
    return div;
}

// Загрузка иконки игры
async function loadGameIcon(element, gameId) {
    try {
        if (!window.electronAPI || !window.electronAPI.games) return;
        
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
    
    const loadingMsg = container.querySelector('.loading');
    if (loadingMsg) {
        loadingMsg.remove();
    }
    
    const filteredGames = state.searchTerm 
        ? games.filter(g => g.title.toLowerCase().includes(state.searchTerm.toLowerCase()))
        : games;
    
    const existingSections = Array.from(container.querySelectorAll('.game-section'));
    const processedGroups = new Set();
    
    for (const [key, group] of Object.entries(groups)) {
        if (group.games.length === 0) continue;
        processedGroups.add(key);
        let section = container.querySelector(`[data-group="${key}"]`);
        
        if (!section) {
            section = document.createElement('div');
            section.className = 'game-section';
            section.dataset.group = key;
            section.innerHTML = `<div class="section-header">${group.title} (${group.games.length})</div>`;
            
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
        
        const header = section.querySelector('.section-header');
        const visibleGames = group.games.filter(g => 
            !state.searchTerm || g.title.toLowerCase().includes(state.searchTerm.toLowerCase())
        );
        header.textContent = `${group.title} (${visibleGames.length})`;
        
        const existingGameElements = Array.from(section.querySelectorAll('.game-item'));
        
        for (let index = 0; index < group.games.length; index++) {
            const game = group.games[index];
            let gameElement = section.querySelector(`[data-game-id="${game.id}"]`);
            
            if (!gameElement) {
                gameElement = await createGameElement(game);
                
                const nextGameElement = existingGameElements[index];
                if (nextGameElement) {
                    section.insertBefore(gameElement, nextGameElement);
                } else {
                    section.appendChild(gameElement);
                }
                
                gameElement.style.opacity = '0';
                setTimeout(() => {
                    gameElement.style.transition = 'opacity 0.3s ease';
                    gameElement.style.opacity = '1';
                }, 10);
            } else {
                const currentPosition = Array.from(section.children).indexOf(gameElement);
                const targetPosition = index + 1;
                
                if (currentPosition !== targetPosition) {
                    const nextElement = section.children[targetPosition];
                    if (nextElement && nextElement !== gameElement) {
                        section.insertBefore(gameElement, nextElement);
                    }
                }
            }
            
            const isVisible = !state.searchTerm || 
                game.title.toLowerCase().includes(state.searchTerm.toLowerCase());
            gameElement.style.display = isVisible ? 'flex' : 'none';
        }
        
        existingGameElements.forEach(el => {
            const gameId = el.dataset.gameId;
            if (!group.games.find(g => g.id == gameId)) {
                el.style.transition = 'opacity 0.3s ease';
                el.style.opacity = '0';
                setTimeout(() => el.remove(), 300);
            }
        });
        
        section.style.display = visibleGames.length > 0 ? 'block' : 'none';
    }
    
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
async function selectGame(gameId, forceReonen = false) {
    if (state.currentGameId === gameId && !forceReonen) return;
    state.currentGameId = gameId;
          
    window.electronAPI.games.getFileSize(gameId)
    .then(size => {
        if (state.currentGameId === gameId) {
            state.currentGameSize = size;
            console.log(size)
        }
    })
    .catch(err => {
        console.error('Failed to get file size:', err);
        if (state.currentGameId === gameId) {
            state.currentGameSize = null;
        }
    });
    
    document.querySelectorAll('.game-item').forEach(item => {
        item.classList.toggle('active', item.dataset.gameId == gameId);
    });
    
    const game = state.games.find(g => g.id === gameId);
    if (!game) return;

    console.log(game);
    
    const gameHeader = document.getElementById('game-header');
    const gameTitle = document.getElementById('game-title');
    
    gameTitle.textContent = game.title;

    document.getElementById('cloud-status').textContent = "Не доступны";
    document.getElementById('last-play').textContent = game.lastPlayDate 
        ? formatDate(game.lastPlayDate) 
        : 'Никогда';
    document.getElementById('playtime').textContent = game.playtime 
        ? `${game.playtime} ч.` 
        : '0 ч.';

    await mainButtonsController(gameId);
    
    try {
        const screenshots = await window.electronAPI.games.getGameScreenshots(game.id);
        const logoURL = await window.electronAPI.games.getGameLogo(game.id);
        state.screenshots = screenshots || [];
        state.logo = logoURL || '';
        
        if (logoURL) {
            gameHeader.style.backgroundImage = `url('${logoURL}')`;
        } else {
            gameHeader.style.backgroundImage = '';
        }
        
        if (state.activeTab === 'screenshots') {
            loadScreenshots();
        }
    } catch (error) {
        console.error('Ошибка загрузки скриншотов:', error);
        state.screenshots = [];
    }
    
    try {
        const comments = await window.electronAPI.games.getGameComments(game.id);
        state.comments = comments || [];
        
        if (state.activeTab === 'activity') {
            loadComments();
        }
    } catch (error) {
        console.error('Ошибка загрузки комментариев:', error);
        state.comments = [];
        if (state.activeTab === 'activity') {
            loadComments();
        }
    }
    
}

// Форматирование даты
function formatDate(dateString) {
    if (!dateString) return 'Никогда';
    const date = new Date(dateString);
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 
                  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${date.getDate()} ${months[date.getMonth()]}.`;
}

// Форматирование даты комментария
function formatCommentDate(dateString) {
    if (!dateString) return 'Неизвестно';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMins < 1) return 'Только что';
    if (diffMins < 60) return `${diffMins} мин. назад`;
    if (diffHours < 24) return `${diffHours} ч. назад`;
    if (diffDays < 7) return `${diffDays} дн. назад`;
    
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

// Загрузка комментариев
function loadComments() {
    const container = document.getElementById('activity-content');
    
    if (state.comments.length === 0) {
        container.innerHTML = '<h2>Лента активности</h2><div class="loading">Нет комментариев</div>';
        return;
    }
    
    const sortedComments = [...state.comments].sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
    );
    const commentsHtml = sortedComments.map(comment => {
        const date = formatCommentDate(comment.created_at);
        return `
            <div class="comment" data-comment-id="${comment.id}">
                <div class="comment-header">
                    <img src="${comment.avatar}" alt="Avatar" class="comment-avatar" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%2220%22 fill=%22%23444%22/%3E%3C/svg%3E'">
                    <div class="comment-author">
                        <div class="author-name">${comment.username}</div>
                        <div class="comment-date">${date}</div>
                    </div>
                </div>
                <div class="comment-text">${comment.content}</div>
                <div class="comment-actions">
                    <div class="comment-action">👍 0</div>
                    <div class="comment-action">💬 Ответить</div>
                    <div class="comment-action">⚠ Пожаловаться</div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `<h2>Лента активности</h2>${commentsHtml}`;
}

// Переключение табов
function switchTab(tabName) {
    state.activeTab = tabName;
    
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    
    document.getElementById('activity-content').style.display = 
        tabName === 'activity' ? 'block' : 'none';
    document.getElementById('screenshots-content').style.display = 
        tabName === 'screenshots' ? 'block' : 'none';
    
    if (tabName === 'screenshots') {
        loadScreenshots();
    } else if (tabName === 'activity') {
        loadComments();
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

// ============ Диалог установки ============

async function createInstallDialog(game) {
    // Удаляем существующий диалог если есть
    const existing = document.getElementById('install-dialog');
    if (existing) existing.remove();
    
    const dialog = document.createElement('div');
    dialog.id = 'install-dialog';
    dialog.className = 'install-dialog-overlay';
    
    dialog.innerHTML = `
        <div class="install-dialog">
            <div class="install-dialog-header">
                <h2>Установить</h2>
                <button class="close-dialog" onclick="closeInstallDialog()">✕</button>
            </div>
            
            <div class="install-dialog-body">
                <div class="game-info-preview">
                    <img src="${state.logo || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23333%22 width=%22100%22 height=%22100%22/%3E%3C/svg%3E'}" 
                         alt="${game.title}" class="game-preview-icon">
                    <div class="game-preview-info">
                        <div class="game-preview-title">${game.title}</div>
                        <div class="game-preview-size">${state.currentGameSize?.formatted || "Неизвестно"}</div>
                    </div>
                </div>
                
                <div class="install-options">
                    <label class="install-checkbox">
                        <input type="checkbox" id="create-desktop-shortcut" checked>
                        <span>Создать ярлык на рабочем столе</span>
                    </label>
                    
                    <label class="install-checkbox">
                        <input type="checkbox" id="create-start-menu-shortcut" checked>
                        <span>Создать ярлык в меню «Пуск»</span>
                    </label>
                </div>
                
                <div class="install-location-section">
                    <div class="section-title">УСТАНОВИТЬ НА:</div>
                    <div class="drives-list" id="drives-list">
                        <div class="loading">Загрузка дисков...</div>
                    </div>
                    <div class="space-warning" id="space-warning" style="display: none;">
                        ⚠ НЕДОСТАТОЧНО МЕСТА
                    </div>
                </div>
            </div>
            
            <div class="install-dialog-footer">
                <button class="btn-secondary" onclick="closeInstallDialog()">Отмена</button>
                <button class="btn-primary" id="confirm-install" disabled>Установить</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Загружаем доступные диски
    loadAvailableDrives(game);
    
    // Обработчик кнопки установки
    document.getElementById('confirm-install').addEventListener('click', () => {
        const selectedDrive = document.querySelector('.drive-option.selected');
        if (!selectedDrive) return;
        
        const installParams = {
            gameId: game.id,
            gameTitle: game.title,
            drivePath: selectedDrive.dataset.path,
            driveLetter: selectedDrive.dataset.letter,
            createDesktopShortcut: document.getElementById('create-desktop-shortcut').checked,
            createStartMenuShortcut: document.getElementById('create-start-menu-shortcut').checked
        };
        
        startGameInstallation(installParams);
        
        closeInstallDialog();
    });
}

// Загрузка доступных дисков
async function loadAvailableDrives(game) {
    const drivesList = document.getElementById('drives-list');
    
    try {
        /*
        const drives = [
            { letter: 'D:', path: 'D:\\', label: 'Локальный диск', free: 39.26, type: 'hdd' },
            { letter: 'G:', path: 'G:\\', label: 'HDD 1 TB', free: 141.91, type: 'hdd' },
            { letter: 'H:', path: 'H:\\', label: 'SSD 256', free: 112.77, type: 'ssd' },
            { letter: 'E:', path: 'E:\\', label: 'Локальный диск', free: 180.75, type: 'ssd' }
        ];
        */
        const drives = await window.electronAPI.os.getDriveInfo();
        
        state.availableDrives = drives;
        
        const gameSize = parseFloat(state.currentGameSize?.gb) || Infinity;
        
        drivesList.innerHTML = drives.map(drive => {
            const hasEnoughSpace = drive.free >= gameSize;
            const icon = drive.type === 'ssd' ? '⚡' : drive.type === 'hdd' ? '💾' : '💿';
            const favoriteIcon = drive.isFavorite ? '⭐' : '';
            
            return `
                <div class="drive-option ${!hasEnoughSpace ? 'disabled' : ''} ${drive.isFavorite ? 'selected' : ''}" 
                     data-path="${drive.path}" 
                     data-letter="${drive.letter}"
                     onclick="selectDrive(this, ${hasEnoughSpace})">
                    <div class="drive-icon">${icon}</div>
                    <div class="drive-info">
                        <div class="drive-name">
                            ${favoriteIcon} ${drive.label} (${drive.letter})
                        </div>
                        <div class="drive-space ${!hasEnoughSpace ? 'insufficient' : ''}">
                            ДОСТУПНО ${drive.free.toFixed(2)} ГБ
                        </div>
                    </div>
                    ${!hasEnoughSpace ? '<div class="insufficient-badge">⚠ НЕДОСТАТОЧНО МЕСТА</div>' : ''}
                </div>
            `;
        }).join('');
        
        // Проверяем есть ли хоть один подходящий диск
        const hasValidDrive = drives.some(d => d.free >= gameSize);
        document.getElementById('confirm-install').disabled = !hasValidDrive;
        
        if (!hasValidDrive) {
            document.getElementById('space-warning').style.display = 'flex';
        }
        
    } catch (error) {
        console.error('Ошибка загрузки дисков:', error);
        drivesList.innerHTML = '<div class="loading">Ошибка загрузки дисков</div>';
    }
}

// Выбор диска
window.selectDrive = function(element, hasEnoughSpace) {
    if (!hasEnoughSpace) return;
    
    document.querySelectorAll('.drive-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    element.classList.add('selected');
    document.getElementById('confirm-install').disabled = false;
}

// Закрытие диалога
window.closeInstallDialog = function() {
    const dialog = document.getElementById('install-dialog');
    if (dialog) {
        dialog.style.opacity = '0';
        setTimeout(() => dialog.remove(), 200);
    }
}

async function mainButtonsController(gameId){
    const game = state.games.find(g => g.id === gameId);

    const playButton = document.getElementById('btn-play');
    const moreButton = document.getElementById('btn-more');
    const canselButton = document.getElementById('btn-cansel');
    const pauseButton = document.getElementById('btn-pause');

    if(game.isInstalled){
        playButton.textContent = '► ИГРАТЬ';
        playButton.className = 'btn-play';
        moreButton.style.visibility = 'visible';
    }
    else{
        playButton.textContent = '📥 УСТАНОВИТЬ';
        playButton.className = 'btn-install';
        moreButton.style.visibility = 'hidden';
    }

    const downloadingGame = await window.electronAPI.games.getCurrentDownloadProgress();
    const status = await window.electronAPI.games.status(gameId);

    if(downloadingGame.gameId == gameId){
        playButton.style.display = 'none';

        canselButton.style.display = 'flex';
        pauseButton.style.display = 'flex';
    }
    else{
        playButton.style.display = 'flex';

        canselButton.style.display = 'none';
        pauseButton.style.display = 'none';
    }

    if(downloadingGame.downloadGamePause){
        pauseButton.innerHTML = "▶️ ПРОДОЛЖИТЬ"
    }
    else{
        pauseButton.innerHTML = "⏸️ ПАУЗА"
    }

    if(status.gameIsRunning){
        playButton.style.display = 'flex';
        playButton.innerHTML = "❌ ЗАКРЫТЬ"
        playButton.className = 'btn-pause';
    }
}

// Функция установки игры (пока пустая - для будущей реализации)
function startGameInstallation(params) {
    console.log('Начало установки игры с параметрами:', params);
    window.electronAPI.games.downloadGame(
        params.createDesktopShortcut,
        params.createStartMenuShortcut,
        params.drivePath,
        params.gameId,
        params.gameTitle
    );

    mainButtonsController(params.gameId);
}

// Кнопка играть/установить
document.getElementById('btn-play').addEventListener('click', async () => {
    if (!state.currentGameId) return;

    const game = state.games.find(g => g.id === state.currentGameId);
    if (!game) return;

    // Если игра не установлена - показываем диалог установки
    if (!game.isInstalled) {
        await createInstallDialog(game);
        return;
    }
    
    // Если игра установлена
    const status = await window.electronAPI.games.status(game.id);
    if(status.gameIsRunning){
        await window.electronAPI.games.closeGame(game.id);
        await updateInfo();
        await mainButtonsController(game.id);
        return;
    }

    console.log('Запуск игры:', game.title);
    
    game.lastPlayDate = new Date().toISOString();

    window.electronAPI.games.launchGame(game.id);
    await mainButtonsController(game.id);
    
    const gameElement = document.querySelector(`[data-game-id="${game.id}"]`);
    if (gameElement) {
        gameElement.classList.add('moving');
        setTimeout(() => {
            updateGamesList(state.games);
            gameElement.classList.remove('moving');
        }, 200);
    }
});

// Pause/Resume
document.getElementById('btn-pause').addEventListener('click', async () => {
    if (!state.currentGameId) return;

    const game = state.games.find(g => g.id === state.currentGameId);
    if (!game) return;

    const downloadingGame = await window.electronAPI.games.getCurrentDownloadProgress();
    if(downloadingGame.downloadGamePause){
        await window.electronAPI.games.resumeDownloading();
    }
    else{
        await window.electronAPI.games.pauseDownloading();
    }

    await mainButtonsController(game.id);
});

document.getElementById('btn-cansel').addEventListener('click', async () => {
    if (!state.currentGameId) return;

    const game = state.games.find(g => g.id === state.currentGameId);
    if (!game) return;

    await window.electronAPI.games.canselDownloading(game.id);

    await mainButtonsController(game.id);
});

async function updateInfo(){
    await InitGamesState(true);
        if(state.currentGameId){
            await selectGame(state.currentGameId, true);
        }
}

// Event subscrabers //
window.electronAPI.games.universalEvent(async (value) => {
    switch(value.event){
        case "gameInstalled":
            await updateInfo();
        break;
    }
});

async function InitGamesState(stayOnOpenGame = false){
    let games;
    if (window.electronAPI && window.electronAPI.games) {
        games = await window.electronAPI.games.getAllGames();
    } else {
        games = [];
    }

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

    if (!stayOnOpenGame && state.games.length > 0) {
        selectGame(state.games[0].id);
    }
}

// Инициализация - загрузка игр
async function init() {
    const container = document.getElementById('games-list');
    container.innerHTML = '<div class="loading">Загрузка игр...</div>';
    
    try {
        await InitGamesState();
        startGameWatcher();
    } catch (error) {
        console.error('Ошибка загрузки игр:', error);
        container.innerHTML = '<div class="loading">Ошибка загрузки игр</div>';
    }
}

// Наблюдатель за новыми играми
let watcherInterval = null;

function startGameWatcher() {
    watcherInterval = setInterval(async () => {
        try {
            const games = await window.electronAPI.games.getAllGames();
            
            if (!games) return;
            
            const newGames = games.filter(game => 
                !state.games.find(g => g.id === game.id)
            );
            
            const updatedGames = games.filter(game => {
                const existingGame = state.games.find(g => g.id === game.id);
                if (!existingGame) return false;
                
                return existingGame.lastPlayDate !== game.lastPlayDate ||
                       existingGame.playtime !== game.playtime ||
                       existingGame.isInstalled !== game.isInstalled;
            });
            
            if (newGames.length > 0 || updatedGames.length > 0) {
                state.games = games.sort((a, b) => {
                    const dateA = a.lastPlayDate ? new Date(a.lastPlayDate) : new Date(0);
                    const dateB = b.lastPlayDate ? new Date(b.lastPlayDate) : new Date(0);
                    return dateB - dateA;
                });
                
                await updateGamesList(state.games);
                
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

window.addEventListener('beforeunload', () => {
    if (watcherInterval) {
        clearInterval(watcherInterval);
    }
});

init();