import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { init } from './analytics'
import './index.css'
import App from './App.tsx'

// Does nothing at all unless this build was given a key — see src/analytics.ts.
init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
