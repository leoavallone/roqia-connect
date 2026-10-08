# RoqIA WhatsApp Manager

Portal web leve para cada cliente consultar o estado da própria sessão do WhatsApp e, quando necessário, gerar um novo QR Code do WPPConnect Server. O navegador conversa somente com este backend; `WPPCONNECT_SECRET_KEY`, token Bearer, PIN e nome interno da sessão nunca são devolvidos pela API do portal.

## Arquitetura e segurança

- Node.js + Express + EJS, HTML/CSS/JavaScript vanilla.
- Sessão temporária em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- PIN validado no backend; após o login, as chamadas usam apenas o cookie opaco.
- Limite de tentativas por combinação IP/cliente.
- Helmet e CSP restritiva.
- Sessão WPPConnect sempre vem de `config/clients.json`; o usuário não pode escolhê-la.
- URL do WPPConnect vem somente do ambiente. Não há parâmetro de URL nas rotas públicas.
- Tokens WPPConnect ficam em cache somente na memória do backend e são renovados em caso de `401`.
- Logs de erro são sanitizados e não incluem PIN, chave secreta, Bearer ou URL de geração do token.
- QR em PNG é transmitido como binário, sem Base64 no frontend.

O `express-session` usa armazenamento em memória, de propósito, porque esta primeira versão não possui banco. Isso atende a uma única réplica. Para escalar horizontalmente, troque o store por Redis ou PostgreSQL e mova o repositório de clientes em `src/config/clients.js` para o banco.

## Requisitos

- Node.js 20 ou superior (o Docker usa Node 22 Alpine).
- WPPConnect Server acessível pelo backend.
- Para Docker Compose, uma rede Docker externa compartilhada com o WPPConnect.

## Instalação local

```bash
npm install
cp .env.example .env
cp config/clients.example.json config/clients.json
```

Gere segredos sem reutilizar a `SECRET_KEY` do WPPConnect:

```bash
openssl rand -base64 48
```

Preencha `.env` e configure pelo menos um cliente. Depois:

```bash
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
| `WPPCONNECT_URL` | sim | URL exclusivamente interna, por exemplo `http://automacoes_wppconnect:21465`. |
| `WPPCONNECT_SECRET_KEY` | sim | A mesma `SECRET_KEY` configurada no WPPConnect Server. |
| `ADMIN_SECRET` | sim | Chave independente para assinar cookies; em produção, no mínimo 32 caracteres. |
| `CLIENTS_FILE` | não | Padrão `config/clients.json`. |
| `CLIENTS_JSON` | não | Alternativa ao arquivo, recomendada no EasyPanel. Recebe o objeto completo dos clientes em uma linha. |
| `SESSION_TTL_MINUTES` | não | Expiração da sessão; padrão `30`. |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES` | não | Janela do bloqueio; padrão `15`. |
| `AUTH_RATE_LIMIT_MAX` | não | Falhas permitidas por IP/cliente; padrão `5`. |
| `WPPCONNECT_TIMEOUT_MS` | não | Timeout das consultas; padrão `10000`. |
| `WPPCONNECT_START_TIMEOUT_MS` | não | Timeout de inicialização; padrão `35000`. |
| `QR_POLL_ATTEMPTS` | não | Tentativas de localizar o QR; padrão `10`. |
| `QR_POLL_INTERVAL_MS` | não | Intervalo entre tentativas; padrão `1500`. |
| `QR_START_COOLDOWN_MS` | não | Protege contra reinícios repetidos; padrão `15000`. |

Nunca coloque `.env` no Git nem na imagem Docker.

## Configuração dos clientes

Gere o hash do PIN:

```bash
npm run hash-pin
```

O comando solicita o PIN com a entrada oculta para que ele não apareça no histórico do shell nem na linha de comando.

Copie a saída para `config/clients.json`:

```json
{
  "cliente1": {
    "name": "Cliente 1",
    "session": "cliente1",
    "pinHash": "scrypt$16384$8$1$..."
  }
}
```

O identificador e `session` aceitam apenas letras, números, `_` e `-`, com no máximo 64 caracteres. `pin` em texto puro ainda é aceito para migração, mas `pinHash` é a opção recomendada.

Para criar outro cliente:

1. Escolha um identificador de URL, como `empresa-x`.
2. Crie no WPPConnect uma sessão interna correspondente (ela pode ter outro nome permitido).
3. Rode `npm run hash-pin` e digite o novo PIN na entrada oculta.
4. Adicione o objeto ao JSON.
5. Reinicie o container do Manager.
6. Envie ao cliente somente `https://conectar.roqia.com.br/conectar/empresa-x` e o PIN por canal separado.

## Como funciona o fluxo

1. O cliente abre `/conectar/:cliente` e informa o PIN.
2. O backend valida a configuração interna e cria um cookie temporário.
3. `GET /api/client/status` gera/recupera o token da sessão no backend, chama `check-connection-session` e usa `status-session` para diferenciar desconectado de inicializando.
4. Ao pedir o QR, o backend verifica novamente o estado, chama `start-session` com `waitQrCode: true`, respeita cooldown e consulta o QR em intervalos controlados.
5. `GET /api/client/qr` faz proxy do PNG. A interface consulta o estado a cada 5 segundos e remove o QR assim que a sessão fica conectada.

