const { ipcMain } = require('electron');
const { GameCollection, AppVariables } = require('../../state')
const Games = require('../games/games')
const gameImagesManager = require('../cache/gameImagesManager');

// Преобразование Windows пути в file:// URL
function pathToFileUrl(filePath) {
    if (!filePath) return null;
    // Заменяем обратные слеши на прямые и добавляем file:///
    const normalizedPath = filePath.replace(/\\/g, '/');
    return `file:///${normalizedPath}`;
}

function setupIpcHandlers_games(win) {
    ipcMain.handle('get-all-games', (event) => {
        // Если офлайн, возвращаем только установленные игры
        if (!AppVariables.isOnline) {
            return GameCollection.getInstalledGames();
        }
        return GameCollection.getAllGames();
    });

    ipcMain.handle('get-game-by-id', (event, id) => {
        return GameCollection.getGameById(id);
    });

    // Получение лого с приоритетом локальных изображений
    ipcMain.handle('get-game-logo', (event, id) => {
        // Сначала проверяем локальные изображения
        const localLogo = gameImagesManager.getLocalLogo(id);
        if (localLogo) {
            // Возвращаем file:// URL для локального файла
            return pathToFileUrl(localLogo);
        }
        
        // Если нет локального - берём из коллекции (онлайн)
        return GameCollection.getGameLogo(id);
    });

    // Получение скриншотов с приоритетом локальных
    ipcMain.handle('get-game-screenshots', (event, id) => {
        // Сначала проверяем локальные изображения
        const localScreenshots = gameImagesManager.getLocalScreenshots(id);
        if (localScreenshots.length > 0) {
            return localScreenshots.map(p => pathToFileUrl(p));
        }
        
        // Если нет локальных - берём из коллекции (онлайн)
        return GameCollection.getGameScreenshots(id);
    });

    // Получение иконки с приоритетом локальных
    ipcMain.handle('get-game-icon', (event, id) => {
        // Сначала проверяем локальные изображения
        const localIcon = gameImagesManager.getLocalIcon(id);
        if (localIcon) {
            return pathToFileUrl(localIcon);
        }
        
        return GameCollection.getGameIcon(id);
    });

    ipcMain.handle('get-game-comments', async (event, gameId) =>{
        // Комментарии доступны только онлайн
        if (!AppVariables.isOnline) {
            return [];
        }
        const comments = await Games.loadComments(gameId);
        return comments;
    });

    ipcMain.handle('get-file-size', async (event, gameId) => {
        // Размер файла доступен только онлайн
        if (!AppVariables.isOnline) {
            return null;
        }
        return await GameCollection.getGameSize(gameId);
    });

    ipcMain.handle('download-game', async (event, createDesktopShortcut, createStartMenuShortcut, drivePath, gameId, gameTitle) => {
        if (!AppVariables.isOnline) {
            throw new Error('Загрузка недоступна в офлайн режиме');
        }
        return Games.downloadAndInstallGame(createDesktopShortcut, createStartMenuShortcut, drivePath, gameId, gameTitle, Games.currentDownloadProgressCallback);
    });

    ipcMain.handle('get-current-download-progress', async (event) =>{
        return {
            progress: Games.globalCurrentDownloadProgress.progress || 0,
            gameId: Games.globalCurrentDownloadProgress.gameId || null,
            gameTitle: GameCollection.getGameById(Games.globalCurrentDownloadProgress.gameId)?.title || null,
            downloadStatus: Games.downloading,
            downloadGamePause: Games.downloadingPause || null,
        }
    });

    ipcMain.handle('pause-downloading-game', async (event, gameId) =>{
        Games.downloadGamePause(gameId);
    });

    ipcMain.handle('cansel-downloading-game', async (event, gameId) =>{
        Games.downloadGameCansel(gameId);
    });

    ipcMain.handle('resume-downloading-game', async (event, gameId) =>{
        Games.downloadGameResume(gameId);
    });

    ipcMain.handle('launch-game', async (event, gameId) =>{
        Games.launchGame(gameId);
    });

    ipcMain.handle('close-game', (event, gameId) => {
        Games.closeGame(gameId);
    });

    ipcMain.handle('status', (event, gameId) => {
        const runningGame = Games.runningGames.get(gameId);
        return { 
            gameIsRunning: !!runningGame 
        }
    });
    
    // Получение статуса онлайн/офлайн
    ipcMain.handle('get-online-status', () => {
        return {
            isOnline: AppVariables.isOnline,
            lastCheck: AppVariables.lastOnlineCheck
        };
    });
    
    // Принудительная синхронизация с сервером
    ipcMain.handle('sync-games', async () => {
        if (!AppVariables.isOnline) {
            return { success: false, error: 'Нет интернет соединения' };
        }
        
        try {
            await Games.updateGames();
            return { success: true, gamesCount: GameCollection.getCount() };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Добавление комментария
    ipcMain.handle('add-comment', async (event, gameId, content) => {
        return await Games.addComment(gameId, content);
    });

    // Удаление комментария
    ipcMain.handle('delete-comment', async (event, commentId) => {
        return await Games.deleteComment(commentId);
    });

    // Удаление игры
    ipcMain.handle('delete-game', async (event, gameId) => {
        return await Games.deleteGame(gameId);
    });
}

module.exports = setupIpcHandlers_games;