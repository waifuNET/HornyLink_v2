/**
 * Image Cache Module
 * 
 * Двухуровневое кэширование изображений:
 * 1. RAM Cache - быстрый доступ из памяти
 * 2. Disk Cache - постоянное хранение на диске (до настраиваемого лимита)
 * 
 * Также поддерживает локальные изображения для установленных игр (gameImages)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Конфигурация кэша
const DEFAULT_RAM_CACHE_SIZE = 256 * 1024 * 1024;  // 256 MB
const DEFAULT_DISK_CACHE_SIZE = 1024 * 1024 * 1024; // 1 GB
const CACHE_METADATA_FILE = 'cache_metadata.json';

// MIME типы изображений
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff'];

class ImageCache {
  constructor() {
    // RAM кэш
    this.ramCache = new Map();
    this.ramCacheSize = 0;
    this.maxRamCacheSize = DEFAULT_RAM_CACHE_SIZE;
    
    // Disk кэш
    this.diskCachePath = null;
    this.diskCacheMetadata = new Map();
    this.diskCacheSize = 0;
    this.maxDiskCacheSize = DEFAULT_DISK_CACHE_SIZE;
    
    // Инициализация
    this._initialized = false;
  }

  /**
   * Инициализация кэша
   */
  async init(settings = {}) {
    if (this._initialized) return;
    
    // Применяем настройки
    if (settings.maxRamCacheSize) {
      this.maxRamCacheSize = settings.maxRamCacheSize;
    }
    if (settings.maxDiskCacheSize) {
      this.maxDiskCacheSize = settings.maxDiskCacheSize;
    }
    
    // Получаем путь для disk кэша
    try {
      const { app } = require('electron');
      this.diskCachePath = path.join(app.getPath('userData'), 'imageCache');
    } catch (e) {
      // Если Electron недоступен, используем временную папку
      const os = require('os');
      this.diskCachePath = path.join(os.tmpdir(), 'hornylink_imageCache');
    }
    
    // Создаём директорию для disk кэша
    if (!fs.existsSync(this.diskCachePath)) {
      fs.mkdirSync(this.diskCachePath, { recursive: true });
    }
    
    // Загружаем метаданные disk кэша
    await this._loadDiskCacheMetadata();
    
    this._initialized = true;
    console.log(`[ImageCache] Инициализирован. RAM: ${this._formatSize(this.maxRamCacheSize)}, Disk: ${this._formatSize(this.maxDiskCacheSize)}`);
  }

  /**
   * Генерация ключа для URL
   */
  _generateKey(url) {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  /**
   * Форматирование размера
   */
  _formatSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(bytes / 1024).toFixed(2)} KB`;
  }

  /**
   * Проверка, является ли URL изображением
   */
  isImageUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      return IMAGE_EXTENSIONS.some(ext => pathname.endsWith(ext));
    } catch {
      return false;
    }
  }

  /**
   * Получение изображения из кэша
   * Сначала проверяет RAM, потом Disk
   */
  async get(url) {
    const key = this._generateKey(url);
    
    // 1. Проверяем RAM кэш
    if (this.ramCache.has(key)) {
      const cached = this.ramCache.get(key);
      cached.lastAccess = Date.now();
      return cached.buffer;
    }
    
    // 2. Проверяем Disk кэш
    const diskData = await this._getFromDisk(key);
    if (diskData) {
      // Загружаем в RAM кэш для быстрого доступа
      await this._addToRamCache(key, diskData.buffer, diskData.contentType);
      return diskData.buffer;
    }
    
    return null;
  }

  /**
   * Добавление изображения в кэш
   */
  async set(url, buffer, contentType = 'image/jpeg') {
    const key = this._generateKey(url);
    const size = buffer.length;
    
    // Добавляем в RAM кэш
    await this._addToRamCache(key, buffer, contentType);
    
    // Добавляем в Disk кэш
    await this._addToDiskCache(key, url, buffer, contentType);
    
    return true;
  }

  /**
   * Добавление в RAM кэш с вытеснением
   */
  async _addToRamCache(key, buffer, contentType) {
    const size = buffer.length;
    
    // Если элемент слишком большой для кэша, пропускаем
    if (size > this.maxRamCacheSize) {
      return false;
    }
    
    // Вытесняем старые элементы если нужно
    await this._evictRamCache(size);
    
    this.ramCache.set(key, {
      buffer,
      contentType,
      size,
      lastAccess: Date.now()
    });
    this.ramCacheSize += size;
    
    return true;
  }

  /**
   * Вытеснение из RAM кэша
   */
  async _evictRamCache(requiredSize) {
    if (this.ramCacheSize + requiredSize <= this.maxRamCacheSize) {
      return;
    }
    
    // Сортируем по времени последнего доступа
    const entries = Array.from(this.ramCache.entries())
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    
    for (const [key, value] of entries) {
      if (this.ramCacheSize + requiredSize <= this.maxRamCacheSize) {
        break;
      }
      this.ramCacheSize -= value.size;
      this.ramCache.delete(key);
    }
  }

  /**
   * Добавление в Disk кэш
   */
  async _addToDiskCache(key, url, buffer, contentType) {
    if (!this.diskCachePath) return false;
    
    const size = buffer.length;
    
    // Если элемент слишком большой для кэша, пропускаем
    if (size > this.maxDiskCacheSize) {
      return false;
    }
    
    // Вытесняем старые элементы если нужно
    await this._evictDiskCache(size);
    
    try {
      const ext = this._getExtFromContentType(contentType);
      const filePath = path.join(this.diskCachePath, `${key}${ext}`);
      
      fs.writeFileSync(filePath, buffer);
      
      this.diskCacheMetadata.set(key, {
        url,
        filePath,
        contentType,
        size,
        lastAccess: Date.now(),
        created: Date.now()
      });
      this.diskCacheSize += size;
      
      // Сохраняем метаданные
      await this._saveDiskCacheMetadata();
      
      return true;
    } catch (error) {
      console.error('[ImageCache] Ошибка записи в disk кэш:', error.message);
      return false;
    }
  }

  /**
   * Получение из Disk кэша
   */
  async _getFromDisk(key) {
    const meta = this.diskCacheMetadata.get(key);
    if (!meta) return null;
    
    try {
      if (!fs.existsSync(meta.filePath)) {
        // Файл удалён - очищаем метаданные
        this.diskCacheMetadata.delete(key);
        this.diskCacheSize -= meta.size;
        return null;
      }
      
      const buffer = fs.readFileSync(meta.filePath);
      
      // Обновляем время доступа
      meta.lastAccess = Date.now();
      
      return {
        buffer,
        contentType: meta.contentType
      };
    } catch (error) {
      console.error('[ImageCache] Ошибка чтения из disk кэша:', error.message);
      return null;
    }
  }

  /**
   * Вытеснение из Disk кэша
   */
  async _evictDiskCache(requiredSize) {
    if (this.diskCacheSize + requiredSize <= this.maxDiskCacheSize) {
      return;
    }
    
    // Сортируем по времени последнего доступа
    const entries = Array.from(this.diskCacheMetadata.entries())
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    
    for (const [key, meta] of entries) {
      if (this.diskCacheSize + requiredSize <= this.maxDiskCacheSize) {
        break;
      }
      
      try {
        if (fs.existsSync(meta.filePath)) {
          fs.unlinkSync(meta.filePath);
        }
      } catch (e) {
        // Игнорируем ошибки удаления
      }
      
      this.diskCacheSize -= meta.size;
      this.diskCacheMetadata.delete(key);
    }
    
    await this._saveDiskCacheMetadata();
  }

  /**
   * Получение расширения файла из content-type
   */
  _getExtFromContentType(contentType) {
    const map = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/bmp': '.bmp',
      'image/ico': '.ico',
      'image/tiff': '.tiff'
    };
    return map[contentType] || '.jpg';
  }

  /**
   * Загрузка метаданных Disk кэша
   */
  async _loadDiskCacheMetadata() {
    if (!this.diskCachePath) return;
    
    const metaPath = path.join(this.diskCachePath, CACHE_METADATA_FILE);
    
    try {
      if (fs.existsSync(metaPath)) {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        
        // Проверяем существование файлов
        for (const [key, meta] of Object.entries(data.entries || {})) {
          if (fs.existsSync(meta.filePath)) {
            this.diskCacheMetadata.set(key, meta);
            this.diskCacheSize += meta.size;
          }
        }
        
        console.log(`[ImageCache] Загружено ${this.diskCacheMetadata.size} записей из disk кэша (${this._formatSize(this.diskCacheSize)})`);
      }
    } catch (error) {
      console.error('[ImageCache] Ошибка загрузки метаданных:', error.message);
      this.diskCacheMetadata.clear();
      this.diskCacheSize = 0;
    }
  }

  /**
   * Сохранение метаданных Disk кэша
   */
  async _saveDiskCacheMetadata() {
    if (!this.diskCachePath) return;
    
    const metaPath = path.join(this.diskCachePath, CACHE_METADATA_FILE);
    
    try {
      const entries = {};
      for (const [key, value] of this.diskCacheMetadata.entries()) {
        entries[key] = value;
      }
      
      fs.writeFileSync(metaPath, JSON.stringify({
        version: 1,
        totalSize: this.diskCacheSize,
        entriesCount: this.diskCacheMetadata.size,
        entries
      }, null, 2));
    } catch (error) {
      console.error('[ImageCache] Ошибка сохранения метаданных:', error.message);
    }
  }

  /**
   * Проверка наличия в кэше
   */
  has(url) {
    const key = this._generateKey(url);
    return this.ramCache.has(key) || this.diskCacheMetadata.has(key);
  }

  /**
   * Удаление из кэша
   */
  async delete(url) {
    const key = this._generateKey(url);
    
    // Удаляем из RAM
    if (this.ramCache.has(key)) {
      const cached = this.ramCache.get(key);
      this.ramCacheSize -= cached.size;
      this.ramCache.delete(key);
    }
    
    // Удаляем из Disk
    if (this.diskCacheMetadata.has(key)) {
      const meta = this.diskCacheMetadata.get(key);
      try {
        if (fs.existsSync(meta.filePath)) {
          fs.unlinkSync(meta.filePath);
        }
      } catch (e) {}
      this.diskCacheSize -= meta.size;
      this.diskCacheMetadata.delete(key);
      await this._saveDiskCacheMetadata();
    }
  }

  /**
   * Полная очистка кэша
   */
  async clear() {
    // Очищаем RAM
    this.ramCache.clear();
    this.ramCacheSize = 0;
    
    // Очищаем Disk
    for (const [key, meta] of this.diskCacheMetadata.entries()) {
      try {
        if (fs.existsSync(meta.filePath)) {
          fs.unlinkSync(meta.filePath);
        }
      } catch (e) {}
    }
    this.diskCacheMetadata.clear();
    this.diskCacheSize = 0;
    
    await this._saveDiskCacheMetadata();
    
    console.log('[ImageCache] Кэш очищен');
  }

  /**
   * Получение статистики кэша
   */
  getStats() {
    return {
      ram: {
        entries: this.ramCache.size,
        size: this.ramCacheSize,
        sizeFormatted: this._formatSize(this.ramCacheSize),
        maxSize: this.maxRamCacheSize,
        maxSizeFormatted: this._formatSize(this.maxRamCacheSize),
        usage: ((this.ramCacheSize / this.maxRamCacheSize) * 100).toFixed(2) + '%'
      },
      disk: {
        entries: this.diskCacheMetadata.size,
        size: this.diskCacheSize,
        sizeFormatted: this._formatSize(this.diskCacheSize),
        maxSize: this.maxDiskCacheSize,
        maxSizeFormatted: this._formatSize(this.maxDiskCacheSize),
        usage: ((this.diskCacheSize / this.maxDiskCacheSize) * 100).toFixed(2) + '%'
      }
    };
  }

  /**
   * Установка максимального размера disk кэша
   */
  async setMaxDiskCacheSize(sizeInBytes) {
    this.maxDiskCacheSize = sizeInBytes;
    
    // Вытесняем если нужно
    if (this.diskCacheSize > this.maxDiskCacheSize) {
      await this._evictDiskCache(0);
    }
    
    console.log(`[ImageCache] Максимальный размер disk кэша установлен: ${this._formatSize(sizeInBytes)}`);
  }

  /**
   * Установка максимального размера RAM кэша
   */
  async setMaxRamCacheSize(sizeInBytes) {
    this.maxRamCacheSize = sizeInBytes;
    
    // Вытесняем если нужно
    if (this.ramCacheSize > this.maxRamCacheSize) {
      await this._evictRamCache(0);
    }
    
    console.log(`[ImageCache] Максимальный размер RAM кэша установлен: ${this._formatSize(sizeInBytes)}`);
  }
}

// Синглтон
const imageCache = new ImageCache();

module.exports = imageCache;
