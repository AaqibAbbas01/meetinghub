// ─── MeetFlow Whiteboard Module ─────────────────────────────────
class Whiteboard {
    constructor(canvasId, socket, roomId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.socket = socket;
        this.roomId = roomId;

        this.isDrawing = false;
        this.tool = 'pen';
        this.color = '#667eea';
        this.lineWidth = 3;
        this.history = [];
        this.currentPath = [];
        this.startPos = null;

        this.resizeCanvas();
        this.setupEvents();
        this.setupSocketEvents();

        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.scale(dpr, dpr);
        this.redraw();
    }

    setupEvents() {
        this.canvas.addEventListener('mousedown', (e) => this.startDraw(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.endDraw());
        this.canvas.addEventListener('mouseleave', () => this.endDraw());

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startDraw(e.touches[0]);
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.draw(e.touches[0]);
        });
        this.canvas.addEventListener('touchend', () => this.endDraw());

        // Toolbar
        document.querySelectorAll('#whiteboard-toolbar .tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#whiteboard-toolbar .tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.tool = btn.dataset.tool;
                this.canvas.style.cursor = this.tool === 'eraser' ? 'cell' : 'crosshair';
            });
        });

        document.getElementById('wb-color').addEventListener('input', (e) => {
            this.color = e.target.value;
        });

        document.getElementById('wb-size').addEventListener('input', (e) => {
            this.lineWidth = parseInt(e.target.value);
        });

        document.getElementById('wb-undo').addEventListener('click', () => this.undo());
        document.getElementById('wb-clear').addEventListener('click', () => this.clearAll());
    }

    setupSocketEvents() {
        if (!this.socket) return;

        this.socket.on('whiteboard-draw', ({ data }) => {
            this.history.push(data);
            this.redraw();
        });

        this.socket.on('whiteboard-clear', () => {
            this.history = [];
            this.redraw();
        });

        this.socket.on('whiteboard-undo', () => {
            this.history.pop();
            this.redraw();
        });
    }

    getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    startDraw(e) {
        this.isDrawing = true;
        const pos = this.getPos(e);
        this.startPos = pos;
        this.currentPath = [pos];

        if (this.tool === 'text') {
            this.isDrawing = false;
            const text = prompt('Enter text:');
            if (text) {
                const stroke = {
                    type: 'text',
                    text,
                    x: pos.x,
                    y: pos.y,
                    color: this.color,
                    size: this.lineWidth * 5
                };
                this.history.push(stroke);
                this.redraw();
                this.broadcastDraw(stroke);
            }
        }
    }

    draw(e) {
        if (!this.isDrawing) return;
        const pos = this.getPos(e);
        this.currentPath.push(pos);

        // Live preview
        this.redraw();
        this.drawStroke({
            type: this.tool,
            points: this.currentPath,
            color: this.tool === 'eraser' ? '#1a1a2e' : this.color,
            lineWidth: this.tool === 'eraser' ? this.lineWidth * 4 : this.lineWidth,
            start: this.startPos,
            end: pos
        });
    }

    endDraw() {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        if (this.currentPath.length > 0) {
            const stroke = {
                type: this.tool,
                points: [...this.currentPath],
                color: this.tool === 'eraser' ? '#1a1a2e' : this.color,
                lineWidth: this.tool === 'eraser' ? this.lineWidth * 4 : this.lineWidth,
                start: this.startPos,
                end: this.currentPath[this.currentPath.length - 1]
            };
            this.history.push(stroke);
            this.broadcastDraw(stroke);
        }
        this.currentPath = [];
    }

    drawStroke(stroke) {
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = stroke.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        switch (stroke.type) {
            case 'pen':
            case 'eraser':
                if (stroke.points.length < 2) break;
                ctx.beginPath();
                ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                for (let i = 1; i < stroke.points.length; i++) {
                    const cp = {
                        x: (stroke.points[i - 1].x + stroke.points[i].x) / 2,
                        y: (stroke.points[i - 1].y + stroke.points[i].y) / 2
                    };
                    ctx.quadraticCurveTo(stroke.points[i - 1].x, stroke.points[i - 1].y, cp.x, cp.y);
                }
                ctx.stroke();
                break;

            case 'line':
                if (stroke.start && stroke.end) {
                    ctx.beginPath();
                    ctx.moveTo(stroke.start.x, stroke.start.y);
                    ctx.lineTo(stroke.end.x, stroke.end.y);
                    ctx.stroke();
                }
                break;

            case 'rect':
                if (stroke.start && stroke.end) {
                    ctx.strokeRect(
                        stroke.start.x, stroke.start.y,
                        stroke.end.x - stroke.start.x,
                        stroke.end.y - stroke.start.y
                    );
                }
                break;

            case 'circle':
                if (stroke.start && stroke.end) {
                    const rx = Math.abs(stroke.end.x - stroke.start.x) / 2;
                    const ry = Math.abs(stroke.end.y - stroke.start.y) / 2;
                    const cx = stroke.start.x + (stroke.end.x - stroke.start.x) / 2;
                    const cy = stroke.start.y + (stroke.end.y - stroke.start.y) / 2;
                    ctx.beginPath();
                    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
                break;

            case 'text':
                ctx.font = `${stroke.size || 16}px Inter, sans-serif`;
                ctx.fillText(stroke.text, stroke.x, stroke.y);
                break;
        }
        ctx.restore();
    }

    redraw() {
        const dpr = window.devicePixelRatio || 1;
        this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
        // Fill background
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

        this.history.forEach(stroke => this.drawStroke(stroke));
    }

    undo() {
        if (this.history.length === 0) return;
        this.history.pop();
        this.redraw();
        if (this.socket) {
            this.socket.emit('whiteboard-undo', { roomId: this.roomId });
        }
    }

    clearAll() {
        this.history = [];
        this.redraw();
        if (this.socket) {
            this.socket.emit('whiteboard-clear', { roomId: this.roomId });
        }
    }

    broadcastDraw(stroke) {
        if (this.socket) {
            this.socket.emit('whiteboard-draw', { roomId: this.roomId, data: stroke });
        }
    }
}

// Export
window.Whiteboard = Whiteboard;
