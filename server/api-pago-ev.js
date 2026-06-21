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
  const { plan_id, usuario_id, usuario_email, usuario_nombre,
          incluye_matricula, incluye_addon, boost, compra_id } = req.body;

  // ── BOOST FLOW ────────────────────────────────────────────────
  if (boost) {
    if (!usuario_id || !usuario_email || !compra_id) {
      return res.status(400).json({ error: 'Faltan datos para el boost' });
    }
    try {
      // Validar que la compra exista, pertenezca al usuario y esté activa
      const { data: compra } = await sb
        .from('compras')
        .select('id, fecha_fin, estado')
        .eq('id', compra_id)
        .eq('alumna_id', usuario_id)
        .eq('estado', 'activo')
        .maybeSingle();

      if (!compra) {
        return res.status(400).json({ error: 'No se encontró un plan activo para aplicar el boost' });
      }

      // Obtener o crear el plan Boost en la tabla planes (auto-creación al primer uso)
      let { data: boostPlan } = await sb.from('planes')
        .select('id')
        .eq('tipo', 'boost')
        .maybeSingle();

      if (!boostPlan) {
        const { data: nuevo, error: planErr } = await sb.from('planes')
          .insert({ nombre: 'Boost 1 día', tipo: 'boost', precio: 1990, ilimitado: false, clases: null })
          .select('id')
          .single();
        if (planErr) console.error('Error creando plan boost:', planErr);
        boostPlan = nuevo;
        console.log(`✅ Plan Boost auto-creado con id: ${boostPlan?.id}`);
      }

      const pref = new Preference(mp);
      const result = await pref.create({
        body: {
          items: [{
            id:          'boost-1-dia',
            title:       'Boost 1 día — Espacio Vuela',
            quantity:    1,
            unit_price:  1990,
            currency_id: 'CLP'
          }],
          payer: { email: usuario_email, name: usuario_nombre || '' },
          back_urls: {
            success: `${process.env.CLIENT_URL}/pago-exitoso.html`,
            pending: `${process.env.CLIENT_URL}/pago-pendiente.html`,
            failure: `${process.env.CLIENT_URL}/pago-fallido.html`
          },
          auto_return: 'approved',
          notification_url: `${process.env.SERVER_URL}/webhook`,
          metadata: {
            tipo:        'boost',
            plan_id:     boostPlan ? String(boostPlan.id) : null,
            compra_id:   String(compra_id),
            usuario_id:  String(usuario_id),
            monto_total: 1990
          }
        }
      });

      return res.json({ checkout_url: result.init_point });
    } catch (err) {
      console.error('Error creando preferencia boost:', err);
      return res.status(500).json({ error: 'Error al crear preferencia de pago' });
    }
  }

  // ── PLAN NORMAL ───────────────────────────────────────────────
  if (!plan_id || !usuario_id || !usuario_email) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  // Obtener plan principal + precios de matricula y addon desde Supabase
  const { data: planesDB, error: planError } = await sb
    .from('planes')
    .select('*')
    .in('tipo', ['vuela', 'muevete', 'gym', 'clase_suelta', 'clase_prueba', 'asesoria', 'boost', 'matricula', 'addon_gym'])
    .eq('activo', true);

  if (planError || !planesDB) {
    return res.status(500).json({ error: 'Error al obtener planes' });
  }

  const plan = planesDB.find(p => p.id === plan_id);
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

  const planMatricula = planesDB.find(p => p.tipo === 'matricula');
  const planAddon     = planesDB.find(p => p.tipo === 'addon_gym');

  // Calcular monto total en el servidor
  let monto_total = plan.precio;
  const items = [
    { id: String(plan.id), title: plan.nombre, quantity: 1, unit_price: plan.precio, currency_id: 'CLP' }
  ];

  if (incluye_matricula && planMatricula) {
    items.push({ id: 'matricula', title: planMatricula.nombre, quantity: 1, unit_price: planMatricula.precio, currency_id: 'CLP' });
    monto_total += planMatricula.precio;
  }

  if (incluye_addon && planAddon) {
    items.push({ id: 'addon_gym', title: planAddon.nombre, quantity: 1, unit_price: planAddon.precio, currency_id: 'CLP' });
    monto_total += planAddon.precio;
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
          plan_clases:       plan.cantidad_clases ?? null,
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
    res.status(500).json({ ok: false, clases_descontadas: 0, error: err.message });
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
    res.status(500).json({ ok: false, total_clases_generadas: 0, detalle: [], error: err.message });
  }
});

