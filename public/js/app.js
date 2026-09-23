const state = {
  usuario: null,
  vista: 'general',
  resumen: null,
  charts: {},
  invPage: 1,
  estPage: 1,
  movPage: 1,
  serPage: 1,
  serQuery: ''
};

const $ = (id) => document.getElementById(id);

function toast(msg, esError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast visible' + (esError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 3500);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('Sesion expirada');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de solicitud');
  return data;
}

function paramsFiltros(extra = {}) {
  const p = new URLSearchParams();
  const mapa = {
    departamento: $('f-departamento').value,
    municipio: $('f-municipio').value,
    tipo: $('f-tipo').value,
    nombre: $('f-nombre').value.trim(),
    operador: $('f-operador').value.trim(),
    divisa: $('f-divisa').value,
    periodo: $('f-periodo').value || 'TODOS'
  };
  for (const [k, v] of Object.entries(mapa)) if (v) p.set(k, v);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return p;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('es-CO');
}

function destruirChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    delete state.charts[key];
  }
}

function crearChart(key, canvasId, config) {
  const canvas = $(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  destruirChart(key);
  Chart.defaults.color = '#8fb9cc';
  Chart.defaults.borderColor = 'rgba(46,230,246,0.15)';
  state.charts[key] = new Chart(canvas.getContext('2d'), config);
}

function colores(n) {
  const base = ['#2ee6f6', '#f59e0b', '#34d399', '#a78bfa', '#f472b6', '#60a5fa', '#fbbf24', '#2dd4bf', '#fb7185', '#94a3b8'];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}

async function initSesion() {
  try {
    const data = await api('/api/sesion');
    state.usuario = data.usuario;
    $('sesion-nombre').textContent = data.usuario.nombre;
    $('sesion-rol').textContent = data.usuario.rol === 'admin' ? '[Administrador]' : '[Consulta]';
    if (data.usuario.rol === 'admin') {
      $('btn-usuarios').style.display = '';
      $('btn-importar').style.display = '';
    }
  } catch {
    window.location.href = '/';
  }
}

async function cargarCatalogos() {
  const cat = await api('/api/catalogos');
  const llenar = (select, items, conTodos = true) => {
    const actual = select.value;
    select.innerHTML = conTodos ? '<option value="">Todos</option>' : '<option value="">Todos</option>';
    items.forEach((it) => {
      const o = document.createElement('option');
      o.value = it;
      o.textContent = it;
      select.appendChild(o);
    });
    select.value = [...select.options].some((o) => o.value === actual) ? actual : '';
  };
  llenar($('f-departamento'), cat.departamentos);
  llenar($('f-municipio'), cat.municipios);
  llenar($('f-tipo'), cat.tipos);
  llenar($('f-divisa'), cat.divisas);
  llenar($('f-periodo'), cat.periodos);
  $('f-periodo').insertAdjacentHTML('afterbegin', '<option value="TODOS">Todos</option>');
  $('f-periodo').value = 'TODOS';

  const dl = $('lista-nombres');
  dl.innerHTML = cat.nombres.map((n) => `<option value="${n.replace(/"/g, '&quot;')}">`).join('');
  const dlo = $('lista-operadores');
  dlo.innerHTML = cat.operadores.map((n) => `<option value="${n.replace(/"/g, '&quot;')}">`).join('');

  state.catalogos = cat;
}

function filtrarMunicipiosPorBusqueda() {
  const q = $('f-busca-municipio').value.trim().toUpperCase();
  const cat = state.catalogos;
  if (!cat) return;
  const depto = $('f-departamento').value;
  let items = cat.municipios;
  if (q) items = items.filter((m) => m.toUpperCase().includes(q));
  const sel = $('f-municipio');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' + items.map((m) => `<option value="${m}">${m}</option>`).join('');
  if ([...sel.options].some((o) => o.value === actual)) sel.value = actual;
}

function pintarFiltrosEnTitulos() {
  const depto = $('f-departamento').value;
  const muni = $('f-municipio').value;
  const titulos = {
    general: 'Reporte General',
    operadores: 'Análisis por Operador',
    fabricantes: 'Análisis de Fabricantes',
    establecimientos: 'Establecimientos Autorizados',
    geografia: 'Ubicación Geográfica',
    serial: 'Registro Serial',
    movimientos: 'Movimientos'
  };
  let t = titulos[state.vista] || 'Visor';
  if (depto) t = depto;
  if (muni) t = muni;
  $('titulo-pagina').textContent = t.toUpperCase();
}

async function cargarResumen() {
  const res = await api('/api/resumen?' + paramsFiltros());
  state.resumen = res;
  pintarKpis(res);
  pintarGeneral(res);
  pintarOperadores(res);
  pintarFabricantes(res);
  pintarGeografia(res);
  if (state.vista === 'establecimientos') {
    crearChart('online', 'ch-online', {
      type: 'doughnut',
      data: {
        labels: ['Online', 'Terminal'],
        datasets: [{ data: [res.total_online, res.total_terminal], backgroundColor: ['#f59e0b', '#2ee6f6'], borderColor: '#061021', borderWidth: 2 }]
      },
      options: { plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } }, maintainAspectRatio: false }
    });
    crearChart('top5lat', 'ch-top5-lateral', donutMarcas(res));
    $('est-total').textContent = fmt(res.total_maquinas);
    $('fab-total').textContent = fmt(res.total_maquinas);
  }
}

