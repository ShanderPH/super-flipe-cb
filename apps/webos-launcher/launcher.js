const input = document.getElementById('endpoint');
const status = document.getElementById('status');
try { input.value = localStorage.getItem('superflip-server') || ''; } catch { /* Storage optional. */ }
input.focus();
function privateEndpoint(value) {
  const url = new URL(value);
  const ip = url.hostname.split('.').map(Number);
  const privateIp = ip.length === 4 && ip.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (ip[0] === 10 || (ip[0] === 192 && ip[1] === 168) || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31));
  if (!['http:', 'https:'].includes(url.protocol) || !privateIp || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Informe uma origem HTTP ou HTTPS com IP privado da sua rede. HTTPS requer certificado confiável na TV.');
  return url.origin;
}
document.getElementById('connect').addEventListener('submit', async event => {
  event.preventDefault();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
  try {
    const origin = privateEndpoint(input.value);
    status.textContent = 'Verificando alcance da rede…';
    await fetch(`${origin}/api/health`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal
    });
    try { localStorage.setItem('superflip-server', origin); } catch { /* Optional setting only. */ }
    location.replace(`${origin}/`);
  } catch (error) { status.textContent = error.name === 'AbortError' || error instanceof TypeError ? 'Servidor indisponível. Confira o endereço e a rede.' : error.message; }
  finally { clearTimeout(timer); }
});
