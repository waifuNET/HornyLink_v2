const path = require('path');
const { app } = require('electron');

module.exports = {
    SERVER_URL: "http://185.202.207.21:3011",
    SERVER_URL_CLEAR: "185.202.207.21",
    VERSION: "1.7.2",

    telegramBotName: '@HornyLinkBot',
    telegramBotName_clear: 'HornyLinkBot',

    dataAuthPath: path.join(app.getPath('userData'), 'auth.json'),
    applicationSettingsPath: path.join(app.getPath('userData'), 'settings.json')
}