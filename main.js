const { app, BrowserWindow, nativeTheme, shell } = require('electron');
const path = require('path');
const { startStudioServer, PORT } = require('./server');

let mainWindow = null;

nativeTheme.themeSource = 'dark';
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force-dark-mode');

async function createWindow() {
  await startStudioServer(PORT);

  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: 'Nebula Lyric Studio',
    backgroundColor: '#05060f',
    darkTheme: true,
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#05060f',
      symbolColor: '#cbd5e1',
      height: 32
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
