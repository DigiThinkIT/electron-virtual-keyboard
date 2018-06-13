const electron = require('electron')
const app = electron.app
const BrowserWindow = electron.BrowserWindow
const path = require('path')
const url = require('url')
const VirtualKeyboard = require('../index');

app.commandLine.appendSwitch('ignore-gpu-blacklist')

let mainWindow
let vkb

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        backgroundColor: '#000000',
    })

    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'demo.html'),
        protocol: 'file:',
        slashes: true
    }))
    mainWindow.webContents.setFrameRate(30)

    mainWindow.show()
    mainWindow.maximize()
    mainWindow.webContents.openDevTools()
    mainWindow.on('closed', function () {
        mainWindow = null
    })

    vkb = new VirtualKeyboard(mainWindow.webContents)
}

app.on('ready', createWindow)
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
app.on('activate', function () {
    if (mainWindow === null) {
        createWindow()
    }
})