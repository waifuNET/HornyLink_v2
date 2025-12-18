const path = require('path');
const { app } = require('electron');

module.exports = {
    SERVER_URL: "https://api.hornylink.ru",
    SERVER_URL_CLEAR: "api.hornylink.ru",
    VERSION: "1.7.2",

    telegramBotName: '@HornyLinkBot',
    telegramBotName_clear: 'HornyLinkBot',

    dataAuthPath: path.join(app.getPath('userData'), 'auth.json'),
    applicationSettingsPath: path.join(app.getPath('userData'), 'settings.json'),
    gamesMetadataPath: path.join(app.getPath('userData'), 'gamesMetadata.json'),
    
    // Настройки кэширования
    cache: {
        defaultRamCacheSize: 256 * 1024 * 1024,   // 256 MB
        defaultDiskCacheSize: 1024 * 1024 * 1024, // 1 GB
        maxDiskCacheSize: 2 * 1024 * 1024 * 1024, // 2 GB (максимум)
        minDiskCacheSize: 100 * 1024 * 1024       // 100 MB (минимум)
    }
}