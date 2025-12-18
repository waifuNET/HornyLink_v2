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
        getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
    },

    games:{
        getAllGames: () => ipcRenderer.invoke('get-all-games'),
        getGameById: (id) => ipcRenderer.invoke('get-game-by-id', id),
        getGameLogo: (id) => ipcRenderer.invoke('get-game-logo', id),
        getGameScreenshots: (id) => ipcRenderer.invoke('get-game-screenshots', id),
        getGameIcon: (id) => ipcRenderer.invoke('get-game-icon', id),
        getGameComments: (gameId) => ipcRenderer.invoke('get-game-comments', gameId),
        getFileSize: (gameId) => ipcRenderer.invoke('get-file-size', gameId),
        downloadGame: (createDesktopShortcut, createStartMenuShortcut, drivePath, gameId, gameTitle) => ipcRenderer.invoke('download-game', createDesktopShortcut, createStartMenuShortcut, drivePath, gameId, gameTitle),
        
        pauseDownloading: (gameId) => ipcRenderer.invoke('pause-downloading-game', gameId),
        canselDownloading: (gameId) => ipcRenderer.invoke('cansel-downloading-game', gameId),
        resumeDownloading: (gameId) => ipcRenderer.invoke('resume-downloading-game', gameId),

        closeGame: (gameId) => ipcRenderer.invoke('close-game', gameId),
        launchGame: (gameId) => ipcRenderer.invoke('launch-game', gameId),

        status: (gameId) => ipcRenderer.invoke('status', gameId),
        
        getCurrentDownloadProgress: () => ipcRenderer.invoke('get-current-download-progress'),
        
        // офлайн/онлайн режим
        getOnlineStatus: () => ipcRenderer.invoke('get-online-status'),
        syncGames: () => ipcRenderer.invoke('sync-games'),

        // Комментарии
        addComment: (gameId, content) => ipcRenderer.invoke('add-comment', gameId, content),
        deleteComment: (commentId) => ipcRenderer.invoke('delete-comment', commentId),
        
        // Удаление игры
        deleteGame: (gameId) => ipcRenderer.invoke('delete-game', gameId),

        // Events //
        universalEvent: (callback) => ipcRenderer.on('callback-universal', (event, value) => {
            callback(value);
        }),
    },

    os:{
        getDriveInfo: () => ipcRenderer.invoke('get-drive-info'),
        showGameLocation: (gameId) => ipcRenderer.invoke('show-game-location', gameId),
    },

    // CFG
    getCfg: () => ipcRenderer.invoke('get-cfg'),
});