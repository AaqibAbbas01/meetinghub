// ─── MeetFlow Landing Page ──────────────────────────────────────
(function () {
    'use strict';

    // ─── Utility: Toast Notifications ─────────────────────────────
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3600);
    }

    // Set default date/time for schedule
    const dateInput = document.getElementById('schedule-date');
    const timeInput = document.getElementById('schedule-time');
    if (dateInput) {
        const now = new Date();
        dateInput.value = now.toISOString().split('T')[0];
        const hours = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');
        timeInput.value = `${hours}:${mins}`;
    }

    // ─── Create Instant Meeting ───────────────────────────────────
    document.getElementById('btn-create-meeting').addEventListener('click', async () => {
        const name = document.getElementById('instant-name').value.trim() || 'Anonymous';

        try {
            const res = await fetch('/api/meetings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: `${name}'s Meeting`, host: name })
            });
            const data = await res.json();

            if (data.success) {
                showToast('Meeting created! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = `/meeting.html?room=${data.meeting.id}&name=${encodeURIComponent(name)}`;
                }, 500);
            }
        } catch (err) {
            showToast('Failed to create meeting', 'error');
        }
    });

    // ─── Join Meeting ─────────────────────────────────────────────
    document.getElementById('btn-join-meeting').addEventListener('click', () => {
        const name = document.getElementById('join-name').value.trim() || 'Anonymous';
        let code = document.getElementById('join-code').value.trim();

        if (!code) {
            showToast('Please enter a meeting code', 'error');
            return;
        }

        // Extract code from full URL if pasted
        if (code.includes('room=')) {
            const url = new URL(code, window.location.origin);
            code = url.searchParams.get('room') || code;
        }

        showToast('Joining meeting...', 'info');
        setTimeout(() => {
            window.location.href = `/meeting.html?room=${code}&name=${encodeURIComponent(name)}`;
        }, 500);
    });

    // ─── Schedule Meeting ─────────────────────────────────────────
    document.getElementById('btn-schedule-meeting').addEventListener('click', async () => {
        const title = document.getElementById('schedule-title').value.trim();
        const host = document.getElementById('schedule-host').value.trim();
        const date = document.getElementById('schedule-date').value;
        const time = document.getElementById('schedule-time').value;
        const emailsStr = document.getElementById('schedule-emails').value.trim();

        if (!title) {
            showToast('Please enter a meeting title', 'error');
            return;
        }

        try {
            // Create the meeting
            const res = await fetch('/api/meetings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, host: host || 'Anonymous', date, time })
            });
            const data = await res.json();

            if (!data.success) {
                showToast('Failed to schedule meeting', 'error');
                return;
            }

            showToast(`Meeting "${title}" scheduled!`, 'success');

            // Send invitations if emails provided
            if (emailsStr) {
                const emails = emailsStr.split(',').map(e => e.trim()).filter(e => e);
                if (emails.length) {
                    const invRes = await fetch('/api/invite', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            meetingId: data.meeting.id,
                            emails,
                            hostName: host || 'Anonymous'
                        })
                    });
                    const invData = await invRes.json();
                    if (invData.success) {
                        showToast(`Invitations sent to ${emails.length} attendee(s)!`, 'success');
                    } else {
                        showToast('Meeting created, but failed to send invitations', 'error');
                    }
                }
            }

            // Refresh scheduled meetings list
            loadScheduledMeetings();

            // Clear form
            document.getElementById('schedule-title').value = '';
            document.getElementById('schedule-emails').value = '';
        } catch (err) {
            showToast('Error scheduling meeting', 'error');
        }
    });

    // ─── Load and Display Scheduled Meetings ──────────────────────
    async function loadScheduledMeetings() {
        try {
            const res = await fetch('/api/meetings');
            const data = await res.json();

            if (data.success && data.meetings.length > 0) {
                const container = document.getElementById('scheduled-meetings');
                const listEl = document.getElementById('meetings-list');
                container.style.display = 'block';
                listEl.innerHTML = '';

                data.meetings.slice(0, 5).forEach(meeting => {
                    const item = document.createElement('div');
                    item.className = 'meeting-item';
                    item.innerHTML = `
            <div class="meeting-item-info">
              <h5>${meeting.title}</h5>
              <span>📅 ${meeting.date} • 🕐 ${meeting.time} • Code: ${meeting.id}</span>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText('${meeting.link}');this.textContent='Copied!'">Copy Link</button>
          `;
                    listEl.appendChild(item);
                });
            }
        } catch (err) {
            // Silently fail
        }
    }

    // Load scheduled meetings on page load
    loadScheduledMeetings();

    // ─── Enter key triggers join ──────────────────────────────────
    document.getElementById('join-code').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btn-join-meeting').click();
    });
})();
