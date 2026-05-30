/* ── login screen — password gate before app loads ──────────── */

const Login = (() => {
  // Obfuscated password hash — split and reversed to avoid casual grep
  const _p = 'e25dd619680620c40c4953c28f3e4f12f4f958899bfcb5ab7b36228ed28930d6';
  const PASS_HASH = _p.split('').reverse().join('');

  const SESSION_MS = 24 * 60 * 60 * 1000; // 24 hours
  let failedAttempts = 0;
  let lockoutUntil = 0;

  function init() {
    const authTime = localStorage.getItem('auth_time');
    const sessionToken = localStorage.getItem('auth_token');
    if (authTime && sessionToken && Date.now() - parseInt(authTime) < SESSION_MS && _validateToken(sessionToken, parseInt(authTime))) {
      _unlock();
      return;
    }
    localStorage.removeItem('auth_time');
    localStorage.removeItem('auth_token');
    document.getElementById('login-overlay').style.cssText = 'display:flex !important';
    document.body.style.overflow = 'hidden';
    const input = document.getElementById('login-password');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  function _generateToken(authTime) {
    const raw = PASS_HASH + ':' + authTime + ':' + navigator.userAgent.slice(0, 20);
    // Simple fingerprint — not cryptographically secure but prevents trivial token reuse
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const chr = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return hash.toString(36);
  }

  function _validateToken(token, authTime) {
    return token === _generateToken(authTime);
  }

  async function submit() {
    const now = Date.now();
    if (now < lockoutUntil) {
      const waitSec = Math.ceil((lockoutUntil - now) / 1000);
      document.getElementById('login-error').textContent = `Too many attempts. Wait ${waitSec}s`;
      return;
    }

    const input = document.getElementById('login-password');
    const error = document.getElementById('login-error');
    const val = input.value;
    if (!val) return;

    const buf = new TextEncoder().encode(val);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    if (hash === PASS_HASH) {
      const authTime = Date.now();
      localStorage.setItem('auth_time', String(authTime));
      localStorage.setItem('auth_token', _generateToken(authTime));
      failedAttempts = 0;
      _unlock();
    } else {
      failedAttempts++;
      error.textContent = 'Wrong password';
      input.value = '';
      input.focus();
      input.classList.add('login-shake');
      setTimeout(() => input.classList.remove('login-shake'), 400);
      // Exponential lockout: 3s, 6s, 12s, 24s...
      if (failedAttempts >= 3) {
        lockoutUntil = now + Math.min(30000, 3000 * Math.pow(2, failedAttempts - 3));
      }
    }
  }

  function _unlock() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.remove();
    // Boot the app
    (async () => {
      try { await DB.open(); App.init(); UIBackup.initAutoBackup(); }
      catch (e) { alert('Failed to load database: ' + e.message); }
    })();
  }

  function logout() {
    localStorage.removeItem('auth_time');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('lynq_user');
    location.reload();
  }

  return { init, submit, logout };
})();

document.addEventListener('DOMContentLoaded', () => Login.init());
