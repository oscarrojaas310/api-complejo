const express = require('express');
const router = express.Router();
const pool = require('./db'); // Importa el pool de MySQL

// POST: Registrar matrícula de alumno en la piscina
router.post('/inscripciones', async (req, res) => {
  const {
    nombre_alumno,
    edad_alumno,
    direccion,
    es_menor_edad,
    nombre_representante,
    cedula_representante,
    telefono_representante,
    nivel
  } = req.body;

  // Validación en el servidor
  if (!nombre_alumno || !edad_alumno || !direccion || !cedula_representante || !telefono_representante || !nivel || !req.body.horario_asignado) {
    return res.status(400).json({ 
      error: 'Error: Faltan campos obligatorios para procesar la inscripción.' 
    });
  }

  const horario_asignado = req.body.horario_asignado;

  try {
    const queryText = `
      INSERT INTO alumnos (
        nombre_alumno, 
        edad_alumno, 
        direccion, 
        es_menor_edad, 
        nombre_representante, 
        cedula_representante, 
        telefono_representante, 
        nivel, 
        horario_asignado,
        registrado_el
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW());
    `;

       const values = [
      nombre_alumno,
      parseInt(edad_alumno, 10),
      direccion,
      es_menor_edad ? 1 : 0,
      nombre_representante,
      cedula_representante,
      telefono_representante,
      nivel,
      horario_asignado // <-- Corregido aquí, solo la variable
    ];

    await pool.query(queryText, values);

    return res.status(201).json({
      mensaje: '¡Alumno registrado en la nube de Aiven con éxito (MySQL)!'
    });

  } catch (error) {
    console.error('Error al insertar en MySQL:', error);
    return res.status(500).json({ 
      error: 'Error interno en el servidor al guardar la matrícula.' 
    });
  }
});

// GET: Panel de control con cálculo de morosidad por mes vencido y beneficio del día 16
router.get('/dashboard', async (req, res) => {
  try {
    // 1. Obtener todos los alumnos y pagos de Aiven MySQL
    const [alumnos] = await pool.query('SELECT * FROM alumnos ORDER BY registrado_el DESC');
    const [pagos] = await pool.query('SELECT alumno_id, mes_pagado FROM pagos');

    const hoy = new Date();
    const anoActual = hoy.getFullYear();
    const mesActual = hoy.getMonth(); 

    const listaMorosos = [];
    // NUEVO: Inicializamos los arreglos para los otros dos estatus sin tocar lo anterior
    const listaPendientes = [];
    const listaSolventes = [];
    
    //  Y PEGA TUS TURNOS REALES EXACTAMENTE COMO LOS GUARDA EL FORMULARIO:
    let turnosMañanaCount = { 
      'Sábados y Domingos: 09:00 AM - 10:00 AM': 0 
    };
    
    let turnosTardeCount = { 
      'Martes a Jueves: 01:00 PM - 02:00 PM': 0, 
      'Martes a Jueves: 02:00 PM - 03:00 PM': 0, 
      'Martes a Jueves: 03:00 PM - 04:00 PM': 0, 
      'Martes a Jueves: 04:00 PM - 05:00 PM': 0, 
      'Martes a Jueves: 05:00 PM - 06:00 PM': 0, 
      'Martes a Jueves: 06:00 PM - 07:00 PM': 0 
    };

    alumnos.forEach(alumno => {
      // Contabilizar alumnos en los turnos
      if (turnosMañanaCount[alumno.horario_asignado] !== undefined) turnosMañanaCount[alumno.horario_asignado]++;
      if (turnosTardeCount[alumno.horario_asignado] !== undefined) turnosTardeCount[alumno.horario_asignado]++;

      const fechaReg = new Date(alumno.registrado_el);
      let anoInicioDeuda = fechaReg.getFullYear();
      let mesInicioDeuda = fechaReg.getMonth();
      const diaReg = fechaReg.getDate();

      // Calculamos cuántos meses han transcurrido desde su mes de inicio exigible hasta el mes ACTUAL
      const mesesTranscurridos = (anoActual - anoInicioDeuda) * 12 + (mesActual - mesInicioDeuda) + 1;

      // REGLA DE MOROSIDAD AMIGABLE: El mes en curso NO cuenta como deuda pendiente para la lista de morosos.
      const mesesExigiblesVencidos = mesesTranscurridos - 1;

      // NUEVO BLINDAJE: Buscamos si en la base de datos ya pagó el mes actual compacto (Ej: "2026-10")
      const pagosAlumno = pagos.filter(p => p.alumno_id === alumno.id);
      const mesActualFormato = `${anoActual}-${String(mesActual + 1).padStart(2, '0')}`;
      const yaPagoMesActual = pagosAlumno.some(p => p.mes_pagado === mesActualFormato);

      // Si el alumno es nuevo y no tiene meses exigibles vencidos aún
      if (mesesExigiblesVencidos <= 0) {
        // Evaluamos si ya abonó el mes en curso o si queda pendiente
        if (yaPagoMesActual) {
          listaSolventes.push(alumno);
        } else {
          listaPendientes.push(alumno);
        }
        return; 
      }

      // Buscar qué meses ha pagado el alumno en la base de datos
      const mesesPagados = pagosAlumno.length;

      // La deuda real son los meses del pasado que ya cerraron y que aún no ha pagado
      const mesesDeuda = mesesExigiblesVencidos - mesesPagados;

      if (mesesDeuda > 0) {
        listaMorosos.push({
          ...alumno,
          mesesDeuda: mesesDeuda,
          montoDolares: mesesDeuda * 20, 
          alertaCritica: mesesDeuda > 1 
        });
      } else {
        // NUEVO: Si no debe meses del pasado, revisamos si ya pagó el mes actual o si está pendiente
        if (yaPagoMesActual) {
          listaSolventes.push(alumno);
        } else {
          listaPendientes.push(alumno);
        }
      }
    });
    // Mapear los contadores al formato que espera el componente de React asignando niveles reales
    const turnos_manana = Object.keys(turnosMañanaCount).map(h => ({ 
      horario: '09:00 AM - 10:00 AM', 
      nivel: 'Módulo Único / General', 
      alumnos: turnosMañanaCount[h] 
    }));

    const turnos_tarde = Object.keys(turnosTardeCount).map(h => {
      let nivelAsignado = 'Iniciación / Adaptación';
      if (h.includes('03:00 PM') || h.includes('04:00 PM')) nivelAsignado = 'Infantil / Estilos';
      if (h.includes('05:00 PM') || h.includes('06:00 PM')) nivelAsignado = 'Juvenil y Adultos / Avanzado';

      // Extraemos solo las horas para que la visual en el frontend quede limpia
      const horarioLimpio = h.replace('Martes a Jueves: ', '');

      return { 
        horario: horarioLimpio, 
        nivel: nivelAsignado, 
        alumnos: turnosTardeCount[h] 
      };
    });


    // RETORNO: Agregamos de manera limpia las nuevas variables al objeto JSON de salida
    return res.status(200).json({
      total_activos: alumnos.length,
      total_morosos: listaMorosos.length,
      total_pendientes: listaPendientes.length,  // <-- NUEVO
      total_solventes: listaSolventes.length,    // <-- NUEVO
      monto_por_recaudar: listaMorosos.reduce((sum, m) => sum + m.montoDolares, 0),
      morosos: listaMorosos,
      pendientes: listaPendientes,                 // <-- NUEVO
      solventes: listaSolventes,                   // <-- NUEVO
      turnos_manana,
      turnos_tarde
    });

  } catch (error) {
    console.error('Error en el cálculo de morosidad amigable:', error);
    return res.status(500).json({ error: 'Error al procesar el reporte de caja.' });
  }
});

