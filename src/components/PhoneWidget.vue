
<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { usePhone } from '../composables/usePhone';
import { Phone, Mic, MicOff, Pause, Play, Grip, ArrowRightLeft, PhoneOff, ChevronDown, ChevronUp, Wifi, Clock, X, Delete, LogOut } from 'lucide-vue-next';

// Use the existing Composable logic
const { state, login, logout, call, answer, hangup, mute, hold, sendDTMF, transfer, tryAutoLogin, history, clearHistory, setAgentStatus } = usePhone();

const form = ref({
  user: '1001',
  password: '1de3ef49c86241a',
  domain: 'telephone.ivoji.site',
  socketUrl: 'wss://telephone.ivoji.site:7443',
  useIce: true,
  iceString: 'stun:stun.freeswitch.org:3478'
});

// Lock Screen State
const isLocked = ref(true);
const unlockPassword = ref('');
const unlockError = ref('');
const APP_PIN = 'Iv0ji@2025'; 

const handleUnlock = () => {
    if (unlockPassword.value === APP_PIN) {
        isLocked.value = false;
        // Auto-login after unlock if not registered
        if (!state.isRegistered) {
            handleLogin(); 
        }
    } else {
        unlockError.value = 'Incorrect Password';
        unlockPassword.value = '';
    }
};

// UI State
const isActive = ref(true); // Maps to expanded/minimized
const showKeypad = ref(false);
const showHistory = ref(false);
const showTransfer = ref(false);
const transferTarget = ref('');
// ...
const dialNumber = ref('');

const handleStatusChange = (e) => {
    setAgentStatus(e.target.value);
};

const toggleHistory = () => {
    showHistory.value = !showHistory.value;
    if (showHistory.value) { showTransfer.value = false; showKeypad.value = false; }
};

const toggleTransfer = () => {
    showTransfer.value = !showTransfer.value;
    if (showTransfer.value) { showHistory.value = false; showKeypad.value = false; }
};

// Keypad toggle (Now used for Dialer in Idle and DTMF in Call)
const handleKeypad = () => {
    showKeypad.value = !showKeypad.value;
    if (showKeypad.value) { showHistory.value = false; showTransfer.value = false; }
};

const handleDialKey = (key) => {
    if (state.callStatus === 'connected') {
        sendDTMF(key);
    } else {
        dialNumber.value += key;
    }
};

const handleBackspace = () => {
    dialNumber.value = dialNumber.value.slice(0, -1);
};

// Standalone Mic Test
const testMicLevel = ref(0);
const isTestingMic = ref(false);
const micError = ref(''); // Store error message
const availableDevices = ref([]);
let testMicCtx = null;
let testMicStream = null;

const toggleMicTest = async () => {
    micError.value = ''; // Reset error
    
    if (isTestingMic.value) {
        // Stop test
        if (testMicStream) {
            testMicStream.getTracks().forEach(t => t.stop());
            testMicStream = null;
        }
        if (testMicCtx) {
            testMicCtx.close();
            testMicCtx = null;
        }
        isTestingMic.value = false;
        testMicLevel.value = 0;
    } else {
        // Start test
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("navigator.mediaDevices.getUserMedia is undefined. Are you on HTTPS or localhost?");
            }

            // List devices for debug
            const devices = await navigator.mediaDevices.enumerateDevices();
            availableDevices.value = devices.filter(d => d.kind === 'audioinput').map(d => d.label || d.deviceId);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            testMicStream = stream;
            isTestingMic.value = true;
            
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            testMicCtx = new AudioContext();
            const source = testMicCtx.createMediaStreamSource(stream);
            const analyser = testMicCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            
            const update = () => {
                if (!isTestingMic.value) return;
                analyser.getByteFrequencyData(dataArray);
                const avg = dataArray.reduce((p, c) => p + c, 0) / dataArray.length;
                testMicLevel.value = Math.min(100, Math.round(avg * 2));
                requestAnimationFrame(update);
            };
            update();
            
        } catch (e) {
            console.error("Mic Test Failed:", e);
            micError.value = e.toString();
        }
    }
};

const handleCallFromDialer = () => {
    if (dialNumber.value) {
        call(dialNumber.value);
        showKeypad.value = false; // Close dialer
        dialNumber.value = '';
    }
};

const handleTransfer = () => {
    if (transferTarget.value) {
        transfer(transferTarget.value);
        showTransfer.value = false;
        transferTarget.value = '';
    }
};