function pintarKpis(r) {
  $('kpi-maquinas').textContent = fmt(r.total_maquinas);
  $('kpi-establecimientos').textContent = fmt(r.total_establecimientos);
  $('kpi-operadores').textContent = fmt(r.total_operadores);
  $('kpi-departamentos').textContent = fmt(r.total_departamentos);
  $('kpi-online').textContent = fmt(r.total_online);
}

function donutMarcas(r) {
  return {
    type: 'doughnut',
    data: {
      labels: r.top5_marcas.map((x) => x.nombre),
      datasets: [{
        data: r.top5_marcas.map((x) => x.total),
        backgroundColor: colores(r.top5_marcas.length),
        borderColor: '#061021',
        borderWidth: 2
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12 } } }
    }
  };
}

function pintarGeneral(r) {
  crearChart('tipo', 'ch-tipo', {
    type: 'doughnut',
    data: {
      labels: r.por_tipo.map((x) => x.nombre),
      datasets: [{ data: r.por_tipo.map((x) => x.total), backgroundColor: ['#f59e0b', '#2ee6f6', '#34d399', '#a78bfa'], borderColor: '#061021', borderWidth: 2 }]
    },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } }
  });

  const topDepto = r.por_departamento.slice(0, 10);
  crearChart('depto', 'ch-depto', {
    type: 'bar',
    data: {
      labels: topDepto.map((x) => x.nombre),
      datasets: [{ label: 'Máquinas', data: topDepto.map((x) => x.total), backgroundColor: '#2ee6f6aa' }]
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: 'rgba(46,230,246,0.08)' } }, y: { grid: { display: false } } }
    }
  });

  crearChart('mes', 'ch-mes', {
    type: 'line',
    data: {
      labels: r.por_mes.map((x) => x.nombre),
      datasets: [{
        label: 'Altas de máquinas',
        data: r.por_mes.map((x) => x.total),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.15)',
        fill: true,
        tension: 0.3
      }]
    },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  crearChart('top5', 'ch-top5', donutMarcas(r));
}

function pintarOperadores(r) {
  const ops = r.por_operador.slice(0, 15);
  crearChart('opers', 'ch-operadores', {
    type: 'bar',
    data: {
      labels: ops.map((x) => x.nombre),
      datasets: [{ label: 'Máquinas', data: ops.map((x) => x.total), backgroundColor: '#f59e0baa' }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { maxRotation: 60, minRotation: 45, font: { size: 9 } }, grid: { display: false } }, y: { grid: { color: 'rgba(46,230,246,0.08)' } } }
    }
  });

  const total = r.total_maquinas || 1;
  $('tb-operadores').innerHTML = r.por_operador.length
    ? r.por_operador.map((x) => `
      <tr>
        <td>${esc(x.nombre)}</td>
        <td class="num">${fmt(x.total)}</td>
        <td class="num">${((x.total / total) * 100).toFixed(1)}%</td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="vacio">Sin datos</td></tr>';
}

function pintarFabricantes(r) {
  const total = r.total_maquinas || 1;
  $('tb-marcas').innerHTML = r.por_marca.length
    ? r.por_marca.map((x) => `
      <tr>
        <td>${esc(x.nombre)}</td>
        <td class="num">${fmt(x.total)}</td>
        <td class="num">${((x.total / total) * 100).toFixed(1)}%</td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="vacio">Sin datos</td></tr>';

  crearChart('marcasDona', 'ch-marcas-dona', {
    type: 'doughnut',
    data: {
      labels: r.por_marca.slice(0, 8).map((x) => x.nombre),
      datasets: [{
        data: r.por_marca.slice(0, 8).map((x) => x.total),
        backgroundColor: colores(8),
        borderColor: '#061021',
        borderWidth: 2
      }]
    },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 10 } } } }
  });
  $('fab-total').textContent = fmt(r.total_maquinas);
}

