const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const dataDirectory = path.join(root, 'data');
const ordersFile = path.join(dataDirectory, 'orders.json');
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || 'AKUSAYANGRAYA176204';
const adminSessions = new Set();
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function ensureStorage() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  if (!fs.existsSync(ordersFile)) fs.writeFileSync(ordersFile, '[]', 'utf8');
}

function readOrders() {
  ensureStorage();
  return JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
}

function writeOrders(orders) {
  ensureStorage();
  fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), 'utf8');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function getAdminToken(request) {
  const cookies = request.headers.cookie || '';
  const token = cookies.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith('admin_token='));
  return token ? decodeURIComponent(token.slice('admin_token='.length)) : '';
}

function requireAdmin(request, response) {
  if (adminSessions.has(getAdminToken(request))) return true;
  sendJson(response, 401, { error: 'Akses admin diperlukan.' });
  return false;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) request.destroy();
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function serveFile(request, response) {
  let requestedPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  if (requestedPath === '/') requestedPath = '/index.html';
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/health' && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok', service: 'toko-modern-bima' });
      return;
    }

    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      const payload = await readBody(request);
      if (payload.password !== adminPassword) {
        sendJson(response, 401, { error: 'Password admin salah.' });
        return;
      }
      const token = crypto.randomBytes(24).toString('hex');
      adminSessions.add(token);
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `admin_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
      });
      response.end(JSON.stringify({ authenticated: true }));
      return;
    }

    if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
      adminSessions.delete(getAdminToken(request));
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'admin_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
      });
      response.end(JSON.stringify({ authenticated: false }));
      return;
    }

    if (url.pathname === '/api/admin/me' && request.method === 'GET') {
      sendJson(response, adminSessions.has(getAdminToken(request)) ? 200 : 401, { authenticated: adminSessions.has(getAdminToken(request)) });
      return;
    }

    if (url.pathname === '/api/orders' && request.method === 'GET') {
      if (!requireAdmin(request, response)) return;
      sendJson(response, 200, readOrders().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      return;
    }

    if (url.pathname === '/api/orders' && request.method === 'POST') {
      const payload = await readBody(request);
      if (!payload.customer || !payload.items?.length || !payload.payment) {
        sendJson(response, 400, { error: 'Data order belum lengkap.' });
        return;
      }
      const order = {
        id: `BMA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        createdAt: new Date().toISOString(),
        customer: payload.customer,
        items: payload.items,
        total: payload.total,
        payment: payload.payment,
        paymentStatus: payload.payment === 'COD' ? 'cod' : 'pending',
        orderStatus: 'new'
      };
      const orders = readOrders();
      orders.push(order);
      writeOrders(orders);
      sendJson(response, 201, order);
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (statusMatch && request.method === 'PATCH') {
      if (!requireAdmin(request, response)) return;
      const payload = await readBody(request);
      const orders = readOrders();
      const order = orders.find((entry) => entry.id === statusMatch[1]);
      if (!order) { sendJson(response, 404, { error: 'Order tidak ditemukan.' }); return; }
      if (payload.paymentStatus) order.paymentStatus = payload.paymentStatus;
      if (payload.orderStatus) order.orderStatus = payload.orderStatus;
      order.updatedAt = new Date().toISOString();
      writeOrders(orders);
      sendJson(response, 200, order);
      return;
    }

    serveFile(request, response);
  } catch (error) {
    sendJson(response, 500, { error: 'Terjadi kesalahan server.' });
  }
});

ensureStorage();
server.listen(port, () => console.log(`Toko Modern Bima berjalan di http://localhost:${port}`));
