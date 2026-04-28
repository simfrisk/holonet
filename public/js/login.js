function togglePw() {
    const pw = document.getElementById('password');
    const btn = document.getElementById('pwToggle');
    const showing = pw.type === 'text';
    pw.type = showing ? 'password' : 'text';
    btn.classList.toggle('is-visible', !showing);
    btn.setAttribute('aria-pressed', String(!showing));
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
}

async function handleLogin(e) {
    e.preventDefault();
    const pw = document.getElementById('password');
    const errEl = document.getElementById('errorMsg');
    const btn = document.getElementById('submitBtn');

    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw.value })
        });

        if (res.ok) {
            window.location.href = '/contact-list.html';
        } else {
            pw.classList.add('invalid');
            errEl.textContent = 'Wrong password. Try again.';
            pw.value = '';
            setTimeout(() => pw.classList.remove('invalid'), 600);
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sign in';
        pw.focus();
    }
}

document.getElementById('loginForm').addEventListener('submit', handleLogin);
document.getElementById('pwToggle').addEventListener('click', togglePw);
