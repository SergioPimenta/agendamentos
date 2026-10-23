import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { ConfirmProvider, ToastProvider } from './components/ui/Feedback.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// Depois de uma atualização do sistema, uma aba aberta ainda aponta para arquivos antigos que não existem mais.
// Em vez de ficar em branco, recarrega uma vez para pegar a versão nova.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    if (sessionStorage.getItem('chunk-reload')) return;
    sessionStorage.setItem('chunk-reload', '1');
  } catch {
    /* sem sessionStorage: recarrega mesmo assim */
  }
  window.location.reload();
});
window.addEventListener('load', () => {
  try { sessionStorage.removeItem('chunk-reload'); } catch { /* ignora */ }
});

// App instalável (PWA): o service worker só vale em produção (em dev atrapalharia o hot reload).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[pwa] service worker não registrado:', err));
  });
}
