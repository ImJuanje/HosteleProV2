// Ejecutar con: node seed.js  (o "railway run node seed.js" para la BD real)
//
// Este script BORRA y vuelve a crear mesas, categorías y productos a partir
// de los arrays de abajo. Es la forma de actualizar la carta o el número de
// mesas por ahora, mientras no exista un panel de administración:
//   1. Edita los arrays NUMERO_DE_MESAS / categorias / productos aquí abajo
//   2. Guarda y ejecuta este archivo otra vez
//
// Es seguro: los pedidos ya hechos no se tocan (cada línea de pedido guarda
// su propio nombre/precio, no depende de la tabla de productos).

const db = require('./db');

const NUMERO_DE_MESAS = 10; // cámbialo al número real de mesas del local

const categorias = [
  { id: 'picar', nombre: 'Para Picar', orden: 1 },
  { id: 'raciones', nombre: 'Raciones', orden: 2 },
  { id: 'bebidas', nombre: 'Bebidas', orden: 3 },
  { id: 'postres', nombre: 'Postres', orden: 4 }
];

const productos = [
  { categoria_id: 'picar', nombre: 'Patatas bravas', descripcion: 'Con alioli casero y salsa brava picante.', precio: 5.50, alergenos: ['huevo'], popular: 1 },
  { categoria_id: 'picar', nombre: 'Croquetas de jamón', descripcion: '6 unidades, receta de la abuela.', precio: 6.80, alergenos: ['gluten', 'lácteos'], popular: 1 },
  { categoria_id: 'picar', nombre: 'Pimientos de Padrón', descripcion: 'Fritos con sal gruesa.', precio: 4.90, alergenos: [] },
  { categoria_id: 'picar', nombre: 'Boquerones en vinagre', descripcion: '', precio: 6.20, alergenos: ['pescado'] },

  { categoria_id: 'raciones', nombre: 'Jamón ibérico', descripcion: 'Cortado a cuchillo, bellota 100%.', precio: 14.00, alergenos: [], popular: 1 },
  { categoria_id: 'raciones', nombre: 'Calamares a la andaluza', descripcion: 'Con limón y mahonesa.', precio: 11.50, alergenos: ['gluten', 'moluscos'] },
  { categoria_id: 'raciones', nombre: 'Tortilla de patatas', descripcion: 'Con o sin cebolla, a elegir.', precio: 8.00, alergenos: ['huevo'] },

  { categoria_id: 'bebidas', nombre: 'Caña', descripcion: '', precio: 1.80, alergenos: ['gluten'] },
  { categoria_id: 'bebidas', nombre: 'Vino de la casa (copa)', descripcion: 'Tinto o blanco.', precio: 2.20, alergenos: ['sulfitos'] },
  { categoria_id: 'bebidas', nombre: 'Refresco', descripcion: '', precio: 2.00, alergenos: [] },

  { categoria_id: 'postres', nombre: 'Flan casero', descripcion: '', precio: 3.50, alergenos: ['huevo', 'lácteos'] },
  { categoria_id: 'postres', nombre: 'Tarta de queso', descripcion: '', precio: 4.20, alergenos: ['lácteos', 'gluten'], popular: 1 }
];

// ---------- Borrar todo lo anterior ----------
db.exec(`DELETE FROM productos; DELETE FROM categorias; DELETE FROM mesas;`);

// ---------- Repoblar ----------
const insertarMesa = db.prepare(`INSERT INTO mesas (numero) VALUES (?)`);
for (let n = 1; n <= NUMERO_DE_MESAS; n++) {
  insertarMesa.run(n);
}

const insertarCategoria = db.prepare(`INSERT INTO categorias (id, nombre, orden) VALUES (?, ?, ?)`);
categorias.forEach(c => insertarCategoria.run(c.id, c.nombre, c.orden));

const insertarProducto = db.prepare(`
  INSERT INTO productos (categoria_id, nombre, descripcion, precio, alergenos, popular)
  VALUES (?, ?, ?, ?, ?, ?)
`);
productos.forEach(p => {
  insertarProducto.run(p.categoria_id, p.nombre, p.descripcion, p.precio, JSON.stringify(p.alergenos), p.popular || 0);
});

console.log(`Repoblado: ${NUMERO_DE_MESAS} mesas, ${categorias.length} categorías, ${productos.length} productos.`);
