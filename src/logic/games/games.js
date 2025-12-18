const { GameCollection, LanguageVariables, AppVariables, GamesMetadata } = require('../../state');
const { Auth } = require('../auth/auth');
const { fetch, hasInternetConnection } = require('../../utils/internetUtils');
const globalUtils = require('../../utils/globalUtils');
const osUtils = require('../../utils/osUtils');
const { downloadFile, extractArchive, setProgressCallback, pauseDownload, resumeDownload, stopDownload } = require('../other/download');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const windowManager = require('../../windowManager');
const ws = require('windows-shortcuts');
const os = require('os');
const { spawn } = require('child_process');
const { SERVER_URL } = require('../../cfg');
const imageCache = require('../cache/imageCache');
const gameImagesManager = require('../cache/gameImagesManager');

const URLS = {
  myLibrary: `${SERVER_URL}/library/`,
  comments: `${SERVER_URL}/comments/comment/`
}

class Games {
  static async Init() {
    // Инициализируем кэш изображений
    const { ApplicationSettings } = require('../../state');
    const cacheSettings = ApplicationSettings.getCacheSettings();
    
    try {
      await imageCache.init({
        maxRamCacheSize: cacheSettings.ramSize,
        maxDiskCacheSize: cacheSettings.diskSize
      });
    } catch (err) {
      console.error('[GAMES] Ошибка инициализации imageCache:', err);
    }
    
    // Инициализируем менеджер локальных изображений
    try {
      await gameImagesManager.init();
    } catch (err) {
      console.error('[GAMES] Ошибка инициализации gameImagesManager:', err);
    }
    
    // Загружаем метаданные игр (дата последнего запуска и т.д.)
    GamesMetadata.load();
    
    // Загружаем сохраненные установленные игры
    GameCollection.loadInstalledGames();
    
    // Проверяем интернет соединение
    const isOnline = await hasInternetConnection();
    AppVariables.setOnlineStatus(isOnline);
    
    if (isOnline) {
      // Обновляем игры с сервера (объединяем с сохраненными)
      await this.updateGames();
      
      // Скачиваем изображения для установленных игр, у которых их нет
      await this.downloadMissingGameImages();
    } else {
      console.log('[GAMES] Офлайн режим - загружены только установленные игры');
    }
    
    // Сканируем диски на наличие установленных игр (дополнительно)
    await this.scanInstalledGames();
    
    // Запускаем периодическую проверку интернета
    this._startOnlineChecker();
  }
  
  /**
   * Скачивает изображения для установленных игр, у которых их нет локально
   */
  static async downloadMissingGameImages() {
    const installedGames = GameCollection.getInstalledGames();
    
    for (const game of installedGames) {
      // Проверяем есть ли локальные изображения
      if (!gameImagesManager.hasLocalImages(game.id)) {
        // Получаем данные игры с изображениями
        const gameData = GameCollection.getGameById(game.id);
        
        if (gameData && gameData.images && gameData.images.length > 0 && gameData.installPath) {
          const drivePath = gameData.installPath.split(path.sep)[0] + path.sep;
          
          try {
            console.log(`[GAMES] Скачивание изображений для установленной игры: ${gameData.title}`);
            await gameImagesManager.saveGameImages(drivePath, game.id, gameData.images);
          } catch (error) {
            console.warn(`[GAMES] Не удалось скачать изображения для ${gameData.title}:`, error.message);
          }
        }
      }
    }
  }
  
  /**
   * Периодическая проверка интернет соединения
   */
  static _onlineCheckerInterval = null;
  static _startOnlineChecker() {
    if (this._onlineCheckerInterval) {
      clearInterval(this._onlineCheckerInterval);
    }
    
    this._onlineCheckerInterval = setInterval(async () => {
      const wasOnline = AppVariables.isOnline;
      const isOnline = await hasInternetConnection();
      const statusChanged = AppVariables.setOnlineStatus(isOnline);
      
      if (statusChanged && isOnline && !wasOnline) {
        // Вернулся интернет - обновляем данные
        console.log('[GAMES] Интернет восстановлен - обновляем данные');
        await this.updateGames();
        
        // Уведомляем frontend
        windowManager.send('callback-universal', { 
          event: "onlineStatusChanged", 
          isOnline: true 
        });
      } else if (statusChanged && !isOnline) {
        // Интернет пропал
        windowManager.send('callback-universal', { 
          event: "onlineStatusChanged", 
          isOnline: false 
        });
      }
    }, 30000); // Каждые 30 секунд
  }

  static runningGames = new Map();
  static downloading = false;
  static downloadingPause = false;
  static currentGameDownloadObject = null;
  static globalCurrentDownloadProgress = { progress: 0, gameId: null };

  static lastReportedProgress = 0;
  static currentDownloadProgressCallback(progress, gameId) {
    const integerProgress = Math.floor(progress);

    if (integerProgress % 5 === 0 && integerProgress > Games.lastReportedProgress) {
      console.log(`Прогресс установки: ${progress.toFixed(2)}%`);
      Games.lastReportedProgress = integerProgress;
    }

    Games.globalCurrentDownloadProgress = { progress: progress.toFixed(2), gameId: Games.currentGameDownloadObject.id }
  }