// ── WEBHOOK MERCADOPAGO ───────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responder inmediatamente para que MP no reintente

  const { type, data, action } = req.body;
  const esNotificacionPago = type === 'payment' || action === 'payment.updated' || action === 'payment.created';
  if (!esNotificacionPago || !data?.id) return;

  try {
    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    if (!resp.ok) throw new Error(`MP API respondió ${resp.status}`);
    const pago = await resp.json();

    if (pago.status !== 'approved') {
      console.log(`Pago ${data.id} estado: ${pago.status} — ignorado`);
      return;
    }

    const meta = pago.metadata;
    const esBoost = meta?.tipo === 'boost';

    if ((!meta?.plan_id && !esBoost) || !meta?.usuario_id) {
      console.error('Webhook sin metadata válida:', meta);
      return;
    }

    // Evitar duplicados (cubre plans normales Y boosts via fila de tracking)
    const { data: existente } = await sb
      .from('compras')
      .select('id')
      .eq('mp_payment_id', String(pago.id))
      .maybeSingle();

    if (existente) {
      console.log(`Pago ${pago.id} ya registrado — ignorando duplicado`);
      return;
    }

    // ── BOOST: extender fecha_fin + 1 día ─────────────────────────
    if (esBoost) {
      if (!meta.compra_id) {
        console.error('Boost webhook sin compra_id:', meta);
        return;
      }

      const { data: compra, error: compraErr } = await sb
        .from('compras')
        .select('id, fecha_fin, estado')
        .eq('id', meta.compra_id)
        .eq('alumna_id', meta.usuario_id)
        .maybeSingle();

      if (compraErr || !compra) {
        console.error(`Boost: compra ${meta.compra_id} no encontrada para alumna ${meta.usuario_id}`);
        return;
      }

      // Calcular nueva fecha_fin (+1 día)
      const finActual = new Date(compra.fecha_fin + 'T12:00:00');
      finActual.setDate(finActual.getDate() + 1);
      const nuevaFechaFin = finActual.toISOString().split('T')[0];

      // Aplicar extensión
      const { error: updateErr } = await sb
        .from('compras')
        .update({ fecha_fin: nuevaFechaFin })
        .eq('id', meta.compra_id)
        .eq('alumna_id', meta.usuario_id);

      if (updateErr) {
        console.error('Boost: error actualizando fecha_fin:', updateErr);
        return;
      }

      // Fila de tracking para dedup en reintentos (estado='boost', invisible al cliente)
      const hoyStr = new Date().toISOString().split('T')[0];
      const { error: trackErr } = await sb.from('compras').insert({
        alumna_id:          meta.usuario_id,
        plan_id:            meta.plan_id || null,
        fecha_inicio:       hoyStr,
        fecha_fin:          nuevaFechaFin,
        estado:             'boost',
        clases_disponibles: null,
        clases_usadas:      0,
        ilimitado:          false,
        incluye_gym:        false,
        addon_gym:          false,
        congelado_desde:    null,
        dias_congelados:    0,
        monto_pagado:       1990,
        matricula_pagada:   false,
        clase_prueba:       false,
        mp_payment_id:      String(pago.id)
      });

      if (trackErr) console.warn('Boost: fila de tracking no insertada:', trackErr.message);

      console.log(`✅ Boost aplicado — alumna: ${meta.usuario_id} | compra: ${meta.compra_id} | fecha_fin: ${compra.fecha_fin} → ${nuevaFechaFin} | pago MP: ${pago.id}`);
      return;
    }

    // ── PLAN NORMAL: calcular fechas
    const hoy = new Date();
    const fecha_inicio = hoy.toISOString().split('T')[0];
    const fin = new Date(hoy);
    fin.setDate(fin.getDate() + 29);
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
