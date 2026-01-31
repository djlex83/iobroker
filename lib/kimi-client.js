'use strict';

const BaseLLMClient = require('./base-llm-client');

class KimiClient extends BaseLLMClient {
    constructor(config, log) {
        super(config, log);
        this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
        this.baseURL = config.baseURL || 'https://api.moonshot.cn/v1';
    }

    /**
     * Initialize the Kimi client
     */
    initialize() {
        if (!this.config.apiKey) {
            throw new Error('Kimi (Moonshot) API Key ist nicht konfiguriert');
        }

        // Kimi uses OpenAI-compatible API
        try {
            const OpenAI = require('openai');
            this.client = new OpenAI({
                apiKey: this.config.apiKey,
                baseURL: this.baseURL
            });
        } catch (error) {
            throw new Error('OpenAI SDK nicht installiert. Führe aus: npm install openai');
        }

        this.log.info('Kimi Client initialisiert');
        return true;
    }

    /**
     * Test the connection to Kimi API
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const response = await this.client.chat.completions.create({
                model: this.config.model || 'kimi-k2-5',
                max_tokens: 10,
                messages: [
                    {
                        role: 'user',
                        content: 'Antworte nur mit: OK'
                    }
                ]
            });
            return response.choices[0]?.message?.content?.includes('OK') || true;
        } catch (error) {
            this.log.error(`Verbindungstest fehlgeschlagen: ${error.message}`);
            return false;
        }
    }

    /**
     * Analyze a voice command using Kimi
     * @param {string} command - The voice command to analyze
     * @param {Array} devices - Available devices for context
     * @returns {Promise<Object>} - Parsed intent
     */
    async analyzeCommand(command, devices = []) {
        if (!this.client) {
            throw new Error('Kimi Client nicht initialisiert');
        }

        const deviceContext = this.buildDeviceContext(devices);
        const fullSystemPrompt = `${this.systemPrompt}\n\n${deviceContext}`;

        this.log.debug(`Analysiere Befehl mit Kimi: "${command}"`);
        this.log.debug(`Verfügbare Geräte: ${devices.length}`);

        try {
            const response = await this.client.chat.completions.create({
                model: this.config.model || 'kimi-k2-5',
                max_tokens: this.config.maxTokens || 1024,
                messages: [
                    {
                        role: 'system',
                        content: fullSystemPrompt
                    },
                    {
                        role: 'user',
                        content: command
                    }
                ]
            });

            const responseText = response.choices[0]?.message?.content?.trim();
            if (!responseText) {
                throw new Error('Leere Antwort von Kimi');
            }

            this.log.debug(`Kimi Antwort: ${responseText}`);

            // Parse JSON response
            const parsed = this.parseResponse(responseText);

            return this.formatResult(parsed, responseText, {
                inputTokens: response.usage?.prompt_tokens,
                outputTokens: response.usage?.completion_tokens
            });

        } catch (error) {
            this.log.error(`Kimi API Fehler: ${error.message}`);
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

module.exports = KimiClient;