  /**
   * Запускает игру
   * @param {number} gameId - ID игры
   * @returns {ChildProcess|null} - Процесс игры или null при ошибке
   */
  static async launchGame(gameId) {
    try {
      if (Games.runningGames.has(gameId)) {
        console.warn(`[GAMES] Игра ${gameId} уже запущена`);
        return null;
      }

      const installedGame = GameCollection.getInstalledGameById(gameId);
      if (!installedGame) {
        console.error(`[GAMES] Игра ${gameId} не найдена среди установленных`);
        windowManager.send('callback-universal', { event: "gameLaunchFailed", gameId: gameId, error: 'Game not installed' });
        return null;
      }

      const gameInfo = await Games.gameInstalledInfo(gameId);
      const gamePath = gameInfo.executablePath.exe;
      const gamePathDir = gameInfo.installPath;

      if (!gamePath || !fs.existsSync(gamePath)) {
        console.error(`[GAMES] Исполняемый файл не найден: ${gamePath}`);
        windowManager.send('callback-universal', { event: "gameLaunchFailed", gameId: gameId, error: 'Executable not found' });
        return null;
      }

      console.log(`[GAMES] Запуск игры ${installedGame.title} (ID: ${gameId})`);

      const gameProcess = spawn(gamePath, [], {
        cwd: gamePathDir,
        stdio: 'inherit',
        windowsVerbatimArguments: true,
        detached: false
      });

      Games.runningGames.set(gameId, {
        process: gameProcess,
        gameId: gameId,
        gameTitle: installedGame.title,
        startTime: Date.now()
      });

      windowManager.send('callback-universal', {
        event: "gameLaunched",
        gameId: gameId,
        gameTitle: installedGame.title,
        runningGames: Games.getRunningGamesList()
      });

      console.log(`[GAMES] ✓ Игра запущена: ${installedGame.title} (PID: ${gameProcess.pid})`);

      const currentDate = new Date();
      GameCollection.updateGameField(gameId, 'lastPlayDate', currentDate);

      const gameForSaving = GameCollection.getInstalledGameById(gameId);
      const drivePath = gameForSaving.installPath.split(path.sep)[0] + path.sep;
      this.saveGameInfo(gameId, gameForSaving, drivePath);

      console.log(`[GAMES] ✓ Дата последнего запуска обновлена для игры ${gameId}`);

      gameProcess.on('error', (err) => {
        console.error(`[GAMES] ✗ Ошибка запуска игры ${gameId}:`, err);
        
        Games.runningGames.delete(gameId);
        
        windowManager.send('callback-universal', { 
          event: "gameLaunchFailed",
          gameId: gameId, 
          gameTitle: installedGame.title,
          error: err.message,
          runningGames: Games.getRunningGamesList()
        });
      });

      gameProcess.on('close', (code) => {
        const gameData = Games.runningGames.get(gameId);
        const playTime = gameData ? Math.floor((Date.now() - gameData.startTime) / 1000) : 0;
        
        console.log(`[GAMES] Игра ${installedGame.title} закрылась с кодом: ${code}, время игры: ${playTime}s`);
        
        Games.runningGames.delete(gameId);
        
        windowManager.send('callback-universal', { 
          event: "gameClosed",
          gameId: gameId,
          gameTitle: installedGame.title,
          exitCode: code,
          playTime: playTime,
          runningGames: Games.getRunningGamesList()
        });
      });

      return gameProcess;
    } catch (error) {
      console.error(`[GAMES] ✗ Критическая ошибка при запуске игры ${gameId}:`, error);
      
      Games.runningGames.delete(gameId);
      
      windowManager.send('callback-universal', { 
        event: "gameLaunchFailed",
        gameId: gameId, 
        error: error.message,
        runningGames: Games.getRunningGamesList()
      });
      
      return null;
    }
  }

  /**
   * Закрывает запущенную игру
   * @param {number} gameId - ID игры
   * @returns {boolean} - Успешность операции
   */
  static closeGame(gameId) {
    try {
      const gameData = Games.runningGames.get(gameId);
      
      if (!gameData) {
        console.warn(`[GAMES] Игра ${gameId} не запущена`);
        return false;
      }

      const { process, gameTitle } = gameData;

      console.log(`[GAMES] Закрытие игры ${gameTitle} (ID: ${gameId}, PID: ${process.pid})`);

      if (process.kill()) {
        console.log(`[GAMES] ✓ Сигнал завершения отправлен игре ${gameTitle}`);
        
        setTimeout(() => {
          if (Games.runningGames.has(gameId)) {
            console.warn(`[GAMES] Принудительное завершение игры ${gameTitle}`);
            try {
              process.kill('SIGKILL');
            } catch (err) {
              console.error(`[GAMES] Ошибка принудительного завершения:`, err);
            }
          }
        }, 5000);

        return true;
      } else {
        console.error(`[GAMES] ✗ Не удалось отправить сигнал завершения игре ${gameTitle}`);
        return false;
      }
    } catch (error) {
      console.error(`[GAMES] ✗ Ошибка при закрытии игры ${gameId}:`, error);
      
      Games.runningGames.delete(gameId);
      
      return false;
    }
  }

