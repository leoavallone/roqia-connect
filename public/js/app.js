(() => {
  const body = document.body;
  const view = body.dataset.view;

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(data?.error || 'Não foi possível concluir a solicitação.');
      error.status = response.status;
      error.code = data?.code;
      throw error;
    }
    return data;
  }

  if (view === 'login') {
    const form = document.querySelector('#loginForm');
    const pin = document.querySelector('#pin');
    const reveal = document.querySelector('#revealPin');
    const button = document.querySelector('#loginButton');
    const errorBox = document.querySelector('#loginError');

    reveal?.addEventListener('click', () => {
      const showing = pin.type === 'text';
      pin.type = showing ? 'password' : 'text';
      reveal.setAttribute('aria-label', showing ? 'Mostrar PIN' : 'Ocultar PIN');
      pin.focus();
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.textContent = '';
      if (!pin.value || pin.value.length < 4) {
        errorBox.textContent = 'Digite seu PIN de acesso.';
        pin.focus();
        return;
      }

      button.disabled = true;
      button.classList.add('is-loading');
      try {
        await request(`/api/auth/${encodeURIComponent(body.dataset.clientId)}/login`, {
          method: 'POST',
          body: JSON.stringify({ pin: pin.value }),
        });
        window.location.reload();
      } catch (error) {
        errorBox.textContent = error.message;
        button.disabled = false;
        button.classList.remove('is-loading');
        pin.select();
      }
    });
    return;
  }

  if (view !== 'dashboard') return;

  const statusPanel = document.querySelector('#statusPanel');
  const statusText = document.querySelector('#statusText');
  const statusDescription = document.querySelector('#statusDescription');
  const generateButton = document.querySelector('#generateQrButton');
  const refreshButton = document.querySelector('#refreshButton');
  const logoutButton = document.querySelector('#logoutButton');
  const lastCheck = document.querySelector('#lastCheck');
  const qrCard = document.querySelector('#qrCard');
  const qrLoading = document.querySelector('#qrLoading');
  const qrContent = document.querySelector('#qrContent');
  const qrImage = document.querySelector('#qrImage');
  const updateQrButton = document.querySelector('#updateQrButton');
  const qrError = document.querySelector('#qrError');
  let polling = false;
  let preparing = false;
  let qrVisible = false;
  let qrRefreshTimer;

  const stateCopy = {
    connected: ['WhatsApp conectado', 'Sua conta está ativa e pronta para receber mensagens.'],
    disconnected: ['WhatsApp desconectado', 'Gere um QR Code para reconectar sua conta.'],
    connecting: ['Aguardando conexão', 'Escaneie o QR Code pelo WhatsApp no seu celular.'],
    error: ['Não foi possível verificar', 'Tente novamente em alguns instantes.'],
    unknown: ['Status indisponível', 'Verifique novamente em alguns instantes.'],
    loading: ['Verificando...', 'Aguarde enquanto consultamos sua sessão.'],
  };

  function stopQrRefresh() {
    clearInterval(qrRefreshTimer);
    qrRefreshTimer = undefined;
  }

  function hideQr() {
    qrVisible = false;
    qrCard.hidden = true;
    qrImage.removeAttribute('src');
    stopQrRefresh();
  }

  function showState(state) {
    const safeState = stateCopy[state] ? state : 'unknown';
    const [title, description] = stateCopy[safeState];
    statusPanel.className = `status-panel is-${safeState}`;
    statusText.textContent = title;
    statusDescription.textContent = description;
    generateButton.hidden = !['disconnected', 'unknown', 'error'].includes(safeState);
    lastCheck.textContent = `Última verificação: ${new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date())}`;

    if (safeState === 'connected') hideQr();
    if (safeState === 'connecting' && qrVisible) qrCard.hidden = false;
  }

  function loadQrImage() {
    return new Promise((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        qrLoading.hidden = true;
        qrContent.hidden = false;
        qrError.textContent = '';
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('QR Code ainda não está disponível.'));
      };
      const cleanup = () => {
        qrImage.removeEventListener('load', onLoad);
        qrImage.removeEventListener('error', onError);
      };
      qrImage.addEventListener('load', onLoad);
      qrImage.addEventListener('error', onError);
      qrImage.src = `/api/client/qr?t=${Date.now()}`;
    });
  }

  async function checkStatus({ manual = false } = {}) {
    if (polling || document.hidden) return;
    polling = true;
    if (manual) refreshButton.classList.add('is-spinning');
    try {
      const data = await request('/api/client/status');
      showState(data.state);
    } catch (error) {
      if (error.status === 401) return window.location.reload();
      showState('error');
    } finally {
      polling = false;
      refreshButton.classList.remove('is-spinning');
    }
  }

  async function prepareQr() {
    if (preparing) return;
    preparing = true;
    qrVisible = true;
    qrCard.hidden = false;
    qrLoading.hidden = false;
    qrContent.hidden = true;
    qrError.textContent = '';
    generateButton.disabled = true;
    updateQrButton.disabled = true;
    showState('connecting');

    try {
      const data = await request('/api/client/qr/prepare', { method: 'POST' });
      if (data.state === 'connected') {
        showState('connected');
        return;
      }
      if (!data.qrReady) throw new Error('O QR Code ainda está sendo preparado. Tente novamente.');
      await loadQrImage();
      stopQrRefresh();
      qrRefreshTimer = setInterval(() => {
        if (!document.hidden && qrVisible) loadQrImage().catch(() => {});
      }, 25_000);
    } catch (error) {
      if (error.status === 401) return window.location.reload();
      qrLoading.hidden = true;
      qrError.textContent = error.message;
      showState('disconnected');
    } finally {
      preparing = false;
      generateButton.disabled = false;
      updateQrButton.disabled = false;
    }
  }

  generateButton.addEventListener('click', prepareQr);
  updateQrButton.addEventListener('click', prepareQr);
  refreshButton.addEventListener('click', () => checkStatus({ manual: true }));
  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.reload();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkStatus();
  });

  showState('loading');
  checkStatus();
  setInterval(checkStatus, 5000);
})();
