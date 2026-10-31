const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./server.cjs');
const credentials = { user: 'teste', password: 'senha-de-teste-123456789' };
const auth = 'Basic ' + Buffer.from(credentials.user + ':' + credentials.password).toString('base64');
const data = { transactions: [{ id: 'conta', date: '2026-08-20', paymentDate: '2026-11-01', type: 'expense', paid: true, amount: 500, description: 'Energia — mês de agosto' }], categories: [{ id: 'energia', name: 'Energia' }], settings: {}, institutions: [], responsibles: [] };

test('Servidor: autenticação, persistência, revisões, backups e proteção de arquivos', async () => {
 const dir = fs.mkdtempSync(path.join(__dirname, '.fincontrol-test-'));
 let server;
 async function start() { server = createApp({ ...credentials, dataDir: dir }); await new Promise(r => server.listen(0, '127.0.0.1', r)); return 'http://127.0.0.1:' + server.address().port; }
 async function stop() { await new Promise(r => server.close(r)); }
 try {
  let base = await start();
  const get = () => fetch(base + '/api/state', { headers: { Authorization: auth } });
  const put = (payload, extra = {}) => fetch(base + '/api/state', { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(payload) });
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await fetch(base + '/')).status, 401);
  assert.equal((await fetch(base + '/healthz')).status, 200);
  assert.equal((await (await get()).json()).row, null);
  assert.equal((await put({ data: {}, revision: 0 })).status, 400);
  assert.equal((await put({ data, revision: 0 }, { Origin: 'https://outro-site.example' })).status, 403);
  assert.equal((await put({ data, revision: 0 })).status, 200);
  assert.deepEqual((await (await get()).json()).row.data, data);
  assert.equal((await put({ data, revision: 0 })).status, 409);
  assert.equal((await put({ data: { ...data, settings: { name: 'Casa' } }, revision: 1 })).status, 200);
  const backups = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'backups', backups[0]))).data, data);
  assert.equal((await fetch(base + '/fincontrol.json', { headers: { Authorization: auth } })).status, 404);
  assert.equal((await fetch(base + '/backups', { headers: { Authorization: auth } })).status, 404);
  assert.equal((await fetch(base + '/', { headers: { Authorization: auth } })).status, 200);
  const concurrent = await Promise.all([put({ data, revision: 2 }), put({ data, revision: 2 })]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  await stop();base = await start();
  assert.equal((await (await get()).json()).row.revision, 3);
  await stop();server = null;
  fs.writeFileSync(path.join(dir, 'fincontrol.json'), 'corrompido');
  assert.throws(() => createApp({ ...credentials, dataDir: dir }));
 } finally {
  if (server?.listening) await stop();
  if (path.dirname(path.resolve(dir)) !== path.resolve(__dirname) || !path.basename(dir).startsWith('.fincontrol-test-')) throw new Error('Diretório de teste fora do escopo.');
  fs.rmSync(dir, { recursive: true, force: true });
 }
});

const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
test('HTML sem Supabase, scripts válidos e sem funções de persistência duplicadas', () => {
 assert(!/supabase/i.test(html));
 for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
 for (const name of ['saveState', 'saveNoBackup', 'autoBackup', 'configureBackup', 'restorePersistedBackup']) {
  assert.equal([...html.matchAll(new RegExp('function '+name+'\\(', 'g'))].length, 1, name);
 }
});

