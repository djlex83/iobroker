# ioBroker.llm-controller

[![NPM version](https://img.shields.io/npm/v/iobroker.llm-controller.svg)](https://www.npmjs.com/package/iobroker.llm-controller)
[![License](https://img.shields.io/npm/l/iobroker.llm-controller.svg)](https://github.com/djlex83/ioBroker.llm-controller/blob/main/LICENSE)

Steuere dein Smart Home mit natürlicher Sprache! Dieser ioBroker-Adapter unterstützt mehrere KI-Anbieter (Claude, ChatGPT, Gemini, Kimi) um Sprachbefehle von Alexa zu interpretieren und in Smart-Home-Aktionen umzuwandeln.

## Features

- **Multi-LLM Unterstützung**: Wähle zwischen Claude, ChatGPT, Gemini oder Kimi
- **Natürliche Sprachverarbeitung**: Versteht komplexe Befehle wie "Mach das Licht im Wohnzimmer etwas dunkler"
- **Multi-Alexa-Integration**: Unterstützt mehrere Alexa2-Adapter-Instanzen gleichzeitig
- **Automatische Geräteerkennung**: Findet automatisch steuerbare Geräte in ioBroker (mit Caching)
- **Raumbasierte Steuerung**: Unterstützt Raum-Kontext für präzisere Befehle
- **Manuelle Eingabe**: Befehle können auch manuell per Datenpunkt gesendet werden
- **Trigger-Wörter**: Filtere Alexa-Befehle nach bestimmten Schlüsselwörtern
- **Debouncing**: Verhindert doppelte Verarbeitung schneller Befehle
- **Rate Limiting**: Schützt vor API-Überlastung

## Voraussetzungen

- ioBroker >= js-controller 5.0.0
- Admin >= 6.0.0
- Node.js >= 18
- [Alexa2 Adapter](https://github.com/Apollon77/ioBroker.alexa2) (optional, für Sprachsteuerung)
- Anthropic API Key ([hier erstellen](https://console.anthropic.com/))

## Installation

### Manuell (GitHub)

```bash
cd /opt/iobroker
npm install alexejhorner/ioBroker.llm-controller
iobroker add llm-controller
```

## Konfiguration

### Adapter-Einstellungen

| Einstellung | Beschreibung |
|-------------|--------------|
| **LLM Provider** | Wähle zwischen Claude, ChatGPT, Gemini oder Kimi |
| **Modell** | Passendes Modell für den gewählten Provider |
| **API Key** | API Key für den gewählten Provider (erforderlich) |
| **Max Tokens** | Maximale Tokens für LLM-Antwort (Standard: 1024) |
| **Befehls-Timeout** | Maximale Zeit für Befehlsverarbeitung in Sekunden (Standard: 30) |
| **Alexa2 Instanzen** | Mehrere Alexa2-Adapter-Instanzen per Dropdown auswählbar |
| **Trigger-Wörter** | Nur Befehle mit diesen Wörtern verarbeiten (optional) |
| **Erlaubte Räume** | Optional: Beschränke Steuerung auf bestimmte Räume |
| **Geräte-Cache** | Minuten zwischen Geräte-Updates (Standard: 5) |
| **Debounce** | Verzögerung für schnelle Befehle in ms (Standard: 500) |
| **Aktionen bestätigen** | Bei niedriger Konfidenz Bestätigung anfordern |
| **System Prompt** | Optional: Eigener System-Prompt für das LLM |

### Unterstützte LLM Provider

| Provider | Modelle | API Key Quelle |
|----------|---------|----------------|
| **Claude (Anthropic)** | Sonnet 4, Opus 4, Haiku 3.5 | [console.anthropic.com](https://console.anthropic.com) |
| **ChatGPT (OpenAI)** | GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 | [platform.openai.com](https://platform.openai.com) |
| **Gemini (Google)** | Gemini 2.5 Pro, 1.5 Pro, 1.5 Flash | [ai.google.dev](https://ai.google.dev) |
| **Kimi (Moonshot)** | Kimi K2.5, K1.5 | [platform.moonshot.cn](https://platform.moonshot.cn) |

## Verwendung

### Mit Alexa

Sobald der Adapter läuft, werden Alexa-Befehle automatisch verarbeitet. Der Adapter filtert automatisch nach Smart-Home-relevanten Befehlen.

**Beispiele:**
- "Alexa, schalte das Licht im Wohnzimmer ein"
- "Alexa, mach die Lampe auf 50 Prozent"
- "Alexa, Heizung im Bad auf 22 Grad"
- "Alexa, Rollos runter"

### Manuelle Eingabe

Befehle können auch direkt über den Datenpunkt `llm-controller.0.manualInput` gesendet werden:

```javascript
setState('llm-controller.0.manualInput', 'Schalte Wohnzimmerlicht ein');
```

## Datenpunkte

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `info.connection` | boolean | Verbindungsstatus zur Claude API |
| `lastCommand` | string | Letzter empfangener Befehl |
| `lastResponse` | string | Letzte Antwort von Claude |
| `lastAction` | json | Details zur letzten ausgeführten Aktion |
| `status` | string | Aktueller Status (ready, processing, error, etc.) |
| `manualInput` | string | Eingabefeld für manuelle Befehle |
| `devices` | json | Liste aller erkannten Geräte |

## Unterstützte Gerätetypen

Der Adapter erkennt automatisch folgende Gerätetypen:

- Lichter und Dimmer (`switch.light`, `level.dimmer`)
- Schalter (`switch`, `switch.power`)
- Rollläden/Jalousien (`level.blind`)
- Thermostate (`level.temperature`)
- Farbsteuerung (`level.color.*`)
- Schlösser (`switch.lock`)

## Unterstützte Aktionen

| Aktion | Beschreibung | Beispiel-Befehle |
|--------|--------------|------------------|
| `set` | Wert setzen | "Licht an", "Dimmer auf 50%" |
| `toggle` | Umschalten | "Licht umschalten" |
| `get` | Wert abfragen | "Wie hell ist das Licht?" |

## Fehlerbehandlung

Der Adapter protokolliert alle Aktionen im ioBroker-Log. Bei Problemen:

1. Prüfe den API Key in den Einstellungen
2. Überprüfe die Logs auf Fehlermeldungen
3. Stelle sicher, dass der Alexa2-Adapter korrekt konfiguriert ist
4. Prüfe ob Geräte im `devices` Datenpunkt erkannt wurden

## Lizenz

MIT License - siehe [LICENSE](LICENSE)

## Autor

Alexej Horner

## Changelog

### 0.3.0 (Multi-LLM Support)
- **Multi-LLM Unterstützung**: Claude, ChatGPT, Gemini und Kimi auswählbar
- **Dynamische Modell-Auswahl**: Modelle werden je nach Provider aktualisiert
- **Dropdown für Alexa-Instanzen**: Alle installierten Alexa2-Instanzen automatisch erkannt
- **Unified LLM Factory**: Modularer Aufbau für einfache Erweiterung

### 0.2.0 (Optimierungen)
- **Multi-Alexa-Support**: Mehrere Alexa2-Instanzen gleichzeitig überwachen
- **Device Discovery Caching**: Bessere Performance durch gecachte Geräteliste
- **Debouncing**: Verhindert doppelte Befehlsverarbeitung
- **Rate Limiting**: Schützt vor API-Überlastung
- **Trigger-Wörter**: Filterbare Alexa-Befehle
- **Befehls-Timeout**: Konfigurierbare Timeout für Claude-Anfragen

### 0.1.0 (Initial Release)
- Erste Version mit Claude-Integration
- Alexa2-Anbindung
- Automatische Geräteerkennung
- Manuelle Befehlseingabe
