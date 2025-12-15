const path = require('path');
const { app } = require('electron');

module.exports = {
    SERVER_URL: "https://api.hornylink.ru",
    SERVER_URL_CLEAR: "api.hornylink.ru",
    VERSION: "1.7.2",

    telegramBotName: '@HornyLinkBot',
    telegramBotName_clear: 'HornyLinkBot',

    dataAuthPath: path.join(app.getPath('userData'), 'auth.json'),
    applicationSettingsPath: path.join(app.getPath('userData'), 'settings.json')
}