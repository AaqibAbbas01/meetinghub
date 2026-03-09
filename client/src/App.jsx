import { Routes, Route } from 'react-router-dom'
import LandingPage from './pages/LandingPage.jsx'
import MeetingPage from './pages/MeetingPage.jsx'
import ToastContainer from './components/ToastContainer.jsx'

export default function App() {
  return (
    <>
      <ToastContainer />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/meeting" element={<MeetingPage />} />
      </Routes>
    </>
  )
}
