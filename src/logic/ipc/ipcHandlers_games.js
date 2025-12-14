const { ipcMain } = require('electron');
const { GameCollection } = require('../../state')

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
}

module.exports = setupIpcHandlers_games;