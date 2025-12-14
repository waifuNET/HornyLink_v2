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

/*
    "id": 5,
    "title": "Alien Quest: EVE",
    "author": "Grimhelm",
    "description": "Alien Quest: EVE – это атмосферный проект, повествующий о соблазнительной девушке по имени Эллен, старающейся спасти человечество от инопланетных захватчиков. Игра сделана в виде традиционного двухмерного сайд-скроллера, где приходится передвигаться по представленным локациям, выполненным в виде космического корабля и сопротивляться толпам атакующих пришельцев. Главной задачей выступает прохождение уровней, чтобы открывать новые участки судна, на котором очутилась героиня. Продвигаясь вперед, придется применять доступный арсенал возможностей и умений протагонистки.",
    "images": [
      "https://lcdn.hornylink.ru/hornylink/games/alien_quest_eve_v1_01_64bit_zip/1746892976127_10579052.webp",
      "https://lcdn.hornylink.ru/hornylink/games/alien_quest_eve_v1_01_64bit_zip/1746892976128_alien-quest-eve-screenshots-550911-gamebezz-com.webp",
      "https://lcdn.hornylink.ru/hornylink/games/alien_quest_eve_v1_01_64bit_zip/1746892976128_i (1).jpg",
      "https://lcdn.hornylink.ru/hornylink/games/alien_quest_eve_v1_01_64bit_zip/1746892976129_logo.jpg",
      "https://lcdn.hornylink.ru/hornylink/games/alien_quest_eve_v1_01_64bit_zip/1746892976129_maxresdefault (1).jpg",
      "https://lcdn.hornylink.ru/hornylink/games/alien_quest_eve_v1_01_64bit_zip/1746892976130_maxresdefault.jpg"
    ],
    "languages": "Интерфейс: Английский Озвучка: Отсутствует",
    "tags": "2D, анимированная, большая грудь, боевка, кремпай, женский протагонист, жестокость, групповой секс, монстры, платформер, тентакли, sci-fi",
    "engine": "Unity",
    "version": "1.01",
    "download_link": "games/alien_quest_eve_v1_01_64bit_zip/game.zip",
    "exe_name": "AlienQuest-EVE.exe",
    "updated": "10.05.2025",
    "rating": 0,
    "storage_url": "https://lcdn.hornylink.ru/hornylink",
    "uploader": null,
    "updated_parsed": "2025-05-10",
    "status": 0,
    "uploader_name": null,
    "playtime": 9,
    "downloads": 124,
    "visible_in_profile": true,
    "title_translate": "Чужой Квест: EVE",
    "description_translate": "Alien Quest: EVE – это атмосферный проект, повествующий о соблазнительной девушке по имени Эллен, старающейся спасти человечество от инопланетных захватчиков. Игра сделана в виде традиционного двухмерного сайд-скроллера, где приходится передвигаться по представленным локациям, выполненным в виде космического корабля, и сопротивляться толпам атакующих пришельцев. Главной задачей выступает прохождение уровней, чтобы открывать новые участки судна, на котором очутилась героиня. Продвигаясь вперед, придется применять доступный арсенал возможностей и умений протагонистки."
*/

class GameCollection {
  static games = [];

  static addGame(game) {
    if (!game.id) {
      throw new Error('Game must have an id');
    }
    
    const existingIndex = this.games.findIndex(g => g.id === game.id);
    if (existingIndex !== -1) {
      throw new Error(`Game with id ${game.id} already exists`);
    }
    
    this.games.push(game);
    return game;
  }

  static getGameLogo(id) {
    const game = this.games.find(g => g.id === id);

    if (!game) {
        return null;
    }

    const { images, storage_url } = game;

    if (!images || images.length === 0) {
        return null;
    }

    const logoImage = images.find(imagePath => 
        imagePath.toLowerCase().includes('logo')
    );

    if (logoImage) {
        return logoImage;
    } else {
        return images[0];
    }
  }

  static getGameIcon(id){
    const game = this.games.find(g => g.id === id);

    if (!game) {
        return null;
    }

    const { images, storage_url } = game;

    if (!images || images.length === 0) {
        return null;
    }

    const iconImage = images.find(imagePath => 
        imagePath.toLowerCase().includes('icon')
    );

    if (iconImage) {
        return iconImage;
    } else {
        return this.getGameLogo(id);
    }
  }

  static getGameScreenshots(id) {
    const game = this.games.find(g => g.id === id);

    if (!game) {
        return null;
    }

    const { images } = game;

    if (!images || images.length === 0) {
        return null;
    }

    const screenshots = images.filter(imagePath => 
        !imagePath.toLowerCase().includes('logo')
    );
    
    return screenshots;
  }

  static getGameById(id) {
    return this.games.find(game => game.id === id) || null;
  }

  static getAllGames() {
    return [...this.games];
  }

  static deleteGame(id) {
    const index = this.games.findIndex(game => game.id === id);
    if (index === -1) {
      return false;
    }
    
    this.games.splice(index, 1);
    return true;
  }

  static updateGame(id, updates) {
    const index = this.games.findIndex(game => game.id === id);
    if (index === -1) {
      this.addGame(updates);
      return null;
    }
    
    // Запрещаем изменение ID
    if (updates.id && updates.id !== id) {
      throw new Error('Cannot change game ID');
    }
    
    this.games[index] = { ...this.games[index], ...updates };
    return this.games[index];
  }

  static findGames(filterFn) {
    return this.games.filter(filterFn);
  }

  static findByTag(tag) {
    return this.games.filter(game => 
      game.tags && game.tags.toLowerCase().includes(tag.toLowerCase())
    );
  }

  static findByAuthor(author) {
    return this.games.filter(game => 
      game.author && game.author.toLowerCase().includes(author.toLowerCase())
    );
  }

  static getCount() {
    return this.games.length;
  }

  static clear() {
    this.games = [];
  }

  static loadGames(gamesArray) {
    if (!Array.isArray(gamesArray)) {
      throw new Error('Input must be an array');
    }
    this.games = [...gamesArray];
  }

  static toJSON() {
    return JSON.stringify(this.games, null, 2);
  }

  static fromJSON(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      this.loadGames(parsed);
    } catch (error) {
      throw new Error('Invalid JSON format');
    }
  }
}

class ApplicationSettings {
    static defaultSettings = {
        language: 'ru',
        theme: 'dark',

        content_language: 'default',
        comments_language: 'default'
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

    static getMessage(code, section) {
        const lang = ApplicationSettings.settings.language;
        code = (code || '').toUpperCase();

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
    ApplicationSettings,
    GameCollection
};