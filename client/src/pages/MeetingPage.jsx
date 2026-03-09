import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import { showToast } from '../utils/toast.js'

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

export default function MeetingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const roomId = searchParams.get('room')
  const userName = searchParams.get('name') || 'Anonymous'

  // Refs
  const socketRef = useRef(null)
  const localStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const peersRef = useRef({})
  const localVideoRef = useRef(null)
  const videoGridRef = useRef(null)
  const chatMessagesRef = useRef(null)
  const chatInputRef = useRef(null)
  const textboardRef = useRef(null)
  const recorderRef = useRef(null)
  const recordingBlobRef = useRef(null)
  const meetingStartRef = useRef(Date.now())
  const textboardTimeoutRef = useRef(null)

  // State
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState('00:00')
  const [meetingTimer, setMeetingTimer] = useState('00:00:00')
  const [participantCount, setParticipantCount] = useState(1)
  const [openPanel, setOpenPanel] = useState(null)
  const [showAnnotation, setShowAnnotation] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [chatMessages, setChatMessages] = useState([])

  // Redirect if no room
  useEffect(() => {
    if (!roomId) navigate('/')
  }, [roomId, navigate])

  // Meeting timer
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - meetingStartRef.current
      const hrs = Math.floor(elapsed / 3600000).toString().padStart(2, '0')
      const mins = Math.floor((elapsed % 3600000) / 60000).toString().padStart(2, '0')
      const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0')
      setMeetingTimer(`${hrs}:${mins}:${secs}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Update grid layout
  const updateGridLayout = useCallback(() => {
    const grid = videoGridRef.current
    if (!grid) return
    const count = grid.children.length
    grid.className = 'video-grid'
    if (count <= 1) grid.classList.add('grid-1')
    else if (count === 2) grid.classList.add('grid-2')
    else if (count <= 4) grid.classList.add('grid-4')
    else grid.classList.add('grid-many')
    setParticipantCount(count)
  }, [])

  // Add video tile
  const addVideoTile = useCallback((peerId, peerName) => {
    const grid = videoGridRef.current
    if (!grid) return null
    const tile = document.createElement('div')
    tile.className = 'video-tile'
    tile.id = `tile-${peerId}`
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="user-label">
        <span class="mic-status"></span>
        <span>${peerName || 'User'}</span>
      </div>
    `
    grid.appendChild(tile)
    const videoEl = tile.querySelector('video')
    updateGridLayout()
    return videoEl
  }, [updateGridLayout])

  // Remove video tile
  const removeVideoTile = useCallback((peerId) => {
    const tile = document.getElementById(`tile-${peerId}`)
    if (tile) tile.remove()
    const peers = peersRef.current
    if (peers[peerId]) {
      peers[peerId].pc?.close()
      delete peers[peerId]
    }
    updateGridLayout()
  }, [updateGridLayout])

  // Create peer connection
  const createPeerConnection = useCallback((peerId, peerName) => {
    const socket = socketRef.current
    const localStream = localStreamRef.current
    const peers = peersRef.current

    const pc = new RTCPeerConnection(RTC_CONFIG)

    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream))
    }

    pc.ontrack = (event) => {
      let videoEl = peers[peerId]?.videoEl
      if (!videoEl) {
        videoEl = addVideoTile(peerId, peerName)
        if (peers[peerId]) peers[peerId].videoEl = videoEl
      }
      if (videoEl) videoEl.srcObject = event.streams[0]
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { to: peerId, candidate: event.candidate })
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        removeVideoTile(peerId)
      }
    }

    peers[peerId] = { pc, videoEl: peers[peerId]?.videoEl || null, userName: peerName }
    return pc
  }, [addVideoTile, removeVideoTile])

  // Initialize media and socket
  useEffect(() => {
    if (!roomId) return

    const socket = io()
    socketRef.current = socket

    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        localStreamRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
        showToast('Camera and microphone ready', 'success')
      } catch {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          localStreamRef.current = stream
          setIsCameraOff(true)
          showToast('Audio only mode', 'info')
        } catch {
          showToast('No media devices available', 'error')
        }
      }

      socket.emit('join-room', { roomId, userName })
    }

    // Socket events
    socket.on('room-users', async ({ participants }) => {
      const peers = peersRef.current
      for (const p of participants) {
        if (p.id === socket.id) continue
        if (peers[p.id]) continue
        const pc = createPeerConnection(p.id, p.name)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socket.emit('offer', { to: p.id, offer })
      }
      updateGridLayout()
    })

    socket.on('user-joined', ({ userName: peerName }) => {
      showToast(`${peerName} joined the meeting`, 'info')
    })

    socket.on('offer', async ({ from, offer, userName: peerName }) => {
      const pc = createPeerConnection(from, peerName)
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('answer', { to: from, answer })
    })

    socket.on('answer', async ({ from, answer }) => {
      const peer = peersRef.current[from]
      if (peer?.pc) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer))
      }
    })

    socket.on('ice-candidate', async ({ from, candidate }) => {
      const peer = peersRef.current[from]
      if (peer?.pc) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate))
        } catch { /* ignore */ }
      }
    })

    socket.on('user-left', ({ userId, userName: peerName }) => {
      showToast(`${peerName} left the meeting`, 'info')
      removeVideoTile(userId)
    })

    socket.on('screen-share-started', ({ userName: peerName }) => {
      showToast(`${peerName} is sharing their screen`, 'info')
    })

    socket.on('screen-share-stopped', () => {
      showToast('Screen sharing stopped', 'info')
    })

    socket.on('recording-started', ({ userName: peerName }) => {
      showToast(`${peerName} started recording`, 'info')
    })

    socket.on('recording-stopped', ({ userName: peerName }) => {
      showToast(`${peerName} stopped recording`, 'info')
    })

    socket.on('chat-message', ({ userId, userName: senderName, message, timestamp }) => {
      setChatMessages(prev => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          userId,
          senderName,
          message,
          timestamp,
          isMe: userId === socket.id,
        },
      ])
    })

    socket.on('textboard-update', ({ content }) => {
      if (textboardRef.current) {
        const start = textboardRef.current.selectionStart
        const end = textboardRef.current.selectionEnd
        textboardRef.current.value = content
        textboardRef.current.setSelectionRange(start, end)
      }
    })

    socket.on('whiteboard-draw', ({ data }) => {
      window.dispatchEvent(new CustomEvent('wb-remote-draw', { detail: data }))
    })

    socket.on('whiteboard-clear', () => {
      window.dispatchEvent(new CustomEvent('wb-remote-clear'))
    })

    socket.on('whiteboard-undo', () => {
      window.dispatchEvent(new CustomEvent('wb-remote-undo'))
    })

    initMedia()

    return () => {
      socket.disconnect()
      const localStream = localStreamRef.current
      if (localStream) localStream.getTracks().forEach(t => t.stop())
      const screen = screenStreamRef.current
      if (screen) screen.getTracks().forEach(t => t.stop())
      Object.values(peersRef.current).forEach(p => p.pc?.close())
    }
  }, [roomId, userName, createPeerConnection, removeVideoTile, updateGridLayout])

  // ─── Handlers ──────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current
    if (stream) {
      stream.getAudioTracks().forEach(t => (t.enabled = isMicMuted))
    }
    setIsMicMuted(!isMicMuted)
  }, [isMicMuted])

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current
    if (stream) {
      stream.getVideoTracks().forEach(t => (t.enabled = isCameraOff))
    }
    setIsCameraOff(!isCameraOff)
  }, [isCameraOff])

  const toggleScreenShare = async () => {
    const socket = socketRef.current
    if (isScreenSharing) {
      const screen = screenStreamRef.current
      if (screen) screen.getTracks().forEach(t => t.stop())
      setIsScreenSharing(false)
      setShowAnnotation(false)

      const localStream = localStreamRef.current
      if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0]
        Object.values(peersRef.current).forEach(({ pc }) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender && videoTrack) sender.replaceTrack(videoTrack)
        })
        if (localVideoRef.current) localVideoRef.current.srcObject = localStream
      }
      socket.emit('screen-share-stopped', { roomId })
      showToast('Screen sharing stopped', 'info')
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: true,
        })
        screenStreamRef.current = screen
        setIsScreenSharing(true)

        const screenTrack = screen.getVideoTracks()[0]
        Object.values(peersRef.current).forEach(({ pc }) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender) sender.replaceTrack(screenTrack)
        })

        if (localVideoRef.current) localVideoRef.current.srcObject = screen

        screenTrack.onended = () => {
          setIsScreenSharing(false)
          setShowAnnotation(false)
          const localStream = localStreamRef.current
          if (localStream) {
            const vt = localStream.getVideoTracks()[0]
            Object.values(peersRef.current).forEach(({ pc }) => {
              const sender = pc.getSenders().find(s => s.track?.kind === 'video')
              if (sender && vt) sender.replaceTrack(vt)
            })
            if (localVideoRef.current) localVideoRef.current.srcObject = localStream
          }
          socket.emit('screen-share-stopped', { roomId })
          showToast('Screen sharing stopped', 'info')
        }

        socket.emit('screen-share-started', { roomId })
        showToast('Screen sharing started', 'success')
      } catch {
        showToast('Could not share screen', 'error')
      }
    }
  }

  const toggleRecording = async () => {
    const socket = socketRef.current
    if (isRecording) {
      const recorder = recorderRef.current
      if (recorder) recorder.stop()
    } else {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 1920
        canvas.height = 1080
        const ctx = canvas.getContext('2d')
        const canvasStream = canvas.captureStream(30)

        const localStream = localStreamRef.current
        if (localStream) {
          localStream.getAudioTracks().forEach(t => canvasStream.addTrack(t))
        }

        const chunks = []
        let recording = true
        const recordingStart = Date.now()

        const drawFrame = () => {
          if (!recording) return
          ctx.fillStyle = '#0a0a1a'
          ctx.fillRect(0, 0, canvas.width, canvas.height)

          const videos = videoGridRef.current?.querySelectorAll('video') || []
          const count = videos.length || 1
          const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3
          const rows = Math.ceil(count / cols)
          const tileW = canvas.width / cols
          const tileH = canvas.height / rows

          videos.forEach((video, i) => {
            const col = i % cols
            const row = Math.floor(i / cols)
            try {
              ctx.drawImage(video, col * tileW + 4, row * tileH + 4, tileW - 8, tileH - 8)
            } catch { /* skip */ }
          })

          ctx.fillStyle = '#ef4444'
          ctx.beginPath()
          ctx.arc(30, 30, 8, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.font = '14px Inter, sans-serif'
          ctx.fillText('REC', 46, 35)

          requestAnimationFrame(drawFrame)
        }

        const mimeTypes = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ]
        let mimeType = 'video/webm'
        for (const mt of mimeTypes) {
          if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break }
        }

        const recorder = new MediaRecorder(canvasStream, {
          mimeType,
          videoBitsPerSecond: 3000000,
        })

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data)
        }

        recorder.onstop = () => {
          recording = false
          const blob = new Blob(chunks, { type: 'video/webm' })
          recordingBlobRef.current = blob
          setIsRecording(false)
          setShowSaveModal(true)
          canvasStream.getTracks().forEach(t => t.stop())
        }

        recorder.start(1000)
        recorderRef.current = recorder
        setIsRecording(true)
        drawFrame()

        const timerInterval = setInterval(() => {
          if (!recording) { clearInterval(timerInterval); return }
          const elapsed = Date.now() - recordingStart
          const mins = Math.floor(elapsed / 60000).toString().padStart(2, '0')
          const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0')
          setRecordingTime(`${mins}:${secs}`)
        }, 1000)

        socket.emit('recording-started', { roomId })
        showToast('Recording started', 'success')
      } catch {
        showToast('Could not start recording', 'error')
      }
    }
  }

  const saveLocal = () => {
    const blob = recordingBlobRef.current
    if (blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `MeetFlow-Recording-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.webm`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('Recording saved to your computer', 'success')
    }
    setShowSaveModal(false)
  }

  const togglePanel = useCallback((panelId) => {
    setOpenPanel(prev => (prev === panelId ? null : panelId))
  }, [])

  const sendChat = useCallback(() => {
    const input = chatInputRef.current
    if (!input) return
    const msg = input.value.trim()
    if (!msg) return
    socketRef.current?.emit('chat-message', { roomId, message: msg })
    input.value = ''
  }, [roomId])

  const handleTextboardInput = useCallback(() => {
    clearTimeout(textboardTimeoutRef.current)
    textboardTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit('textboard-update', {
        roomId,
        content: textboardRef.current?.value || '',
      })
    }, 300)
  }, [roomId])

  const copyMeetingCode = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
    showToast('Meeting link copied!', 'success')
  }, [])

  const endCall = () => {
    if (confirm('Are you sure you want to leave the meeting?')) {
      const localStream = localStreamRef.current
      if (localStream) localStream.getTracks().forEach(t => t.stop())
      const screen = screenStreamRef.current
      if (screen) screen.getTracks().forEach(t => t.stop())
      Object.values(peersRef.current).forEach(p => p.pc?.close())
      if (isRecording && recorderRef.current) recorderRef.current.stop()
      socketRef.current?.disconnect()
      navigate('/')
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      switch (e.key.toLowerCase()) {
        case 'm': toggleMic(); break
        case 'v': toggleCamera(); break
        case 'r': toggleRecording(); break
        case 'w': togglePanel('whiteboard'); break
        case 't': togglePanel('textboard'); break
        case 'c': togglePanel('chat'); break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggleMic, toggleCamera, toggleRecording, togglePanel])

  // Scroll chat to bottom
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
    }
  }, [chatMessages])

  // No need for escapeHtml — React auto-escapes text content

  if (!roomId) return null

  return (
    <div className="meeting-container">
      {/* Top Bar */}
      <div className="meeting-topbar">
        <div className="meeting-info">
          <span className="meeting-title">🎥 MeetFlow</span>
          <span
            className="meeting-code"
            id="meeting-code"
            title="Click to copy"
            onClick={copyMeetingCode}
          >
            {roomId}
          </span>
          {isRecording && (
            <div className="recording-indicator active">
              <span className="recording-dot"></span>
              <span>REC {recordingTime}</span>
            </div>
          )}
        </div>
        <div className="topbar-right">
          <div className="participants-count">👥 <span>{participantCount}</span></div>
          <div className="meeting-timer">{meetingTimer}</div>
        </div>
      </div>

      {/* Main Area */}
      <div className="meeting-main">
        {/* Video Grid */}
        <div className="video-grid grid-1" id="video-grid" ref={videoGridRef}>
          <div className="video-tile" id="local-video-tile">
            <video ref={localVideoRef} autoPlay muted playsInline></video>
            <div className="user-label">
              <span className={`mic-status ${isMicMuted ? 'muted' : ''}`}></span>
              <span>{userName} (You)</span>
            </div>
          </div>
        </div>

        {/* Whiteboard Panel */}
        <div className={`side-panel ${openPanel === 'whiteboard' ? 'open' : ''}`}>
          <div className="side-panel-header">
            <h3>🎨 Whiteboard</h3>
            <button className="side-panel-close" onClick={() => setOpenPanel(null)}>✕</button>
          </div>
          <div className="whiteboard-toolbar">
            <button className="tool-btn active" data-tool="pen" title="Pen">✏️</button>
            <button className="tool-btn" data-tool="line" title="Line">📏</button>
            <button className="tool-btn" data-tool="rect" title="Rectangle">▭</button>
            <button className="tool-btn" data-tool="circle" title="Circle">○</button>
            <button className="tool-btn" data-tool="text" title="Text">T</button>
            <button className="tool-btn" data-tool="eraser" title="Eraser">🧹</button>
            <div style={{width:1,height:24,background:'var(--border-glass)',margin:'0 4px'}}></div>
            <input type="color" id="wb-color" defaultValue="#667eea" title="Color" />
            <input type="range" id="wb-size" min="1" max="20" defaultValue="3" title="Brush Size" />
            <button className="tool-btn" id="wb-undo" title="Undo">↩️</button>
            <button className="tool-btn" id="wb-clear" title="Clear All">🗑️</button>
          </div>
          <div className="whiteboard-canvas-container">
            <canvas id="whiteboard-canvas"></canvas>
          </div>
        </div>

        {/* Text Board Panel */}
        <div className={`side-panel ${openPanel === 'textboard' ? 'open' : ''}`}>
          <div className="side-panel-header">
            <h3>📝 Text Board</h3>
            <button className="side-panel-close" onClick={() => setOpenPanel(null)}>✕</button>
          </div>
          <div className="side-panel-body" style={{display:'flex'}}>
            <textarea
              className="textboard-area"
              ref={textboardRef}
              placeholder="Start typing... All participants can see and edit this in real-time."
              onInput={handleTextboardInput}
            ></textarea>
          </div>
        </div>

        {/* Chat Panel */}
        <div className={`side-panel ${openPanel === 'chat' ? 'open' : ''}`}>
          <div className="side-panel-header">
            <h3>💬 Chat</h3>
            <button className="side-panel-close" onClick={() => setOpenPanel(null)}>✕</button>
          </div>
          <div className="side-panel-body" style={{display:'flex',flexDirection:'column'}}>
            <div className="chat-messages" ref={chatMessagesRef}>
              {chatMessages.map(m => (
                <div className="chat-message" key={m.id}>
                  <span className="sender">{m.isMe ? 'You' : m.senderName}</span>
                  <span className="text">{m.message}</span>
                  <span className="time">
                    {new Date(m.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
            <div className="chat-input-area">
              <input
                type="text"
                ref={chatInputRef}
                placeholder="Type a message..."
                onKeyDown={e => e.key === 'Enter' && sendChat()}
              />
              <button onClick={sendChat}>Send</button>
            </div>
          </div>
        </div>
      </div>

      {/* Annotation Overlay */}
      <div
        className={`annotation-overlay ${showAnnotation ? 'active' : ''}`}
        id="annotation-overlay"
      >
        <canvas id="annotation-canvas"></canvas>
      </div>

      {/* Control Bar */}
      <div className="control-bar">
        <button
          className={`btn btn-icon ${isMicMuted ? 'active' : ''}`}
          id="btn-mic"
          title="Toggle Microphone"
          onClick={toggleMic}
        >
          🎤
          <span className="tooltip">{isMicMuted ? 'Unmute' : 'Mute'}</span>
        </button>
        <button
          className={`btn btn-icon ${isCameraOff ? 'active' : ''}`}
          id="btn-camera"
          title="Toggle Camera"
          onClick={toggleCamera}
        >
          📹
          <span className="tooltip">{isCameraOff ? 'Camera On' : 'Camera Off'}</span>
        </button>

        <div className="control-divider"></div>

        <button
          className={`btn btn-icon ${isScreenSharing ? 'active' : ''}`}
          id="btn-screen-share"
          title="Share Screen"
          onClick={toggleScreenShare}
        >
          🖥️
          <span className="tooltip">{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</span>
        </button>

        {isScreenSharing && (
          <button
            className={`btn btn-icon ${showAnnotation ? 'active' : ''}`}
            id="btn-annotate"
            title="Screen Marker"
            onClick={() => setShowAnnotation(!showAnnotation)}
          >
            🖊️
            <span className="tooltip">Annotate</span>
          </button>
        )}

        <div className="control-divider"></div>

        <button
          className={`btn btn-icon ${isRecording ? 'active' : ''}`}
          id="btn-record"
          title="Record Meeting"
          onClick={toggleRecording}
        >
          ⏺️
          <span className="tooltip">{isRecording ? 'Stop Recording' : 'Record'}</span>
        </button>
        <button
          className={`btn btn-icon ${openPanel === 'whiteboard' ? 'active' : ''}`}
          id="btn-whiteboard"
          title="Whiteboard"
          onClick={() => togglePanel('whiteboard')}
        >
          🎨
          <span className="tooltip">Whiteboard</span>
        </button>
        <button
          className={`btn btn-icon ${openPanel === 'textboard' ? 'active' : ''}`}
          id="btn-textboard"
          title="Text Board"
          onClick={() => togglePanel('textboard')}
        >
          📝
          <span className="tooltip">Text Board</span>
        </button>
        <button
          className={`btn btn-icon ${openPanel === 'chat' ? 'active' : ''}`}
          id="btn-chat"
          title="Chat"
          onClick={() => togglePanel('chat')}
        >
          💬
          <span className="tooltip">Chat</span>
        </button>

        <div className="control-divider"></div>

        <button
          className="btn btn-icon btn-end-call"
          id="btn-end-call"
          title="Leave Meeting"
          onClick={endCall}
        >
          📞
          <span className="tooltip">Leave</span>
        </button>
      </div>

      {/* Recording Save Modal */}
      {showSaveModal && (
        <div className="modal-overlay active">
          <div className="modal">
            <h2>💾 Save Recording</h2>
            <p>Your meeting has been recorded. Choose where to save it:</p>
            <div className="save-options">
              <div className="save-option" onClick={saveLocal}>
                <div className="option-icon">💻</div>
                <div className="option-info">
                  <h4>Save to Computer</h4>
                  <p>Download the recording as a WebM file</p>
                </div>
              </div>
              <div className="save-option" onClick={() => {
                showToast('Configure Google OAuth in .env for YouTube upload', 'info')
                setShowSaveModal(false)
              }}>
                <div className="option-icon">📺</div>
                <div className="option-info">
                  <h4>Upload to YouTube</h4>
                  <p>Upload directly to your YouTube channel</p>
                </div>
              </div>
              <div className="save-option" onClick={() => {
                showToast('Configure Google OAuth in .env for Drive upload', 'info')
                setShowSaveModal(false)
              }}>
                <div className="option-icon">📁</div>
                <div className="option-info">
                  <h4>Upload to Google Drive</h4>
                  <p>Save to your Google Drive storage</p>
                </div>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => setShowSaveModal(false)}
              style={{ marginTop: 16 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
