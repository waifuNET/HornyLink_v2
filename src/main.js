const { hasInternetConnection } = require('./utils/internetUtils');
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { VERSION } = require('./cfg');
const { internetConnection } = require('./state');
const { Auth } = require('./logic/auth/auth');
const WindowUtils = require('./utils/windowUtils')
const { LanguageVariables, ApplicationSettings } = require('./state');
ApplicationSettings.loadSettings();

const setupIpcHandlers_languages = require('./logic/ipc/ipcHandlers_languages');
const setupIpcHandlers_auth = require('./logic/ipc/ipcHandlers_auth');
const setupIpcHandlers_cfg = require('./logic/ipc/ipcHandlers_cfg');

setupIpcHandlers_languages();
setupIpcHandlers_auth();
setupIpcHandlers_cfg();

// Флаг полного выхода из приложения
app.isQuiting = false;

// Ссылка на трей
let tray = null;

// Логика одиночного экземпляра приложения
const gotTheLock = app.requestSingleInstanceLock();

// Обработка ситуации, когда второй экземпляр пытается запуститься
if(!gotTheLock) {
    console.log(`[MAIN] ${LanguageVariables.getMessage('SINGLE_INSTANCE_LOCK', 'errors', ApplicationSettings.settings.language)}`);
    app.isQuiting = true;
    app.quit();
}
else{
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log(`[MAIN] ${LanguageVariables.getMessage('SINGLE_INSTANCE_ATTEMPT', 'errors', ApplicationSettings.settings.language)}`);
        app.isQuiting = true;

        if(tray){
            tray.destroy();
        }

        BrowserWindow.getAllWindows().forEach(win => {
            win.destroy();
        });

        app.quit();
    });
}

function devHackSecure(win){
    win.webContents.on('devtools-opened', () => {
        console.log(`[MAIN] ${ LanguageVariables.getMessage('DEVTOOLS_CLOSED', 'errors', ApplicationSettings.settings.language) }`);
        win.webContents.closeDevTools();
    });

    win.webContents.executeJavaScript(`
        window.eval = function() {
            throw new Error('eval is disabled');
        };
        window.Function = function() {
            throw new Error('Function constructor is disabled');
        };
    `).catch((err) => {});
}

function createTray(){
  const iconPath = path.join(__dirname, "public", "icon.ico");
  const trayIcon = nativeImage.createFromPath(iconPath);

  tray = new Tray(trayIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: LanguageVariables.getMessage('TRAY_OPEN', 'application', ApplicationSettings.settings.language),
      click: () => {
        WindowUtils.win.show();
        WindowUtils.win.focus();
      }
    },
    {
      label: LanguageVariables.getMessage('TRAY_CLOSE', 'application', ApplicationSettings.settings.language),
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('HornyLink');
  
  tray.on('click', () => {
    if (WindowUtils.win.isVisible()) {
      WindowUtils.win.hide();
    } else {
      WindowUtils.win.show();
      WindowUtils.win.focus();
    }
  });
  
  tray.on('double-click', () => {
    WindowUtils.win.show();
    WindowUtils.win.focus();
  });
  
  tray.on('right-click', () => {
    tray.popUpContextMenu(contextMenu);
  });
}

app.on('before-quit', () => {
  app.isQuiting = true;
  if (tray) {
    tray.destroy();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1290,
    height: 800,
    minHeight: 610,
    minWidth: 1010,
    backgroundColor: '#121212',
    darkTheme: true,
    fullscreenable: false,
    //autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false
    }
  });

  //devHackSecure(win);

  createTray();

  win.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

async function createLoadingWindow() {
  const loading = new BrowserWindow({
    width: 400,
    height: 175,
    frame: true,
    backgroundColor: "#1a1a1a",
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  devHackSecure(loading);

  WindowUtils.goToPage('/static/appLoading.html');
  loading.isMainWindowCreated = false;
  
  loading.on('closed', () => {
    if (!loading.isMainWindowCreated) {
      console.log(`[MAIN] ${LanguageVariables.getMessage('APP_LOADING_CANCELLED', 'errors', ApplicationSettings.settings.language)}`);
      app.isQuiting = true;
      app.quit();
    }
  });

  return loading;
}

app.whenReady().then(async () => {
    const winLoading = await createLoadingWindow();
    winLoading.show();

    const win = await createWindow();
    WindowUtils.win = win;

    const internetConnection = await hasInternetConnection();
    console.log("[MAIN] Internet:", internetConnection);

    const authorizationStatus = await Auth.authenticate();
    console.log("[MAIN] Authorization status:", authorizationStatus);

    if(!internetConnection && !authorizationStatus?.success){
        WindowUtils.goToPage('./static/no-internet.html');
        winLoading.hide();
        win.show();
    } else if(!authorizationStatus?.success && internetConnection){
        WindowUtils.goToPage('./static/login.html');
        winLoading.hide();
        win.show();
    }
    else if(authorizationStatus?.success){
      WindowUtils.goToPage('/app/library.html');
      winLoading.hide();
      win.show();
    }
});