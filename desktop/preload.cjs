// The one thing the page may ask of the wrapper. A page cannot reliably close its
// own window with window.close(), and it gets no other reach into the machine.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  quit: () => ipcRenderer.send('quit'),
});