router.get('/reporte-general', async (req, res) => {
  const PDFDocument = require('pdfkit'); // Asegura que esté importado al inicio o aquí
  
  try {
    // 1. Buscamos todos los pagos cruzando datos con la nómina de atletas de Aiven MySQL
    const querySQL = `
      SELECT 
        p.*, 
        a.nombre_alumno, 
        a.cedula_representante 
      FROM pagos p
      INNER JOIN alumnos a ON p.alumno_id = a.id
      ORDER BY p.fecha_registro DESC
    `;
    
    const [rows] = await pool.query(querySQL);
    
    // 2. Calcular Totales Consolidados para el bloque financiero del PDF
    let totalDolares = 0;
    let totalBolivares = 0;
    const totalTransacciones = rows.length;

    rows.forEach(pago => {
      totalDolares += parseFloat(pago.monto_dolares || 0);
      totalBolivares += parseFloat(pago.monto_bolivares || 0);
    });

    // Cabeceras que ya tienes para abrir el PDF nativo
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=Balance_General_Caja_Piscina.pdf');

    // 🛡️ CONTROL TOTAL ANTI-CACHÉ PARA NAVEGADORES MÓVILES (Añade estas 3 líneas):
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Inicializas tu lienzo de PDFKit...
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40 });
    doc.pipe(res);

    // Banner Principal
    doc.rect(40, 40, 712, 50).fill('#0f172a');
    doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold').text('REPORTE GENERAL DE INGRESOS Y AUDITORÍA DE CAJA', 55, 50);
    doc.fontSize(8).font('Helvetica-Oblique').text(`Consolidado del Sistema Financiero | Generado: ${new Date().toLocaleString()}`, 55, 68);

    // --- Tarjetas Informativas ---
    let boxWidth = 224;
    let boxY = 105;

    doc.rect(40, boxY, boxWidth, 45).fill('#f8fafc').stroke('#e2e8f0');
    doc.fillColor('#475569').fontSize(7).font('Helvetica-Bold').text('TOTAL DIVISAS EN EFECTIVO (USD)', 50, boxY + 10);
    doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text(`$ ${totalDolares.toFixed(2)}`, 50, boxY + 22);

    doc.rect(40 + boxWidth + 20, boxY, boxWidth, 45).fill('#f8fafc').stroke('#e2e8f0');
    doc.fillColor('#059669').fontSize(7).font('Helvetica-Bold').text('TOTAL RECAUDADO EN BOLÍVARES (VES)', 40 + boxWidth + 30, boxY + 10);
    doc.fillColor('#047857').fontSize(14).font('Helvetica-Bold').text(`${totalBolivares.toFixed(2)} VES`, 40 + boxWidth + 30, boxY + 22);

    doc.rect(40 + (boxWidth * 2) + 40, boxY, boxWidth, 45).fill('#f8fafc').stroke('#e2e8f0');
    doc.fillColor('#475569').fontSize(7).font('Helvetica-Bold').text('COMPROBANTES TOTALES EMITIDOS', 40 + (boxWidth * 2) + 50, boxY + 10);
    doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text(`${totalTransacciones} Transacciones`, 40 + (boxWidth * 2) + 50, boxY + 22);

    // --- Tabla General ---
    let y = 170;
    doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text('DETALLE INDIVIDUAL DE MOVIMIENTOS A CAJA', 40, y);
    y += 15;

    doc.rect(40, y, 712, 20).fill('#e2e8f0');
    doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8);
    doc.text('ID Recibo', 45, y + 6, { width: 45 });
    doc.text('Atleta / Alumno', 100, y + 6, { width: 140 });
    doc.text('Cédula Rep.', 250, y + 6, { width: 70 });
    doc.text('Mes Cobro', 330, y + 6, { width: 65 });
    doc.text('Fecha Pago', 405, y + 6, { width: 65 });
    doc.text('Método', 480, y + 6, { width: 60 });
    doc.text('Monto ($)', 550, y + 6, { width: 55, align: 'right' });
    doc.text('Monto (Bs.)', 615, y + 6, { width: 75, align: 'right' });
    doc.text('Origen', 700, y + 6, { width: 45, align: 'center' });
    
    y += 20;

    doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
    
    rows.forEach((pago, index) => {
      if (y > 510) { 
        doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 40 }); 
        y = 40; 
      }

      if (index % 2 === 0) {
        doc.rect(40, y, 712, 18).fill('#f8fafc');
        doc.fillColor('#0f172a');
      }

      const fechaFormateada = new Date(pago.fecha_registro).toLocaleDateString();
      const procedencia = pago.guardado_offline ? 'OFFLINE' : 'RED';

      doc.text(`#${pago.id}`, 45, y + 5, { width: 45 });
      doc.text(pago.nombre_alumno, 100, y + 5, { width: 140, ellipsis: true });
      doc.text(pago.cedula_representante || 'N/P', 250, y + 5, { width: 70 });
      doc.text(pago.mes_pagado, 330, y + 5, { width: 65 });
      doc.text(fechaFormateada, 405, y + 5, { width: 65 });
      doc.text(pago.metodo_pago.toUpperCase(), 480, y + 5, { width: 60 });
      doc.text(`$${parseFloat(pago.monto_dolares || 0).toFixed(2)}`, 550, y + 5, { width: 55, align: 'right' });
      doc.text(`${parseFloat(pago.monto_bolivares || 0).toFixed(2)}`, 615, y + 5, { width: 75, align: 'right' });
      doc.text(procedencia, 700, y + 5, { width: 45, align: 'center' });

      doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(40, y + 18).lineTo(752, y + 18).stroke();
      y += 18;
    });

    doc.strokeColor('#0f172a').lineWidth(1).moveTo(40, 560).lineTo(752, 560).stroke();
    doc.fillColor('#94a3b8').fontSize(7).text('Reporte de Auditoría Central Interno - Desarrollado bajo especificaciones de resiliencia Offline-First.', 40, 568);

    doc.end();

  } catch (error) {
    console.error('❌ Error crítico en generación del PDF:', error);
    return res.status(500).send('Error interno del servidor al procesar el archivo imprimible.');
  }
});