// Auto-expand on incoming call
watch(() => state.callStatus, (newStatus) => {
    if (newStatus === 'incoming' || newStatus === 'calling') {
        isActive.value = true;
    }
});

// Map UsePhone state to User's UI requirements
const callTime = computed(() => state.timer);
const isMuted = computed(() => state.session && state.session.isMuted().audio);
const isOnHold = computed(() => state.session && state.session.isOnHold().local);
const remoteName = computed(() => state.remoteIdentity || 'Ready');
const remoteNumber = computed(() => state.remoteIdentity ? `(${state.remoteIdentity})` : '');

// Handle Login Form
const handleLogin = () => {
    if (form.value.user && form.value.password && form.value.domain && form.value.socketUrl) {
        let iceServers = [];
        if (form.value.useIce && form.value.iceString) {
            // Split by comma or newline
             const urls = form.value.iceString.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
             if (urls.length) {
                 iceServers = [{ urls }];
             }
        }
        
        login(form.value.user, form.value.password, form.value.domain, form.value.socketUrl, iceServers);
    }
};

const handleLogout = () => {
    console.log('[PhoneWidget] Logout button clicked');
    logout();
    // Optional: Reset form or other UI state if needed
};

const handleCall = (number) => {
    if(!state.isRegistered) {
        alert("Please login first");
        return;
    }
    call(number);
    isActive.value = true; // Expand on call
}
window.handlePhoneCall = handleCall;

onMounted(() => {
    tryAutoLogin();
});

// Actions mapped to UI
const toggleMinimize = () => {
    isActive.value = !isActive.value;
};



// ---------------------------
// Ringtone Logic (Web Audio API)
// ---------------------------
const isSecure = window.isSecureContext;
const protocol = window.location.protocol;
const hostname = window.location.hostname;

let audioCtx = null;
let oscillator = null;
let gainNode = null;
let ringInterval = null;

const playRingtone = () => {
    if (audioCtx) return; // Already playing
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        
        const playBeep = () => {
            if (!audioCtx) return;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            // "Phone Ring" sound usually dual frequency or specific pattern
            // Let's do a simple pleasant drilling sound: 440Hz & 480Hz mixed
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, audioCtx.currentTime); 
            
            // Modulation to sound like a phone ring
            gain.gain.setValueAtTime(0, audioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.1);
            gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2); // 2 seconds duration

            osc.start();
            osc.stop(audioCtx.currentTime + 2);
        };

        playBeep();
        ringInterval = setInterval(playBeep, 3000); // Repeat every 3 seconds

    } catch (e) {
        console.error("Failed to play ringtone:", e);
    }
};

const stopRingtone = () => {
    if (ringInterval) {
        clearInterval(ringInterval);
        ringInterval = null;
    }
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
};

// Watch for incoming calls to trigger ringtone
watch(() => state.callStatus, (newStatus, oldStatus) => {
    console.log(`[PhoneWidget] Status changed: ${oldStatus} -> ${newStatus}`);
    if (newStatus === 'incoming') {
        playRingtone();
    } else {
        stopRingtone();
    }
});

// Bind Remote Audio Stream
const remoteAudio = ref(null);
watch(() => state.audioStream, (newStream) => {
    console.log('[PhoneWidget] Audio stream changed:', newStream);
    if (newStream && remoteAudio.value) {
        remoteAudio.value.srcObject = newStream;
        // Ensure it plays (sometimes verifying promise helps debugging)
        remoteAudio.value.play().catch(e => console.error("Error playing remote audio:", e));
    }
}, { immediate: true });
</script>

