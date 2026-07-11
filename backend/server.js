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
  `INSERT INTO pedidos (mesa, estado, creado_en, total, tipo, telefono) VALUES (?, 'enviado', datetime('now'), ?, ?, ?)`
);
const insertarItem = db.prepare(
  `INSERT INTO pedido_items (pedido_id, nombre, precio_unitario, cantidad, notas) VALUES (?, ?, ?, ?, ?)`
);
const actualizarEstadoPedido = db.prepare(`UPDATE pedidos SET estado = ? WHERE id = ?`);
const actualizarItemPreparado = db.prepare(`UPDATE pedido_items SET preparado = ? WHERE id = ?`);
const pedidosPendientes = db.prepare(
  `SELECT * FROM pedidos WHERE estado != 'entregado' ORDER BY creado_en ASC`
);
const pedidosHistorico = db.prepare(
  `SELECT * FROM pedidos WHERE estado = 'entregado' ORDER BY creado_en DESC LIMIT 50`
);
const itemsDePedido = db.prepare(`SELECT * FROM pedido_items WHERE pedido_id = ?`);

// Todo lo servido en una mesa que aún no se ha cobrado — esto es lo que
// alimenta el botón "Cobrar", y es intencionadamente independiente de lo
// que la pantalla del camarero tenga cargado en memoria en ese momento
// (los pedidos ya "entregados" desaparecen del tablero activo, pero siguen
// pendientes de cobro hasta que se pulsa "Cobrar").
const cuentaDeMesa = db.prepare(
  `SELECT * FROM pedidos WHERE mesa = ? AND estado = 'entregado' AND cobrado = 0 ORDER BY creado_en ASC`
);
const marcarMesaCobrada = db.prepare(
  `UPDATE pedidos SET cobrado = 1, cobrado_en = datetime('now') WHERE mesa = ? AND estado = 'entregado' AND cobrado = 0`
);

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

// Histórico — para recuperar comandas ya entregadas en caso de error o duda.
// Limitado a las últimas 50 para no cargar de más; si hace falta buscar más
// atrás, esto es lo primero que habría que ampliar (filtro por fecha, etc.)
app.get('/api/pedidos/historico', (req, res) => {
  const historico = pedidosHistorico.all().map(pedido => ({
    ...pedido,
    items: itemsDePedido.all(pedido.id)
  }));
  res.json(historico);
});

// Cuenta pendiente de una mesa: todo lo servido y no cobrado todavía,
// agrupado por producto para poder imprimir un ticket único aunque hayan
// sido varias rondas/comandas distintas. :mesa va tal cual se guarda en BD
// (p.ej. "MESA 5"), así que hay que mandarlo con encodeURIComponent.
app.get('/api/mesas/:mesa/cuenta', (req, res) => {
  const mesa = req.params.mesa;
  const pedidos = cuentaDeMesa.all(mesa).map(pedido => ({
    ...pedido,
    items: itemsDePedido.all(pedido.id)
  }));

  const agrupados = {};
  pedidos.forEach(pedido => {
    pedido.items.forEach(item => {
      const clave = item.nombre + '|' + item.precio_unitario;
      if (!agrupados[clave]) {
        agrupados[clave] = { nombre: item.nombre, precio_unitario: item.precio_unitario, cantidad: 0 };
      }
      agrupados[clave].cantidad += item.cantidad;
    });
  });

  const itemsAgrupados = Object.values(agrupados).map(i => ({
    ...i,
    subtotal: Math.round(i.precio_unitario * i.cantidad * 100) / 100
  }));

  const total = Math.round(pedidos.reduce((suma, p) => suma + p.total, 0) * 100) / 100;

  res.json({ mesa, pedidos, itemsAgrupados, total });
});
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

// ---------- Analíticas ----------
// Calcula la medianoche de "hoy" y la de mañana, en la zona horaria del
// restaurante, expresadas como texto UTC ('YYYY-MM-DD HH:MM:SS') para poder
// comparar directamente con creado_en (que se guarda con datetime('now'),
// en UTC). Así "hoy" se corta a medianoche real del restaurante y no a la
// medianoche UTC del servidor (que en España cae a las 1-2 de la madrugada).
const ZONA_HORARIA_RESTAURANTE = 'Europe/Madrid';

function desplazamientoMinutos(zonaHoraria, fecha) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaHoraria, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(fecha).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  const comoUTC = Date.UTC(
    Number(partes.year), Number(partes.month) - 1, Number(partes.day),
    Number(partes.hour) % 24, Number(partes.minute), Number(partes.second)
  );
  return (comoUTC - fecha.getTime()) / 60000;
}

function limitesDeHoyUTC(zonaHoraria = ZONA_HORARIA_RESTAURANTE) {
  const ahora = new Date();
  const offsetMin = desplazamientoMinutos(zonaHoraria, ahora);
  const localAhora = new Date(ahora.getTime() + offsetMin * 60000);
  const y = localAhora.getUTCFullYear(), m = localAhora.getUTCMonth(), d = localAhora.getUTCDate();

  const inicioLocalComoUTC = Date.UTC(y, m, d, 0, 0, 0);
  const finLocalComoUTC = Date.UTC(y, m, d + 1, 0, 0, 0);

  const aFormatoSQLite = (ms) => new Date(ms - offsetMin * 60000).toISOString().slice(0, 19).replace('T', ' ');
  return { inicio: aFormatoSQLite(inicioLocalComoUTC), fin: aFormatoSQLite(finLocalComoUTC) };
}

