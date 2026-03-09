"use client";
import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { io } from "socket.io-client";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const PISTON_LANGUAGES = [
  { label: "JavaScript", value: "javascript", version: "18.15.0" },
  { label: "Python", value: "python", version: "3.10.0" },
  { label: "C++", value: "c++", version: "10.2.0" },
  { label: "Java", value: "java", version: "15.0.2" },
  { label: "Go", value: "go", version: "1.16.2" },
  { label: "Rust", value: "rust", version: "1.50.0" },
  { label: "TypeScript", value: "typescript", version: "5.0.3" },
  { label: "PHP", value: "php", version: "8.2.3" },
];

function showToast(message, type = "info") {
  window.dispatchEvent(new CustomEvent("skillsxai-toast", { detail: { message, type } }));
}

function MeetingPageInner() {
  const router = useRouter();
  const { data: session } = useSession();
  const [searchParams] = useSearchParams ? [useSearchParams()] : [new URLSearchParams()];
  const params = typeof useSearchParams === "function" ? useSearchParams() : new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const roomId = params.get("room");
  const userName = params.get("name") || "Anonymous";

  // Refs
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef({});
  const localVideoRef = useRef(null);
  const videoGridRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const chatInputRef = useRef(null);
  const textboardRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingBlobRef = useRef(null);
  const meetingStartRef = useRef(Date.now());
  const textboardTimeoutRef = useRef(null);
  const codeTimeoutRef = useRef(null);
  const wbCanvasRef = useRef(null);
  const wbCtxRef = useRef(null);
  const wbDrawingRef = useRef(false);
  const wbLastRef = useRef({ x: 0, y: 0 });
  const wbHistoryRef = useRef([]);

  // State
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState("00:00");
  const [meetingTimer, setMeetingTimer] = useState("00:00:00");
  const [participantCount, setParticipantCount] = useState(1);
  const [openPanel, setOpenPanel] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [wbTool, setWbTool] = useState("pen");
  const [wbColor, setWbColor] = useState("#667eea");
  const [wbSize, setWbSize] = useState(3);
  // Compiler state
  const [codeLanguage, setCodeLanguage] = useState("javascript");
  const [codeContent, setCodeContent] = useState("// Write your code here\nconsole.log('Hello, World!');");
  const [codeOutput, setCodeOutput] = useState("");
  const [codeRunning, setCodeRunning] = useState(false);
  // Drive upload
  const [driveUploading, setDriveUploading] = useState(false);
  const [driveFileLink,  setDriveFileLink]  = useState("");

  useEffect(() => { if (!roomId) router.push("/dashboard"); }, [roomId]);

  // Meeting timer
  useEffect(() => {
    const iv = setInterval(() => {
      const e = Date.now() - meetingStartRef.current;
      const h = Math.floor(e / 3600000).toString().padStart(2, "0");
      const m = Math.floor((e % 3600000) / 60000).toString().padStart(2, "0");
      const s = Math.floor((e % 60000) / 1000).toString().padStart(2, "0");
      setMeetingTimer(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Grid layout
  const updateGridLayout = useCallback(() => {
    const grid = videoGridRef.current;
    if (!grid) return;
    const count = grid.children.length;
    grid.className = "video-grid";
    if (count <= 1) grid.classList.add("grid-1");
    else if (count === 2) grid.classList.add("grid-2");
    else if (count <= 4) grid.classList.add("grid-4");
    else grid.classList.add("grid-many");
    setParticipantCount(count);
  }, []);

  const addVideoTile = useCallback((peerId, peerName) => {
    const grid = videoGridRef.current;
    if (!grid) return null;
    const tile = document.createElement("div");
    tile.className = "video-tile";
    tile.id = `tile-${peerId}`;
    tile.innerHTML = `<video autoplay playsinline></video><div class="user-label"><span class="mic-status"></span><span>${peerName || "User"}</span></div>`;
    grid.appendChild(tile);
    updateGridLayout();
    return tile.querySelector("video");
  }, [updateGridLayout]);

  const removeVideoTile = useCallback((peerId) => {
    document.getElementById(`tile-${peerId}`)?.remove();
    const p = peersRef.current[peerId];
    if (p) { p.pc?.close(); delete peersRef.current[peerId]; }
    updateGridLayout();
  }, [updateGridLayout]);

  const createPeerConnection = useCallback((peerId, peerName) => {
    const socket = socketRef.current;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    pc.ontrack = (e) => {
      let vEl = peersRef.current[peerId]?.videoEl;
      if (!vEl) { vEl = addVideoTile(peerId, peerName); if (peersRef.current[peerId]) peersRef.current[peerId].videoEl = vEl; }
      if (vEl) vEl.srcObject = e.streams[0];
    };
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit("ice-candidate", { to: peerId, candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") removeVideoTile(peerId);
    };
    peersRef.current[peerId] = { pc, videoEl: peersRef.current[peerId]?.videoEl || null, userName: peerName };
    return pc;
  }, [addVideoTile, removeVideoTile]);

  // Socket + media init
  useEffect(() => {
    if (!roomId) return;
    const socket = io();
    socketRef.current = socket;

    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        showToast("Camera ready", "success");
      } catch {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          localStreamRef.current = stream;
          setIsCameraOff(true);
          showToast("Audio only mode", "info");
        } catch { showToast("No media devices available", "error"); }
      }
      socket.emit("join-room", { roomId, userName });
    };

    socket.on("room-users", async ({ participants }) => {
      for (const p of participants) {
        if (p.id === socket.id || peersRef.current[p.id]) continue;
        const pc = createPeerConnection(p.id, p.name);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { to: p.id, offer });
      }
      updateGridLayout();
    });

    socket.on("user-joined", ({ userName: n }) => showToast(`${n} joined`, "info"));
    socket.on("offer", async ({ from, offer, userName: n }) => {
      const pc = createPeerConnection(from, n);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { to: from, answer });
    });
    socket.on("answer", async ({ from, answer }) => {
      const p = peersRef.current[from];
      if (p?.pc) await p.pc.setRemoteDescription(new RTCSessionDescription(answer));
    });
    socket.on("ice-candidate", async ({ from, candidate }) => {
      const p = peersRef.current[from];
      if (p?.pc) try { await p.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    });
    socket.on("user-left", ({ userId, userName: n }) => { showToast(`${n} left`, "info"); removeVideoTile(userId); });
    socket.on("chat-message", ({ userId, userName: n, message, timestamp }) => {
      setChatMessages(prev => [...prev, { id: Date.now() + Math.random(), userId, senderName: n, message, timestamp, isMe: userId === socket.id }]);
    });
    socket.on("textboard-update", ({ content }) => {
      if (textboardRef.current) {
        const s = textboardRef.current.selectionStart, e2 = textboardRef.current.selectionEnd;
        textboardRef.current.value = content;
        textboardRef.current.setSelectionRange(s, e2);
      }
    });
    socket.on("whiteboard-draw", ({ data }) => remoteWhiteboardDraw(data));
    socket.on("whiteboard-clear", () => clearWhiteboard(false));
    socket.on("whiteboard-undo", () => undoWhiteboard(false));
    socket.on("code-update", ({ content, language }) => {
      setCodeContent(content);
      if (language) setCodeLanguage(language);
    });

    initMedia();
    return () => {
      socket.disconnect();
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      Object.values(peersRef.current).forEach(p => p.pc?.close());
    };
  }, [roomId, userName, createPeerConnection, removeVideoTile, updateGridLayout]);

  // ─── Whiteboard ─────────────────────────────────────────────
  useEffect(() => {
    if (openPanel !== "whiteboard") return;
    const canvas = wbCanvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
    const ctx = canvas.getContext("2d");
    wbCtxRef.current = ctx;
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [openPanel]);

  const getWbPos = (e) => {
    const r = wbCanvasRef.current.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  };

  const wbStart = (e) => {
    wbDrawingRef.current = true;
    const pos = getWbPos(e);
    wbLastRef.current = pos;
    const ctx = wbCtxRef.current;
    if (!ctx) return;
    // Save state for undo
    wbHistoryRef.current.push(ctx.getImageData(0, 0, wbCanvasRef.current.width, wbCanvasRef.current.height));
    if (wbHistoryRef.current.length > 30) wbHistoryRef.current.shift();
  };

  const wbMove = (e) => {
    e.preventDefault();
    if (!wbDrawingRef.current) return;
    const ctx = wbCtxRef.current;
    if (!ctx) return;
    const pos = getWbPos(e);
    if (wbTool === "eraser") {
      ctx.clearRect(pos.x - wbSize * 2, pos.y - wbSize * 2, wbSize * 4, wbSize * 4);
    } else {
      ctx.beginPath();
      ctx.strokeStyle = wbColor;
      ctx.lineWidth = wbSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(wbLastRef.current.x, wbLastRef.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    const data = { tool: wbTool, color: wbColor, size: wbSize, from: wbLastRef.current, to: pos };
    socketRef.current?.emit("whiteboard-draw", { roomId, data });
    wbLastRef.current = pos;
  };

  const wbEnd = () => { wbDrawingRef.current = false; };

  const remoteWhiteboardDraw = ({ tool, color, size, from, to }) => {
    const ctx = wbCtxRef.current;
    if (!ctx) return;
    if (tool === "eraser") {
      ctx.clearRect(to.x - size * 2, to.y - size * 2, size * 4, size * 4);
    } else {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  };

  const clearWhiteboard = (emit = true) => {
    const ctx = wbCtxRef.current;
    const canvas = wbCanvasRef.current;
    if (ctx && canvas) { ctx.fillStyle = "#1a1a2e"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    if (emit) socketRef.current?.emit("whiteboard-clear", { roomId });
  };

  const undoWhiteboard = (emit = true) => {
    const ctx = wbCtxRef.current;
    const state = wbHistoryRef.current.pop();
    if (ctx && state) ctx.putImageData(state, 0, 0);
    if (emit) socketRef.current?.emit("whiteboard-undo", { roomId });
  };

  // ─── Controls ────────────────────────────────────────────────
  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => (t.enabled = isMicMuted));
    setIsMicMuted(m => !m);
  };

  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => (t.enabled = isCameraOff));
    setIsCameraOff(c => !c);
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      setIsScreenSharing(false);
      const vt = localStreamRef.current?.getVideoTracks()[0];
      Object.values(peersRef.current).forEach(({ pc }) => {
        const s = pc.getSenders().find(s => s.track?.kind === "video");
        if (s && vt) s.replaceTrack(vt);
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      socketRef.current?.emit("screen-share-stopped", { roomId });
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
        screenStreamRef.current = screen;
        setIsScreenSharing(true);
        const st = screen.getVideoTracks()[0];
        Object.values(peersRef.current).forEach(({ pc }) => {
          const s = pc.getSenders().find(s => s.track?.kind === "video");
          if (s) s.replaceTrack(st);
        });
        if (localVideoRef.current) localVideoRef.current.srcObject = screen;
        st.onended = () => { setIsScreenSharing(false); if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current; };
        socketRef.current?.emit("screen-share-started", { roomId });
        showToast("Screen sharing started", "success");
      } catch { showToast("Could not share screen", "error"); }
    }
  };

  // ─── Fixed Recording (full desktop via getDisplayMedia) ──────
  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      // Capture full desktop
      const desktopStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });

      // Mix in microphone audio via AudioContext
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();

      const desktopAudioTracks = desktopStream.getAudioTracks();
      if (desktopAudioTracks.length > 0) {
        audioCtx.createMediaStreamSource(new MediaStream(desktopAudioTracks)).connect(dest);
      }
      const micAudioTracks = localStreamRef.current?.getAudioTracks() || [];
      if (micAudioTracks.length > 0) {
        audioCtx.createMediaStreamSource(new MediaStream(micAudioTracks)).connect(dest);
      }

      // Combine desktop video + mixed audio
      const combinedStream = new MediaStream([
        ...desktopStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);

      const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(t => MediaRecorder.isTypeSupported(t)) || "video/webm";
      const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 5000000 });
      const chunks = [];
      const recStart = Date.now();

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        desktopStream.getTracks().forEach(t => t.stop());
        audioCtx.close();
        recordingBlobRef.current = new Blob(chunks, { type: "video/webm" });
        setIsRecording(false);
        setShowSaveModal(true);
        socketRef.current?.emit("recording-stopped", { roomId });
      };

      const timerIv = setInterval(() => {
        const e = Date.now() - recStart;
        setRecordingTime(`${Math.floor(e / 60000).toString().padStart(2, "0")}:${Math.floor((e % 60000) / 1000).toString().padStart(2, "0")}`);
      }, 1000);

      recorder.addEventListener("stop", () => clearInterval(timerIv));
      recorder.start(1000);
      recorderRef.current = recorder;
      desktopStream.getVideoTracks()[0].onended = () => { if (recorder.state === "recording") recorder.stop(); };
      setIsRecording(true);
      socketRef.current?.emit("recording-started", { roomId });
      showToast("Recording full desktop screen...", "success");
    } catch (err) {
      showToast("Could not start recording: " + (err.message || "Permission denied"), "error");
    }
  };

  const saveLocal = () => {
    const blob = recordingBlobRef.current;
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SkillsXAI-Meet-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Recording saved!", "success");
    }
    setShowSaveModal(false);
  };

  const uploadToDrive = async () => {
    const blob = recordingBlobRef.current;
    if (!blob) return;
    if (!session?.accessToken) {
      showToast("Sign out and sign back in to enable Google Drive uploads", "error");
      return;
    }
    setDriveUploading(true);
    setDriveFileLink("");
    showToast("☁️ Uploading to Google Drive…", "info");
    try {
      const fileName = `SkillsXAI-Meet-${roomId}-${new Date().toISOString().slice(0, 10)}.webm`;
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({ name: fileName, mimeType: "video/webm" })], { type: "application/json" }));
      form.append("file", blob, fileName);
      const res = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
        { method: "POST", headers: { Authorization: `Bearer ${session.accessToken}` }, body: form }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      const file = await res.json();
      const link = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
      setDriveFileLink(link);
      showToast("✅ Uploaded to Google Drive!", "success");
    } catch (e) {
      showToast("Drive upload failed: " + e.message, "error");
    }
    setDriveUploading(false);
  };

  // ─── Chat ─────────────────────────────────────────────────────
  const sendChat = () => {
    const input = chatInputRef.current;
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    socketRef.current?.emit("chat-message", { roomId, message: msg });
    input.value = "";
  };

  // Chat scroll
  useEffect(() => {
    if (chatMessagesRef.current) chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
  }, [chatMessages]);

  // Textboard sync
  const handleTextboardInput = () => {
    clearTimeout(textboardTimeoutRef.current);
    textboardTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("textboard-update", { roomId, content: textboardRef.current?.value || "" });
    }, 300);
  };

  // ─── Code Compiler ────────────────────────────────────────────
  const handleCodeChange = (val) => {
    setCodeContent(val);
    clearTimeout(codeTimeoutRef.current);
    codeTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("code-update", { roomId, content: val, language: codeLanguage });
    }, 400);
  };

  const runCode = async () => {
    setCodeRunning(true);
    setCodeOutput("⏳ Running...");
    try {
      const lang = PISTON_LANGUAGES.find(l => l.value === codeLanguage);
      const res = await fetch("/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: lang?.value, version: lang?.version, code: codeContent }),
      });
      const data = await res.json();
      if (data.run) {
        const out = (data.run.stdout || "") + (data.run.stderr ? `\n⚠️ ${data.run.stderr}` : "");
        setCodeOutput(out || "(no output)");
      } else {
        setCodeOutput(data.error || "Execution failed");
      }
    } catch (e) {
      setCodeOutput("Error: " + e.message);
    }
    setCodeRunning(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "m") toggleMic();
      else if (k === "v") toggleCamera();
      else if (k === "r") toggleRecording();
      else if (k === "w") setOpenPanel(p => p === "whiteboard" ? null : "whiteboard");
      else if (k === "t") setOpenPanel(p => p === "textboard" ? null : "textboard");
      else if (k === "c") setOpenPanel(p => p === "chat" ? null : "chat");
      else if (k === "x") setOpenPanel(p => p === "compiler" ? null : "compiler");
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  const copyLink = () => { navigator.clipboard.writeText(window.location.href); showToast("Meeting link copied!", "success"); };

  const endCall = () => {
    if (!confirm("Are you sure you want to leave the meeting?")) return;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    Object.values(peersRef.current).forEach(p => p.pc?.close());
    if (isRecording) recorderRef.current?.stop();
    socketRef.current?.disconnect();
    router.push("/dashboard");
  };

  if (!roomId) return null;

  return (
    <div className="meeting-container">
      {/* Top Bar */}
      <div className="meeting-topbar">
        <div className="meeting-info">
          <span className="meeting-title">🎥 SkillsXAI Meet</span>
          <span className="meeting-code" title="Click to copy" onClick={copyLink}>{roomId}</span>
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
        <div className="video-grid grid-1" ref={videoGridRef}>
          <div className="video-tile" id="local-video-tile">
            <video ref={localVideoRef} autoPlay muted playsInline></video>
            <div className="user-label">
              <span className={`mic-status ${isMicMuted ? "muted" : ""}`}></span>
              <span>{userName} (You)</span>
            </div>
          </div>
        </div>

        {/* Whiteboard Panel */}
        <div className={`side-panel ${openPanel === "whiteboard" ? "open" : ""}`}>
          <div className="side-panel-header">
            <h3>🎨 Whiteboard</h3>
            <button className="side-panel-close" onClick={() => setOpenPanel(null)}>✕</button>
          </div>
          <div className="whiteboard-toolbar">
            {[["pen","✏️"],["eraser","🧹"]].map(([t,icon]) => (
              <button key={t} className={`tool-btn ${wbTool===t?"active":""}`} onClick={() => setWbTool(t)} title={t}>{icon}</button>
            ))}
            <input type="color" value={wbColor} onChange={e => setWbColor(e.target.value)} title="Color" />
            <input type="range" min="1" max="20" value={wbSize} onChange={e => setWbSize(Number(e.target.value))} title="Size" />
            <button className="tool-btn" onClick={() => undoWhiteboard()} title="Undo">↩️</button>
            <button className="tool-btn" onClick={() => clearWhiteboard()} title="Clear">🗑️</button>
          </div>
          <div className="whiteboard-canvas-container">
            <canvas
              ref={wbCanvasRef}
              onMouseDown={wbStart} onMouseMove={wbMove} onMouseUp={wbEnd} onMouseLeave={wbEnd}
              onTouchStart={wbStart} onTouchMove={wbMove} onTouchEnd={wbEnd}
            />
          </div>
        </div>

        {/* Text Board Panel */}
        <div className={`side-panel ${openPanel === "textboard" ? "open" : ""}`}>
          <div className="side-panel-header">
            <h3>📝 Text Board</h3>
            <button className="side-panel-close" onClick={() => setOpenPanel(null)}>✕</button>
          </div>
          <div className="side-panel-body" style={{ display: "flex" }}>
            <textarea ref={textboardRef} className="textboard-area" placeholder="Start typing... All participants see this in real-time." onInput={handleTextboardInput}></textarea>
          </div>
        </div>

        {/* Chat Panel */}
        <div className={`side-panel ${openPanel === "chat" ? "open" : ""}`}>
          <div className="side-panel-header">
            <h3>💬 Chat</h3>
            <button className="side-panel-close" onClick={() => setOpenPanel(null)}>✕</button>
          </div>
          <div className="side-panel-body" style={{ display: "flex", flexDirection: "column" }}>
            <div className="chat-messages" ref={chatMessagesRef}>
              {chatMessages.map(m => (
                <div className="chat-message" key={m.id}>
                  <span className="sender">{m.isMe ? "You" : m.senderName}</span>
                  <span className="text">{m.message}</span>
                  <span className="time">{new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
            <div className="chat-input-area">
              <input ref={chatInputRef} type="text" placeholder="Type a message..." onKeyDown={e => e.key === "Enter" && sendChat()} />
              <button onClick={sendChat}>Send</button>
            </div>
          </div>
        </div>

        {/* Code Compiler Panel */}
        <div className={`side-panel compiler-panel ${openPanel === "compiler" ? "open" : ""}`}>
          <div className="side-panel-header">
            <h3>💻 Code Compiler</h3>
            <button className="side-panel-close" onClick={() => setOpenPanel(null)}>✕</button>
          </div>
          <div className="compiler-body">
            <div className="compiler-toolbar">
              <select
                className="compiler-lang-select"
                value={codeLanguage}
                onChange={e => {
                  setCodeLanguage(e.target.value);
                  socketRef.current?.emit("code-update", { roomId, content: codeContent, language: e.target.value });
                }}
              >
                {PISTON_LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              <button className="btn btn-primary btn-sm" onClick={runCode} disabled={codeRunning}>
                {codeRunning ? "⏳ Running..." : "▶ Run"}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setCodeContent(""); setCodeOutput(""); }}>🗑 Clear</button>
            </div>
            <textarea
              className="compiler-editor"
              value={codeContent}
              onChange={e => handleCodeChange(e.target.value)}
              spellCheck={false}
              placeholder="// Write your code here..."
            />
            <div className="compiler-output-header">
              <span>Output</span>
              {codeOutput && <button className="btn-clear-output" onClick={() => setCodeOutput("")}>✕</button>}
            </div>
            <pre className="compiler-output">{codeOutput || "// Output will appear here after running"}</pre>
          </div>
        </div>
      </div>

      {/* Control Bar */}
      <div className="control-bar">
        <button className={`btn btn-icon ${isMicMuted ? "active" : ""}`} title={isMicMuted ? "Unmute (M)" : "Mute (M)"} onClick={toggleMic}>
          {isMicMuted ? "🔇" : "🎤"}<span className="tooltip">{isMicMuted ? "Unmute" : "Mute"}</span>
        </button>
        <button className={`btn btn-icon ${isCameraOff ? "active" : ""}`} title="Toggle Camera (V)" onClick={toggleCamera}>
          {isCameraOff ? "📵" : "📹"}<span className="tooltip">{isCameraOff ? "Cam On" : "Cam Off"}</span>
        </button>
        <div className="control-divider"></div>
        <button className={`btn btn-icon ${isScreenSharing ? "active" : ""}`} title="Share Screen" onClick={toggleScreenShare}>
          🖥️<span className="tooltip">{isScreenSharing ? "Stop Sharing" : "Share Screen"}</span>
        </button>
        <div className="control-divider"></div>
        <button className={`btn btn-icon ${isRecording ? "active" : ""}`} title="Record (R)" onClick={toggleRecording}>
          ⏺️<span className="tooltip">{isRecording ? "Stop Rec" : "Record"}</span>
        </button>
        <button className={`btn btn-icon ${openPanel === "whiteboard" ? "active" : ""}`} title="Whiteboard (W)" onClick={() => setOpenPanel(p => p === "whiteboard" ? null : "whiteboard")}>
          🎨<span className="tooltip">Whiteboard</span>
        </button>
        <button className={`btn btn-icon ${openPanel === "textboard" ? "active" : ""}`} title="Text Board (T)" onClick={() => setOpenPanel(p => p === "textboard" ? null : "textboard")}>
          📝<span className="tooltip">Text Board</span>
        </button>
        <button className={`btn btn-icon ${openPanel === "chat" ? "active" : ""}`} title="Chat (C)" onClick={() => setOpenPanel(p => p === "chat" ? null : "chat")}>
          💬<span className="tooltip">Chat</span>
        </button>
        <button className={`btn btn-icon ${openPanel === "compiler" ? "active" : ""}`} title="Code Compiler (X)" onClick={() => setOpenPanel(p => p === "compiler" ? null : "compiler")}>
          💻<span className="tooltip">Compiler</span>
        </button>
        <div className="control-divider"></div>
        <button className="btn btn-icon btn-end-call" title="Leave Meeting" onClick={endCall}>
          📞<span className="tooltip">Leave</span>
        </button>
      </div>

      {/* Save Recording Modal */}
      {showSaveModal && (
        <div className="modal-overlay active">
          <div className="modal">
            <h2>💾 Save Recording</h2>
            <p>Your desktop recording is ready. Choose where to save it:</p>
            <div className="save-options">
              <div className="save-option" onClick={saveLocal}>
                <div className="option-icon">💻</div>
                <div className="option-info">
                  <h4>Download to Computer</h4>
                  <p>Save as a .webm file (full desktop quality)</p>
                </div>
              </div>
              <div
                className={`save-option drive ${driveUploading ? "uploading" : ""} ${driveFileLink ? "done" : ""}`}
                onClick={!driveUploading && !driveFileLink ? uploadToDrive : undefined}
              >
                <div className="option-icon">{driveUploading ? "⏳" : driveFileLink ? "✅" : "☁️"}</div>
                <div className="option-info">
                  <h4>Upload to Google Drive</h4>
                  <p>{driveUploading ? "Uploading… please wait" : driveFileLink ? "Upload complete!" : "Auto-save to your Drive (requires Drive permission)"}</p>
                </div>
              </div>
            </div>
            {driveFileLink && (
              <a href={driveFileLink} target="_blank" rel="noopener noreferrer" className="drive-file-link">
                🔗 Open recording in Google Drive →
              </a>
            )}
            <button className="btn btn-secondary" onClick={() => { setShowSaveModal(false); setDriveFileLink(""); }} style={{ marginTop: 16 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MeetingPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#fff", background: "#1a1a2e" }}>Loading meeting...</div>}>
      <MeetingPageInner />
    </Suspense>
  );
}
