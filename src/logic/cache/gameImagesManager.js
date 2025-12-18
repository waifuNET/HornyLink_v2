/**
 * Game Images Manager
 * 
 * Управление локальными изображениями для установленных игр.
 * Изображения сохраняются в папку HornyLibrary/gameImages/{gameId}/
 * рядом с gameInfo на каждом диске.
 * 
 * При установке игры изображения скачиваются и сохраняются локально.
 * Локальные изображения имеют приоритет при офлайн режиме.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

/**
 * Скачивание файла с использованием встроенного https/http модуля
 */
function downloadImage(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, { timeout: timeoutMs }, (response) => {
      // Обрабатываем редиректы
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadImage(response.headers.location, timeoutMs)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });
      response.on('error', reject);
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

class GameImagesManager {
  constructor() {
    // Кэш локальных изображений в памяти
    this.localImagesCache = new Map(); // gameId -> { images: [...], logo: '...', icon: '...' }
    this._initialized = false;
  }

  /**
   * Инициализация менеджера
   */
  async init() {
    if (this._initialized) return;
    
    // Сканируем все диски и загружаем информацию о локальных изображениях
    await this._scanAllDisks();
    
    this._initialized = true;
    console.log(`[GameImages] Инициализирован. Загружено изображений для ${this.localImagesCache.size} игр`);
  }

  /**
   * Получение пути к папке изображений игры
   */
  getGameImagesPath(drivePath, gameId) {
    return path.join(drivePath, 'HornyLibrary', 'gameImages', String(gameId));
  }

  /**
   * Получение пути к метаданным изображений
   */
  getMetadataPath(drivePath, gameId) {
    return path.join(this.getGameImagesPath(drivePath, gameId), 'metadata.json');
  }

  /**
   * Сканирование всех дисков
   */
  async _scanAllDisks() {
    const disks = ['C:', 'D:', 'E:', 'F:', 'G:', 'H:'];
    
    for (const disk of disks) {
      try {
        const gameImagesRoot = path.join(disk, 'HornyLibrary', 'gameImages');
        
        if (!fs.existsSync(gameImagesRoot)) {
          continue;
        }
        
        const gameIds = fs.readdirSync(gameImagesRoot);
        
        for (const gameIdStr of gameIds) {
          const gameId = parseInt(gameIdStr);
          if (isNaN(gameId)) continue;
          
          const gamePath = path.join(gameImagesRoot, gameIdStr);
          if (!fs.statSync(gamePath).isDirectory()) continue;
          
          await this._loadGameImages(disk + path.sep, gameId);
        }
      } catch (error) {
        // Диск недоступен или ошибка - пропускаем
      }
    }
  }

