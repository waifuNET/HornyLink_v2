const fs = require('fs');
const path = require('path');
const { getFileSize } = require('./logic/other/download');

const { hasInternetConnection } = require('./utils/internetUtils');
const { applicationSettingsPath } = require('./cfg');

class AppVariables {
  static driveInfo = null;
}

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

class InstalledGamesInfo {
    static games = [];

    /**
     * Добавляет или обновляет игру в списке установленных
     * @param {object} gameData - Данные игры (должны включать id, installPath, executablePath, isInstalled)
     */
    static addOrUpdateGame(gameData) {
        if (!gameData.id) {
            console.error('[InstalledGamesInfo] Невозможно добавить игру без ID');
            return;
        }

        const existingIndex = this.games.findIndex(g => g.id === gameData.id);
        
        if (existingIndex !== -1) {
            // Обновляем существующую игру
            this.games[existingIndex] = {
                ...this.games[existingIndex],
                ...gameData
            };
            console.log(`[InstalledGamesInfo] Обновлена игра: ${gameData.title || gameData.id}`);
        } else {
            // Добавляем новую игру
            this.games.push(gameData);
            console.log(`[InstalledGamesInfo] Добавлена игра: ${gameData.title || gameData.id}`);
        }
    }

    /**
     * Удаляет игру из списка установленных
     * @param {number} gameId - ID игры
     * @returns {boolean} - true если игра была удалена, false если не найдена
     */
    static removeGame(gameId) {
        const initialLength = this.games.length;
        this.games = this.games.filter(g => g.id !== gameId);
        
        const removed = this.games.length < initialLength;
        
        if (removed) {
            console.log(`[InstalledGamesInfo] Удалена игра с ID: ${gameId}`);
        } else {
            console.warn(`[InstalledGamesInfo] Игра с ID ${gameId} не найдена для удаления`);
        }
        
        return removed;
    }

    /**
     * Получает игру по ID
     * @param {number} gameId - ID игры
     * @returns {object|null} - Объект игры или null если не найдена
     */
    static getGameById(gameId) {
        return this.games.find(g => g.id === gameId) || null;
    }

    /**
     * Получает все установленные игры
     * @returns {array} - Массив всех установленных игр
     */
    static getAllGames() {
        return [...this.games];
    }

    /**
     * Проверяет, установлена ли игра
     * @param {number} gameId - ID игры
     * @returns {boolean} - true если игра установлена
     */
    static isGameInstalled(gameId) {
        const game = this.getGameById(gameId);
        return game ? game.isInstalled === true : false;
    }

    /**
     * Получает количество установленных игр
     * @returns {number} - Количество игр
     */
    static getInstalledCount() {
        return this.games.filter(g => g.isInstalled === true).length;
    }

    /**
     * Очищает весь список установленных игр
     */
    static clearAll() {
        this.games = [];
        console.log('[InstalledGamesInfo] Список установленных игр очищен');
    }

    /**
     * Получает игры, установленные на определенном диске
     * @param {string} drivePath - Путь к диску (например, "C:" или "E:")
     * @returns {array} - Массив игр на указанном диске
     */
    static getGamesByDrive(drivePath) {
        const normalizedDrive = drivePath.toLowerCase().replace(/[\/\\]$/, '');
        return this.games.filter(g => {
            if (!g.installPath) return false;
            const gameDrive = g.installPath.split(path.sep)[0].toLowerCase();
            return gameDrive === normalizedDrive;
        });
    }

    /**
     * Обновляет конкретное поле у игры
     * @param {number} gameId - ID игры
     * @param {string} field - Название поля
     * @param {any} value - Новое значение
     * @returns {boolean} - true если обновление прошло успешно
     */
    static updateGameField(gameId, field, value) {
        const game = this.getGameById(gameId);
        
        if (!game) {
            console.warn(`[InstalledGamesInfo] Игра с ID ${gameId} не найдена для обновления поля ${field}`);
            return false;
        }

        game[field] = value;
        console.log(`[InstalledGamesInfo] Обновлено поле ${field} для игры ${gameId}`);
        return true;
    }

    /**
     * Выводит информацию о всех установленных играх (для отладки)
     */
    static printAll() {
        console.log('[InstalledGamesInfo] Установленные игры:');
        this.games.forEach((game, index) => {
            console.log(`  ${index + 1}. ID: ${game.id}, Title: ${game.title || 'N/A'}, Path: ${game.installPath || 'N/A'}`);
        });
        console.log(`[InstalledGamesInfo] Всего: ${this.games.length} игр`);
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
  static comments = [];

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

  static async getGameSize(id){
    const game = this.games.find(g => g.id === id);


    if (!game) {
        return null;
    }

    const { storage_url, download_link } = game;

    try{
      const fileSize = await getFileSize(`${storage_url}/${download_link}`);
      return fileSize;
    }
    catch (err){
      console.log(`[STATE] getGameSize: ${err}`);
      return null;
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

  // ===== МЕТОДЫ ДЛЯ РАБОТЫ С КОММЕНТАРИЯМИ =====

  static addComment(comment) {
    if (!comment.id) {
      throw new Error('Comment must have an id');
    }
    if (!comment.game_id) {
      throw new Error('Comment must have a game_id');
    }
    
    const existingIndex = this.comments.findIndex(c => c.id === comment.id);
    if (existingIndex !== -1) {
      throw new Error(`Comment with id ${comment.id} already exists`);
    }
    
    this.comments.push(comment);
    return comment;
  }

  static getCommentById(commentId) {
    return this.comments.find(comment => comment.id === commentId) || null;
  }

  static getCommentsByGameId(gameId) {
    return this.comments.filter(comment => comment.game_id === gameId);
  }

  static getAllComments() {
    return [...this.comments];
  }

  static deleteComment(commentId) {
    const index = this.comments.findIndex(comment => comment.id === commentId);
    if (index === -1) {
      return false;
    }
    
    this.comments.splice(index, 1);
    return true;
  }

  static deleteCommentsByGameId(gameId) {
    const initialLength = this.comments.length;
    this.comments = this.comments.filter(comment => comment.game_id !== gameId);
    return initialLength - this.comments.length;
  }

  static updateComment(commentId, updates) {
    const index = this.comments.findIndex(comment => comment.id === commentId);
    if (index === -1) {
      return null;
    }
    
    // Запрещаем изменение ID и game_id
    if (updates.id && updates.id !== commentId) {
      throw new Error('Cannot change comment ID');
    }
    if (updates.game_id && updates.game_id !== this.comments[index].game_id) {
      throw new Error('Cannot change comment game_id');
    }
    
    this.comments[index] = { ...this.comments[index], ...updates };
    return this.comments[index];
  }

  static getCommentsByUserId(userId) {
    return this.comments.filter(comment => comment.user_id === userId);
  }

  static getCommentsCount(gameId = null) {
    if (gameId === null) {
      return this.comments.length;
    }
    return this.comments.filter(comment => comment.game_id === gameId).length;
  }

  static clearComments() {
    this.comments = [];
  }

  static loadComments(commentsArray) {
    if (!Array.isArray(commentsArray)) {
      throw new Error('Input must be an array');
    }
    this.comments = [...commentsArray];
  }

  static commentsToJSON() {
    return JSON.stringify(this.comments, null, 2);
  }

  static commentsFromJSON(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      this.loadComments(parsed);
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
    GameCollection,
    AppVariables,
    InstalledGamesInfo
};