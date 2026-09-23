document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = document.getElementById('error');
  error.textContent = '';
  const usuario = document.getElementById('usuario').value.trim();
  const clave = document.getElementById('clave').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, clave })
    });
    const data = await res.json();
    if (!res.ok) {
      error.textContent = data.error || 'Error de acceso';
      return;
    }
    window.location.href = '/app';
  } catch (err) {
    error.textContent = 'No se pudo conectar con el servidor';
  }
});