<template>
  <div>
    <!-- Lock Screen Overlay -->
    <div v-if="isLocked" class="fixed inset-0 z-[9999] bg-[#2c3e50] flex flex-col items-center justify-center text-white">
        <div class="w-64 p-6 bg-[#34495e] rounded-lg shadow-xl text-center">
            <h2 class="text-xl font-bold mb-4">Phone Locked</h2>
            <input type="password" v-model="unlockPassword" @keyup.enter="handleUnlock" placeholder="Enter PIN" 
                   class="w-full bg-[#2c3e50] border border-gray-600 rounded p-2 text-center text-white mb-4 outline-none focus:border-blue-500 transition-colors" />
            <button @click="handleUnlock" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded transition-colors">
                Unlock
            </button>
            <p v-if="unlockError" class="text-red-400 text-xs mt-2">{{ unlockError }}</p>
        </div>
    </div>

    <!-- Login Overlay (Preserved functionality, using similar style to new bar if possible, or keeping previous simple style) -->
    <div v-else-if="!state.isRegistered" 
         class="fixed bottom-4 right-4 z-50 w-[320px] bg-[#2c3e50] text-[#ecf0f1] rounded-[16px] p-[15px] shadow-[0_10px_30px_rgba(0,0,0,0.4)] flex flex-col gap-4 transition-all">
         <h2 class="text-lg font-bold border-b border-white/10 pb-2">SIP Login</h2>
         <input v-model="form.user" placeholder="Extension" class="bg-[#34495e] border-none rounded p-2 text-white placeholder-gray-400 outline-none" />
         <input v-model="form.password" type="password" placeholder="Password" class="bg-[#34495e] border-none rounded p-2 text-white placeholder-gray-400 outline-none" />
         <input v-model="form.domain" placeholder="SIP Domain" class="bg-[#34495e] border-none rounded p-2 text-white placeholder-gray-400 outline-none" />
         <input v-model="form.socketUrl" placeholder="WSS URL" class="bg-[#34495e] border-none rounded p-2 text-white placeholder-gray-400 outline-none" />
         
         <!-- ICE Configuration -->
         <div class="flex items-center gap-2 mt-1">
            <input type="checkbox" id="useIce" v-model="form.useIce" class="cursor-pointer accent-[#2980b9]">
            <label for="useIce" class="text-sm cursor-pointer select-none">Enable ICE (STUN/TURN)</label>
         </div>
         <div v-if="form.useIce" class="transition-all">
             <input v-model="form.iceString" placeholder="STUN Server (comma separated)" class="w-full bg-[#34495e] border-none rounded p-2 text-white placeholder-gray-400 outline-none text-xs" />
             <p class="text-[10px] text-gray-400 mt-1">e.g. stun:stun.l.google.com:19302</p>
         </div>

         <button @click="handleLogin" class="bg-[#2980b9] hover:bg-[#3498db] text-white font-bold py-2 rounded transition-colors mt-2">Connect</button>
         
         <!-- Secure Context Warning -->
         <div v-if="!isSecure" class="bg-yellow-600/50 p-2 rounded mt-2 text-center">
             <div class="text-[10px] font-bold text-yellow-200 uppercase mb-1">Warning: Insecure Context</div>
             <p class="text-[10px] leading-tight text-white/80">
                 Microphone access <strong>requires HTTPS</strong> or <strong>localhost</strong>. 
                 <br>Current: {{ protocol }} // {{ hostname }}
             </p>
         </div>

         <div class="border-t border-white/10 pt-2 mt-2">
            <button @click="toggleMicTest" :class="['w-full py-1 text-xs rounded transition-colors', isTestingMic ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-600 hover:bg-gray-500']">
                {{ isTestingMic ? 'Stop Mic Test' : 'Test Microphone' }}
            </button>
            <div v-if="isTestingMic" class="mt-2">
                <div class="text-xs text-center mb-1">Level: {{ testMicLevel }}%</div>
                <div class="w-full bg-gray-700 h-2 rounded overflow-hidden">
                    <div class="h-full bg-green-500 transition-all duration-75" :style="{ width: testMicLevel + '%' }"></div>
                </div>
                <div class="mt-2 text-[10px] text-gray-400">
                    Devices found: {{ availableDevices.length }}
                    <div v-for="d in availableDevices" :key="d" class="truncate">{{ d }}</div>
                </div>
            </div>
            <div v-if="micError" class="mt-2 text-xs text-red-400 bg-red-900/20 p-1 rounded break-all">
                {{ micError }}
            </div>
         </div>

         <p v-if="state.error" class="text-[#e74c3c] text-xs text-center">{{ state.error }}</p>
    </div>

    <!-- User's "Web Call Bar" Template -->
    <div v-else :class="['call-bar-container', { 'is-active': isActive }]">
        
        <!-- Expanded View Only (Minimize button removed, so always assume expanded or controlled externally if needed, but for now just show content) -->
        <!-- User said "No minimize button", implying it stays as a bar. -->
        <div class="info-section">
            <div class="timer-info">
                <span class="time" v-if="state.callStatus === 'connected'">{{ callTime }}</span>
                <button class="history-toggle" @click="toggleHistory" title="History">
                    <Clock class="w-4 h-4" />
                </button>
            </div>
            <div class="contact-info flex items-center gap-2">
                <!-- Status Switcher (Only when registered) -->
                 <select v-if="state.isRegistered" :value="state.agentStatus" @change="handleStatusChange" 
                         class="bg-[#34495e] text-xs text-white border border-white/10 rounded px-1 py-0.5 outline-none cursor-pointer">
                     <option value="online">Online</option>
                     <option value="busy">Busy</option>
                     <option value="offline">Offline</option>
                 </select>
                <div v-else class="status-text">Ready</div>
                
                <span v-if="state.callStatus !== 'idle'" class="status-text md:hidden">{{ remoteName || 'Connected' }}</span>
                
                <!-- Logout Button -->
                <!-- settings/mic test popover trigger could go here, but let's just add a small icon or button -->
                 <button @click="toggleMicTest" :class="['text-gray-400 hover:text-white p-1 ml-1', {'text-green-500': isTestingMic}]" title="Test Mic" >
                    <Mic class="w-4 h-4"/>
                </button>
                <div v-if="isTestingMic" class="absolute top-full right-0 bg-black p-2 rounded mt-1 z-50 w-32 border border-blue-500">
                    <div class="h-2 bg-gray-700 rounded overflow-hidden">
                         <div class="h-full bg-green-500" :style="{ width: testMicLevel + '%' }"></div>
                    </div>
                </div>

                <button v-if="state.isRegistered" @click="handleLogout" class="text-gray-400 hover:text-white p-1 ml-2" title="Logout / Re-configure">
                    <LogOut class="w-4 h-4" />
                </button>
            </div>
        </div>

        <!-- History Popover -->
        <div v-if="showHistory" class="history-popover">
            <div class="history-header">
                <span>Recent Calls</span>
                <div class="history-actions">
                    <button @click="clearHistory" class="text-xs text-red-400">Clear</button>
                    <button @click="toggleHistory" class="text-xs ml-2"><X class="w-4 h-4"/></button>
                </div>
            </div>
            <div class="history-list">
                <div v-if="history.length === 0" class="text-center text-gray-400 p-4 text-xs">No history</div>
                <div v-else v-for="(entry, index) in history" :key="index" class="history-item">
                    <div class="history-row">
                        <span class="history-number">{{ entry.number }}</span>
                        <span :class="['history-status', entry.status.toLowerCase()]">{{ entry.status }}</span>
                    </div>
                    <div class="history-time">{{ entry.time }}</div>
                </div>
            </div>
        </div>

        <div class="control-section" v-if="state.callStatus === 'incoming'">
            <!-- Reject Button -->
            <button class="incoming-btn reject-btn" @click="hangup">
                <span class="icon">
                    <PhoneOff class="w-6 h-6 fill-current" />
                </span>
                <span class="label">Reject</span>
            </button>

            <!-- Answer Button -->
            <button class="incoming-btn answer-btn" @click="answer">
                <span class="icon">
                    <Phone class="w-6 h-6 fill-current" />
                </span>
                <span class="label">Answer</span>
            </button>
        </div>

        <div class="control-section" v-else>
            <!-- Mute -->
            <button :class="['control-btn', { 'is-muted': isMuted }]" @click="mute" :disabled="state.callStatus === 'idle'">
                <span class="icon">
                    <MicOff v-if="isMuted" class="w-5 h-5" />
                    <Mic v-else class="w-5 h-5" />
                </span>
                <span class="label">Mute</span>
            </button>

            <!-- Hold -->
            <button :class="['control-btn', { 'bg-white/10': isOnHold }]" @click="hold" :disabled="state.callStatus === 'idle'">
                <span class="icon">
                        <Play v-if="isOnHold" class="w-5 h-5 ml-0.5" />
                        <Pause v-else class="w-5 h-5" />
                </span>
                <span class="label">Hold</span>
            </button>

            <!-- Keypad -->
            <button :class="['control-btn', { 'text-white': showKeypad }]" @click="handleKeypad">
                <span class="icon font-bold text-lg">#</span>
                <span class="label">Keypad</span>
            </button>

            <!-- Keypad/Dialer Popover -->
            <div v-if="showKeypad" class="keypad-popover">
                <!-- Dialer Input (Only when not in call) -->
                <div v-if="state.callStatus === 'idle'" class="dialer-display">
                    <input v-model="dialNumber" placeholder="Enter number..." class="dialer-input" />
                    <button v-if="dialNumber" @click="handleBackspace" class="backspace-btn"><Delete class="w-4 h-4"/></button>
                </div>
                
                <div class="keypad-grid">
                    <button v-for="key in ['1','2','3','4','5','6','7','8','9','*','0','#']" :key="key" 
                            class="keypad-btn" @click="handleDialKey(key)">
                        {{ key }}
                    </button>
                </div>

                <!-- Call Button (Only when idle) -->
                <button v-if="state.callStatus === 'idle'" class="dialer-call-btn" @click="handleCallFromDialer" :disabled="!dialNumber">
                    <Phone class="w-5 h-5 fill-current" />
                </button>
            </div>

            <!-- Transfer -->
            <button class="control-btn" :disabled="state.callStatus === 'idle'" @click="toggleTransfer">
                <span class="icon"><ArrowRightLeft class="w-5 h-5" /></span>
                <span class="label">Transfer</span>
            </button>
            
            <!-- Transfer Popover -->
            <div v-if="showTransfer" class="transfer-popover">
                <h3 class="text-xs font-bold mb-2">Transfer Call</h3>
                <input v-model="transferTarget" placeholder="Number" class="w-full bg-[#34495e] border border-white/10 rounded px-2 py-1 text-white text-sm mb-2 focus:outline-none" />
                <div class="flex gap-2">
                    <button @click="handleTransfer" class="flex-1 bg-[#2980b9] hover:bg-[#3498db] text-white text-xs py-1 rounded">Transfer</button>
                    <button @click="toggleTransfer" class="flex-1 bg-white/10 hover:bg-white/20 text-white text-xs py-1 rounded">Cancel</button>
                </div>
            </div>
            
            <!-- End Call / Ready (Moved here) -->
            <button :class="['control-btn', 'end-call-btn-small']" @click="hangup" :disabled="state.callStatus === 'idle'">
                <span class="icon" :class="{'!bg-[#e74c3c] !text-white': state.callStatus !== 'idle'}">
                    <PhoneOff v-if="state.callStatus !== 'idle'" class="w-5 h-5 fill-current" />
                    <Phone v-else class="w-5 h-5 fill-current" />
                </span>
                <span class="label">{{ state.callStatus === 'idle' ? 'Ready' : 'End' }}</span>
            </button>
        </div>
    </div>
    
    <!-- Hidden Audio Element for Remote Stream -->
    <audio ref="remoteAudio" autoplay playsinline controls style="position: absolute; bottom: 0; left: 0; z-index: 9999; opacity: 0.1; width: 100px; height: 50px; pointer-events: auto;"></audio>
    <!-- Debug Info (Temporary) -->
    <div v-if="state.callStatus !== 'idle'" style="position:fixed; top:10px; left:10px; z-index:9999; background:black; color:white; font-size:10px; padding:5px;">
        Stream: {{ state.audioStream ? 'Active' : 'Null' }} <br>
        Tracks: {{ state.audioStream ? state.audioStream.getTracks().length : 0 }} <br>
        <button @click="$refs.remoteAudio.play()" style="background:red;color:white;">Force Play</button>
    </div>
  </div>
