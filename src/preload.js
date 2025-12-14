const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Language IPC
    language:{
        getLanguageMessage: (code, section) => ipcRenderer.invoke('get-language-message', code, section),
        getAllLanguages: () => ipcRenderer.invoke('get-all-languages'),
        getCurrentLanguage: () => ipcRenderer.invoke('get-current-language'),
        changeLanguage: (lang) => ipcRenderer.invoke('change-language', lang),
    },

    // Login && registration
    auth: {
        tryAuth: (login, password) => ipcRenderer.invoke('try-auth', login, password),
        telegramRegistration: (username, password, email) => ipcRenderer.invoke('telegram-registration', username, password, email),
        telegramResetPassword: (key, newPassword) => ipcRenderer.invoke('telegram-reset-password', key, newPassword),
    },

    games:{
        getAllGames: () => ipcRenderer.invoke('get-all-games'),
        getGameById: (id) => ipcRenderer.invoke('get-game-by-id', id),
        getGameLogo: (id) => ipcRenderer.invoke('get-game-logo', id),
        getGameScreenshots: (id) => ipcRenderer.invoke('get-game-screenshots', id),
        getGameIcon: (id) => ipcRenderer.invoke('get-game-icon', id),
    },

    // CFG
    getCfg: () => ipcRenderer.invoke('get-cfg'),
});