// ─── MeetFlow Meeting Room ──────────────────────────────────────
(function () {
    'use strict';

    // ─── Utility ──────────────────────────────────────────────────
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        toast.innerHTML = `<span>${icons[type]}</span> ${message}`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3600);
    }

    // ─── Parse URL Parameters ────────────────────────────────────
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    const userName = params.get('name') || 'Anonymous';

    if (!roomId) {
        window.location.href = '/';
        return;
    }

    // Display room info
    document.getElementById('meeting-code').textContent = roomId;
    document.getElementById('meeting-code').addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href);
        showToast('Meeting link copied!', 'success');
    });
    document.getElementById('local-user-name').textContent = userName + ' (You)';

    // ─── Meeting Timer ────────────────────────────────────────────
    const meetingStart = Date.now();
    setInterval(() => {
        const elapsed = Date.now() - meetingStart;
        const hrs = Math.floor(elapsed / 3600000).toString().padStart(2, '0');
        const mins = Math.floor((elapsed % 3600000) / 60000).toString().padStart(2, '0');
        const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
        document.getElementById('meeting-timer').textContent = `${hrs}:${mins}:${secs}`;
    }, 1000);

    // ─── Socket.io Connection ────────────────────────────────────
    const socket = io();

    // ─── State ────────────────────────────────────────────────────
    let localStream = null;
    let screenStream = null;
    let isMicMuted = false;
    let isCameraOff = false;
    let isScreenSharing = false;
    const peers = {}; // peerId -> { pc, videoEl, userName }

    // ─── WebRTC Config ────────────────────────────────────────────
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    };

    // ─── Initialize Media ────────────────────────────────────────
    async function initMedia() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
                audio: { echoCancellation: true, noiseSuppression: true }
            });
            document.getElementById('local-video').srcObject = localStream;
            showToast('Camera and microphone ready', 'success');
        } catch (err) {
            console.error('Media error:', err);
            showToast('Could not access camera/mic. Check permissions.', 'error');

            // Try audio only
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                isCameraOff = true;
                document.getElementById('btn-camera').classList.add('active');
                showToast('Audio only mode', 'info');
            } catch (audioErr) {
                showToast('No media devices available', 'error');
            }
        }

        // Join the room
        socket.emit('join-room', { roomId, userName });
    }

    // ─── WebRTC Peer Connection ───────────────────────────────────
    function createPeerConnection(peerId, peerName) {
        const pc = new RTCPeerConnection(rtcConfig);

        // Add local tracks
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        // Handle remote tracks
        pc.ontrack = (event) => {
            let videoEl = peers[peerId]?.videoEl;
            if (!videoEl) {
                videoEl = addVideoTile(peerId, peerName);
            }
            videoEl.srcObject = event.streams[0];
        };

        // ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { to: peerId, candidate: event.candidate });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                removeVideoTile(peerId);
            }
        };

        peers[peerId] = { pc, videoEl: peers[peerId]?.videoEl || null, userName: peerName };
        return pc;
    }

    // ─── Video Grid Management ───────────────────────────────────
    function addVideoTile(peerId, peerName) {
        const grid = document.getElementById('video-grid');
        const tile = document.createElement('div');
        tile.className = 'video-tile';
        tile.id = `tile-${peerId}`;
        tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="user-label">
        <span class="mic-status"></span>
        <span>${peerName || 'User'}</span>
      </div>
    `;
        grid.appendChild(tile);
        const videoEl = tile.querySelector('video');

        if (peers[peerId]) {
            peers[peerId].videoEl = videoEl;
        }

        updateGridLayout();
        return videoEl;
    }

    function removeVideoTile(peerId) {
        const tile = document.getElementById(`tile-${peerId}`);
        if (tile) tile.remove();
        if (peers[peerId]) {
            peers[peerId].pc?.close();
            delete peers[peerId];
        }
        updateGridLayout();
    }

    function updateGridLayout() {
        const grid = document.getElementById('video-grid');
        const count = grid.children.length;
        grid.className = 'video-grid';
        if (count <= 1) grid.classList.add('grid-1');
        else if (count === 2) grid.classList.add('grid-2');
        else if (count <= 4) grid.classList.add('grid-4');
        else grid.classList.add('grid-many');

        document.getElementById('participants-count').querySelector('span').textContent = count;
    }

    // ─── Socket Events ───────────────────────────────────────────

    // Existing users when we join
    socket.on('room-users', async ({ participants }) => {
        for (const p of participants) {
            if (p.id === socket.id) continue;
            if (peers[p.id]) continue;

            const pc = createPeerConnection(p.id, p.name);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { to: p.id, offer });
        }
        updateGridLayout();
    });

    // New user joined
    socket.on('user-joined', async ({ userId, userName: peerName }) => {
        showToast(`${peerName} joined the meeting`, 'info');
        // Wait for their offer
    });

    // Receive offer
    socket.on('offer', async ({ from, offer, userName: peerName }) => {
        const pc = createPeerConnection(from, peerName);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { to: from, answer });
    });

    // Receive answer
    socket.on('answer', async ({ from, answer }) => {
        const peer = peers[from];
        if (peer && peer.pc) {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    // ICE candidate
    socket.on('ice-candidate', async ({ from, candidate }) => {
        const peer = peers[from];
        if (peer && peer.pc) {
            try {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error('ICE candidate error:', e);
            }
        }
    });

    // User left
    socket.on('user-left', ({ userId, userName: peerName }) => {
        showToast(`${peerName} left the meeting`, 'info');
        removeVideoTile(userId);
    });

    // Screen share notifications
    socket.on('screen-share-started', ({ userName: peerName }) => {
        showToast(`${peerName} is sharing their screen`, 'info');
    });

    socket.on('screen-share-stopped', ({ userId }) => {
        showToast('Screen sharing stopped', 'info');
    });

    // Recording notifications
    socket.on('recording-started', ({ userName: peerName }) => {
        showToast(`${peerName} started recording`, 'info');
    });

    socket.on('recording-stopped', ({ userName: peerName }) => {
        showToast(`${peerName} stopped recording`, 'info');
    });

    // ─── Controls ─────────────────────────────────────────────────

    // Mic toggle
    document.getElementById('btn-mic').addEventListener('click', () => {
        isMicMuted = !isMicMuted;
        if (localStream) {
            localStream.getAudioTracks().forEach(t => t.enabled = !isMicMuted);
        }
        const btn = document.getElementById('btn-mic');
        btn.classList.toggle('active', isMicMuted);
        btn.querySelector('.tooltip').textContent = isMicMuted ? 'Unmute' : 'Mute';
        document.getElementById('local-mic-status').classList.toggle('muted', isMicMuted);
    });

    // Camera toggle
    document.getElementById('btn-camera').addEventListener('click', () => {
        isCameraOff = !isCameraOff;
        if (localStream) {
            localStream.getVideoTracks().forEach(t => t.enabled = !isCameraOff);
        }
        const btn = document.getElementById('btn-camera');
        btn.classList.toggle('active', isCameraOff);
        btn.querySelector('.tooltip').textContent = isCameraOff ? 'Camera On' : 'Camera Off';
    });

    // Screen Share
    document.getElementById('btn-screen-share').addEventListener('click', async () => {
        if (isScreenSharing) {
            // Stop screen share
            stopScreenShare();
            return;
        }

        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: true
            });

            isScreenSharing = true;
            const btn = document.getElementById('btn-screen-share');
            btn.classList.add('active');
            btn.querySelector('.tooltip').textContent = 'Stop Sharing';
            document.getElementById('btn-annotate').style.display = '';

            // Replace video track in all peer connections
            const screenTrack = screenStream.getVideoTracks()[0];

            for (const peerId in peers) {
                const sender = peers[peerId].pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                }
            }

            // Show screen share in local video
            document.getElementById('local-video').srcObject = screenStream;

            // Handle user stopping share via browser UI
            screenTrack.onended = () => stopScreenShare();

            socket.emit('screen-share-started', { roomId });
            showToast('Screen sharing started', 'success');
        } catch (err) {
            console.error('Screen share error:', err);
            showToast('Could not share screen', 'error');
        }
    });

    function stopScreenShare() {
        if (screenStream) {
            screenStream.getTracks().forEach(t => t.stop());
        }

        isScreenSharing = false;
        const btn = document.getElementById('btn-screen-share');
        btn.classList.remove('active');
        btn.querySelector('.tooltip').textContent = 'Share Screen';
        document.getElementById('btn-annotate').style.display = 'none';

        // Restore camera video track
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            for (const peerId in peers) {
                const sender = peers[peerId].pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender && videoTrack) {
                    sender.replaceTrack(videoTrack);
                }
            }
            document.getElementById('local-video').srcObject = localStream;
        }

        socket.emit('screen-share-stopped', { roomId });
        showToast('Screen sharing stopped', 'info');

        // Close annotations if open
        if (window.annotator && window.annotator.isActive) {
            window.annotator.deactivate();
        }
    }

    // Screen Annotator
    const annotator = new ScreenAnnotator('annotation-canvas', 'annotation-toolbar');
    window.annotator = annotator;

    document.getElementById('btn-annotate').addEventListener('click', () => {
        annotator.toggle();
        document.getElementById('btn-annotate').classList.toggle('active', annotator.isActive);
    });

    // ─── Recording ────────────────────────────────────────────────
    const recorder = new MeetingRecorder();
    let recordingBlob = null;

    document.getElementById('btn-record').addEventListener('click', async () => {
        if (recorder.isRecording) {
            // Stop recording
            recordingBlob = await recorder.stopRecording();
            document.getElementById('btn-record').classList.remove('active');
            document.getElementById('btn-record').querySelector('.tooltip').textContent = 'Record';
            socket.emit('recording-stopped', { roomId });

            if (recordingBlob) {
                // Show save modal
                document.getElementById('modal-save-recording').classList.add('active');
            }
        } else {
            // Start recording
            const videoElements = document.querySelectorAll('#video-grid video');
            const audioStream = localStream;
            const success = await recorder.startRecording(videoElements, audioStream);
            if (success) {
                document.getElementById('btn-record').classList.add('active');
                document.getElementById('btn-record').querySelector('.tooltip').textContent = 'Stop Recording';
                socket.emit('recording-started', { roomId });
                showToast('Recording started', 'success');
            } else {
                showToast('Could not start recording', 'error');
            }
        }
    });

    // Recording save options
    document.getElementById('save-local').addEventListener('click', () => {
        if (recordingBlob) {
            recorder.saveToLocal(recordingBlob);
            showToast('Recording saved to your computer', 'success');
        }
        document.getElementById('modal-save-recording').classList.remove('active');
    });

    document.getElementById('save-youtube').addEventListener('click', async () => {
        if (recordingBlob) {
            await recorder.uploadToYouTube(recordingBlob);
        }
        document.getElementById('modal-save-recording').classList.remove('active');
    });

    document.getElementById('save-drive').addEventListener('click', async () => {
        if (recordingBlob) {
            await recorder.uploadToGoogleDrive(recordingBlob);
        }
        document.getElementById('modal-save-recording').classList.remove('active');
    });

    document.getElementById('modal-close').addEventListener('click', () => {
        document.getElementById('modal-save-recording').classList.remove('active');
    });

    // ─── Side Panels ─────────────────────────────────────────────
    function togglePanel(panelId) {
        const panel = document.getElementById(panelId);
        const isOpen = panel.classList.contains('open');

        // Close all panels first
        document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));

        if (!isOpen) {
            panel.classList.add('open');

            // Resize whiteboard canvas if needed
            if (panelId === 'panel-whiteboard' && window.whiteboard) {
                setTimeout(() => window.whiteboard.resizeCanvas(), 350);
            }
        }

        updateGridLayout();
    }

    document.getElementById('btn-whiteboard').addEventListener('click', () => togglePanel('panel-whiteboard'));
    document.getElementById('btn-textboard').addEventListener('click', () => togglePanel('panel-textboard'));
    document.getElementById('btn-chat').addEventListener('click', () => togglePanel('panel-chat'));

    // Close panel buttons
    document.querySelectorAll('.side-panel-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;
            document.getElementById(panelId).classList.remove('open');
            updateGridLayout();
        });
    });

    // ─── Whiteboard ───────────────────────────────────────────────
    const whiteboard = new Whiteboard('whiteboard-canvas', socket, roomId);
    window.whiteboard = whiteboard;

    // ─── Text Board ───────────────────────────────────────────────
    const textboardEl = document.getElementById('textboard');
    let textboardTimeout = null;

    textboardEl.addEventListener('input', () => {
        clearTimeout(textboardTimeout);
        textboardTimeout = setTimeout(() => {
            socket.emit('textboard-update', { roomId, content: textboardEl.value });
        }, 300);
    });

    socket.on('textboard-update', ({ content }) => {
        const selStart = textboardEl.selectionStart;
        const selEnd = textboardEl.selectionEnd;
        textboardEl.value = content;
        textboardEl.setSelectionRange(selStart, selEnd);
    });

    // ─── Chat ────────────────────────────────────────────────────
    const chatInput = document.getElementById('chat-input');

    function sendChatMessage() {
        const msg = chatInput.value.trim();
        if (!msg) return;
        socket.emit('chat-message', { roomId, message: msg });
        chatInput.value = '';
    }

    document.getElementById('btn-send-chat').addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    socket.on('chat-message', ({ userId, userName: senderName, message, timestamp }) => {
        const messagesEl = document.getElementById('chat-messages');
        const div = document.createElement('div');
        div.className = 'chat-message';
        const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isMe = userId === socket.id;
        div.innerHTML = `
      <span class="sender">${isMe ? 'You' : senderName}</span>
      <span class="text">${escapeHtml(message)}</span>
      <span class="time">${time}</span>
    `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── End Call ─────────────────────────────────────────────────
    document.getElementById('btn-end-call').addEventListener('click', () => {
        if (confirm('Are you sure you want to leave the meeting?')) {
            // Stop all streams
            if (localStream) localStream.getTracks().forEach(t => t.stop());
            if (screenStream) screenStream.getTracks().forEach(t => t.stop());

            // Close all peer connections
            for (const peerId in peers) {
                peers[peerId].pc?.close();
            }

            // Stop recording if active
            if (recorder.isRecording) {
                recorder.stopRecording();
            }

            socket.disconnect();
            window.location.href = '/';
        }
    });

    // ─── Keyboard Shortcuts ──────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key.toLowerCase()) {
            case 'm': document.getElementById('btn-mic').click(); break;
            case 'v': document.getElementById('btn-camera').click(); break;
            case 'r': document.getElementById('btn-record').click(); break;
            case 'w': document.getElementById('btn-whiteboard').click(); break;
            case 't': document.getElementById('btn-textboard').click(); break;
            case 'c': document.getElementById('btn-chat').click(); break;
        }
    });

    // ─── Initialize ──────────────────────────────────────────────
    initMedia();

})();
