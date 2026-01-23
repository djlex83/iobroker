'use strict';

/**
 * IntentParser - Validates and enriches intents from LLM
 */
class IntentParser {
    constructor(log) {
        this.log = log;
        this.confidenceThreshold = 0.5;
    }

    /**
     * Set minimum confidence threshold for action execution
     * @param {number} threshold - 0.0 to 1.0
     */
    setConfidenceThreshold(threshold) {
        this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
    }

    /**
     * Validate and enrich an intent from the LLM
     * @param {Object} intent - Raw intent from Claude
     * @param {Array} availableDevices - List of available devices
     * @returns {Object} - Validated intent with additional info
     */
    validateIntent(intent, availableDevices = []) {
        const result = {
            valid: false,
            intent: intent,
            errors: [],
            warnings: [],
            matchedDevice: null
        };

        // Check if understood
        if (!intent.understood) {
            result.errors.push('LLM hat den Befehl nicht verstanden');
            return result;
        }

        // Check confidence
        if (intent.confidence < this.confidenceThreshold) {
            result.warnings.push(`Niedrige Konfidenz: ${(intent.confidence * 100).toFixed(0)}%`);
        }

        // Validate action
        const validActions = ['set', 'get', 'toggle', 'scene', 'unknown'];
        if (!validActions.includes(intent.action)) {
            result.errors.push(`Ungültige Aktion: ${intent.action}`);
            return result;
        }

        if (intent.action === 'unknown') {
            result.errors.push('Aktion konnte nicht erkannt werden');
            return result;
        }

        // Try to match device
        if (intent.deviceId || intent.deviceName) {
            result.matchedDevice = this.findBestDeviceMatch(
                intent.deviceId || intent.deviceName,
                intent.room,
                availableDevices
            );

            if (!result.matchedDevice) {
                result.errors.push(`Gerät nicht gefunden: ${intent.deviceId || intent.deviceName}`);
                // Suggest similar devices
                const suggestions = this.getSuggestions(intent.deviceName, availableDevices);
                if (suggestions.length > 0) {
                    result.suggestions = suggestions;
                    result.warnings.push(`Meintest du: ${suggestions.map(s => s.name).join(', ')}?`);
                }
            } else {
                // Update intent with matched device info
                intent.deviceId = result.matchedDevice.id;
                intent.deviceName = result.matchedDevice.name;
            }
        } else if (intent.action !== 'scene') {
            result.errors.push('Kein Gerät angegeben');
        }

        // Validate value for set actions
        if (intent.action === 'set' && intent.value === null && intent.value === undefined) {
            result.errors.push('Kein Wert für set-Aktion angegeben');
        }

        // Mark as valid if no errors
        result.valid = result.errors.length === 0;
        result.intent = intent;

        return result;
    }

    /**
     * Find the best matching device
     * @param {string} searchTerm
     * @param {string} room
     * @param {Array} devices
     * @returns {Object|null}
     */
    findBestDeviceMatch(searchTerm, room, devices) {
        if (!searchTerm || !devices || devices.length === 0) return null;

        const term = searchTerm.toLowerCase();
        const roomLower = room ? room.toLowerCase() : null;

        // Score each device
        const scored = devices.map(device => {
            const name = this.getDeviceName(device).toLowerCase();
            const id = device.id.toLowerCase();
            const deviceRoom = device.room ? device.room.toLowerCase() : null;

            let score = 0;

            // Exact ID match
            if (id === term) score += 100;

            // Exact name match
            if (name === term) score += 90;

            // ID contains search term
            if (id.includes(term)) score += 50;

            // Name contains search term
            if (name.includes(term)) score += 40;

            // Search term contains name
            if (term.includes(name) && name.length > 3) score += 30;

            // Room match bonus
            if (roomLower && deviceRoom) {
                if (deviceRoom === roomLower) score += 25;
                else if (deviceRoom.includes(roomLower) || roomLower.includes(deviceRoom)) score += 15;
            }

            // Prefer writable devices
            if (device.writable) score += 5;

            // Prefer lights and switches (more commonly controlled)
            if (device.type === 'light' || device.type === 'switch') score += 3;

            return { device, score };
        });

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // Return best match if score is high enough
        if (scored.length > 0 && scored[0].score >= 30) {
            return scored[0].device;
        }

        return null;
    }

    /**
     * Get device name as string
     * @param {Object} device
     * @returns {string}
     */
    getDeviceName(device) {
        if (!device.name) return device.id;
        if (typeof device.name === 'string') return device.name;
        return device.name.de || device.name.en || device.id;
    }

    /**
     * Get device suggestions for fuzzy matching
     * @param {string} searchTerm
     * @param {Array} devices
     * @returns {Array}
     */
    getSuggestions(searchTerm, devices) {
        if (!searchTerm || !devices) return [];

        const term = searchTerm.toLowerCase();
        const suggestions = [];

        for (const device of devices) {
            const name = this.getDeviceName(device).toLowerCase();
            const similarity = this.calculateSimilarity(term, name);

            if (similarity > 0.3) {
                suggestions.push({
                    id: device.id,
                    name: this.getDeviceName(device),
                    similarity: similarity
                });
            }
        }

        // Sort by similarity and return top 3
        suggestions.sort((a, b) => b.similarity - a.similarity);
        return suggestions.slice(0, 3);
    }

    /**
     * Calculate string similarity (simple Jaccard-like)
     * @param {string} a
     * @param {string} b
     * @returns {number} 0.0 to 1.0
     */
    calculateSimilarity(a, b) {
        if (!a || !b) return 0;

        const setA = new Set(a.split(''));
        const setB = new Set(b.split(''));

        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);

        return intersection.size / union.size;
    }

    /**
     * Parse and validate Alexa history entry
     * @param {string|Object} historyEntry
     * @returns {Object|null}
     */
    parseAlexaHistory(historyEntry) {
        try {
            let data = historyEntry;
            if (typeof historyEntry === 'string') {
                data = JSON.parse(historyEntry);
            }

            // Alexa2 history format varies, try common fields
            const summary = data.summary ||
                           data.utterance ||
                           data.text ||
                           (Array.isArray(data) && data[0]?.summary);

            if (!summary) {
                this.log.debug('Keine Zusammenfassung in Alexa History gefunden');
                return null;
            }

            return {
                text: summary,
                timestamp: data.timestamp || data.creationTimestamp || Date.now(),
                device: data.deviceName || data.device,
                raw: data
            };
        } catch (error) {
            this.log.debug(`Alexa History Parse-Fehler: ${error.message}`);
            return null;
        }
    }

    /**
     * Check if a command should be processed
     * @param {string} command
     * @param {Array} triggerWords - Optional trigger words/phrases
     * @returns {boolean}
     */
    shouldProcessCommand(command, triggerWords = []) {
        if (!command) return false;

        const cmdLower = command.toLowerCase();

        // If trigger words are defined, check for them
        if (triggerWords.length > 0) {
            return triggerWords.some(trigger =>
                cmdLower.includes(trigger.toLowerCase())
            );
        }

        // Default: process all commands that look like control commands
        const controlIndicators = [
            'schalte', 'mach', 'stell', 'setze', 'dreh',
            'an', 'aus', 'ein', 'auf', 'zu', 'hoch', 'runter',
            'heller', 'dunkler', 'wärmer', 'kälter',
            'licht', 'lampe', 'rollo', 'jalousie', 'heizung',
            'temperatur', 'prozent', '%'
        ];

        return controlIndicators.some(indicator => cmdLower.includes(indicator));
    }
}

module.exports = IntentParser;
