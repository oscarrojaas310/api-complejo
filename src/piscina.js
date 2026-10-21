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
// ENDPOINT: Consultar la tasa oficial BCV de forma automática (LÓGICA AUTOMATIZADA)
router.get('/tasa-bcv', async (req, res) => {
  // 🌟 ENDPOINT REAL DE DATOS: DolarApi oficial comunitaria para Venezuela
  const urlApiVenezuela = 'https://dolarapi.com';

  const configuracionHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AdminPiscinaLosPinos/1.0',
    'Accept': 'application/json'
  };

  try {
    // ---- INTENTO 1: CONSULTA EN VIVO AUTOMÁTICA A DOLARAPI ----
    const respuesta = await fetch(urlApiVenezuela, { 
      headers: configuracionHeaders,
      timeout: 5000 // Aborta si el servidor tarda más de 5 segundos para no colgar el PWA
    });
    
    if (respuesta.status === 200) {
      const data = await respuesta.json();
      
      // DolarApi entrega la cotización directa en la propiedad "promedio"
      const tasaCalculada = parseFloat(data?.promedio);
      
      if (tasaCalculada && tasaCalculada > 0) {
        console.log(`📊 Automatización Exitosa: Tasa BCV al día en Render: ${tasaCalculada} VES`);
        return res.status(200).json({ 
          tasa: tasaCalculada, 
          origen: 'dolar_api_venezuela_live',
          fecha_actualizacion: data?.fechaActualizacion
        });
      }
    }
    throw new Error(`Servidor DolarApi respondió con estatus: ${respuesta.status}`);

  // src/piscina.js (Ajuste final de precisión)
    } catch (errorAlternativo) {
      console.error("❌ Todas las consultas automatizadas colapsaron. Activando contingencia fija.");
      
      // ✅ MODIFICA ESTA LÍNEA: Cambia 880.00 por el valor real con decimales
      return res.status(200).json({ 
        tasa: 883.39, 
        origen: 'contingencia_estatica_los_pinos',
        nota: "Sincronización en vivo temporalmente fuera de servicio."
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


module.exports = router;
