'use strict';

const utils = require('@iobroker/adapter-core');
const ClaudeClient = require('./lib/claude-client');
const ObjectController = require('./lib/object-controller');
const IntentParser = require('./lib/intent-parser');

class LlmController extends utils.Adapter {

    constructor(options) {
        super({
            ...options,
            name: 'llm-controller',
        });

        this.claudeClient = null;
        this.objectController = null;
        this.intentParser = null;
        this.lastHistoryTimestamp = 0;
        this.processingCommand = false;

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
        this.objectController = new ObjectController(this, this.log);

        // Check API key configuration
        if (!this.config.apiKey) {
            this.log.error('Anthropic API Key nicht konfiguriert! Bitte in den Adapter-Einstellungen eintragen.');
            await this.setStateAsync('info.connection', false, true);
            await this.setStateAsync('status', 'error: no API key', true);
            return;
        }

        // Initialize Claude client
        this.claudeClient = new ClaudeClient({
            apiKey: this.config.apiKey,
            model: this.config.model || 'claude-sonnet-4-20250514',
            systemPrompt: this.config.systemPrompt,
            maxTokens: this.config.maxTokens || 1024
        }, this.log);

        try {
            this.claudeClient.initialize();

            // Test connection
            const connected = await this.claudeClient.testConnection();
            await this.setStateAsync('info.connection', connected, true);

            if (!connected) {
                this.log.error('Verbindung zu Claude API fehlgeschlagen');
                await this.setStateAsync('status', 'error: connection failed', true);
                return;
            }

            this.log.info('Verbindung zu Claude API hergestellt');

        } catch (error) {
            this.log.error(`Fehler bei Claude Initialisierung: ${error.message}`);
            await this.setStateAsync('info.connection', false, true);
            await this.setStateAsync('status', `error: ${error.message}`, true);
            return;
        }

        // Discover devices
        await this.discoverAndStoreDevices();

        // Subscribe to Alexa2 history
        await this.subscribeToAlexa();

        // Subscribe to manual input state
        await this.subscribeStatesAsync('manualInput');

        await this.setStateAsync('status', 'ready', true);
        this.log.info('LLM Controller Adapter bereit');
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
     * Subscribe to Alexa2 adapter history
     */
    async subscribeToAlexa() {
        const alexa2Instance = this.config.alexa2Instance || 'alexa2.0';
        const historyState = `${alexa2Instance}.History.json`;

        this.log.info(`Subscribing to Alexa2 History: ${historyState}`);

        try {
            // Check if alexa2 adapter exists
            const obj = await this.getForeignObjectAsync(historyState);
            if (!obj) {
                this.log.warn(`Alexa2 History State nicht gefunden: ${historyState}`);
                this.log.warn('Stelle sicher, dass der Alexa2 Adapter installiert und konfiguriert ist.');
                return;
            }

            await this.subscribeForeignStatesAsync(historyState);
            this.log.info('Alexa2 History Subscription aktiv');

        } catch (error) {
            this.log.error(`Fehler beim Subscriben auf Alexa2: ${error.message}`);
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
                await this.processCommand(command.trim(), 'manual');
                // Clear the input after processing
                await this.setStateAsync('manualInput', '', true);
            }
            return;
        }

        // Handle Alexa2 history
        if (id.includes('History.json')) {
            await this.handleAlexaHistory(state.val);
        }
    }

    /**
     * Handle Alexa2 history updates
     */
    async handleAlexaHistory(historyValue) {
        if (!historyValue) return;

        const parsed = this.intentParser.parseAlexaHistory(historyValue);
        if (!parsed) return;

        // Avoid processing the same command twice
        if (parsed.timestamp <= this.lastHistoryTimestamp) {
            return;
        }
        this.lastHistoryTimestamp = parsed.timestamp;

        const command = parsed.text;
        this.log.debug(`Alexa Befehl empfangen: "${command}"`);

        // Check if command should be processed
        if (!this.intentParser.shouldProcessCommand(command)) {
            this.log.debug(`Befehl ignoriert (kein Smart-Home Befehl): "${command}"`);
            return;
        }

        await this.processCommand(command, 'alexa');
    }

    /**
     * Process a voice/text command
     */
    async processCommand(command, source = 'unknown') {
        // Prevent concurrent processing
        if (this.processingCommand) {
            this.log.debug('Bereits ein Befehl in Bearbeitung, warte...');
            return;
        }

        this.processingCommand = true;
        await this.setStateAsync('status', 'processing', true);

        try {
            this.log.info(`Verarbeite Befehl (${source}): "${command}"`);
            await this.setStateAsync('lastCommand', command, true);

            // Refresh device values before processing
            await this.objectController.refreshDeviceValues();
            const devices = this.objectController.getDevices();

            // Analyze with Claude
            const result = await this.claudeClient.analyzeCommand(command, devices);

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

        } finally {
            this.processingCommand = false;

            // Reset status after delay
            setTimeout(async () => {
                const currentStatus = await this.getStateAsync('status');
                if (currentStatus && !currentStatus.val.includes('error')) {
                    await this.setStateAsync('status', 'ready', true);
                }
            }, 5000);
        }
    }

    /**
     * Called when adapter is unloaded
     */
    onUnload(callback) {
        try {
            this.log.info('LLM Controller Adapter wird beendet');
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
