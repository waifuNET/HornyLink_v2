const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class osUtils {
  static getDisks() {
    const platform = os.platform();
    
    if (platform === 'win32') {
      try {
        const output = execSync('wmic logicaldisk get name', { encoding: 'utf8' });
        const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
        // Убираем заголовок "Name" и возвращаем только буквы дисков
        return lines.slice(1).filter(disk => disk.match(/^[A-Z]:$/i)).map(disk => disk + '\\');
      } catch (error) {
        console.error('Ошибка при получении списка дисков:', error.message);
        return [];
      }
    } else {
      try {
        const mounts = fs.readFileSync('/proc/mounts', 'utf8');
        const lines = mounts.split('\n');
        const disks = ['/'];
        
        lines.forEach(line => {
          const parts = line.split(' ');
          if (parts.length >= 2) {
            const mountPoint = parts[1];
            // Фильтруем только реальные диски (не виртуальные файловые системы)
            if (mountPoint.startsWith('/media/') || 
                mountPoint.startsWith('/mnt/') ||
                (mountPoint.match(/^\/[^/]+$/) && mountPoint !== '/')) {
              disks.push(mountPoint);
            }
          }
        });
        
        return [...new Set(disks)]; // Убираем дубликаты
      } catch (error) {
        return ['/'];
      }
    }
  }

  static createFolder(dirPath, recursive = true) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive });
        return true;
      } else {
        console.log(`Папка уже существует: ${dirPath}`);
        return true;
      }
    } catch (error) {
      console.error(`Ошибка при создании папки ${dirPath}:`, error.message);
      return false;
    }
  }

  static folderExists(dirPath) {
    try {
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch (error) {
      return false;
    }
  }
}

module.exports = osUtils;