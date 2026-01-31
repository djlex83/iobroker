'use strict';

const ClaudeClient = require('./claude-client');
const OpenAIClient = require('./openai-client');
const GeminiClient = require('./gemini-client');
const KimiClient = require('./kimi-client');

/**
 * LLM Factory - Creates the appropriate LLM client based on provider
 */
class LLMFactory {
    /**
     * Available LLM providers and their models
     */
    static getProviders() {
        return {
            claude: {
                name: 'Anthropic Claude',
                requireApiKey: true,
                models: [
                    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (Empfohlen)' },
                    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4 (Beste Qualität)' },
                    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Schnell)' }
                ]
            },
            openai: {
                name: 'OpenAI (ChatGPT)',
                requireApiKey: true,
                models: [
                    { id: 'gpt-4o', name: 'GPT-4o (Beste Qualität)' },
                    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Günstig)' },
                    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
                    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (Schnell)' }
                ]
            },
            gemini: {
                name: 'Google Gemini',
                requireApiKey: true,
                models: [
                    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Beste Qualität)' },
                    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
                    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Schnell)' }
                ]
            },
            kimi: {
                name: 'Kimi (Moonshot)',
                requireApiKey: true,
                models: [
                    { id: 'kimi-k2-5', name: 'Kimi K2.5 (Empfohlen)' },
                    { id: 'kimi-k1.5', name: 'Kimi K1.5' }
                ]
            }
        };
    }

    /**
     * Get models for a specific provider
     * @param {string} provider
     * @returns {Array}
     */
    static getModels(provider) {
        const providers = this.getProviders();
        return providers[provider]?.models || [];
    }

    /**
     * Create LLM client instance
     * @param {string} provider - Provider name (claude, openai, gemini, kimi)
     * @param {Object} config - Configuration object
     * @param {Object} log - Logger instance
     * @returns {BaseLLMClient}
     */
    static createClient(provider, config, log) {
        switch (provider) {
            case 'claude':
                return new ClaudeClient(config, log);
            case 'openai':
                return new OpenAIClient(config, log);
            case 'gemini':
                return new GeminiClient(config, log);
            case 'kimi':
                return new KimiClient(config, log);
            default:
                throw new Error(`Unbekannter LLM Provider: ${provider}`);
        }
    }

    /**
     * Check if provider requires an API key
     * @param {string} provider
     * @returns {boolean}
     */
    static requiresApiKey(provider) {
        const providers = this.getProviders();
        return providers[provider]?.requireApiKey || false;
    }

    /**
     * Get provider display name
     * @param {string} provider
     * @returns {string}
     */
    static getProviderName(provider) {
        const providers = this.getProviders();
        return providers[provider]?.name || provider;
    }

    /**
     * Validate provider configuration
     * @param {string} provider
     * @param {Object} config
     * @returns {Object} - { valid: boolean, error: string|null }
     */
    static validateConfig(provider, config) {
        if (!provider) {
            return { valid: false, error: 'Kein LLM Provider ausgewählt' };
        }

        const providers = this.getProviders();
        if (!providers[provider]) {
            return { valid: false, error: `Unbekannter Provider: ${provider}` };
        }

        if (providers[provider].requireApiKey && !config.apiKey) {
            return { valid: false, error: `API Key für ${providers[provider].name} erforderlich` };
        }

        if (!config.model) {
            return { valid: false, error: 'Kein Modell ausgewählt' };
        }

        return { valid: true, error: null };
    }
}

module.exports = LLMFactory;
