const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const { SERVER_URL } = require('../../cfg');

const CHUNK_SIZE = 4 * 1024 * 1024; // 4 МБ
const PARALLEL_CHUNKS = 5; // Скачивать 5 кусков одновременно
const MAX_CHUNK_RETRIES = 10; // Максимум попыток для каждого куска
const RETRY_DELAY_MS = 5000; // Начальная задержка между попытками

// Колбэк для прогресса
let progressCallback = null;

function setProgressCallback(callback) {
  progressCallback = callback;
}

function updateProgress(progress) {
  if (progressCallback) {
    progressCallback(progress);
  }
}

class DownloadController {
  constructor() {
    this.isPaused = false;
    this.isStopped = false;
    this.activeRequests = new Set();
  }

  pause() {
    console.log('\n⏸  Загрузка приостановлена');
    this.isPaused = true;
  }

  resume() {
    console.log('\n▶  Загрузка возобновлена');
    this.isPaused = false;
  }

  stop() {
    console.log('\n⏹  Загрузка остановлена');
    this.isStopped = true;
    this.isPaused = false;
    
    // Отменяем все активные запросы
    this.activeRequests.forEach(controller => {
      try {
        controller.abort();
      } catch (e) {
        // Игнорируем ошибки отмены
      }
    });
    this.activeRequests.clear();
  }

  reset() {
    this.isPaused = false;
    this.isStopped = false;
    this.activeRequests.clear();
  }

  async waitIfPaused() {
    while (this.isPaused && !this.isStopped) {
      await delay(100);
    }
  }

  checkStopped() {
    if (this.isStopped) {
      throw new Error('DOWNLOAD_STOPPED');
    }
  }

  addRequest(controller) {
    this.activeRequests.add(controller);
  }

  removeRequest(controller) {
    this.activeRequests.delete(controller);
  }
}

// Глобальный контроллер загрузки
const downloadController = new DownloadController();

// Публичные функции управления
function pauseDownload() {
  downloadController.pause();
}

function resumeDownload() {
  downloadController.resume();
}

function stopDownload() {
  downloadController.stop();
}

function isDownloadPaused() {
  return downloadController.isPaused;
}

function isDownloadStopped() {
  return downloadController.isStopped;
}

// ============================================================================

// Состояние загрузки
class DownloadState {
  constructor(fileKey, fileInfo, tempDir) {
    this.fileKey = fileKey;
    this.fileInfo = fileInfo;
    this.totalSize = fileInfo.size;
    this.expectedHash = fileInfo.hash;
    this.chunks = [];
    this.completed = [];
    this.tempDir = tempDir;
    this.stateFile = path.join(tempDir, `download.state.json`);
    
    // Вычисляем куски
    const totalChunks = Math.ceil(this.totalSize / CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE - 1, this.totalSize - 1);
      this.chunks.push({ 
        id: i, 
        start, 
        end, 
        downloaded: false,
        tempFile: path.join(tempDir, `chunk_${i}`)
      });
    }
  }
  
  // Загрузка состояния из файла
  loadState() {
    if (fs.existsSync(this.stateFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        
        // Проверяем, что хеш совпадает (тот же файл)
        if (data.expectedHash !== this.expectedHash) {
          console.log('⚠️  Хеш изменился, начинаем загрузку заново');
          this.clearState();
          return false;
        }
        
        // Восстанавливаем прогресс
        this.completed = data.completed || [];
        this.chunks.forEach(chunk => {
          if (this.completed.includes(chunk.id) && fs.existsSync(chunk.tempFile)) {
            chunk.downloaded = true;
          }
        });
        
        console.log(`✓ Восстановлено: ${this.completed.length}/${this.chunks.length} кусков`);
        return true;
      } catch (error) {
        console.log('⚠️  Ошибка загрузки состояния, начинаем заново');
        this.clearState();
        return false;
      }
    }
    return false;
  }
  
  // Сохранение состояния
  saveState() {
    fs.writeFileSync(this.stateFile, JSON.stringify({
      fileKey: this.fileKey,
      expectedHash: this.expectedHash,
      totalSize: this.totalSize,
      completed: this.completed,
      timestamp: Date.now()
    }));
  }
  
  // Очистка временных файлов
  clearState() {
    this.chunks.forEach(chunk => {
      if (fs.existsSync(chunk.tempFile)) {
        fs.unlinkSync(chunk.tempFile);
      }
    });
    if (fs.existsSync(this.stateFile)) {
      fs.unlinkSync(this.stateFile);
    }
    this.completed = [];
  }
  
  // Получить следующие куски для загрузки
  getNextChunks(count) {
    return this.chunks
      .filter(c => !c.downloaded)
      .slice(0, count);
  }
  
  // Отметить кусок как скачанный
  markComplete(chunkId) {
    const chunk = this.chunks.find(c => c.id === chunkId);
    if (chunk) {
      chunk.downloaded = true;
      if (!this.completed.includes(chunkId)) {
        this.completed.push(chunkId);
      }
      this.saveState();
      
      // Обновляем прогресс (0-50% - загрузка)
      const downloadProgress = (this.completed.length / this.chunks.length) * 50;
      updateProgress(downloadProgress);
    }
  }
  
  // Проверка завершения
  isComplete() {
    return this.chunks.every(c => c.downloaded);
  }
  
  // Прогресс
  getProgress() {
    const downloaded = this.completed.length;
    const total = this.chunks.length;
    return {
      downloaded,
      total,
      percent: Math.floor((downloaded / total) * 100)
    };
  }
}

