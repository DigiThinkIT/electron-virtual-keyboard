const { ipcMain } = require('electron')
const EventEmitter = require('events')

class VirtualKeyboard extends EventEmitter {
    constructor(webContent) {
        super();
        this.webContent = webContent;
        this.keyBuffer = [];
        this.keyPressWait = 30;
        this.init();
    }

    init() {
        // renderer to main process message api handlers
        ipcMain.on('virtual-keyboard-keypress', (e, value) => this.receiveKeyPress(e, value));
        ipcMain.on('virtual-keyboard-config', this.config.bind(this));

        // redirect select events back to renderer process
        this.on('buffer-empty', () => {
            this.webContent.send('keyboard-buffer-empty')
        })
    }

    config(e, key, value) {
        if ( key == 'keyPressWait' ) {
            this.keyPressWait = parseInt(value);
        }
    }

    receiveKeyPress(e, value) {
        // continues adding keys to the key buffer without stopping a flush
        var chars = String(value).split('');
        for(var i=0; i<chars.length; i++) {
            this.keyBuffer.push(chars[i]);
        }

        // don't call flushBuffer if already flushing
        if (!this.flushing ) {
            this.flushBuffer()
        }
    }

    flushBuffer() {
        var ch = this.keyBuffer.shift()
        if ( ch === undefined ) {
            this.flushing = false
            this.emit('buffer-empty')
            return
        }

        this.flushing = true;

        // keydown
        this.webContent.sendInputEvent({
            type: 'keyDown',
            keyCode: ch
        })

        // keypres
        this.webContent.sendInputEvent({
            type: 'char',
            keyCode: ch
        })

        // keyup
        this.webContent.sendInputEvent({
            type: 'keyUp',
            keyCode: ch
        })

        setTimeout(this.flushBuffer.bind(this), this.keyPressWait)
    }
}

module.exports = VirtualKeyboard