function pintarGeografia(r) {
  const deptos = r.por_departamento;
  crearChart('geo', 'ch-geo', {
    type: 'bar',
    data: {
      labels: deptos.map((x) => x.nombre),
      datasets: [{ label: 'Máquinas', data: deptos.map((x) => x.total), backgroundColor: '#2ee6f6aa' }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxRotation: 70, minRotation: 50, font: { size: 9 } }, grid: { display: false } },
        y: { grid: { color: 'rgba(46,230,246,0.08)' } }
      }
    }
  });

  $('tb-geo').innerHTML = r.por_municipio.length
    ? r.por_municipio.map((x) => `<tr><td>${esc(x.nombre)}</td><td class="num">${fmt(x.total)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="vacio">Sin datos</td></tr>';

  $('tb-deptos').innerHTML = deptos.length
    ? deptos.map((x) => `<tr><td>${esc(x.nombre)}</td><td class="num">${fmt(x.total)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="vacio">Sin datos</td></tr>';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function cargarInventario() {
  const p = paramsFiltros({ page: state.invPage, size: 120 });
  const data = await api('/api/inventario?' + p);
  state.invPage = data.page;
  $('tb-inventario').innerHTML = data.datos.length
    ? data.datos.map((m) => `
      <tr>
        <td class="ops">${esc(m.LOCAL)}</td>
        <td>${esc(m.CONTRATO)}</td>
        <td>${esc(m.OPERADOR)}</td>
        <td>${esc(m.NRE)}</td>
        <td>${esc(m.SERIAL)}</td>
        <td>${esc(m.MARCA)}</td>
        <td>${esc(m.COD_APUESTA)}</td>
        <td>${m.MET_ONLINE ? '1' : '0'}</td>
      </tr>`).join('')
    : '<tr><td colspan="8" class="vacio">Sin resultados</td></tr>';
  $('inv-info').textContent = `Página ${data.page} de ${data.paginas} · ${fmt(data.total)} registros`;
  if (state.resumen) {
    $('est-total').textContent = fmt(state.resumen.total_maquinas);
  }
}

async function cargarEstablecimientos() {
  const p = paramsFiltros({ page: state.estPage, size: 50 });
  const data = await api('/api/establecimientos?' + p);
  state.estPage = data.page;
  $('tb-establecimientos').innerHTML = data.datos.length
    ? data.datos.map((e) => `
      <tr>
        <td>${esc(e.CODIGO_DANE)}</td>
        <td>${esc(e.MUNICIPIO)}</td>
        <td>${esc(e.DEPTO)}</td>
        <td>${esc(e.COD_LOCAL)}</td>
        <td>${esc(e.LOCAL)}</td>
        <td>${esc(e.EST_DIRECCION)}</td>
        <td>${esc(e.NIT)}</td>
        <td>${esc(e.OPERADOR)}</td>
        <td>${esc(e.CONTRATO)}</td>
      </tr>`).join('')
    : '<tr><td colspan="9" class="vacio">Sin resultados</td></tr>';
  $('est-info').textContent = `Página ${data.page} de ${data.paginas} · ${fmt(data.total)} establecimientos`;
}

async function cargarMovimientos() {
  const p = paramsFiltros({ page: state.movPage, size: 80 });
  const data = await api('/api/movimientos?' + p);
  state.movPage = data.page;
  $('tb-movimientos').innerHTML = data.datos.length
    ? data.datos.map((m) => `
      <tr>
        <td>${esc(m.FECHA)}</td>
        <td>${esc(m.TIPO)}</td>
        <td>${esc(m.NRE)}</td>
        <td>${esc(m.SERIAL)}</td>
        <td>${esc(m.MARCA)}</td>
        <td>${esc(m.ORIGEN_OPERADOR)} (${esc(m.ORIGEN_CONTRATO)})</td>
        <td>${esc(m.DESTINO_OPERADOR)} (${esc(m.DESTINO_CONTRATO)})</td>
        <td>${esc(m.DESTINO_DEPTO)}</td>
        <td>${esc(m.USUARIO)}</td>
      </tr>`).join('')
    : '<tr><td colspan="9" class="vacio">Sin resultados</td></tr>';
  $('mov-info').textContent = `Página ${data.page} de ${data.paginas} · ${fmt(data.total)} movimientos`;
}

async function buscarSerial(reset = true) {
  if (reset) state.serPage = 1;
  const q = $('f-serial').value.trim();
  const p = paramsFiltros({ casilla: q, page: state.serPage, size: 100 });
  const data = await api('/api/inventario?' + p);
  state.serPage = data.page;
  $('tb-serial').innerHTML = data.datos.length
    ? data.datos.map((m) => `
      <tr>
        <td>${esc(m.NRE)}</td>
        <td>${esc(m.SERIAL)}</td>
        <td>${esc(m.MARCA)}</td>
        <td>${esc(m.OPERADOR)}</td>
        <td>${esc(m.LOCAL)}</td>
        <td>${esc(m.CONTRATO)}</td>
        <td>${esc(m.DEPTO)}</td>
        <td>${esc(m.DIVISA)}</td>
        <td>${esc(m.PERIODO_ALTA)}</td>
      </tr>`).join('')
    : '<tr><td colspan="9" class="vacio">Sin coincidencias</td></tr>';
  $('ser-info').textContent = `Página ${data.page} de ${data.paginas} · ${fmt(data.total)} resultados`;
}

async function refrescarVista() {
  pintarFiltrosEnTitulos();
  try {
    await cargarResumen();
    if (state.vista === 'establecimientos') {
      await cargarInventario();
      await cargarEstablecimientos();
    }
    if (state.vista === 'movimientos') await cargarMovimientos();
    if (state.vista === 'serial') await buscarSerial();
  } catch (err) {
    toast(err.message, true);
  }
}

function cambiarVista(vista) {
  state.vista = vista;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.vista === vista));
  document.querySelectorAll('.vista').forEach((v) => v.classList.toggle('activa', v.id === `vista-${vista}`));
  refrescarVista();
}

