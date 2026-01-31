'use strict';

const utils = require('@iobroker/adapter-core');
const LLMFactory = require('./lib/llm-factory');
const ObjectController = require('./lib/object-controller');
const IntentParser = require('./lib/intent-parser');

class LlmController extends utils.Adapter {

    constructor(options) {
        super({
            ...options,
            name: 'llm-controller',
        });

        this.llmClient = null;
        this.objectController = null;
        this.intentParser = null;
        
        // Multi-Alexa support: Map to track last timestamp per instance
        this.lastHistoryTimestamps = new Map();
        
        // Command processing state
        this.processingCommand = false;
        this.commandQueue = [];
        
        // Debouncing
        this.debounceTimer = null;
        this.lastCommandText = null;
        this.lastCommandTime = 0;
        
        // Rate limiting
        this.lastApiCall = 0;
        this.apiCallQueue = [];

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Called when adapter is ready
     */
    async onReady() {
        this.log.info('LLM Controller Adapter wird gestartet...');

        // Initialize components
        this.intentParser = new IntentParser(this.log);
        this.intentParser.setConfidenceThreshold(this.config.confidenceThreshold || 0.5);
        this.objectController = new ObjectController(this, this.log);

        // Validate LLM configuration
        const llmProvider = this.config.llmProvider || 'claude';
        const validation = LLMFactory.validateConfig(llmProvider, {
            apiKey: this.config.apiKey,
            model: this.config.model
        });

        if (!validation.valid) {
            this.log.error(`LLM Konfiguration ungültig: ${validation.error}`);
            await this.setStateAsync('info.connection', false, true);
            await this.setStateAsync('status', `error: ${validation.error}`, true);
            return;
        }

        // Initialize LLM client via factory
        try {
            this.llmClient = LLMFactory.createClient(llmProvider, {
                apiKey: this.config.apiKey,
                model: this.config.model,
                systemPrompt: this.config.systemPrompt,
                maxTokens: this.config.maxTokens || 1024
            }, this.log);

            this.llmClient.initialize();

            // Test connection
            const connected = await this.llmClient.testConnection();
            await this.setStateAsync('info.connection', connected, true);

            if (!connected) {
                this.log.error(`Verbindung zu ${LLMFactory.getProviderName(llmProvider)} API fehlgeschlagen`);
                await this.setStateAsync('status', 'error: connection failed', true);
                return;
            }

            this.log.info(`Verbindung zu ${LLMFactory.getProviderName(llmProvider)} API hergestellt`);

        } catch (error) {
            this.log.error(`Fehler bei LLM Initialisierung: ${error.message}`);
            await this.setStateAsync('info.connection', false, true);
            await this.setStateAsync('status', `error: ${error.message}`, true);
            return;
        }

        // Configure object controller caching
        const cacheMinutes = this.config.deviceCacheMinutes || 5;
        this.objectController.setCacheDuration(cacheMinutes * 60 * 1000);

        // Initial device discovery
        await this.discoverAndStoreDevices();

        // Subscribe to multiple Alexa2 instances
        await this.subscribeToAlexaInstances();

        // Subscribe to manual input state
        await this.subscribeStatesAsync('manualInput');

        // Schedule periodic device refresh
        this.scheduleDeviceRefresh();

        await this.setStateAsync('status', 'ready', true);
        this.log.info('LLM Controller Adapter bereit');
        
        // Log configuration
        const instances = this.config.alexa2Instances || ['alexa2.0'];
        this.log.info(`Provider: ${LLMFactory.getProviderName(llmProvider)}, Modell: ${this.config.model}`);
        this.log.info(`Überwache ${instances.length} Alexa2-Instanz(en): ${instances.join(', ')}`);
    }

    /**
     * Discover devices and store them
     */
    async discoverAndStoreDevices() {
        const allowedRooms = this.config.allowedRooms || [];
        const devices = await this.objectController.discoverDevices(allowedRooms);

        // Store device list as JSON
        const deviceList = devices.map(d => ({
            id: d.id,
            name: typeof d.name === 'object' ? (d.name.de || d.name.en) : d.name,
            type: d.type,
            room: d.room
        }));

        await this.setStateAsync('devices', JSON.stringify(deviceList), true);
        this.log.info(`${devices.length} Geräte für LLM-Kontext gespeichert`);
    }

    /**
     * Schedule periodic device refresh
     */
    scheduleDeviceRefresh() {
        const cacheMinutes = this.config.deviceCacheMinutes || 5;
        const intervalMs = cacheMinutes * 60 * 1000;
        
        this.deviceRefreshInterval = setInterval(async () => {
            this.log.debug('Aktualisiere Geräteliste (Cache-Refresh)...');
            await this.discoverAndStoreDevices();
        }, intervalMs);
    }

    /**
     * Subscribe to multiple Alexa2 adapter instances
     */
    async subscribeToAlexaInstances() {
        const instances = this.config.alexa2Instances || ['alexa2.0'];
        
        if (!Array.isArray(instances) || instances.length === 0) {
            this.log.warn('Keine Alexa2-Instanzen konfiguriert');
            return;
        }

        for (const instance of instances) {
            await this.subscribeToAlexaInstance(instance.trim());
        }
    }

    /**
     * Subscribe to a single Alexa2 instance
     */
    async subscribeToAlexaInstance(instance) {
        const historyState = `${instance}.History.json`;

        this.log.info(`Subscribing to Alexa2 History: ${historyState}`);

        try {
            // Check if alexa2 adapter exists
            const obj = await this.getForeignObjectAsync(historyState);
            if (!obj) {
                this.log.warn(`Alexa2 History State nicht gefunden: ${historyState}`);
                return;
            }

            await this.subscribeForeignStatesAsync(historyState);
            this.log.info(`Alexa2 History Subscription aktiv für ${instance}`);

        } catch (error) {
            this.log.error(`Fehler beim Subscriben auf ${instance}: ${error.message}`);
        }
    }

    /**
     * Handle state changes
     */
    async onStateChange(id, state) {
        if (!state || state.ack) return;

        // Handle manual input
        if (id.endsWith('.manualInput')) {
            const command = state.val;
            if (command && typeof command === 'string' && command.trim()) {
                await this.queueCommand(command.trim(), 'manual');
                // Clear the input after processing
                await this.setStateAsync('manualInput', '', true);
            }
            return;
        }

        // Handle Alexa2 history from any instance
        if (id.includes('History.json')) {
            await this.handleAlexaHistory(id, state.val);
        }
    }

    /**
     * Handle Alexa2 history updates with debouncing
     */
    async handleAlexaHistory(stateId, historyValue) {
        if (!historyValue) return;

        const parsed = this.intentParser.parseAlexaHistory(historyValue);
        if (!parsed) return;

        // Get instance name from state ID
        const instanceMatch = stateId.match(/^(alexa2\.\d+)\.History\.json$/);
        const instance = instanceMatch ? instanceMatch[1] : 'unknown';

        // Avoid processing the same command twice (per instance)
        const lastTimestamp = this.lastHistoryTimestamps.get(instance) || 0;
        if (parsed.timestamp <= lastTimestamp) {
            return;
        }
        this.lastHistoryTimestamps.set(instance, parsed.timestamp);

        const command = parsed.text;
        this.log.debug(`Alexa Befehl empfangen von ${instance}: "${command}"`);

        // Check trigger words if configured
        const triggerWords = this.config.triggerWords || [];
        if (!this.intentParser.shouldProcessCommand(command, triggerWords)) {
            this.log.debug(`Befehl ignoriert (kein Trigger-Wort): "${command}"`);
            return;
        }

        // Apply debouncing
        const debounceMs = this.config.debounceMs || 500;
        const now = Date.now();
        
        if (this.lastCommandText === command && (now - this.lastCommandTime) < debounceMs) {
            this.log.debug(`Befehl debounced: "${command}"`);
            return;
        }

        this.lastCommandText = command;
        this.lastCommandTime = now;

        // Clear existing debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Queue command with debounce
        this.debounceTimer = setTimeout(() => {
            this.queueCommand(command, 'alexa', instance);
        }, debounceMs);
    }

    /**
     * Queue a command for processing
     */
    async queueCommand(command, source, instance = null) {
        const commandObj = {
            command,
            source,
            instance,
            timestamp: Date.now()
        };

        this.commandQueue.push(commandObj);
        this.log.debug(`Befehl zur Queue hinzugefügt (${this.commandQueue.length} in Queue)`);

        // Process queue
        await this.processCommandQueue();
    }

    /**
     * Process queued commands sequentially
     */
    async processCommandQueue() {
        if (this.processingCommand || this.commandQueue.length === 0) {
            return;
        }

        this.processingCommand = true;

        while (this.commandQueue.length > 0) {
            const cmd = this.commandQueue.shift();
            
            try {
                await this.processCommand(cmd);
            } catch (error) {
                this.log.error(`Fehler bei Befehlsverarbeitung: ${error.message}`);
            }

            // Small delay between commands to avoid rate limiting
            if (this.commandQueue.length > 0) {
                await this.sleep(100);
            }
        }

        this.processingCommand = false;
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Process a voice/text command with rate limiting
     */
    async processCommand(cmdObj) {
        const { command, source, instance } = cmdObj;
        const timeoutSeconds = this.config.commandTimeout || 30;

        await this.setStateAsync('status', 'processing', true);

        try {
            this.log.info(`Verarbeite Befehl (${source}${instance ? '/' + instance : ''}): "${command}"`);
            await this.setStateAsync('lastCommand', command, true);

            // Rate limiting for LLM API
            await this.applyRateLimit();

            // Get devices (from cache if available)
            const devices = await this.objectController.getDevicesWithCache();

            // Analyze with LLM (with timeout)
            const result = await this.withTimeout(
                this.llmClient.analyzeCommand(command, devices),
                timeoutSeconds * 1000,
                'LLM Analyse-Timeout'
            );

            if (!result.success) {
                this.log.error(`LLM Analyse fehlgeschlagen: ${result.error}`);
                await this.setStateAsync('lastResponse', JSON.stringify(result), true);
                await this.setStateAsync('status', 'error', true);
                return;
            }

            await this.setStateAsync('lastResponse', result.rawResponse, true);

            // Validate intent
            const validation = this.intentParser.validateIntent(result.intent, devices);

            if (!validation.valid) {
                this.log.warn(`Intent ungültig: ${validation.errors.join(', ')}`);
                await this.setStateAsync('lastAction', JSON.stringify({
                    success: false,
                    errors: validation.errors,
                    warnings: validation.warnings,
                    suggestions: validation.suggestions
                }), true);
                await this.setStateAsync('status', 'intent_invalid', true);
                return;
            }

            // Log warnings
            for (const warning of validation.warnings) {
                this.log.warn(warning);
            }

            // Check confirmation if enabled
            if (this.config.confirmActions && result.intent.confidence < 0.8) {
                this.log.info(`Aktion erfordert Bestätigung (Konfidenz: ${result.intent.confidence})`);
                await this.setStateAsync('lastAction', JSON.stringify({
                    pending: true,
                    intent: result.intent,
                    message: 'Bestätigung erforderlich'
                }), true);
                await this.setStateAsync('status', 'awaiting_confirmation', true);
                return;
            }

            // Execute action
            const actionResult = await this.objectController.executeAction(result.intent);
            await this.setStateAsync('lastAction', JSON.stringify(actionResult), true);

            if (actionResult.success) {
                this.log.info(`Aktion erfolgreich: ${actionResult.device} = ${actionResult.newValue}`);
                await this.setStateAsync('status', 'success', true);
            } else {
                this.log.error(`Aktion fehlgeschlagen: ${actionResult.error}`);
                await this.setStateAsync('status', 'action_failed', true);
            }

        } catch (error) {
            this.log.error(`Fehler bei Befehlsverarbeitung: ${error.message}`);
            await this.setStateAsync('status', `error: ${error.message}`, true);
        }
    }

    /**
     * Apply rate limiting for API calls
     */
    async applyRateLimit() {
        const minInterval = 500; // Minimum 500ms between API calls
        const now = Date.now();
        const timeSinceLastCall = now - this.lastApiCall;

        if (timeSinceLastCall < minInterval) {
            const waitTime = minInterval - timeSinceLastCall;
            this.log.debug(`Rate limiting: Warte ${waitTime}ms...`);
            await this.sleep(waitTime);
        }

        this.lastApiCall = Date.now();
    }

    /**
     * Execute promise with timeout
     */
    async withTimeout(promise, timeoutMs, errorMessage) {
        return Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
            )
        ]);
    }

    /**
     * Called when adapter is unloaded
     */
    onUnload(callback) {
        try {
            this.log.info('LLM Controller Adapter wird beendet');

            // Clear intervals and timers
            if (this.deviceRefreshInterval) {
                clearInterval(this.deviceRefreshInterval);
            }
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            callback();
        } catch {
            callback();
        }
    }
}

// Main entry point
if (require.main !== module) {
    // Export constructor for compact mode
    module.exports = (options) => new LlmController(options);
} else {
    // Start adapter directly
    new LlmController();
}
