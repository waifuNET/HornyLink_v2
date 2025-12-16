const { GameCollection, LanguageVariables, InstalledGamesInfo } = require('../../state');
const { Auth } = require('../auth/auth');
const { fetch } = require('../../utils/internetUtils');
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

const URLS = {
    myLibrary: 'https://api.hornylink.ru/library/',
    comments: 'https://api.hornylink.ru/comments/comment/'
}

class Games {
    static async Init(){
        await this.updateGames();
        await this.scanInstalledGames();
    }

    // Список запущенных игр: Map<gameId, { process, gameId, gameTitle }>
    static runningGames = new Map();

    static downloading = false;
    static downloadingPause = false;
    static currentGameDownloadObject = null;
    static globalCurrentDownloadProgress = { progress: 0, gameId: null };

    static lastReportedProgress = 0;
    static currentDownloadProgressCallback(progress, gameId){
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
    static launchGame(gameId) {
        try {
            // Проверяем, не запущена ли игра уже
            if (Games.runningGames.has(gameId)) {
                console.warn(`[GAMES] Игра ${gameId} уже запущена`);
                return null;
            }

            const installedGame = InstalledGamesInfo.getGameById(gameId);
            if (!installedGame) {
                console.error(`[GAMES] Игра ${gameId} не найдена среди установленных`);
                windowManager.send('callback-universal', { event: "gameLaunchFailed", gameId: gameId, error: 'Game not installed' });
                return null;
            }

            const gameInfo = Games.gameInstalledInfo(installedGame);
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

            // Добавляем в список запущенных
            Games.runningGames.set(gameId, {
                process: gameProcess,
                gameId: gameId,
                gameTitle: installedGame.title,
                startTime: Date.now()
            });

            // Отправляем уведомление о запуске
            windowManager.send('callback-', {
                event: "gameLaunched",
                gameId: gameId, 
                gameTitle: installedGame.title,
                runningGames: Games.getRunningGamesList()
            });

            console.log(`[GAMES] ✓ Игра запущена: ${installedGame.title} (PID: ${gameProcess.pid})`);

            const currentDate = new Date();
            InstalledGamesInfo.updateGameField(gameId, 'lastPlayDate', currentDate);
            GameCollection.updateGame(gameId, { lastPlayDate: currentDate });

            const gameForSaving = InstalledGamesInfo.getGameById(gameId);
            const drivePath = gameForSaving.installPath.split(path.sep)[0] + path.sep;
            this.saveGameInfo(gameId, gameForSaving, drivePath);

            console.log(`[GAMES] ✓ Дата последнего запуска обновлена для игры ${gameId}`);

            // Обработчик ошибок запуска
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

            // Обработчик закрытия игры
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

            // Попытка корректного завершения
            if (process.kill()) {
                console.log(`[GAMES] ✓ Сигнал завершения отправлен игре ${gameTitle}`);
                
                // Таймаут на принудительное завершение (5 секунд)
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
            
            // Удаляем из списка, даже если произошла ошибка
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
    static gameInstalledInfo(game){
        const installedGame = InstalledGamesInfo.getGameById(game.id);
        
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

                                    const gameObject = {
                                        ...gameInfo,
                                        isInstalled: true,
                                        installPath: gameInstallPath,
                                        executablePath: fullExePath
                                    }
                                    
                                    InstalledGamesInfo.addOrUpdateGame(gameObject);

                                    GameCollection.updateGame(gameInfo.id, gameObject);
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

    static async updateGames(){
        try{
            const response = await fetch(URLS.myLibrary + globalUtils.getLangParamForContent(), {
                headers: { 'Cookie': Auth.getCookie() }
            });

            const data = await response.json();

            if(!Array.isArray(data)){
                console.warn(`[GAMES] ${LanguageVariables.getMessage('INCURRECT_SERVER_ANSWER', 'errors')}`);
            }

            await Promise.all(data.map(async (game) => {
                game.size = null;
                game.lastPlayDate = null;
                game.playtime = (game.playtime / 60).toFixed(1);
                
                // Проверяем установлена ли игра
                const installedInfo = this.gameInstalledInfo(game);
                game.isInstalled = installedInfo.isInstalled;
                game.installPath = installedInfo.installPath;
                game.executablePath = installedInfo.executablePath;
                game.lastPlayDate = installedInfo.lastPlayDate;
                
                GameCollection.updateGame(game.id, game);
                return game;
            }));

            console.log(`[GAMES] Обновлено: ${data.length} игр.`);
        }
        catch (err) {
            console.warn(`[GAMES] ${LanguageVariables.getMessage('UPDATE_GAME_LIST', 'errors')}`, err);
        }
    }

    static async loadComments(gameId){
        try{
            const response = await fetch(URLS.comments + gameId + globalUtils.getLangParamForContent(), {
                headers: { 'Cookie': Auth.getCookie() }
            });

            const data = await response.json();

            if(!Array.isArray(data)){
                console.warn(`[GAMES] ${LanguageVariables.getMessage('INCURRECT_SERVER_ANSWER', 'errors')}`);
                return [];
            }

            GameCollection.deleteCommentsByGameId(gameId);
            data.forEach(comment => {
                GameCollection.addComment(comment);
            });

            console.log(`[GAMES] Загружено ${data.length} комментариев для игры ${gameId}.`);
            
            return data;
        }
        catch (err) {
            console.warn(`[GAMES] Ошибка загрузки комментариев для игры ${gameId}:`, err);
            return [];
        }
    }

    static getGameComments(gameId){
        return GameCollection.getCommentsByGameId(gameId);
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
            
            const desktopPath = path.join(os.homedir(), 'Desktop');
            
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

            // Сохраняем в state
            InstalledGamesInfo.addOrUpdateGame(installedGameData);
            
            // Обновляем в коллекции игр
            GameCollection.updateGame(gameId, installedGameData);

            windowManager.send('callback-universal', { event: "gameInstalled", gameId: gameId });

            // Сохраняем информацию в JSON файл (без служебных полей)
            this.saveGameInfo(gameId, game, drivePath);

            console.log(`[GAMES] ✓ Игра успешно установлена: ${gameTitle}`);

            this.downloading = false;
            
            return {
                success: true,
                gamePath: gamePath,
                executablePath: exeInfo.exe
            };

        } catch (error) {
            console.error(`[GAMES] Ошибка установки игры ${gameTitle}:`, error);

            this.downloading = false;
            
            // Сбрасываем прогресс
            if (progressCallback) {
                progressCallback(0);
            }
            
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

            const installedGame = InstalledGamesInfo.getGameById(gameId);
            
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

            // Удаляем из state
            InstalledGamesInfo.removeGame(gameId);

            // Обновляем информацию в коллекции игр
            const game = GameCollection.getGameById(gameId);
            if (game) {
                game.isInstalled = false;
                game.installPath = "";
                game.executablePath = "";
                GameCollection.updateGame(gameId, game);
            }

            console.log(`[GAMES] ✓ Игра успешно удалена: ID ${gameId}`);
            
            return { success: true };
        } catch (error) {
            console.error(`[GAMES] Ошибка удаления игры ${gameId}:`, error);
            throw error;
        }
    }

    static downloadGamePause(gameId){
        pauseDownload();
        Games.downloadingPause = true;
    }

    static downloadGameResume(gameId){
        Games.downloadingPause = false;
        resumeDownload();
    }

    static downloadGameCansel(gameId){
        stopDownload();
        Games.globalCurrentDownloadProgress = { progress: 0, gameId: null };
        Games.downloading = false;
        Games.downloadingPause = false;
        Games.currentGameDownloadObject = null;
    }
}

module.exports = Games