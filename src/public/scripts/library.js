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
    isOnline: true,
    isSyncing: false
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
async function loadComments() {
    const commentsList = document.getElementById('comments-list');
    
    if (state.comments.length === 0) {
        commentsList.innerHTML = '<div class="loading">Нет комментариев</div>';
        return;
    }
    
    // Получаем ID текущего пользователя
    let currentUserId = null;
    try {
        const userInfo = await window.electronAPI.auth.getCurrentUser();
        currentUserId = userInfo?.id || null;
    } catch (error) {
        console.warn('Не удалось получить ID пользователя:', error);
    }
    
    const sortedComments = [...state.comments].sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
    );
    const commentsHtml = sortedComments.map(comment => {
        const date = formatCommentDate(comment.created_at);
        const isOwnComment = currentUserId && comment.user_id === currentUserId;
        const deleteButton = isOwnComment ? `<div class="comment-action comment-delete" data-comment-id="${comment.id}">🗑️ Удалить</div>` : '';
        
        // Определяем класс роли (role может быть строкой типа "user" или "manager premium")
        const roleClass = getUserRoleClass(comment.role);
        
        // Используем avatar если есть, иначе дефолтный
        const avatarUrl = comment.avatar || comment.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%2220%22 fill=%22%23444%22/%3E%3C/svg%3E';
        
        // Используем username или author_username
        const username = comment.username || comment.author_username || 'Аноним';
        
        return `
            <div class="comment" data-comment-id="${comment.id}">
                <div class="comment-header">
                    <img src="${avatarUrl}" alt="Avatar" class="comment-avatar" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%2220%22 fill=%22%23444%22/%3E%3C/svg%3E'">
                    <div class="comment-author">
                        <div class="author-name ${roleClass}">${username}</div>
                        <div class="comment-date">${date}</div>
                    </div>
                </div>
                <div class="comment-text">${comment.content}</div>
                <div class="comment-actions">
                    <div class="comment-action">👍 0</div>
                    <div class="comment-action">💬 Ответить</div>
                    <div class="comment-action">⚠ Пожаловаться</div>
                    ${deleteButton}
                </div>
            </div>
        `;
    }).join('');
    
    commentsList.innerHTML = commentsHtml;
    
    // Добавляем обработчики для кнопок удаления
    document.querySelectorAll('.comment-delete').forEach(btn => {
        btn.addEventListener('click', handleDeleteComment);
    });
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

// ============ Обработчики комментариев ============

// Счётчик символов в комментарии
const commentInput = document.getElementById('comment-input');
const charCount = document.getElementById('char-count');
const submitButton = document.getElementById('btn-submit-comment');
const charCounter = document.querySelector('.char-counter');

commentInput.addEventListener('input', () => {
    const length = commentInput.value.length;
    charCount.textContent = length;
    
    // Обновление стилей счётчика
    charCounter.classList.remove('warning', 'limit');
    if (length > 230) {
        charCounter.classList.add('warning');
    }
    if (length > 250) {
        charCounter.classList.add('limit');
    }
    
    // Активация кнопки отправки
    submitButton.disabled = length === 0 || length > 256;
});

// Отправка комментария
submitButton.addEventListener('click', async () => {
    const content = commentInput.value.trim();
    if (!content || !state.currentGameId) return;
    
    try {
        submitButton.disabled = true;
        submitButton.textContent = 'Отправка...';
        
        const result = await window.electronAPI.games.addComment(state.currentGameId, content);
        
        if (result.success) {
            // Очистка формы
            commentInput.value = '';
            charCount.textContent = '0';
            charCounter.classList.remove('warning', 'limit');
            
            // Перезагрузка комментариев
            const comments = await window.electronAPI.games.getGameComments(state.currentGameId);
            state.comments = comments || [];
            loadComments();
        } else {
            alert('Ошибка при отправке комментария: ' + (result.error || 'Неизвестная ошибка'));
        }
    } catch (error) {
        console.error('Ошибка отправки комментария:', error);
        alert('Не удалось отправить комментарий');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Отправить';
    }
});

// ============ Удаление комментария ============

