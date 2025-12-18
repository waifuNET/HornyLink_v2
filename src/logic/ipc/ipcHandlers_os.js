const { ipcMain, shell } = require('electron');
const { AppVariables, GameCollection } = require('../../state');
const Games = require('../games/games');
const fs = require('fs');

function setupIpcHandlers_os() {
    ipcMain.handle('get-drive-info', (event) => {
        return AppVariables.driveInfo;
    });

    // Открытие расположения игры в проводнике
    ipcMain.handle('show-game-location', async (event, gameId) => {
        try {
            const installedGame = GameCollection.getInstalledGameById(gameId);
            
            if (!installedGame) {
                throw new Error('Игра не установлена');
            }

            const gameInfo = await Games.gameInstalledInfo(gameId);
            const installPath = gameInfo.installPath;

            if (!fs.existsSync(installPath)) {
                throw new Error('Папка игры не найдена');
            }

            // Открываем папку в проводнике
            shell.openPath(installPath);
            console.log(`[OS] Открыто расположение игры ${gameId}: ${installPath}`);
            
            return { success: true };
        } catch (error) {
            console.error(`[OS] Ошибка открытия расположения игры:`, error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = setupIpcHandlers_os;