// Вспомогательная функция для задержки
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Скачивание одного куска через P2P
async function downloadChunk(fileKey, chunk) {
  // Проверяем остановку
  downloadController.checkStopped();
  await downloadController.waitIfPaused();

  // Создаем AbortController для этого запроса
  const abortController = new AbortController();
  downloadController.addRequest(abortController);

  try {
    // Получаем ссылку от балансировщика
    const linkResponse = await axios.get(
      `${SERVER_URL}/api/download/${fileKey}`,
      { 
        timeout: 10000,
        signal: abortController.signal
      }
    );
    
    if (!linkResponse.data.success) {
      throw new Error('Балансировщик не вернул ссылку');
    }
    
    const downloadUrl = linkResponse.data.downloadUrl;
    
    // Проверяем остановку перед загрузкой
    downloadController.checkStopped();
    await downloadController.waitIfPaused();
    
    // Скачиваем кусок с Range заголовком
    const response = await axios({
      method: 'get',
      url: downloadUrl,
      headers: {
        'Range': `bytes=${chunk.start}-${chunk.end}`
      },
      responseType: 'arraybuffer',
      timeout: 30000,
      signal: abortController.signal
    });
    
    // Проверяем, что получили правильный статус
    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`Неверный статус: ${response.status}`);
    }
    
    // Сохраняем кусок
    fs.writeFileSync(chunk.tempFile, Buffer.from(response.data));
    
    return {
      success: true,
      chunkId: chunk.id,
      size: response.data.byteLength,
      server: linkResponse.data.server
    };
  } finally {
    downloadController.removeRequest(abortController);
  }
}

// Функция retry для загрузки кусков
async function downloadChunkWithRetry(downloadFunc, chunk, sourceName) {
  let lastError;
  
  for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt++) {
    try {
      // Проверяем остановку
      downloadController.checkStopped();
      await downloadController.waitIfPaused();

      if (attempt > 1) {
        const delayTime = RETRY_DELAY_MS * Math.pow(2, attempt - 2);
        console.log(`  ⟳ Повтор ${attempt}/${MAX_CHUNK_RETRIES} для куска ${chunk.id} (${sourceName}) через ${delayTime}мс...`);
        await delay(delayTime);
      }
      
      const result = await downloadFunc();
      
      if (attempt > 1) {
        console.log(`  ✓ Кусок ${chunk.id} загружен с попытки ${attempt}`);
      }
      
      return result;
    } catch (error) {
      // Если загрузка была остановлена, пробрасываем ошибку
      if (error.message === 'DOWNLOAD_STOPPED' || error.code === 'ERR_CANCELED') {
        throw error;
      }

      lastError = error;
      
      if (attempt < MAX_CHUNK_RETRIES) {
        console.log(`  ⚠ Попытка ${attempt}/${MAX_CHUNK_RETRIES} провалилась для куска ${chunk.id} (${sourceName}): ${error.message}`);
      }
    }
  }
  
  throw new Error(`Кусок ${chunk.id} (${sourceName}): все ${MAX_CHUNK_RETRIES} попытки провалились. Последняя ошибка: ${lastError.message}`);
}

