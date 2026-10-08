# RoqIA WhatsApp Manager

Portal web para cada cliente consultar e conectar sua própria sessão do WhatsApp no WAHA. O navegador conversa somente com este backend; a chave da API, o PIN e o nome interno da sessão não são enviados ao frontend.

## Arquitetura e segurança

- Node.js + Express + EJS, HTML/CSS/JavaScript vanilla.
- Sessão temporária em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- PIN validado no backend e limite de tentativas por combinação IP/cliente.
- Helmet e CSP restritiva.
- A sessão WAHA vem exclusivamente da configuração interna de clientes.
- A URL e a chave do WAHA vêm somente do ambiente.
- Logs sanitizados, sem PIN ou chave da API.
- QR transmitido ao navegador como imagem binária.

O `express-session` usa armazenamento em memória. Esta configuração atende uma única réplica; para escalar horizontalmente, use Redis ou PostgreSQL.

## Instalação local

Requisitos: Node.js 20 ou superior e um serviço WAHA acessível pelo backend.

```bash
npm install
cp .env.example .env
cp config/clients.example.json config/clients.json
npm run hash-pin
npm run check
npm test
npm start
```

Abra `http://localhost:3000/conectar/cliente1`.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---:|---|
| `PORT` | não | Porta HTTP; padrão `3000`. |
| `NODE_ENV` | produção | Use `production` no EasyPanel. |
| `WAHA_URL` | sim | URL interna, por exemplo `http://automacoes_waha:3000`. |
| `WAHA_API_KEY` | sim | A mesma chave configurada no serviço WAHA. |
| `ADMIN_SECRET` | sim | Chave para assinar cookies; em produção, no mínimo 32 caracteres. |
| `CLIENTS_FILE` | não | Padrão `config/clients.json`. |
| `CLIENTS_JSON` | não | Alternativa ao arquivo, recomendada no EasyPanel. |
| `SESSION_TTL_MINUTES` | não | Expiração da sessão; padrão `30`. |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES` | não | Janela do bloqueio; padrão `15`. |
| `AUTH_RATE_LIMIT_MAX` | não | Falhas permitidas por IP/cliente; padrão `5`. |
| `WAHA_TIMEOUT_MS` | não | Timeout das consultas; padrão `10000`. |
| `WAHA_START_TIMEOUT_MS` | não | Timeout de inicialização; padrão `35000`. |
| `QR_POLL_ATTEMPTS` | não | Tentativas de localizar o QR; padrão `10`. |
| `QR_POLL_INTERVAL_MS` | não | Intervalo entre tentativas; padrão `1500`. |
| `QR_START_COOLDOWN_MS` | não | Protege contra reinícios repetidos; padrão `15000`. |

Nunca coloque `.env` no Git nem na imagem Docker.

## Configuração dos clientes

Gere o hash do PIN com `npm run hash-pin` e configure o cliente:

```json
{
  "cliente1": {
    "name": "Cliente 1",
    "session": "default",
    "pinHash": "scrypt$16384$8$1$..."
  }
}
```

O campo `session` deve ser exatamente o nome da sessão criada no WAHA. O identificador da URL e a sessão aceitam letras, números, `_` e `-`, com até 64 caracteres.

## Fluxo

1. O cliente abre `/conectar/:cliente` e informa o PIN.
2. O backend valida a configuração e cria um cookie temporário.
3. `GET /api/client/status` consulta o estado da sessão no WAHA.
4. Se necessário, `POST /api/client/qr/prepare` cria ou inicia a sessão e aguarda o QR.
5. `GET /api/client/qr` faz proxy da imagem. A interface remove o QR quando a sessão fica conectada.

## Endpoints

| Método | Caminho | Autenticação | Finalidade |
|---|---|---:|---|
| `GET` | `/conectar/:cliente` | não | Tela de login ou painel. |
| `POST` | `/api/auth/:cliente/login` | PIN | Cria a sessão temporária. |
| `POST` | `/api/auth/logout` | cookie | Encerra a sessão do portal. |
| `GET` | `/api/client/status` | cookie | Estado normalizado da conexão. |
| `POST` | `/api/client/qr/prepare` | cookie | Inicia a sessão e aguarda o QR. |
| `GET` | `/api/client/qr` | cookie | Proxy binário da imagem do QR. |
| `GET` | `/health` | não | Health check local. |
| `GET` | `/health/waha` | não | Testa a comunicação com o WAHA. |

## Deploy no EasyPanel

1. Mantenha os serviços `waha` e `roqia-connect` no mesmo projeto.
2. No `roqia-connect`, use o Dockerfile da raiz e porta interna `3000`.
3. Configure `NODE_ENV=production`, `PORT=3000`, `WAHA_URL=http://automacoes_waha:3000`, `WAHA_API_KEY`, `ADMIN_SECRET` e `CLIENTS_JSON`.
4. Em `CLIENTS_JSON`, aponte o cliente para a sessão WAHA correta, por exemplo `"session":"default"`.
5. Mantenha `conectar.roqia.com.br` apontando para a porta interna `3000` com HTTPS.
6. Implante e teste `/health`, `/health/waha` e `/conectar/cliente1`.

Se `/health/waha` retornar `503`, confira a URL interna, a chave da API e se os dois serviços estão no mesmo projeto/rede do EasyPanel.

## Diagnóstico

```bash
npm run check
npm test
curl -i http://localhost:3000/health
curl -i http://localhost:3000/health/waha
docker compose logs -f --tail=100 roqia-whatsapp-manager
```

Referências: [sessões WAHA](https://waha.devlike.pro/docs/how-to/sessions/), [engine NOWEB](https://waha.devlike.pro/docs/engines/noweb/).
