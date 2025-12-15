import { ref, reactive, computed, toRaw, markRaw } from 'vue';
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
    error: null,
    audioStream: null,
    localVolume: 0, // 0-100
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

let second = 0;

// Helper: Munge SDP to force PCMU/PCMA (G.711) priority
// This fixes "488 Not Acceptable Here / Incompatible Destination" from legacy gateways
function mungeSDP(sdp) {
    console.log('[Phone] Munging SDP to prioritize G.711...');
    const lines = sdp.split('\r\n');
    let mLineIndex = -1;
    let audioPayloads = [];

    // 1. Find the audio m-line and extract payloads
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('m=audio')) {
            mLineIndex = i;
            const parts = lines[i].split(' ');
            // format: m=audio <port> <proto> <payloads...>
            if (parts.length > 3) {
                audioPayloads = parts.slice(3);
            }
            break;
        }
    }

    if (mLineIndex === -1) return sdp;

    // 2. Reorder payloads: Move 0 (PCMU) and 8 (PCMA) to the front
    const preferred = ['0', '8'];
    const others = audioPayloads.filter(p => !preferred.includes(p));
    const newPayloads = [...preferred, ...others];

    // 3. Reconstruct m-line
    const parts = lines[mLineIndex].split(' ');
    // Keep first 3 parts (m=audio, port, proto) and append new payloads
    lines[mLineIndex] = [...parts.slice(0, 3), ...newPayloads].join(' ');

    return lines.join('\r\n');
}

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

            // Audio Level Monitor
            let audioMonitorCtx = null;
            let audioMonitorInterval = null;

            const setupAudioMonitor = (stream) => {
                if (audioMonitorCtx) return; // Already monitoring
                try {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    audioMonitorCtx = new AudioContext();
                    const source = audioMonitorCtx.createMediaStreamSource(stream);
                    const analyser = audioMonitorCtx.createAnalyser();
                    analyser.fftSize = 256;
                    source.connect(analyser);

                    const dataArray = new Uint8Array(analyser.frequencyBinCount);

                    audioMonitorInterval = setInterval(() => {
                        analyser.getByteFrequencyData(dataArray);
                        // Calculate average volume
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) {
                            sum += dataArray[i];
                        }
                        const average = sum / dataArray.length;
                        // Normalize roughly to 0-100 (average usually low for speech)
                        state.localVolume = Math.min(100, Math.round(average * 2));
                        // console.log('[Phone] Mic Volume:', state.localVolume);
                    }, 100);

                    console.log('[Phone] Local Audio Monitor started');
                } catch (e) {
                    console.error('[Phone] Failed to setup audio monitor:', e);
                }
            };

            const stopAudioMonitor = () => {
                if (audioMonitorInterval) {
                    clearInterval(audioMonitorInterval);
                    audioMonitorInterval = null;
                }
                if (audioMonitorCtx) {
                    audioMonitorCtx.close();
                    audioMonitorCtx = null;
                }
                state.localVolume = 0;
            };

            // Media Handling: Capture Remote Stream
            const setupPeerConnection = (pc) => {
                if (pc._hasSetup) return; // Prevent duplicate setup
                pc._hasSetup = true;

                console.log('[Phone] PeerConnection setup for session');

                pc.addEventListener('track', (trackEvent) => {
                    console.log('[Phone] Remote track received:', trackEvent);
                    let stream = null;
                    if (trackEvent.streams && trackEvent.streams[0]) {
                        stream = trackEvent.streams[0];
                    } else {
                        console.log('[Phone] No stream in track event, creating new MediaStream...');
                        stream = new MediaStream([trackEvent.track]);
                    }
                    // Use markRaw to prevent Vue from making the MediaStream reactive
                    state.audioStream = markRaw(stream);
                });

                // Request: Print STUN/ICE info
                pc.addEventListener('icecandidate', (event) => {
                    if (event.candidate) {
                        console.log('[Phone] New ICE Candidate:', event.candidate.candidate);
                    } else {
                        console.log('[Phone] ICE Candidate gathering completed.');
                    }
                });

                pc.addEventListener('iceconnectionstatechange', () => {
                    console.log('[Phone] ICE Connection State:', pc.iceConnectionState);
                });

                // Check for existing tracks (in case we missed the 'track' event)
                const receivers = pc.getReceivers();
                if (receivers && receivers.length > 0) {
                    console.log('[Phone] Found existing receivers:', receivers.length);
                    receivers.forEach(receiver => {
                        if (receiver.track && receiver.track.kind === 'audio') {
                            console.log('[Phone] Found existing audio track, setting up stream...');
                            const stream = new MediaStream([receiver.track]);
                            state.audioStream = markRaw(stream);
                        }
                    });
                }

                // Check for local senders (Microphone)
                const senders = pc.getSenders();
                console.log('[Phone] Local Senders:', senders.length);
                senders.forEach((sender, index) => {
                    console.log(`[Phone] Sender ${index}:`, sender.track ? `Track ${sender.track.kind} (${sender.track.readyState})` : 'No Track');
                    // Disable automatic monitoring to avoid AudioContext conflicts/issues
                    /*
                    if (sender.track && sender.track.kind === 'audio') {
                        if (sender.track.muted) {
                            console.warn(`[Phone] Sender ${index} track is MUTED!`);
                        }
                        // Start monitoring this track
                        console.log('[Phone] Setting up monitor for local sender track');
                        const localStream = new MediaStream([sender.track]);
                        setupAudioMonitor(localStream);
                    }
                    */
                });
            };

            if (session.connection) {
                setupPeerConnection(session.connection);
            }

            session.on('peerconnection', (e) => {
                console.log('[Phone] PeerConnection created (event)');
                setupPeerConnection(e.peerconnection);
            });

            // SDP Munging for Codec Priority
            session.on('sdp', (data) => {
                if (data.originator === 'local' && data.type === 'offer') {
                    console.log('[Phone] Intercepting Local SDP Offer...');
                    data.sdp = mungeSDP(data.sdp);
                }
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
                stopAudioMonitor(); // Stop monitor
                // Determine final status if not already connected
                if (callLog.status !== 'Connected') {
                    callLog.status = session.direction === 'incoming' ? 'Missed' : 'Cancelled';
                }
                addToHistory(callLog);
                resetCall();
            });

            session.on('failed', (e) => {
                console.error('[Phone] Call failed:', e);
                stopAudioMonitor(); // Stop monitor
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
        console.log('[Phone] Logging out...');
        if (ua) {
            try {
                ua.stop();
            } catch (e) {
                console.error('[Phone] Error stopping UA:', e);
            }
            ua = null;
        }
        state.isRegistered = false;
        state.isConnected = false;
        state.agentStatus = 'offline';
        localStorage.removeItem('sip_creds');
        resetCall();
        console.log('[Phone] Logout complete. isRegistered:', state.isRegistered);
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

        const iceServers = toRaw(state.iceServers);
        console.log('[Phone] using ICE Servers:', iceServers);
        if (!iceServers || iceServers.length === 0) {
            console.warn('[Phone] ⚠️ WARNING: No ICE/STUN servers configured! Calls may fail on public networks.');
        }

        ua.call(targetURI, {
            mediaConstraints: { audio: true, video: false },
            pcConfig: {
                iceServers: state.iceServers,
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
        const iceServers = toRaw(state.iceServers);
        console.log('[Phone] using ICE Servers:', iceServers);
        if (!iceServers || iceServers.length === 0) {
            console.warn('[Phone] ⚠️ WARNING: No ICE/STUN servers configured! Calls may fail on public networks.');
        }
        if (state.session) {
            const rawSession = toRaw(state.session);
            rawSession.answer({
                mediaConstraints: { audio: true, video: false },
                pcConfig: {
                    iceServers: state.iceServers,
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
            try {
                const parsed = JSON.parse(stored);
                // Handle legacy format where iceServers might be missing
                const user = parsed.user;
                const password = parsed.password;
                const domain = parsed.domain;
                const socketUrl = parsed.socketUrl;
                const iceServers = parsed.iceServers || [];

                if (user && password && domain && socketUrl) {
                    // Update state.iceServers immediately before login just in case
                    state.iceServers = iceServers;
                    login(user, password, domain, socketUrl, iceServers);
                }
            } catch (e) {
                console.error('[Phone] Failed to parse stored credentials', e);
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
