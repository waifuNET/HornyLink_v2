const fs = require('fs');
const path = require('path');
const os = require('os');
const { getFileSize } = require('./logic/other/download');
const { hasInternetConnection } = require('./utils/internetUtils');
const { applicationSettingsPath } = require('./cfg');

class AppVariables {
  static driveInfo = null;
}

class LocalUserBase {
  static id = null;
  static username = null;
  static premium_until = null;

  static setUserData({ id = null, username = null, premium_until = null }) {
    this.id = id;
    this.username = username;
    this.premium_until = premium_until;
  }
}

class GameCollection {
  static games = [];
  static comments = [];
  static getGameInfoFilePath(gameId, drivePath) {
    return path.join(drivePath, 'HornyLibrary', 'gamesInfo', `${gameId}.json`);
  }

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

  static async getGameSize(id) {
    const game = this.games.find(g => g.id === id);
    if (!game) {
      return null;
    }

    const { storage_url, download_link } = game;

    try {
      const fileSize = await getFileSize(`${storage_url}/${download_link}`);
      return fileSize;
    } catch (err) {
      console.log(`[STATE] getGameSize: ${err}`);
      return null;
    }
  }

  static getGameIcon(id) {
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

  // ===== МЕТОДЫ ДЛЯ РАБОТЫ С УСТАНОВЛЕННЫМИ ИГРАМИ =====

  static loadInstalledGames() {
    try {
      console.log('[GameCollection] Начало загрузки установленных игр с дисков...');
      
      const disks = ['C:', 'D:', 'E:', 'F:', 'G:'];
      let totalFound = 0;

      for (const disk of disks) {
        try {
          const gamesInfoPath = path.join(disk, 'HornyLibrary', 'gamesInfo');
          
          if (!fs.existsSync(gamesInfoPath)) {
            continue;
          }

          const files = fs.readdirSync(gamesInfoPath);
          
          for (const file of files) {
            if (!file.endsWith('.json')) continue;
            
            try {
              const filePath = path.join(gamesInfoPath, file);
              const fileContent = fs.readFileSync(filePath, 'utf8');
              const gameInfo = JSON.parse(fileContent);
              const gameId = parseInt(path.basename(file, '.json'));

              // Создаем путь к папке игры
              const safeFolderName = gameInfo.title
                .replace(/[^a-zA-Z0-9а-яА-Я\s_-]/g, '')
                .replace(/\s+/g, '_')
                .substring(0, 100);
              const installPath = path.join(disk, 'HornyLibrary', 'games', safeFolderName);

              const gameObject = {
                ...gameInfo,
                id: gameId,
                isInstalled: true,
                installPath: installPath,
                executablePath: null
              };
              
              this.addOrUpdateInstalledGame(gameObject);
              totalFound++;
            } catch (fileError) {
              console.error(`[GameCollection] Ошибка чтения файла ${file}:`, fileError);
            }
          }
        } catch (diskError) {
          console.warn(`[GameCollection] Ошибка сканирования диска ${disk}:`, diskError.message);
        }
      }

      console.log(`[GameCollection] Загрузка завершена. Найдено установленных игр: ${totalFound}`);
      return totalFound;
    } catch (error) {
      console.error('[GameCollection] Ошибка при загрузке установленных игр:', error);
      return 0;
    }
  }

  static saveInstalledGames() {
    try {
      const installedGames = this.getInstalledGames();
      let savedCount = 0;

      for (const game of installedGames) {
        // Определяем диск из installPath
        const drivePath = game.installPath.split(path.sep)[0] + path.sep;
        const filePath = this.getGameInfoFilePath(game.id, drivePath);
        const dir = path.dirname(filePath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Создаем копию данных без служебных полей
        const { isInstalled, installPath, executablePath, ...cleanData } = game;
        
        fs.writeFileSync(filePath, JSON.stringify(cleanData, null, 2), 'utf8');
        savedCount++;
      }

      console.log(`[GameCollection] Сохранено ${savedCount} установленных игр`);
      return true;
    } catch (error) {
      console.error('[GameCollection] Ошибка сохранения установленных игр:', error);
      return false;
    }
  }

  static getInstalledGames() {
    return this.games.filter(game => game.isInstalled === true);
  }

  static getInstalledGameById(gameId) {
    return this.games.find(g => g.id === gameId && g.isInstalled === true) || null;
  }

  static addOrUpdateInstalledGame(gameData) {
    if (!gameData.id) {
      console.error('[GameCollection] Невозможно добавить игру без ID');
      return false;
    }

    // Обязательно помечаем как установленную
    const installedGameData = {
      ...gameData,
      isInstalled: true
    };

    const existingIndex = this.games.findIndex(g => g.id === gameData.id);
    
    if (existingIndex !== -1) {
      // Обновляем существующую игру
      this.games[existingIndex] = {
        ...this.games[existingIndex],
        ...installedGameData
      };
      console.log(`[GameCollection] Обновлена установленная игра: ${gameData.title || gameData.id}`);
    } else {
      // Добавляем новую игру
      this.games.push(installedGameData);
      console.log(`[GameCollection] Добавлена установленная игра: ${gameData.title || gameData.id}`);
    }

    return true;
  }

  static removeInstalledGame(gameId) {
    const game = this.getGameById(gameId);
    
    if (!game) {
      console.warn(`[GameCollection] Игра с ID ${gameId} не найдена для удаления`);
      return false;
    }

    // Обновляем игру, помечая как неустановленную
    this.updateGame(gameId, {
      isInstalled: false,
      installPath: "",
      executablePath: ""
    });
    
    console.log(`[GameCollection] Игра с ID ${gameId} помечена как неустановленная`);
    return true;
  }

  static isGameInstalled(gameId) {
    const game = this.getGameById(gameId);
    return game ? game.isInstalled === true : false;
  }

  static getGamesByDrive(drivePath) {
    const normalizedDrive = drivePath.toLowerCase().replace(/[\/\\]$/, '');
    return this.games.filter(g => {
      if (!g.installPath || !g.isInstalled) return false;
      const gameDrive = g.installPath.split(path.sep)[0].toLowerCase();
      return gameDrive === normalizedDrive;
    });
  }

  static updateGameField(gameId, field, value) {
    const game = this.getGameById(gameId);
    
    if (!game) {
      console.warn(`[GameCollection] Игра с ID ${gameId} не найдена для обновления поля ${field}`);
      return false;
    }

    game[field] = value;
    console.log(`[GameCollection] Обновлено поле ${field} для игры ${gameId}`);
    
    // Если это поле установленной игры, сохраняем
    if (game.isInstalled) {
      this.saveInstalledGames();
    }
    return true;
  }

  static mergeWithServerData(serverGames) {
    if (!Array.isArray(serverGames)) {
      console.error('[GameCollection] Серверные данные должны быть массивом');
      return false;
    }

    // Сохраняем текущие установленные игры в Map для быстрого доступа
    const installedGamesMap = new Map();
    this.getInstalledGames().forEach(game => {
      installedGamesMap.set(game.id, game);
    });

    // Обновляем данные для каждой игры из сервера
    serverGames.forEach(serverGame => {
      const installedGame = installedGamesMap.get(serverGame.id);
      const existingGame = this.getGameById(serverGame.id);
      
      if (existingGame) {
        // Обновляем существующую игру
        this.updateGame(serverGame.id, {
          ...serverGame,
          isInstalled: existingGame.isInstalled,
        });
      } else {
        // Добавляем новую игру
        this.games.push({
          ...serverGame,
          isInstalled: false,
          installPath: "",
          executablePath: ""
        });
      }
    });

    console.log(`[GameCollection] Объединено ${serverGames.length} игр с сервера с ${installedGamesMap.size} установленными играми`);
    return true;
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

  static changeLanguage(lang) {
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

    return languages;
  }

  static getCurrentLanguage() {
    return ApplicationSettings.settings.language;
  }
}

module.exports = {
  LocalUserBase,
  LanguageVariables,
  ApplicationSettings,
  GameCollection,
  AppVariables
};