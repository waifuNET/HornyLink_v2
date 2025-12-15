const { ipcMain } = require('electron');
const { AppVariables } = require('../../state');

function setupIpcHandlers_os() {
    ipcMain.handle('get-drive-info', (event) => {
        return AppVariables.driveInfo;
    });
}

module.exports = setupIpcHandlers_os;