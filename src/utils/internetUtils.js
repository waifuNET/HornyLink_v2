const { SERVER_URL } = require('../cfg');

// Кэшируем модуль node-fetch при первом импорте
let nodeFetch = null;
let nodeFetchResponse = null;

async function getNodeFetch() {
  if (!nodeFetch) {
    const module = await import('node-fetch');
    nodeFetch = module.default;
    nodeFetchResponse = module.Response;
  }
  return nodeFetch;
}

async function getNodeFetchResponse() {
  if (!nodeFetchResponse) {
    const module = await import('node-fetch');
    nodeFetch = module.default;
    nodeFetchResponse = module.Response;
  }
  return nodeFetchResponse;
}

// Базовый fetch без кэширования
const fetch = async (...args) => {
  const fetchFn = await getNodeFetch();
  return fetchFn(...args);
};

// Ленивая загрузка imageCache для избежания циклических зависимостей
let imageCacheModule = null;
function getImageCache() {
  if (!imageCacheModule) {
    try {
      imageCacheModule = require('../logic/cache/imageCache');
    } catch (e) {
      console.warn('[internetUtils] imageCache module not available');
      return null;
    }
  }
  return imageCacheModule;
}

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

// Обёртка над fetch с кэшированием изображений
async function cachedFetch(...args) {
  const [url, options = {}] = args;
  const urlString = typeof url === 'string' ? url : url.toString();
  
  // Проверяем, является ли это GET запрос изображения
  const isGetRequest = !options.method || options.method.toUpperCase() === 'GET';
  const mightBeImage = isImageUrl(urlString);
  
  // Пробуем получить из кэша
  if (isGetRequest && mightBeImage) {
    const cache = getImageCache();
    if (cache && cache._initialized) {
      try {
        const cachedBuffer = await cache.get(urlString);
        if (cachedBuffer) {
          // Создаём Response из кэшированных данных
          const Response = await getNodeFetchResponse();
          return new Response(cachedBuffer, {
            status: 200,
            statusText: 'OK (cached)',
            headers: { 'content-type': 'image/jpeg' }
          });
        }
      } catch (cacheErr) {
        console.warn('[CACHE] Ошибка чтения из кэша:', cacheErr.message);
      }
    }
  }
  
  // Выполняем оригинальный запрос
  const response = await fetch(...args);
  
  // Если это GET запрос изображения и ответ успешный - кэшируем
  if (isGetRequest && response.ok) {
    const contentType = response.headers.get('content-type') || '';
    
    // Проверяем, является ли это изображением
    if (IMAGE_MIME_TYPES.some(type => contentType.includes(type))) {
      try {
        const cache = getImageCache();
        if (cache && cache._initialized) {
          // Клонируем response, чтобы можно было читать body дважды
          const clonedResponse = response.clone();
          const arrayBuffer = await clonedResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          // Сохраняем в кэш асинхронно (не блокируем возврат response)
          cache.set(urlString, buffer, contentType).catch(err => {
            console.warn('[CACHE] Ошибка сохранения в кэш:', err.message);
          });
        }
      } catch (err) {
        // Если не удалось закэшировать, просто продолжаем
        console.warn('[CACHE] Ошибка кэширования:', err.message);
      }
    }
  }
  
  return response;
}

// Функция для очистки кэша
async function clearImageCache() {
  const cache = getImageCache();
  if (cache) {
    await cache.clear();
  }
}

// Функция для получения статистики кэша
function getCacheStats() {
  const cache = getImageCache();
  if (cache && cache._initialized) {
    return cache.getStats();
  }
  return { ram: { entries: 0 }, disk: { entries: 0 } };
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