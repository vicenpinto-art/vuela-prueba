# Boost $1.990 — Snippets para api-pago-ev.js

## Paso 0 — Supabase: crear plan "Boost" en tabla `planes`

```sql
INSERT INTO planes (nombre, tipo, precio, clases, activo)
VALUES ('Boost Día Extra', 'boost', 1990, 0, true);
```

Guarda el `id` que genera (lo necesita el webhook).

---

## Paso 1 — Nuevo endpoint: `/crear-preferencia-boost`

Agrega esto **después** del endpoint `/crear-preferencia` existente:

```javascript
app.post('/crear-preferencia-boost', async (req, res) => {
  const { usuario_id, usuario_email, usuario_nombre, compra_id } = req.body;
  if (!usuario_id || !usuario_email || !compra_id) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    const preference = new Preference(mpClient);
    const response = await preference.create({
      body: {
        items: [{
          title: 'Boost Día Extra — Espacio Vuela',
          description: '+1 día a tu plan activo',
          quantity: 1,
          unit_price: 1990,
          currency_id: 'CLP'
        }],
        payer: {
          email: usuario_email,
          name:  usuario_nombre
        },
        back_urls: {
          success: `${CLIENT_URL}/pago-exitoso.html`,
          failure: `${CLIENT_URL}/pago-fallido.html`,
          pending: `${CLIENT_URL}/pago-pendiente.html`
        },
        auto_return: 'approved',
        metadata: {
          tipo:      'boost',
          alumna_id: usuario_id,
          compra_id: compra_id        // ID de la compra activa a extender
        },
        notification_url: `${SERVER_URL}/webhook`
      }
    });

    const checkout_url = process.env.NODE_ENV === 'production'
      ? response.init_point
      : response.sandbox_init_point;

    res.json({ checkout_url });
  } catch (err) {
    console.error('Error boost preference:', err);
    res.status(500).json({ error: err.message });
  }
});
```

---

## Paso 2 — Modificar el webhook para manejar boosts

En la función que maneja pagos aprobados (donde ya tienes la lógica de `crear compra`), 
**agrega este bloque al inicio** del handler de pago aprobado, antes de procesar planes normales:

```javascript
// ── BOOST: detectar y extender plan ──────────────────────────
const metadata = payment.metadata || {};

if (metadata.tipo === 'boost') {
  const alumnaId = metadata.alumna_id;
  const compraId = metadata.compra_id;

  if (!alumnaId || !compraId) {
    console.error('Boost sin alumna_id o compra_id', metadata);
    return res.sendStatus(200);
  }

  // Extender el plan 1 día via RPC (ya existe esta función en Supabase)
  const { data, error } = await supabase.rpc('extender_plan', {
    p_compra_id: compraId,
    p_dias: 1
  });

  if (error) {
    console.error('Error extendiendo plan por boost:', error);
  } else {
    console.log(`Boost aplicado: alumna ${alumnaId}, compra ${compraId}`);
  }

  // Registrar el boost en compras para que aparezca en ingresos
  // (requiere que el plan 'boost' exista en la tabla planes — ver Paso 0)
  const BOOST_PLAN_ID = 'REEMPLAZA_CON_EL_ID_DEL_PLAN_BOOST'; // ← pega el id del INSERT del Paso 0
  await supabase.from('compras').insert({
    alumna_id:     alumnaId,
    plan_id:       BOOST_PLAN_ID,
    monto_pagado:  1990,
    estado:        'activo',
    fecha_fin:     new Date().toISOString().split('T')[0], // vence hoy (es solo registro)
    clases_disponibles: 0,
    mp_payment_id: payment.id?.toString() || null
  });

  return res.sendStatus(200); // ← termina aquí, no sigue con lógica de planes
}
// ── FIN BOOST ─────────────────────────────────────────────────
```

---

## Resumen del flujo completo

```
alumna en planes.html
  → plan activo detectado → banner "⚡ Boost +1 día — $1.990" visible
  → click → modal con fechas: "Vence 25 jul → pasa a 26 jul"
  → acepta términos → "Pagar con MercadoPago"
  → POST /crear-preferencia-boost → checkout_url
  → redirige a MercadoPago → paga $1.990
  → webhook recibe pago aprobado
  → detecta metadata.tipo === 'boost'
  → llama extender_plan(compra_id, 1)
  → registra compra en tabla compras (aparece en admin ingresos)
  → redirige a pago-exitoso.html
```

## Notas

- La RPC `extender_plan` ya existe en Supabase (ya se usa para el botón Extender del admin).
- El admin también puede aplicar boost manualmente desde la sección Alumnas (botón ⚡ +1d), sin cobro.
- Los boosts aparecen en el panel Ingresos del admin como compras del plan "Boost Día Extra".
