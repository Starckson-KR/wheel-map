import './lib/resetOnce' // 반드시 맨 첫 import: 배포 후 브라우저마다 한 번 로그인·초기 설정 상태를 지운다
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/map.css'
import './styles/flows.css'
import './styles/route.css'
import './styles/bus.css'
import './styles/admin.css'
import './styles/verify.css'
import './styles/panel.css'
import './styles/rewards.css'
import './styles/home.css'
import './styles/ui.css'
import { initPrefs } from './lib/viewPrefs'
import App from './App.tsx'
import MotionRoot from './components/MotionRoot'
import { installLineTidy } from './lib/lineTidy'
import { startUpdateCheck } from './lib/updateCheck'

initPrefs()
installLineTidy(document.getElementById('root'))
startUpdateCheck()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionRoot>
      <App />
    </MotionRoot>
  </StrictMode>,
)