// POST: Registrar pagos de mensualidades de forma individual o masiva (LÓGICA BLINDADA Y CORREGIDA)
router.post('/pagos', async (req, res) => {
  const { 
    alumno_id, 
    monto_dolares, 
    tasa_bcv, 
    monto_bolivares, 
    metodo_pago, 
    referencia, 
    mes_pagado, 
    fecha_registro 
  } = req.body;

  if (!alumno_id || !monto_dolares || !metodo_pago || !mes_pagado) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para procesar el pago.' });
  }

  const metodoPagoFinal = referencia && referencia !== 'N/A' ? `${metodo_pago} (Ref: ${referencia})` : metodo_pago;
  const estado = 'aprobado'; 
  const guardado_offline = 0; 
  const creado_por = 'Admin'; 

  const query = `
    INSERT INTO pagos 
    (alumno_id, monto_dolares, tasa_bcv, monto_bolivares, metodo_pago, estado, guardado_offline, creado_por, mes_pagado, fecha_registro) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    const hoy = new Date();
    const mesActualIndex = hoy.getMonth(); 
    const anoActual = hoy.getFullYear();
    
    // Formato estandarizado del mes en curso (Ej: "2026-10")
    const mesActualFormato = `${anoActual}-${String(mesActualIndex + 1).padStart(2, '0')}`;

    // =========================================================================
    // SANEAMIENTO GLOBAL DE FECHA: Convierte '2026-10-17T19:02:04.024Z' a '2026-10-17 19:02:04'
    // =========================================================================
    const fechaLimpiaMySQL = fecha_registro 
      ? fecha_registro.replace('T', ' ').substring(0, 19) 
      : hoy.toISOString().replace('T', ' ').substring(0, 19);

    // --- LÓGICA DE DETECCIÓN FINANCIERA ---
    
    // CASO 1: El administrador eligió pagar la deuda Y ADEMÁS el mes actual para estar 100% Al Día
    if (mes_pagado === "Ponerse al Día Total") {
      const cantidadTotalFilas = Math.round(monto_dolares / 20);
      const mesesDeDeudaViejos = cantidadTotalFilas - 1; 

      // 1. Insertamos los meses viejos de la deuda hacia atrás (Septiembre, Agosto, etc.)
      for (let i = 0; i < mesesDeDeudaViejos; i++) {
        let targetMesIndex = mesActualIndex - 1 - i;
        let targetAno = anoActual;
        if (targetMesIndex < 0) { targetMesIndex += 12; targetAno--; }
        
        const mesFormateadoCorto = `${targetAno}-${String(targetMesIndex + 1).padStart(2, '0')}`;
        await pool.query(query, [parseInt(alumno_id, 10), 20.00, parseFloat(tasa_bcv), 20.00 * parseFloat(tasa_bcv), metodoPagoFinal, estado, guardado_offline, creado_por, mesFormateadoCorto, fechaLimpiaMySQL]);
      }

      // 2. Insertamos la fila del mes actual (Octubre)
      await pool.query(query, [parseInt(alumno_id, 10), 20.00, parseFloat(tasa_bcv), 20.00 * parseFloat(tasa_bcv), metodoPagoFinal, estado, guardado_offline, creado_por, mesActualFormato, fechaLimpiaMySQL]);

      return res.status(201).json({ mensaje: '¡Cuenta liquidada por completo! El alumno ahora es Solvente.' });
    }

    // CASO 2: El administrador eligió abonar meses de la deuda, pero SIN incluir el mes actual
    if (mes_pagado.includes("Abonar 1 Mes") || mes_pagado.includes("Pagar 2 Meses") || mes_pagado.includes("Pagar Toda la Deuda")) {
      const mesesViejosAPagar = Math.round(monto_dolares / 20);

      // Insertamos únicamente los meses de la deuda hacia atrás
      for (let i = 0; i < mesesViejosAPagar; i++) {
        let targetMesIndex = mesActualIndex - 1 - i;
        let targetAno = anoActual;
        if (targetMesIndex < 0) { targetMesIndex += 12; targetAno--; }
        
        const mesFormateadoCorto = `${targetAno}-${String(targetMesIndex + 1).padStart(2, '0')}`;
        await pool.query(query, [parseInt(alumno_id, 10), 20.00, parseFloat(tasa_bcv), 20.00 * parseFloat(tasa_bcv), metodoPagoFinal, estado, guardado_offline, creado_por, mesFormateadoCorto, fechaLimpiaMySQL]);
      }

      return res.status(201).json({ mensaje: 'Abono a la deuda registrado. El alumno pasará a estado Pendiente.' });
    }

    // CASO 3: El alumno ya estaba al día (Pendiente) y solo va a pagar su mes actual regular de \$20
    const [result] = await pool.query(query, [
      parseInt(alumno_id, 10), 
      parseFloat(monto_dolares), 
      parseFloat(tasa_bcv), 
      parseFloat(monto_bolivares), 
      metodoPagoFinal, 
      estado, 
      guardado_offline, 
      creado_por, 
      mesActualFormato, 
      fechaLimpiaMySQL
    ]);
    
    return res.status(201).json({ mensaje: 'Mensualidad regular asentada con éxito.', pagoId: result.insertId });

  } catch (error) {
    console.error('❌ Error crítico en la inserción SQL en Aiven:', error);
    return res.status(500).json({ error: 'Error interno en el servidor.', detallesSQL: error.message });
  }
});


router.get('/alumnos-lista', async (req, res) => {
  try {
    // 1. Consultamos la base de datos de Aiven MySQL
    const [alumnos] = await pool.query('SELECT * FROM alumnos ORDER BY horario_asignado ASC, nombre_alumno ASC');
    
    // 2. CORREGIDO: Devolvemos UNICAMENTE el arreglo puro de alumnos.
    // Esto es lo que tu Frontend espera recibir para pintar la tabla completa.
    return res.status(200).json(alumnos);

  } catch (error) {
    console.error('Error al obtener lista de alumnos:', error);
    return res.status(500).json({ error: 'Error al cargar la nómina de alumnos.' });
  }
});
// ENDPOINT: Consultar la tasa oficial BCV e impactar la tabla de ajustes automáticamente
router.get('/tasa-bcv', async (req, res) => {
  const urlCotizave = 'https://api.cotizave.com/v1/fx/rates/reference';

  const configuracionHeaders = {
    'X-API-Key': 'ctz_live_0RkBOtMcDmSZQquuI2t2mNuhGAZy0BbSCtN8dY',
    'Accept': 'application/json',
    'User-Agent': 'AdminPiscinaLosPinos/1.0'
  };

  try {
    // ---- INTENTO 1: CONSULTAR API EN VIVO ----
    const respuesta = await fetch(urlCotizave, { 
      method: 'GET',
      headers: configuracionHeaders,
      timeout: 5000 
    });
    
    if (respuesta.status === 200) {
      const data = await respuesta.json();
      const tasaCalculada = parseFloat(data?.mid);
      
      if (tasaCalculada && tasaCalculada > 0) {
        console.log(`📊 Tasa extraída de Cotizave: ${tasaCalculada} VES. Actualizando MySQL...`);
        
        // 🚀 INSERCIÓN AUTOMÁTICA EN TU NUEVA TABLA:
        // Si la clave 'tasa_bcv_actual' ya existe, actualiza su valor; si no, la crea de cero.
        const queryUpsert = `
          INSERT INTO ajustes_sistema (clave, valor) 
          VALUES ('tasa_bcv_actual', ?) 
          ON DUPLICATE KEY UPDATE valor = ?, actualizado_el = CURRENT_TIMESTAMP;
        `;
        
        const stringTasa = tasaCalculada.toFixed(2);
        await pool.query(queryUpsert, [stringTasa, stringTasa]);

        return res.status(200).json({ 
          tasa: tasaCalculada, 
          origen: 'cotizave_api_live',
          status: 'guardado_en_base_de_datos',
          actualizado_el: data?.updated_at
        });
      }
    }
    throw new Error(`Cotizave denegó el acceso o devolvió estatus: ${respuesta.status}`);

  } catch (error) {
    console.warn(`⚠️ Caída de red o API bloqueada (${error.message}). Activando contingencia de base de datos local.`);
    
    try {
      // 🛡️ PLAN DE CONTINGENCIA INTELIGENTE:
      // Si no hay internet, consultamos la última tasa real que tú mismo guardaste en TablePlus
      const [registro] = await pool.query("SELECT valor FROM ajustes_sistema WHERE clave = 'tasa_bcv_actual' LIMIT 1");
      
      if (registro.length > 0) {
        const tasaHistoricaLocal = parseFloat(registro[0].valor);
        console.log(`💾 Contingencia Exitosa: Usando tasa de tu tabla ajustes_sistema: ${tasaHistoricaLocal} VES`);
        return res.status(200).json({ 
          tasa: tasaHistoricaLocal, 
          origen: 'ajustes_sistema_mysql_local',
          nota: "Sin internet. Utilizando la última tasa resguardada en la base de datos."
        });
      }
    } catch (errorSQL) {
      console.error("❌ La tabla ajustes_sistema no existe o está caída:", errorSQL.message);
    }

    // 🚨 PLAN C (El último recurso extremo si todo lo anterior colapsa):
    const tasaRespaldoEmergencia = 884.75; 
    return res.status(200).json({ 
      tasa: tasaRespaldoEmergencia, 
      origen: 'emergencia_codigo_duro',
      nota: "Fallo total de red y base de datos."
    });
  }
});

// PUT: Actualizar la ficha de un alumno por su ID
router.put('/alumnos/:id', async (req, res) => {
  const { id } = req.params; // Captura el ID de la URL
  const {
    nombre_alumno,
    edad_alumno,
    direccion,
    es_menor_edad,
    nombre_representante,
    cedula_representante,
    telefono_representante,
    nivel,
    horario_asignado
  } = req.body;

  // Validación básica de campos requeridos del lado del servidor
  if (!nombre_alumno || !edad_alumno || !direccion || !cedula_representante || !telefono_representante || !nivel || !horario_asignado) {
    return res.status(400).json({ 
      error: 'Error: Faltan campos obligatorios para procesar la actualización.' 
    });
  }

  try {
    const queryText = `
      UPDATE alumnos 
      SET 
        nombre_alumno = ?, 
        edad_alumno = ?, 
        direccion = ?, 
        es_menor_edad = ?, 
        nombre_representante = ?, 
        cedula_representante = ?, 
        telefono_representante = ?, 
        nivel = ?, 
        horario_asignado = ?
      WHERE id = ?;
    `;

    const values = [
      nombre_alumno,
      parseInt(edad_alumno, 10),
      direccion,
      es_menor_edad ? 1 : 0, // Mapeo booleano nativo para MySQL
      es_menor_edad ? nombre_representante : '', // Limpia el nombre del representante si ya es mayor de edad
      cedula_representante,
      telefono_representante,
      nivel,
      horario_asignado,
      id // El ID va de último para morder el WHERE
    ];

    // Ejecuta la consulta en tu pool activo (XAMPP o Aiven de forma automática)
    const [resultado] = await pool.query(queryText, values);

    // Si por algún motivo el ID no existe en la base de datos
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ error: 'El alumno especificado no existe.' });
    }

    return res.status(200).json({
      mensaje: '¡Ficha de alumno actualizada con éxito en la base de datos!'
    });

  } catch (error) {
    console.error('❌ Error al actualizar en MySQL:', error);
    return res.status(500).json({ 
      error: 'Error interno en el servidor al intentar modificar el registro.' 
    });
  }
});


const PDFDocument = require('pdfkit');

// 1. POST: Registrar una nueva reserva de alquiler de evento
router.post('/eventos', async (req, res) => {
  const {
    responsable,
    cedula_responsable,
    telefono,
    fecha,
    hora_inicio,
    hora_fin,
    monto_dolares,
    tasa_bcv,
    monto_bolivares,
    estatus,
    observaciones
  } = req.body;

  if (!responsable || !cedula_responsable || !fecha || !hora_inicio || !hora_fin || !monto_dolares) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para agendar la reserva.' });
  }

  const queryInsert = `
    INSERT INTO eventos_alquiler 
    (responsable, cedula_responsable, telefono, fecha, hora_inicio, hora_fin, monto_dolares, tasa_bcv, monto_bolivares, estatus, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `;

  try {
    const [resultado] = await pool.query(queryInsert, [
      responsable,
      cedula_responsable,
      telefono || 'N/A',
      fecha,
      hora_inicio,
      hora_fin,
      parseFloat(monto_dolares),
      parseFloat(tasa_bcv),
      parseFloat(monto_bolivares),
      estatus || 'Apartado',
      observaciones || ''
    ]);

    return res.status(201).json({ 
      mensaje: '¡Reserva de evento inyectada con éxito en Aiven!',
      eventoId: resultado.insertId 
    });
  } catch (error) {
    console.error('❌ Error al insertar evento en MySQL:', error);
    return res.status(500).json({ error: 'Error interno al guardar la reserva.' });
  }
});

// 2. GET: Obtener el cronograma de todos los alquileres agendados
router.get('/eventos', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM eventos_alquiler ORDER BY fecha ASC, hora_inicio ASC');
    return res.status(200).json(rows);
  } catch (error) {
    console.error('❌ Error al consultar cronograma:', error);
    return res.status(500).json({ error: 'Error al cargar la agenda de eventos.' });
  }
});
// 3. GET: Generar y descargar el contrato legal en formato PDF vectorizado con Cintillo WebP Síncrono
router.get('/eventos/:id/pdf', async (req, res) => {
  const { id } = req.params;
  const path = require('path');
  const fs = require('fs'); // Requerido para leer el archivo de forma síncrona en un Buffer

  try {
    // Buscamos el evento exacto en la base de datos de Aiven
    const [rows] = await pool.query('SELECT * FROM eventos_alquiler WHERE id = ? LIMIT 1', [id]);
    
    if (rows.length === 0) {
      return res.status(404).send('Error: El evento especificado no existe.');
    }

    const evento = rows[0];
    const fechaFormateada = new Date(evento.fecha).toISOString().substring(0, 10);

    // 🌟 INYECCIÓN SÍNCRONA ANTI-CAÍDAS:
    // Leemos el archivo físico del disco y lo cargamos a la memoria RAM antes de inicializar el PDF.
    // Esto evita que doc.end() cierre el stream antes de terminar de procesar la imagen.
    const rutaCintillo = path.join(process.cwd(), 'public', 'cintillo.webp');

    let cintilloBuffer = null;

    try {
      if (fs.existsSync(rutaCintillo)) {
        cintilloBuffer = fs.readFileSync(rutaCintillo); // Carga binaria inmediata
      } else {
        console.warn(`⚠️ Advertencia: No se localizó el cintillo en: ${rutaCintillo}`);
      }
    } catch (errImg) {
      console.error('Error al mapear la imagen en el buffer:', errImg.message);
    }

    // Configuración de cabeceras HTTP para forzar la apertura del PDF nativo
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Contrato_Alquiler_LosPinos_${id}.pdf`);

    // Inicializamos el lienzo en blanco de PDFKit con márgenes corporativos
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    doc.pipe(res); // Canaliza el flujo de bytes directo a la respuesta HTTP de Render

    // 📄 REEMPLAZO LOGO: Renderizado seguro del cintillo corporativo WebP
    if (cintilloBuffer) {
      // Pasamos el búfer directamente (ocupa los 512 puntos exactos de margen a margen)
      doc.image(cintilloBuffer, 50, 40, { width: 512 });
      doc.y = 95; // Posicionamos el cursor justo debajo del cintillo
    } else {
      doc.y = 40;
    }

    doc.fontSize(9).font('Helvetica').fillColor('#475569').text('Control de Alquileres de Áreas Especiales y Piscina', { align: 'center' });
    doc.text('Mérida, Venezuela · Soporte Corporativo', { align: 'center' });
    
    doc.moveDown(0.8);
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, doc.y).lineTo(562, doc.y).stroke(); // Línea divisoria elegante
    doc.moveDown(1.2);

    // 📌 NÚMERO DE CONTRATO Y FECHA DE REGISTRO
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#0f172a').text(`CONTRATO DE ARRENDAMIENTO DE ÁREA DE PISCINA N° 0026-${id}`, { align: 'left' });
    doc.fontSize(10).font('Helvetica').fillColor('#475569').text(`Fecha de Emisión: ${new Date().toISOString().substring(0,10)}`, { align: 'left' });
    doc.moveDown(1.2);

    // 👤 FICHA TÉCNICA DEL CONTRATANTE
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('1. PARTES CONTRATANTES Y RESPONSABLE', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).font('Helvetica').fillColor('#334155');
    doc.text(`Nombre del Responsable:  ${evento.responsable}`);
    doc.text(`Cédula de Identidad:          ${evento.cedula_responsable}`);
    doc.text(`Teléfono de Contacto:       ${evento.telefono}`);
    doc.text(`Área de Concesión:           Instalaciones de la Piscina Principal y Áreas Verdes Adyacentes`);
    doc.moveDown(1.2);

    // ⏱️ DATOS CRONOLÓGICOS DEL COMPROMISO
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('2. VIGENCIA Y HORARIOS DEL COMPROMISO', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).font('Helvetica').fillColor('#334155');
    doc.text(`Fecha Agendada:     ${fechaFormateada}`);
    doc.text(`Hora de Entrada:      ${evento.hora_inicio.substring(0, 5)} (Hora exacta de entrega de instalaciones)`);
    doc.text(`Hora de Salida:       ${evento.hora_fin.substring(0, 5)} (Hora de desalojo definitivo)`);
    doc.moveDown(1.2);

    // 💵 CLÁUSULAS FINANCIERAS BIMONETARIAS
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('3. CONDICIONES FINANCIERAS Y ABONOS', { underline: true });
    doc.moveDown(0.4);
    doc.text(`Canon de Arrendamiento:       $${parseFloat(evento.monto_dolares).toFixed(2)} USD`);
    doc.text(`Tasa Cambiaria BCV:               ${parseFloat(evento.tasa_bcv).toFixed(2)} VES por 1 USD`);
    doc.text(`Total en Moneda Nacional:    Bs. ${parseFloat(evento.monto_bolivares).toFixed(2)} VES`);
    doc.text(`Estatus del Pago:                     ${evento.estatus === 'Liquidado' ? ' LIQUIDADO / CANCELADO COMPLETAMENTE' : 'APARTADO (Requiere completar saldo al ingresar)'}`);
    doc.moveDown(1.2);

    // 📝 SECCIÓN DE OBSERVACIONES PARTICULARES
    if (evento.observaciones) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('4. OBSERVACIONES Y DETALLES DEL ALQUILER', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#475569').text(`"${evento.observaciones}"`, { width: 512, align: 'justify' });
      doc.moveDown(1.2);
    }

    // ⚖️ CLÁUSULAS LEGALES ESTÁNDAR COMPLEJO LOS PINOS
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('5. CLÁUSULAS DE SEGURIDAD Y RESPONSABILIDAD', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(8.5).font('Helvetica').fillColor('#475569');
    
    const clausulas = [
      "PRIMERA: El contratante se hace enteramente responsable por el comportamiento de sus invitados y el cuidado de las instalaciones.",
      "SEGUNDA: Queda estrictamente prohibido el uso de envases de vidrio dentro o en los bordes inmediatos del área de la piscina.",
      "TERCERA: El Complejo Los Pinos no se hace responsable por pérdidas de objetos personales durante la ejecución del evento.",
      "CUARTA: Las horas extras que excedan el tiempo estipulado en la sección (2) tendrán un recargo de $30 USD por hora fraccionada."
    ];
    
    clausulas.forEach(c => doc.text(c, { width: 512, align: 'justify' }).moveDown(0.2));
    
    // =========================================================================
    // ✍️ ANCLAJE DE FIRMAS FIJO EN EL MARGEN INFERIOR (Estilo Footer Inmune)
    // =========================================================================
    // 1. Apagamos el salto automático para fijar las líneas en la base de la hoja actual
    doc.options.autoPageBreak = false;
    
    // 2. Establecemos las coordenadas fijas del fondo (670 puntos de 792 totales de la hoja)
    const yFirma = 670;
    
    doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(80, yFirma).lineTo(220, yFirma).stroke();
    doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(340, yFirma).lineTo(480, yFirma).stroke();
    
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#334155');
    doc.text('Por el Complejo Los Pinos', 80, yFirma + 6, { width: 140, align: 'center' });
    doc.text('Firma del Responsable', 340, yFirma + 6, { width: 140, align: 'center' });

    // 3. Dejamos encendido el parámetro por sanidad del flujo interno
    doc.options.autoPageBreak = true;

    // 🚀 CIERRE SEGURO SECUENCIAL: Se despacha como último paso absoluto
    doc.end();
    
  } catch (error) {
    console.error('❌ Error crítico en generación vectorial del PDF:', error);
    if (!res.headersSent) {
      return res.status(500).send('Error interno del servidor al procesar el archivo imprimible.');
    }
  }
});

