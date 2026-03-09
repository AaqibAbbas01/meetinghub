// ─── MeetFlow Screen Annotator Module ───────────────────────────
class ScreenAnnotator {
    constructor(canvasId, toolbarId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.toolbar = document.getElementById(toolbarId);
        this.overlay = document.getElementById('annotation-overlay');

        this.isActive = false;
        this.isDrawing = false;
        this.tool = 'pen';
        this.color = '#ef4444';
        this.lineWidth = 4;
        this.strokes = [];
        this.currentPath = [];
        this.startPos = null;

        this.setupEvents();
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

        // Toolbar buttons
        document.querySelectorAll('[data-ann-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-ann-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.tool = btn.dataset.annTool;
            });
        });

        document.getElementById('ann-color').addEventListener('input', (e) => {
            this.color = e.target.value;
        });

        document.getElementById('ann-size').addEventListener('input', (e) => {
            this.lineWidth = parseInt(e.target.value);
        });

        document.getElementById('ann-clear').addEventListener('click', () => this.clearAll());
        document.getElementById('ann-close').addEventListener('click', () => this.deactivate());
    }

    activate() {
        this.isActive = true;
        this.resizeCanvas();
        this.overlay.classList.add('active');
        this.toolbar.classList.add('active');
    }

    deactivate() {
        this.isActive = false;
        this.overlay.classList.remove('active');
        this.toolbar.classList.remove('active');
        this.clearAll();
    }

    toggle() {
        if (this.isActive) {
            this.deactivate();
        } else {
            this.activate();
        }
    }

    resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        this.ctx.scale(dpr, dpr);
        this.redraw();
    }

    getPos(e) {
        return { x: e.clientX, y: e.clientY };
    }

    startDraw(e) {
        this.isDrawing = true;
        const pos = this.getPos(e);
        this.startPos = pos;
        this.currentPath = [pos];

        if (this.tool === 'text') {
            this.isDrawing = false;
            const text = prompt('Enter annotation text:');
            if (text) {
                const stroke = {
                    type: 'text',
                    text, x: pos.x, y: pos.y,
                    color: this.color,
                    size: this.lineWidth * 4
                };
                this.strokes.push(stroke);
                this.redraw();
            }
        }
    }

    draw(e) {
        if (!this.isDrawing) return;
        const pos = this.getPos(e);
        this.currentPath.push(pos);

        this.redraw();
        this.drawStroke({
            type: this.tool,
            points: this.currentPath,
            color: this.color,
            lineWidth: this.tool === 'highlighter' ? this.lineWidth * 4 : this.lineWidth,
            alpha: this.tool === 'highlighter' ? 0.3 : 1,
            start: this.startPos,
            end: pos
        });
    }

    endDraw() {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        if (this.currentPath.length > 0) {
            this.strokes.push({
                type: this.tool,
                points: [...this.currentPath],
                color: this.color,
                lineWidth: this.tool === 'highlighter' ? this.lineWidth * 4 : this.lineWidth,
                alpha: this.tool === 'highlighter' ? 0.3 : 1,
                start: this.startPos,
                end: this.currentPath[this.currentPath.length - 1]
            });
        }
        this.currentPath = [];
    }

    drawStroke(stroke) {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = stroke.alpha || 1;
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = stroke.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        switch (stroke.type) {
            case 'pen':
            case 'highlighter':
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

            case 'arrow':
                if (stroke.start && stroke.end) {
                    const dx = stroke.end.x - stroke.start.x;
                    const dy = stroke.end.y - stroke.start.y;
                    const angle = Math.atan2(dy, dx);
                    const headLen = 20;

                    ctx.beginPath();
                    ctx.moveTo(stroke.start.x, stroke.start.y);
                    ctx.lineTo(stroke.end.x, stroke.end.y);
                    ctx.stroke();

                    // Arrowhead
                    ctx.beginPath();
                    ctx.moveTo(stroke.end.x, stroke.end.y);
                    ctx.lineTo(
                        stroke.end.x - headLen * Math.cos(angle - Math.PI / 6),
                        stroke.end.y - headLen * Math.sin(angle - Math.PI / 6)
                    );
                    ctx.moveTo(stroke.end.x, stroke.end.y);
                    ctx.lineTo(
                        stroke.end.x - headLen * Math.cos(angle + Math.PI / 6),
                        stroke.end.y - headLen * Math.sin(angle + Math.PI / 6)
                    );
                    ctx.stroke();
                }
                break;

            case 'eraser':
                if (stroke.points.length < 2) break;
                ctx.globalCompositeOperation = 'destination-out';
                ctx.lineWidth = stroke.lineWidth * 4;
                ctx.beginPath();
                ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                for (let i = 1; i < stroke.points.length; i++) {
                    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
                }
                ctx.stroke();
                ctx.globalCompositeOperation = 'source-over';
                break;

            case 'text':
                ctx.font = `bold ${stroke.size || 16}px Inter, sans-serif`;
                ctx.fillText(stroke.text, stroke.x, stroke.y);
                break;
        }
        ctx.restore();
    }

    redraw() {
        const dpr = window.devicePixelRatio || 1;
        this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
        this.strokes.forEach(s => this.drawStroke(s));
    }

    clearAll() {
        this.strokes = [];
        this.redraw();
    }
}

window.ScreenAnnotator = ScreenAnnotator;
