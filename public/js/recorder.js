// ─── MeetFlow Recorder Module ───────────────────────────────────
class MeetingRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.startTime = null;
        this.timerInterval = null;
        this.stream = null;
    }

    async startRecording(videoElements, audioStream) {
        try {
            // Combine all video elements into a single canvas for recording
            const canvas = document.createElement('canvas');
            canvas.width = 1920;
            canvas.height = 1080;
            const ctx = canvas.getContext('2d');

            // Create a combined stream
            const canvasStream = canvas.captureStream(30);

            // Add audio tracks
            if (audioStream) {
                audioStream.getAudioTracks().forEach(track => {
                    canvasStream.addTrack(track);
                });
            }

            // Draw loop
            const drawFrame = () => {
                if (!this.isRecording) return;

                ctx.fillStyle = '#0a0a1a';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const videos = Array.from(videoElements).filter(v => v.srcObject || v.src);
                const count = videos.length || 1;
                const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
                const rows = Math.ceil(count / cols);
                const tileW = canvas.width / cols;
                const tileH = canvas.height / rows;

                videos.forEach((video, i) => {
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    const x = col * tileW + 4;
                    const y = row * tileH + 4;
                    try {
                        ctx.drawImage(video, x, y, tileW - 8, tileH - 8);
                    } catch (e) { /* skip */ }
                });

                // Recording indicator on canvas
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(30, 30, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = '14px Inter, sans-serif';
                ctx.fillText('REC', 46, 35);

                requestAnimationFrame(drawFrame);
            };

            this.isRecording = true;
            this.recordedChunks = [];
            this.stream = canvasStream;

            // Determine supported MIME type
            const mimeTypes = [
                'video/webm;codecs=vp9,opus',
                'video/webm;codecs=vp8,opus',
                'video/webm;codecs=vp9',
                'video/webm;codecs=vp8',
                'video/webm'
            ];

            let mimeType = 'video/webm';
            for (const mt of mimeTypes) {
                if (MediaRecorder.isTypeSupported(mt)) {
                    mimeType = mt;
                    break;
                }
            }

            this.mediaRecorder = new MediaRecorder(canvasStream, {
                mimeType,
                videoBitsPerSecond: 3000000
            });

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };

            this.mediaRecorder.start(1000); // chunk every second
            this.startTime = Date.now();
            this.startTimer();
            drawFrame();

            return true;
        } catch (err) {
            console.error('Recording failed:', err);
            return false;
        }
    }

    stopRecording() {
        return new Promise((resolve) => {
            if (!this.mediaRecorder || !this.isRecording) {
                resolve(null);
                return;
            }

            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
                this.isRecording = false;
                this.stopTimer();

                // Stop all tracks
                if (this.stream) {
                    this.stream.getTracks().forEach(t => t.stop());
                }

                resolve(blob);
            };

            this.mediaRecorder.stop();
        });
    }

    startTimer() {
        const indicator = document.getElementById('recording-indicator');
        const timeEl = document.getElementById('recording-time');
        if (indicator) indicator.classList.add('active');

        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.startTime;
            const mins = Math.floor(elapsed / 60000).toString().padStart(2, '0');
            const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
            if (timeEl) timeEl.textContent = `REC ${mins}:${secs}`;
        }, 1000);
    }

    stopTimer() {
        clearInterval(this.timerInterval);
        const indicator = document.getElementById('recording-indicator');
        if (indicator) indicator.classList.remove('active');
    }

    // Save to local file
    saveToLocal(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = `MeetFlow-Recording-${date}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Upload to YouTube (requires OAuth setup)
    async uploadToYouTube(blob) {
        // Check if Google OAuth is configured
        const clientId = ''; // Would come from server config

        if (!clientId) {
            this.showUploadMessage(
                'YouTube Upload',
                'To upload to YouTube, configure your Google Cloud Console credentials in the .env file:\n\n' +
                '1. Go to console.cloud.google.com\n' +
                '2. Create OAuth 2.0 credentials\n' +
                '3. Enable YouTube Data API v3\n' +
                '4. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file'
            );
            return false;
        }

        // YouTube upload flow would go here:
        // 1. OAuth popup for user consent
        // 2. Get access token
        // 3. Upload via YouTube Data API v3
        // 4. Return video URL
        return false;
    }

    // Upload to Google Drive (requires OAuth setup)
    async uploadToGoogleDrive(blob) {
        const clientId = ''; // Would come from server config

        if (!clientId) {
            this.showUploadMessage(
                'Google Drive Upload',
                'To upload to Google Drive, configure your Google Cloud Console credentials in the .env file:\n\n' +
                '1. Go to console.cloud.google.com\n' +
                '2. Create OAuth 2.0 credentials\n' +
                '3. Enable Google Drive API\n' +
                '4. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file'
            );
            return false;
        }

        // Drive upload flow would go here:
        // 1. OAuth popup for user consent
        // 2. Get access token
        // 3. Upload via Google Drive API v3
        // 4. Return file URL
        return false;
    }

    showUploadMessage(title, message) {
        alert(`${title}\n\n${message}`);
    }
}

window.MeetingRecorder = MeetingRecorder;