  /**
   * Загрузка информации об изображениях игры
   */
  async _loadGameImages(drivePath, gameId) {
    const metadataPath = this.getMetadataPath(drivePath, gameId);
    
    try {
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        
        // Проверяем существование файлов
        const validImages = [];
        for (const img of metadata.images || []) {
          if (fs.existsSync(img.localPath)) {
            validImages.push(img);
          }
        }
        
        if (validImages.length > 0 || metadata.logo || metadata.icon) {
          this.localImagesCache.set(gameId, {
            drivePath,
            images: validImages,
            logo: metadata.logo && fs.existsSync(metadata.logo) ? metadata.logo : null,
            icon: metadata.icon && fs.existsSync(metadata.icon) ? metadata.icon : null,
            serverHashes: metadata.serverHashes || {},
            lastUpdate: metadata.lastUpdate || 0
          });
        }
      }
    } catch (error) {
      console.error(`[GameImages] Ошибка загрузки метаданных для игры ${gameId}:`, error.message);
    }
  }

  /**
   * Сохранение изображений для игры при установке
   * @param {string} drivePath - Путь к диску (например 'E:\')
   * @param {number} gameId - ID игры
   * @param {Array} imageUrls - Массив URL изображений с сервера
   */
  async saveGameImages(drivePath, gameId, imageUrls) {
    if (!imageUrls || imageUrls.length === 0) {
      console.log(`[GameImages] Нет изображений для сохранения (игра ${gameId})`);
      return;
    }
    
    const imagesPath = this.getGameImagesPath(drivePath, gameId);
    
    // Создаём директорию
    if (!fs.existsSync(imagesPath)) {
      fs.mkdirSync(imagesPath, { recursive: true });
    }
    
    const savedImages = [];
    let logoPath = null;
    let iconPath = null;
    const serverHashes = {};
    
    console.log(`[GameImages] Сохранение ${imageUrls.length} изображений для игры ${gameId}...`);
    
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      
      try {
        // Используем встроенный https модуль для надёжного скачивания
        const buffer = await downloadImage(url, 30000);
        
        const hash = crypto.createHash('md5').update(buffer).digest('hex');
        const ext = this._getExtFromUrl(url);
        const filename = `image_${i}${ext}`;
        const localPath = path.join(imagesPath, filename);
        
        fs.writeFileSync(localPath, buffer);
        
        const isLogo = url.toLowerCase().includes('logo');
        const isIcon = url.toLowerCase().includes('icon');
        
        if (isLogo && !logoPath) {
          logoPath = localPath;
        } else if (isIcon && !iconPath) {
          iconPath = localPath;
        }
        
        savedImages.push({
          originalUrl: url,
          localPath,
          hash,
          isLogo,
          isIcon
        });
        
        serverHashes[url] = hash;
        
      } catch (error) {
        console.warn(`[GameImages] Не удалось скачать изображение ${i+1}/${imageUrls.length}:`, error.message);
      }
    }
    
    // Если лого не найдено, берём первое изображение
    if (!logoPath && savedImages.length > 0) {
      logoPath = savedImages[0].localPath;
    }
    
    // Сохраняем метаданные
    const metadata = {
      gameId,
      images: savedImages,
      logo: logoPath,
      icon: iconPath || logoPath,
      serverHashes,
      lastUpdate: Date.now()
    };
    
    const metadataPath = this.getMetadataPath(drivePath, gameId);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    // Обновляем кэш
    this.localImagesCache.set(gameId, {
      drivePath,
      images: savedImages,
      logo: logoPath,
      icon: iconPath || logoPath,
      serverHashes,
      lastUpdate: Date.now()
    });
    
    console.log(`[GameImages] Сохранено ${savedImages.length} изображений для игры ${gameId}`);
    
    return savedImages;
  }

  /**
   * Проверка и обновление изображений если они изменились на сервере
   */
  async updateGameImagesIfNeeded(drivePath, gameId, serverImageUrls) {
    const cached = this.localImagesCache.get(gameId);
    
    if (!cached) {
      // Нет локальных изображений - скачиваем
      return await this.saveGameImages(drivePath, gameId, serverImageUrls);
    }
    
    // Проверяем изменились ли URL на сервере
    const serverUrlSet = new Set(serverImageUrls);
    const localUrlSet = new Set(cached.images.map(img => img.originalUrl));
    
    let needsUpdate = false;
    
    // Проверяем есть ли новые изображения
    for (const url of serverUrlSet) {
      if (!localUrlSet.has(url)) {
        needsUpdate = true;
        break;
      }
    }
    
    // Проверяем удалены ли изображения
    if (!needsUpdate) {
      for (const url of localUrlSet) {
        if (!serverUrlSet.has(url)) {
          needsUpdate = true;
          break;
        }
      }
    }
    
    if (needsUpdate) {
      console.log(`[GameImages] Обнаружены изменения, обновляем изображения для игры ${gameId}`);
      return await this.saveGameImages(drivePath, gameId, serverImageUrls);
    }
    
    return cached.images;
  }

  /**
   * Получение локального пути к лого игры
   */
  getLocalLogo(gameId) {
    const cached = this.localImagesCache.get(gameId);
    if (cached && cached.logo && fs.existsSync(cached.logo)) {
      return cached.logo;
    }
    return null;
  }

  /**
   * Получение локального пути к иконке игры
   */
  getLocalIcon(gameId) {
    const cached = this.localImagesCache.get(gameId);
    if (cached && cached.icon && fs.existsSync(cached.icon)) {
      return cached.icon;
    }
    return this.getLocalLogo(gameId);
  }

  /**
   * Получение локальных скриншотов игры
   */
  getLocalScreenshots(gameId) {
    const cached = this.localImagesCache.get(gameId);
    if (!cached) return [];
    
    return cached.images
      .filter(img => !img.isLogo && fs.existsSync(img.localPath))
      .map(img => img.localPath);
  }

  /**
   * Получение всех локальных изображений игры
   */
  getLocalImages(gameId) {
    const cached = this.localImagesCache.get(gameId);
    if (!cached) return [];
    
    return cached.images
      .filter(img => fs.existsSync(img.localPath))
      .map(img => img.localPath);
  }

  /**
   * Проверка наличия локальных изображений
   */
  hasLocalImages(gameId) {
    return this.localImagesCache.has(gameId);
  }

  /**
   * Удаление локальных изображений игры
   * @param {string} drivePath - Путь к диску (опционально, если не указан - берётся из кэша)
   * @param {number} gameId - ID игры
   */
  async deleteGameImages(drivePath, gameId) {
    // Поддержка старого API (только gameId)
    if (arguments.length === 1) {
      gameId = drivePath;
      const cached = this.localImagesCache.get(gameId);
      if (!cached) {
        console.log(`[GameImages] Изображения для игры ${gameId} не найдены в кэше`);
        return false;
      }
      drivePath = cached.drivePath;
    }
    
    const imagesPath = this.getGameImagesPath(drivePath, gameId);
    
    try {
      if (fs.existsSync(imagesPath)) {
        fs.rmSync(imagesPath, { recursive: true, force: true });
        console.log(`[GameImages] Удалены изображения для игры ${gameId} из ${imagesPath}`);
      } else {
        console.log(`[GameImages] Папка изображений не найдена: ${imagesPath}`);
      }
      
      this.localImagesCache.delete(gameId);
      return true;
    } catch (error) {
      console.error(`[GameImages] Ошибка удаления изображений для игры ${gameId}:`, error.message);
      return false;
    }
  }

  /**
   * Получение расширения файла из URL
   */
  _getExtFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      const ext = path.extname(pathname);
      return ext || '.jpg';
    } catch {
      return '.jpg';
    }
  }

  /**
   * Получение статистики
   */
  getStats() {
    let totalImages = 0;
    let gamesWithImages = this.localImagesCache.size;
    
    for (const [gameId, data] of this.localImagesCache) {
      totalImages += data.images.length;
    }
    
    return {
      gamesWithImages,
      totalImages
    };
  }
}

// Синглтон
const gameImagesManager = new GameImagesManager();

module.exports = gameImagesManager;
