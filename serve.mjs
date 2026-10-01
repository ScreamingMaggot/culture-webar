// serve.mjs — 零依赖静态服务器（Node 内置模块，无需 npm install）
// 用法:
//   node serve.mjs                 # 本机 http://localhost:8000 （桌面/本机浏览器可直接授权摄像头）
//   node serve.mjs --port 3000     # 指定端口
//   node serve.mjs --https         # 用 ./certs/ 里的 key.pem+cert.pem 起 HTTPS（手机局域网/真机授权摄像头需要）
//   node serve.mjs --host 0.0.0.0  # 监听所有网卡，手机可经局域网 IP 访问
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const useHttps = argv.includes('--https');
const PORT = parseInt(getArg('port', useHttps ? '8443' : '8000'), 10);
const HOST = getArg('host', '0.0.0.0');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.fset': 'application/octet-stream',
  '.iset': 'application/octet-stream', '.keypar': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, headers);
  res.end(body);
}

function handler(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/hiro-quickstart.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, '404 Not Found: ' + urlPath, { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
  });
}

function lanIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`${a.address} (${name})`);
    }
  }
  return out;
}

let server;
if (useHttps) {
  const keyPath = path.join(ROOT, 'certs', 'key.pem');
  const certPath = path.join(ROOT, 'certs', 'cert.pem');
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('需要 HTTPS 但缺少证书。请在 webar-demo/certs/ 放入 key.pem 与 cert.pem。\n' +
      '生成自签证书（Git 自带 openssl）：\n' +
      '  mkdir -p certs && openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=local-webar"');
    process.exit(1);
  }
  server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, handler);
} else {
  server = http.createServer(handler);
}

server.listen(PORT, HOST, () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`\n  WebAR 静态服务器已启动`);
  console.log(`  本机:   ${scheme}://localhost:${PORT}  (打开即自动进入 hiro-quickstart.html)`);
  console.log(`  生产版: ${scheme}://localhost:${PORT}/index.html`);
  console.log(`\n  手机访问请用局域网 IP（若为 http，多数手机浏览器会拒绝开摄像头——请用 --https 或改走 GitHub Pages）:`);
  for (const ip of lanIPs()) console.log(`    ${scheme}://${ip.split(' ')[0]}:${PORT}`);
  console.log(`\n  局域网接口: ${lanIPs().join('  |  ') || '(未检测到，检查 Wi-Fi)'}\n`);
});