// ENDPOINT: Registrar la asistencia diaria de todo un turno en bloque masivo
router.post('/asistencia-diaria', async (req, res) => {
  const { fecha, horario, bloque, registros } = req.body;

  // Validación estricta de estructura
  if (!fecha || !horario || !bloque || !registros || !Array.isArray(registros)) {
    return res.status(400).json({ error: 'Estructura de reporte incompleta o inválida.' });
  }

  // Obtenemos una conexión limpia del pool para manejar la transacción
  const conexion = await pool.getConnection();

  try {
    // 🚀 Arrancamos la transacción de seguridad masiva
    await conexion.beginTransaction();

    console.log(`⏳ Procesando asistencia para el turno ${horario} del día ${fecha}...`);

    // Preparamos la consulta con ON DUPLICATE KEY UPDATE. 
    // Si el entrenador vuelve a pasar asistencia del mismo turno para corregir algo,
    // MySQL actualizará el estado (Presente/Ausente) en lugar de dar error.
    const querySQL = `
      INSERT INTO asistencias (alumno_id, fecha, horario, bloque, asistio) 
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        asistio = VALUES(asistio),
        horario = VALUES(horario),
        bloque = VALUES(bloque)
    `;

    // Ejecutamos cada inserción de forma consecutiva dentro de la misma transacción
    for (const reg of registros) {
      await conexion.query(querySQL, [
        parseInt(reg.alumno_id, 10),
        fecha,
        horario,
        bloque,
        parseInt(reg.asistio, 10)
      ]);
    }

    // 💾 Si todo salió bien, asentamos los cambios definitivamente en Aiven / XAMPP
    await conexion.commit();
    console.log(`✅ ¡Asistencia guardada con éxito! Total registros asentados: ${registros.length}`);
    
    return res.status(200).json({ 
      mensaje: 'Reporte de asistencia procesado y guardado correctamente.',
      registrados: registros.length 
    });

  } catch (error) {
    // 🛡️ Si algo colapsó o falló la red, revertimos todo para no corromper la tabla
    await conexion.rollback();
    console.error('❌ Error crítico en transacción de asistencia:', error);
    
    return res.status(500).json({ 
      error: 'Error interno al procesar el reporte de asistencia en la base de datos.',
      detalle: error.message 
    });
  } finally {
    // 🔌 Devolvemos la conexión al pool de inmediato para que quede libre para otros usuarios
    conexion.release();
  }
});

