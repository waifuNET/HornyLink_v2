const os = require('os');
const fs = require('fs');
const si = require('systeminformation');

class osUtils {
  static async getDisks() {
    try {
      const disks = await si.fsSize();
      return disks.map(disk => disk.mount);
    } catch (error) {
      console.error('Ошибка при получении списка дисков:', error.message);
      return [];
    }
  }

static async getDriveInfo() {
  try {
    const fsSize = await si.fsSize();
    const diskLayout = await si.diskLayout();
    const blockDevices = await si.blockDevices();
    
    const isWindows = os.platform() === 'win32';
    const drives = [];

    // Список файловых систем загрузчиков и защищенных томов для фильтрации
    const excludedFsTypes = ['efi', 'vfat', 'fat32', 'fat16', 'fat12', 'squashfs', 'iso9660', 'udf', 'overlay', 'tmpfs', 'devtmpfs'];
    const excludedMounts = ['/boot', '/boot/efi', '/efi', '/snap', '/run', '/dev', '/sys', '/proc'];

    for (const disk of fsSize) {
      const mount = disk.mount || '';
      const fsType = (disk.type || '').toLowerCase();
      
      // Пропускаем защищенные и системные тома
      if (!isWindows) {
        // Linux: фильтруем системные точки монтирования и файловые системы
        if (excludedFsTypes.includes(fsType)) continue;
        if (excludedMounts.some(ex => mount === ex || mount.startsWith(ex + '/'))) continue;
        if (mount.startsWith('/snap/')) continue;
        if (mount.startsWith('/run/')) continue;
        // Пропускаем если размер очень маленький (< 100MB) - скорее всего системный том
        if (disk.size < 100 * 1024 * 1024) continue;
      } else {
        // Windows: фильтруем системные тома без буквы и Recovery разделы
        if (!mount || mount.trim() === '') continue;
        // Пропускаем тома с очень маленьким размером (< 500MB) - обычно это Recovery/EFI
        if (disk.size < 500 * 1024 * 1024) continue;
      }

      const freeGB = disk.available / (1024 ** 3);
      
      // Определение метки тома
      let label = '';

      // Поиск соответствующего блочного устройства для получения метки
      const matchingBlockDevice = blockDevices.find(bd => {
        if (isWindows) {
          // Windows: сравниваем по букве диска
          const bdMount = (bd.mount || '').toLowerCase().replace(/[\\/]$/, '');
          const diskMount = mount.toLowerCase().replace(/[\\/]$/, '');
          return bdMount === diskMount;
        } else {
          // Linux: сравниваем по точке монтирования или устройству
          const bdMount = (bd.mount || '').toLowerCase();
          const diskMount = mount.toLowerCase();
          return bdMount === diskMount || bd.name === disk.fs.replace('/dev/', '');
        }
      });

      if (matchingBlockDevice && matchingBlockDevice.label && matchingBlockDevice.label.trim() !== '') {
        label = matchingBlockDevice.label;
      }
      
      // Если метка не найдена, используем дефолтное значение
      if (!label || label.trim() === '') {
        if (isWindows) {
          label = 'Локальный диск';
        } else {
          // Для Linux используем имя точки монтирования
          label = mount === '/' ? 'Корневой раздел' : mount.split('/').pop() || 'Раздел';
        }
      }

      // Определение типа накопителя (SSD/HDD)
      let type = 'hdd';
      
      if (isWindows) {
        // Windows: связываем логический диск с физическим через blockDevices
        if (matchingBlockDevice && matchingBlockDevice.device) {
          const physicalDevicePath = matchingBlockDevice.device.toLowerCase();
          
          // Ищем физический диск в diskLayout по device path
          const physicalDisk = diskLayout.find(d => {
            const layoutDevice = (d.device || '').toLowerCase();
            return layoutDevice === physicalDevicePath;
          });
          
          if (physicalDisk) {
            const diskType = (physicalDisk.type || '').toUpperCase();
            // systeminformation возвращает "SSD", "HD" (HDD), "NVMe"
            type = (diskType === 'SSD' || diskType === 'NVME') ? 'ssd' : 'hdd';
          }
        }
      } else {
        // Linux: определяем тип по пути устройства
        const devicePath = (disk.fs || '').toLowerCase();
        
        if (devicePath.includes('nvme')) {
          type = 'ssd';
        } else {
          // Ищем физический диск в diskLayout
          // Извлекаем базовое имя устройства (например, sda из /dev/sda1)
          const deviceBase = devicePath.replace('/dev/', '').replace(/[0-9]+$/, '');
          
          const physicalDisk = diskLayout.find(d => {
            const layoutDevice = (d.device || '').toLowerCase();
            return layoutDevice.includes(deviceBase) || layoutDevice === `/dev/${deviceBase}`;
          });
          
          if (physicalDisk) {
            const diskType = (physicalDisk.type || '').toUpperCase();
            type = (diskType === 'SSD' || diskType === 'NVME') ? 'ssd' : 'hdd';
          }
        }
      }

      drives.push({
        letter: isWindows ? mount.replace(/[\\/]$/, '') : mount,
        path: isWindows ? mount : mount,
        label: label,
        free: parseFloat(freeGB.toFixed(2)),
        type: type
      });
    }

    return drives;
  } catch (error) {
    console.error('Ошибка при получении информации о дисках:', error.message);
    return [];
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