  /**
   * Получает список запущенных игр
   * @returns {Array} - Массив объектов с информацией о запущенных играх
   */
  static getRunningGamesList() {
    return Array.from(Games.runningGames.values()).map(gameData => ({
      gameId: gameData.gameId,
      gameTitle: gameData.gameTitle,
      pid: gameData.process.pid,
      startTime: gameData.startTime,
      playTime: Math.floor((Date.now() - gameData.startTime) / 1000)
    }));
  }

  /**
   * Проверяет, запущена ли игра
   * @param {number} gameId - ID игры
   * @returns {boolean}
   */
  static isGameRunning(gameId) {
    return Games.runningGames.has(gameId);
  }

  /**
   * Получает информацию об установленной игре
   * @param {object} game - Объект игры
   * @returns {object} - { isInstalled, installPath, executablePath }
   */
    static async gameInstalledInfo(gameId) {
    let installedGame = GameCollection.getInstalledGameById(gameId);

    await this.scanInstalledGames();
    
    // Повторно проверяем после сканирования
    installedGame = GameCollection.getInstalledGameById(gameId);

    if (installedGame) {
        return {
        isInstalled: true,
        installPath: installedGame.installPath,
        executablePath: installedGame.executablePath
        };
    }

    return { 
        isInstalled: false, 
        installPath: "", 
        executablePath: ""
    };
    }