// Функция для загрузки куска с fallback сервера (Range request)
async function downloadChunkFromFallback(fallbackUrl, chunk, totalFileSize) {
  // Проверяем остановку
  downloadController.checkStopped();
  await downloadController.waitIfPaused();

  const abortController = new AbortController();
  downloadController.addRequest(abortController);

  try {
    const start = chunk.id * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE - 1, totalFileSize - 1);
    
    const response = await axios({
      method: 'GET',
      url: fallbackUrl,
      responseType: 'arraybuffer',
      headers: {
        'Range': `bytes=${start}-${end}`
      },
      timeout: 30000,
      signal: abortController.signal
    });
    
    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`Неверный статус: ${response.status}`);
    }
    
    const data = Buffer.from(response.data);
    fs.writeFileSync(chunk.tempFile, data);
    
    return {
      chunkId: chunk.id,
      size: data.length,
      server: 'fallback'
    };
  } finally {
    downloadController.removeRequest(abortController);
  }
}

// Объединение кусков в итоговый файл
async function mergeChunks(state, outputPath) {
  console.log('\n→ Объединение кусков...');
  updateProgress(50); // Начинаем слияние на 50%
  
  const writer = fs.createWriteStream(outputPath);
  const hash = crypto.createHash('sha256');
  
  for (let i = 0; i < state.chunks.length; i++) {
    // Проверяем остановку
    downloadController.checkStopped();
    await downloadController.waitIfPaused();

    const chunk = state.chunks[i];
    
    if (!fs.existsSync(chunk.tempFile)) {
      throw new Error(`Кусок ${i} отсутствует: ${chunk.tempFile}`);
    }
    
    const data = fs.readFileSync(chunk.tempFile);
    writer.write(data);
    hash.update(data);
    
    // Прогресс слияния (50-70%)
    const mergeProgress = 50 + ((i + 1) / state.chunks.length) * 20;
    updateProgress(mergeProgress);
    
    process.stdout.write(`\r  Объединение: ${i + 1}/${state.chunks.length} кусков...`);
  }
  
  writer.end();
  
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  
  console.log('\n✓ Объединение завершено');
  
  // Проверка хеша
  const finalHash = hash.digest('hex');
  console.log(`\n→ Проверка целостности файла...`);
  console.log(`  Ожидаемый хеш: ${state.expectedHash}`);
  console.log(`  Полученный хеш: ${finalHash}`);
  
  if (finalHash !== state.expectedHash) {
    throw new Error('❌ КРИТИЧЕСКАЯ ОШИБКА: Хеш не совпадает! Файл поврежден или подменен!');
  }
  
  console.log('✓ Хеш верифицирован - файл целостен');
  updateProgress(70);
  
  // Очищаем временные файлы
  state.clearState();
  
  return true;
}

// Функция для прямой загрузки файла с retry
async function downloadDirectlyWithRetry(url, outputPath) {
  let lastError;
  
  for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt++) {
    try {
      // Проверяем остановку
      downloadController.checkStopped();
      await downloadController.waitIfPaused();

      if (attempt > 1) {
        const delayTime = RETRY_DELAY_MS * Math.pow(2, attempt - 2);
        console.log(`\n⟳ Повтор прямой загрузки ${attempt}/${MAX_CHUNK_RETRIES} через ${delayTime}мс...`);
        await delay(delayTime);
      }
      
      return await downloadDirectly(url, outputPath);
    } catch (error) {
      // Если загрузка была остановлена, пробрасываем ошибку
      if (error.message === 'DOWNLOAD_STOPPED' || error.code === 'ERR_CANCELED') {
        throw error;
      }

      lastError = error;
      
      if (attempt < MAX_CHUNK_RETRIES) {
        console.log(`⚠ Попытка ${attempt}/${MAX_CHUNK_RETRIES} прямой загрузки провалилась: ${error.message}`);
      }
    }
  }
  
  throw new Error(`Прямая загрузка: все ${MAX_CHUNK_RETRIES} попытки провалились. Последняя ошибка: ${lastError.message}`);
}

