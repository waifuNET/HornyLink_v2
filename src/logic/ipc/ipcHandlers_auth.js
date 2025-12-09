const { ipcMain } = require('electron');
const { LanguageVariables, ApplicationSettings } = require('../../state');
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
}

module.exports = setupIpcHandlers_auth;