router.get('/asistencias-completadas', async (req, res) => {
  const { fecha } = req.query;
  try {
    const [rows] = await pool.query('SELECT DISTINCT horario FROM asistencias WHERE fecha = ?', [fecha]);
    const completados = rows.map(r => r.horario);
    return res.status(200).json(completados);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 2. ENDPOINT: Precargar datos si ya se guardó la asistencia de ese día para edición en caliente
router.get('/asistencia-previa', async (req, res) => {
  const { fecha, horario } = req.query;
  try {
    const [rows] = await pool.query('SELECT alumno_id, asistio FROM asistencias WHERE fecha = ? AND horario = ?', [fecha, horario]);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 3. ENDPOINT: Libro de Actas Continuo de Asistencias (Historial completo controlado por el Administrador)
router.get('/asistencia-resumen-semanal', async (req, res) => {
  try {
    const querySQL = `
      SELECT 
        horario,
        fecha AS fecha_iso, -- Entrega el formato original YYYY-MM-DD
        DATE_FORMAT(fecha, '%d/%m/%Y') AS fecha_corta,
        SUM(CASE WHEN asistio = 1 THEN 1 ELSE 0 END) AS presentes,
        SUM(CASE WHEN asistio = 0 THEN 1 ELSE 0 END) AS ausentes
      FROM asistencias
      -- 🔍 MODIFICADO: Eliminamos la regla "WHERE YEARWEEK..." para mostrar todo el historial acumulado
      GROUP BY horario, fecha
      ORDER BY fecha DESC, horario ASC
      LIMIT 100 -- 🛡️ BLINDAJE: Muestra los últimos 100 turnos pasados para no saturar la memoria del teléfono
    `;
    const [rows] = await pool.query(querySQL);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Error al generar el historial continuo de asistencia:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 4. ENDPOINT: Obtener la nómina detallada de un día histórico para auditar
router.get('/asistencia-detalle', async (req, res) => {
  const { fecha, horario } = req.query;
  
  if (!fecha || !horario) {
    return res.status(400).json({ error: 'Los parámetros fecha y horario son obligatorios.' });
  }

  try {
    const querySQL = `
      SELECT a.nombre_alumno, ast.asistio 
      FROM asistencias ast
      INNER JOIN alumnos a ON ast.alumno_id = a.id
      WHERE ast.fecha = ? AND ast.horario = ?
      ORDER BY a.nombre_alumno ASC
    `;
    const [rows] = await pool.query(querySQL, [fecha, horario]);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Error en asistencia-detalle:', error);
    return res.status(500).json({ error: error.message });
  }
});
// 5. ENDPOINT BLINDADO: Eliminar reporte con limpieza atómica de fechas ISO
router.delete('/asistencia-eliminar', async (req, res) => {
  const { fecha, horario } = req.query;

  if (!fecha || !horario) {
    return res.status(400).json({ error: 'Los parámetros fecha y horario son obligatorios.' });
  }

  try {
    // 🛡️ LIMPIEZA ATÓMICA DE FECHA:
    // Si viene como "2026-10-23T00:00:00.000Z", extrae solo los primeros 10 caracteres "2026-10-23"
    const fechaLimpia = fecha.includes('T') ? fecha.split('T')[0] : fecha;
    const horarioLimpio = horario.trim();

    console.log(`⏳ Intentando borrar asistencia para el día [${fechaLimpia}] turno [${horarioLimpio}]...`);

    // Consulta flexible con LIKE para los prefijos de los días
    const querySQL = 'DELETE FROM asistencias WHERE fecha = ? AND horario LIKE ?';
    const [result] = await pool.query(querySQL, [fechaLimpia, `%${horarioLimpio}%`]);

    console.log(`🗑️ Historial eliminado con éxito en la red. Filas afectadas: ${result.affectedRows}`);
    
    return res.status(200).json({ 
      mensaje: 'Registro de asistencia eliminado correctamente.',
      filas_borradas: result.affectedRows 
    });

  } catch (error) {
    console.error('❌ Error crítico al eliminar asistencia en la base de datos:', error);
    return res.status(500).json({ 
      error: 'Error interno en el servidor de base de datos.',
      detalle: error.message 
    });
  }
});
module.exports = router;
