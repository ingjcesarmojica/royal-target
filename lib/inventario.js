const CAMPOS = ['CODIGO_DANE', 'MUNICIPIO', 'DEPTO', 'COD_LOCAL', 'LOCAL', 'EST_DIRECCION', 'NIT', 'OPERADOR', 'CONTRATO'];

const PERIODOS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

const MARCAS = [
  { m: 'NOVOMATIC', w: 18 },
  { m: 'IGT INTERNATIONAL', w: 16 },
  { m: 'SCIENTIFIC GAMES', w: 11 },
  { m: 'ARISTOCRAT', w: 9 },
  { m: 'APEX', w: 7 },
  { m: 'ALFASTREET', w: 7 },
  { m: 'TECHNOLOGY', w: 6 },
  { m: 'TV GLOBAL ENTERPRISES', w: 5 },
  { m: 'CAESARS INTERNATIONAL', w: 4 },
  { m: 'IST INTERNATIONAL', w: 4 },
  { m: 'P-RANDO', w: 4 },
  { m: 'EVERI', w: 3 },
  { m: 'WMMS', w: 3 },
  { m: 'VPX', w: 3 },
  { m: 'BALLY', w: 3 }
];

const COD_APUESTA = ['<= $200', '<= $500', '<= $1000', '<= $1500'];

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(arr, rnd) {
  return arr[Math.floor(rnd() * arr.length)];
}

function pickMarca(rnd) {
  const total = MARCAS.reduce((s, x) => s + x.w, 0);
  let r = rnd() * total;
  for (const x of MARCAS) {
    r -= x.w;
    if (r <= 0) return x.m;
  }
  return 'NOVOMATIC';
}

function tipoFromNombre(nombre) {
  const n = String(nombre || '').toUpperCase();
  if (n.includes('BINGO')) return 'Bingo';
  if (n.includes('TRAGAMONEDA')) return 'Sala de Tragamonedas';
  if (n.includes('SALON') || n.includes('SALÓN')) return 'Salón de Juegos';
  if (n.includes('CASINO')) return 'Casino';
  const h = hashSeed(n || 'x') % 4;
  return ['Casino', 'Sala de Tragamonedas', 'Salón de Juegos', 'Bingo'][h];
}

function serialPara(rnd) {
  const t = rnd();
  if (t < 0.5) return String(1000000000 + Math.floor(rnd() * 900000000));
  if (t < 0.7) return `${pick(['MO', 'IG', 'SG', 'AR', 'AP'], rnd)}${10000 + Math.floor(rnd() * 89999)}`;
  if (t < 0.85) return `COL-${10000000 + Math.floor(rnd() * 89999999)}`;
  return `W${1000000 + Math.floor(rnd() * 8999999)}`;
}

function claveEstablecimiento(est) {
  return `${est.CODIGO_DANE}|${est.COD_LOCAL}|${est.CONTRATO}|${est.NIT}|${est.OPERADOR}`;
}

function generarMaquinasEstablecimiento(est) {
  const key = claveEstablecimiento(est);
  const rnd = mulberry32(hashSeed(key));
  const tipo = est.TIPO_ESTABLECIMIENTO || tipoFromNombre(est.OPERADOR);
  const cantidad = 8 + Math.floor(rnd() * 55);
  const nreBase = 1000000000 + (hashSeed(key) % 700000000);
  const maquinas = [];
  for (let i = 0; i < cantidad; i++) {
    const idxAlta = Math.floor(rnd() * PERIODOS.length * 0.75);
    const alta = PERIODOS[idxAlta];
    let baja = null;
    if (rnd() < 0.05 && idxAlta < PERIODOS.length - 2) {
      baja = PERIODOS[Math.min(idxAlta + 1 + Math.floor(rnd() * 3), PERIODOS.length - 1)];
    }
    maquinas.push({
      NRE: String(nreBase + i * 13 + Math.floor(rnd() * 11)),
      SERIAL: serialPara(rnd),
      MARCA: pickMarca(rnd),
      COD_APUESTA: pick(COD_APUESTA, rnd),
      MET_ONLINE: rnd() < 0.35 ? 1 : 0,
      DIVISA: rnd() < 0.05 ? 'USD' : 'COP',
      TIPO_ESTABLECIMIENTO: tipo,
      PERIODO_ALTA: alta,
      PERIODO_BAJA: baja,
      CODIGO_DANE: est.CODIGO_DANE,
      MUNICIPIO: est.MUNICIPIO,
      DEPTO: est.DEPTO,
      COD_LOCAL: est.COD_LOCAL,
      LOCAL: est.LOCAL,
      EST_DIRECCION: est.EST_DIRECCION,
      NIT: est.NIT,
      OPERADOR: est.OPERADOR,
      CONTRATO: est.CONTRATO
    });
  }
  return maquinas;
}

function normalizeLineViejo(line) {
  let l = String(line).replace(/\r$/, '');
  if (l.startsWith('"') && l.endsWith('"') && l.length > 1) {
    l = l.slice(1, -1).replace(/""/g, '"');
  }
  return l;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsvCon(lines, transform) {
  if (!lines.length) return { filas: [], faltantes: CAMPOS.slice() };
  const header = parseCsvLine(transform(lines[0])).map((h) =>
    h.trim().toUpperCase().replace(/^"|"$/g, '')
  );
  const faltantes = CAMPOS.filter((c) => !header.includes(c));
  const idx = {};
  CAMPOS.forEach((c) => {
    idx[c] = header.indexOf(c);
  });
  const filas = [];
  for (const line of lines.slice(1)) {
    const vals = parseCsvLine(transform(line));
    const row = {};
    let conDatos = false;
    for (const c of CAMPOS) {
      const i = idx[c];
      row[c] = i >= 0 && i < vals.length ? String(vals[i]).trim() : '';
      if (row[c]) conDatos = true;
    }
    if (conDatos && row.CODIGO_DANE && (row.OPERADOR || row.CONTRATO)) filas.push(row);
  }
  return { filas, faltantes };
}

function parseCsv(texto) {
  const lines = String(texto)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return { filas: [], faltantes: CAMPOS.slice() };

  // 1) CSV estandar: "campo","campo"
  const estandar = parseCsvCon(lines, (l) => l);
  if (!estandar.faltantes.length && estandar.filas.length) return estandar;

  // 2) Formato antiguo: "campo1,""campo2"",..."
  const viejo = parseCsvCon(lines, normalizeLineViejo);
  if (!viejo.faltantes.length && viejo.filas.length) return viejo;

  return estandar.faltantes.length ? estandar : viejo;
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function serializarCsv(filas) {
  const lines = [CAMPOS.join(',')];
  for (const f of filas) lines.push(CAMPOS.map((c) => csvEscape(f[c])).join(','));
  return lines.join('\n') + '\n';
}

function prepararEstablecimientos(filas) {
  return filas.map((e) => ({
    ...e,
    TIPO_ESTABLECIMIENTO: tipoFromNombre(e.OPERADOR)
  }));
}

module.exports = {
  CAMPOS,
  PERIODOS,
  hashSeed,
  mulberry32,
  tipoFromNombre,
  generarMaquinasEstablecimiento,
  claveEstablecimiento,
  parseCsv,
  serializarCsv,
  prepararEstablecimientos
};
