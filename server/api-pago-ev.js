const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'https://vuela-prueba.vicenpinto.workers.dev' }));
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────────
const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, servicio: 'Espacio Vuela Pagos' }));

// ── CREAR PREFERENCIA ─────────────────────────────────────────
app.post('/crear-preferencia', async (req, res) => {
  const { plan_id, usuario_id, usuario_email, usuario_nombre, incluye_matricula, incluye_addon } = req.body;

  if (!plan_id || !usuario_id || !usuario_email) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  // Obtener plan desde Supabase — nunca confiar en precios del cliente
  const { data: plan, error: planError } = await sb
    .from('planes')
    .select('*')
    .eq('id', plan_id)
    .single();

  if (planError || !plan) {
    return res.status(404).json({ error: 'Plan no encontrado' });
  }

  // Calcular monto total en el servidor
  let monto_total = plan.precio;
  const items = [
    { id: String(plan.id), title: plan.nombre, quantity: 1, unit_price: plan.precio, currency_id: 'CLP' }
  ];

  if (incluye_matricula) {
    items.push({ id: 'matricula', title: 'Matrícula Espacio Vuela', quantity: 1, unit_price: 12000, currency_id: 'CLP' });
    monto_total += 12000;
  }

  if (incluye_addon) {
    items.push({ id: 'addon_gym', title: 'Addon Gym — acceso al gimnasio', quantity: 1, unit_price: 13000, currency_id: 'CLP' });
    monto_total += 13000;
  }

  try {
    const preference = new Preference(mp);
    const result = await preference.create({
      body: {
        items,
        payer: { email: usuario_email, name: usuario_nombre || '' },
        back_urls: {
          success: `${process.env.CLIENT_URL}/pago-exitoso.html`,
          pending: `${process.env.CLIENT_URL}/pago-pendiente.html`,
          failure: `${process.env.CLIENT_URL}/pago-fallido.html`
        },
        auto_return: 'approved',
        notification_url: `${process.env.SERVER_URL}/webhook`,
        metadata: {
          plan_id:           String(plan_id),
          usuario_id:        String(usuario_id),
          plan_tipo:         plan.tipo        || '',
          plan_clases:       plan.clases      ?? null,
          plan_ilimitado:    plan.ilimitado   ?? false,
          incluye_matricula: !!incluye_matricula,
          incluye_addon:     !!incluye_addon,
          monto_total:       monto_total
        }
      }
    });

    res.json({ checkout_url: result.init_point });

  } catch (err) {
    console.error('Error al crear preferencia MP:', err);
    res.status(500).json({ error: 'Error al crear preferencia de pago' });
  }
});

// ── DESCONTAR CLASES PRÓXIMAS (cron cada hora) ───────────────
app.get('/descontar-proximas', async (req, res) => {
  try {
    const { data: count } = await sb.rpc('descontar_clases_proximas');
    console.log(`✅ Descontadas ${count} clases`);
    res.json({ ok: true, clases_descontadas: count });
  } catch(err) {
    console.error('Error descontando:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── AUTO-GENERACIÓN DE CLASES (para cron-job.org) ────────────
app.get('/generar-automatico', async (req, res) => {
  const token = req.headers['x-cron-token'] || req.query.token;
  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const { data: horarios } = await sb.from('horarios').select('id, nombre').eq('activo', true);
    let total = 0;
    const detalle = [];
    for (const h of (horarios || [])) {
      const { data: count } = await sb.rpc('generar_clases', { p_horario_id: h.id, p_semanas: 6 });
      total += count || 0;
      detalle.push({ horario: h.nombre, clases_nuevas: count || 0 });
    }
    console.log(`✅ Auto-generación: ${total} clases nuevas`);
    res.json({ ok: true, total_clases_generadas: total, detalle });
  } catch (err) {
    console.error('Error en auto-generación:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── WEBHOOK MERCADOPAGO ───────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responder inmediatamente para que MP no reintente

  const { type, data, action } = req.body;
  const esNotificacionPago = type === 'payment' || action === 'payment.updated' || action === 'payment.created';
  if (!esNotificacionPago || !data?.id) return;

  try {
    const paymentApi = new Payment(mp);
    const pago = await paymentApi.get({ id: data.id });

    if (pago.status !== 'approved') {
      console.log(`Pago ${data.id} estado: ${pago.status} — ignorado`);
      return;
    }

    const meta = pago.metadata;
    if (!meta?.plan_id || !meta?.usuario_id) {
      console.error('Webhook sin metadata válida:', meta);
      return;
    }

    // Evitar duplicados
    const { data: existente } = await sb
      .from('compras')
      .select('id')
      .eq('mp_payment_id', String(pago.id))
      .maybeSingle();

    if (existente) {
      console.log(`Pago ${pago.id} ya registrado — ignorando duplicado`);
      return;
    }

    // Calcular fechas
    const hoy = new Date();
    const fecha_inicio = hoy.toISOString().split('T')[0];
    const fin = new Date(hoy);
    fin.setDate(fin.getDate() + 31);
    const fecha_fin = fin.toISOString().split('T')[0];

    // Insertar compra con el esquema real de la tabla
    const { error: compraError } = await sb.from('compras').insert({
      alumna_id:         meta.usuario_id,
      plan_id:           meta.plan_id,
      fecha_inicio,
      fecha_fin,
      estado:            'activo',
      clases_disponibles: meta.plan_clases   ?? null,
      clases_usadas:     0,
      ilimitado:         !!meta.plan_ilimitado,
      incluye_gym:       !!meta.incluye_addon,
      addon_gym:         !!meta.incluye_addon,
      congelado_desde:   null,
      dias_congelados:   0,
      monto_pagado:      meta.monto_total    || 0,
      matricula_pagada:  !!meta.incluye_matricula,
      clase_prueba:      meta.plan_tipo === 'clase_prueba',
      mp_payment_id:     String(pago.id)
    });

    if (compraError) {
      console.error('Error al guardar compra:', compraError);
      return;
    }

    // Si pagó matrícula → actualizar usuarios
    if (meta.incluye_matricula) {
      await sb.from('usuarios').update({ matricula_pagada: true }).eq('id', meta.usuario_id);
    }

    // Si es clase de prueba → marcar en usuarios
    if (meta.plan_tipo === 'clase_prueba') {
      await sb.from('usuarios').update({ clase_prueba_tomada: true }).eq('id', meta.usuario_id);
    }

    console.log(`✅ Compra registrada — alumna: ${meta.usuario_id} | plan: ${meta.plan_id} | pago: ${pago.id}`);

  } catch (err) {
    console.error('Error procesando webhook:', err);
  }
});

// ── SERVIDOR ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Espacio Vuela Pagos corriendo en puerto ${PORT}`));
