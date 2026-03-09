"use client";
import { useState, useEffect } from 'react'

export default function ToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const handler = (e) => {
      const { message, type, id } = e.detail
      setToasts(prev => [...prev, { message, type, id }])
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 3600)
    }
    window.addEventListener('skillsxai-toast', handler)
    return () => window.removeEventListener('skillsxai-toast', handler)
  }, [])

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
          {t.message}
        </div>
      ))}
    </div>
  )
}