app.get('/api/analytics', (req, res) => {

  try {

    const { inicio, fin } = limitesDeHoyUTC();

    const caja = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM pedidos
      WHERE estado = 'entregado' AND creado_en >= ? AND creado_en < ?
    `).get(inicio, fin);

    const ticket = db.prepare(`
      SELECT ROUND(AVG(total), 2) as media
      FROM pedidos
      WHERE estado = 'entregado' AND creado_en >= ? AND creado_en < ?
    `).get(inicio, fin);

    const comandas = db.prepare(`
      SELECT COUNT(*) as total
      FROM pedidos
      WHERE estado = 'entregado' AND creado_en >= ? AND creado_en < ?
    `).get(inicio, fin);

    const getTop = (categoria) => {

      return db.prepare(`
        SELECT
          pi.nombre,
          SUM(pi.cantidad) as ventas
        FROM pedido_items pi
        JOIN pedidos ped ON ped.id = pi.pedido_id
        JOIN productos p ON p.nombre = pi.nombre
        WHERE p.categoria_id = ?
          AND ped.estado = 'entregado' AND ped.creado_en >= ? AND ped.creado_en < ?
        GROUP BY pi.nombre
        ORDER BY ventas DESC
        LIMIT 5
      `).all(categoria, inicio, fin);

    };

    // Ranking general (todas las categorías juntas), sin límite — el
    // frontend decide cuántos enseña de entrada y cuántos con "mostrar más".
    const topGeneral = db.prepare(`
      SELECT
        pi.nombre,
        SUM(pi.cantidad) as ventas
      FROM pedido_items pi
      JOIN pedidos ped ON ped.id = pi.pedido_id
      WHERE ped.estado = 'entregado' AND ped.creado_en >= ? AND ped.creado_en < ?
      GROUP BY pi.nombre
      ORDER BY ventas DESC
    `).all(inicio, fin);

    res.json({
      caja: caja.total || 0,
      ticket: ticket.media || 0,
      comandas: comandas.total || 0,
      topGeneral,
      picar: getTop('picar'),
      raciones: getTop('raciones'),
      bebidas: getTop('bebidas'),
      postres: getTop('postres'),
      rango: { inicio, fin, zonaHoraria: ZONA_HORARIA_RESTAURANTE }
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'analytics_error'
    });

  }

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

  // La carta digital (o camarero, para comandas manuales/para llevar)
  // manda esto cuando se confirma un pedido.
  socket.on('nuevo-pedido', (datos) => {
    try {
      const { items, total } = datos;
      const tipo = datos.tipo === 'llevar' ? 'llevar' : 'mesa';
      const mesa = tipo === 'mesa' ? datos.mesa : null;
      const telefono = tipo === 'llevar' ? (datos.telefono || '').trim() : '';

      if (!Array.isArray(items) || items.length === 0) {
        socket.emit('error-pedido', { mensaje: 'Pedido incompleto' });
        return;
      }
      if (tipo === 'mesa' && !mesa) {
        socket.emit('error-pedido', { mensaje: 'Falta la mesa' });
        return;
      }
      if (tipo === 'llevar' && !telefono) {
        socket.emit('error-pedido', { mensaje: 'Falta el teléfono de contacto' });
        return;
      }

      const resultado = insertarPedido.run(mesa, total, tipo, telefono);
      const pedidoId = resultado.lastInsertRowid;

      // Guardamos cada línea y nos quedamos con el id real que le da la BD,
      // porque cocina necesita ese id para marcar líneas sueltas como preparadas.
      const itemsConId = items.map(item => {
        const resultadoItem = insertarItem.run(pedidoId, item.nombre, item.precio, item.cantidad, item.notas || '');
        return {
          id: resultadoItem.lastInsertRowid,
          nombre: item.nombre,
          precio_unitario: item.precio,
          cantidad: item.cantidad,
          notas: item.notas || '',
          preparado: 0
        };
      });

      const pedidoCompleto = {
        id: pedidoId,
        mesa,
        tipo,
        telefono,
        items: itemsConId,
        total,
        estado: 'enviado',
        creado_en: new Date().toISOString()
      };

      io.to('cocina').to('camarero').emit('pedido-recibido', pedidoCompleto);
      socket.emit('pedido-confirmado', { id: pedidoId, mesa, tipo });
    } catch (error) {
      console.error('Error al guardar pedido:', error);
      socket.emit('error-pedido', { mensaje: 'No se pudo procesar el pedido' });
    }
  });

  // Cocina marca (o desmarca) una línea suelta como preparada, antes de
  // cerrar el pedido completo.
  socket.on('item-preparado', (datos) => {
    const { itemId, preparado } = datos;
    actualizarItemPreparado.run(preparado ? 1 : 0, itemId);
    io.to('cocina').to('camarero').emit('item-actualizado', { itemId, preparado: !!preparado });
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

  // Camarero cobra una mesa entera: cierra (marca cobrado=1) todos los
  // pedidos servidos y pendientes de pago de esa mesa. No toca el estado
  // ("entregado" se queda igual, solo cambia si está pagado o no), así que
  // esto no afecta a las métricas de ventas del día ni a cocina.
  socket.on('cobrar-mesa', (datos) => {
    const { mesa } = datos;
    if (!mesa) return;
    const idsAntesDeMarcar = cuentaDeMesa.all(mesa).map(p => p.id);
    if (idsAntesDeMarcar.length === 0) return;
    marcarMesaCobrada.run(mesa);
    io.to('camarero').emit('mesa-cobrada', { mesa, pedidoIds: idsAntesDeMarcar });
  });

  socket.on('disconnect', () => {
    console.log('Desconectado:', socket.id);
  });
});

const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => {
  console.log(`Servidor escuchando en puerto ${PUERTO}`);
});