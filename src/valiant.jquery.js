/*!
 * Valiant360 panorama video player/photo viewer jquery plugin
 *
 * Copyright (c) 2014 Charlie Hoey <@flimshaw>
 *
 * Released under the MIT license:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Jquery plugin pattern based on https://github.com/jquery-boilerplate/jquery-patterns/blob/master/patterns/jquery.basic.plugin-boilerplate.js
 */

/* REQUIREMENTS:

jQuery 1.7.2 or greater
three.js r87 or higher

*/

/*!
 * jQuery lightweight plugin boilerplate
 * Original author: @ajpiano
 * Further changes, comments: @addyosmani
 * Licensed under the MIT license
 */

// the semi-colon before the function invocation is a safety
// net against concatenated scripts and/or other plugins
// that are not closed properly.
(function ($, THREE, Detector, window, document, undefined) {
    // undefined is used here as the undefined global
    // variable in ECMAScript 3 and is mutable (i.e. it can
    // be changed by someone else). undefined isn't really
    // being passed in so we can ensure that its value is
    // truly undefined. In ES5, undefined can no longer be
    // modified.

    // window and document are passed through as local
    // variables rather than as globals, because this (slightly)
    // quickens the resolution process and can be more
    // efficiently minified (especially when both are
    // regularly referenced in your plugin).

    // Create the defaults once
    var pluginName = 'Valiant360',
        plugin, // will hold reference to instantiated Plugin
        defaults = {
            crossOrigin: 'anonymous',
            clickAndDrag: true,
            keyboardControls: true,
            fov: 35,
            fovMin: 3,
            fovMax: 100,
            hideControls: false,
            lon: 0,
            lat: 0,
            loop: 'loop',
            muted: true,
            volume: 0.5,
            debug: false,
            flatProjection: false,
            autoplay: true,
            useBuffering: true,
            usePreview: true,
            autoMobileOrientation: false,
            mobileVibrationValue: 1
        };

    // The actual plugin constructor
    function Plugin(element, options) {
        this.element = element;

        // jQuery has an extend method that merges the
        // contents of two or more objects, storing the
        // result in the first object. The first object
        // is generally empty because we don't want to alter
        // the default options for future instances of the plugin
        this.options = $.extend({}, defaults, options);

        this._defaults = defaults;
        this._name = pluginName;

        this.init();
    }

    Plugin.prototype = {
        init: function () {
            // Place initialization logic here
            // You already have access to the DOM element and
            // the options via the instance, e.g. this.element
            // and this.options
            // you can add more functions like the one below and
            // call them like so: this.yourOtherFunction(this.element, this.options).

            // instantiate some local variables we're going to need
            this._time = new Date().getTime();
            this._controls = {};
            this._id = this.generateUUID();

            this._requestAnimationId = ''; // used to cancel requestAnimationFrame on destroy
            this._isVideo = false;
            this._isPhoto = false;
            this._isFullscreen = false;
            this._mouseDown = false;
            this.firstTimeHovered = false;
            this._dragStart = {};

            this.isTour = /.json$/i.test($(this.element).attr('data-video-src'));
            this.tourParamsUrl = $(this.element).attr('data-video-src');
            this.tourParams = null;
            this.tourStarted = false;
            this.toursStack = [];

            this.CONST = {
                MAX_LON: 360,
                MIN_LON: 0,
                STEP_DEG: 30,
                ANIMATION_TIME: 500,
                MAX_PLAYBACK_RATE: 8,
                MIN_PLAYBACK_RATE: 1,
                PLAYBACK_STEP: 1
            };

            this.playbackRate = this.CONST.MIN_PLAYBACK_RATE;

            this._lat = this.options.lat;
            this._lon = this.options.lon;
            this._fov = this.options.fov;

            this._xspeed = 0;
            this._yspeed = 0;

            this._smoothing = 0.3; // between 0 and 1
            this._alpha = 0;
            this._beta = 0;

            // save our original height and width for returning from fullscreen
            this._originalWidth = $(this.element)
                .find('canvas')
                .width();
            this._originalHeight = $(this.element)
                .find('canvas')
                .height();

            // add a class to our element so it inherits the appropriate styles
            $(this.element).addClass('Valiant360_default');
            $(this.element).append($('<div class="pointer-overlay"></div>'));

            // add tabindex attribute to enable the focus on the element (required for keyboard controls)
            if (this.options.keyboardControls && !$(this.element).attr('tabindex')) {
                $(this.element).attr('tabindex', '1');
            }

            this.createMediaPlayer();
            this.createControls();
        },

        generateUUID: function () {
            var d = new Date().getTime();
            var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
                /[xy]/g,
                function (c) {
                    var r = ((d + Math.random() * 16) % 16) | 0;
                    d = Math.floor(d / 16);
                    return (c === 'x' ? r : (r & 0x7) | 0x8).toString(16);
                }
            );
            return uuid;
        },

        createMediaPlayer: function () {
            // make a self reference we can pass to our callbacks
            var self = this;

            // create a local THREE.js scene
            this._scene = new THREE.Scene();

            // create ThreeJS camera
            this._camera = new THREE.PerspectiveCamera(
                this._fov,
                $(this.element).width() / $(this.element).height(),
                0.1,
                1000
            );
            this._camera.setLens(this._fov);

            // create ThreeJS renderer and append it to our object
            this._renderer = Detector.webgl
                ? new THREE.WebGLRenderer()
                : new THREE.CanvasRenderer();
            this._renderer.setSize($(this.element).width(), $(this.element).height());
            this._renderer.autoClear = false;
            this._renderer.setClearColor(0x333333, 1);

            // append the rendering element to this div
            $(this.element).append(this._renderer.domElement);

            this.src = $(this.element).attr('data-video-src');

            this.isImage = /(\.jpg|\.png|\.gif|.bmp|.jpeg)$/i.test(this.src);

            // figure out our texturing situation, based on what our source is
            if (this.isImage) {
                this._texture = new THREE.TextureLoader().load(
                    this.src
                );
                this.createAnimation();
            } else {
                this._isVideo = true;

                this.createLoadingOverlay();
                this.showWaiting();

                // this.createDebugOverlay();
                this.createCurrentPositionOverlay();

                // create off-dom video player
                this._video = document.createElement('video');
                this._video.setAttribute('crossorigin', this.options.crossOrigin);

                this._video.style.display = 'none';
                $(this.element).append(this._video);
                this._video.setAttribute("playsinline", "");
                this._video.setAttribute("webkit-playsinline", "");
                this._video.volume = this.options.volume;
                this._video.muted = this.options.muted;

                if (this.isTour) {
                    window.v = this;

                    this.createTourControls();
                    this.setTourParams(this.tourParamsUrl).then(() => {
                        this.createTourVideo();
                    });
                } else {
                    this.createNormalVideo();
                }

            }
        },

        createTourVideo: function () {
            var self = this;

            this._video.loop = false;

            // Progress Meter
            this._video.addEventListener('progress', function () {
                var percent = null;
                if (
                    self._video &&
                    self._video.buffered &&
                    self._video.buffered.length > 0 &&
                    self._video.buffered.end &&
                    self._video.duration
                ) {
                    percent = self._video.buffered.end(0) / self._video.duration;
                } else if (
                    self._video &&
                    self._video.bytesTotal !== undefined &&
                    self._video.bytesTotal > 0 &&
                    self._video.bufferedBytes !== undefined
                ) {
                    // Some browsers (e.g., FF3.6 and Safari 5) cannot calculate target.bufferered.end()
                    // to be anything other than 0. If the byte count is available we use this instead.
                    // Browsers that support the else if do not seem to have the bufferedBytes value and
                    // should skip to there. Tested in Safari 5, Webkit head, FF3.6, Chrome 6, IE 7/8.
                    percent = self._video.bufferedBytes / self._video.bytesTotal;
                }

                // Someday we can have a loading animation for videos
                var cpct = Math.round(percent * 100);
                if (cpct === 100) {
                    // do something now that we are done
                } else {
                    // do something with this percentage info (cpct)
                }

            });
            // Error listener
            this._video.addEventListener('error', function (event) {
                console.error(self._video.error);
            });

            this._video.addEventListener('timeupdate', function () {

                var percent = this.currentTime * 100 / this.duration;
                $(self.element)
                    .find('.controlsWrapper > .valiant-progress-bar')[0]
                    .children[0].setAttribute('style', 'width:' + percent + '%;');
                $(self.element)
                    .find('.controlsWrapper > .valiant-progress-bar')[0]
                    .children[1].setAttribute(
                    'style',
                    'width:' + (100 - percent) + '%;'
                    );
                //Update time label
                var durMin = Math.floor(this.duration / 60);
                var durSec = Math.floor(this.duration - durMin * 60);
                var timeMin = Math.floor(this.currentTime / 60);
                var timeSec = Math.floor(this.currentTime - timeMin * 60);
                var duration = durMin + ':' + (durSec < 10 ? '0' + durSec : durSec);
                var currentTime =
                    timeMin + ':' + (timeSec < 10 ? '0' + timeSec : timeSec);


                if (isNaN(this.duration)) {
                    $(self.element)
                        .find('.controls .timeLabel')
                        .html('');
                } else {
                    $(self.element)
                        .find('.controls .timeLabel')
                        .html(currentTime + ' / ' + duration);
                }

                if (percent >= 99.99) {
                    self.showTour();
                } else {
                    self.hideTour()
                }

                if (this.paused === true) {
                    self.pause();
                }
            });

            // IE 11 and previous not supports THREE.Texture([video]), we must create a canvas that draws the video and use that to create the Texture
            var isIE =
                navigator.appName == 'Microsoft Internet Explorer' ||
                !!(
                    navigator.userAgent.match(/Trident/) ||
                    navigator.userAgent.match(/rv 11/)
                );
            if (isIE) {
                this._videocanvas = document.createElement('canvas');
                this._texture = new THREE.Texture(this._videocanvas);
                // set canvas size = video size when known
                this._video.addEventListener('loadedmetadata', function () {
                    self._videocanvas.width = self._video.videoWidth;
                    self._videocanvas.height = self._video.videoHeight;
                    self.createAnimation();
                });
            } else {
                this._texture = new THREE.VideoTexture(this._video);
            }

            var isWaiting = false;

            this._video.addEventListener('waiting', function () {
                self.showWaiting();
                isWaiting = true;
            });

            this._video.addEventListener('playing', function () {
                self.hideWaiting();
                isWaiting = false;
            });

            this._video.onloadeddata = function () {
                self._video.onseeked = function () {
                    if (self._video.seekable.end(0) >= self._video.duration - 0.1) {
                        self.hideOverlay();
                        self.hideWaiting();
                        self._videoLoading = false;
                        self._videoReady = true;

                        if (self.isTour) {
                            self._lat = self.tourParams.lat;
                            self._lon = self.tourParams.lon;
                        }

                        if (self.autoplay) {
                            self.play();
                        }

                        if (self.isFastRewind) {
                            self.isFastRewind = false;
                            self.currentTourPos = self.tourParams.tours.length - 1;
                            self._video.currentTime = self._video.duration;
                        }

                    } else {
                        self._video.currentTime = self._video.buffered.end(0); // Seek ahead to force more buffering
                    }
                };

                self._video.currentTime = 0; // first seek to trigger the event
            };

            this._video.onseeking = function () {
                self.showWaiting();
            };
            this._video.preload = 'auto';
            this.loadVideo();


            if (this.options.autoplay) {
                this.play();
            }

            if (!isIE) {
                this.createAnimation();
            }
        },

        createNormalVideo: function () {
            var self = this;

            this._video.loop = this.options.loop;

            // Progress Meter
            this._video.addEventListener('progress', function () {
                var percent = null;
                if (
                    self._video &&
                    self._video.buffered &&
                    self._video.buffered.length > 0 &&
                    self._video.buffered.end &&
                    self._video.duration
                ) {
                    percent = self._video.buffered.end(0) / self._video.duration;
                } else if (
                    self._video &&
                    self._video.bytesTotal !== undefined &&
                    self._video.bytesTotal > 0 &&
                    self._video.bufferedBytes !== undefined
                ) {
                    // Some browsers (e.g., FF3.6 and Safari 5) cannot calculate target.bufferered.end()
                    // to be anything other than 0. If the byte count is available we use this instead.
                    // Browsers that support the else if do not seem to have the bufferedBytes value and
                    // should skip to there. Tested in Safari 5, Webkit head, FF3.6, Chrome 6, IE 7/8.
                    percent = self._video.bufferedBytes / self._video.bytesTotal;
                }

                // Someday we can have a loading animation for videos
                var cpct = Math.round(percent * 100);
                if (cpct === 100) {
                    // do something now that we are done
                } else {
                    // do something with this percentage info (cpct)
                }

            });
            // Error listener
            this._video.addEventListener('error', function (event) {
                console.error(self._video.error);
            });

            this._video.addEventListener('timeupdate', function () {

                var percent = this.currentTime * 100 / this.duration;
                $(self.element)
                    .find('.controlsWrapper > .valiant-progress-bar')[0]
                    .children[0].setAttribute('style', 'width:' + percent + '%;');
                $(self.element)
                    .find('.controlsWrapper > .valiant-progress-bar')[0]
                    .children[1].setAttribute(
                    'style',
                    'width:' + (100 - percent) + '%;'
                    );
                //Update time label
                var durMin = Math.floor(this.duration / 60);
                var durSec = Math.floor(this.duration - durMin * 60);
                var timeMin = Math.floor(this.currentTime / 60);
                var timeSec = Math.floor(this.currentTime - timeMin * 60);
                var duration = durMin + ':' + (durSec < 10 ? '0' + durSec : durSec);
                var currentTime =
                    timeMin + ':' + (timeSec < 10 ? '0' + timeSec : timeSec);


                if (isNaN(this.duration)) {
                    $(self.element)
                        .find('.controls .timeLabel')
                        .html('');
                } else {
                    $(self.element)
                        .find('.controls .timeLabel')
                        .html(currentTime + ' / ' + duration);
                }

                if (this.paused === true) {
                    self.pause();
                }
            });

            // IE 11 and previous not supports THREE.Texture([video]), we must create a canvas that draws the video and use that to create the Texture
            var isIE =
                navigator.appName == 'Microsoft Internet Explorer' ||
                !!(
                    navigator.userAgent.match(/Trident/) ||
                    navigator.userAgent.match(/rv 11/)
                );
            if (isIE) {
                this._videocanvas = document.createElement('canvas');
                this._texture = new THREE.Texture(this._videocanvas);
                // set canvas size = video size when known
                this._video.addEventListener('loadedmetadata', function () {
                    self._videocanvas.width = self._video.videoWidth;
                    self._videocanvas.height = self._video.videoHeight;
                    self.createAnimation();
                });
            } else {
                this._texture = new THREE.VideoTexture(this._video);
            }

            var isWaiting = false;

            this._video.addEventListener('waiting', function () {
                self.showWaiting();
                isWaiting = true;
            });

            this._video.addEventListener('playing', function () {
                self.hideWaiting();
                isWaiting = false;
            });

            if (self.options.usePreview && self.options.useBuffering) {
                this._video.onloadeddata = function () {
                    self._video.onseeked = function () {
                        if (self._video.seekable.end(0) >= self._video.duration - 0.1) {
                            self.hideWaiting();
                            self._videoLoading = false;
                            self._videoReady = true;

                            if (self.autoplay) {
                                self.play();
                            }

                        } else {
                            self._video.currentTime = self._video.buffered.end(0); // Seek ahead to force more buffering
                        }
                    };

                    self._video.currentTime = 0; // first seek to trigger the event
                };

                this._video.onseeking = function () {
                    self.showWaiting();
                };
                this._video.preload = 'auto';
                this.loadVideo();
            }

            if (this.options.autoplay) {
                this.play();
            }

            if (!isIE) {
                this.createAnimation();
            }
        },

        createAnimation: function () {
            this._texture.generateMipmaps = false;
            this._texture.minFilter = THREE.LinearFilter;
            this._texture.magFilter = THREE.LinearFilter;
            this._texture.format = THREE.RGBFormat;

            // create ThreeJS mesh sphere onto which our texture will be drawn
            this._mesh = new THREE.Mesh(
                new THREE.SphereGeometry(500, 80, 50),
                new THREE.MeshBasicMaterial({ map: this._texture })
            );
            this._mesh.scale.x = -1; // mirror the texture, since we're looking from the inside out
            this._scene.add(this._mesh);

            this.animate();
        },

        createDebugOverlay: function () {
            var debugHTML = `
            <div class="debug-panel">
                <div class="lat"></div>
                <div class="lon"></div>
                <div class="current-position"></div>
                <div class="params-url"></div>
            </div>`;

            $(this.element).append(debugHTML);
        },

        createLoadingOverlay: function () {
            var loadingHTML =
                '<div class="loading"> \
                <div class="icon waiting-icon"></div> \
                <div class="icon error-icon"><i class="fa fa-exclamation-triangle" aria-hidden="true"></i></div> \
            </div>';
            $(this.element).append(loadingHTML);
        },

        createCurrentPositionOverlay: function () {
            var overlay = $(`<div class="overlay"></div>`);
            $(this.element).append(overlay);
            this.overlayEl = overlay;
            this.recalculateOverlayPosition();
        },

        recalculateOverlayPosition: function () {
            var parentHeight = $(this.element).height();
            var parentWidth = $(this.element).width();
            console.log(this.overlayEl)
            var width = this.overlayEl.width();
            var height = this.overlayEl.height();

            var nextTop = -((height - parentHeight) / 2);
            var nextLeft = -((width - parentWidth) / 2);
            this.overlayEl.css({ top: nextTop + 'px', left: nextLeft + 'px' });
        },

        showTour: function () {
            if (!this.tourStarted) {
                console.log('showTour');

                // set last tour index;
                this.currentTourPos = this.tourParams.tours.length - 1
                this.updateTourPosition()

                setTimeout(() => {
                    $(this.element).find('.tour-controls').addClass('showing');
                    this.updateCurrentTourPos();
                }, this.CONST.ANIMATION_TIME);

                this.tourStarted = true;
            }
        },

        hideTour: function () {
            if (this.tourStarted) {
                console.log('hideTour', this.tourStarted);

                $(this.element).find('.tour-controls').removeClass('showing');

                this.tourStarted = false;
            }
        },

        createTourControls: function () {
            var tourControlsHTML = `
            <div class="tour-controls">
                <div class="tour-button left-button"></div>
                <div class="tour-button up-button"></div>
                <div class="tour-button right-button"></div>
            </div>`;

            $(this.element).append(tourControlsHTML, true);

            // wire up controller events to dom elements
            this.attachTourControlEvents();
        },

        attachTourControlEvents: function () {
            var self = this;

            $(self.element)
                .find('.tour-controls > .left-button')[0]
                .addEventListener('mousedown', this.onTourLeftClick.bind(this), false);

            $(self.element)
                .find('.tour-controls > .up-button')[0]
                .addEventListener('mousedown', this.onTourUpClick.bind(this), false);
            $(self.element)
                .find('.tour-controls > .right-button')[0]
                .addEventListener('mousedown', this.onTourRightClick.bind(this), false);

        },

        onTourLeftClick: function (event) {
            event.stopPropagation();

            var tours = this.tourParams.tours;
            var tour = tours[this.currentTourPos];
            var lon = this._lon;

            if (lon > tour.pos.lon && lon - tour.pos.lon <= this.CONST.STEP_DEG
                || lon <= tour.pos.lon
                || lon > tour.pos.lon && this.CONST.MAX_LON - lon <= this.CONST.STEP_DEG) {
                --this.currentTourPos;
            }

            if (this.currentTourPos < 0) {
                this.currentTourPos = tours.length - 1;
            }

            this.updateTourPosition('left');
        },

        onTourUpClick: function (event) {
            event.stopPropagation();

            var currentTour = this.getCurrentTour();
            this.hideTour();
            this.showOverlay();
            this._videoLoading = true;

            this.toursStack.push(this.tourParams);

            this.autoplay = true;
            this.tourParamsUrl = currentTour.params;
            this.setTourParams(currentTour.params).then(() => {
                setTimeout(() => {
                    this.loadVideo();
                }, 100);
            });
        },

        onTourRightClick: function (event) {
            event.stopPropagation();

            var tours = this.tourParams.tours;
            var tour = tours[this.currentTourPos];
            var lon = this._lon;

            if (lon < tour.pos.lon && tour.pos.lon - lon <= 30
                || lon >= tour.pos.lon) {
                ++this.currentTourPos;
            }

            if (this.currentTourPos > tours.length - 1) {
                this.currentTourPos = 0;
            }

            this.updateTourPosition('right');
        },

        showOverlay: function () {
            $(this.element).find('.overlay').addClass('show');
        },

        hideOverlay: function () {
            $(this.element).find('.overlay').removeClass('show');
        },

        updateTourPosition: function (direction) {
            var currentTour = this.getCurrentTour();

            this.setEasyPosition(currentTour.pos.lat, currentTour.pos.lon, this.CONST.ANIMATION_TIME, direction);

            console.log('currentTour: ', currentTour);
        },

        getCurrentTour: function () {
            return this.tourParams.tours[this.currentTourPos];
        },

        setTourParams: function (url) {
            return fetch(url)
                .then((res) => res.json())
                .then((json) => {
                    this.tourParams = json;
                    this.src = json.url;
                    this.currentTourPos = 0;

                    console.log('currentLoadedParams: ', json, url);
                });
        },

        setEasyPosition: function (lat, lon, time, direction) {

            const isRight = direction === 'right';
            const isLeft = direction === 'left';
            const interval = 10;
            var stepLat = ((lat - this._lat) / time) * interval;

            // todo refactor
            if (isRight) {
                var needToUpdateLon = (
                    (lon < this._lon ? (this.CONST.MAX_LON + lon) : lon)
                    - this._lon);
                var stepLon = (needToUpdateLon / time) * interval;
            } else if (isLeft) {
                var needToUpdateLon = this._lon < lon ?
                    (this.CONST.MAX_LON - lon) + this._lon
                    : this._lon - lon;
                var stepLon = (needToUpdateLon / time) * interval;
            } else {
                var stepLon = ((lon - this._lon) / time) * interval;
            }

            var startDate = Date.now();

            let count = time / interval;

            if (this.h_interval) {
                clearInterval(this.h_interval);
            }

            // console.log(lon, this._lon, needToUpdateLon, stepLon);

            const fn = () => {
                if (count-- <= 1) { clearInterval(this.h_interval); this.h_interval = null; }

                this._lat += stepLat;
                // todo refactor
                if (isRight) {
                    this._lon += stepLon;

                    if (this._lon > this.CONST.MAX_LON) {
                        this._lon = this._lon - this.CONST.MAX_LON;
                    }
                } else if (isLeft) {
                    this._lon -= stepLon;

                    if (this._lon < this.CONST.MIN_LON) {
                        this._lon = this._lon + this.CONST.MAX_LON;
                    }
                } else {
                    this._lon += stepLon;
                }

                // console.log(Date.now() - startDate, count, this._lat, this._lon);
            }

            fn();
            this.h_interval = setInterval(fn.bind(this), interval);
        },

        isMobile: function () {
            var check = false;
            (function (a) {
                if (
                    /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(
                        a
                    ) ||
                    /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(
                        a.substr(0, 4)
                    )
                )
                    check = true;
            })(navigator.userAgent || navigator.vendor || window.opera);
            return check;
        },
        // creates div and buttons for onscreen video controls
        createControls: function () {
            var muteControl = this.options.muted ? 'fa-volume-off' : 'fa-volume-up';
            var playPauseControl = this.options.autoplay ? 'fa-pause' : 'fa-play';
            var displayStyle = this.isImage ? 'style="display: none"' : '';

            var tourMuteControl = this.options.muted ? 'mute' : 'unmute';
            var tourPlayPauseControl = this.options.autoplay ? 'pause' : 'play';

            var controlsHTML =
                `
                <div class="controlsWrapper showed">
                    <div class="valiant-progress-bar" ${displayStyle}>
                    <div style="width: 0;"></div><div style="width: 100%;"></div>
                </div>
                <div class="controls">
                    <a href="#" class="playButton button fa ${playPauseControl}" ${displayStyle}></a>
                    <div class="audioControl" ${displayStyle}>
                        <a href="#" class="muteButton button fa ${muteControl}"></a>
                    <div class="volumeControl" ${displayStyle}>
                    <div class="volumeBar">
                        <div class="volumeProgress"></div>
                        <div class="volumeCursor"></div>
                    </div>
                    </div>
                </div>
                <span class="timeLabel"></span>
                    <a href="#" class="fullscreenButton button fa fa-expand"></a>
                </div>
              </div>`;

            var tourControlsHTML = `
            <div class="tour-controls-wrapper">
                <div class="playback-control ${tourPlayPauseControl}"></div>
                <div class="speed-down"></div>
                <div class="speed-up"></div>
                <div class="fast-forward"></div>
                <div class="fast-rewind"></div>
                <div class="volume-control ${tourMuteControl}"></div>
            </div>`;

            $(this.element).append(controlsHTML, true);
            $(this.element).append('<div class="timeTooltip">00:00</div>', true);

            // hide controls if option is set
            if (this.options.hideControls || this.isTour) {
                $(this.element)
                    .find('.controlsWrapper')
                    .hide();
            }

            if (this.isTour) {
                $(this.element).append(tourControlsHTML, true);
            }

            // wire up controller events to dom elements
            this.attachControlEvents();
        },

        polyfillsTouchEvents: function (callback) {
            return function (event) {
                if (typeof event.changedTouches !== 'undefined') {
                    // touch
                    event.pageX = event.changedTouches[0].pageX;
                    event.pageY = event.changedTouches[0].pageY;
                }

                callback(event);
            };
        },

        onDeviceMove: function (event) {
            // console.log(event);

            if (typeof event.rotationRate === 'undefined') return;
            var x = event.rotationRate.alpha;
            var y = event.rotationRate.beta;
            var portrait =
                typeof event.portrait !== 'undefined'
                    ? event.portrait
                    : window.matchMedia('(orientation: portrait)').matches;
            var landscape =
                typeof event.landscape !== 'undefined'
                    ? event.landscape
                    : window.matchMedia('(orientation: landscape)').matches;
            var orientation = event.orientation || window.orientation;

            if (landscape) {
                var orientationDegree = -90;
                if (typeof orientation != 'undefined') {
                    orientationDegree = orientation;
                }

                this._lon =
                    orientationDegree == -90
                        ? this._lon + x * this.options.mobileVibrationValue
                        : this._lon - x * this.options.mobileVibrationValue;
                this._lat = orientationDegree == -90 ? this._lat + y * this.options.mobileVibrationValue : this._lat - y * this.options.mobileVibrationValue;
            } else {
                this._lon = this._lon - y * this.options.mobileVibrationValue;
                this._lat = this._lat + x * this.options.mobileVibrationValue;
            }
        },

        attachControlEvents: function () {
            // create a self var to pass to our controller functions
            var self = this;

            this.element.addEventListener(
                'mousewheel',
                this.onMouseWheel.bind(this),
                false
            );
            this.element.addEventListener(
                'DOMMouseScroll',
                this.onMouseWheel.bind(this),
                false
            );

            if (self.isMobile()) {
                this.element.addEventListener(
                    'touchstart',
                    this.polyfillsTouchEvents(this.onMouseDown.bind(this)),
                    false
                );
                this.element.addEventListener(
                    'touchmove',
                    this.polyfillsTouchEvents(this.onMouseMove.bind(this)),
                    false
                );
                this.element.addEventListener(
                    'touchend',
                    this.polyfillsTouchEvents(this.onMouseUp.bind(this)),
                    false
                );

                if (window.DeviceMotionEvent) {
                    window.addEventListener(
                        'devicemotion',
                        this.onDeviceMove.bind(this),
                        false
                    );
                }
            } else {
                this.element.addEventListener(
                    'mousedown',
                    this.onMouseDown.bind(this),
                    false
                );
                this.element.addEventListener(
                    'mousemove',
                    this.onMouseMove.bind(this),
                    false
                );
                this.element.addEventListener(
                    'mouseup',
                    this.onMouseUp.bind(this),
                    false
                );
            }

            if (!this.isImage) {
                this.element.addEventListener(
                    'dblclick',
                    this.onDblclick.bind(this),
                    false
                );
            }

            if (this.options.keyboardControls) {
                this.element.addEventListener(
                    'keydown',
                    this.onKeyDown.bind(this),
                    false
                );
                this.element.addEventListener('keyup', this.onKeyUp.bind(this), false);
                // Used custom press event because for the arrow buttons is not throws the 'keypress' event
                this.element.addEventListener(
                    'keyArrowPress',
                    this.onKeyArrowPress.bind(this),
                    false
                );
                this.element.addEventListener(
                    'click',
                    function () {
                        $(self.element).focus();
                    },
                    false
                );
            }

            if (window.DeviceMotionEvent) {
                // Listen for the event and handle DeviceOrientationEvent object
                if (!/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
                    this.element.addEventListener(
                        'mousemove',
                        this.onMouseMove.bind(this),
                        false
                    );
                }
            } else {
                this.element.addEventListener(
                    'mousemove',
                    this.onMouseMove.bind(this),
                    false
                );
            }

            $(self.element)
                .find('.controlsWrapper > .valiant-progress-bar')[0]
                .addEventListener('click', this.onProgressClick.bind(this), false);

            $(self.element)
                .find('.controlsWrapper > .valiant-progress-bar')[0]
                .addEventListener(
                'mousemove',
                this.onProgressMouseMove.bind(this),
                false
                );
            $(self.element)
                .find('.controlsWrapper > .valiant-progress-bar')[0]
                .addEventListener(
                'mouseout',
                this.onProgressMouseOut.bind(this),
                false
                );

            $(document).on(
                'webkitfullscreenchange mozfullscreenchange fullscreenchange MSFullscreenChange',
                this.fullscreen.bind(this)
            );

            $(window).resize(function () {
                self.resizeGL($(self.element).width(), $(self.element).height());
                setTimeout(() => {
                    self.recalculateOverlayPosition();
                })
            });

            // Player Controls
            $(this.element)
                .find('.playButton')
                .click(function (e) {
                    e.preventDefault();
                    if ($(this).hasClass('fa-pause')) {
                        $(this)
                            .removeClass('fa-pause')
                            .addClass('fa-play');
                        self.pause();
                    } else {
                        $(this)
                            .removeClass('fa-play')
                            .addClass('fa-pause');
                        self.play();
                    }
                });

            $(this.element)
                .find('.muteButton')
                .click(function (e) {
                    e.preventDefault();
                    if ($(this).hasClass('fa-volume-off')) {
                        $(this)
                            .removeClass('fa-volume-off')
                            .addClass('fa-volume-up');
                        self._video.muted = false;
                    } else {
                        $(this)
                            .removeClass('fa-volume-up')
                            .addClass('fa-volume-off');
                        self._video.muted = true;
                    }
                });

            if (this.isTour) {

                $(this.element)
                    .find('.tour-controls-wrapper .playback-control')
                    .click(function (e) {
                        e.preventDefault();
                        if ($(this).hasClass('pause')) {
                            $(this)
                                .removeClass('pause')
                                .addClass('play');
                            self.pause();
                        } else {
                            $(this)
                                .removeClass('play')
                                .addClass('pause');
                            self.play();
                        }
                    });

                $(this.element)
                    .find('.tour-controls-wrapper .volume-control')
                    .click(function (e) {
                        e.preventDefault();
                        if ($(this).hasClass('mute')) {
                            $(this)
                                .removeClass('mute')
                                .addClass('unmute');
                            self._video.muted = false;
                        } else {
                            $(this)
                                .removeClass('unmute')
                                .addClass('mute');
                            self._video.muted = true;
                        }
                    });


                // tour speed controls
                $(this.element)
                    .find('.tour-controls-wrapper .speed-up')
                    .click((e) => {
                        e.preventDefault();
                        this.onPlaybackRateUp();
                    });

                $(this.element)
                    .find('.tour-controls-wrapper .speed-down')
                    .click((e) => {
                        e.preventDefault();
                        this.onPlaybackRateDown();
                    });


                // tour fast nav
                $(this.element)
                    .find('.tour-controls-wrapper .fast-forward')
                    .click((e) => {
                        e.preventDefault();
                        this.tourFastForward();
                    });

                $(this.element)
                    .find('.tour-controls-wrapper .fast-rewind')
                    .click((e) => {
                        e.preventDefault();
                        this.tourRewind();
                    });
            }

            $(this.element)
                .find('.fullscreenButton')
                .click(function (e) {
                    e.preventDefault();
                    var elem = $(self.element)[0];
                    if ($(this).hasClass('fa-expand')) {
                        if (elem.requestFullscreen) {
                            elem.requestFullscreen();
                        } else if (elem.msRequestFullscreen) {
                            elem.msRequestFullscreen();
                        } else if (elem.mozRequestFullScreen) {
                            elem.mozRequestFullScreen();
                        } else if (elem.webkitRequestFullscreen) {
                            elem.webkitRequestFullscreen();
                        }
                    } else {
                        if (elem.requestFullscreen) {
                            document.exitFullscreen();
                        } else if (elem.msRequestFullscreen) {
                            document.msExitFullscreen();
                        } else if (elem.mozRequestFullScreen) {
                            document.mozCancelFullScreen();
                        } else if (elem.webkitRequestFullscreen) {
                            document.webkitExitFullscreen();
                        }

                        $(window).trigger('resize');
                    }
                });



            $(this.element)
                .find('.controlsWrapper .volumeControl')
                .mousedown(this.onVolumeMouseDown.bind(this))
                .mouseup(this.onVolumeMouseUp.bind(this))
                .mouseleave(this.onVolumeMouseUp.bind(this))
                .mousemove(this.onVolumeMouseMove.bind(this));

            $(this._video).on('volumechange', this.onVolumeChange.bind(this));
        },

        updateCurrentTourPos: function () {
            if (!this.isTour) { return };

            const lat = this._lat;
            const lon = this._lon;

            const calcedTours = this.getCalcedTours();
            let currentTour;

            // TODO refactor
            for (let i = 0; i < calcedTours.length; ++i) {
                let tour = calcedTours[i]

                if (tour.prevPos > tour.nextPos) {
                    if (lon <= tour.nextPos && ((((this.CONST.MAX_LON + lon) - this.CONST.MAX_LON) >= (this.CONST.MAX_LON - tour.prevPos)) || ((this.CONST.MAX_LON - tour.prevPos) >= lon))) {
                        currentTour = { tour, i };
                    } else if (lon >= tour.prevPos && ((this.CONST.MAX_LON - lon) < (this.CONST.MAX_LON - tour.prevPos))) {
                        currentTour = { tour, i };
                    }
                } else if (lon >= tour.prevPos && lon <= tour.nextPos) {
                    currentTour = { tour, i };
                }
            }

            if (!currentTour) {
                console.error(lon);
            } else {
                this.currentTourPos = currentTour.i;
            }

        },

        getCalcedTours: function () {
            const calcedTours = [];
            const tours = this.tourParams.tours;

            for (let i = 0; i < tours.length; ++i) {
                const prevPos = (i === 0 ? tours[tours.length - 1] : tours[i - 1]).pos.lon;
                const curPos = tours[i].pos.lon;
                const nextPos = (i === tours.length - 1 ? tours[0] : tours[i + 1]).pos.lon;

                const curTourPos = {
                    pos: curPos
                };

                curTourPos.prevPos = curPos < prevPos ? (((this.CONST.MAX_LON - prevPos) / 2) + prevPos) : ((curPos - prevPos) / 2) + prevPos;
                curTourPos.nextPos = nextPos < curPos ? (((this.CONST.MAX_LON + curPos) - nextPos) / 2) + nextPos : ((nextPos - curPos) / 2) + curPos;

                if (nextPos < curPos) {
                    // var a = (((this.CONST.MAX_LON + curPos) - nextPos) / 2) + nextPos;
                    var a = (((this.CONST.MAX_LON - curPos) + nextPos) / 2) + curPos

                    if (a >= 360) {
                        a -= 360;
                    }
                } else {
                    var a = ((nextPos - curPos) / 2) + curPos;
                }

                if (curPos < prevPos) {
                    var b = (((this.CONST.MAX_LON - prevPos) + curPos) / 2) + prevPos;

                    if (b >= 360) {
                        b -= 360;
                    }
                } else {
                    var b = ((curPos - prevPos) / 2) + prevPos;
                }

                curTourPos.prevPos = b;
                curTourPos.nextPos = a;

                if (a === 360) {
                    // debugger;
                }

                // curTourPos.nextPos = 
                // ? (((this.CONST.MAX_LON + curPos) - nextPos) / 2) + nextPos // (((360 + 270) - 90) / 2) + 90
                // // ? (((this.CONST.MAX_LON - curPos) / 2) + nextPos)
                // : ((nextPos - curPos) / 2) + curPos;



                calcedTours.push(curTourPos);


                /*
                    get prev tour
                    get current tour
                    get next tour
                    if tour last get first tour
                    if tour first get last tour
                    minHalf = (curTour.lon - prevTour.lon) / 2
                    maxHalf = nextTour.lon - curTour.lon
                */
            }

            return calcedTours;
        },

        onMouseMove: function (event) {
            if (window.TouchEvent && event instanceof TouchEvent) {
                event.preventDefault();
            }

            if (!this.firstTimeHovered) {
                $(this.element)
                    .find('.controlsWrapper').removeClass('showed');
                this.firstTimeHovered = true;
            }

            this._mouseMoved = true;

            this._onPointerDownPointerX = event.clientX;
            this._onPointerDownPointerY = -event.clientY;

            this.relativeX =
                event.pageX -
                $(this.element)
                    .find('canvas')
                    .offset().left;

            this._onPointerDownLon = this._lon;
            this._onPointerDownLat = this._lat;

            var x, y;

            if (this.options.clickAndDrag) {
                if (this._mouseDown) {
                    x = event.pageX - this._dragStart.x;
                    y = event.pageY - this._dragStart.y;
                    this._dragStart.x = event.pageX;
                    this._dragStart.y = event.pageY;
                    let nextLon = this._lon + x;
                    let nextLat = this._lat - y;

                    const isRight = x < 0;
                    const isLeft = x > 0;

                    if (isRight && nextLon < this.CONST.MIN_LON) {
                        nextLon = nextLon + this.CONST.MAX_LON;
                    } else if (isLeft && nextLon > this.CONST.MAX_LON) {
                        nextLon = nextLon - this.CONST.MAX_LON;
                    }

                    this._lon = nextLon;
                    this._lat = nextLat;

                    this.updateCurrentTourPos();

                }
            } else {
                x =
                    event.pageX -
                    $(this.element)
                        .find('canvas')
                        .offset().left;
                y =
                    event.pageY -
                    $(this.element)
                        .find('canvas')
                        .offset().top;
                this._lon =
                    x /
                    $(this.element)
                        .find('canvas')
                        .width() *
                    430 -
                    225;
                this._lat =
                    y /
                    $(this.element)
                        .find('canvas')
                        .height() *
                    -180 +
                    90;
            }
        },

        onMouseWheel: function (event) {
            var wheelSpeed = -0.01;

            // WebKit
            if (event.wheelDeltaY) {
                this._fov -= event.wheelDeltaY * wheelSpeed;
                // Opera / Explorer 9
            } else if (event.wheelDelta) {
                this._fov -= event.wheelDelta * wheelSpeed;
                // Firefox
            } else if (event.detail) {
                this._fov += event.detail * 1.0;
            }

            if (this._fov < this.options.fovMin) {
                this._fov = this.options.fovMin;
            } else if (this._fov > this.options.fovMax) {
                this._fov = this.options.fovMax;
            }

            this._camera.setLens(this._fov);
            event.preventDefault();
        },

        onMouseDown: function (event) {
            this._mouseDown = true;
            this._mouseMoved = false;
            this._dragStart.x = event.pageX;
            this._dragStart.y = event.pageY;
        },

        onProgressClick: function (event, newPercent) {
            console.log('onProgressClick');

            if (this._isVideo) {
                var percent =
                    newPercent != null
                        ? newPercent
                        : this.relativeX /
                        $(this.element)
                            .find('canvas')
                            .width() *
                        100;

                $(this.element)
                    .find('.controlsWrapper > .valiant-progress-bar')[0]
                    .children[0].setAttribute('style', 'width:' + percent + '%;');
                $(this.element)
                    .find('.controlsWrapper > .valiant-progress-bar')[0]
                    .children[1].setAttribute('style', 'width:' + (100 - percent) + '%;');

                this._video.currentTime = this._video.duration * percent / 100;
            }
        },

        onProgressMouseMove: function (event) {
            var percent =
                this.relativeX /
                $(this.element)
                    .find('canvas')
                    .width() *
                100;
            if (percent) {
                var tooltip = $(this.element).find('.timeTooltip');
                var tooltipLeft = this.relativeX - tooltip.width() / 2;
                tooltipLeft =
                    tooltipLeft < 0
                        ? 0
                        : Math.min(
                            tooltipLeft,
                            $(this.element)
                                .find('canvas')
                                .width() - tooltip.outerWidth()
                        );
                tooltip.css({ left: tooltipLeft + 'px' });
                tooltip.show();
                var time = percent / 100 * this._video.duration;
                var timeMin = Math.floor(time / 60);
                var timeSec = Math.floor(time - timeMin * 60);
                tooltip.html(timeMin + ':' + (timeSec < 10 ? '0' + timeSec : timeSec));
            }
        },

        onProgressMouseOut: function (event) {
            $(this.element)
                .find('.timeTooltip')
                .hide();
        },

        onMouseUp: function (event) {
            if (this._mouseDown && !this._mouseMoved) {
                let controlsClass = this.isTour ? '.tour-controls-wrapper' : '.controlsWrapper',
                    isControlsElement = !!$(event.target).closest(controlsClass).length;

                if (!isControlsElement) {
                    this.triggerPlayButton();
                }
            }

            this._mouseDown = false;
        },

        onDblclick: function (event) {
            if (!this.tourStarted) {
                let controlsClass = this.isTour ? '.tour-controls-wrapper' : '.controlsWrapper',
                    isControlsElement = !!$(event.target).closest(controlsClass).length;

                if (!isControlsElement) {
                    this.restartVideo(event);
                }
            }
        },



        onPlaybackRateUp: function () {
            this.playbackRate += this.CONST.PLAYBACK_STEP;

            if (this.playbackRate > this.CONST.MAX_PLAYBACK_RATE) {
                this.playbackRate = this.CONST.MAX_PLAYBACK_RATE;
            }

            this._video.playbackRate = this.playbackRate;
        },
        onPlaybackRateDown: function () {
            this.playbackRate -= this.CONST.PLAYBACK_STEP;

            if (this.playbackRate < this.CONST.MIN_PLAYBACK_RATE) {
                this.playbackRate = this.CONST.MIN_PLAYBACK_RATE;
            }

            this._video.playbackRate = this.playbackRate;
        },
        triggerPlayButton: function () {
            if (this.isTour) {
                $(this.element)
                    .find('.playback-control')
                    .trigger('click');
            } else {
                $(this.element)
                    .find('.playButton')
                    .trigger('click');
            }
        },

        onKeyDown: function (event) {
            var keyCode = event.keyCode;
            var key = event.key;
            var CHAR = {
                MINUS: '-',
                PLUS: '+'
            };

            console.log(event);

            if (keyCode >= 37 && keyCode <= 40) {
                event.preventDefault();
                this._keydown = true;
                var pressEvent = document.createEvent('CustomEvent');
                pressEvent.initCustomEvent('keyArrowPress', true, true, {
                    keyCode: keyCode
                });
                this.element.dispatchEvent(pressEvent);
            } else if (keyCode == 32) {
                event.preventDefault();

                if (!this._videoLoading && !this._keydown) {

                    if (this.isTour && this.tourStarted) {
                        this.onTourUpClick(event);
                    } else {
                        this.triggerPlayButton();
                    }

                    this._keydown = true;
                }
            } else if (key == CHAR.MINUS || key == CHAR.PLUS) {
                var wheelSpeed = -0.01;
                var delta = 120;

                if (key == CHAR.MINUS) {
                    this._fov -= delta * wheelSpeed;
                } else if (key == CHAR.PLUS) {
                    this._fov -= -delta * wheelSpeed;
                }

                if (this._fov < this.options.fovMin) {
                    this._fov = this.options.fovMin;
                } else if (this._fov > this.options.fovMax) {
                    this._fov = this.options.fovMax;
                }

                this._camera.setLens(this._fov);
                event.preventDefault();
            }
            // fast forward/rewind
            else if (keyCode == 35 || keyCode == 36) {
                event.preventDefault();

                if (keyCode == 36) {
                    this.tourRewind();
                } else {
                    this.tourFastForward();
                }

                this._keydown = true;
            }
        },

        onKeyUp: function (event) {
            var keyCode = event.keyCode;
            this._keydown = false;
            console.log(this._keydown);

            if (keyCode >= 37 && keyCode <= 40) {
                event.preventDefault();
            }
        },

        onKeyArrowPress: function (event) {
            if (this._keydown) {
                var keyCode = event.detail ? event.detail.keyCode : null;
                var offset = 3;
                var pressDelay = 50;
                var element = this.element;
                let nextLon;
                event.preventDefault();
                switch (keyCode) {
                    //Arrow left
                    case 37:

                        nextLon = this._lon - offset;

                        if (nextLon < this.CONST.MIN_LON) {
                            nextLon = nextLon + this.CONST.MAX_LON;
                        }

                        this._lon = nextLon;

                        this.updateCurrentTourPos();

                        break;
                    //Arrow right
                    case 39:

                        nextLon = this._lon + offset;

                        if (nextLon > this.CONST.MAX_LON) {
                            nextLon = nextLon - this.CONST.MAX_LON;
                        }

                        this._lon = nextLon;

                        this.updateCurrentTourPos();

                        break;
                    //Arrow up
                    case 38:
                        this._lat += offset;
                        break;
                    //Arrow down
                    case 40:
                        this._lat -= offset;
                        break;
                }
                setTimeout(function () {
                    var pressEvent = document.createEvent('CustomEvent');
                    pressEvent.initCustomEvent('keyArrowPress', true, true, {
                        keyCode: keyCode
                    });
                    element.dispatchEvent(pressEvent);
                }, pressDelay);
            }
        },

        onVolumeMouseDown: function (event) {
            event.preventDefault();
            this._volumeMouseDown = true;
            this.onVolumeMouseMove(event);
        },

        onVolumeMouseUp: function (event) {
            event.preventDefault();
            this._volumeMouseDown = false;
        },

        onVolumeMouseMove: function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (this._volumeMouseDown) {
                var volumeControl = $(this.element).find(
                    '.controlsWrapper .volumeControl'
                );

                var percent = (event.clientX - volumeControl.offset().left) / volumeControl.width() * 100

                if (percent >= 0 && percent <= 100) {
                    this._video.volume = percent / 100;
                }
            }
        },

        onVolumeChange: function (event) {
            //change volume cursor value

            var percent =
                this._video.muted == true && !this._volumeMouseDown
                    ? 0
                    : this._video.volume * 100;
            $(this.element)
                .find('.controlsWrapper .volumeControl > .volumeBar')
                .css({ width: percent + '%' });

            //change mute button
            var muteButton = $(this.element).find('.muteButton');
            if (
                (percent > 0 && muteButton.hasClass('fa-volume-off')) ||
                (percent == 0 && muteButton.hasClass('fa-volume-up'))
            ) {
                muteButton.click();
            }
        },

        tourFastForward: function () {
            if (this._video.currentTime != this._video.duration) {
                this._video.currentTime = this._video.duration;
            }
        },

        tourRewind: function () {
            if (this.toursStack.length) {
                this.tourParams = this.toursStack.pop();
                this.src = this.tourParams.url;

                this.isFastRewind = true;
                this.loadVideo();
            }
        },

        restartVideo: function (event) {
            if (this._videoReady) {
                this.onProgressClick(event, 0);
            }
        },

        animate: function () {
            // set our animate function to fire next time a frame is ready
            this._requestAnimationId = requestAnimationFrame(this.animate.bind(this));

            if (this._isVideo) {
                if (this._video.readyState === this._video.HAVE_ENOUGH_DATA) {
                    if (this._videocanvas) {
                        this._videocanvas
                            .getContext('2d')
                            .drawImage(
                            this._video,
                            0,
                            0,
                            this._videocanvas.width,
                            this._videocanvas.height
                            );
                    }
                    if (typeof this._texture !== 'undefined') {
                        var ct = new Date().getTime();
                        if (ct - this._time >= 30) {
                            this._texture.needsUpdate = true;
                            this._time = ct;
                        }
                    }
                }
            }

            this.render();
        },

        render: function () {

            var debugPanel = $(this.element).find('.debug-panel');
            debugPanel.find('.lat').text(this._lat);
            debugPanel.find('.lon').text(this._lon);
            debugPanel.find('.current-position').text(this.currentTourPos);

            if (this.tourParams) {
                debugPanel.find('.params-url').text(this.getCurrentTour().params);
            }


            this._lat = Math.max(-85, Math.min(85, this._lat));
            this._phi = (90 - this._lat) * Math.PI / 180;
            this._theta = this._lon * Math.PI / 180;

            var cx = 500 * Math.sin(this._phi) * Math.cos(this._theta);
            var cy = 500 * Math.cos(this._phi);
            var cz = 500 * Math.sin(this._phi) * Math.sin(this._theta);

            this._camera.lookAt(new THREE.Vector3(cx, cy, cz));

            // distortion
            if (this.options.flatProjection) {
                this._camera.position.x = 0;
                this._camera.position.y = 0;
                this._camera.position.z = 0;
            } else {
                this._camera.position.x = -cx;
                this._camera.position.y = -cy;
                this._camera.position.z = -cz;
            }

            this._renderer.clear();
            this._renderer.render(this._scene, this._camera);
        },

        // Video specific functions, exposed to controller
        play: function () {
            if (this.isImage || this.tourStarted) { return; }

            this._video.play();
        },

        pause: function () {
            if (this.isImage || this.tourStarted) { return; }

            this._video.pause();
        },

        loadVideo: function () {
            this._video.src = this.src;
            this._video.playbackRate = this.playbackRate;
        },
        unloadVideo: function () {
            // overkill unloading to avoid dreaded video 'pending' bug in Chrome. See https://code.google.com/p/chromium/issues/detail?id=234779
            this.pause();
            this._video.src = '';
            this._video.removeAttribute('src');
        },
        loadPhoto: function (photoFile) {
            this._texture = THREE.ImageUtils.loadTexture(photoFile);
        },

        fullscreen: function () {

            if ($(this.element).find('a.fa-expand').length > 0) {
                this.resizeGL(screen.width, screen.height);

                $(this.element).addClass('fullscreen');
                $(this.element)
                    .find('a.fa-expand')
                    .removeClass('fa-expand')
                    .addClass('fa-compress');

                this._isFullscreen = true;
            } else {
                this.resizeGL(this._originalWidth, this._originalHeight);

                $(this.element).removeClass('fullscreen');
                $(this.element)
                    .find('a.fa-compress')
                    .removeClass('fa-compress')
                    .addClass('fa-expand');

                this._isFullscreen = false;

                $(window).trigger('resize');
            }
        },

        resizeGL: function (w, h) {
            this._renderer.setSize(w, h);
            this._camera.aspect = w / h;
            this._camera.updateProjectionMatrix();
        },

        showWaiting: function () {
            var loading = $(this.element).find('.loading');
            loading.find('.waiting-icon').show();
            loading.find('.error-icon').hide();
            loading.show();
        },

        hideWaiting: function () {
            var loading = $(this.element).find('.loading');
            loading.removeClass('force-show');
            loading.hide();
        },

        showError: function () {
            var loading = $(this.element).find('.loading');
            loading.find('.waiting-icon').hide();
            loading.find('.error-icon').show();
            loading.show();
        },

        destroy: function () {
            window.cancelAnimationFrame(this._requestAnimationId);
            this._requestAnimationId = '';
            this._texture.dispose();
            this._scene.remove(this._mesh);
            if (this._isVideo) {
                this.unloadVideo();
            }
            $(this._renderer.domElement).remove();
        }
    };

    $.fn[pluginName] = function (options) {
        // use pluginArguments instead of this.each arguments, otherwise Valiant360('loadVideo', 'path/to/video') path argument will be missing
        var pluginArguments = arguments;

        return this.each(function () {
            if (typeof options === 'object' || !options) {
                // A really lightweight plugin wrapper around the constructor,
                // preventing against multiple instantiations

                this.plugin = new Plugin(this, options);
                if (!$.data(this, 'plugin_' + pluginName)) {
                    $.data(this, 'plugin_' + pluginName, this.plugin);
                }

            } else if (this.plugin[options]) {

                // Allows plugin methods to be called - use pluginArguments instead of this.each arguments
                return this.plugin[options].apply(
                    this.plugin,
                    Array.prototype.slice.call(pluginArguments, 1)
                );

            }
        });
    };
})(jQuery, THREE, Detector, window, document);
