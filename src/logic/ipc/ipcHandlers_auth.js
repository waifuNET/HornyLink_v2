const { ipcMain } = require('electron');
const { LanguageVariables, ApplicationSettings, LocalUserBase } = require('../../state');
const { Auth } = require('../auth/auth');
const WindowUtils = require('../../utils/windowUtils');

function setupIpcHandlers_auth() {
    ipcMain.handle('try-auth', async (event, login, password) => {
        const forceResult = await Auth.forceAuthenticate(login, password);
        if(forceResult.success){
            WindowUtils.goToPage('/app/library.html');
        }
        console.log(forceResult);
        return forceResult;
    });

    ipcMain.handle('telegram-registration', async (event, username, password, email) => {
        const result = await Auth.telegramRegistration(username, password, email);
        return result;
    });

    ipcMain.handle('telegram-reset-password', async (event, key, newPassword) => {
        const result = await Auth.telegramResetPassword(key, newPassword);
        return result;
    });

    // Получение текущего пользователя
    ipcMain.handle('get-current-user', () => {
        return {
            id: LocalUserBase.id,
            username: LocalUserBase.username,
            premium_until: LocalUserBase.premium_until
        };
    });
}

module.exports = setupIpcHandlers_auth;