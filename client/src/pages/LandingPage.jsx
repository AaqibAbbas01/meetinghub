import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { showToast } from '../utils/toast.js'
import GoogleCalendarButton from '../components/GoogleCalendarButton.jsx'

export default function LandingPage() {
  const navigate = useNavigate()
  const [meetings, setMeetings] = useState([])
  const [userName, setUserName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    host: '',
    date: new Date().toISOString().split('T')[0],
    time: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
    emails: '',
  })
  const [addToGCal, setAddToGCal] = useState(false)

  const loadMeetings = useCallback(async () => {
    try {
      const res = await fetch('/api/meetings')
      const data = await res.json()
      if (data.success) setMeetings(data.meetings.slice(0, 5))
    } catch { /* silently fail */ }
  }, [])

  useEffect(() => {
    loadMeetings()
  }, [loadMeetings])

  // ─── Create Instant Meeting ────────────────────────────────────
  const handleCreateMeeting = async () => {
    const name = userName.trim() || 'Anonymous'
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${name}'s Meeting`, host: name }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Meeting created! Redirecting...', 'success')
        setTimeout(() => {
          navigate(`/meeting?room=${data.meeting.id}&name=${encodeURIComponent(name)}`)
        }, 500)
      }
    } catch {
      showToast('Failed to create meeting', 'error')
    }
  }

  // ─── Join Meeting ──────────────────────────────────────────────
  const handleJoinMeeting = () => {
    const name = userName.trim() || 'Anonymous'
    let code = joinCode.trim()
    if (!code) {
      showToast('Please enter a meeting code', 'error')
      return
    }
    if (code.includes('room=')) {
      try {
        const url = new URL(code, window.location.origin)
        code = url.searchParams.get('room') || code
      } catch { /* use raw code */ }
    }
    showToast('Joining meeting...', 'info')
    setTimeout(() => {
      navigate(`/meeting?room=${code}&name=${encodeURIComponent(name)}`)
    }, 500)
  }

  // ─── Schedule Meeting ──────────────────────────────────────────
  const handleScheduleMeeting = async () => {
    if (!scheduleForm.title) {
      showToast('Please enter a meeting title', 'error')
      return
    }

    const hostName = scheduleForm.host.trim() || 'Anonymous'

    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: scheduleForm.title,
          host: hostName,
          date: scheduleForm.date,
          time: scheduleForm.time,
        }),
      })
      const data = await res.json()

      if (!data.success) {
        showToast('Failed to schedule meeting', 'error')
        return
      }

      showToast(`Meeting "${scheduleForm.title}" scheduled!`, 'success')

      // Send invitations
      const emails = scheduleForm.emails
        .split(',')
        .map(e => e.trim())
        .filter(e => e)

      if (emails.length) {
        const invRes = await fetch('/api/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meetingId: data.meeting.id,
            emails,
            hostName,
          }),
        })
        const invData = await invRes.json()
        if (invData.success) {
          showToast(`Invitations sent to ${emails.length} attendee(s)!`, 'success')
        } else {
          showToast('Meeting created, but failed to send invitations', 'error')
        }
      }

      // Add to Google Calendar if enabled
      if (addToGCal) {
        const startDateTime = new Date(`${scheduleForm.date}T${scheduleForm.time}:00`)
        const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000)

        const formatGCalDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

        const gcalUrl = new URL('https://calendar.google.com/calendar/render')
        gcalUrl.searchParams.set('action', 'TEMPLATE')
        gcalUrl.searchParams.set('text', scheduleForm.title)
        gcalUrl.searchParams.set(
          'dates',
          `${formatGCalDate(startDateTime)}/${formatGCalDate(endDateTime)}`
        )
        gcalUrl.searchParams.set(
          'details',
          `MeetFlow Meeting\n\nJoin here: ${data.meeting.link}\nMeeting Code: ${data.meeting.id}\n\nHosted by ${hostName}`
        )
        if (emails.length) {
          gcalUrl.searchParams.set('add', emails.join(','))
        }
        gcalUrl.searchParams.set('location', data.meeting.link)

        window.open(gcalUrl.toString(), '_blank')
        showToast('Google Calendar event opened!', 'success')
      }

      loadMeetings()
      setScheduleForm(prev => ({ ...prev, title: '', host: '', emails: '' }))
    } catch {
      showToast('Error scheduling meeting', 'error')
    }
  }

  const copyLink = (link) => {
    navigator.clipboard.writeText(link)
    showToast('Meeting link copied!', 'success')
  }

  return (
    <>
      {/* Background */}
      <div className="bg-gradient">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>

      <div className="landing-container">
        {/* Navbar */}
        <nav className="landing-navbar">
          <div className="logo">
            <span className="logo-icon">🎥</span> MeetFlow
          </div>
        </nav>

        {/* Hero */}
        <div className="landing-hero">
          <h1>Video Meetings Reimagined</h1>
          <p className="subtitle">
            Start instant meetings, schedule with Google Calendar, and collaborate with powerful tools.
          </p>
        </div>

        {/* Cards */}
        <div className="cards-grid">
          {/* Instant Meeting */}
          <div className="card" id="card-instant">
            <div className="card-title">
              <span className="icon">⚡</span> New Meeting
            </div>
            <p className="card-desc">
              Start an instant meeting and invite others with a shareable link.
            </p>
            <div className="form-group">
              <label>Your Name</label>
              <input
                type="text"
                className="form-input"
                id="instant-name"
                placeholder="Enter your name"
                value={userName}
                onChange={e => setUserName(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" id="btn-create-meeting" onClick={handleCreateMeeting}>
              🚀 Create Meeting
            </button>
          </div>

          {/* Join Meeting */}
          <div className="card" id="card-join">
            <div className="card-title">
              <span className="icon">🔗</span> Join Meeting
            </div>
            <p className="card-desc">
              Enter a meeting code or link to join an existing session.
            </p>
            <div className="form-group">
              <label>Your Name</label>
              <input
                type="text"
                className="form-input"
                id="join-name"
                placeholder="Enter your name"
                value={userName}
                onChange={e => setUserName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Meeting Code</label>
              <input
                type="text"
                className="form-input"
                id="join-code"
                placeholder="e.g. abc12345"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleJoinMeeting()}
              />
            </div>
            <button className="btn btn-primary" id="btn-join-meeting" onClick={handleJoinMeeting}>
              🤝 Join Meeting
            </button>
          </div>

          {/* Schedule Meeting */}
          <div className="card" id="card-schedule">
            <div className="card-title">
              <span className="icon">📅</span> Schedule Meeting
            </div>
            <p className="card-desc">
              Plan a meeting, send email invitations, and add to Google Calendar.
            </p>

            <div className="form-group">
              <label>Meeting Title</label>
              <input
                type="text"
                className="form-input"
                id="schedule-title"
                placeholder="Team Standup"
                value={scheduleForm.title}
                onChange={e => setScheduleForm(p => ({ ...p, title: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>Your Name</label>
              <input
                type="text"
                className="form-input"
                id="schedule-host"
                placeholder="Your name"
                value={scheduleForm.host}
                onChange={e => setScheduleForm(p => ({ ...p, host: e.target.value }))}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Date</label>
                <input
                  type="date"
                  className="form-input"
                  id="schedule-date"
                  value={scheduleForm.date}
                  onChange={e => setScheduleForm(p => ({ ...p, date: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Time</label>
                <input
                  type="time"
                  className="form-input"
                  id="schedule-time"
                  value={scheduleForm.time}
                  onChange={e => setScheduleForm(p => ({ ...p, time: e.target.value }))}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Attendee Emails (comma separated)</label>
              <input
                type="text"
                className="form-input"
                id="schedule-emails"
                placeholder="alice@email.com, bob@email.com"
                value={scheduleForm.emails}
                onChange={e => setScheduleForm(p => ({ ...p, emails: e.target.value }))}
              />
            </div>

            {/* Google Calendar Toggle */}
            <div className="calendar-section">
              <h4>
                📅 Google Calendar
                <span className="gcal-badge">Integration</span>
              </h4>
              <div className="calendar-toggle">
                <input
                  type="checkbox"
                  className="toggle-switch"
                  id="gcal-toggle"
                  checked={addToGCal}
                  onChange={e => setAddToGCal(e.target.checked)}
                />
                <label htmlFor="gcal-toggle">
                  Add event to Google Calendar when scheduling
                </label>
              </div>
              <GoogleCalendarButton />
            </div>

            <button
              className="btn btn-primary"
              id="btn-schedule-meeting"
              onClick={handleScheduleMeeting}
              style={{ marginTop: '16px' }}
            >
              📨 Schedule & Send Invites
            </button>

            {/* Scheduled meetings list */}
            {meetings.length > 0 && (
              <div className="scheduled-meetings">
                <h4>Upcoming Meetings</h4>
                <div id="meetings-list">
                  {meetings.map(m => (
                    <div className="meeting-item" key={m.id}>
                      <div className="meeting-item-info">
                        <h5>{m.title}</h5>
                        <span>📅 {m.date} • 🕐 {m.time} • Code: {m.id}</span>
                      </div>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => copyLink(m.link)}
                      >
                        Copy Link
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