/* ---------- Usuarios ---------- */
async function cargarUsuarios() {
  const lista = await api('/api/usuarios');
  $('tb-usuarios').innerHTML = lista.map((u) => `
    <tr>
      <td>${u.id}</td>
      <td>${esc(u.usuario)}</td>
      <td>${esc(u.nombre)}</td>
      <td>${esc(u.rol)}</td>
      <td>${u.activo === false ? 'No' : 'Sí'}</td>
      <td class="ops">
        <button class="btn" data-act="pwd" data-id="${u.id}">Clave</button>
        <button class="btn" data-act="toggle" data-id="${u.id}">${u.activo === false ? 'Activar' : 'Desactivar'}</button>
        <button class="btn" data-act="del" data-id="${u.id}">Eliminar</button>
      </td>
    </tr>`).join('');
}

/* ---------- Importar CSV ---------- */
async function importarCsv() {
  const input = $('archivo-csv');
  const err = $('import-error');
  err.textContent = '';
  if (!input.files || !input.files[0]) {
    err.textContent = 'Seleccione un archivo CSV';
    return;
  }
  const texto = await input.files[0].text();
  try {
    const data = await api('/api/importar-csv', { method: 'POST', body: JSON.stringify({ csv: texto }) });
    toast(data.mensaje || 'CSV importado correctamente');
    $('modal-importar').classList.remove('abierto');
    input.value = '';
    await cargarCatalogos();
    await refrescarVista();
  } catch (e) {
    err.textContent = e.message;
  }
}

