import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { AppProvider } from './store.tsx'
import './styles/tokens.css'
import './styles/base.css'
import './styles/glass.css'
import './styles/app.css'
import './styles/chat.css'
import './styles/pairing.css'

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')
createRoot(root).render(
  <AppProvider>
    <App />
  </AppProvider>,
)
