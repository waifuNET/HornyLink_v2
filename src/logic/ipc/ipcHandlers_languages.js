const { ipcMain } = require('electron');
const { LanguageVariables, ApplicationSettings } = require('../../state');

function setupIpcHandlers_languages() {
    ipcMain.handle('get-language-message', (event, code, section) => {
        return LanguageVariables.getMessage(code, section);
    });

    ipcMain.handle('get-all-languages', (event) =>{
        return LanguageVariables.getAllLanguagesWithTag();
    });

    ipcMain.handle('get-current-language', (event) => {
        return LanguageVariables.getCurrentLanguage();
    });

    ipcMain.handle('change-language', (event, lang) => {
        LanguageVariables.changeLanguage(lang);
    });
}

module.exports = setupIpcHandlers_languages;