</template>

<style scoped>
/* ---------------------------------- */
/* 整体布局和样式 (模仿原型图风格) */
/* ---------------------------------- */
.call-bar-container {
  /* 定位在屏幕右下角，使用固定定位使其浮动 */
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: auto; /* Width auto to fit content? Or fixed small? User said "size smaller". Fixed is safer for layout. */
  min-width: 300px;
  
  /* 风格：深色、圆角、阴影 */
  background-color: #2c3e50; 
  color: #ecf0f1;
  border-radius: 12px; 
  padding: 10px 15px; /* Reduced padding */
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  transition: all 0.3s ease-in-out;
}

/* ---------------------------------- */
/* 顶部信息区 */
/* ---------------------------------- */
.info-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px; /* Reduced margin */
  padding-bottom: 5px; 
  border-bottom: 1px solid rgba(255, 255, 255, 0.05); 
}

.timer-info {
  display: flex;
  align-items: center;
  font-size: 1.1em; /* Smaller font */
  font-weight: bold;
}
.contact-info {
  text-align: right;
}
.contact-info .status-text {
  font-size: 0.9em;
  color: #bdc3c7; /* Softer color */
}

/* ---------------------------------- */
/* 中部控制区 */
/* ---------------------------------- */
.control-section {
  display: flex;
  gap: 10px; /* Explicit gap */
  justify-content: space-between; 
  padding: 0;
}

