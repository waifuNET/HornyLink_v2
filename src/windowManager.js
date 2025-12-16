// windowManager.js
const { BrowserWindow } = require('electron');

class WindowManager {
  constructor() {
    this.mainWindow = null;
  }

  initialize(window) {
    this.mainWindow = window;
  }

  isReady() {
    return this.mainWindow && !this.mainWindow.isDestroyed();
  }

  send(channel, data) {
    if (!this.isReady()) {
      console.warn(`[WindowManager] Окно не готово, не удалось отправить ${channel}`);
      return false;
    }
    
    this.mainWindow.webContents.send(channel, data);
    return true;
  }

  sendError(error) {
    return this.send('app-error', error);
  }
}

module.exports = new WindowManager();