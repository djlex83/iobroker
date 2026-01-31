'use strict';

const BaseLLMClient = require('./base-llm-client');

class GeminiClient extends BaseLLMClient {
    constructor(config, log) {
        super(config, log);
        this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
    }

    /**
     * Initialize the Gemini client
     */
    initialize() {
        if (!this.config.apiKey) {
            throw new Error('Google Gemini API Key ist nicht konfiguriert');
        }

        // Dynamic require to avoid dependency if not used
        try {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            this.genAI = new GoogleGenerativeAI(this.config.apiKey);
        } catch (error) {
            throw new Error('Gemini SDK nicht installiert. Führe aus: npm install @google/generative-ai');
        }

        this.log.info('Gemini Client initialisiert');
        return true;
    }

    /**
     * Test the connection to Gemini API
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const model = this.genAI.getGenerativeModel({
                model: this.config.model || 'gemini-1.5-flash'
            });

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: 'Antworte nur mit: OK' }] }]
            });

            const response = result.response.text();
            return response.includes('OK') || response.length > 0;
        } catch (error) {
            this.log.error(`Verbindungstest fehlgeschlagen: ${error.message}`);
            return false;
        }
    }

    /**
     * Analyze a voice command using Gemini
     * @param {string} command - The voice command to analyze
     * @param {Array} devices - Available devices for context
     * @returns {Promise<Object>} - Parsed intent
     */
    async analyzeCommand(command, devices = []) {
        if (!this.genAI) {
            throw new Error('Gemini Client nicht initialisiert');
        }

        const deviceContext = this.buildDeviceContext(devices);
        const fullSystemPrompt = `${this.systemPrompt}\n\n${deviceContext}`;

        this.log.debug(`Analysiere Befehl mit Gemini: "${command}"`);
        this.log.debug(`Verfügbare Geräte: ${devices.length}`);

        try {
            const model = this.genAI.getGenerativeModel({
                model: this.config.model || 'gemini-1.5-flash'
            });

            const result = await model.generateContent({
                contents: [
                    { role: 'model', parts: [{ text: fullSystemPrompt }] },
                    { role: 'user', parts: [{ text: command }] }
                ]
            });

            const responseText = result.response.text().trim();
            if (!responseText) {
                throw new Error('Leere Antwort von Gemini');
            }

            this.log.debug(`Gemini Antwort: ${responseText}`);

            // Parse JSON response
            const parsed = this.parseResponse(responseText);

            return this.formatResult(parsed, responseText, {
                inputTokens: result.usageMetadata?.promptTokenCount,
                outputTokens: result.usageMetadata?.candidatesTokenCount
            });

        } catch (error) {
            this.log.error(`Gemini API Fehler: ${error.message}`);
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
}

module.exports = GeminiClient;