  /**
   * Сканирует все диски в поисках установленных игр
   * Загружает информацию из HornyLibrary/gamesInfo/*.json
   */
  static async scanInstalledGames() {
    try {
      console.log('[GAMES] Начало сканирования установленных игр...');
      
      const disks = await osUtils.getDisks();
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

              const gameInstallPath = path.join(disk, 'HornyLibrary', 'games', Games.createSafeFolderName(gameInfo.title))
              
              // Проверяем, что папка с игрой всё ещё существует
              if (gameInstallPath && fs.existsSync(gameInstallPath)) {
                // Проверяем, что исполняемый файл существует
                const fullExePath = await Games.findMainExecutable(gameInstallPath, gameInfo.title, gameInfo.exe_name, gameInfo.engine);
                if (fs.existsSync(fullExePath.exe)) {
                  
                  // Загружаем метаданные из отдельного хранилища
                  const metadata = GamesMetadata.getGameMetadata(gameInfo.id);

                  const gameObject = {
                    ...gameInfo,
                    isInstalled: true,
                    installPath: gameInstallPath,
                    executablePath: fullExePath,
                    // Применяем метаданные если они есть
                    lastPlayDate: metadata?.lastPlayDate || gameInfo.lastPlayDate || null,
                    playtime: metadata?.playtime || gameInfo.playtime || null
                  }
                  
                  GameCollection.addOrUpdateInstalledGame(gameObject);
                  totalFound++;
                  console.log(`[GAMES] Найдена игра: ${gameInfo.title} (ID: ${gameInfo.id})`);
                } else {
                  console.warn(`[GAMES] Исполняемый файл не найден для игры ${gameInfo.title}`);
                }
              } else {
                console.warn(`[GAMES] Папка установки не найдена для игры с ID ${gameInfo.id}`);
              }
            } catch (fileError) {
              console.error(`[GAMES] Ошибка чтения файла ${file}:`, fileError);
            }
          }
        } catch (diskError) {
          console.warn(`[GAMES] Ошибка сканирования диска ${disk}:`, diskError.message);
        }
      }

      console.log(`[GAMES] Сканирование завершено. Найдено игр: ${totalFound}`);
    } catch (error) {
      console.error('[GAMES] Ошибка при сканировании установленных игр:', error);
    }
  }

  /**
   * Сохраняет информацию об игре в JSON файл
   * @param {number} gameId - ID игры
   * @param {object} gameData - Данные игры
   * @param {string} drivePath - Путь к диску
   */
  static saveGameInfo(gameId, gameData, drivePath) {
    try {
      const gamesInfoPath = path.join(drivePath, 'HornyLibrary', 'gamesInfo');
      
      if (!fs.existsSync(gamesInfoPath)) {
        fs.mkdirSync(gamesInfoPath, { recursive: true });
      }

      const filePath = path.join(gamesInfoPath, `${gameId}.json`);
      
      // Создаем копию данных без служебных полей
      const { isInstalled, installPath, executablePath, ...cleanData } = gameData;
      
      fs.writeFileSync(filePath, JSON.stringify(cleanData, null, 2), 'utf8');
      console.log(`[GAMES] Информация об игре ${gameId} сохранена в ${filePath}`);
    } catch (error) {
      console.error(`[GAMES] Ошибка сохранения информации об игре ${gameId}:`, error);
    }
  }

  /**
   * Удаляет информацию об игре из JSON файла
   * @param {number} gameId - ID игры
   * @param {string} drivePath - Путь к диску
   */
  static deleteGameInfo(gameId, drivePath) {
    try {
      const gamesInfoPath = path.join(drivePath, 'HornyLibrary', 'gamesInfo');
      const filePath = path.join(gamesInfoPath, `${gameId}.json`);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[GAMES] Информация об игре ${gameId} удалена из ${filePath}`);
      }
    } catch (error) {
      console.error(`[GAMES] Ошибка удаления информации об игре ${gameId}:`, error);
    }
  }

  static async updateGames() {
    try {
      const response = await fetch(URLS.myLibrary + globalUtils.getLangParamForContent(), {
        headers: { 'Cookie': Auth.getCookie() }
      });

      const data = await response.json();

      if (!Array.isArray(data)) {
        console.warn(`[GAMES] ${LanguageVariables.getMessage('INCURRECT_SERVER_ANSWER', 'errors')}`);
        return;
      }

      // Подготавливаем серверные данные
      const serverGames = data.map(game => ({
        ...game,
        size: null,
        // Не перезаписываем lastPlayDate если он есть на сервере
        lastPlayDate: game.lastPlayDate || null,
        playtime: game.playtime ? (game.playtime / 60).toFixed(1) : null,
        isInstalled: false,
        installPath: "",
        executablePath: ""
      }));

      // Объединяем с данными установленных игр
      GameCollection.mergeWithServerData(serverGames);

      console.log(`[GAMES] Обновлено: ${data.length} игр с сервера.`);
    } catch (err) {
      console.warn(`[GAMES] ${LanguageVariables.getMessage('UPDATE_GAME_LIST', 'errors')}`, err);
    }
  }

  static async loadComments(gameId) {
    try {
      const response = await fetch(URLS.comments + gameId + globalUtils.getLangParamForContent(), {
        headers: { 'Cookie': Auth.getCookie() }
      });

      const data = await response.json();

      if (!Array.isArray(data)) {
        console.warn(`[GAMES] ${LanguageVariables.getMessage('INCURRECT_SERVER_ANSWER', 'errors')}`);
        return [];
      }

      GameCollection.deleteCommentsByGameId(gameId);
      data.forEach(comment => {
        GameCollection.addComment(comment);
      });

      //console.log(`[GAMES] Загружено ${data.length} комментариев для игры ${gameId}.`);

      return data;
    } catch (err) {
      console.warn(`[GAMES] Ошибка загрузки комментариев для игры ${gameId}:`, err);
      return [];
    }
  }

  static getGameComments(gameId) {
    return GameCollection.getCommentsByGameId(gameId);
  }

  /**
   * Добавляет комментарий к игре
   * @param {number} gameId - ID игры
   * @param {string} content - Текст комментария (макс 256 символов)
   * @returns {Promise<Object>} - Результат добавления комментария
   */
  static async addComment(gameId, content) {
    try {
      if (!AppVariables.isOnline) {
        return { success: false, error: 'Нет интернет соединения' };
      }

      if (!content || content.trim().length === 0) {
        return { success: false, error: 'Комментарий не может быть пустым' };
      }

      if (content.length > 256) {
        return { success: false, error: 'Комментарий слишком длинный (максимум 256 символов)' };
      }

      const response = await fetch(`${SERVER_URL}/comments/add_comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': Auth.getCookie()
        },
        body: JSON.stringify({
          gameId: gameId,
          content: content.trim()
        })
      });

      const data = await response.json();

      if (data.success) {
        console.log(`[GAMES] Комментарий успешно добавлен к игре ${gameId}`);
        return { success: true, commentId: data.commentId };
      } else {
        return { success: false, error: data.error || 'Неизвестная ошибка' };
      }
    } catch (err) {
      console.error(`[GAMES] Ошибка добавления комментария:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Удаляет комментарий (только свой)
   * @param {number} commentId - ID комментария
   * @returns {Promise<Object>} - Результат удаления
   */
  static async deleteComment(commentId) {
    try {
      if (!AppVariables.isOnline) {
        return { success: false, error: 'Нет интернет соединения' };
      }

      const response = await fetch(`${SERVER_URL}/comments/${commentId}`, {
        method: 'DELETE',
        headers: {
          'Cookie': Auth.getCookie()
        }
      });

      const data = await response.json();

      if (data.success) {
        console.log(`[GAMES] Комментарий ${commentId} успешно удалён`);
        return { success: true };
      } else {
        return { success: false, error: data.error || 'Нет прав на удаление' };
      }
    } catch (err) {
      console.error(`[GAMES] Ошибка удаления комментария:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Удаляет игру с диска и из коллекции
   * @param {number} gameId - ID игры
   * @returns {Promise<Object>} - Результат удаления
   */
  static async deleteGame(gameId) {
    try {
      const installedGame = GameCollection.getInstalledGameById(gameId);
      
      if (!installedGame) {
        return { success: false, error: 'Игра не установлена' };
      }

      const gameInfo = await this.gameInstalledInfo(gameId);
      const installPath = gameInfo.installPath;
      const drivePath = installPath.split(path.sep)[0] + path.sep;
      const gameTitle = installedGame.title;

      console.log(`[GAMES] Удаление игры ${gameTitle} (ID: ${gameId}) из ${installPath}`);

      // Закрываем игру если она запущена
      if (Games.runningGames.has(gameId)) {
        await this.closeGame(gameId);
      }

      // Удаляем ярлыки
      await this.deleteDesktopShortcut(gameTitle);
      await this.deleteStartMenuShortcut(gameTitle);

      // Удаляем папку игры
      if (fs.existsSync(installPath)) {
        await fs.promises.rm(installPath, { recursive: true, force: true });
        console.log(`[GAMES] Папка игры удалена: ${installPath}`);
      }

      // Удаляем JSON файл с информацией об игре
      this.deleteGameInfo(gameId, drivePath);

      // Удаляем локальные изображения
      gameImagesManager.deleteGameImages(drivePath, gameId);

      // Удаляем из коллекции установленных игр
      GameCollection.removeInstalledGame(gameId);
      GameCollection.saveInstalledGames();

      console.log(`[GAMES] Игра ${gameId} успешно удалена`);
      return { success: true };
    } catch (err) {
      console.error(`[GAMES] Ошибка удаления игры:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Удаляет ярлык с рабочего стола
   */
  static async deleteDesktopShortcut(shortcutName) {
    try {
      let desktopPath = path.join(os.homedir(), 'Desktop');
      
      // Проверяем альтернативный путь (OneDrive Desktop)
      if (!fs.existsSync(desktopPath)) {
        const oneDriveDesktop = path.join(os.homedir(), 'OneDrive', 'Desktop');
        if (fs.existsSync(oneDriveDesktop)) {
          desktopPath = oneDriveDesktop;
        }
      }
      
      const shortcutPath = path.join(desktopPath, `${shortcutName}.lnk`);
      
      if (fs.existsSync(shortcutPath)) {
        fs.unlinkSync(shortcutPath);
        console.log(`[GAMES] Ярлык удалён с рабочего стола: ${shortcutPath}`);
        return true;
      } else {
        console.log(`[GAMES] Ярлык на рабочем столе не найден: ${shortcutPath}`);
        return false;
      }
    } catch (error) {
      console.error(`[GAMES] Ошибка удаления ярлыка с рабочего стола:`, error);
      return false;
    }
  }

  /**
   * Удаляет ярлык из меню "Пуск"
   */
  static async deleteStartMenuShortcut(shortcutName) {
    try {
      const startMenuPath = path.join(
        os.homedir(), 
        'AppData', 
        'Roaming', 
        'Microsoft', 
        'Windows', 
        'Start Menu', 
        'Programs',
        'HornyLibrary'
      );
      
      const shortcutPath = path.join(startMenuPath, `${shortcutName}.lnk`);
      
      if (fs.existsSync(shortcutPath)) {
        fs.unlinkSync(shortcutPath);
        console.log(`[GAMES] Ярлык удалён из меню Пуск: ${shortcutPath}`);
        
        // Проверяем, пуста ли папка HornyLibrary, и удаляем её если пуста
        try {
          const files = fs.readdirSync(startMenuPath);
          if (files.length === 0) {
            fs.rmdirSync(startMenuPath);
            console.log(`[GAMES] Папка HornyLibrary удалена из меню Пуск`);
          }
        } catch (err) {
          // Игнорируем ошибки при проверке/удалении папки
        }
        
        return true;
      } else {
        console.log(`[GAMES] Ярлык в меню Пуск не найден: ${shortcutPath}`);
        return false;
      }
    } catch (error) {
      console.error(`[GAMES] Ошибка удаления ярлыка из меню Пуск:`, error);
      return false;
    }
  }

  /**
   * Создает ярлык на рабочем столе
   */
  static async createDesktopShortcut(targetPath, shortcutName) {
    try {
      const normalizedPath = path.normalize(targetPath);
      
      if (!fs.existsSync(normalizedPath)) {
        console.error(`[GAMES] Файл не существует: ${normalizedPath}`);
        return false;
      }
      
      let desktopPath = path.join(os.homedir(), 'Desktop');
      
      // Проверяем существование папки Desktop
      if (!fs.existsSync(desktopPath)) {
        console.error(`[GAMES] Папка Desktop не найдена: ${desktopPath}`);
        // Попробуем альтернативный путь (OneDrive Desktop)
        const oneDriveDesktop = path.join(os.homedir(), 'OneDrive', 'Desktop');
        if (fs.existsSync(oneDriveDesktop)) {
          console.log(`[GAMES] Используем OneDrive Desktop: ${oneDriveDesktop}`);
          desktopPath = oneDriveDesktop;
        } else {
          return false;
        }
      }
      
      const shortcutPath = path.join(desktopPath, `${shortcutName}.lnk`);
      
      console.log(`[GAMES] Создание ярлыка: ${normalizedPath} -> ${shortcutPath}`);
      
      return new Promise((resolve) => {
        ws.create(shortcutPath, {
          target: normalizedPath,
          workingDir: path.dirname(normalizedPath),
          description: shortcutName
        }, (error) => {
          if (error) {
            console.error(`[GAMES] Ошибка создания ярлыка:`, error);
            resolve(false);
          } else {
            // Дополнительная проверка, что файл действительно создан
            if (fs.existsSync(shortcutPath)) {
              console.log(`[GAMES] Ярлык создан на рабочем столе: ${shortcutPath}`);
              resolve(true);
            } else {
              console.error(`[GAMES] Ярлык не найден после создания: ${shortcutPath}`);
              resolve(false);
            }
          }
        });
      });
    } catch (error) {
      console.error(`[GAMES] Ошибка:`, error);
      return false;
    }
  }

  /**
   * Создает ярлык в меню "Пуск"
   */
  static async createStartMenuShortcut(targetPath, shortcutName) {
    try {
      const normalizedPath = path.normalize(targetPath);
      
      if (!fs.existsSync(normalizedPath)) {
        console.error(`[GAMES] Файл не существует: ${normalizedPath}`);
        return false;
      }
      
      const startMenuPath = path.join(
        os.homedir(), 
        'AppData', 
        'Roaming', 
        'Microsoft', 
        'Windows', 
        'Start Menu', 
        'Programs',
        'HornyLibrary'
      );
      
      if (!fs.existsSync(startMenuPath)) {
        fs.mkdirSync(startMenuPath, { recursive: true });
      }
      
      const shortcutPath = path.join(startMenuPath, `${shortcutName}.lnk`);
      
      console.log(`[GAMES] Создание ярлыка: ${normalizedPath} -> ${shortcutPath}`);
      
      return new Promise((resolve) => {
        ws.create(shortcutPath, {
          target: normalizedPath,
          workingDir: path.dirname(normalizedPath),
          description: shortcutName
        }, (error) => {
          if (error) {
            console.error(`[GAMES] Ошибка создания ярлыка:`, error);
            resolve(false);
          } else {
            console.log(`[GAMES] Ярлык создан в меню Пуск`);
            resolve(true);
          }
        });
      });
    } catch (error) {
      console.error(`[GAMES] Ошибка:`, error);
      return false;
    }
  }

  /**
   * Находит главный исполняемый файл игры
   * @param {string} gamePath - Путь к папке с игрой
   * @returns {string|null} - Путь к .exe файлу или null : { exe: null, engine: 'Unknown' }
   */
  static async findMainExecutable(folderPath, gameTitle, db_exe, engine, maxDepth = 3) {
    // 1. Рекурсивно собираем все EXE файлы
    const exeFiles = [];
    const engineIndicators = {
      rpg: false,
      unity: false,
      renpy: false,
      unreal: false,
      godot: false,
      java: false,
      flash: false
    };
    
    const scanDirectory = (currentPath, currentDepth) => {
      if (currentDepth > maxDepth) return;
      
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          
          // Пропускаем символические ссылки и системные папки
          if (entry.isSymbolicLink() || shouldSkipDirectory(entry.name)) {
            continue;
          }
          
          if (entry.isDirectory()) {
            // Рекурсивно сканируем подпапки
            scanDirectory(fullPath, currentDepth + 1);
          } else if (entry.isFile()) {
            const lowerName = entry.name.toLowerCase();
            
            // Собираем EXE файлы
            if (lowerName.endsWith('.exe')) {
              try {
                const stats = fs.statSync(fullPath);
                exeFiles.push({
                  name: entry.name,
                  path: fullPath,
                  relativePath: path.relative(folderPath, fullPath),
                  lower: lowerName,
                  size: stats.size,
                  depth: currentDepth
                });
              } catch (err) {
                // Пропускаем файлы с ошибкой доступа
              }
            }
            
            // Проверяем индикаторы движков
            if (lowerName === 'rpg_rt.exe' || lowerName.endsWith('.rgssad') || lowerName.endsWith('.rvproj')) {
              engineIndicators.rpg = true;
            }
            if (lowerName === 'unityplayer.dll' || lowerName === 'mono-2.0-bdwgc.dll') {
              engineIndicators.unity = true;
            }
            if (lowerName.includes('-shipping.exe')) {
              engineIndicators.unreal = true;
            }
            if (lowerName.endsWith('_pck.exe') || lowerName.endsWith('.pck')) {
              engineIndicators.godot = true;
            }
            if (lowerName.endsWith('.swf')) {
              engineIndicators.flash = true;
            }
          }
        }
      } catch (err) {
        // Пропускаем папки с ошибкой доступа
      }
    };
    
    // Список папок, которые не нужно сканировать
    const shouldSkipDirectory = (dirName) => {
      const skipList = ['node_modules', '.git', '__pycache__', 'temp', 'tmp', 'cache'];
      return skipList.includes(dirName.toLowerCase());
    };
    
    // Проверяем специфичные для Ren'Py и Java папки
    const checkSpecialDirectories = () => {
      const renPyLibPath = path.join(folderPath, 'lib', 'python2.7');
      if (fs.existsSync(renPyLibPath)) {
        engineIndicators.renpy = true;
      }
      
      const hasJRE = findDirectoryRecursively(folderPath, 'jre', maxDepth);
      if (hasJRE) {
        engineIndicators.java = true;
      }
    };
    
    const findDirectoryRecursively = (startPath, targetName, maxDepth) => {
      const search = (currentPath, depth) => {
        if (depth > maxDepth) return false;
        try {
          const entries = fs.readdirSync(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name.toLowerCase() === targetName.toLowerCase()) {
              return true;
            }
            if (entry.isDirectory()) {
              const found = search(path.join(currentPath, entry.name), depth + 1);
              if (found) return true;
            }
          }
        } catch (err) {}
        return false;
      };
      return search(startPath, 0);
    };
    
    // Запускаем сканирование
    scanDirectory(folderPath, 0);
    checkSpecialDirectories();
    
    if (exeFiles.length === 0) {
      return { exe: null, engine: 'Unknown' };
    }
    
    // 2. Поиск по точному имени из БД (приоритет)
    if (db_exe) {
      const dbMatch = exeFiles.find(f => f.lower === db_exe.toLowerCase());
      if (dbMatch) {
        return { exe: dbMatch.path, engine: engine || 'Unknown' };
      }
    }
    
    // 3. Логика определения по движку (с учётом найденных индикаторов)
    const safeTitle = gameTitle.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    
    // Вспомогательная функция для поиска EXE по ключевым словам
    const findExeByKeywords = (keywords, avoidPatterns = []) => {
      const matches = exeFiles.filter(f => {
        const name = f.lower.replace(/[^a-zA-Z0-9]/g, '');
        const hasKeyword = keywords.some(kw => name.includes(kw));
        const hasAvoid = avoidPatterns.some(pat => f.lower.includes(pat));
        return hasKeyword && !hasAvoid;
      });
      // Сортируем: более крупные файлы и меньшая глубина в приоритете
      return matches.sort((a, b) => (b.size - a.size) || (a.depth - b.depth))[0];
    };
    
    if (engineIndicators.rpg) {
      const rpgKeywords = ['game', 'rpg_rt'];
      const match = findExeByKeywords(rpgKeywords);
      if (match) return { exe: match.path, engine: 'RPG Maker' };
    }
    
    if (engineIndicators.unity) {
      const unityMatch = findExeByKeywords([safeTitle], ['unitycrashhandler', 'unityplayer']);
      if (unityMatch) return { exe: unityMatch.path, engine: 'Unity' };
      
      // Если не нашли по названию, ищем x64 exe
      const x64 = exeFiles.find(f => f.lower.includes('64.exe') && !f.lower.includes('unity'));
      if (x64) return { exe: x64.path, engine: 'Unity' };
    }
    
    if (engineIndicators.renpy) {
      const renpyMatch = findExeByKeywords(['game'], ['python', 'lib']);
      if (renpyMatch) return { exe: renpyMatch.path, engine: 'Ren\'Py' };
    }
    
    if (engineIndicators.unreal) {
      const shipping = exeFiles.find(f => f.lower.includes('-shipping.exe'));
      if (shipping) return { exe: shipping.path, engine: 'Unreal Engine' };
    }
    
    if (engineIndicators.godot) {
      const godotExe = exeFiles.find(f => f.lower.endsWith('_pck.exe'));
      if (godotExe) return { exe: godotExe.path, engine: 'Godot' };
    }
    
    if (engineIndicators.java) {
      const javaKeywords = ['game', 'start', 'launcher'];
      const javaMatch = findExeByKeywords(javaKeywords);
      if (javaMatch) return { exe: javaMatch.path, engine: 'Java' };
    }
    
    if (engineIndicators.flash) {
      return { exe: exeFiles[0].path, engine: 'Flash' };
    }
    
    // 4. Если не нашли по движку, возвращаем самый крупный EXE в корневой папке
    const rootExeFiles = exeFiles.filter(f => f.depth === 0);
    if (rootExeFiles.length > 0) {
      const largestRoot = rootExeFiles.reduce((max, f) => f.size > max.size ? f : max);
      return { exe: largestRoot.path, engine: 'Unknown' };
    }
    
    // 5. Последний шанс: самый крупный EXE из всех найденных
    const largest = exeFiles.reduce((max, f) => f.size > max.size ? f : max);
    return { exe: largest.path, engine: 'Unknown' };
  }

  /**
   * Создает безопасное имя папки из названия игры
   * @param {string} gameTitle - Название игры
   * @returns {string} - Безопасное имя папки
   */
  static createSafeFolderName(gameTitle) {
    return gameTitle
      .replace(/[^a-zA-Z0-9а-яА-Я\s_-]/g, '') // Удаляем спецсимволы
      .replace(/\s+/g, '_') // Пробелы в подчеркивания
      .substring(0, 100); // Ограничиваем длину
  }

  /**
   * Загружает и устанавливает игру
   * @param {boolean} createDesktopShortcut - Создать ярлык на рабочем столе
   * @param {boolean} createStartMenuShortcut - Создать ярлык в меню Пуск
   * @param {string} drivePath - Диск для установки (например, "E:")
   * @param {number} gameId - ID игры
   * @param {string} gameTitle - Название игры
   * @param {function} progressCallback - Колбэк для обновления прогресса (0-100)
   */
  static async downloadAndInstallGame(
    createDesktopShortcut, 
    createStartMenuShortcut, 
    drivePath, 
    gameId, 
    gameTitle,
    progressCallback = null
  ) {
    try {
      console.log(`[GAMES] Начинается установка игры: ${gameTitle} (ID: ${gameId})`);
      this.downloading = true;
      
      // Получаем информацию об игре
      const game = GameCollection.getGameById(gameId);
      if (!game) {
        this.downloading = false;
        throw new Error(`Игра с ID ${gameId} не найдена`);
      }

      const fileKey = game.download_link;
      if (!fileKey) {
        this.downloading = false;
        throw new Error(`Ссылка для загрузки игры ${gameTitle} не найдена`);
      }

      Games.currentGameDownloadObject = game;

      // Проверяем и создаем структуру папок
      const basePath = path.join(drivePath, 'HornyLibrary', 'games');
      if (!fs.existsSync(basePath)) {
        console.log(`[GAMES] Создание директории: ${basePath}`);
        fs.mkdirSync(basePath, { recursive: true });
      }

      // Создаем безопасное имя папки для игры
      const safeFolderName = this.createSafeFolderName(gameTitle);
      const gamePath = path.join(basePath, safeFolderName);
      
      if (!fs.existsSync(gamePath)) {
        fs.mkdirSync(gamePath, { recursive: true });
      }

      // Пути для временных файлов
      const tempDir = path.join(gamePath, '.temp');
      const archivePath = path.join(tempDir, 'game.zip');

      console.log(`[GAMES] Путь установки: ${gamePath}`);
      console.log(`[GAMES] Временная папка: ${tempDir}`);

      // Устанавливаем колбэк прогресса
      if (progressCallback) {
        setProgressCallback(progressCallback);
      }

      // Скачиваем файл (0-70% прогресса)
      console.log(`[GAMES] Начинается загрузка файла...`);
      await downloadFile(fileKey, archivePath, tempDir, game.storage_url);

      // Распаковываем архив (70-100% прогресса)
      console.log(`[GAMES] Начинается распаковка архива...`);
      await extractArchive(archivePath, gamePath);

      // Удаляем временные файлы
      console.log(`[GAMES] Очистка временных файлов...`);
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      // Ищем главный исполняемый файл
      const exeInfo = await this.findMainExecutable(gamePath, gameTitle, game.exe_name, game.engine);
      
      // Создаем ярлыки если нужно
      if (exeInfo.exe) {
        if (createDesktopShortcut) {
          await this.createDesktopShortcut(exeInfo.exe, gameTitle);
        }

        if (createStartMenuShortcut) {
          await this.createStartMenuShortcut(exeInfo.exe, gameTitle);
        }
      }

      // Обновляем информацию об установленной игре
      const installedGameData = {
        ...game,
        isInstalled: true,
        installPath: gamePath,
        executablePath: exeInfo.exe,
        engine: exeInfo.engine
      };

      // Сохраняем в коллекцию (автоматически сохранит в файл)
      GameCollection.addOrUpdateInstalledGame(installedGameData);

      // Сохраняем информацию в JSON файл (для совместимости)
      this.saveGameInfo(gameId, game, drivePath);
      
      // Сохраняем изображения игры локально
      if (game.images && game.images.length > 0) {
        try {
          console.log(`[GAMES] Сохранение изображений игры ${gameTitle}...`);
          await gameImagesManager.saveGameImages(drivePath, gameId, game.images);
        } catch (imgError) {
          console.warn(`[GAMES] Не удалось сохранить изображения: ${imgError.message}`);
        }
      }

      console.log(`[GAMES] ✓ Игра успешно установлена: ${gameTitle}`);

      windowManager.send('callback-universal', { event: "gameInstalled", gameId: gameId });
      
      // Сбрасываем данные загрузки после успешной установки
      Games.clearDownloadingData();
      
      return {
        success: true,
        gamePath: gamePath,
        executablePath: exeInfo.exe
      };

    } catch (error) {
      console.error(`[GAMES] Ошибка установки игры ${gameTitle}:`, error);

      // Сбрасываем данные загрузки при ошибке
      Games.clearDownloadingData();
      
      throw error;
    }
  }

  /**
   * Удаляет игру из системы
   * @param {number} gameId - ID игры
   */
  static async uninstallGame(gameId) {
    try {
      // Проверяем, не запущена ли игра
      if (Games.isGameRunning(gameId)) {
        console.warn(`[GAMES] Игра ${gameId} запущена, закрываем перед удалением...`);
        Games.closeGame(gameId);
        
        // Даем время на закрытие
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const installedGame = GameCollection.getInstalledGameById(gameId);
      
      if (!installedGame) {
        throw new Error(`Установленная игра с ID ${gameId} не найдена`);
      }

      const { installPath } = installedGame;
      
      // Удаляем папку с игрой
      if (fs.existsSync(installPath)) {
        fs.rmSync(installPath, { recursive: true, force: true });
        console.log(`[GAMES] Папка игры удалена: ${installPath}`);
      }

      // Определяем диск для удаления JSON файла
      const drivePath = installPath.split(path.sep)[0] + path.sep;
      
      // Удаляем JSON файл
      this.deleteGameInfo(gameId, drivePath);
      
      // Удаляем локальные изображения
      await gameImagesManager.deleteGameImages(gameId);

      // Удаляем из коллекции (автоматически сохранит изменения)
      GameCollection.removeInstalledGame(gameId);

      console.log(`[GAMES] ✓ Игра успешно удалена: ID ${gameId}`);
      
      return { success: true };
    } catch (error) {
      console.error(`[GAMES] Ошибка удаления игры ${gameId}:`, error);
      throw error;
    }
  }

  static downloadGamePause(gameId) {
    pauseDownload();
    Games.downloadingPause = true;
  }

  static downloadGameResume(gameId) {
    Games.downloadingPause = false;
    resumeDownload();
  }

  static downloadGameCansel(gameId) {
    stopDownload();
    Games.clearDownloadingData();
  }

  static clearDownloadingData() {
    Games.globalCurrentDownloadProgress = { progress: 0, gameId: null };
    Games.downloading = false;
    Games.downloadingPause = false;
    Games.currentGameDownloadObject = null;
  }
}

module.exports = Games