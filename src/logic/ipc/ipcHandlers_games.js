const { ipcMain } = require('electron');
const { GameCollection } = require('../../state')
const Games = require('../games/games')

function setupIpcHandlers_games(win) {
    ipcMain.handle('get-all-games', (event) => {
        return GameCollection.getAllGames();
    });

    ipcMain.handle('get-game-by-id', (event, id) => {
        return GameCollection.getGameById(id);
    });

    ipcMain.handle('get-game-logo', (event, id) => {
        return GameCollection.getGameLogo(id);
    });

    ipcMain.handle('get-game-screenshots', (event, id) => {
        return GameCollection.getGameScreenshots(id);
    });

    ipcMain.handle('get-game-icon', (event, id) => {
        return GameCollection.getGameIcon(id);
    });

    ipcMain.handle('get-game-comments', async (event, gameId) =>{
        const comments = await Games.loadComments(gameId);
        return comments;
    });

    ipcMain.handle('get-file-size', async (event, gameId) => {
        return await GameCollection.getGameSize(gameId);
    });

    ipcMain.handle('download-game', async (event, createDesktopShortcut, createStartMenuShortcut, drivePath, gameId, gameTitle) => {
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
}

module.exports = setupIpcHandlers_games;