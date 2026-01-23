'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_SYSTEM_PROMPT = `Du bist ein Smart-Home Controller für ioBroker. Deine Aufgabe ist es, Sprachbefehle zu analysieren und in strukturierte Aktionen umzuwandeln.

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

class ClaudeClient {
    constructor(config, log) {
        this.config = config;
        this.log = log;
        this.client = null;
        this.systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    }

    /**
     * Initialize the Anthropic client
     */
    initialize() {
        if (!this.config.apiKey) {
            throw new Error('Anthropic API Key ist nicht konfiguriert');
        }

        this.client = new Anthropic({
            apiKey: this.config.apiKey
        });

        this.log.info('Claude Client initialisiert');
        return true;
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
     * Analyze a voice command using Claude
     * @param {string} command - The voice command to analyze
     * @param {Array} devices - Available devices for context
     * @returns {Promise<Object>} - Parsed intent
     */
    async analyzeCommand(command, devices = []) {
        if (!this.client) {
            throw new Error('Claude Client nicht initialisiert');
        }

        const deviceContext = this.buildDeviceContext(devices);
        const fullSystemPrompt = `${this.systemPrompt}\n\n${deviceContext}`;

        this.log.debug(`Analysiere Befehl: "${command}"`);
        this.log.debug(`Verfügbare Geräte: ${devices.length}`);

        try {
            const response = await this.client.messages.create({
                model: this.config.model || 'claude-sonnet-4-20250514',
                max_tokens: this.config.maxTokens || 1024,
                system: fullSystemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: command
                    }
                ]
            });

            const content = response.content[0];
            if (content.type !== 'text') {
                throw new Error('Unerwarteter Antworttyp von Claude');
            }

            const responseText = content.text.trim();
            this.log.debug(`Claude Antwort: ${responseText}`);

            // Parse JSON response
            let parsed;
            try {
                // Try to extract JSON from the response
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('Kein JSON in Antwort gefunden');
                }
            } catch (parseError) {
                this.log.warn(`JSON Parse Fehler: ${parseError.message}`);
                parsed = {
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

            // Validate required fields
            parsed.understood = parsed.understood !== false;
            parsed.action = parsed.action || 'unknown';
            parsed.confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;

            return {
                success: true,
                intent: parsed,
                rawResponse: responseText,
                usage: {
                    inputTokens: response.usage?.input_tokens,
                    outputTokens: response.usage?.output_tokens
                }
            };

        } catch (error) {
            this.log.error(`Claude API Fehler: ${error.message}`);
            return {
                success: false,
                error: error.message,
                intent: {
                    understood: false,
                    action: 'unknown',
                    confidence: 0,
                    explanation: `API Fehler: ${error.message}`
                }
            };
        }
    }

    /**
     * Test the connection to Claude API
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const response = await this.client.messages.create({
                model: this.config.model || 'claude-sonnet-4-20250514',
                max_tokens: 10,
                messages: [
                    {
                        role: 'user',
                        content: 'Antworte nur mit: OK'
                    }
                ]
            });
            return response.content[0]?.text?.includes('OK') || response.content[0]?.type === 'text';
        } catch (error) {
            this.log.error(`Verbindungstest fehlgeschlagen: ${error.message}`);
            return false;
        }
    }
}

module.exports = ClaudeClient;
