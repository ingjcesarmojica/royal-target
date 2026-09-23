const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  CAMPOS,
  parseCsv,
  serializarCsv,
  prepararEstablecimientos,
  generarMaquinasEstablecimiento,
  tipoFromNombre
} = require('./lib/inventario');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CSV_PATH = path.join(DATA_DIR, 'establecimientos.csv');
const JSON_PATH = path.join(DATA_DIR, 'establecimientos.json');
const MOV_PATH = path.join(DATA_DIR, 'movimientos.json');
const USU_PATH = path.join(DATA_DIR, 'usuarios.json');

const PORT = process.env.PORT || 3000;

let establecimientos = [];
let movimientos = [];
let usuarios = [];

function cargarEstablecimientos() {
  if (fs.existsSync(JSON_PATH)) {
    establecimientos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    return;
  }
  if (fs.existsSync(CSV_PATH)) {
    const { filas } = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
    establecimientos = prepararEstablecimientos(filas);
    return;
  }
  const original = path.join(ROOT, 'Juegoslocalizados.csv');
  if (fs.existsSync(original)) {
    const { filas } = parseCsv(fs.readFileSync(original, 'utf8'));
    establecimientos = prepararEstablecimientos(filas);
    return;
  }
  establecimientos = [];
}

function cargarDatos() {
  cargarEstablecimientos();
  movimientos = fs.existsSync(MOV_PATH) ? JSON.parse(fs.readFileSync(MOV_PATH, 'utf8')) : [];
  usuarios = fs.existsSync(USU_PATH) ? JSON.parse(fs.readFileSync(USU_PATH, 'utf8')) : [];
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function verificarPassword(user, clave) {
  if (!user || !user.salt || !user.hash) return false;
  const h = hashPassword(clave, user.salt);
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function periodoActivo(m, periodo) {
  if (!periodo || periodo === 'TODOS') return true;
  if (m.PERIODO_ALTA && m.PERIODO_ALTA > periodo) return false;
  if (m.PERIODO_BAJA && m.PERIODO_BAJA <= periodo) return false;
  return true;
}

function textoEst(e) {
  return {
    depto: String(e.DEPTO || '').toUpperCase(),
    muni: String(e.MUNICIPIO || '').toUpperCase(),
    nombre: String(e.OPERADOR || '').toUpperCase(),
    operador: String(e.LOCAL || '').toUpperCase(),
    tipo: String(e.TIPO_ESTABLECIMIENTO || tipoFromNombre(e.OPERADOR)).toUpperCase()
  };
}

function extraerFiltros(req) {
  const q = req.query;
  return {
    departamento: (q.departamento || '').trim().toUpperCase(),
    municipio: (q.municipio || '').trim().toUpperCase(),
    tipo: (q.tipo || '').trim().toUpperCase(),
    nombre: (q.nombre || '').trim().toUpperCase(),
    operador: (q.operador || '').trim().toUpperCase(),
    divisa: (q.divisa || '').trim().toUpperCase(),
    periodo: (q.periodo || 'TODOS').trim() || 'TODOS',
    casilla: (q.casilla || '').trim().toUpperCase()
  };
}

function pasaEstablecimiento(e, f) {
  const t = textoEst(e);
  if (f.departamento && t.depto !== f.departamento) return false;
  if (f.municipio && t.muni !== f.municipio) return false;
  if (f.tipo && t.tipo !== f.tipo) return false;
  if (f.nombre && !t.nombre.includes(f.nombre)) return false;
  if (f.operador && !t.operador.includes(f.operador)) return false;
  return true;
}

function pasaMaquina(m, f) {
  if (f.divisa && String(m.DIVISA || '').toUpperCase() !== f.divisa) return false;
  if (!periodoActivo(m, f.periodo)) return false;
  if (f.casilla) {
    const t = `${m.NRE || ''} ${m.SERIAL || ''}`.toUpperCase();
    if (!t.includes(f.casilla)) return false;
  }
  return true;
}

function filtrarEstablecimientos(f) {
  return establecimientos.filter((e) => pasaEstablecimiento(e, f));
}

function paginarMaquinas(f, page, size) {
  const ests = filtrarEstablecimientos(f);
  const total = ests.reduce((acc, est) => {
    let n = 0;
    for (const m of generarMaquinasEstablecimiento(est)) {
      if (pasaMaquina(m, f)) n++;
    }
    return acc + n;
  }, 0);

  const datos = [];
  const desde = (page - 1) * size;
  let contador = 0;
  for (const est of ests) {
    for (const m of generarMaquinasEstablecimiento(est)) {
      if (!pasaMaquina(m, f)) continue;
      if (contador >= desde && contador < desde + size) datos.push(m);
      contador++;
      if (contador >= desde + size) break;
    }
    if (contador >= desde + size) break;
  }

  return {
    total,
    page,
    size,
    paginas: Math.max(1, Math.ceil(total / size)),
    datos
  };
}

function filtrarMovimientos(f) {
  const deptoDe = (operador, contrato) => {
    const est = establecimientos.find((e) => e.OPERADOR === operador && e.CONTRATO === contrato);
    return est ? String(est.DEPTO || '').toUpperCase() : '';
  };
  return movimientos.filter((mv) => {
    if (f.departamento) {
      const dOri = deptoDe(mv.ORIGEN_OPERADOR, mv.ORIGEN_CONTRATO);
      const dDes = deptoDe(mv.DESTINO_OPERADOR, mv.DESTINO_CONTRATO);
      if (dOri !== f.departamento && dDes !== f.departamento) return false;
    }
    if (f.periodo !== 'TODOS' && !String(mv.FECHA || '').startsWith(f.periodo)) return false;
    return true;
  });
}

function resumen(f) {
  const ests = filtrarEstablecimientos(f);
  const porTipo = {};
  const porMarca = {};
  const porOperador = {};
  const porDepto = {};
  const porMuni = {};
  const porMes = {};
  const operadoresSet = new Set();
  const deptosSet = new Set();
  let total = 0;
  let online = 0;

  for (const est of ests) {
    const tipo = est.TIPO_ESTABLECIMIENTO || tipoFromNombre(est.OPERADOR);
    for (const m of generarMaquinasEstablecimiento(est)) {
      if (!pasaMaquina(m, f)) continue;
      total++;
      porTipo[tipo] = (porTipo[tipo] || 0) + 1;
      porMarca[m.MARCA || 'S/D'] = (porMarca[m.MARCA || 'S/D'] || 0) + 1;
      const op = m.LOCAL || 'S/D';
      porOperador[op] = (porOperador[op] || 0) + 1;
      const dep = m.DEPTO || 'S/D';
      porDepto[dep] = (porDepto[dep] || 0) + 1;
      const muniKey = `${m.DEPTO || ''} / ${m.MUNICIPIO || ''}`;
      porMuni[muniKey] = (porMuni[muniKey] || 0) + 1;
      if (m.MET_ONLINE) online++;
      operadoresSet.add(op);
      deptosSet.add(dep);
      const mes = m.PERIODO_ALTA || 'desconocido';
      porMes[mes] = (porMes[mes] || 0) + 1;
    }
  }

  const ordenar = (obj) =>
    Object.entries(obj)
      .map(([nombre, v]) => ({ nombre, total: v }))
      .sort((a, b) => b.total - a.total);

  const marcas = ordenar(porMarca);

  return {
    total_maquinas: total,
    total_establecimientos: ests.length,
    total_operadores: operadoresSet.size,
    total_departamentos: deptosSet.size,
    total_online: online,
    total_terminal: total - online,
    por_tipo: ordenar(porTipo),
    por_marca: marcas,
    top5_marcas: marcas.slice(0, 5),
    por_operador: ordenar(porOperador).slice(0, 20),
    por_departamento: ordenar(porDepto),
    por_municipio: ordenar(porMuni).slice(0, 30),
    por_mes: ordenar(porMes).sort((a, b) => (a.nombre < b.nombre ? -1 : 1))
  };
}

function catalogos() {
  const deptos = [...new Set(establecimientos.map((e) => e.DEPTO).filter(Boolean))].sort();
  const municipios = [...new Set(establecimientos.map((e) => e.MUNICIPIO).filter(Boolean))].sort();
  const nombres = [...new Set(establecimientos.map((e) => e.OPERADOR).filter(Boolean))].sort();
  const operadores = [...new Set(establecimientos.map((e) => e.LOCAL).filter(Boolean))].sort();
  const tipos = [...new Set(establecimientos.map((e) => e.TIPO_ESTABLECIMIENTO || tipoFromNombre(e.OPERADOR)))].sort();
  const periodos = [...new Set(movimientos.map((m) => String(m.FECHA || '').slice(0, 7)).filter(Boolean))];
  const periodosAlta = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  return {
    departamentos: deptos,
    municipios,
    nombres,
    operadores,
    tipos,
    divisas: ['COP', 'USD'],
    periodos: [...new Set([...periodosAlta, ...periodos])].sort(),
    campos: CAMPOS
  };
}

function exigirLogin(req, res, next) {
  if (req.session && req.session.usuario) return next();
  res.status(401).json({ error: 'Sesion requerida' });
}

function exigirAdmin(req, res, next) {
  if (req.session && req.session.usuario && req.session.usuario.rol === 'admin') return next();
  res.status(403).json({ error: 'Requiere rol administrador' });
}

function guardarEstablecimientos(filas) {
  const texto = serializarCsv(filas);
  const preparados = prepararEstablecimientos(filas);
  fs.writeFileSync(CSV_PATH, texto, 'utf8');
  fs.writeFileSync(JSON_PATH, JSON.stringify(preparados), 'utf8');
  establecimientos = preparados;
}

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
  })
);

