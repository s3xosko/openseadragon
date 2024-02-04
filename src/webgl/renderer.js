// 900 riadkov

(function($) {


    /**
     * Wrapping the funcionality of WebGL to be suitable for tile processing and rendering.
     * Written by Aiosa
     * @class OpenSeadragon.WebGLModule
     * @memberOf OpenSeadragon
     */
    $.WebGLModule = class extends $.EventSource {
        /**
         * @typedef {{
         *  name?: string,
         *  lossless?: boolean,
         *  shaders: Object.<string, OpenSeadragon.WebGLModule.ShaderLayerConfig>
         * }} OpenSeadragon.WebGLModule.RenderingConfig
         *
         * //use_channel[X] name
         * @template {Object<string,any>} TUseChannel
         * //use_[fitler_name]
         * @template {Object<string,number>} TUseFilter
         * @template {Object<string,(string|any)>} TIControlConfig
         * @typedef OpenSeadragon.WebGLModule.ShaderLayerParams
         * @type {{TUseChannel,TUseFilter,TIControlConfig}}
         *
         * @typedef {{
         *   name?: string,
         *   type: string,
         *   visible?: boolean,
         *   dataReferences: number[],
         *   params?: OpenSeadragon.WebGLModule.ShaderLayerParams,
         *  }} OpenSeadragon.WebGLModule.ShaderLayerConfig
         *
         *
         * @typedef OpenSeadragon.WebGLModule.UIControlsRenderer
         * @type function
         * @param {string} title
         * @param {string} html
         * @param {string} dataId
         * @param {boolean} isVisible
         * @param {OpenSeadragon.WebGLModule.ShaderLayer} layer
         * @param {boolean} wasErrorWhenLoading
         */


        /**
         * @param {object} incomingOptions
         * @param {string} incomingOptions.htmlControlsId: where to render html controls,
         * @param {string} incomingOptions.webGlPreferredVersion prefered WebGL version, for now "1.0" or "2.0"
         * @param {OpenSeadragon.WebGLModule.UIControlsRenderer} incomingOptions.htmlShaderPartHeader function that generates particular layer HTML
         * @param {boolean} incomingOptions.debug debug mode default false
         * @param {function} incomingOptions.ready function called when ready
         * @param {function} incomingOptions.resetCallback function called when user input changed, e.g. changed output of the current rendering
         * signature f({WebGLModule.VisualizationConfig} oldVisualisation,{WebGLModule.VisualizationConfig} newVisualisation)
         * @constructor
         * @memberOf OpenSeadragon.WebGLModule
         */
        constructor(incomingOptions) {
            // console.log("vytvaram renderer hihi");
            super();

            /////////////////////////////////////////////////////////////////////////////////
            ///////////// Default values overrideable from incomingOptions  /////////////////
            /////////////////////////////////////////////////////////////////////////////////
            this.uniqueId = "";

            //todo events instead
            this.ready = function() { };
            this.htmlControlsId = null;
            this.webGlPreferredVersion = "2.0";
            this.htmlShaderPartHeader = function(title, html, dataId, isVisible, layer, isControllable = true) {
                return `<div class="configurable-border"><div class="shader-part-name">${title}</div>${html}</div>`;
            };
            this.resetCallback = function() { };
            //called once a visualisation is compiled and linked (might not happen)
            this.visualisationReady = function(i, visualisation) { };

            /**
             * Debug mode.
             * @member {boolean}
             */
            /* malo by byt pod incoming values inak sa moze prepisat z incomingOptions.debug */
            this.debug = false;

            /////////////////////////////////////////////////////////////////////////////////
            ///////////// Incoming Values ///////////////////////////////////////////////////
            /////////////////////////////////////////////////////////////////////////////////

            // Assign from incoming terms
            /* Creates parameters with the same name as keys and the same values as values in incomingOptions object
             proste nasadzanie premennych ako v pythone ked v inite vsetky pacnes s rovnakym menom s self.blablabla */
            for (let key in incomingOptions) {
                if (incomingOptions[key]) {
                    this[key] = incomingOptions[key];
                }
            }

            /* neviem z kade sa zjavilo idPattern a vobec nie idPattern.test | co je this.construktor vlastne vobec*/
            if (!this.constructor.idPattern.test(this.uniqueId)) {
                throw "$.WebGLModule: invalid ID! Id can contain only letters, numbers and underscore. ID: " + this.uniqueId;
            }

            /**
             * Current rendering context
             * @member {OpenSeadragon.WebGLModule.WebGLImplementation}
             */
            this.webglContext = null;

            /**
             * WebGL context
             * @member {WebGLRenderingContext|WebGL2RenderingContext}
             */
            this.gl = null;

            /////////////////////////////////////////////////////////////////////////////////
            ///////////// Internals /////////////////////////////////////////////////////////
            /////////////////////////////////////////////////////////////////////////////////

            this.reset();

            /* tomuto som teda moc nepochapal */
            try {
                const canvas = document.createElement("canvas");
                for (let version of [this.webGlPreferredVersion, "2.0", "1.0"]) {
                    /* incomingOptions nemaju kluc version ??? */
                    const contextOpts = incomingOptions[version] || {};

                    /* ??? z kade ??? $.WebGLModule teraz konstruujes tak jak ho mozes volat a dalsia vec, nema ziadnu
                    funkciu determineContext, ta je vo webGLContext.js */
                    const Context = $.WebGLModule.determineContext(version);
                    //todo documment this
                    let glContext = Context && Context.create(canvas, contextOpts.canvasOptions || {});

                    if (glContext) {
                        this.gl = glContext;

                        const readGlProp = function(prop, defaultValue) {
                            return glContext[contextOpts[prop] || defaultValue] || glContext[defaultValue];
                        };

                        /**
                         * @param {object} options
                         * @param {string} options.wrap  texture wrap parameteri
                         * @param {string} options.magFilter  texture filter parameteri
                         * @param {string} options.minFilter  texture filter parameteri
                         */
                        const options = {
                            wrap: readGlProp("wrap", "MIRRORED_REPEAT"),
                            magFilter: readGlProp("magFilter", "LINEAR"),
                            minFilter: readGlProp("minFilter", "LINEAR"),
                        };

                        this.webglContext = new Context(this, glContext, options);
                        break;
                    }
                }

            } catch (e) {
                /**
                 * @event fatal-error
                 */
                this.raiseEvent('fatal-error', {message: "Unable to initialize the WebGL renderer.",
                    details: e});
                $.console.error(e);
                return;
            }
            $.console.log(`WebGL ${this.webglContext.getVersion()} Rendering module (ID ${this.uniqueId || '<main>'})`);
        }

        /**
         * Reset the engine to the initial state
         * @instance
         * @memberOf OpenSeadragon.WebGLModule
         */
        reset() {
            if (this._programs) {
                Object.values(this._programs).forEach(p => this._unloadProgram(p));
            }
            this._programSpecifications = [];
            this._dataSources = [];
            this._origDataSources = [];
            this._programs = {};
            this._program = -1;
            this.running = false;
            this._initialized = false;
        }

        /**
         * WebGL target canvas
         * @return {HTMLCanvasElement}
         */
        get canvas() {
            return this.gl.canvas;
        }

        /**
         * WebGL active program
         * @return {WebGLProgram}
         */
        get program() {
            return this._programs[this._program];
        }

        /**
         * Check if init() was called.
         * @return {boolean}
         * @instance
         * @memberOf OpenSeadragon.WebGLModule
         */
        get isInitialized() {
            return this._initialized;
        }

        /**
         * Change the dimensions, useful for borders, used by openSeadragonGL
         * @instance
         * @memberOf WebGLModule
         */
        setDimensions(x, y, width, height) {
            if (width === this.width && height === this.height) {
                return;
            }

            this.width = width;
            this.height = height;
            this.gl.canvas.width = width;
            this.gl.canvas.height = height;
            this.gl.viewport(x, y, width, height);
        }

        /**
         *
         */
        getCompiled(name, programIndex = this._program) {
            return this.webglContext.getCompiled(this._programs[programIndex], name);
        }

        /**
         * Set program shaders. Vertex shader is set by default a square.
         * @param {RenderingConfig} specifications - objects that define the what to render (see Readme)
         * @return {boolean} true if loaded successfully
         * @instance
         * @memberOf OpenSeadragon.WebGLModule
         */
        addRenderingSpecifications(...specifications) {
            for (let spec of specifications) {
                // checks correctness of specification
                const parsed = this._parseSpec(spec);
                if (parsed) {
                    this._programSpecifications.push(parsed);
                }
            }
            return true;
        }

        /**
         * Checks if there is at least one shader specified in specification object.
         * For every shader specified defines params parameter if not already defined.
         */
        _parseSpec(specification) {
            // ZBYTOCNE? - prebrat s Jirkom
            // if (!specification.shaders) {
            //     $.console.warn("Invalid visualization: no shaders defined", specification);
            //     return undefined;
            // }

            let count = 0;
            for (let shaderName in specification.shaders) {
                const shader = specification.shaders[shaderName];
                if (!shader.params) {
                    shader.params = {};
                }
                count++;
            }

            if (count < 0) {
                $.console.warn("Invalid rendering specifications: no shader configuration present!", specification);
                return undefined;
            }
            return specification;
        }

        setRenderingSpecification(i, spec) {
            if (!spec) {
                const program = this._programs[i];
                if (program) {
                    this._unloadProgram();
                }
                delete this._programs[i];
                delete this._programSpecifications[i];
                this.getCurrentProgramIndex();
                return true;
            } else {
                const parsed = this._parseSpec(spec);
                if (parsed) {
                    this._programSpecifications[i] = parsed;
                    return true;
                }
            }
            return false;
        }

        /**
         *
         * @param {number} i index of desired specification
         * @param {???} order ???
         * @param {boolean} force ???
         * @param {object} options
         * @param {boolean} options.withHtml whether html should be also created (false if no UI controls are desired)
         * @param {string} options.textureType id of texture to be used, supported are TEXTURE_2D, TEXTURE_2D_ARRAY, TEXTURE_3D
         * @param {string} options.instanceCount number of instances to draw at once
         * @param {boolean} options.debug draw debugging info
         * @return {boolean}
         */
        buildProgram(i, order, force, options) {
            let specification = this._programSpecifications[i];

            if (!specification) {
                $.console.error("Invalid rendering program target!", i);
                return false;
            }

            if (order) {
                specification.order = order;
            }


            let program = this._programs && this._programs[i];
            // force || missing vertex shader in program
            force = force || (program && !program['VERTEX_SHADER']);
            console.log("Ak je true tak buildujem, ak false tak nie -> ", force);
            if (force) {
                // detach old vertex + fragment shader
                this._unloadProgram(program);
                // ???
                this._specificationToProgram(specification, i, options);

                if (i === this._program) {
                    this._forceSwitchShader(this._program);
                }
                return true;
            }
            return false;
        }

        /**
         * Rebuild specification and update scene
         * @param {string[]|undefined} order of shaders, ID's of data as defined in setup JSON, last element
         *   is rendered last (top)
         * @instance
         * @memberOf OpenSeadragon.WebGLModule
         */
        rebuildCurrentProgram(order = undefined) {
            const program = this._programs[this._program];
            if (this.buildProgram(this._program, order, true, program && program._osdOptions)) {
                this._forceSwitchShader(this._program);
            }
        }

        /**
         * Get currently used specification
         * @return {object} current specification
         * @instance
         * @memberOf OpenSeadragon.WebGLModule
         */
        specification(index) {
            return this._programSpecifications[index];
        }

        /**
         * Get currently used specification ilayer.params,ndex
         * @return {number} index of the current specification
         * @instance
         * @memberOf OpenSeadragon.WebGLModule
         */
        currentSpecificationIndex() {
            return this._program;
        }

        /**
         * Switch to program at index: this is the index (order) in which
         * setShaders(...) was called. If you want to switch to shader that
         * has been set with second setShaders(...) call, pass i=1.
         * @param {Number} i program index or null if you wish to re-initialize the current one
         * @instance
         * @memberOf OpenSeadragon.WebGLModule
         */
        /* zly warning asi mal byt nazov funkcie */
        useProgram(i) {
            if (!this._initialized) {
                $.console.warn("$.WebGLModule::useSpecification(): not initialized.");
                return;
            }

            if (this._program === i) {
                return;
            }
            this._forceSwitchShader(i);
        }

        useCustomProgram(program) {
            this._program = -1;
            this.webglContext.programLoaded(program, null);
        }

        getSpecificationsCount() {
            return this._programSpecifications.length;
        }

        /**
         * Get a list of image pyramids used to compose the current active specification
         * @instance
         * @memberOf WebGLModule
         */
        getSources() {
            return this._dataSources;
        }

        /**
         * Set data srouces
         */
        /* zly warning asi mal byt nazov funkcie
         naco je dane ze sources || [], malo by byt jasne ze neposlem undefined premennu */
        /* nikde nieje volana */
         setSources(sources) {
            if (!this._initialized) {
                $.console.warn("$.WebGLModule::useSpecification(): not initialized.");
                return;
            }
            this._origDataSources = sources || [];
        }

        /**
         * Renders data using WebGL
         * @param {GLuint|[GLuint]} texture or texture array for instanced drawing
         *
         * @param {object} tileOpts
         * @param {number} tileOpts.zoom value passed to the shaders as zoom_level
         * @param {number} tileOpts.pixelSize value passed to the shaders as pixel_size_in_fragments
         * @param {OpenSeadragon.Mat3|[OpenSeadragon.Mat3]} tileOpts.transform position transform
         *   matrix or flat matrix array (instance drawing)
         * @param {number?} tileOpts.instanceCount how many instances to draw in case instanced drawing is enabled
         *
         * @instance
         * @memberOf WebGLModule
         */
        processData(texture, tileOpts) {
            const spec = this._programSpecifications[this._program];
            if (!spec) {
                $.console.error("Cannot render using invalid specification: did you call useCustomProgram?", this._program);
            } else {
                this.webglContext.programUsed(this.program, spec, texture, tileOpts);
                // if (this.debug) {
                //     //todo
                //     this._renderDebugIO(data, result);
                // }
            }
        }

        processCustomData(texture, tileOpts) {
            this.webglContext.programUsed(this.program, null, texture, tileOpts);
            // if (this.debug) {
            //     //todo
            //     this._renderDebugIO(data, result);
            // }
        }

        /**
         * Clear the output canvas
         */
        clear() {
            //todo: necessary?
            this.gl.clearColor(0, 0, 0, 0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        }

        /**
         * Whether the webgl module renders UI
         * @return {boolean|boolean}
         * @instance
         * @memberOf WebGLModule
         */
        supportsHtmlControls() {
            return typeof this.htmlControlsId === "string" && this.htmlControlsId.length > 0;
        }

        /**
         * Execute call on each visualization layer with no errors
         * @param {object} vis current specification setup context
         * @param {function} callback call to execute
         * @param {function} onFail handle exception during execition
         * @return {boolean} true if no exception occured
         * @instance
         * @memberOf WebGLModule
         */
        static eachValidShaderLayer(vis, callback,
                                           onFail = (layer, e) => {
                                               layer.error = e.message;
                                               $.console.error(e);
                                           }) {
            let shaders = vis.shaders;
            if (!shaders) {
                return true;
            }
            let noError = true;
            for (let key in shaders) {
                let shader = shaders[key];

                if (shader && !shader.error) {
                    try {
                        callback(shader);
                    } catch (e) {
                        if (!onFail) {
                            throw e;
                        }
                        onFail(shader, e);
                        noError = false;
                    }
                }
            }
            return noError;
        }

        /**
         * Execute call on each _visible_ specification layer with no errors.
         * Visible is subset of valid.
         * @param {object} vis current specification setup context
         * @param {function} callback call to execute
         * @param {function} onFail handle exception during execition
         * @return {boolean} true if no exception occured
         * @instance
         * @memberOf WebGLModule
         */
        static eachVisibleShaderLayer(vis, callback,
                                                  onFail = (layer, e) => {
                                                        layer.error = e.message;
                                                        $.console.error(e);
                                                  }) {

            let shaders = vis.shaders;
            if (!shaders) {
                return true;
            }
            let noError = true;
            for (let key in shaders) {
                //rendering == true means no error
                let shader = shaders[key];
                if (shader && shader.rendering) {
                    try {
                        callback(shader);
                    } catch (e) {
                        if (!onFail) {
                            throw e;
                        }
                        onFail(shader, e);
                        noError = false;
                    }
                }
            }
            return noError;
        }

        /////////////////////////////////////////////////////////////////////////////////////
        //// YOU PROBABLY WANT TO READ FUNCTIONS BELOW SO YOU KNOW HOW TO SET UP YOUR SHADERS
        //// BUT YOU SHOULD NOT CALL THEM DIRECTLY
        /////////////////////////////////////////////////////////////////////////////////////

        /**
         * Get current program, reset if invalid
         * @return {number} program index
         */
        /* preco je tu tato kontrola? */
        getCurrentProgramIndex() {
            if (this._program < 0 || this._program >= this._programSpecifications.length) {
                this._program = 0;
            }
            return this._program;
        }

        /**
         * Function to JSON.stringify replacer
         * @param key key to the value
         * @param value value to be exported
         * @return {*} value if key passes exportable condition, undefined otherwise
         */
        static jsonReplacer(key, value) {
            return key.startsWith("_") || ["eventSource"].includes(key) ? undefined : value;
        }

        /**
         * Initialization. It is separated from preparation as this actually initiates the rendering,
         * sometimes this can happen only when other things are ready. Must be performed after
         * all the prepare() strategy finished: e.g. as onPrepared. Or use prepareAndInit();
         *
         * @param {int} width width of the first tile going to be drawn
         * @param {int} height height of the first tile going to be drawn
         * @param firstProgram
         */
        init(width = 1, height = 1, firstProgram = 0) {
            if (this._initialized) {
                $.console.error("Already initialized!");
                return;
            }
            if (this._programSpecifications.length < 1) {
                $.console.error("No specification specified!");
                /**
                 * @event fatal-error
                 */
                /* zly komentar */
                this.raiseEvent('fatal-error', {message: "No specification specified!",
                    details: "::prepare() called with no specification set."});
                return;
            }
            this._program = firstProgram;
            this.getCurrentProgramIndex(); //validates index

            this._initialized = true;
            this.setDimensions(width, height);

            //todo rotate anticlockwise to cull backfaces
            this.gl.enable(this.gl.CULL_FACE);
            this.gl.cullFace(this.gl.FRONT);

            this.running = true;

            this._forceSwitchShader(null);
            this.ready();
        }

        setDataBlendingEnabled(enabled) {
            if (enabled) {
                // this.gl.enable(this.gl.BLEND);
                // this.gl.blendEquation(this.gl.FUNC_ADD);
                // this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE);
                this.gl.enable(this.gl.BLEND);
                this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            } else {
                this.gl.disable(this.gl.BLEND);
            }
        }

        //////////////////////////////////////////////////////////////////////////////
        ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
        //////////////////////////////////////////////////////////////////////////////

        /**
         * Forward glLoaded event to the active layer
         * @param gl
         * @param program
         * @param vis
         */
        glLoaded(gl, program, vis) {
            $.WebGLModule.eachVisibleShaderLayer(vis, layer => layer._renderContext.glLoaded(program, gl));
        }

        /**
         * Forward glDrawing event to the active layer
         * @param gl
         * @param program
         * @param vis
         * @param bounds
         */
        glDrawing(gl, program, vis, bounds) {
            $.WebGLModule.eachVisibleShaderLayer(vis, layer => layer._renderContext.glDrawing(program, gl));
        }

        /**
         * Force switch shader (program), will reset even if the specified
         * program is currently active, good if you need 'gl-loaded' to be
         * invoked (e.g. some uniform variables changed)
         * @param {Number} i program index or null if you wish to re-initialize the current one
         * @param _reset
         * @private
         */
        _forceSwitchShader(i, _reset = true) {
            if (isNaN(i) || i === null || i === undefined) {
                i = this._program;
            }

            let target = this._programSpecifications[i];
            if (!target) {
                $.console.error("Invalid rendering target index!", i);
                return;
            }

            const program = this._programs[i];
            if (!program) {
                this._specificationToProgram(target, i);
            } else if (i !== this._program) {
                this._updateRequiredDataSources(target);
            }

            this._program = i;
            if (target.error) {
                if (this.supportsHtmlControls()) {
                    this._loadHtml(i, program);
                }
                this._loadScript(i);
                this.running = false;
                if (this._programSpecifications.length < 2) {
                    /**
                     * @event fatal-error
                     */
                    this.raiseEvent('fatal-error', {message: "The only rendering specification left is invalid!", target: target});
                } else {
                    /**
                     * @event error
                     */
                    this.raiseEvent('error', {message: "Currently chosen rendering specification is not valid!", target: target});
                }
            } else {
                this.running = true;
                if (this.supportsHtmlControls()) {
                    this._loadHtml(program);
                }
                this._loadDebugInfo();
                if (!this._loadScript(i)) {
                    if (!_reset) {
                        throw "Could not build visualization";
                    }
                    this._forceSwitchShader(i, false); //force reset in errors
                    return;
                }
                this.webglContext.programLoaded(program, target);
            }
        }

        /**
         * Detach fragment + vertex shader from <program>
         * @param {WebGLProgram} program
         */
        _unloadProgram(program) {
            if (program) {
                //must remove before attaching new
                this._detachShader(program, "VERTEX_SHADER");
                this._detachShader(program, "FRAGMENT_SHADER");
            }
        }

        _loadHtml(program) {
            let htmlControls = document.getElementById(this.htmlControlsId);
            htmlControls.innerHTML = this.webglContext.getCompiled(program, "html") || "";
        }

        _loadScript(visId) {
            return $.WebGLModule.eachValidShaderLayer(this._programSpecifications[visId], layer => layer._renderContext.init());
        }

        _getDebugInfoPanel() {
            return `<div id="test-inner-${this.uniqueId}-webgl">
    <b>WebGL Processing I/O (debug mode)</b>
    <div id="test-${this.uniqueId}-webgl-log"></div>
    Input: <br><div style="border: 1px solid;display: inline-block; overflow: auto;" id='test-${this.uniqueId}-webgl-input'>No input.</div><br>
    Output:<br><div style="border: 1px solid;display: inline-block; overflow: auto;" id="test-${this.uniqueId}-webgl-output">No output.</div>`;
        }

        _loadDebugInfo() {
            if (!this.debug) {
                return;
            }
            if (!this.supportsHtmlControls()) {
                console.warn(`WebGL Renderer ${this.uniqueId} does not support visual rendering without enabled HTML control!`);
                return;
            }

            let container = document.getElementById(`test-${this.uniqueId}-webgl`);
            if (!container) {
                if (!this.htmlControlsId) {
                    document.body.innerHTML += `<div id="test-${this.uniqueId}-webgl" style="position:absolute; top:0; right:0; width: 250px">${this._getDebugInfoPanel()}</div>`;
                } else {
                    //safe as we do this before handlers are attached
                    document.getElementById(this.htmlControlsId).parentElement.innerHTML += `<div id="test-${this.uniqueId}-webgl" style="width: 100%;">${this._getDebugInfoPanel()}</div>`;
                }
            }
        }

        _renderDebugIO(inputData, outputData) {
            if (!this.supportsHtmlControls()) {
                return;
            }
            let input = document.getElementById(`test-${this.uniqueId}-webgl-input`);
            let output = document.getElementById(`test-${this.uniqueId}-webgl-output`);

            input.innerHTML = "";
            input.append($.WebGLModule.Loaders.dataAsHtmlElement(inputData));

            if (outputData) {
                output.innerHTML = "";
                if (!this._ocanvas) {
                    this._ocanvas = document.createElement("canvas");
                }
                this._ocanvas.width = outputData.width;
                this._ocanvas.height = outputData.height;
                let octx = this._ocanvas.getContext('2d');
                octx.drawImage(outputData, 0, 0);
                output.append(this._ocanvas);
            } else {
                output.innerHTML = "No output!";
            }
        }

        _buildFailed(specification, error) {
            $.console.error(error);
            specification.error = "Failed to compose this specification.";
            specification.desc = error;
        }

        _buildSpecification(program, order, specification, options) {
            try {
                options.withHtml = this.supportsHtmlControls();
                const usableShaderCount = this.webglContext.compileSpecification(
                    program, order, specification, options);

                if (usableShaderCount < 1) {
                    this._buildFailed(specification, `Empty specification: no valid specification has been specified.
    <br><b>Specification setup:</b></br> <code>${JSON.stringify(specification, $.WebGLModule.jsonReplacer)}</code>
    <br><b>Dynamic shader data:</b></br><code>${JSON.stringify(specification.data)}</code>`);
                    return;
                }
                //preventive
                delete specification.error;
                delete specification.desc;
            } catch (error) {
                this._buildFailed(specification, error);
            }
        }

        /**
         * Deletes <shaderType> shader from <program>
         * @param {WebGLProgram} program
         * @param {string} shaderType
         */
        _detachShader(program, shaderType) {
            let shader = program[shaderType];
            if (shader) {
                this.gl.detachShader(program, shader);
                this.gl.deleteShader(shader);
                program[shaderType] = null;
            }
        }

        /**
         *
         * @param {Object} spec specification to be used
         * @param {number} idx index of specification in this._programSpecifications
         * @param {object} options
         * @param {boolean} options.withHtml whether html should be also created (false if no UI controls are desired)
         * @param {string} options.textureType id of texture to be used, supported are TEXTURE_2D, TEXTURE_2D_ARRAY, TEXTURE_3D
         * @param {string} options.instanceCount number of instances to draw at once
         * @param {boolean} options.debug draw debugging info
         * @returns
         */
        _specificationToProgram(spec, idx, options) {
            // nastavi _dataSources na [__gdnu__ * pocet datareferenci v spec.shaders.ALL.datareferences]
            this._updateRequiredDataSources(spec);
            let gl = this.gl;
            let program;

            // TU SOM SKONCIL, prechadzam ze co robi totot...
            if (!this._programs[idx]) {
                program = gl.createProgram();
                this._programs[idx] = program;

                let index = 0;
                //init shader factories and unique id's
                for (let key in spec.shaders) {
                    let layer = spec.shaders[key];
                    // tento if je potrebny??
                    if (layer) {
                        let ShaderFactoryClass = $.WebGLModule.ShaderMediator.getClass(layer.type);
                        if (layer.type === "none") {
                            continue;
                        }

                        this._initializeShaderFactory(spec, ShaderFactoryClass, layer, index++);
                    }
                }
            } else {
                program = this._programs[idx];
                for (let key in spec.shaders) {
                    let layer = spec.shaders[key];

                    if (layer) {
                        if (!layer.error &&
                            layer._renderContext &&
                            layer._renderContext.constructor.type() === layer.type) {
                            continue;
                        }
                        delete layer.error;
                        delete layer.desc;
                        if (layer.type === "none") {
                            continue;
                        }
                        let ShaderFactoryClass = $.WebGLModule.ShaderMediator.getClass(layer.type);
                        this._initializeShaderFactory(spec, ShaderFactoryClass, layer, layer._index);
                    }
                }
            }

            if (!Array.isArray(spec.order) || spec.order.length < 1) {
                spec.order = Object.keys(spec.shaders);
            }

            this._buildSpecification(program, spec.order, spec, options);
            this.visualisationReady(idx, spec);
            return idx;
        }

        // layer = dictionary so shaderom
        _initializeShaderFactory(spec, ShaderFactoryClass, layer, idx) {
            if (!ShaderFactoryClass) {
                layer.error = "Unknown layer type.";
                layer.desc = `The layer type '${layer.type}' has no associated factory.`;
                console.warn("Skipping layer " + layer.name);
                return;
            }
            const _this = this;
            layer._index = idx;
            layer.visible = layer.visible === undefined ? true : layer.visible;
            layer._renderContext = new ShaderFactoryClass(`${this.uniqueId}${idx}`, {
                layer: layer,
                webgl: this.webglContext,
                // dava sa UI controls nech to volaju ked sa zmeni ich hodnota (triggeruje prekreslenie viewportu)
                invalidate: this.resetCallback,
                interactive: this.supportsHtmlControls(),
                // triggeruje prekompilovanie a prekreslenie viewportu
                rebuild: this.rebuildCurrentProgram.bind(this, undefined),
                refetch: function() {
                    _this._updateRequiredDataSources(spec);
                    //TODO: how to tell openseadragon to invalidate the whole data source?
                    // !!implement!!
                    // used to call: _this.visualisationChanged(visualization, visualization);
                    //  --> no longer part of api
                    throw "Not yet implemented!";
                }
            });
            layer._renderContext.construct(layer.params || {}, layer.dataReferences);

            if (!layer._renderContext.initialized()) {
                console.error(`Invalid shader ${ShaderFactoryClass.name()}! Construct must call super implementation!`);
            }
        }

        /**
         * Works on _origDataSources and _dataSources variables.
         * Sets _dataSources to ??? tu som sa stratil neviem co to ma robit
         * Okej myslim si ze nastavi _dataSources na [__gdnu__ * pocet referenci v spec.shaders.ALL.datareferences]
         * @param {Object} spec specification
         */
        // Poznamka setSources nieje nikde volana, tj. _origDataSources budu vzdy na zaciatku []
        _updateRequiredDataSources(spec) {
            //for now just request all data, later decide in the context on what to really send
            //might in the future decide to only request used data, now not supported
            let usedIds = new Set();
            for (let key in spec.shaders) {
                let layer = spec.shaders[key];
                if (layer) {
                    for (let x of layer.dataReferences) {
                        usedIds.add(x);
                    }
                }
            }
            usedIds = [...usedIds].sort();
            this._dataSources = [];

            // usedIds = vsetky dataReferences z specification objektu ktore su definovane
            // _origDataSources su [], cize sa napushuje do nich <najvacsie id + 1> * "__generated_do_not_use__"
            while (usedIds[usedIds.length - 1] >= this._origDataSources.length) {
                //make sure values are set if user did not provide
                this._origDataSources.push("__generated_do_not_use__");
            }

            // tak toto nastavi _dataSources na [__gdnu__ * usedIds.length]
            for (let id of usedIds) {
                this._dataSources.push(this._origDataSources[id]);
            }
        }
    };

    /**
     * ID pattern allowed for module, ID's are used in GLSL
     * to distinguish uniquely between static generated code parts
     * @type {RegExp}
     */
    $.WebGLModule.idPattern = /^(?!_)(?:(?!__)[0-9a-zA-Z_])*$/;

})(OpenSeadragon);
