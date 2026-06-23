const express   = require('express');
const cors      = require('cors');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const limiterPreferencia = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta en unos minutos.' }
});

// ── VALIDACIÓN DE FIRMA WEBHOOK MERCADOPAGO ───────────────────
// Verifica el header x-signature usando HMAC-SHA256 con MP_WEBHOOK_SECRET.
// Referencia: https://www.mercadopago.cl/developers/es/docs/your-integrations/notifications/webhooks
function validarFirmaMP(req) {
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  const dataId     = req.body?.data?.id;

  if (!xSignature || !xRequestId || !dataId || !process.env.MP_WEBHOOK_SECRET) return false;

  const partes = {};
  xSignature.split(',').forEach(p => {
    const [k, v] = p.split('=');
    if (k && v) partes[k.trim()] = v.trim();
  });
  const { ts, v1 } = partes;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const hmac = crypto
    .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
  } catch {
    return false;
  }
}

// ── CONFIG ────────────────────────────────────────────────────
const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, servicio: 'Espacio Vuela Pagos' }));

// ── DEBUG AUTH (temporal) ─────────────────────────────────────
app.get('/debug-auth', async (req, res) => {
  const origin = req.headers['origin'] || '(sin origin)';
  const auth   = req.headers['authorization'] || '(sin token)';
  const token  = auth.startsWith('Bearer ') ? auth.slice(7, 30) + '…' : '(vacío)';
  const user   = await verificarJWT(req);
  res.json({ origin, tokenInicio: token, userEmail: user?.email || null, ADMIN_EMAIL: process.env.ADMIN_EMAIL || '(no seteado)' });
});

// ── VERIFICAR JWT SUPABASE ────────────────────────────────────
async function verificarJWT(req) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// Verifica que el JWT corresponde a un usuario con rol 'admin' en la DB
async function verificarAdmin(req) {
  const user = await verificarJWT(req);
  if (!user) return null;
  const { data } = await sb.from('usuarios').select('rol').eq('id', user.id).maybeSingle();
  if (data?.rol === 'admin') return user;
  return null;
}