async function handleDeleteComment(event) {
    const commentId = parseInt(event.currentTarget.dataset.commentId);
    
    if (!commentId) return;
    
    // Показываем диалог подтверждения
    showConfirmDialog(
        'Удалить комментарий?',
        'Вы действительно хотите удалить этот комментарий? Это действие нельзя отменить.',
        async () => {
            try {
                const result = await window.electronAPI.games.deleteComment(commentId);
                
                if (result.success) {
                    // Удаляем комментарий из состояния
                    state.comments = state.comments.filter(c => c.id !== commentId);
                    
                    // Перезагружаем список комментариев
                    await loadComments();
                    
                    console.log(`Комментарий ${commentId} успешно удалён`);
                } else {
                    alert('Ошибка при удалении комментария: ' + (result.error || 'Неизвестная ошибка'));
                }
            } catch (error) {
                console.error('Ошибка удаления комментария:', error);
                alert('Не удалось удалить комментарий');
            }
        }
    );
}

// ============ Обработчики btn-more ============

const btnMore = document.getElementById('btn-more');
const dropdown = document.getElementById('btn-more-dropdown');

// Переключение выпадающего списка
btnMore.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
});

// Закрытие при клике вне списка
document.addEventListener('click', (e) => {
    if (!btnMore.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

// Показать расположение игры
document.getElementById('show-location').addEventListener('click', async () => {
    dropdown.style.display = 'none';
    
    if (!state.currentGameId) return;
    
    try {
        await window.electronAPI.os.showGameLocation(state.currentGameId);
    } catch (error) {
        console.error('Ошибка при открытии расположения:', error);
        alert('Не удалось открыть расположение игры');
    }
});

// Удалить игру
document.getElementById('delete-game').addEventListener('click', () => {
    dropdown.style.display = 'none';
    
    if (!state.currentGameId) return;
    
    const game = state.games.find(g => g.id === state.currentGameId);
    if (!game) return;
    
    showConfirmDialog(
        'Удалить игру?',
        `Вы действительно хотите удалить "${game.title}"? Это действие нельзя отменить.`,
        async () => {
            try {
                const result = await window.electronAPI.games.deleteGame(state.currentGameId);
                
                if (result.success) {
                    // Обновляем список игр
                    await updateInfo();
                    
                    // Выбираем первую игру или очищаем
                    if (state.games.length > 0) {
                        selectGame(state.games[0].id);
                    } else {
                        state.currentGameId = null;
                    }
                } else {
                    alert('Ошибка при удалении игры: ' + (result.error || 'Неизвестная ошибка'));
                }
            } catch (error) {
                console.error('Ошибка удаления игры:', error);
                alert('Не удалось удалить игру');
            }
        }
    );
});

// ============ Диалог подтверждения ============

function showConfirmDialog(title, message, onConfirm) {
    // Удаляем существующий диалог если есть
    const existing = document.getElementById('confirm-dialog');
    if (existing) existing.remove();
    
    const dialog = document.createElement('div');
    dialog.id = 'confirm-dialog';
    dialog.className = 'confirm-dialog-overlay';
    
    dialog.innerHTML = `
        <div class="confirm-dialog">
            <div class="confirm-dialog-title">${title}</div>
            <div class="confirm-dialog-message">${message}</div>
            <div class="confirm-dialog-actions">
                <button class="btn-confirm-cancel" id="confirm-cancel">Отмена</button>
                <button class="btn-confirm-delete" id="confirm-delete">Удалить</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Обработчики
    document.getElementById('confirm-cancel').addEventListener('click', () => {
        closeConfirmDialog();
    });
    
    document.getElementById('confirm-delete').addEventListener('click', () => {
        closeConfirmDialog();
        if (onConfirm) onConfirm();
    });
    
    // Закрытие по клику на overlay
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            closeConfirmDialog();
        }
    });
}

function closeConfirmDialog() {
    const dialog = document.getElementById('confirm-dialog');
    if (dialog) {
        dialog.style.opacity = '0';
        setTimeout(() => dialog.remove(), 200);
    }
}

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

// Обновление UI при изменении онлайн статуса
function updateOnlineStatusUI() {
    const offlineIndicator = document.getElementById('offline-indicator');
    const syncButton = document.getElementById('sync-button');
    
    if (!state.isOnline) {
        // Показываем индикатор офлайн режима
        if (!offlineIndicator) {
            const indicator = document.createElement('div');
            indicator.id = 'offline-indicator';
            indicator.className = 'offline-indicator';
            indicator.innerHTML = '🔴 Офлайн режим';
            document.body.appendChild(indicator);
        }
        if (syncButton) syncButton.disabled = true;
    } else {
        // Скрываем индикатор
        if (offlineIndicator) {
            offlineIndicator.remove();
        }
        if (syncButton) syncButton.disabled = false;
    }
}

// Функция синхронизации с сервером
async function syncWithServer() {
    if (state.isSyncing || !state.isOnline) return;
    
    state.isSyncing = true;
    console.log('[Library] Начата синхронизация с сервером...');
    
    try {
        const result = await window.electronAPI.games.syncGames();
        
        if (result.success) {
            await InitGamesState(true);
            console.log(`[Library] Синхронизация завершена. Игр: ${result.gamesCount}`);
        } else {
            console.warn('[Library] Ошибка синхронизации:', result.error);
        }
    } catch (error) {
        console.error('[Library] Ошибка синхронизации:', error);
    } finally {
        state.isSyncing = false;
    }
}

// Event subscribers //
window.electronAPI.games.universalEvent(async (value) => {
    switch(value.event){
        case "gameInstalled":
            await updateInfo();
            break;
            
        case "gameLaunched":
            console.log(`[Library] Игра запущена: ${value.gameTitle}`);
            if (state.currentGameId === value.gameId) {
                await mainButtonsController(value.gameId);
            }
            break;
            
        case "gameLaunchFailed":
            console.error(`[Library] Ошибка запуска игры: ${value.error}`);
            alert(`Не удалось запустить игру: ${value.error}`);
            break;
            
        case "onlineStatusChanged":
            state.isOnline = value.isOnline;
            updateOnlineStatusUI();
            
            if (value.isOnline) {
                // Интернет вернулся - синхронизируем
                console.log('[Library] Интернет восстановлен, синхронизация...');
                await syncWithServer();
            }
            break;
    }
});

async function InitGamesState(stayOnOpenGame = false){
    const container = document.getElementById('games-list');
    
    // Проверяем онлайн статус
    try {
        const onlineStatus = await window.electronAPI.games.getOnlineStatus();
        state.isOnline = onlineStatus.isOnline;
        updateOnlineStatusUI();
    } catch (e) {
        console.warn('[Library] Не удалось получить статус онлайн:', e);
    }
    
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
        startDownloadProgressWatcher();
    } catch (error) {
        console.error('Ошибка загрузки игр:', error);
        container.innerHTML = '<div class="loading">Ошибка загрузки игр</div>';
    }
}

// Наблюдатель за прогрессом загрузки
let downloadWatcherInterval = null;

function startDownloadProgressWatcher() {
    downloadWatcherInterval = setInterval(async () => {
        try {
            const progress = await window.electronAPI.games.getCurrentDownloadProgress();
            
            if (progress.downloadStatus && progress.gameId) {
                // Обновляем UI прогресса загрузки
                updateDownloadProgressUI(progress);
            }
        } catch (error) {
            // Игнорируем ошибки
        }
    }, 1000);
}

function updateDownloadProgressUI(progress) {
    const progressBar = document.getElementById('download-progress-bar');
    const progressText = document.getElementById('download-progress-text');
    
    if (progressBar) {
        progressBar.style.width = `${progress.progress}%`;
    }
    if (progressText) {
        progressText.textContent = `${progress.gameTitle}: ${progress.progress}%`;
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
                    await selectGame(state.currentGameId, true);
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
    if (downloadWatcherInterval) {
        clearInterval(downloadWatcherInterval);
    }
});

// ============ Функция для определения роли пользователя ============

/**
 * Определяет CSS класс роли пользователя
 * @param {string} roleString - Строка с ролями через пробел (например: "user", "manager premium", "administrator")
 * @returns {string} - CSS класс роли или пустая строка
 */
function getUserRoleClass(roleString) {
    if (!roleString || typeof roleString !== 'string') return '';
    
    // Приводим к lowercase для корректного сравнения
    const roles = roleString.toLowerCase();
    
    // Иерархия ролей (от высшей к низшей)
    if (roles.includes('administrator')) return 'role-administrator';
    if (roles.includes('manager')) return 'role-manager';
    if (roles.includes('moderator')) return 'role-moderator';
    if (roles.includes('premium')) return 'role-premium';
    
    return '';
}

init();