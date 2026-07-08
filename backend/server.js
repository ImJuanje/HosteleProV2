const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // en producción, restringir al dominio de Netlify
});

// ---------- Consultas preparadas ----------
const insertarPedido = db.prepare(
  `INSERT INTO pedidos (mesa, estado, creado_en, total) VALUES (?, 'enviado', datetime('now'), ?)`
);
const insertarItem = db.prepare(
  `INSERT INTO pedido_items (pedido_id, nombre, precio_unitario, cantidad, notas) VALUES (?, ?, ?, ?, ?)`
);
const actualizarEstadoPedido = db.prepare(`UPDATE pedidos SET estado = ? WHERE id = ?`);
const pedidosPendientes = db.prepare(
  `SELECT * FROM pedidos WHERE estado != 'entregado' ORDER BY creado_en ASC`
);
const itemsDePedido = db.prepare(`SELECT * FROM pedido_items WHERE pedido_id = ?`);

function obtenerPedidosPendientesConItems() {
  return pedidosPendientes.all().map(pedido => ({
    ...pedido,
    items: itemsDePedido.all(pedido.id)
  }));
}

// ---------- REST auxiliar ----------
// Lo usa la pantalla de cocina al cargar/recargar, para no perder los
// pedidos que ya estaban en curso antes de conectarse el socket.
app.get('/api/pedidos/pendientes', (req, res) => {
  res.json(obtenerPedidosPendientesConItems());
});

// Origen único de verdad para el número de mesas — lo consumen tanto
// el generador de QR como la pantalla de camarero, para que nunca se
// desincronicen entre sí.
app.get('/api/mesas', (req, res) => {
  const mesas = db.prepare(`SELECT * FROM mesas ORDER BY numero ASC`).all();
  res.json(mesas);
});

// Catálogo completo (categorías + productos disponibles), origen único
// que también usará la carta digital en vez de tener el menú hardcodeado.
app.get('/api/carta', (req, res) => {
  const categorias = db.prepare(`SELECT * FROM categorias ORDER BY orden ASC`).all();
  const productos = db.prepare(`SELECT * FROM productos WHERE disponible = 1`).all()
    .map(p => ({ ...p, alergenos: JSON.parse(p.alergenos || '[]') }));
  res.json({ categorias, productos });
});

app.get('/', (req, res) => {
  res.send('HosteléPro backend funcionando');
});

// ---------- Tiempo real ----------
io.on('connection', (socket) => {
  console.log('Conexión nueva:', socket.id);

  socket.on('unirse-cocina', () => {
    socket.join('cocina');
  });

  socket.on('unirse-camarero', () => {
    socket.join('camarero');
  });

  // La carta digital manda esto cuando el cliente confirma el pedido
  socket.on('nuevo-pedido', (datos) => {
    try {
      const { mesa, items, total } = datos;

      if (!mesa || !Array.isArray(items) || items.length === 0) {
        socket.emit('error-pedido', { mensaje: 'Pedido incompleto' });
        return;
      }

      const resultado = insertarPedido.run(mesa, total);
      const pedidoId = resultado.lastInsertRowid;

      items.forEach(item => {
        insertarItem.run(pedidoId, item.nombre, item.precio, item.cantidad, item.notas || '');
      });

      const pedidoCompleto = {
        id: pedidoId,
        mesa,
        items,
        total,
        estado: 'enviado',
        creado_en: new Date().toISOString()
      };

      io.to('cocina').to('camarero').emit('pedido-recibido', pedidoCompleto);
      socket.emit('pedido-confirmado', { id: pedidoId, mesa });
    } catch (error) {
      console.error('Error al guardar pedido:', error);
      socket.emit('error-pedido', { mensaje: 'No se pudo procesar el pedido' });
    }
  });

  // Cocina marca un pedido como listo
  socket.on('pedido-listo', (datos) => {
    const { id, mesa } = datos;
    actualizarEstadoPedido.run('listo', id);
    io.to('cocina').to('camarero').emit('pedido-actualizado', { id, estado: 'listo' });
    io.to('camarero').emit('aviso-mesa', { mesa, mensaje: 'Pedido listo para servir' });
  });

  // Camarero marca un pedido como entregado en mesa
  socket.on('pedido-entregado', (datos) => {
    const { id } = datos;
    actualizarEstadoPedido.run('entregado', id);
    io.to('cocina').to('camarero').emit('pedido-actualizado', { id, estado: 'entregado' });
  });

  socket.on('disconnect', () => {
    console.log('Desconectado:', socket.id);
  });
});

const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => {
  console.log(`Servidor escuchando en puerto ${PUERTO}`);
});