.control-btn {
  background: none;
  border: none;
  color: #ecf0f1;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  transition: color 0.2s;
}

.control-btn:disabled {
    opacity: 0.3; 
    cursor: default;
}

.control-btn .icon {
  font-size: 1em;
  width: 40px; /* Smaller buttons */
  height: 40px;
  background-color: #34495e; 
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 2px; 
  transition: background-color 0.2s;
}

.control-btn .label {
  font-size: 0.65em; /* Smaller text */
  color: #95a5a6; 
}

/* 静音激活状态 */
.control-btn.is-muted .icon {
  background-color: #e74c3c; 
  color: white; 
}

/* Specific style for End Call button in row */
.end-call-btn-small .icon {
    /* Base style matches others, specific active style handled in template/class binding or here */
}

/* Incoming Call Buttons */
.incoming-btn {
  background: none;
  border: none;
  color: #ecf0f1;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  flex: 1; /* Split width evenly */
}

.incoming-btn .icon {
  font-size: 1.2em;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 5px;
  color: white;
  transition: transform 0.2s;
}

.incoming-btn:hover .icon {
    transform: scale(1.1);
}

.answer-btn .icon {
  background-color: #2ecc71; /* Green */
}

.reject-btn .icon {
  background-color: #e74c3c; /* Red */
}

