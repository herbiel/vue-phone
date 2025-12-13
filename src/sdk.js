import { createApp } from 'vue';
import PhoneWidget from './components/PhoneWidget.vue';
import { usePhone } from './composables/usePhone.js';
import './style.css'; // Ensure styles are bundled

// Get singleton actions from the composable
const { call, login } = usePhone();

class PhoneSDK {
    constructor() {
        this.app = null;
    }

    /**
     * Initialize the Phone Bar
     * @param {Object} config
     * @param {string} config.id - DOM ID to mount into (e.g. 'phone-container')
     * @param {string} config.user - SIP Extension
     * @param {string} config.password - SIP Password
     * @param {string} config.domain - SIP Domain
     * @param {string} config.socketUrl - WSS URL
     */
    init(config) {
        if (this.app) {
            console.warn('[PhoneSDK] Already initialized');
            return;
        }

        const { id, user, password, domain, socketUrl, iceServers } = config;

        // Find or create container
        let container = document.getElementById(id);
        if (!container) {
            console.log(`[PhoneSDK] Container #${id} not found, creating one...`);
            container = document.createElement('div');
            container.id = id || 'phone-root';
            document.body.appendChild(container); // Append to body by default
        }

        // Mount Vue App
        this.app = createApp(PhoneWidget);
        this.app.mount(container);

        // Auto login if credentials provided
        if (user && password && domain && socketUrl) {
            console.log('[PhoneSDK] Auto-logging in with provided config...');
            login(user, password, domain, socketUrl, iceServers);
        }
    }

    /**
     * Initiate an outgoing call
     * @param {string} number
     */
    makeCall(number) {
        if (!this.app) {
            console.error('[PhoneSDK] Not initialized. Call init() first.');
            return;
        }
        console.log(`[PhoneSDK] making call to ${number}`);
        call(number);
    }
}

// Expose globally
window.PhoneSDK = new PhoneSDK();
console.log('[PhoneSDK] Loaded. Use window.PhoneSDK.init({...})');
