const fs = require('fs');
const path = require('path');

const { hasInternetConnection } = require('./utils/internetUtils');
const { applicationSettingsPath } = require('./cfg');

class LocalUserBase{
    static id = null;
    static username = null;
    static premium_until = null;

    static setUserData({id = null, username = null, premium_until = null}){
        this.id = id;
        this.username = username;
        this.premium_until = premium_until;
    }
}


class ApplicationSettings {
    static defaultSettings = {
        language: 'ru',
        theme: 'dark',
    };

    static settings = { ...this.defaultSettings };

    static loadSettings() {
        const savedData = fs.existsSync(applicationSettingsPath) ? fs.readFileSync(applicationSettingsPath, 'utf8') : null;
        
        if (savedData) {
            try {
                const loadedSettings = JSON.parse(savedData);

                this.settings = Object.assign({}, this.defaultSettings, loadedSettings);
                console.log(`[STATE] ${LanguageVariables.getMessage('SETTINGS_LOADED', 'success', this.settings.language)}`);
                return;

            } catch (e) {
                console.error(`[STATE] ${LanguageVariables.getMessage('SETTINGS_LOAD_ERROR', 'errors', this.settings.language)}`, e);
            }
        }
    }

    static saveSettings() {
        try {
            const settingsToSave = JSON.stringify(this.settings);
            fs.writeFileSync(applicationSettingsPath, settingsToSave);
        } catch (e) {
            console.error(`[STATE] ${LanguageVariables.getMessage('SETTINGS_SAVE_ERROR', 'errors', this.settings.language)}`, e);
        }
    }

    static updateSetting(key, value) {
        if (this.settings.hasOwnProperty(key)) {
            this.settings[key] = value;
            this.saveSettings();
            return true;
        }
        console.error(`[STATE] ${LanguageVariables.getMessage('SETTINGS_UPDATE_ERROR', 'errors', this.settings.language)}`);
        return false;
    }
}

class LanguageVariables {
    static _cache = {}; 
    static _loadedLang = null; 

    static changeLanguage(lang){
        let translations = this._cache[lang];

        if (!translations || this._loadedLang !== lang) {
            translations = this._loadLanguageFile(lang);
            
            if (translations) {
                this._cache[lang] = translations;
                this._loadedLang = lang;
            } else {
                return `[STATE] Ошибка при загрузке языка. Код: ${code}`;
            }
        }
    }

    static getMessage(code, section, lang = 'ru') {
        let translations = this._cache[lang];

        if (!translations || this._loadedLang !== lang) {
            translations = this._loadLanguageFile(lang);
            
            if (translations) {
                this._cache[lang] = translations;
                this._loadedLang = lang;
            } else {
                return `[STATE] Ошибка при загрузке языка. Код: ${code}`;
            }
        }
        
        const messagesBySection = translations[section]; 

        if (messagesBySection && messagesBySection[code]) {
            return messagesBySection[code];
        } else {
            console.warn(`[STATE] Перевод для кода "${code}" в секции "${section}" не найден в языке "${lang}".`);
            return `${section}.${code}`;
        }
    }

    static _loadLanguageFile(lang) {
        const langFilePath = path.join(__dirname, 'languages', `${lang}.json`);

        try {
            console.log(`[STATE] Загрузка файла перевода для языка "${lang}"`);
            const fileContent = fs.readFileSync(langFilePath, 'utf8');
            ApplicationSettings.updateSetting('language', lang);
            return JSON.parse(fileContent);
        } catch (error) {
            console.error(`[STATE] Не удалось загрузить или разобрать файл языка для "${lang}":`, error.message);
            return null; 
        }
    }
    
    static clearCache() {
        this._cache = {};
        this._loadedLang = null;
        console.log('[STATE] Кэш переводов очищен.');
    }

    static getAllLanguagesWithTag() {
        const languagesDir = path.join(__dirname, 'languages');
        const languages = [];

        try {
            const files = fs.readdirSync(languagesDir);

            files.forEach(file => {
                if (path.extname(file) === '.json') {
                    const langCode = path.basename(file, '.json');
                    const filePath = path.join(languagesDir, file);

                    try {
                        const fileContent = fs.readFileSync(filePath, 'utf8');
                        const translations = JSON.parse(fileContent);

                        const languageInfo = {
                            code: langCode,
                            name: translations.language || langCode,
                        };

                        languages.push(languageInfo);
                    } catch (error) {
                        console.error(`[STATE] Ошибка при чтении файла языка "${file}":`, error.message);
                    }
                }
            });
        } catch (error) {
            console.error('[STATE] Ошибка при чтении директории языков:', error.message);
        }

        // [ { code: 'ru', name: 'Русский' } ]
        return languages;
    }

    static getCurrentLanguage(){
        return ApplicationSettings.settings.language;
    }
}

module.exports = {
    LocalUserBase,
    LanguageVariables,
    ApplicationSettings
};