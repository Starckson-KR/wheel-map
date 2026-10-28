import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/map.css'
import './styles/flows.css'
import './styles/route.css'
import './styles/admin.css'
import './styles/verify.css'
import './styles/panel.css'
import { initPrefs } from './lib/viewPrefs'
import App from './App.tsx'

initPrefs()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
