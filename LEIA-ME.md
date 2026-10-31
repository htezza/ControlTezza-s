# FinControl no Render

O pacote contém a versão ajustada dos cards/gráficos e um servidor Node.js sem dependências externas. O HTML e a API devem ser servidos pelo mesmo serviço. Os dados ficam em `/data/fincontrol/fincontrol.json`; as últimas 100 versões anteriores ficam em `/data/fincontrol/backups/`.

## Configurar o serviço existente

1. Envie o conteúdo desta pasta ao repositório conectado ao serviço no Render. A raiz do serviço deve conter `package.json`, `server.cjs` e a pasta `public`. Se usar uma subpasta no repositório, configure o campo Root Directory.
2. Use um **Web Service** com runtime Node.js. Um Static Site não executa a API.
3. Build Command: `npm install --omit=dev`. Start Command: `npm start`.
4. Mantenha o disco pago já conectado com **Mount Path `/data`**. Não crie outro disco nem apague o existente. O aplicativo utiliza apenas a subpasta `fincontrol`.
5. Configure as variáveis de ambiente no Render:

| Nome | Valor |
| --- | --- |
| `DATA_DIR` | `/data/fincontrol` |
| `APP_USERNAME` | Nome de usuário escolhido por você |
| `APP_PASSWORD` | Senha exclusiva com pelo menos 16 caracteres |

6. Configure Health Check Path como `/healthz`. Faça o deploy e abra o endereço HTTPS do serviço. O navegador solicitará usuário e senha. Não coloque a senha dentro do HTML ou do repositório.

## Primeiro acesso: enviar os dados do navegador

1. Antes de substituir a versão atual, abra-a no navegador que contém seus dados. Confira se a lista está atualizada e use **Backup → Baixar backup JSON**. Guarde esse arquivo.
2. Abra o endereço do Render. Se for exatamente a mesma origem (protocolo, domínio e porta) da versão anterior, o assistente poderá detectar os dados do navegador. Confira a quantidade de lançamentos e clique em **Enviar estes dados ao Render**.
3. Se o endereço mudou ou os dados não forem detectados, clique em **Selecionar backup JSON**, escolha o arquivo exportado e depois clique em **Enviar estes dados ao Render**.
4. O servidor deve estar vazio. O envio inicial não substitui dados existentes. O aplicativo confirma o envio com uma segunda leitura antes de liberar o uso.
5. Recarregue a página e confira os dados. Abra também em outro navegador para conferir que vieram do servidor.

Depois disso, o aplicativo não grava os lançamentos no localStorage e não usa arquivos locais como contingência. A cópia antiga do navegador é preservada para recuperação, mas não é sincronizada nem usada nos próximos acessos quando o servidor possui dados. Não continue editando a versão antiga.

## Funcionamento e recuperação

- Cada alteração deve receber a confirmação do servidor. Durante a gravação, a interface bloqueia novas ações. Se falhar, o aplicativo mantém a alteração apenas na memória da sessão e oferece repetir ou exportar uma cópia. Não feche a página antes de resolver a falha.
- Outras sessões consultam as atualizações a cada 10 segundos. Duas sessões não podem gravar sobre a mesma revisão: a segunda recebe um conflito. Exporte sua cópia, recarregue o servidor e revise antes de restaurar um backup.
- Para substituir dados após a migração, use **Restaurar backup**, que pede confirmação e também grava no servidor.
- Cada gravação bem-sucedida preserva a versão anterior, limitada às últimas 100. Esses backups ficam no mesmo disco e não substituem uma cópia externa; use **Baixar backup JSON** periodicamente.
- Um disco persistente é ligado a um único serviço. Esta implementação espera uma instância/processo do servidor. Não execute vários processos Node contra o mesmo arquivo.
- Se o arquivo principal estiver inválido, o servidor falha sem recriá-lo vazio. Para recuperar, pare o serviço e restaure uma versão de `backups/` para `fincontrol.json`, preservando o formato completo com `revision` e `data`.
- A aplicação não acessa mais o Supabase. Os dados antigos no Supabase não são apagados por este pacote.
- O layout ainda carrega Tailwind e Chart.js por CDN, como a versão original; a interface depende dessas conexões.

## Validação local

Execute `npm test`. Para rodar localmente, configure `APP_USERNAME`, `APP_PASSWORD` e `DATA_DIR` para uma pasta de teste fora de `public`, e use `npm start`. No Render, mantenha `DATA_DIR=/data/fincontrol`.

Referência oficial: [discos persistentes](https://render.com/docs/disks) e [Web Services](https://render.com/docs/web-services).
