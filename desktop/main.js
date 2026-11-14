'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { existsSync } = require('node:fs');

app.setName('ORBIS//1932');

function createWindow() {
  const packagedEntry = path.join(__dirname, 'app', 'index.html');
  const developmentEntry = path.join(__dirname, '..', 'dist', 'orbis1932', 'index.html');
  const entry = existsSync(packagedEntry) ? packagedEntry : developmentEntry;
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'ORBIS//1932',
    backgroundColor: '#eef4fb',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  window.loadFile(entry);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
