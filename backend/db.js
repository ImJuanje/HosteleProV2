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
    mesa TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'enviado', -- enviado | en_preparacion | listo | entregado
    creado_en TEXT NOT NULL,
    total REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pedido_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    precio_unitario REAL NOT NULL,
    cantidad INTEGER NOT NULL,
    notas TEXT DEFAULT '',
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
  );
`);

module.exports = db;
