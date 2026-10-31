'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function validData(data) {
  return data && typeof data === 'object' && !Array.isArray(data) &&
    Array.isArray(data.transactions) && Array.isArray(data.categories) &&
    data.transactions.every(t => t && typeof t.id === 'string' && typeof t.date === 'string' && Number.isFinite(Number(t.amount))) &&
    data.categories.every(c => c && typeof c.id === 'string');
}

function createApp(options = {}) {
  const dir = path.resolve(options.dataDir || process.env.DATA_DIR || '/data/fincontrol');
  const user = options.user || process.env.APP_USERNAME;
  const password = options.password || process.env.APP_PASSWORD;
  if (!user || !password || password.length < 16) throw new Error('Configure APP_USERNAME e APP_PASSWORD (mínimo de 16 caracteres).');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'fincontrol.json');
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const expected = crypto.createHash('sha256').update('Basic ' + Buffer.from(user + ':' + password).toString('base64')).digest();
  function read() {
    if (!fs.existsSync(file)) return null;
    const row = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!validData(row.data) || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Arquivo de dados inválido; restaure um backup antes de continuar.');
    return row;
  }
  // Falha na inicialização se o arquivo existente estiver corrompido.
  read();
  function respond(res, code, data, extra = {}) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(JSON.stringify(data));
  }
  function store(row) {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, path.join(backupDir, `${Date.now()}-${crypto.randomUUID()}.json`));
    }
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(row)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
      // Persistir também a alteração do diretório em plataformas compatíveis.
      if (process.platform !== 'win32') { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    try {
      const names = fs.readdirSync(backupDir).filter(n => n.endsWith('.json')).sort().reverse();
      for (const name of names.slice(100)) fs.unlinkSync(path.join(backupDir, name));
    } catch (error) { console.error('Não foi possível limpar backups antigos:', error.message); }
  }
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') return respond(res, 200, { ok: true });
    const supplied = crypto.createHash('sha256').update(req.headers.authorization || '').digest();
    if (!crypto.timingSafeEqual(expected, supplied)) return respond(res, 401, { error: 'Acesso restrito.' }, { 'WWW-Authenticate': 'Basic realm="FinControl", charset="UTF-8"' });
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
        return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
      }
      if (url.pathname !== '/api/state') return respond(res, 404, { error: 'Não encontrado.' });
      if (req.method === 'GET') return respond(res, 200, { row: read() });
      if (req.method !== 'PUT') return respond(res, 405, { error: 'Método não permitido.' }, { Allow: 'GET, PUT' });
      // JSON + same-origin bloqueiam submissões cross-site com credenciais do navegador.
      if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') return respond(res, 415, { error: 'Envie application/json.' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return respond(res, 403, { error: 'Origem não permitida.' });
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host || !['https:', 'http:'].includes(origin.protocol)) return respond(res, 403, { error: 'Origem não permitida.' });
      }
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 20 * 1024 * 1024) return respond(res, 413, { error: 'Backup maior que 20 MB.' });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return respond(res, 400, { error: 'JSON inválido.' }); }
      if (!validData(body.data) || !Number.isSafeInteger(body.revision) || body.revision < 0) return respond(res, 400, { error: 'Dados ou revisão inválidos.' });
      // Leitura e escrita síncronas no mesmo processo impedem duas gravações com a mesma revisão.
      const current = read();
      if (body.revision !== (current?.revision || 0)) return respond(res, 409, { error: 'Outra sessão atualizou os dados. Exporte seu backup local antes de carregar a versão do servidor.' });
      const row = { id: 'main', data: body.data, revision: (current?.revision || 0) + 1, updated_at: new Date().toISOString() };
      store(row);
      return respond(res, 200, { row });
    } catch (error) {
      console.error('Erro de armazenamento:', error.message);
      return respond(res, 500, { error: 'Falha ao acessar o disco. Os dados locais devem ser preservados.' });
    }
  });
}
if (require.main === module) {
  if (process.env.RENDER && !process.env.DATA_DIR?.startsWith('/data/')) throw new Error('No Render, configure DATA_DIR=/data/fincontrol.');
  createApp().listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('FinControl iniciado.'));
}
module.exports = { createApp };