// ── CREAR PREFERENCIA ─────────────────────────────────────────
app.post('/crear-preferencia', limiterPreferencia, async (req, res) => {
  const { plan_id, usuario_id, usuario_email, usuario_nombre,
          incluye_matricula, incluye_addon, boost, compra_id } = req.body;

  // Verificar que el JWT pertenece al usuario que hace la solicitud
  const userAuth = await verificarJWT(req);
  if (!userAuth) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (userAuth.id !== usuario_id) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  // ── BOOST FLOW ────────────────────────────────────────────────
  if (boost) {
    if (!usuario_id || !usuario_email || !compra_id) {
      return res.status(400).json({ error: 'Faltan datos para el boost' });
    }
    try {
      // Validar que la compra exista, pertenezca al usuario, esté activa y no haya vencido por fecha
      const hoyStr = new Date().toISOString().split('T')[0];
      const { data: compra } = await sb
        .from('compras')
        .select('id, fecha_fin, estado')
        .eq('id', compra_id)
        .eq('alumna_id', usuario_id)
        .eq('estado', 'activo')
        .gte('fecha_fin', hoyStr)
        .maybeSingle();

      if (!compra) {
        return res.status(400).json({ error: 'No se encontró un plan activo para aplicar el boost' });
      }

      const { data: boostPlanes } = await sb.from('planes')
        .select('id, precio, nombre')
        .eq('tipo', 'boost')
        .eq('activo', true)
        .limit(1);
      const boostPlan = boostPlanes?.[0] ?? null;

      if (!boostPlan) {
        return res.status(500).json({ error: 'Plan boost no configurado en Supabase' });
      }

      const pref = new Preference(mp);
      const result = await pref.create({
        body: {
          items: [{
            id:          'boost-1-dia',
            title:       boostPlan.nombre,
            quantity:    1,
            unit_price:  boostPlan.precio,
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
            plan_id:     String(boostPlan.id),
            compra_id:   String(compra_id),
            usuario_id:  String(usuario_id),
            monto_total: boostPlan.precio
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

  // Bloquear compra duplicada de clase de prueba
  if (plan.tipo === 'clase_prueba') {
    const { data: yaComprada } = await sb
      .from('compras')
      .select('id')
      .eq('alumna_id', usuario_id)
      .eq('plan_id', plan_id)
      .neq('estado', 'vencido')
      .maybeSingle();
    if (yaComprada) {
      return res.status(400).json({ error: 'Ya adquiriste esta clase de prueba anteriormente.' });
    }
  }

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
  const token = req.headers['x-cron-token'] || req.query.token;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
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
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
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
    const { data: slotsGym } = await sb.rpc('generar_slots_gym', { p_dias: 42 });
    const gymNuevos = slotsGym || 0;
    total += gymNuevos;
    detalle.push({ horario: 'Gym (slots fijos)', clases_nuevas: gymNuevos });
    console.log(`✅ Auto-generación: ${total} clases nuevas (incluye ${gymNuevos} slots de gym)`);
    res.json({ ok: true, total_clases_generadas: total, detalle });
  } catch (err) {
    console.error('Error en auto-generación:', err);
    res.status(500).json({ ok: false, total_clases_generadas: 0, detalle: [], error: err.message });
  }
});

// ── WEBHOOK MERCADOPAGO ───────────────────────────────────────
app.post('/webhook', async (req, res) => {
  if (!validarFirmaMP(req)) {
    console.warn('Webhook rechazado: firma inválida o ausente');
    return res.sendStatus(401);
  }
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
        monto_pagado:       pago.transaction_amount || 0,
        matricula_pagada:   false,
        clase_prueba:       false,
        mp_payment_id:      String(pago.id)
      });

      if (trackErr) console.warn('Boost: fila de tracking no insertada:', trackErr.message);

      console.log(`✅ Boost aplicado — alumna: ${meta.usuario_id} | compra: ${meta.compra_id} | fecha_fin: ${compra.fecha_fin} → ${nuevaFechaFin} | pago MP: ${pago.id}`);
      return;
    }

    // ── PLAN NORMAL: calcular fechas
    // Fecha en zona Chile para evitar desfase UTC vs America/Santiago
    const fechaHoyChile = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    const fecha_inicio  = fechaHoyChile;
    const [y, m, d]     = fechaHoyChile.split('-').map(Number);

    const { data: planData } = await sb.from('planes').select('duracion_dias, cantidad_clases, ilimitado, nombre, tipo').eq('id', meta.plan_id).single();
    const duracion  = planData?.duracion_dias ?? 30;
    const fecha_fin = new Date(Date.UTC(y, m - 1, d + duracion - 1)).toISOString().split('T')[0];

    // Insertar compra con el esquema real de la tabla
    const { error: compraError } = await sb.from('compras').insert({
      alumna_id:         meta.usuario_id,
      plan_id:           meta.plan_id,
      fecha_inicio,
      fecha_fin,
      estado:            'activo',
      clases_disponibles: planData?.cantidad_clases ?? null,
      clases_usadas:     0,
      ilimitado:         planData?.ilimitado ?? false,
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

    // Registrar en pagos_historico para unificación de ingresos
    try {
      const { data: alumnaData } = await sb.from('usuarios').select('nombre,apellido,rut').eq('id', meta.usuario_id).maybeSingle();
      await sb.from('pagos_historico').insert({
        nombre:         alumnaData?.nombre  || null,
        apellido:       alumnaData?.apellido || null,
        rut:            alumnaData?.rut      || null,
        plan_original:  planData?.nombre     || 'Plan',
        plan_nombre:    planData?.nombre     || 'Plan',
        plan_categoria: planData?.tipo       || 'otro',
        incluye_gym:    !!meta.incluye_addon,
        duracion_meses: Math.round((planData?.duracion_dias || 30) / 30),
        monto:          meta.monto_total     || 0,
        estado:         'aprobado',
        tipo_pago:      'mercadopago',
        fecha_pago:     fecha_inicio,
        vendedor:       'mercadopago',
      });
    } catch (e) {
      console.warn('pagos_historico insert (MP):', e.message);
    }

    // Addon gym → compra separada con vencimiento de 30 días fijos
    if (meta.incluye_addon) {
      const { data: addonPlan } = await sb.from('planes').select('id, duracion_dias').eq('tipo', 'addon_gym').eq('activo', true).maybeSingle();
      if (addonPlan) {
        const addonDuracion   = addonPlan.duracion_dias ?? 30;
        const addonFechaFin   = new Date(Date.UTC(y, m - 1, d + addonDuracion - 1)).toISOString().split('T')[0];
        const { error: addonErr } = await sb.from('compras').insert({
          alumna_id:          meta.usuario_id,
          plan_id:            addonPlan.id,
          fecha_inicio,
          fecha_fin:          addonFechaFin,
          estado:             'activo',
          clases_disponibles: null,
          clases_usadas:      0,
          ilimitado:          true,
          incluye_gym:        true,
          addon_gym:          true,
          congelado_desde:    null,
          dias_congelados:    0,
          monto_pagado:       0,
          matricula_pagada:   false,
          clase_prueba:       false,
          mp_payment_id:      String(pago.id) + '_addon'
        });
        // MP ya recibió 200 — no es posible rollback. Log detallado para corrección manual si falla.
        if (addonErr) console.error(`❌ ADDON GYM NO GUARDADO — pago ${pago.id} | alumna ${meta.usuario_id} | fecha_fin ${addonFechaFin} | error: ${addonErr.message}`);
      }
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

// ── IMPORTACIÓN MASIVA ALUMNAS (CRM) ─────────────────────────
app.post('/importar-alumnas', async (req, res) => {
  const userAuth = await verificarAdmin(req);
  if (!userAuth) return res.status(403).json({ error: 'No autorizado' });

  const { alumnas } = req.body;
  if (!Array.isArray(alumnas) || alumnas.length === 0) {
    return res.status(400).json({ error: 'Sin datos' });
  }
  if (alumnas.length > 100) {
    return res.status(400).json({ error: 'Máximo 100 alumnas por batch' });
  }

  const reporte = [];
  let creadas = 0, saltadas = 0, errores = 0;

  for (const a of alumnas) {
    const email  = (a.email  || '').trim().toLowerCase();
    const nombre = (a.nombre || '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      reporte.push({ nombre, email, contrasena: '', resultado: 'error', detalle: 'Email inválido' });
      errores++;
      continue;
    }

    const tel      = (a.telefono || '').replace(/\D/g, '');
    const sufijo   = tel.length >= 4 ? tel.slice(-4) : String(Math.floor(1000 + Math.random() * 9000));
    const contrasena = `Vuela${sufijo}`;
    const telefono   = (a.telefono || '').replace(/\s+/g, '').trim();
    const rut        = (a.rut     || '').replace(/\./g, '').trim();

    try {
      // Llamada directa a la API REST de Supabase Auth para evitar conflictos
      // de estado interno del cliente JS cuando se combina con verificarJWT()
      const authResp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
        method:  'POST',
        headers: {
          'apikey':        process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          email,
          password:      contrasena,
          email_confirm: true,
          user_metadata: { nombre }
        })
      });

      const authJson = await authResp.json();

      if (!authResp.ok) {
        const msg = authJson?.msg || authJson?.message || authJson?.error_description || JSON.stringify(authJson);
        const yaExiste = authResp.status === 422 || msg?.toLowerCase().includes('already');
        if (yaExiste) {
          reporte.push({ nombre, email, contrasena: '', resultado: 'saltada', detalle: 'Email ya registrado' });
          saltadas++;
        } else {
          console.error(`[importar-alumnas] createUser error para ${email}: HTTP ${authResp.status}`, msg);
          reporte.push({ nombre, email, contrasena: '', resultado: 'error', detalle: `HTTP ${authResp.status}: ${msg}` });
          errores++;
        }
        continue;
      }

      const authData = { user: authJson };

      // Separar nombre completo en nombre (primer palabra) y apellido (resto)
      const partes   = nombre.trim().split(/\s+/);
      const primerNombre = partes[0] || '';
      const apellido     = partes.slice(1).join(' ') || '';

      const { error: upsertError } = await sb.from('usuarios').upsert({
        id:               authData.user.id,
        nombre:           primerNombre,
        apellido,
        email,
        rol:              'alumna',
        rut:              rut       || null,
        telefono:         telefono  || null,
        fecha_nacimiento: a.fecha_nacimiento || null,
        observacion:      a.observacion      || null,
        socio_boxmagic:   a.socio_boxmagic   || null,
        estado_boxmagic:  a.estado           || null,
        matricula_pagada:    false,
        clase_prueba_tomada: false
      }, { onConflict: 'id' });

      if (upsertError) {
        console.error(`Error upsert usuario ${email}:`, upsertError.message);
        reporte.push({ nombre, email, contrasena, resultado: 'error_parcial', detalle: `Auth OK · perfil falló: ${upsertError.message}` });
        errores++;
        continue;
      }

      reporte.push({ nombre, email, contrasena, resultado: 'creada', detalle: '' });
      creadas++;
      await new Promise(r => setTimeout(r, 80));

    } catch (err) {
      reporte.push({ nombre, email, contrasena: '', resultado: 'error', detalle: err.message });
      errores++;
    }
  }

  res.json({ creadas, saltadas, errores, reporte });
});

// ── INGRESOS POR MES ─────────────────────────────────────────
app.get('/ingresos-mes', async (req, res) => {
  const userAuth = await verificarAdmin(req);
  if (!userAuth) return res.status(403).json({ error: 'No autorizado' });

  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes))
    return res.status(400).json({ error: 'Parámetro mes inválido' });

  const [y, m] = mes.split('-').map(Number);
  const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
  const endY = m === 12 ? y + 1 : y;
  const endM = m === 12 ? 1  : m + 1;
  const endDate   = `${endY}-${String(endM).padStart(2,'0')}-01`;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevStart = `${prevY}-${String(prevM).padStart(2,'0')}-01`;

  const [mesRes, prevRes] = await Promise.all([
    sb.from('pagos_historico')
      .select('id,nombre,apellido,plan_nombre,plan_categoria,monto,tipo_pago,vendedor,fecha_pago,incluye_gym')
      .gte('fecha_pago', startDate).lt('fecha_pago', endDate)
      .order('fecha_pago', { ascending: false }).limit(5000),
    sb.from('pagos_historico')
      .select('monto')
      .gte('fecha_pago', prevStart).lt('fecha_pago', startDate).limit(5000),
  ]);

  const pagos    = mesRes.data  || [];
  const pagosPrev = prevRes.data || [];

  const totalMes  = pagos.reduce((s,p) => s + (Number(p.monto)||0), 0);
  const totalPrev = pagosPrev.reduce((s,p) => s + (Number(p.monto)||0), 0);
  const diff = totalPrev > 0 ? Math.round(((totalMes - totalPrev) / totalPrev) * 100) : null;

  const porCategoria = {};
  pagos.forEach(p => {
    const cat = p.plan_categoria || 'otro';
    if (!porCategoria[cat]) porCategoria[cat] = { total: 0, count: 0 };
    porCategoria[cat].total += Number(p.monto) || 0;
    porCategoria[cat].count++;
  });

  res.json({ total: totalMes, count: pagos.length, totalPrev, diff, porCategoria, detalle: pagos });
});

// ── REGISTRAR PAGO MANUAL (ADMIN) ────────────────────────────
app.post('/registrar-pago-manual', async (req, res) => {
  const userAuth = await verificarAdmin(req);
  if (!userAuth) return res.status(403).json({ error: 'No autorizado' });

  const { alumna_id, plan_nombre, plan_categoria, incluye_gym, monto, tipo_pago, fecha_pago } = req.body;
  if (!alumna_id || !plan_nombre || !fecha_pago)
    return res.status(400).json({ error: 'Faltan campos requeridos' });

  const { data: alumna } = await sb.from('usuarios').select('nombre,apellido,rut').eq('id', alumna_id).maybeSingle();

  const { error } = await sb.from('pagos_historico').insert({
    nombre:         alumna?.nombre   || null,
    apellido:       alumna?.apellido || null,
    rut:            alumna?.rut      || null,
    plan_original:  plan_nombre,
    plan_nombre,
    plan_categoria: plan_categoria || 'otro',
    incluye_gym:    !!incluye_gym,
    duracion_meses: 1,
    monto:          Number(monto) || 0,
    estado:         'aprobado',
    tipo_pago:      tipo_pago || 'transferencia',
    fecha_pago,
    vendedor:       'admin',
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── ELIMINAR PAGO HISTÓRICO (ADMIN) ──────────────────────────
app.delete('/eliminar-pago/:id', async (req, res) => {
  const userAuth = await verificarAdmin(req);
  if (!userAuth) return res.status(403).json({ error: 'No autorizado' });

  const { error } = await sb.from('pagos_historico').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── ELIMINAR COMPRA (ADMIN) ───────────────────────────────────
app.delete('/eliminar-compra/:id', async (req, res) => {
  const userAuth = await verificarAdmin(req);
  if (!userAuth) return res.status(403).json({ error: 'No autorizado' });

  const compraId = req.params.id;
  if (!compraId) return res.status(400).json({ error: 'Falta id' });

  // Desvincular inscripciones que referencian esta compra
  await sb.from('inscripciones').update({ compra_id: null }).eq('compra_id', compraId);

  const { error } = await sb.from('compras').delete().eq('id', compraId);
  if (error) return res.status(409).json({ error: error.message, details: error.details, hint: error.hint });

  res.json({ ok: true });
});

// ── DASHBOARD STATS ──────────────────────────────────────────
app.get('/dashboard-stats', async (req, res) => {
  const userAuth = await verificarAdmin(req);
  if (!userAuth)
    return res.status(403).json({ error: 'No autorizado' });

  const hoy       = new Date().toISOString().split('T')[0];
  const en14dias  = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  const mesActual = (new Date().getMonth() + 1).toString().padStart(2, '0');

  const [pagosRes, comprasActRes, renovRes, expComprasRes, usuariosRes] = await Promise.all([
    sb.from('pagos_historico').select('fecha_pago,monto,plan_nombre,tipo_pago,vendedor'),
    sb.from('compras').select('alumna_id').eq('estado','activo').gte('fecha_fin', hoy),
    sb.from('compras').select('alumna_id,fecha_fin,planes(nombre)')
      .eq('estado','activo').gte('fecha_fin', hoy).lte('fecha_fin', en14dias).order('fecha_fin'),
    sb.from('compras').select('alumna_id,fecha_fin')
      .lt('fecha_fin', hoy).order('fecha_fin', { ascending: false }).limit(500),
    sb.from('usuarios').select('id,nombre,apellido,email,estado_boxmagic,fecha_nacimiento')
      .eq('rol','alumna').limit(10000),
  ]);

  const pagos    = pagosRes.data    || [];
  const comprasAct  = comprasActRes.data || [];
  const renovRaw    = renovRes.data     || [];
  const expCompras  = expComprasRes.data|| [];
  const usuarios    = usuariosRes.data  || [];

  const usuarioMap    = new Map(usuarios.map(u => [u.id, u]));
  const conPlanActivo = new Set(comprasAct.map(c => c.alumna_id));

  // KPIs
  const totalIngresos   = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const clientesActivos = conPlanActivo.size;
  const totalMembresias = pagos.length;

  // Ventas mensuales
  const porMes = {};
  pagos.forEach(p => {
    if (!p.fecha_pago) return;
    const key = p.fecha_pago.slice(0, 7);
    if (!porMes[key]) porMes[key] = { ingresos: 0, ventas: 0 };
    porMes[key].ingresos += Number(p.monto) || 0;
    porMes[key].ventas++;
  });
  const ventasMensuales = Object.entries(porMes).sort(([a],[b]) => a.localeCompare(b))
    .map(([mes, d]) => ({ mes, ...d }));

  // Estado BoxMagic
  const porEstado = {};
  usuarios.forEach(u => {
    const est = u.estado_boxmagic || 'Sin datos';
    porEstado[est] = (porEstado[est] || 0) + 1;
  });

  // Top 10 planes
  const porPlan = {};
  pagos.forEach(p => {
    const key = p.plan_nombre || 'Desconocido';
    if (!porPlan[key]) porPlan[key] = { ventas: 0, ingresos: 0 };
    porPlan[key].ventas++;
    porPlan[key].ingresos += Number(p.monto) || 0;
  });
  const top10 = Object.entries(porPlan).sort(([,a],[,b]) => b.ventas - a.ventas)
    .slice(0, 10).map(([plan, d]) => ({ plan, ...d }));

  // Renovaciones próximas
  const renovaciones = renovRaw.map(r => {
    const u = usuarioMap.get(r.alumna_id) || {};
    return { nombre: u.nombre||'—', apellido: u.apellido||'', email: u.email||'', plan: r.planes?.nombre||'—', fecha_fin: r.fecha_fin };
  });

  // Por recuperar (tuvieron plan, ya no)
  const seenIds = new Set();
  const porRecuperar = [];
  for (const c of expCompras) {
    if (conPlanActivo.has(c.alumna_id) || seenIds.has(c.alumna_id)) continue;
    seenIds.add(c.alumna_id);
    const u = usuarioMap.get(c.alumna_id);
    if (u) porRecuperar.push({ nombre: u.nombre, apellido: u.apellido, email: u.email, ultima_compra: c.fecha_fin });
    if (porRecuperar.length >= 20) break;
  }

  // Cumpleaños del mes
  const cumpleanos = usuarios
    .filter(u => u.fecha_nacimiento?.slice(5, 7) === mesActual)
    .map(u => ({ nombre: u.nombre, apellido: u.apellido, fecha: u.fecha_nacimiento }))
    .sort((a, b) => parseInt(a.fecha?.slice(8)) - parseInt(b.fecha?.slice(8)));

  // Métodos de pago
  const metodoPago = {};
  const normalizar = (t, v) => {
    const s = (t||'').trim().toLowerCase();
    if ((s.includes('mercado') || s === 'mp') && v === 'mercadopago') return 'Pago web';
    if (s.includes('mercado') || s === 'mp') return 'MercadoPago';
    if (s.includes('transfer'))              return 'Transferencia';
    if (s.includes('efectiv'))               return 'Efectivo';
    if (s.includes('cheque'))                return 'Cheque';
    if (!s || s.includes('sin'))             return 'Sin datos';
    return t.trim();
  };
  pagos.forEach(p => {
    const key = normalizar(p.tipo_pago, p.vendedor);
    if (!metodoPago[key]) metodoPago[key] = { count: 0, total: 0 };
    metodoPago[key].count++;
    metodoPago[key].total += Number(p.monto) || 0;
  });

  // Ticket promedio mes actual
  const anioActual    = new Date().getFullYear();
  const mesActualStr  = `${anioActual}-${mesActual}`;
  const pagosMes      = pagos.filter(p => p.fecha_pago?.startsWith(mesActualStr));
  const ingresosMes   = pagosMes.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const ticketPromedio = pagosMes.length > 0 ? Math.round(ingresosMes / pagosMes.length) : 0;

  res.json({ kpis: { totalIngresos, clientesActivos, totalMembresias, ticketPromedio, ingresosMes }, ventasMensuales, porEstado, top10, metodoPago, renovaciones, porRecuperar, cumpleanos });
});

// ── IMPORTAR PAGOS HISTÓRICOS BOXMAGIC ───────────────────────
const PLAN_MAP = {
  // VUELA
  'VUELA 4 CLASES AL MES':                        { nombre: 'Vuela 4 clases',                      categoria: 'vuela_4',           gym: false, meses: 1 },
  'VUELA 4 CLASES AL MES + GYM':                  { nombre: 'Vuela 4 clases',                      categoria: 'vuela_4',           gym: true,  meses: 1 },
  'VUELA 6 CLASES AL MES':                        { nombre: 'Vuela 6 clases',                      categoria: 'vuela_6',           gym: false, meses: 1 },
  'VUELA 6 CLASES + GYM':                         { nombre: 'Vuela 6 clases',                      categoria: 'vuela_6',           gym: true,  meses: 1 },
  'VUELA 8 CLASES AL MES':                        { nombre: 'Vuela 8 clases',                      categoria: 'vuela_8',           gym: false, meses: 1 },
  'VUELA 8 CLASES AL MES + GYM':                  { nombre: 'Vuela 8 clases',                      categoria: 'vuela_8',           gym: true,  meses: 1 },
  'VUELA 12 CLASES AL MES':                       { nombre: 'Vuela 12 clases',                     categoria: 'vuela_12',          gym: false, meses: 1 },
  'VUELA 12 CLASES + GYM':                        { nombre: 'Vuela 12 clases',                     categoria: 'vuela_12',          gym: true,  meses: 1 },
  'CLASES VUELA CON GYM ILIMITADAS':              { nombre: 'Vuela Ilimitado',                     categoria: 'vuela_ilimitado',   gym: true,  meses: 1 },
  'CLASES (SIN GYM) VUELA ILIMITADAS':            { nombre: 'Vuela Ilimitado',                     categoria: 'vuela_ilimitado',   gym: false, meses: 1 },
  'FULL PASS + GYM':                              { nombre: 'Vuela Ilimitado',                     categoria: 'vuela_ilimitado',   gym: true,  meses: 1 },
  'TRIMESTRAL (SIN GYM) VUELA CLASES ILIMITADAS': { nombre: 'Vuela Ilimitado Trimestral',          categoria: 'vuela_ilimitado',   gym: false, meses: 3 },
  'TRIMESTRAL VUELA CON GYM CLASES ILIMITADAS':   { nombre: 'Vuela Ilimitado Trimestral',          categoria: 'vuela_ilimitado',   gym: true,  meses: 3 },
  'PROMO VUELA CYBER 2023':                       { nombre: 'Promo Vuela Cyber 2023',              categoria: 'vuela_8',           gym: false, meses: 1 },
  // MUÉVETE
  'MUEVETE 4 CLASES AL MES':                      { nombre: 'Muévete 4 clases',                    categoria: 'muevete_4',         gym: false, meses: 1 },
  'MUEVETE 4 CLASES AL MES + GYM':                { nombre: 'Muévete 4 clases',                    categoria: 'muevete_4',         gym: true,  meses: 1 },
  'MUEVETE 4 CLASES (MAYOR/DUOC)':                { nombre: 'Muévete 4 clases (Mayor/Duoc)',        categoria: 'muevete_4',         gym: false, meses: 1 },
  'MUEVETE 6 CLASES AL MES':                      { nombre: 'Muévete 6 clases',                    categoria: 'muevete_6',         gym: false, meses: 1 },
  'MUEVETE 6 CLASES + GYM':                       { nombre: 'Muévete 6 clases',                    categoria: 'muevete_6',         gym: true,  meses: 1 },
  'MUEVETE 8 CLASES AL MES':                      { nombre: 'Muévete 8 clases',                    categoria: 'muevete_8',         gym: false, meses: 1 },
  'MUEVETE 8 CLASES AL MES + GYM':                { nombre: 'Muévete 8 clases',                    categoria: 'muevete_8',         gym: true,  meses: 1 },
  'MUEVETE 12 CLASES AL MES':                     { nombre: 'Muévete 12 clases',                   categoria: 'muevete_12',        gym: false, meses: 1 },
  'MUEVETE 12 CLASES AL MES + GYM':               { nombre: 'Muévete 12 clases',                   categoria: 'muevete_12',        gym: true,  meses: 1 },
  'CLASES MUEVETE CON GYM ILIMITADAS':            { nombre: 'Muévete Ilimitado',                   categoria: 'muevete_ilimitado', gym: true,  meses: 1 },
  'CLASES (SIN GYM) MUEVETE ILIMITADAS':          { nombre: 'Muévete Ilimitado',                   categoria: 'muevete_ilimitado', gym: false, meses: 1 },
  'TRIMESTRAL (SIN GYM) MUEVETE CLASES ILIMITADAS': { nombre: 'Muévete Ilimitado Trimestral',      categoria: 'muevete_ilimitado', gym: false, meses: 3 },
  'TRIMESTRAL MUEVETE CON GYM CLASES ILIMITADAS': { nombre: 'Muévete Ilimitado Trimestral',        categoria: 'muevete_ilimitado', gym: true,  meses: 3 },
  // ARMA TU PLAN
  'ARMA TU PLAN 12 clases mensual':               { nombre: 'Arma tu plan 12 clases',              categoria: 'arma_tu_plan',      gym: false, meses: 1 },
  'ARMA TU PLAN + GYM - 12 Clases al mes':        { nombre: 'Arma tu plan 12 clases',              categoria: 'arma_tu_plan',      gym: true,  meses: 1 },
  'A TU RITMO - 4 Clases al mes + acceso al GYM - SEMESTRAL': { nombre: 'A tu ritmo 4 clases + Gym semestral', categoria: 'arma_tu_plan', gym: true, meses: 6 },
  // CLASES SUELTAS
  'CLASE SUELTA':                                 { nombre: 'Clase Suelta',                        categoria: 'clase_suelta',      gym: false, meses: 1 },
  'CLASE SUELTA PLAN VUELA':                      { nombre: 'Clase Suelta Vuela',                  categoria: 'clase_suelta_vuela',gym: false, meses: 1 },
  'CLASE SUELTA PLAN MUÉVETE':                    { nombre: 'Clase Suelta Muévete',                categoria: 'clase_suelta_muevete', gym: false, meses: 1 },
  'CLASE SUELTA PLAN MUEVETE':                    { nombre: 'Clase Suelta Muévete',                categoria: 'clase_suelta_muevete', gym: false, meses: 1 },
  // CLASES DE PRUEBA
  'Clase de Prueba':                              { nombre: 'Clase de Prueba',                     categoria: 'clase_prueba',      gym: false, meses: 1 },
  'CLASE DE PRUEBA VUELA':                        { nombre: 'Clase de Prueba Vuela',               categoria: 'clase_prueba_vuela',gym: false, meses: 1 },
  'CLASE DE PRUEBA MUEVETE':                      { nombre: 'Clase de Prueba Muévete',             categoria: 'clase_prueba_muevete', gym: false, meses: 1 },
  'Clase gratis':                                 { nombre: 'Clase gratis',                        categoria: 'clase_prueba',      gym: false, meses: 1 },
  'Clase prueba Regalo':                          { nombre: 'Clase de Prueba (regalo)',             categoria: 'clase_prueba',      gym: false, meses: 1 },
  'SEMANA ILIMITRADA DE PRUEBA VUELA (SIN GYM)':  { nombre: 'Semana Ilimitada de Prueba Vuela',    categoria: 'semana_prueba_vuela', gym: false, meses: 1 },
  // GYM
  'GYM MENSUAL':                                  { nombre: 'Gym Mensual',                         categoria: 'gym',               gym: false, meses: 1 },
  'Gym Mensual (Duoc/Mayor)':                     { nombre: 'Gym Mensual (Mayor/Duoc)',             categoria: 'gym',               gym: false, meses: 1 },
  'GYM TRIMESTRAL':                               { nombre: 'Gym Trimestral',                      categoria: 'gym',               gym: false, meses: 3 },
  'GYM SEMESTRAL':                                { nombre: 'Gym Semestral',                       categoria: 'gym',               gym: false, meses: 6 },
  'GYM Semestral cuota 1':                        { nombre: 'Gym Semestral (cuota 1)',              categoria: 'gym',               gym: false, meses: 6 },
  'GYM PLAN ANUAL':                               { nombre: 'Gym Anual',                           categoria: 'gym',               gym: false, meses: 12 },
  'PROMO GYM ANUAL':                              { nombre: 'Promo Gym Anual',                     categoria: 'gym',               gym: false, meses: 12 },
  'INGRESO GYM':                                  { nombre: 'Ingreso Gym',                         categoria: 'gym',               gym: false, meses: 1 },
  'ACCESO DIARIO GYM':                            { nombre: 'Pase Diario Gym',                     categoria: 'gym',               gym: false, meses: 1 },
  // POLE
  'POLE SPORT 4 clases al mes':                   { nombre: 'Pole Sport 4 clases',                 categoria: 'pole',              gym: false, meses: 1 },
  'POLE SPORT 8 Clases por mes':                  { nombre: 'Pole Sport 8 clases',                 categoria: 'pole',              gym: false, meses: 1 },
  'POLE SPORT 8 CLASES':                          { nombre: 'Pole Sport 8 clases',                 categoria: 'pole',              gym: false, meses: 1 },
  'POLE SPORT + GYM - 4 Clases al mes':           { nombre: 'Pole Sport 4 clases',                 categoria: 'pole',              gym: true,  meses: 1 },
  'POLE SPORT - 8 Clases al Mes + GYM':           { nombre: 'Pole Sport 8 clases',                 categoria: 'pole',              gym: true,  meses: 1 },
  'Diferido 4 Clases Pole':                       { nombre: 'Pole Sport 4 clases (diferido)',       categoria: 'pole',              gym: false, meses: 1 },
  // AERIAL
  'AERIAL YOGA 4 Clases al mes':                  { nombre: 'Aerial Yoga 4 clases',                categoria: 'aerial',            gym: false, meses: 1 },
  'AERIAL YOGA 8 Clases al mes':                  { nombre: 'Aerial Yoga 8 clases',                categoria: 'aerial',            gym: false, meses: 1 },
  'AERIAL YOGA + GYM - 4 Clases al mes':          { nombre: 'Aerial Yoga 4 clases',                categoria: 'aerial',            gym: true,  meses: 1 },
  // KICKBOXING
  'KICK BOXING 4 Clases al Mes':                  { nombre: 'Kick Boxing 4 clases',                categoria: 'kickboxing',        gym: false, meses: 1 },
  // K-POP
  'K-POP 4 Clases al mes':                        { nombre: 'K-Pop 4 clases',                      categoria: 'kpop',              gym: false, meses: 1 },
  'K-POP 8 clases por mes':                       { nombre: 'K-Pop 8 clases',                      categoria: 'kpop',              gym: false, meses: 1 },
  // PERSONAL TRAINER
  'PERSONAL TRAINER - Pack 4 clases al mes':      { nombre: 'Personal Trainer 4 clases',           categoria: 'personal_trainer',  gym: false, meses: 1 },
  'PERSONAL TRAINER - PACK 8 CLASES':             { nombre: 'Personal Trainer 8 clases',           categoria: 'personal_trainer',  gym: false, meses: 1 },
  'PERSONAL TRAINER - 3 MESES':                   { nombre: 'Personal Trainer 3 meses',            categoria: 'personal_trainer',  gym: false, meses: 3 },
  // ASESORÍA
  'DISEÑO DE RUTINA 1 SESION':                    { nombre: 'Diseño de rutina 1 sesión',            categoria: 'asesoria',          gym: false, meses: 1 },
  '2 SESIONES DISEÑO DE RUTINA':                  { nombre: 'Diseño de rutina 2 sesiones',          categoria: 'asesoria',          gym: false, meses: 1 },
  'DISEÑO DE RUTINA 3 SESIONES':                  { nombre: 'Diseño de rutina 3 sesiones',          categoria: 'asesoria',          gym: false, meses: 1 },
  '4 DISEÑOS DE RUTINA':                          { nombre: 'Diseño de rutina 4 sesiones',          categoria: 'asesoria',          gym: false, meses: 1 },
  'DISEÑO DE RUTINA 5 SESIONES':                  { nombre: 'Diseño de rutina 5 sesiones',          categoria: 'asesoria',          gym: false, meses: 1 },
  // TALLERES
  'TALLER INTRODUCCIÓN A HEELS':                  { nombre: 'Taller Introducción a Heels',          categoria: 'taller',            gym: false, meses: 1 },
  'TALLER BALLET PARA ADULTAS':                   { nombre: 'Taller Ballet para Adultas',           categoria: 'taller',            gym: false, meses: 1 },
  'TALLER ENTRENAMIENTO PARA VOLAR':              { nombre: 'Taller Entrenamiento para Volar',      categoria: 'taller',            gym: false, meses: 1 },
  'TALLER DE CUECA':                              { nombre: 'Taller de Cueca',                      categoria: 'taller',            gym: false, meses: 1 },
  'TALLER FUSIÓN URBANA':                         { nombre: 'Taller Fusión Urbana',                 categoria: 'taller',            gym: false, meses: 1 },
  'TALLER DE HIP HOP':                            { nombre: 'Taller de Hip Hop',                    categoria: 'taller',            gym: false, meses: 1 },
  'DIVA URBANA':                                  { nombre: 'Diva Urbana',                          categoria: 'taller',            gym: false, meses: 1 },
  'D-U Street & girly':                           { nombre: 'D-U Street & Girly',                   categoria: 'taller',            gym: false, meses: 1 },
  // OTRO
  'Plan de Profe':                                { nombre: 'Plan de Profe',                        categoria: 'otro',              gym: false, meses: 1 },
  'Toma de Hora para Usuario':                    { nombre: 'Toma de hora',                         categoria: 'otro',              gym: false, meses: 1 },
};

function normalizarPlan(planOriginal) {
  const key = planOriginal?.trim();
  return PLAN_MAP[key] || { nombre: key, categoria: 'otro', gym: false, meses: 1 };
}

function parsearFecha(str) {
  if (!str) return null;
  const [d, m, y] = str.trim().split('-');
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

app.post('/importar-pagos-historico', async (req, res) => {
  const userAuth = await verificarAdmin(req);
  if (!userAuth) return res.status(403).json({ error: 'No autorizado' });

  const { filas } = req.body;
  if (!Array.isArray(filas) || filas.length === 0)
    return res.status(400).json({ error: 'Sin filas' });

  let insertadas = 0, duplicadas = 0, errores = 0;
  const errDetalle = [];

  for (const fila of filas) {
    const planInfo = normalizarPlan(fila.plan);
    const fechaPago = parsearFecha(fila.fecha_pago);
    const monto = parseFloat(fila.monto) || 0;

    const { error } = await sb.from('pagos_historico').insert({
      boxmagic_id:    fila.id?.trim() || null,
      nombre:         fila.nombre?.trim() || null,
      apellido:       fila.apellido?.trim() || null,
      rut:            fila.rut?.trim() || null,
      plan_original:  fila.plan?.trim() || null,
      plan_nombre:    planInfo.nombre,
      plan_categoria: planInfo.categoria,
      incluye_gym:    planInfo.gym,
      duracion_meses: planInfo.meses,
      monto,
      estado:         fila.estado?.trim() || null,
      tipo_pago:      fila.tipo_pago?.trim() || null,
      fecha_pago:     fechaPago,
      vendedor:       fila.vendedor?.trim() || null,
    });

    if (!error) {
      insertadas++;
    } else if (error.code === '23505') {
      duplicadas++;
    } else {
      errores++;
      errDetalle.push(`${fila.nombre} ${fila.apellido} (${fila.plan}): ${error.message}`);
    }
  }

  res.json({ insertadas, duplicadas, errores, errDetalle });
});

// ── MANEJO DE ERRORES GLOBAL ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada sin manejar:', reason);
});

// ── RECUPERACIÓN DE CONTRASEÑA ────────────────────────────────
app.post('/enviar-recuperacion', async (req, res) => {
  try {
    await verificarAdmin(req);
  } catch (e) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const resp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      'apikey':       process.env.SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email })
  });

  if (!resp.ok) {
    const msg = await resp.text();
    return res.status(500).json({ error: `Supabase error: ${msg}` });
  }

  res.json({ ok: true });
});

process.on('uncaughtException', (err) => {
  console.error('Excepción no capturada:', err);
  process.exit(1);
});

// ── SERVIDOR ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Espacio Vuela Pagos corriendo en puerto ${PORT}`));
