const { SERVER_URL } = require('../cfg');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Кэш для изображений
const imageCache = new Map();
let cacheSize = 0;
const MAX_CACHE_SIZE = 512 * 1024 * 1024; // 512 МБ

// MIME типы изображений
const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/ico',
  'image/tiff'
];

// Проверка, является ли URL изображением по расширению
function isImageUrl(url) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff'];
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    return imageExtensions.some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

// Удаление старых записей из кэша при превышении лимита
function evictCache(requiredSize) {
  const entries = Array.from(imageCache.entries());
  
  // Удаляем старые записи пока не освободим место
  for (const [key, value] of entries) {
    if (cacheSize + requiredSize <= MAX_CACHE_SIZE) break;
    
    cacheSize -= value.size;
    imageCache.delete(key);
  }
}

// Обёртка над fetch с кэшированием изображений
async function cachedFetch(...args) {
  const [url, options = {}] = args;
  const urlString = typeof url === 'string' ? url : url.toString();
  
  // Проверяем, является ли это GET запрос изображения
  const isGetRequest = !options.method || options.method.toUpperCase() === 'GET';
  const mightBeImage = isImageUrl(urlString);
  
  // Если это может быть изображение и GET запрос, проверяем кэш
  if (isGetRequest && mightBeImage && imageCache.has(urlString)) {
    const cached = imageCache.get(urlString);
    
    // Создаём Response из кэшированных данных
    return new Promise((resolve) => {
      import('node-fetch').then(({ Response }) => {
        resolve(new Response(cached.buffer, {
          status: 200,
          statusText: 'OK',
          headers: cached.headers
        }));
      });
    });
  }
  
  // Выполняем оригинальный запрос
  const response = await fetch(...args);
  
  // Если это GET запрос и ответ успешный
  if (isGetRequest && response.ok) {
    const contentType = response.headers.get('content-type') || '';
    
    // Проверяем, является ли это изображением
    if (IMAGE_MIME_TYPES.some(type => contentType.includes(type))) {
      try {
        // Клонируем response, чтобы можно было читать body дважды
        const clonedResponse = response.clone();
        const buffer = await clonedResponse.buffer();
        const size = buffer.length;
        
        // Проверяем, поместится ли в кэш
        if (size <= MAX_CACHE_SIZE) {
          // Освобождаем место если нужно
          if (cacheSize + size > MAX_CACHE_SIZE) {
            evictCache(size);
          }
          
          // Сохраняем в кэш
          imageCache.set(urlString, {
            buffer,
            size,
            headers: {
              'content-type': contentType,
              'content-length': size.toString()
            },
            timestamp: Date.now()
          });
          
          cacheSize += size;
        }
      } catch (err) {
        // Если не удалось закэшировать, просто продолжаем
        console.error('[CACHE] Ошибка кэширования:', err.message);
      }
    }
  }
  
  return response;
}

// Функция для очистки кэша
function clearImageCache() {
  imageCache.clear();
  cacheSize = 0;
}

// Функция для получения статистики кэша
function getCacheStats() {
  return {
    entries: imageCache.size,
    sizeBytes: cacheSize,
    sizeMB: (cacheSize / (1024 * 1024)).toFixed(2),
    maxSizeMB: MAX_CACHE_SIZE / (1024 * 1024)
  };
}

async function hasInternetConnection(debug = false, url = SERVER_URL, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if(debug) console.log("[TEST] Запрос:", url);

  try {
    const res = await cachedFetch(url, {
      method: "GET",
      signal: controller.signal
    });

    clearTimeout(timeout);

    if(debug) console.log("[TEST] Ответ от сервера:");
    if(debug) console.log("status:", res.status);
    if(debug) console.log("statusText:", res.statusText);

    const text = await res.text();
    if(debug) console.log("body:", text.slice(0, 200));

    return res.status > 0 && res.status < 500;
  } catch (err) {
    clearTimeout(timeout);
    if(debug) console.log("[TEST] Ошибка запроса:");
    if(debug) console.log(err.name, err.message);
    return false;
  }
}

module.exports = {
  hasInternetConnection,
  fetch: cachedFetch,
  clearImageCache,
  getCacheStats,
};