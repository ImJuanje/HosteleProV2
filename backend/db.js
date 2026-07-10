const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'database.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS mesas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero INTEGER NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS categorias (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT DEFAULT '',
    precio REAL NOT NULL,
    alergenos TEXT DEFAULT '[]', -- JSON serializado, ej: ["gluten","huevo"]
    popular INTEGER DEFAULT 0,
    disponible INTEGER DEFAULT 1,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
  );

  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa TEXT, -- NULL cuando tipo = 'llevar'
    estado TEXT NOT NULL DEFAULT 'enviado', -- enviado | en_preparacion | listo | entregado
    creado_en TEXT NOT NULL,
    total REAL NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'mesa', -- mesa | llevar
    telefono TEXT DEFAULT '' -- solo relevante cuando tipo = 'llevar'
  );

  CREATE TABLE IF NOT EXISTS pedido_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    precio_unitario REAL NOT NULL,
    cantidad INTEGER NOT NULL,
    notas TEXT DEFAULT '',
    preparado INTEGER DEFAULT 0, -- marcado individualmente por cocina antes de cerrar el pedido completo
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
  );
`);

// Migración para bases de datos que ya existían antes de estas columnas
// (por ejemplo la que ya tienes desplegada en Railway). CREATE TABLE IF NOT
// EXISTS no añade columnas nuevas a una tabla que ya existe, así que hace
// falta este paso aparte. Es seguro ejecutarlo siempre: si la columna ya
// existe, simplemente lo ignora.
function columnaExiste(tabla, columna) {
  const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all();
  return columnas.some(c => c.name === columna);
}

if (!columnaExiste('pedido_items', 'preparado')) {
  db.exec(`ALTER TABLE pedido_items ADD COLUMN preparado INTEGER DEFAULT 0`);
}
if (!columnaExiste('pedidos', 'tipo')) {
  db.exec(`ALTER TABLE pedidos ADD COLUMN tipo TEXT DEFAULT 'mesa'`);
}
if (!columnaExiste('pedidos', 'telefono')) {
  db.exec(`ALTER TABLE pedidos ADD COLUMN telefono TEXT DEFAULT ''`);
}

module.exports = db;
