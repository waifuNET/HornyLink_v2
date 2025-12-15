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
    
    const drives = [];

    for (const disk of fsSize) {
      const freeGB = disk.available / (1024 ** 3);
      
      let label = '';

      const matchingBlockDevice = blockDevices.find(bd => {
        const bdMount = (bd.mount || '').toLowerCase().replace(/[\\/]$/, ''); // убрать слеш в конце
        const diskMount = (disk.mount || '').toLowerCase().replace(/[\\/]$/, '');
        return bdMount === diskMount;
      });

      if (matchingBlockDevice && matchingBlockDevice.label) {
        label = matchingBlockDevice.label;
      } 
      
      if (!label || label.trim() === '') {
         label = 'Диск'; 
      }
      let type = 'hdd';
      
      const physicalDisk = diskLayout.find(d =>
        disk.mount.toLowerCase().includes(d.device.toLowerCase()) ||
        d.device.toLowerCase().includes(disk.mount.toLowerCase().replace(':', '').replace('\\', ''))
      );
      
      if (physicalDisk) {
        type = physicalDisk.type === 'SSD' || physicalDisk.type === 'NVMe' ? 'ssd' : 'hdd';
      } else {
        const deviceName = (disk.fs || '').toLowerCase();
        if (deviceName.includes('nvme') || deviceName.includes('ssd')) {
          type = 'ssd';
        }
      }

      const isWindows = os.platform() === 'win32';
      
      drives.push({
        letter: isWindows ? disk.mount.replace('\\', '') : disk.mount,
        path: disk.mount,
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