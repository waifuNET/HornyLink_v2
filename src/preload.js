const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Language IPC
    getLanguageMessage: (code, section) => ipcRenderer.invoke('get-language-message', code, section),
    getAllLanguages: () => ipcRenderer.invoke('get-all-languages'),
    getCurrentLanguage: () => ipcRenderer.invoke('get-current-language'),
    changeLanguage: (lang) => ipcRenderer.invoke('change-language', lang),

    // Login && registration
    tryAuth: (login, password) => ipcRenderer.invoke('try-auth', login, password),
    telegramRegistration: (username, password, email) => ipcRenderer.invoke('telegram-registration', username, password, email),
    telegramResetPassword: (key, newPassword) => ipcRenderer.invoke('telegram-reset-password', key, newPassword),

    // CFG
    getCfg: () => ipcRenderer.invoke('get-cfg'),
});