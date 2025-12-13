import { ref, reactive, computed, toRaw } from 'vue';
import JsSIP from 'jssip';

const state = reactive({
    isConnected: false,
    isRegistered: false,
    callStatus: 'idle', // idle, calling, incoming, connected
    agentStatus: 'offline', // offline, online, busy
    session: null,
    remoteIdentity: '',
    timer: '00:00:00',
    error: null,
    audioStream: null,
    iceServers: [] // Global ICE servers config
});

const credentials = reactive({
    user: '',
    password: '',
    domain: '',
    socketUrl: '',
});

let ua = null;
let timerInterval = null;
let seconds = 0;

export function usePhone() {
    // -------------------
    // History Logic
    // -------------------
    const history = ref(JSON.parse(localStorage.getItem('sip_history') || '[]'));

    const addToHistory = (entry) => {
        history.value.unshift(entry);
        if (history.value.length > 100) {
            history.value = history.value.slice(0, 100);
        }
        localStorage.setItem('sip_history', JSON.stringify(history.value));
    };

    const clearHistory = () => {
        history.value = [];
        localStorage.removeItem('sip_history');
    };

    const initUA = () => {
        const { user, password, domain, socketUrl } = credentials;

        if (!user || !domain || !socketUrl) {
            console.warn('[Phone] Missing credentials in initUA');
            return;
        }

        // Prevent redundant re-initialization if config matches and already connected
        if (ua && ua.isConnected()) {
            // We can check if specific config changed if needed, but for now rely on isConnected
            // Actually, if credentials changed, we likely called stop() elsewhere or should force restart.
            // But `login` calls initUA.
            // Let's assume if we are calling initUA, we might want to restart if config changed.
            // But simplest fix for now:
            // If we are already connected with SAME config, skip.
            // But since we are reading from state, checking against state is tautological unless we store 'activeConfig'.
            // For safety, let's just proceed with restart if called, OR just check basic connectivity.
            // But avoiding complexity: if UA exists and is connected, we might want to just register.
            if (ua.configuration.uri.toString().includes(user) && ua.configuration.uri.toString().includes(domain) && ua.isConnected()) {
                console.log('[Phone] Re-using existing UA connection');
                if (!ua.isRegistered()) {
                    ua.register();
                }
                return;
            }
        }

        console.log(`[Phone] Initializing UA: ${user}@${domain} via ${socketUrl}`);
        if (ua) {
            console.log('[Phone] Stopping previous UA');
            ua.stop();
        }

        const socket = new JsSIP.WebSocketInterface(socketUrl);
        const configuration = {
            sockets: [socket],
            uri: `sip:${user}@${domain}`,
            password: password,
            session_timers: false
        };

        // Enable JsSIP debug logging provided by the library if needed, 
        // but user asked for "console prints".
        JsSIP.debug.enable('JsSIP:*');

        ua = new JsSIP.UA(configuration);

        ua.on('connected', () => {
            console.log('[Phone] WebSocket connected');
            state.isConnected = true;
            state.error = null;
        });

        ua.on('disconnected', () => {
            console.log('[Phone] WebSocket disconnected');
            state.isConnected = false;
            state.isRegistered = false;
        });

        ua.on('registered', () => {
            console.log('[Phone] SIP Registered');
            state.isRegistered = true;
            state.error = null;
        });

        ua.on('registrationFailed', (e) => {
            console.error('[Phone] Registration Failed:', e);
            state.isRegistered = false;
            state.error = `Registration Failed: ${e.cause} `;
        });

        ua.on('newRTCSession', (data) => {
            const session = data.session;
            const direction = data.originator === 'local' ? 'Outgoing' : 'Incoming';
            console.log(`[Phone] New RTC Session(${direction} - originator: ${data.originator})`);

            state.session = session;

            // Track Call for History
            // Format: Number, Time, Status
            let callLog = {
                number: session.remote_identity.uri.user,
                time: new Date().toLocaleString(),
                status: 'Unknown',
                direction: direction
            };

            // Handle events for this session
            if (session.direction === 'incoming') {
                console.log(`[Phone] Incoming call from ${session.remote_identity.uri.user}, status: ${state.agentStatus}`);

                // Auto-reject if Busy
                if (state.agentStatus === 'busy') {
                    console.log('[Phone] Agent is Busy, rejecting call...');
                    session.terminate({
                        status_code: 486,
                        reason_phrase: 'Busy Here'
                    });
                    return;
                }

                // Normal incoming logic
                state.callStatus = 'incoming';
                state.remoteIdentity = session.remote_identity.uri.user;
                console.log('[Phone] Incoming call from:', state.remoteIdentity);
            } else {
                state.callStatus = 'calling';
                state.remoteIdentity = session.remote_identity.uri.user;
                console.log('[Phone] Calling:', state.remoteIdentity);
            }

            // Media Handling: Capture Remote Stream
            session.on('peerconnection', (e) => {
                console.log('[Phone] PeerConnection created');
                const pc = e.peerconnection;

                pc.addEventListener('track', (trackEvent) => {
                    console.log('[Phone] Remote track received:', trackEvent);
                    if (trackEvent.streams && trackEvent.streams[0]) {
                        state.audioStream = trackEvent.streams[0];
                    }
                });
            });

            session.on('progress', () => {
                console.log('[Phone] Call in progress');
                if (session.direction === 'outgoing') {
                    state.callStatus = 'calling';
                }
            });

            session.on('confirmed', () => {
                console.log('[Phone] Call confirmed/connected');
                state.callStatus = 'connected';
                callLog.status = 'Connected'; // Update status
                startTimer();
            });

            session.on('ended', () => {
                console.log('[Phone] Call ended');
                // Determine final status if not already connected
                if (callLog.status !== 'Connected') {
                    callLog.status = session.direction === 'incoming' ? 'Missed' : 'Cancelled';
                }
                addToHistory(callLog);
                resetCall();
            });

            session.on('failed', (e) => {
                console.error('[Phone] Call failed:', e);
                state.error = `Call Failed: ${e.cause} `;
                callLog.status = 'Failed';
                addToHistory(callLog);
                resetCall();
            });
        });

        ua.start();
    };

    const login = (user, password, domain, socketUrl, iceServers = []) => {
        console.log('[Phone] Logging in...', { user, domain, socketUrl, iceServers });
        credentials.user = user;
        credentials.password = password;
        credentials.domain = domain;
        credentials.socketUrl = socketUrl;

        // Save iceServers to state
        state.iceServers = iceServers || [];

        // Simple persistence
        localStorage.setItem('sip_creds', JSON.stringify({ user, password, domain, socketUrl, iceServers }));

        initUA();
    };

    const logout = () => {
        console.log('[Phone] Logging out');
        if (ua) {
            ua.stop();
            ua = null;
        }
        state.isRegistered = false;
        state.isConnected = false;
        state.agentStatus = 'offline';
        localStorage.removeItem('sip_creds');
        resetCall();
    };

    const setAgentStatus = (status) => {
        console.log(`[Phone] Setting status to ${status}`);
        state.agentStatus = status;

        if (!ua) return;

        if (status === 'offline') {
            if (ua.isRegistered()) ua.unregister();
        } else {
            // Online or Busy
            if (!ua.isRegistered()) ua.register();
        }
    };

    const call = (target) => {
        console.log('[Phone] Initiating call to:', target);
        if (!ua || !state.isRegistered) {
            console.warn('[Phone] Call aborted: Not registered');
            state.error = 'Not registered. Please login.';
            return;
        }

        const targetURI = `sip:${target}@${credentials.domain}`;
        console.log(`[Phone] Configuration Identity: ${ua.configuration.uri} `);
        console.log(`[Phone] Dialing Target URI: ${targetURI} `);

        ua.call(targetURI, {
            mediaConstraints: { audio: true, video: false },
            pcConfig: {
                iceServers: [],
                rtcpMuxPolicy: 'require'
            },
            rtcOfferConstraints: {
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            }
        });
    };

    const answer = () => {
        console.log('[Phone] Answering call...');
        if (state.session) {
            const rawSession = toRaw(state.session);
            rawSession.answer({
                mediaConstraints: { audio: true, video: false },
                pcConfig: {
                    iceServers: [],
                    rtcpMuxPolicy: 'require'
                },
                rtcAnswerConstraints: {
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false
                }
            });
        }
    };

    const hangup = () => {
        if (state.session) {
            const rawSession = toRaw(state.session);
            rawSession.terminate();
        }
    };

    const mute = () => {
        if (state.session) {
            const rawSession = toRaw(state.session);
            if (rawSession.isMuted().audio) {
                rawSession.unmute({ audio: true });
            } else {
                rawSession.mute({ audio: true });
            }
        }
    }

    const hold = () => {
        if (state.session) {
            const rawSession = toRaw(state.session);
            if (rawSession.isOnHold().local) {
                rawSession.unhold();
            } else {
                rawSession.hold();
            }
        }
    }

    const sendDTMF = (tone) => {
        if (state.session) {
            const rawSession = toRaw(state.session);
            rawSession.sendDTMF(tone);
        }
    }

    const transfer = (target) => {
        if (state.session) {
            console.log(`[Phone] Transferring to ${target}...`);
            const rawSession = toRaw(state.session);
            rawSession.refer(target);
        }
    };

    const startTimer = () => {
        stopTimer();
        seconds = 0;
        state.timer = '00:00:00';
        timerInterval = setInterval(() => {
            seconds++;
            const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
            const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
            const s = (seconds % 60).toString().padStart(2, '0');
            state.timer = `${h}:${m}:${s} `;
        }, 1000);
    };

    const stopTimer = () => {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    };

    const resetCall = () => {
        stopTimer();
        state.session = null;
        state.callStatus = 'idle';
        state.remoteIdentity = '';
        state.timer = '00:00:00';
        state.audioStream = null;
    };

    // Auto-login if creds exist
    const tryAutoLogin = () => {
        const stored = localStorage.getItem('sip_creds');
        if (stored) {
            const { user, password, domain, socketUrl } = JSON.parse(stored);
            if (user && password && domain && socketUrl) {
                login(user, password, domain, socketUrl);
            }
        }
    }

    return {
        state,
        login,
        logout,
        call,
        answer,
        hangup,
        mute,
        hold,
        sendDTMF,
        transfer,
        tryAutoLogin,
        history,
        clearHistory,
        setAgentStatus
    };
}
