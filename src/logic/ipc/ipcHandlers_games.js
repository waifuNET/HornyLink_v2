const { ipcMain } = require('electron');
const { GameCollection } = require('../../state')
const Games = require('../games/games')

function setupIpcHandlers_games() {
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
        return GameCollection.getGameSize(gameId);
    });
}

module.exports = setupIpcHandlers_games;