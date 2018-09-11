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
            if ( this.name == 'normal' ) {
                this.$layoutContainer.addClass('active');
            }

            // lets loop over layout once first to check if we have column layout
            // this is defined as an array of arrays. Each row containing more than one
            // string defines a new column
            var columnCount = 1;
            for (var i in this.layout) {
                var layout = this.layout[i];
                if ( layout.constructor == Array ) {
                    if ( columnCount < layout.length ) {
                        columnCount = layout.length;
                    }
                }
            }

            // build column containers
            for (var i=0; i < columnCount; i++) {
                this.$layoutContainer.append('<div class="kb-column"></div>');
            }

            // lets parse through layout lines and build keys
            for(var i in this.layout) {

                var layout = this.layout[i];
                if ( layout.constructor != Array ) {
                    layout = [layout];
                }

                for(var col in layout) {
                    var $row = $('<div class="kb-row"></div>');
                    this.$layoutContainer.find('.kb-column').eq(col).append($row);
                    var keys = layout[col].split(/\s+/m);
                    for(var ki in keys) {
                        var key = keys[ki];
                        if ( typeof ki != 'function' ) {
                            var custom = null;
                            var $key = $(this.config.keyTemplate);
                            var text = key.length > 1?key.replace(/[\{\}]/gm, ''):key;
                            var parts = (text==":")?[":"]:text.split(':');
                            var modifier = { mod: null, applied: [] };
                            if ( parts.length > 1 ) {
                                text = parts[0];
                                modifier.mod = parts[1];
                            }
                            $key.text(text);
                            $row.append($key);
                            // test modifiers
                            if ($.fn.keyboard_custom_modifiers && modifier.mod) {
                                for (var pattern in $.fn.keyboard_custom_modifiers) {
                                    var patternRx = new RegExp(pattern, 'ig');

                                    if ( modifier.mod.search(patternRx) > -1 ) {
                                        $.fn.keyboard_custom_modifiers[pattern](this.keyboard, $key, modifier);
                                    }
                                }
                            }

                            // test config.customKeys to apply customizations
                            if ( this.config.customKeys ) {
                                for(var pattern in this.config.customKeys) {
                                    var patternRx = new RegExp(pattern, 'ig');

                                    if (text.search(patternRx) > -1 ) {
                                        custom = this.config.customKeys[pattern];
                                        if (custom.render ) {
                                            custom.render(this.keyboard, $key, modifier);
                                        }
                                    }
                                }
                            }

                            if (custom && custom.handler ) {
                                $key.data('kb-key-handler', custom.handler);
                            }
                            $key.data('kb-key', text);
                        }
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
                individual: false,
                theme: null,
                show: false,
                displayOnFocus: true,
                container: null,
                autoPosition: true,
                layout: 'us-en', 
                keyTemplate: '<span class="key"></span>',
                customKeys: Object.assign({}, $.fn.keyboard_custom_keys)
            }, config);
            this.inited = false;

            // replace layout key for layout definition lookup on $.fn.keyboard_layouts
            if (typeof this.config.layout === 'string' || 
                this.config.layout instanceof String) {
                this.config.layout = $.fn.keyboard_layouts[this.config.layout];
            }
            this._onMouseDown = false;

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
            } else if ( typeof this.config.container == 'function' ) {
                this.$container = this.config.container(this.$el, this);
                this.$container.addClass('virtual-keyboard');
            }

            if ( this.config.theme ) {
                this.$container.addClass(this.config.theme);
            }

            if ( this.config.show ) {
                this.$container.show();
            } else {
                this.$container.hide();
            }

            // hook up element focus events
            this.$el
                .focus(function(e) {
                    if (base._onMouseDown) {
                        return;
                    }
                    base.inputFocus(e.target);
                })
                .blur(function(e) {
                    if (base._onMouseDown ) {
                        e.stopImmediatePropagation();
                        e.preventDefault();
                        return false;
                    }

                    base.inputUnFocus(e.target);
                });

            // hook up mouse press down/up keyboard sims
            this.$container
                .on("mousedown touchstart", function(e) {
                    if (!base._onMouseDown && $(e.target).data('kb-key') ) {
                        base._onMouseDown = true;
                        base.simKeyDown(e.target);

                        e.stopImmediatePropagation();
                        return false;
                    }
                });
            $('body')
                .on("mouseup touchend", function(e) {
                    if ( base._onMouseDown) {
                        console.log("up: ", e);
                        base._onMouseDown = false;
                        base.simKeyUp(e.target);
                    }
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
         * Displays the next layout or wraps back to the first one in the layout list.
         */
        toggleLayout() {
            var $next = this.$container.find('.layout.active').next();
            if ( $next.length == 0 ) {
                $next = this.$container.find('.layout:first');
            }

            this.$container
                .find('.layout')
                .removeClass('active');
            
           $next.addClass('active');
        }

        /**
         * Displays a layout by name
         * @param {string} name 
         */
        showLayout(name) {
            this.$container
                .find('.layout')
                .removeClass('active');

            this.$container
                .find('.layout.'+name)
                .addClass('active');
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

            if ( this.config.autoPosition && typeof this.config.autoPosition != 'function' ) {
                var offset = $('body').offset();
                // figure out bottom center position of the element
                var bounds = el.getBoundingClientRect();
                var position = {
                    x: bounds.left + offset.left,
                    y: bounds.top + offset.top,
                    width: bounds.width,
                    height: bounds.height
                }

                var x = position.x + ((position.width - this.$container.width()) / 2);``
                // keep container away from spilling outside window width
                if ((x + this.$container.width()) > $(window).width()) {
                    x = $(window).width() - this.$container.width();
                }
                // but also make sure we don't spil out to the left window edge either(priority)
                if ( x < 0 ) {
                    x = 0;
                }
                this.$container.css({
                    position: 'absolute',
                    top: position.y + position.height,
                    left: x
                });
            } else if (typeof this.config.autoPosition == 'function') {
              var position = this.config.autoPosition(el, this.$container);
              this.$container.css({
                  position: 'absolute',
                  top: position.top,
                  left: position.left
              });
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

            if (this.config.displayOnFocus) {
                this.show(el);
            }
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
                if (this.config.displayOnFocus) {
                    this.hide(el);
                }
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

            // if we pressed on key, setup interval to mimic repeated key presses
            if ($(el).data('kb-key')) {
                this.keydown = delayThenRepeat(() => {
                    //$(this.currentElement).focus();
                    var handler = $(el).data('kb-key-handler');
                    var key = $(el).data('kb-key');
                    if (handler) {
                        key = handler(this, $(el));
                    }

                    if ( key !== null && key !== undefined ) {
                        this.pressKey(key);
                    }
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

        var config = Object.assign({}, {
            individual: false
        }, config);

        if (!config && $(this).data('virtual-keyboard')) {
            return $(this).data('virtual-keyboard');
        }

        $(this).each(function() {
            if ( !$(this).is(testSupportedElements)  ) {
                throw Error("Virtual Keyboard does not support element of type: " + $(this).prop('name') );
            }
        });

        if ( !config.individual ) {
            var kb = new VirtualKeyboard($(this), config);
            $(this).data('virtual-keyboard', kb);

            return kb;
        } else {
            return $(this).each(function() {
                var kb = new VirtualKeyboard($(this), config);
                $(this).data('virtual-keyboard', kb);
            });
        }
    };

    $.fn.keyboard_custom_modifiers = {
        '(\\d+|\\*)(%|cm|em|ex|in|mm|pc|pt|px|vh|vw|vmin)?$': function(kb, $key, modifier) {
            var size = modifier.mod;
            if (size == '*') {
                $key.addClass('fill');
            } else {
                if (size && size.search('[a-z]') == -1) {
                    size += 'rem';
                }
                $key.width(size);
                $key.addClass('sizer');
            }

            modifier.applied.push('size');
        }
    }

    $.fn.keyboard_custom_keys = {
        '^[`0-9~!@#$%^&*()_+\-=]$': {
            render: function(kb, $key) {
                $key.addClass('digit');
            }
        },
        '^enter$': {
            render: function(kb, $key) {
                $key.text('\u23ce ' + $key.text());
                $key.addClass('action enter');
            },
            handler: function(kb, $key) {
                return '\r';
            }
        }, 
        '^shift$': {
            render: function(kb, $key) {
                $key.text('\u21e7 ' + $key.text());
                $key.addClass('action shift');
            },
            handler: function(kb, $key) {
                kb.toggleLayout();
                return null;
            }
        },
        '^numeric$': {
            render: function (kb, $key) {
                $key.text('123');
            },
            handler: function(kb, $key) {
                kb.showLayout('numeric');
            }
        },
        '^abc$': {
            handler: function (kb, $key) {
                kb.showLayout('normal');
            }
        },
        '^symbols$': {
            render: function(kb, $key) {
                $key.text('#+=');
            },
            handler: function (kb, $key) {
                kb.showLayout('symbols');
            }
        },
        '^caps$': {
            render: function (kb, $key) {
                $key.text('\u21e7');
                $key.addClass('action shift');
            },
            handler: function (kb, $key) {
                kb.showLayout('shift');
                return null;
            }
        },
        '^lower$': {
            render: function (kb, $key) {
                $key.text('\u21e7');
                $key.addClass('action shift');
            },
            handler: function (kb, $key) {
                kb.showLayout('normal');
                return null;
            }
        },
        '^space$': {
            render: function(kb, $key) {
                $key.addClass('space');
            },
            handler: function(kb, $key) {
                return ' ';
            }
        },
        '^tab$': {
            render: function (kb, $key) {
                $key.addClass('action tab');
            },
            handler: function (kb, $key) {
                return '\t';
            }
        },
        '^backspace$': {
            render: function(kb, $key) {
                $key.text('  \u21e6  ');
                $key.addClass('action backspace');
            },
            handler: function(kb, $key) {
                return '\b';
            }
        },
        '^del(ete)?$': {
            render: function (kb, $key) {
                $key.addClass('action delete');
            },
            handler: function (kb, $key) {
                return String.fromCharCode(127);
            }
        },
        '^sp$': {
            render: function(kb, $key, modifier) {
                $key.empty();
                $key.addClass('spacer');
                if ( modifier.applied.indexOf('size') < 0) {
                    $key.addClass('fill');
                }
            },
            handler: function(kb, $key) {
                return null;
            }
        }
    }

    $.fn.keyboard_layouts = {
        'us-en': {
            'normal': [
                '{`:*} 1 2 3 4 5 6 7 8 9 0 - = {backspace:*}',
                '{tab} q w e r t y u i o p [ ] \\',
                '{sp:2} a s d f g h j k l ; \' {enter}',
                '{shift:*} z x c v b n m , . / {shift:*}',
                '{space}'
            ],
            'shift': [
                '{~:*} ! @ # $ % ^ & * ( ) _ + {backspace:*}',
                '{tab} Q W E R T Y U I O P { } |',
                '{sp:2} A S D F G H J K L : " {enter}',
                '{shift:*} Z X C V B N M < > ? {shift:*}',
                '{space}'
            ]
        },
        'us-en:with-numpad': {
            'normal': [
                '` 1 2 3 4 5 6 7 8 9 0 - = {backspace:*}',
                ['{tab} q w e r t y u i o p [ ] \\', '7 8 9'],
                ['{sp:2} a s d f g h j k l ; \' {enter}', '4 5 6'],
                ['{shift:*} z x c v b n m , . / {shift:*}', '1 2 3'],
                ['{space}', '0']
            ],
            'shift': [
                '~ ! @ # $ % ^ & * ( ) _ + {backspace:*}',
                ['{tab} Q W E R T Y U I O P { } |', '7 8 9'],
                ['{sp:2} A S D F G H J K L : " {enter}', '4 5 6'],
                ['{shift:*} Z X C V B N M < > ? {shift:*}', '1 2 3'],
                ['{space}', '0']
            ]
        },
        'us-en:mobile': {
            'normal': [
                'q w e r t y u i o p',
                'a s d f g h j k l',
                '{caps:*} z x c v b n m {backspace:*}',
                '{numeric} , {space:*} .  {enter}'
            ],
            'shift': [
                'Q W E R T Y U I O P',
                'A S D F G H J K L',
                '{lower:*} Z X C V B N M {backspace:*}',
                '{numeric} , {space:*} . {enter}'
            ],
            'numeric': [
                '1 2 3 4 5 6 7 8 9 0',
                '- / : ; ( ) $ & @ "',
                '{symbols:*} {sp} . , ? ! \' {sp} {backspace:*}',
                '{abc} , {space:*} . {enter}'
            ],
            'symbols': [
                '[ ] { } # % ^ * + =',
                '_ \ | ~ < >',
                '{numeric:*} {sp} . , ? ! \' {Sp} {backspace:*}',
                '{abc} , {space:*} . {enter}'
            ],
        },
        'us-en:mobile-with-numpad': {
            'normal': [
                ['q w e r t y u i o p', '7 8 9'],
                ['a s d f g h j k l', '4 5 6'],
                ['{caps:*} z x c v b n m {backspace:*}', '1 2 3'],
                ['{numeric} , {space:*} .  {enter}', '0:2']
            ],
            'shift': [
                ['Q W E R T Y U I O P', '& * ('],
                ['A S D F G H J K L', '$ % ^'],
                ['{lower:*} Z X C V B N M {backspace:*}', '! @ #'],
                ['{numeric} , {space:*} . {enter}', '):2']
            ],
            'numeric': [
                ['* + = - / : ; $ & @', '7 8 9'],
                ['[ ] { } ( ) # % ^ "', '4 5 6'],
                ['{lower:*} _ \\ | ~ ? ! \' {backspace:*}', '1 2 3'],
                ['{abc} < {space:*} > {enter}', '0:2']
            ]
        }
    };

}));
