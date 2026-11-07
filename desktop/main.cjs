// The desktop wrapper: the same production build the website serves, in a window
// of its own with its own copy of Chromium. Nothing about the game changes here.
const { app, BrowserWindow, ipcMain, Menu, net, protocol, screen: displays, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://game`;
const GAME_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'game')
  : path.join(__dirname, '..', 'dist');

// The game loads its assets with XHR and fetch, which Chromium refuses on file://,
// and the Gamepad API can be withheld from a page that is not a secure context. A
// scheme of our own, registered as secure, answers both. It also leaves the absolute
// asset paths of the web build working as they are.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

// A pad press does not count as a user gesture, so a player who never touches the
// screen would otherwise never unlock the radio and the radar voice.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function serveGameFile(request) {
  const { pathname } = new URL(request.url);
  const file = path.normalize(path.join(GAME_DIR, decodeURIComponent(pathname)));
  const target = pathname === '/' ? path.join(GAME_DIR, 'index.html') : file;
  if (target !== GAME_DIR && !target.startsWith(GAME_DIR + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }
  // A story line whose voice has not been recorded yet is an ordinary miss: the
  // radio net falls back on its subtitle.
  return net.fetch(pathToFileURL(target).toString())
    .catch(() => new Response('Not found', { status: 404 }));
}

function createWindow() {
  // Phaser reads the window size once at startup, and the switch to fullscreen may
  // finish after that, so the window is created at the screen's size to begin with.
  const { width, height } = displays.getPrimaryDisplay().size;
  const window = new BrowserWindow({
    title: 'Radar Game',
    width,
    height,
    fullscreen: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });

  // Links leave for the system browser; this window only ever shows the game.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });

  window.once('ready-to-show', () => window.show());
  window.loadURL(`${ORIGIN}/`);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle(SCHEME, serveGameFile);
  ipcMain.on('quit', () => app.quit());
  createWindow();
});

app.on('window-all-closed', () => app.quit());