function client() {
 const nodes = new Map();
 const ctx = vm.createContext({
  state: JSON.parse(JSON.stringify(data)),
  $: id => nodes.get(id),
  document: { createElement: () => ({ setAttribute() {}, remove() { nodes.delete('renderGate'); } }), body: { append: node => nodes.set(node.id, node) } },
  window: { addEventListener() {} },
  localStorage: new Proxy({}, { get() { throw Error('Não deve acessar localStorage no modo servidor'); } }),
  normalizeCloudData: d => d && Array.isArray(d.transactions) && Array.isArray(d.categories) ? d : null,
  esc: x => x, setTimeout, clearTimeout, AbortController, Date, JSON,
  setInterval: () => 1, clearInterval() {},
  refreshAll() {}, stopBackupWatcher() {}, setSaveSuccess() {}, setSaveSaving() {}, setSaveError() {}, showToast() {},
  loadState() { ctx.localReads = (ctx.localReads || 0) + 1; },
  fetch: async () => ({ ok: true, json: async () => ({ row: { data, revision: 1, updated_at: new Date().toISOString() } }) })
 });
 const code=html.slice(html.indexOf('let cloudEnabled=true'), html.indexOf('function normalizeCloudData('));
 vm.runInContext(code, ctx);
 return { ctx, nodes };
}
test('Após migração, iniciar usa só o servidor, sem ler localStorage', async () => {
 const { ctx, nodes } = client();
 await ctx.loadCloudOnOpen();
 assert.equal(ctx.localReads, undefined);
 assert.equal(vm.runInContext('cloudReady', ctx), true);
 assert(!nodes.has('renderGate'));
});
test('Servidor vazio permite importar; confirmação exige gravação e releitura', async () => {
 const { ctx, nodes } = client();let row = null;const methods = [];
 ctx.fetch = async (url, options) => {
  methods.push(options.method);
  if(options.method === 'PUT') { const body = JSON.parse(options.body); assert.equal(body.revision, 0); row = { data: body.data, revision: 1, updated_at: new Date().toISOString() }; }
  return { ok: true, json: async () => ({ row }) };
 };
 await ctx.loadCloudOnOpen();assert.equal(ctx.localReads, 1);assert(nodes.has('renderGate'));
 await ctx.migrateLocalToCloud();assert.deepEqual(methods, ['GET', 'PUT', 'GET']);assert(!nodes.has('renderGate'));
});
test('Falha ao carregar bloqueia sem usar os dados do navegador', async () => {
 const { ctx } = client();ctx.fetch = async () => { throw Error('offline'); };
 await assert.rejects(ctx.loadCloudOnOpen());assert.equal(ctx.localReads, undefined);
});
test('Salvar grava na API sem localStorage; falha mantém pendência e bloqueio', async () => {
 const { ctx, nodes } = client();await ctx.loadCloudOnOpen();let writes = 0;
 ctx.fetch = async (url, options) => {
  writes++;const body = JSON.parse(options.body);assert.equal(body.revision, 1);
  return { ok: true, json: async () => ({ row: { data: body.data, revision: 2, updated_at: new Date().toISOString() } }) };
 };
 ctx.saveState();await vm.runInContext('cloudSaveFlight', ctx);
 assert.equal(writes, 1);assert.equal(vm.runInContext('cloudRevision', ctx), 2);assert(!nodes.has('renderGate'));
 ctx.fetch = async () => { throw Error('offline'); };
 ctx.saveState();await vm.runInContext('cloudSaveFlight', ctx);
 assert.equal(vm.runInContext('cloudLocalWritePending', ctx), true);assert(nodes.has('renderGate'));
});
test('Conflito não sobrescreve servidor e retorno perdido não duplica gravação', async () => {
 const { ctx, nodes } = client();await ctx.loadCloudOnOpen();
 ctx.state.settings.name='Sessão atual';
 ctx.fetch=async()=>({ok:false,status:409,json:async()=>({error:'Conflito'})});
 ctx.saveState();await vm.runInContext('cloudSaveFlight',ctx);
 assert.equal(vm.runInContext('cloudRevision',ctx),1);assert(nodes.has('renderGate'));
 const pending=JSON.parse(vm.runInContext('JSON.stringify(pendingServerSnapshot)',ctx));let gets=0;
 ctx.fetch=async(url,options)=>{assert.equal(options.method,'GET');gets++;return {ok:true,json:async()=>({row:{data:pending,revision:2,updated_at:new Date().toISOString()}})};};
 await ctx.retryRenderConnection();assert.equal(gets,1);assert(!nodes.has('renderGate'));assert.equal(vm.runInContext('cloudLocalWritePending',ctx),false);
});