// Функция для прямой загрузки файла
async function downloadDirectly(url, outputPath) {
  console.log(`\n→ Прямая загрузка с: ${url}`);
  updateProgress(0);
  
  const abortController = new AbortController();
  downloadController.addRequest(abortController);

  try {
    const writer = fs.createWriteStream(outputPath);
    
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      signal: abortController.signal
    });
    
    const totalSize = parseInt(response.headers['content-length'], 10);
    let downloadedSize = 0;
    
    console.log(`  Размер файла: ${(totalSize / 1024 / 1024).toFixed(2)} МБ`);
    
    response.data.on('data', async (chunk) => {
      // Проверяем паузу и остановку
      try {
        downloadController.checkStopped();
        await downloadController.waitIfPaused();
        
        downloadedSize += chunk.length;
        const progress = (downloadedSize / totalSize) * 50; // 0-50% для загрузки
        updateProgress(progress);
      } catch (error) {
        // Останавливаем поток при ошибке
        response.data.destroy();
        writer.destroy();
      }
    });
    
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        updateProgress(50);
        console.log(`\n✓ Прямая загрузка завершена`);
        resolve({ success: true, verified: false });
      });
      
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } finally {
    downloadController.removeRequest(abortController);
  }
}

// Основная функция загрузки
async function downloadFile(fileKey, outputPath, tempDir, gameOriginalUrl) {
  // Сбрасываем контроллер для новой загрузки
  downloadController.reset();

  // Создаём временную директорию
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Fallback URL формируется из ключа
  const fallbackUrl = `${gameOriginalUrl}/${fileKey}`;
  let useP2P = false;
  let useFallback = false;
  let useHybrid = false;
  let fileInfo = null;
  
  try {
    console.log(`Запрос файла: ${fileKey}`);
    updateProgress(0);
    
    // Пытаемся получить информацию о P2P загрузке
    try {
      const infoResponse = await axios.get(
        `${SERVER_URL}/api/download/${fileKey}`,
        { timeout: 10000 }
      );
      
      if (infoResponse.data.success) {
        fileInfo = infoResponse.data.fileInfo;
        
        if (fileInfo.providersCount === 0) {
          console.log(`⚠ Нет доступных провайдеров, используем прямую загрузку`);
          useFallback = true;
        } else if (fileInfo.providersCount <= 1) {
          console.log(`⚠ Мало провайдеров (${fileInfo.providersCount}), используем гибридную загрузку`);
          useHybrid = true;
        } else {
          console.log(`✓ P2P загрузка доступна (провайдеров: ${fileInfo.providersCount})`);
          useP2P = true;
        }
      }
    } catch (p2pError) {
      console.log(`⚠ P2P недоступен, используем прямую загрузку`);
      useFallback = true;
    }
    
    // Если P2P недоступен или нет провайдеров, используем прямую загрузку
    if (useFallback) {
      await downloadDirectlyWithRetry(fallbackUrl, outputPath);
      return { success: true, verified: false };
    }
    
    // Логируем информацию о файле
    console.log(`\n→ Информация о файле:`);
    console.log(`  Размер: ${(fileInfo.size / 1024 / 1024).toFixed(2)} МБ`);
    console.log(`  Хеш: ${fileInfo.hash.substring(0, 32)}...`);
    console.log(`  Провайдеров: ${fileInfo.providersCount}`);
    console.log(`  Кусков: ${Math.ceil(fileInfo.size / CHUNK_SIZE)} по ${CHUNK_SIZE / 1024 / 1024} МБ`);
    console.log(`  Параллельных потоков: ${PARALLEL_CHUNKS}`);
    console.log(`  Попыток на кусок: ${MAX_CHUNK_RETRIES}`);
    
    if (useHybrid) {
      console.log(`  Режим: ГИБРИДНЫЙ (P2P + прямая загрузка)`);
    }
    
    // Инициализируем состояние
    const state = new DownloadState(fileKey, fileInfo, tempDir);
    state.loadState();
    
    const startTime = Date.now();
    const serversUsed = new Set();
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;
    
    // Для гибридного режима - проверяем доступность fallback
    let fallbackAvailable = false;
    if (useHybrid) {
      try {
        const headResponse = await axios.head(fallbackUrl, { timeout: 5000 });
        fallbackAvailable = headResponse.status === 200;
        console.log(`  Fallback сервер: ${fallbackAvailable ? '✓ доступен' : '✗ недоступен'}`);
      } catch (e) {
        console.log(`  Fallback сервер: ✗ недоступен`);
      }
    }
    
    console.log(`\n→ Загрузка начата...`);
    
    // Скачиваем куски параллельно
    while (!state.isComplete()) {
      // Проверяем остановку
      downloadController.checkStopped();
      await downloadController.waitIfPaused();

      const nextChunks = state.getNextChunks(PARALLEL_CHUNKS);
      
      if (nextChunks.length === 0) break;
      
      const progress = state.getProgress();
      console.log(`\n  Прогресс: ${progress.percent}% (${progress.downloaded}/${progress.total})`);
      console.log(`  Загрузка ${nextChunks.length} кусков...`);
      
      // В гибридном режиме чередуем источники
      const promises = nextChunks.map((chunk, index) => {
        const useFallbackForChunk = useHybrid && fallbackAvailable && (index % 2 === 0);
        
        if (useFallbackForChunk) {
          return downloadChunkWithRetry(
            () => downloadChunkFromFallback(fallbackUrl, chunk, fileInfo.size),
            chunk,
            'FALLBACK'
          )
            .then(result => {
              serversUsed.add('fallback');
              state.markComplete(result.chunkId);
              console.log(`  ✓ Кусок ${result.chunkId} (${(result.size / 1024 / 1024).toFixed(2)} МБ) от FALLBACK`);
              consecutiveErrors = 0;
              return result;
            })
            .catch(error => {
              // Если остановлено, пробрасываем ошибку
              if (error.message === 'DOWNLOAD_STOPPED' || error.code === 'ERR_CANCELED') {
                throw error;
              }

              console.error(`  ✗ Fallback полностью провалился: ${error.message}`);
              return downloadChunkWithRetry(
                () => downloadChunk(fileKey, chunk),
                chunk,
                'P2P (резерв)'
              )
                .then(result => {
                  serversUsed.add(result.server);
                  state.markComplete(result.chunkId);
                  console.log(`  ✓ Кусок ${result.chunkId} (${(result.size / 1024 / 1024).toFixed(2)} МБ) от ${result.server} (резерв)`);
                  consecutiveErrors = 0;
                  return result;
                })
                .catch(p2pError => {
                  if (p2pError.message === 'DOWNLOAD_STOPPED' || p2pError.code === 'ERR_CANCELED') {
                    throw p2pError;
                  }
                  console.error(`  ✗ P2P резерв тоже провалился: ${p2pError.message}`);
                  consecutiveErrors++;
                  return null;
                });
            });
        } else {
          return downloadChunkWithRetry(
            () => downloadChunk(fileKey, chunk),
            chunk,
            'P2P'
          )
            .then(result => {
              serversUsed.add(result.server);
              state.markComplete(result.chunkId);
              console.log(`  ✓ Кусок ${result.chunkId} (${(result.size / 1024 / 1024).toFixed(2)} МБ) от ${result.server}`);
              consecutiveErrors = 0;
              return result;
            })
            .catch(error => {
              if (error.message === 'DOWNLOAD_STOPPED' || error.code === 'ERR_CANCELED') {
                throw error;
              }

              console.error(`  ✗ P2P полностью провалился: ${error.message}`);
              consecutiveErrors++;
              
              if (useHybrid && fallbackAvailable) {
                return downloadChunkWithRetry(
                  () => downloadChunkFromFallback(fallbackUrl, chunk, fileInfo.size),
                  chunk,
                  'FALLBACK (резерв)'
                )
                  .then(result => {
                    serversUsed.add('fallback');
                    state.markComplete(result.chunkId);
                    console.log(`  ✓ Кусок ${result.chunkId} (${(result.size / 1024 / 1024).toFixed(2)} МБ) от FALLBACK (резерв)`);
                    consecutiveErrors = 0;
                    return result;
                  })
                  .catch(fallbackError => {
                    if (fallbackError.message === 'DOWNLOAD_STOPPED' || fallbackError.code === 'ERR_CANCELED') {
                      throw fallbackError;
                    }
                    console.error(`  ✗ Fallback резерв тоже провалился: ${fallbackError.message}`);
                    return null;
                  });
              }
              
              return null;
            });
        }
      });
      
      await Promise.all(promises);
      
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log(`\n⚠ Слишком много ошибок (${consecutiveErrors}), переключаемся на прямую загрузку...`);
        await downloadDirectlyWithRetry(fallbackUrl, outputPath);
        return { success: true, verified: false };
      }
    }
    
    if (!state.isComplete()) {
      throw new Error('Не удалось загрузить все куски');
    }
    
    const downloadTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n✓ Все куски загружены за ${downloadTime} сек`);
    console.log(`  Использовано серверов: ${serversUsed.size}`);
    console.log(`  Серверы: ${Array.from(serversUsed).join(', ')}`);
    
    // Объединяем куски
    await mergeChunks(state, outputPath);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgSpeed = (fileInfo.size / 1024 / 1024 / totalTime).toFixed(2);
    
    console.log(`✓ ЗАГРУЗКА ЗАВЕРШЕНА УСПЕШНО`);
    console.log(`  Файл: ${outputPath}`);
    console.log(`  Время: ${totalTime} сек`);
    console.log(`  Средняя скорость: ${avgSpeed} МБ/с`);
    console.log(`  Серверов использовано: ${serversUsed.size}`);
    
    return { success: true, verified: true };
    
  } catch (error) {
    // Если загрузка была остановлена пользователем
    if (error.message === 'DOWNLOAD_STOPPED' || error.code === 'ERR_CANCELED') {
      console.log('\n⏹  Загрузка отменена пользователем');
      return { success: false, stopped: true };
    }

    console.error(`\n✗ Ошибка P2P загрузки: ${error.message}`);
    console.log(`⚠ Переключаемся на прямую загрузку...`);
    
    try {
      await downloadDirectlyWithRetry(fallbackUrl, outputPath);
      return { success: true, verified: false };
    } catch (fallbackError) {
      // Если загрузка была остановлена пользователем
      if (fallbackError.message === 'DOWNLOAD_STOPPED' || fallbackError.code === 'ERR_CANCELED') {
        console.log('\n⏹  Загрузка отменена пользователем');
        return { success: false, stopped: true };
      }

      console.error(`\n✗ Ошибка прямой загрузки: ${fallbackError.message}`);
      throw new Error('Не удалось загрузить файл ни одним из способов');
    }
  }
}

// Распаковка архива
async function extractArchive(archivePath, extractPath) {
  console.log('\n→ Распаковка архива...');
  updateProgress(70);
  
  return new Promise((resolve, reject) => {
    try {
      // Проверяем остановку
      downloadController.checkStopped();

      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      const totalEntries = entries.length;
      
      let extractedCount = 0;
      
      entries.forEach((entry) => {
        // Проверяем остановку на каждом файле
        try {
          downloadController.checkStopped();
        } catch (error) {
          throw new Error('DOWNLOAD_STOPPED');
        }

        if (!entry.isDirectory) {
          zip.extractEntryTo(entry, extractPath, true, true);
        }
        extractedCount++;
        
        // Прогресс распаковки (70-100%)
        const extractProgress = 70 + (extractedCount / totalEntries) * 30;
        updateProgress(extractProgress);
      });
      
      console.log(`✓ Распаковка завершена: ${totalEntries} файлов`);
      updateProgress(100);
      resolve();
    } catch (error) {
      if (error.message === 'DOWNLOAD_STOPPED') {
        console.log('\n⏹  Распаковка отменена пользователем');
        reject(error);
      } else {
        reject(error);
      }
    }
  });
}

async function getFileSize(url) {
  try {
      // Делаем HEAD запрос для получения только заголовков без скачивания файла
      const response = await axios.head(url);
      
      // Получаем размер из заголовка Content-Length
      const fileSize = response.headers['content-length'];
      
      if (fileSize) {
      // Конвертируем в число
      const sizeInBytes = parseInt(fileSize, 10);
      
      // Возвращаем размер в байтах и форматированный размер
      return {
          bytes: sizeInBytes,
          kb: (sizeInBytes / 1024).toFixed(2),
          mb: (sizeInBytes / (1024 * 1024)).toFixed(2),
          gb: (sizeInBytes / (1024 * 1024 * 1024)).toFixed(2),
          formatted: formatFileSize(sizeInBytes)
      };
      } else {
      throw new Error('Content-Length header not found');
      }
  } catch (error) {
      console.error('Error getting file size:', error.message);
      throw error;
  }
}
  
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}


module.exports = { 
  downloadFile, 
  extractArchive,
  setProgressCallback,
  updateProgress,
  getFileSize,
  // Новые функции управления загрузкой
  pauseDownload,
  resumeDownload,
  stopDownload,
  isDownloadPaused,
  isDownloadStopped
};