// master-client.js - Клиент с многопоточной загрузкой и возобновлением
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { SERVER_URL } = require('../../cfg')

const OUTPUT_DIR = './downloads';
const TEMP_DIR = './downloads/.temp';
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 МБ
const PARALLEL_CHUNKS = 5; // Скачивать 5 кусков одновременно

// Состояние загрузки
class DownloadState {
  constructor(fileKey, fileInfo) {
    this.fileKey = fileKey;
    this.fileInfo = fileInfo;
    this.totalSize = fileInfo.size;
    this.expectedHash = fileInfo.hash;
    this.chunks = [];
    this.completed = [];
    this.stateFile = path.join(TEMP_DIR, `${this.getSafeFileName()}.state.json`);
    
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
        tempFile: path.join(TEMP_DIR, `${this.getSafeFileName()}.chunk${i}`)
      });
    }
  }
  
  getSafeFileName() {
    return this.fileKey.replace(/[^a-zA-Z0-9._-]/g, '_');
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

// Скачивание одного куска
async function downloadChunk(fileKey, chunk, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Получаем ссылку от балансировщика
      const linkResponse = await axios.get(
        `${SERVER_URL}/api/download/${fileKey}`,
        { timeout: 10000 }
      );
      
      if (!linkResponse.data.success) {
        throw new Error('Балансировщик не вернул ссылку');
      }
      
      const downloadUrl = linkResponse.data.downloadUrl;
      
      // Скачиваем кусок с Range заголовком
      const response = await axios({
        method: 'get',
        url: downloadUrl,
        headers: {
          'Range': `bytes=${chunk.start}-${chunk.end}`
        },
        responseType: 'arraybuffer',
        timeout: 30000
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
      
    } catch (error) {
      if (attempt === retries) {
        throw new Error(`Кусок ${chunk.id} - ошибка после ${retries} попыток: ${error.message}`);
      }
      console.log(`  ⚠️  Кусок ${chunk.id} - попытка ${attempt} неудачна, повтор...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// Объединение кусков в итоговый файл
async function mergeChunks(state, outputPath) {
  console.log('\n→ Объединение кусков...');
  
  const writer = fs.createWriteStream(outputPath);
  const hash = crypto.createHash('sha256');
  
  for (let i = 0; i < state.chunks.length; i++) {
    const chunk = state.chunks[i];
    
    if (!fs.existsSync(chunk.tempFile)) {
      throw new Error(`Кусок ${i} отсутствует: ${chunk.tempFile}`);
    }
    
    const data = fs.readFileSync(chunk.tempFile);
    writer.write(data);
    hash.update(data);
    
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
  
  // Очищаем временные файлы
  state.clearState();
  
  return true;
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

// Основная функция загрузки
async function downloadFile(fileKey, outputPath = null) {
  if (!outputPath) {
    outputPath = path.join(OUTPUT_DIR, path.basename(fileKey));
  }
  
  // Создаём директории
  [OUTPUT_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  
  try {
    console.log(`Запрос файла: ${fileKey.padEnd(27)}`);
    
    // Получаем информацию о файле
    const infoResponse = await axios.get(
      `${SERVER_URL}/api/download/${fileKey}`,
      { timeout: 10000 }
    );
    
    if (!infoResponse.data.success) {
      throw new Error('Файл не найден в сети');
    }
    
    const fileInfo = infoResponse.data.fileInfo;
    
    console.log(`\n→ Информация о файле:`);
    console.log(`  Размер: ${(fileInfo.size / 1024 / 1024).toFixed(2)} МБ`);
    console.log(`  Хеш: ${fileInfo.hash.substring(0, 32)}...`);
    console.log(`  Провайдеров: ${fileInfo.providersCount}`);
    console.log(`  Кусков: ${Math.ceil(fileInfo.size / CHUNK_SIZE)} по ${CHUNK_SIZE / 1024 / 1024} МБ`);
    console.log(`  Параллельных потоков: ${PARALLEL_CHUNKS}`);
    
    // Инициализируем состояние
    const state = new DownloadState(fileKey, fileInfo);
    state.loadState();
    
    const startTime = Date.now();
    const serversUsed = new Set();
    
    console.log(`\n→ Загрузка начата...`);
    
    // Скачиваем куски параллельно
    while (!state.isComplete()) {
      const nextChunks = state.getNextChunks(PARALLEL_CHUNKS);
      
      if (nextChunks.length === 0) break;
      
      const progress = state.getProgress();
      console.log(`\n  Прогресс: ${progress.percent}% (${progress.downloaded}/${progress.total})`);
      console.log(`  Загрузка ${nextChunks.length} кусков...`);
      
      // Загружаем куски параллельно
      const promises = nextChunks.map(chunk => 
        downloadChunk(fileKey, chunk)
          .then(result => {
            serversUsed.add(result.server);
            state.markComplete(result.chunkId);
            console.log(`  ✓ Кусок ${result.chunkId} (${(result.size / 1024 / 1024).toFixed(2)} МБ) от ${result.server}`);
            return result;
          })
          .catch(error => {
            console.error(`  ✗ ${error.message}`);
            return null;
          })
      );
      
      await Promise.all(promises);
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
    console.error(`\n✗ Ошибка загрузки: ${error.message}`);
    throw error;
  }
}

// Поиск файлов
async function searchFiles(searchKey) {
  try {
    const response = await axios.get(`${SERVER_URL}/api/files`, {
      params: { key: searchKey },
      timeout: 10000
    });
    
    if (response.data.error) {
      console.log(`⚠️  ${response.data.error}`);
      console.log(`   ${response.data.hint}`);
      return [];
    }
    
    console.log(`\n╔═══════════════ НАЙДЕНО ФАЙЛОВ: ${response.data.found} ═══════════════╗`);
    
    response.data.files.forEach((file, index) => {
      const size = (file.size / 1024 / 1024).toFixed(2);
      console.log(`║ ${(index + 1).toString().padEnd(2)}. ${file.key.padEnd(40)}║`);
      console.log(`║     Размер: ${size.padEnd(10)} МБ | Провайдеров: ${file.totalProviders.toString().padEnd(3)} ║`);
    });
    
    console.log(`╚═════════════════════════════════════════════════════════╝\n`);
    
    return response.data.files;
  } catch (error) {
    console.error('✗ Ошибка поиска:', error.message);
    return [];
  }
}

module.exports = { downloadFile, getFileSize };