'use strict';

/**
 * ObjectController - Manages ioBroker object discovery and control
 */
class ObjectController {
    constructor(adapter, log) {
        this.adapter = adapter;
        this.log = log;
        this.devices = [];
        this.deviceMap = new Map();
    }

    /**
     * Discover controllable devices from ioBroker
     * Looks for common device types: lights, switches, dimmers, thermostats, etc.
     * @param {Array} allowedRooms - Optional filter for specific rooms
     * @returns {Promise<Array>} - List of discovered devices
     */
    async discoverDevices(allowedRooms = []) {
        this.log.info('Starte Geräteerkennung...');
        this.devices = [];
        this.deviceMap.clear();

        try {
            // Get all states
            const states = await this.adapter.getStatesAsync('*');
            const objects = await this.adapter.getObjectListAsync({ startkey: '', endkey: '\u9999' });

            if (!objects || !objects.rows) {
                this.log.warn('Keine Objekte gefunden');
                return [];
            }

            // Filter for controllable objects
            const controllableRoles = [
                'switch', 'switch.light', 'switch.power', 'switch.lock',
                'level', 'level.dimmer', 'level.blind', 'level.temperature',
                'level.color.temperature', 'level.color.rgb', 'level.color.hue',
                'value.temperature', 'value.humidity', 'value.brightness',
                'state', 'indicator'
            ];

            for (const row of objects.rows) {
                const obj = row.value;
                if (!obj || obj.type !== 'state') continue;

                const common = obj.common || {};
                const role = common.role || '';

                // Check if it's a controllable device
                const isControllable = controllableRoles.some(r => role.startsWith(r)) ||
                    (common.write === true && common.type !== 'string');

                if (!isControllable) continue;

                // Skip system and adapter internal states
                const id = row.id;
                if (id.startsWith('system.') ||
                    id.startsWith('admin.') ||
                    id.includes('.info.') ||
                    id.startsWith('llm-controller.')) continue;

                // Get room info
                const room = await this.getRoomForState(id);

                // Filter by allowed rooms if specified
                if (allowedRooms.length > 0 && room && !allowedRooms.includes(room)) {
                    continue;
                }

                // Get current value
                let currentValue = null;
                if (states && states[id]) {
                    currentValue = states[id].val;
                }

                // Build device info
                const device = {
                    id: id,
                    name: common.name || id.split('.').pop(),
                    type: this.categorizeDevice(role, common.type),
                    role: role,
                    room: room,
                    writable: common.write === true,
                    valueType: common.type,
                    currentValue: currentValue,
                    min: common.min,
                    max: common.max,
                    unit: common.unit,
                    states: common.states // For enum types
                };

                this.devices.push(device);
                this.deviceMap.set(id, device);
            }

            this.log.info(`${this.devices.length} steuerbare Geräte gefunden`);
            return this.devices;

        } catch (error) {
            this.log.error(`Fehler bei Geräteerkennung: ${error.message}`);
            return [];
        }
    }

