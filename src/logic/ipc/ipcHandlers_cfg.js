const { ipcMain } = require('electron');
const cfg = require('../../cfg');

function setupIpcHandlers_cfg() {
    ipcMain.handle('get-cfg', async (event) => {
      return {
        SERVER_URL: cfg.SERVER_URL,
        VERSION: cfg.VERSION,
        telegramBotName: cfg.telegramBotName,
        telegramBotName_clear: cfg.telegramBotName_clear,
      };
    });
}

module.exports = setupIpcHandlers_cfg;