A normalização de variações do WPPConnect está centralizada em `src/services/wppconnect.js`. Na API oficial, `check-connection-session` devolve `status` booleano; `status-session`/`start-session` devolvem estados textuais; e `qrcode-session` devolve PNG quando o QR existe ou JSON enquanto ainda não está disponível.

## Endpoints do Manager

| Método | Caminho | Autenticação | Finalidade |
|---|---|---:|---|
| `GET` | `/conectar/:cliente` | não | Tela de login ou painel. |
| `POST` | `/api/auth/:cliente/login` | PIN | Cria a sessão temporária. |
| `POST` | `/api/auth/logout` | cookie | Encerra a sessão do portal. |
| `GET` | `/api/client/status` | cookie | Estado normalizado da conexão. |
| `POST` | `/api/client/qr/prepare` | cookie | Inicia a sessão e aguarda o QR. |
| `GET` | `/api/client/qr` | cookie | Proxy binário da imagem do QR. |
| `GET` | `/health` | não | Health check local, sem depender do WPPConnect. |
| `GET` | `/health/wppconnect` | não | Testa separadamente o `/healthz` do WPPConnect. |

As APIs não retornam a configuração, PIN, `session`, token ou chave secreta.

## Docker local

Crie uma rede compartilhada se ainda não existir e conecte também o container WPPConnect a ela:

```bash
docker network create roqia-network
docker network connect roqia-network NOME_DO_CONTAINER_WPPCONNECT
docker compose up -d --build
docker compose ps
curl http://localhost:3000/health
curl http://localhost:3000/health/wppconnect
```

O Compose monta `config/clients.json` como somente leitura. Ele não cria, altera ou desliga a Evolution API nem o WPPConnect.

## Deploy exato no EasyPanel

1. No mesmo projeto que já contém o WPPConnect, crie um novo serviço do tipo **App** a partir deste repositório. Não edite o serviço da Evolution API.
2. Selecione build por **Dockerfile** na raiz e mantenha o caminho `/Dockerfile`.
3. Em ambiente, adicione `NODE_ENV=production`, `PORT=3000`, `WPPCONNECT_URL=http://automacoes_wppconnect:21465`, `WPPCONNECT_SECRET_KEY`, `ADMIN_SECRET` e os ajustes opcionais do `.env.example`.
4. Confirme o nome DNS interno do serviço WPPConnect no EasyPanel. Se ele não for `automacoes_wppconnect`, use o hostname interno exibido pelo painel. Não use o domínio público nessa variável.
5. Adicione `CLIENTS_JSON` nas variáveis do EasyPanel, por exemplo `{"cliente1":{"name":"Cliente 1","session":"cliente1","pinHash":"scrypt$..."}}`. Isso evita montar arquivo ou incluir credenciais na imagem. Como alternativa, monte `config/clients.json` em `/app/config/clients.json` como somente leitura.
6. Configure a porta interna do serviço como `3000`.
7. Em **Domains**, adicione `conectar.roqia.com.br`, aponte para a porta `3000` e habilite HTTPS/Let's Encrypt.
8. Faça o deploy. O health check da imagem usa `GET /health` e não depende do WhatsApp.
9. Abra o terminal/logs do serviço e confirme `RoqIA WhatsApp Manager ouvindo em 0.0.0.0:3000` e a quantidade de clientes.
10. Teste `https://conectar.roqia.com.br/health`, depois `/health/wppconnect` e finalmente `/conectar/cliente1`.

No EasyPanel, serviços do mesmo projeto normalmente compartilham a rede interna. Se `/health/wppconnect` retornar `503`, confirme o hostname, a porta `21465`, a `SECRET_KEY` correspondente e se os dois serviços estão na mesma rede.

## Testes e diagnóstico

```bash
npm run check
npm test
curl -i http://localhost:3000/health
curl -i http://localhost:3000/health/wppconnect
docker compose logs -f --tail=100 roqia-whatsapp-manager
```

Os testes cobrem formatos de status, QR em PNG/JSON, token somente no backend, rejeição de sessão arbitrária, login/cookie e proteção das APIs.

Erros apresentados ao cliente são genéricos. Nos logs, use os campos `operation`, `code` e `httpStatus` para diagnosticar sem expor segredos. O Manager não executa qualquer comando ou chamada para a Evolution API.

## Referências do WPPConnect

- [Repositório oficial e exemplos de token](https://github.com/wppconnect-team/wppconnect-server)
- [Swagger oficial](https://wppconnect.io/swagger/wppconnect-server/)
- [Rotas oficiais](https://github.com/wppconnect-team/wppconnect-server/blob/main/src/routes/index.ts)
- [Implementação oficial dos estados e QR](https://github.com/wppconnect-team/wppconnect-server/blob/main/src/controller/sessionController.ts)
