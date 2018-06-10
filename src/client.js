(function (factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['jquery'], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node/CommonJS
        module.exports = function (root, jQuery) {
            if (jQuery === undefined) {
                // require('jQuery') returns a factory that requires window to
                // build a jQuery instance, we normalize how we use modules
                // that require this pattern but the window provided is a noop
                // if it's defined (how jquery works)
                if (typeof window !== 'undefined') {
                    jQuery = require('jquery');
                }
                else {
                    jQuery = require('jquery')(root);
                }
            }
            factory(jQuery);
            return jQuery;
        };
    } else {
        // Browser globals
        factory(jQuery);
    }
}(function ($) {
    const ipcRenderer = require('electron').ipcRenderer;
    const EventEmitter = require('events');

    /**
     * A wrapper over setTimeout to ease clearing and early trigger of the function.
     * @param {function} fn 
     * @param {int} timeout 
     * @returns {object} Returns an object { clear: <function>, trigger: <function> }
     */
    function delayFn(fn, timeout) {
        var timeoutId = setTimeout(fn, timeout);
        return {
            clear: function() {
                clearTimeout(timeoutId);
            },
            trigger: function() {
                clearTimeout(timeoutId);
                fn();
            }
        }
    }

    /**
     * A wrapper over setInterval to ease clearing and early trigger of the function.
     * @param {function} fn 
     * @param {int} interval 
     * @returns {object} Returns an object { clear: <function>, trigger: <function> }
     */
    function repeatFn(fn, interval) {
        var repeatId = setInterval(fn, interval);
        return {
            clear: function() {
                clearInterval(repeatId);
            },
            trigger: function() {
                clearInterval(repeatId);
                fn();
            }
        }
    }

    /**
     * Allows calling fn first at one timeout then repeadeatly at a second interval.
     * Used, to mimic keyboard button held down effect.
     * @param {function} fn 
     * @param {int} delay 
     * @param {int} interval 
     * @returns {object} Returns an object { clear: <function>, trigger: <function> }
     */
    function delayThenRepeat(fn, delay, interval) {
        var secondInt = null
        var firstDelay = null;
        
        firstDelay = delayFn(() => {
            fn();
            secondInt = repeatFn(fn, interval);
            firstDelay = null;
        }, delay);

        return {
            clear: function() {
                if ( firstDelay ) {
                    firstDelay.clear();
                }

                if ( secondInt ) {
                    secondInt.clear();
                }
            },
            trigger: function() {
                if ( firstDelay ) {
                    firstDelay.trigger();
                    firstDelay = null;
                }
                
                if (secondInt) {
                    secondInt.clear();
                    secondInt = null;
                }
            }
        }

    }

    /**
     * Helper class dedicated to create a keyboard layout(single state)
     */
    class KeyboardLayout extends EventEmitter {
        constructor($container, name, layout, config) {
            super();

            this.layout = layout;
            this.$container = $container;
            this.name = name;
            this.config = config;
            this.init();
        }

        init() {
            this.$layoutContainer = $('<div class="layout"></div>');
            this.$layoutContainer.addClass(this.name);
            this.$container.append(this.$layoutContainer);
            if ( this.name != 'normal' ) {
                this.$layoutContainer.hide();
            }

            // lets parse through layout lines and build keys
            for(var i in this.layout) {
                var $row = $('<div class="kb-row"></div>');
                this.$layoutContainer.append($row);

                var keys = this.layout[i].split(/\s+/m);
                for(var ki in keys) {
                    var key = keys[ki];
                    if ( typeof ki != 'function' ) {
                        if ( key.length > 1 ) {
                            // TODO: call custom key handlers
                        }

                        var $key = $(this.config.keyTemplate);
                        $key.text(key);
                        $key.data('kb-key', key);
                        $row.append($key);
                    }
                }

            }
        }
    }

    /**
     * The Virtual Keyboard class holds all behaviour and rendering for our keyboard.
     */
    class VirtualKeyboard extends EventEmitter {
        constructor($el, config) {
            super();

            this.$el = $el;
            this.config = Object.assign({
                show: false,
                displayOnFocus: true,
                container: null,
                autoPosition: true,
                layout: $.fn.keyboard_layouts.default,
                keyTemplate: '<span class="key"></span>'
            }, config);
            this.inited = false;

            this.init();
        }

        /**
         * Initializes our keyboard rendering and event handing.
         */
        init() {
            if ( this.inited ) {
                console.warn("Keyboard already initialized...");
                return;
            }
            var base = this;

            // build a defaut container if we don't get one from client
            // by default we'll just float under the input element
            // otherwise we let the client implement positioning
            if ( !this.config.container ) {
                this.$container = $('<div class="virtual-keyboard"></div>');
                $('body').append(this.$container);
                this.$container.hide();
            }

            // hook up element focus events
            this.$el
                .focus(function(e) {
                    base.inputFocus(e.target);
                })
                .blur(function(e) {
                    base.inputUnFocus(e.target);
                });

            // hook up mouse press down/up keyboard sims
            this.$container
                .mousedown(function(e) {
                    base.simKeyDown(e.target);
                })
                .mouseup(function (e) {
                    base.simKeyUp(e.target);
                });

            // init layout renderer
            // break layouts into separate keyboards, we'll display them according to their
            // define behaviours later.
            this.layout = {}
            for(var k in this.config.layout) {
                if ( typeof this.config.layout[k] != 'function' ) {
                    this.layout[k] = new KeyboardLayout(this.$container, k, this.config.layout[k], this.config);
                }
            }

            this.inited = true;
        }

        /**
         * Handles sending keyboard key press requests to the main electron process.
         * From there we'll simulate real keyboard key presses(as far as chromium is concerned)
         * @param {string} key 
         */
        pressKey(key) {
            ipcRenderer.send("virtual-keyboard-keypress", key);
        }

        /**
         * Handles displaying the keyboard for a certain input element
         * @param {DomElement} el 
         */
        show(el) {
            this.$container.show();

            if ( this.config.autoPosition ) {
                // figure out bottom center position of the element
                var position = el.getBoundingClientRect();
                console.log(el, position);
            }
        }

        /**
         * Handles hiding the keyboard.
         * @param {DomElement} el 
         */
        hide(el) {
            this.$container.hide();
        }

        /**
         * Event handler for input focus event behaviour
         * @param {DomElement} el 
         */
        inputFocus(el) {
            // If we had an unfocus timeout function setup
            // and we are now focused back on an input, lets
            // cancel it and just move the keyboard into position.
            this.currentElement = el;
            if (this.unfocusTimeout) {
                this.unfocusTimeout.clear();
                this.unfocusTimeout = null;
            }
            this.show(el);
        }

        /**
         * Event handler for input blur event behaviour
         * @param {DomElement} el 
         */
        inputUnFocus(el) {
            // setup a timeout to hide keyboard.
            // if the input was unfocused due to clicking on the keyboard,
            // we'll be able to cancel the delayed function.
            this.unfocusTimeout = delayFn(() => {
                console.log("Timeout Reached");
                this.hide(el);
                this.unfocusTimeout = null;
            }, 500);
        }

        simKeyDown(el) {
            // handle key clicks by letting them bubble to the parent container
            // from here we'll call our key presses for normal and custom keys
            // to mimic key held down effect we first trigger our key then wait
            // to call the same key on an interval. Mouse Up stops this loop.

            if (this.unfocusTimeout) {
                this.unfocusTimeout.clear();
                this.unfocusTimeout = null;
            }

            // reset focus on next loop
            setTimeout(() => {
                $(this.currentElement).focus();
            }, 1);

            // if we pressed on key setup interval to mimic repeated key presses
            if ($(el).data('kb-key')) {
                this.keydown = delayThenRepeat(() => {
                    $(this.currentElement).focus();
                    this.pressKey($(el).data('kb-key'));
                }, 500, 100);
            }
        }

        simKeyUp(el) {
            // Mouse up stops key down effect. Since mousedown always presses the key at
            // least once, this event handler takes care of stoping the rest of the loop.

            if (this.keydown) {
                this.keydown.trigger();
                this.keydown = null;
            }
        }
    }

    /**
     * Simple test for $.is() method to test compatible elements against.
     * @param {int} i 
     * @param {DomElement} el 
     */
    function testSupportedElements(i, el) {
        return $(el).is('input:text') || $(el).is('input:password') || $(el).is('textarea');
    }

    /**
     * Creates a virtual keyboard instance on the provided elements.
     * @param {object} config 
     */
    $.fn.keyboard = function (config) {
        if (!config && $(this).data('virtual-keyboard')) {
            return $(this).data('virtual-keyboard');
        }

        $(this).each(function() {
            if ( !$(this).is(testSupportedElements)  ) {
                throw Error("Virtual Keyboard does not support element of type: " + $(this).prop('name') );
            }
        });

        var kb = new VirtualKeyboard($(this), config);
        $(this).data('virtual-keyboard', kb);

        return kb;
    };

    $.fn.keyboard.keys = {
        'enter': {
            render: function(kb, key) {
                return `<span class="action">${key.text.touppercase()}</span>`;
            },
            handler: function(kb, key) {
                return '\n';
            }
        }, 
        'shift': {
            render: function(kb, key) {
                return `<span class="action">${key.text.touppercase()}</span>`;
            },
            handler: function(kb, key) {
                kb.toggleLayout();
                return null;
            }
        }
    }

    $.fn.keyboard_layouts = {
        'default': {
            'normal': [
                '` 1 2 3 4 5 6 7 8 9 0 - = {backspace}',
                '{tab} q w e r t y u i o p [ ] \\',
                'a s d f g h j k l ; \' {enter}',
                '{shift} z x c v b n m , . / {shift}',
                '{space}'
            ],
            'shift': [
                '{:fill} ~ ! @ # $ % ^ & * ( ) _ + {backspace} {:fill}',
                '{:fill} {tab} Q W E R T Y U I O P { } | {:fill}',
                '{:fill} A S D F G H J K L : " {enter} {:fill}',
                '{:fill} {shift} Z X C V B N M < > ? {shift} {:fill}',
                '{:fill} {space:10} {:fill}'
            ]
        }
    };

}));