/* History Styles */
.history-toggle {
    background: none;
    border: none;
    color: #bdc3c7;
    cursor: pointer;
    margin-left: 8px;
    padding: 2px;
}
.history-toggle:hover { color: white; }

.history-popover {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    background: #34495e;
    transform: translateY(-10px);
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 5px 15px rgba(0,0,0,0.5);
    max-height: 300px;
    display: flex;
    flex-direction: column;
    z-index: 2000;
}

.history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    padding-bottom: 5px;
    margin-bottom: 5px;
    font-size: 0.9em;
    font-weight: bold;
}

.history-list {
    overflow-y: auto;
    flex: 1;
}

.history-item {
    padding: 8px 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
}

.history-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 2px;
}

.history-number { font-weight: bold; color: #ecf0f1; }
.history-time { font-size: 0.75em; color: #95a5a6; }

.history-status { font-size: 0.75em; }
.history-status.connected { color: #2ecc71; }
.history-status.missed, .history-status.failed, .history-status.cancelled { color: #e74c3c; }

/* Transfer Popover */
.transfer-popover {
    position: absolute;
    bottom: 110%; /* Above controls */
    left: 10px;
    right: 10px;
    background: #2c3e50;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 5px 15px rgba(0,0,0,0.5);
    z-index: 2000;
}

/* Keypad/Dialer Styles */
.keypad-popover {
    position: absolute;
    bottom: 110%;
    left: 50%;
    transform: translateX(-50%);
    width: 220px;
    background: #2c3e50;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 15px;
    box-shadow: 0 5px 20px rgba(0,0,0,0.6);
    z-index: 2000;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.dialer-display {
    display: flex;
    align-items: center;
    background: #34495e;
    border-radius: 6px;
    padding: 5px 10px;
    margin-bottom: 5px;
}

.dialer-input {
    flex: 1;
    background: none;
    border: none;
    color: white;
    font-size: 1.2em;
    font-weight: bold;
    outline: none;
    width: 100%;
}

.backspace-btn {
    color: #95a5a6;
    background: none;
    border: none;
    cursor: pointer;
}
.backspace-btn:hover { color: #e74c3c; }

.keypad-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
}

.keypad-btn {
    background: #34495e;
    border: none;
    border-radius: 50%;
    width: 50px;
    height: 50px;
    color: white;
    font-size: 1.2em;
    font-weight: bold;
    cursor: pointer;
    transition: background 0.2s;
    margin: 0 auto; /* Center in grid cell */
    display: flex;
    justify-content: center;
    align-items: center;
}

.keypad-btn:hover { background: #3d566e; }
.keypad-btn:active { background: #2980b9; transform: scale(0.95); }

.dialer-call-btn {
    background: #2ecc71;
    border: none;
    border-radius: 50px;
    height: 40px;
    color: white;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: 5px;
    transition: transform 0.2s;
}
.dialer-call-btn:hover { background: #27ae60; }
.dialer-call-btn:disabled { opacity: 0.5; cursor: default; }


</style>