/* ---------- Eventos ---------- */
function bindear() {
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => cambiarVista(b.dataset.vista)));

  $('btn-filtrar').addEventListener('click', () => {
    state.invPage = 1; state.estPage = 1; state.movPage = 1; state.serPage = 1;
    refrescarVista();
    toast('Filtros aplicados');
  });

  $('btn-limpiar').addEventListener('click', () => {
    ['f-departamento', 'f-municipio', 'f-tipo', 'f-nombre', 'f-operador', 'f-divisa', 'f-busca-municipio', 'f-serial'].forEach((id) => { $(id).value = ''; });
    $('f-periodo').value = 'TODOS';
    filtrarMunicipiosPorBusqueda();
    state.invPage = 1; state.estPage = 1; state.movPage = 1; state.serPage = 1;
    refrescarVista();
  });

  $('f-departamento').addEventListener('change', () => {
    filtrarMunicipiosPorBusqueda();
    state.invPage = 1; state.estPage = 1;
    refrescarVista();
  });
  $('f-busca-municipio').addEventListener('input', filtrarMunicipiosPorBusqueda);
  $('f-municipio').addEventListener('change', () => { state.invPage = 1; state.estPage = 1; refrescarVista(); });
  ['f-tipo', 'f-divisa', 'f-periodo'].forEach((id) => $(id).addEventListener('change', () => { state.invPage = 1; refrescarVista(); }));

  let tDeb;
  ['f-nombre', 'f-operador'].forEach((id) => {
    $(id).addEventListener('input', () => {
      clearTimeout(tDeb);
      tDeb = setTimeout(() => { state.invPage = 1; state.estPage = 1; refrescarVista(); }, 400);
    });
  });

  $('inv-ant').addEventListener('click', () => { if (state.invPage > 1) { state.invPage--; cargarInventario(); } });
  $('inv-sig').addEventListener('click', () => { state.invPage++; cargarInventario(); });
  $('est-ant').addEventListener('click', () => { if (state.estPage > 1) { state.estPage--; cargarEstablecimientos(); } });
  $('est-sig').addEventListener('click', () => { state.estPage++; cargarEstablecimientos(); });
  $('mov-ant').addEventListener('click', () => { if (state.movPage > 1) { state.movPage--; cargarMovimientos(); } });
  $('mov-sig').addEventListener('click', () => { state.movPage++; cargarMovimientos(); });
  $('ser-ant').addEventListener('click', () => { if (state.serPage > 1) { state.serPage--; buscarSerial(false); } });
  $('ser-sig').addEventListener('click', () => { state.serPage++; buscarSerial(false); });
  $('btn-buscar-serial').addEventListener('click', () => buscarSerial());
  $('f-serial').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarSerial(); });

  $('btn-salir').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/';
  });

  $('btn-usuarios').addEventListener('click', async () => {
    $('modal-usuarios').classList.add('abierto');
    try { await cargarUsuarios(); } catch (e) { toast(e.message, true); }
  });
  $('cerrar-usuarios').addEventListener('click', () => $('modal-usuarios').classList.remove('abierto'));

  $('form-usuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/usuarios', {
        method: 'POST',
        body: JSON.stringify({
          usuario: $('nu-usuario').value.trim(),
          nombre: $('nu-nombre').value.trim(),
          clave: $('nu-clave').value,
          rol: $('nu-rol').value
        })
      });
      $('nu-usuario').value = ''; $('nu-nombre').value = ''; $('nu-clave').value = '';
      toast('Usuario creado');
      await cargarUsuarios();
    } catch (err) { toast(err.message, true); }
  });

  $('tb-usuarios').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    try {
      if (btn.dataset.act === 'del') {
        if (!confirm('¿Eliminar este usuario?')) return;
        await api('/api/usuarios/' + id, { method: 'DELETE' });
        toast('Usuario eliminado');
      } else if (btn.dataset.act === 'toggle') {
        const lista = await api('/api/usuarios');
        const u = lista.find((x) => x.id === id);
        await api('/api/usuarios/' + id, { method: 'PATCH', body: JSON.stringify({ activo: u.activo === false }) });
        toast('Estado actualizado');
      } else if (btn.dataset.act === 'pwd') {
        const clave = prompt('Nueva contraseña (min. 6 caracteres):');
        if (!clave) return;
        await api('/api/usuarios/' + id, { method: 'PATCH', body: JSON.stringify({ clave }) });
        toast('Contraseña actualizada');
      }
      await cargarUsuarios();
    } catch (err) { toast(err.message, true); }
  });

  $('btn-importar').addEventListener('click', () => {
    $('import-error').textContent = '';
    $('modal-importar').classList.add('abierto');
  });
  $('cerrar-importar').addEventListener('click', () => $('modal-importar').classList.remove('abierto'));
  $('btn-ejecutar-import').addEventListener('click', importarCsv);
}

async function main() {
  await initSesion();
  bindear();
  await cargarCatalogos();
  filtrarMunicipiosPorBusqueda();
  await refrescarVista();
}

main();