app.use('/public', express.static(PUBLIC_DIR));
app.get('/vendor/chart.js', (req, res) => {
  res.sendFile(path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'));
});

app.get('/', (req, res) => {
  if (req.session && req.session.usuario) return res.redirect('/app');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/app', (req, res) => {
  if (!req.session || !req.session.usuario) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
});

app.post('/api/login', (req, res) => {
  const { usuario, clave } = req.body || {};
  if (!usuario || !clave) return res.status(400).json({ error: 'Usuario y clave obligatorios' });
  const u = usuarios.find((x) => x.usuario.toLowerCase() === String(usuario).toLowerCase() && x.activo !== false);
  if (!verificarPassword(u, clave)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session.usuario = { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
  res.json({ ok: true, usuario: req.session.usuario });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/sesion', (req, res) => {
  if (!req.session || !req.session.usuario) return res.status(401).json({ error: 'Sin sesion' });
  res.json({ usuario: req.session.usuario });
});

app.get('/api/catalogos', exigirLogin, (req, res) => res.json(catalogos()));

app.get('/api/resumen', exigirLogin, (req, res) => {
  res.json(resumen(extraerFiltros(req)));
});

app.get('/api/establecimientos', exigirLogin, (req, res) => {
  const f = extraerFiltros(req);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const size = Math.min(200, Math.max(5, parseInt(req.query.size || '50', 10)));
  const todos = filtrarEstablecimientos(f);
  const total = todos.length;
  const start = (page - 1) * size;
  res.json({
    total,
    page,
    size,
    paginas: Math.max(1, Math.ceil(total / size)),
    datos: todos.slice(start, start + size)
  });
});

app.get('/api/inventario', exigirLogin, (req, res) => {
  const f = extraerFiltros(req);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const size = Math.min(500, Math.max(10, parseInt(req.query.size || '100', 10)));
  res.json(paginarMaquinas(f, page, size));
});

app.get('/api/movimientos', exigirLogin, (req, res) => {
  const f = extraerFiltros(req);
  const todos = filtrarMovimientos(f);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const size = Math.min(200, Math.max(10, parseInt(req.query.size || '50', 10)));
  const total = todos.length;
  const start = (page - 1) * size;
  res.json({
    total,
    page,
    size,
    paginas: Math.max(1, Math.ceil(total / size)),
    datos: todos.slice(start, start + size)
  });
});

app.get('/api/usuarios', exigirLogin, exigirAdmin, (req, res) => {
  res.json(usuarios.map(({ hash, salt, ...u }) => u));
});

app.post('/api/usuarios', exigirLogin, exigirAdmin, (req, res) => {
  const { usuario, nombre, clave, rol } = req.body || {};
  if (!usuario || !nombre || !clave || !rol) return res.status(400).json({ error: 'Faltan campos' });
  if (!['admin', 'consulta'].includes(rol)) return res.status(400).json({ error: 'Rol invalido' });
  if (String(clave).length < 6) return res.status(400).json({ error: 'La clave debe tener minimo 6 caracteres' });
  if (usuarios.some((u) => u.usuario.toLowerCase() === String(usuario).toLowerCase()))
    return res.status(409).json({ error: 'El usuario ya existe' });
  const salt = crypto.randomBytes(16).toString('hex');
  const nuevo = {
    id: usuarios.reduce((m, u) => Math.max(m, u.id), 0) + 1,
    usuario: String(usuario).trim(),
    nombre: String(nombre).trim(),
    rol,
    activo: true,
    salt,
    hash: hashPassword(clave, salt)
  };
  usuarios.push(nuevo);
  fs.writeFileSync(USU_PATH, JSON.stringify(usuarios, null, 2), 'utf8');
  const { hash, salt: s, ...publico } = nuevo;
  res.json({ ok: true, usuario: publico });
});

app.patch('/api/usuarios/:id', exigirLogin, exigirAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = usuarios.find((x) => x.id === id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { nombre, clave, rol, activo } = req.body || {};
  if (nombre) u.nombre = String(nombre).trim();
  if (rol) {
    if (!['admin', 'consulta'].includes(rol)) return res.status(400).json({ error: 'Rol invalido' });
    u.rol = rol;
  }
  if (typeof activo === 'boolean') {
    if (req.session.usuario.id === id && activo === false)
      return res.status(400).json({ error: 'No puede desactivar su propio usuario' });
    u.activo = activo;
  }
  if (clave) {
    if (String(clave).length < 6) return res.status(400).json({ error: 'La clave debe tener minimo 6 caracteres' });
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPassword(clave, u.salt);
  }
  fs.writeFileSync(USU_PATH, JSON.stringify(usuarios, null, 2), 'utf8');
  res.json({ ok: true });
});

app.delete('/api/usuarios/:id', exigirLogin, exigirAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.session.usuario.id === id) return res.status(400).json({ error: 'No puede eliminar su propio usuario' });
  const antes = usuarios.length;
  usuarios = usuarios.filter((u) => u.id !== id);
  if (usuarios.length === antes) return res.status(404).json({ error: 'Usuario no encontrado' });
  fs.writeFileSync(USU_PATH, JSON.stringify(usuarios, null, 2), 'utf8');
  res.json({ ok: true });
});

app.post('/api/importar-csv', exigirLogin, exigirAdmin, (req, res) => {
  const { csv } = req.body || {};
  if (!csv || !String(csv).trim()) return res.status(400).json({ error: 'CSV vacio' });
  const { filas, faltantes } = parseCsv(csv);
  if (faltantes.length) {
    return res.status(400).json({ error: `Faltan columnas obligatorias: ${faltantes.join(', ')}` });
  }
  if (!filas.length) return res.status(400).json({ error: 'El CSV no tiene filas de datos' });

  guardarEstablecimientos(filas);

  // tambien deja el archivo en la raiz para que sea la fuente fija
  const raiz = path.join(ROOT, 'Juegoslocalizados.csv');
  try {
    fs.writeFileSync(raiz, serializarCsv(filas), 'utf8');
  } catch (_) {}

  res.json({
    ok: true,
    importados: filas.length,
    mensaje: `CSV fijo actualizado: ${filas.length} establecimientos. Ya carga solo al iniciar.`
  });
});

app.post('/api/recargar', exigirLogin, exigirAdmin, (req, res) => {
  cargarDatos();
  res.json({ ok: true, establecimientos: establecimientos.length, movimientos: movimientos.length });
});

cargarDatos();

const t0 = Date.now();
const nEst = establecimientos.length;
// precarga de conteo aproximado de maquinas (1 pasada liviana)
let muestra = 0;
const limite = Math.min(200, nEst);
for (let i = 0; i < limite; i++) {
  muestra += generarMaquinasEstablecimiento(establecimientos[i]).length;
}
const promedio = limite ? muestra / limite : 0;
const totalAprox = Math.round(promedio * nEst);

if (!fs.existsSync(USU_PATH)) {
  console.warn('No se encontraron usuarios. Ejecute: npm run generar-datos');
}

app.listen(PORT, () => {
  console.log(`Visor Casinos Colombia -> http://localhost:${PORT}`);
  console.log(`Datos fijos cargados en ${Date.now() - t0} ms`);
  console.log(`Establecimientos: ${nEst} | Maquinas estimadas: ${totalAprox} | Movimientos: ${movimientos.length}`);
  if (!nEst) console.warn('ADVERTENCIA: sin establecimientos. Ejecute: npm run generar-datos');
});