    /**
     * Get the room for a state
     * @param {string} stateId
     * @returns {Promise<string|null>}
     */
    async getRoomForState(stateId) {
        try {
            const rooms = await this.adapter.getEnumsAsync('rooms');
            if (!rooms || !rooms['enum.rooms']) return null;

            for (const [roomId, roomObj] of Object.entries(rooms['enum.rooms'])) {
                if (roomObj.common && roomObj.common.members) {
                    // Check if state or its parent is member of this room
                    for (const member of roomObj.common.members) {
                        if (stateId === member || stateId.startsWith(member + '.')) {
                            return roomObj.common.name || roomId.split('.').pop();
                        }
                    }
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Categorize device type based on role
     * @param {string} role
     * @param {string} valueType
     * @returns {string}
     */
    categorizeDevice(role, valueType) {
        if (role.includes('light') || role.includes('dimmer')) return 'light';
        if (role.includes('switch')) return 'switch';
        if (role.includes('blind') || role.includes('shutter')) return 'blind';
        if (role.includes('temperature')) return 'thermostat';
        if (role.includes('color')) return 'color';
        if (role.includes('lock')) return 'lock';
        if (role.includes('level')) return 'level';
        return valueType === 'boolean' ? 'switch' : 'other';
    }

    /**
     * Get all discovered devices
     * @returns {Array}
     */
    getDevices() {
        return this.devices;
    }

    /**
     * Find device by ID or name
     * @param {string} identifier - Device ID or name
     * @param {string} room - Optional room filter
     * @returns {Object|null}
     */
    findDevice(identifier, room = null) {
        if (!identifier) return null;

        const searchTerm = identifier.toLowerCase();

        // First try exact ID match
        if (this.deviceMap.has(identifier)) {
            return this.deviceMap.get(identifier);
        }

        // Search by name
        let matches = this.devices.filter(d => {
            const name = (typeof d.name === 'object' ? d.name.de || d.name.en : d.name) || '';
            return name.toLowerCase().includes(searchTerm) ||
                   d.id.toLowerCase().includes(searchTerm);
        });

        // Filter by room if specified
        if (room && matches.length > 1) {
            const roomLower = room.toLowerCase();
            const roomMatches = matches.filter(d =>
                d.room && d.room.toLowerCase().includes(roomLower)
            );
            if (roomMatches.length > 0) {
                matches = roomMatches;
            }
        }

        // Return best match
        return matches.length > 0 ? matches[0] : null;
    }

    /**
     * Execute an action on a device
     * @param {Object} intent - The parsed intent from LLM
     * @returns {Promise<Object>} - Result of the action
     */
    async executeAction(intent) {
        const { action, deviceId, deviceName, value, room } = intent;

        // Find the device
        const device = this.findDevice(deviceId || deviceName, room);

        if (!device) {
            return {
                success: false,
                error: `Gerät nicht gefunden: ${deviceId || deviceName}`,
                action: action
            };
        }

        if (!device.writable) {
            return {
                success: false,
                error: `Gerät "${device.name}" ist nicht steuerbar`,
                device: device.id,
                action: action
            };
        }

        try {
            let newValue = value;

            switch (action) {
                case 'toggle':
                    // Get current value and toggle
                    const currentState = await this.adapter.getForeignStateAsync(device.id);
                    if (device.valueType === 'boolean') {
                        newValue = !(currentState?.val);
                    } else if (device.valueType === 'number') {
                        // For dimmers, toggle between 0 and 100 (or max)
                        newValue = (currentState?.val > 0) ? 0 : (device.max || 100);
                    }
                    break;

                case 'set':
                    // Convert value to correct type
                    if (device.valueType === 'boolean') {
                        newValue = Boolean(value);
                    } else if (device.valueType === 'number') {
                        newValue = Number(value);
                        // Clamp to min/max
                        if (device.min !== undefined) newValue = Math.max(device.min, newValue);
                        if (device.max !== undefined) newValue = Math.min(device.max, newValue);
                    }
                    break;

                case 'get':
                    const state = await this.adapter.getForeignStateAsync(device.id);
                    return {
                        success: true,
                        action: 'get',
                        device: device.id,
                        deviceName: device.name,
                        value: state?.val,
                        timestamp: state?.ts
                    };

                default:
                    return {
                        success: false,
                        error: `Unbekannte Aktion: ${action}`,
                        device: device.id
                    };
            }

            // Set the new value
            await this.adapter.setForeignStateAsync(device.id, newValue, false);

            this.log.info(`Aktion ausgeführt: ${device.id} = ${newValue}`);

            return {
                success: true,
                action: action,
                device: device.id,
                deviceName: device.name,
                previousValue: device.currentValue,
                newValue: newValue
            };

        } catch (error) {
            this.log.error(`Fehler beim Ausführen der Aktion: ${error.message}`);
            return {
                success: false,
                error: error.message,
                device: device.id,
                action: action
            };
        }
    }

    /**
     * Refresh current values for all devices
     */
    async refreshDeviceValues() {
        try {
            const states = await this.adapter.getStatesAsync('*');
            for (const device of this.devices) {
                if (states && states[device.id]) {
                    device.currentValue = states[device.id].val;
                }
            }
        } catch (error) {
            this.log.error(`Fehler beim Aktualisieren der Gerätewerte: ${error.message}`);
        }
    }
}

module.exports = ObjectController;
