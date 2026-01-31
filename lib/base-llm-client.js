'use strict';

/**
 * Base LLM Client - Abstract base class for all LLM providers
 */
class BaseLLMClient {
    constructor(config, log) {
        this.config = config;
        this.log = log;
        this.client = null;
    }

    /**
     * Initialize the client
     * @abstract
     */
    initialize() {
        throw new Error('initialize() must be implemented by subclass');
    }

    /**
     * Test connection to API
     * @abstract
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        throw new Error('testConnection() must be implemented by subclass');
    }

    /**
     * Analyze a command using the LLM
     * @abstract
     * @param {string} command - The voice command to analyze
     * @param {Array} devices - Available devices for context
     * @returns {Promise<Object>} - Parsed intent
     */
    async analyzeCommand(command, devices = []) {
        throw new Error('analyzeCommand() must be implemented by subclass');
    }

    /**
     * Build the device context for the system prompt
     * @param {Array} devices - Available devices
     * @returns {string} - Formatted device list
     */
    buildDeviceContext(devices) {
        if (!devices || devices.length === 0) {
            return 'Keine Geräte verfügbar.';
        }

        let context = 'Verfügbare Geräte:\n';
        for (const device of devices) {
            context += `- ID: "${device.id}", Name: "${device.name}"`;
            if (device.room) {
                context += `, Raum: "${device.room}"`;
            }
            if (device.type) {
                context += `, Typ: "${device.type}"`;
            }
            if (device.currentValue !== undefined) {
                context += `, Aktueller Wert: ${JSON.stringify(device.currentValue)}`;
            }
            context += '\n';
        }
        return context;
    }

    /**
     * Get the default system prompt
     * @returns {string}
     */
    getDefaultSystemPrompt() {
        return `Du bist ein Smart-Home Controller für ioBroker. Deine Aufgabe ist es, Sprachbefehle zu analysieren und in strukturierte Aktionen umzuwandeln.

Analysiere den Befehl und antworte NUR mit einem JSON-Objekt in folgendem Format:
{
  "understood": true/false,
  "action": "set" | "get" | "toggle" | "scene" | "unknown",
  "deviceId": "die exakte device_id aus der Liste oder null",
  "deviceName": "der erkannte Gerätename",
  "value": der Wert (boolean, number, oder string),
  "room": "der Raum falls erkannt oder null",
  "confidence": 0.0-1.0,
  "explanation": "kurze Erklärung der Aktion auf Deutsch"
}

Regeln:
- Bei "an/ein/einschalten" -> action: "set", value: true
- Bei "aus/ausschalten" -> action: "set", value: false
- Bei "toggle/umschalten" -> action: "toggle"
- Bei Prozentwerten (z.B. "50%", "auf 50") -> action: "set", value: 50
- Bei Farbtemperatur/Helligkeit -> entsprechenden Wert setzen
- Bei Szenen -> action: "scene", value: "szenenname"
- Wenn du dir nicht sicher bist, setze confidence niedrig

WICHTIG: Antworte NUR mit dem JSON-Objekt, keine zusätzlichen Erklärungen!`;
    }

    /**
     * Parse JSON response from LLM
     * @param {string} responseText
     * @returns {Object}
     */
    parseResponse(responseText) {
        try {
            // Try to extract JSON from the response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('Kein JSON in Antwort gefunden');
            }
        } catch (parseError) {
            this.log.warn(`JSON Parse Fehler: ${parseError.message}`);
            return {
                understood: false,
                action: 'unknown',
                deviceId: null,
                deviceName: null,
                value: null,
                room: null,
                confidence: 0,
                explanation: 'Konnte Antwort nicht parsen',
                rawResponse: responseText
            };
        }
    }

    /**
     * Format the result object
     * @param {Object} parsed
     * @param {string} rawResponse
     * @param {Object} usage
     * @returns {Object}
     */
    formatResult(parsed, rawResponse, usage = {}) {
        // Validate required fields
        parsed.understood = parsed.understood !== false;
        parsed.action = parsed.action || 'unknown';
        parsed.confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;

        return {
            success: true,
            intent: parsed,
            rawResponse: rawResponse,
            usage: usage
        };
    }
}

module.exports = BaseLLMClient;
