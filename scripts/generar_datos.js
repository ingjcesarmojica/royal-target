const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  parseCsv,
  serializarCsv,
  prepararEstablecimientos,
  generarMaquinasEstablecimiento,
  hashSeed,
  mulberry32
} = require('../lib/inventario');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CSV_ORIGEN = path.join(ROOT, 'Juegoslocalizados.csv');
const CSV_DESTINO = path.join(DATA_DIR, 'establecimientos.csv');
const JSON_DESTINO = path.join(DATA_DIR, 'establecimientos.json');
const MOV_PATH = path.join(DATA_DIR, 'movimientos.json');
const INV_VIEJO = path.join(DATA_DIR, 'inventario.json');
const USU_PATH = path.join(DATA_DIR, 'usuarios.json');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function crearUsuarios() {
  if (fs.existsSync(USU_PATH)) return;
  const usuarios = [
    { id: 1, usuario: 'admin', nombre: 'Administrador', rol: 'admin', activo: true, clave: 'admin123' },
    { id: 2, usuario: 'visitante', nombre: 'Visitante', rol: 'consulta', activo: true, clave: 'visita123' }
  ].map((u) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const { clave, ...resto } = u;
    return { ...resto, salt, hash: hashPassword(clave, salt) };
  });
  fs.writeFileSync(USU_PATH, JSON.stringify(usuarios, null, 2), 'utf8');
}

function generarMovimientos(establecimientos) {
  const rnd = mulberry32(20260922);
  const tipos = ['INGRESO', 'TRASLADO', 'RETIRO', 'MANTENIMIENTO'];
  const movs = [];
  const total = Math.min(2000, Math.max(300, establecimientos.length));
  for (let i = 0; i < total; i++) {
    const est = establecimientos[Math.floor(rnd() * establecimientos.length)];
    const destino = establecimientos[Math.floor(rnd() * establecimientos.length)];
    const maqs = generarMaquinasEstablecimiento(est);
    const m = maqs[Math.floor(rnd() * maqs.length)];
    const mes = 1 + Math.floor(rnd() * 9);
    const dia = 1 + Math.floor(rnd() * 28);
    movs.push({
      FECHA: `2026-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
      TIPO: tipos[Math.floor(rnd() * tipos.length)],
      NRE: m.NRE,
      SERIAL: m.SERIAL,
      MARCA: m.MARCA,
      ORIGEN_OPERADOR: est.OPERADOR,
      ORIGEN_CONTRATO: est.CONTRATO,
      DESTINO_OPERADOR: destino.OPERADOR,
      DESTINO_CONTRATO: destino.CONTRATO,
      DESTINO_DEPTO: destino.DEPTO,
      USUARIO: ['admin', 'operador1', 'operador2', 'auditoria'][Math.floor(rnd() * 4)]
    });
  }
  movs.sort((a, b) => (a.FECHA < b.FECHA ? 1 : -1));
  return movs;
}

function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(CSV_ORIGEN)) {
    console.error('No se encontro Juegoslocalizados.csv en la raiz del proyecto.');
    process.exit(1);
  }

  // Si ya esta procesado y el CSV no cambio, no vuelve a tardar
  const stOrigen = fs.statSync(CSV_ORIGEN);
  if (fs.existsSync(JSON_DESTINO) && fs.existsSync(CSV_DESTINO) && fs.existsSync(MOV_PATH)) {
    const stJson = fs.statSync(JSON_DESTINO);
    if (stJson.mtimeMs >= stOrigen.mtimeMs) {
      console.log('Datos fijos ya cargados (CSV sin cambios).');
      return;
    }
  }

  const texto = fs.readFileSync(CSV_ORIGEN, 'utf8');
  const { filas, faltantes } = parseCsv(texto);
  if (faltantes.length) {
    console.error('Faltan columnas en el CSV:', faltantes.join(', '));
    process.exit(1);
  }
  if (!filas.length) {
    console.error('El CSV no tiene filas de datos.');
    process.exit(1);
  }

  const establecimientos = prepararEstablecimientos(filas);
  fs.writeFileSync(CSV_DESTINO, serializarCsv(filas), 'utf8');
  fs.writeFileSync(JSON_DESTINO, JSON.stringify(establecimientos), 'utf8');

  if (fs.existsSync(INV_VIEJO)) fs.unlinkSync(INV_VIEJO);

  const movimientos = generarMovimientos(establecimientos);
  fs.writeFileSync(MOV_PATH, JSON.stringify(movimientos), 'utf8');

  crearUsuarios();

  const deptos = new Set(establecimientos.map((e) => e.DEPTO));
  console.log(`CSV fijo cargado: ${establecimientos.length} establecimientos`);
  console.log(`Departamentos: ${deptos.size}`);
  console.log(`Movimientos: ${movimientos.length}`);
  console.log(`Datos listos en data/ (se cargan solos al iniciar el servidor)`);
}

main();
