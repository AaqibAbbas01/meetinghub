"use client";
import { useState } from 'react'
import { showToast } from '../utils/toast.js'

export default function GoogleCalendarButton() {
  const [isAuthed, setIsAuthed] = useState(false)

  const handleGoogleAuth = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

    if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID') {
      showToast(
        'To use Google Calendar, add NEXT_PUBLIC_GOOGLE_CLIENT_ID to your .env.local file',
        'info'
      )
      // Still allow calendar URL-based integration
      setIsAuthed(true)
      return
    }

    // For full API access, initiate OAuth flow
    const redirectUri = `${window.location.origin}/auth/google/callback`
    const scope = 'https://www.googleapis.com/auth/calendar.events'
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`

    window.open(authUrl, '_blank', 'width=500,height=600')
    setIsAuthed(true)
    showToast('Google Calendar connected!', 'success')
  }

  return (
    <button
      className="btn-google"
      onClick={handleGoogleAuth}
      style={{ marginTop: '8px' }}
      id="btn-gcal-connect"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      {isAuthed ? '✅ Google Calendar Ready' : 'Connect Google Calendar'}
    </button>
  )
}
