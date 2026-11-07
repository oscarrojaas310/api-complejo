const express = require('express');
const router = express.Router();
const pool = require('./db'); // Importa tu pool de MySQL de Aiven
const path = require('path'); 

const PDFDocument = require('pdfkit'); // Importamos el generador de PDF

let cacheTasaSistema = {
  valor: null,
  ultimaActualizacion: null
};
const TIEMPO_CACHE = 6 * 60 * 60 * 1000; 

router.get('/tasa-bcv', async (req, res) => {
  const ahora = new Date();

  // ---- PASO OPTIMIZADO: ¿TENEMOS LA TASA EN MEMORIA RAM? ----
  if (cacheTasaSistema.valor && cacheTasaSistema.ultimaActualizacion && (ahora - cacheTasaSistema.ultimaActualizacion < TIEMPO_CACHE)) {
    console.log(`⚡ Servido desde caché en RAM de Render: ${cacheTasaSistema.valor} VES (Ahorro total de red)`);
    return res.status(200).json({ 
      tasa: cacheTasaSistema.valor, 
      origen: 'memoria_ram_cache',
      status: 'operativo'
    });
  }

  // 🚀 CORREGIDO: URL e hilos de ejecución limpios para Venezuela
  const urlDolarApi = 'https://dolarapi.com';
  const urlCotizave = 'https://api.cotizave.com/v1/fx/rates/reference';
  
  const configuracionHeadersCotizave = {
    'X-API-Key': 'ctz_live_0RkBOtMcDmSZQquuI2t2mNuhGAZy0BbSCtN8dY',
    'Accept': 'application/json',
    'User-Agent': 'AdminPiscinaLosPinos/1.0'
  };

  let tasaCalculada = null;
  let proveedorOrigen = null;

  // ---- INTENTO 1: DOLARAPI (100% GRATUITO E ILIMITADO) ----
  try {
    const respuestaDolarApi = await fetch(urlDolarApi, { method: 'GET', timeout: 4000 });
    
    if (respuestaDolarApi.ok) {
      const dataDolar = await respuestaDolarApi.json();
      
      // 🚀 CORREGIDO: DolarApi entrega un objeto directo con la llave "promedio"
      if (dataDolar && dataDolar.promedio) {
        tasaCalculada = parseFloat(dataDolar.promedio);
        proveedorOrigen = 'dolarapi_live';
        console.log(`📊 Tasa extraída con éxito de DolarApi: ${tasaCalculada} VES`);
      }
    } else {
      console.warn(`⚠️ DolarApi respondió con estatus erróneo: ${respuestaDolarApi.status}`);
    }
  } catch (errDolar) {
    console.warn(`⚠️ DolarApi falló por completo: ${errDolar.message}. Pasando a Cotizave...`);
  }

  // ---- INTENTO 2: RESPALDO CON COTIZAVE (Solo si DolarApi falló) ----
  if (!tasaCalculada) {
    try {
      const respuestaCotizave = await fetch(urlCotizave, { 
        method: 'GET',
        headers: configuracionHeadersCotizave,
        timeout: 4000 
      });
      
      if (respuestaCotizave.status === 200) {
        const dataCotizave = await respuestaCotizave.json();
        if (dataCotizave?.mid) {
          tasaCalculada = parseFloat(dataCotizave.mid);
          proveedorOrigen = 'cotizave_api_live';
          console.log(`📊 Tasa extraída de Cotizave Respaldo: ${tasaCalculada} VES`);
        }
      } else {
        console.warn(`🚫 Cotizave rechazó la solicitud con estatus: ${respuestaCotizave.status}`);
      }
    } catch (errCotizave) {
      console.warn(`⚠️ Cotizave completamente bloqueado o caído: ${errCotizave.message}`);
    }
  }

  // ---- PROCESAMIENTO Y ACTUALIZACIÓN (Si alguna de las APIs en vivo respondió) ----
  if (tasaCalculada && tasaCalculada > 0) {
    try {
      // Actualizamos la caché en la RAM del servidor
      cacheTasaSistema.valor = tasaCalculada;
      cacheTasaSistema.ultimaActualizacion = ahora;

      // Resguardamos en tu tabla ajustes_sistema en MySQL de Aiven
      const queryUpsert = `
        INSERT INTO ajustes_sistema (clave, valor) 
        VALUES ('tasa_bcv_actual', ?) 
        ON DUPLICATE KEY UPDATE valor = ?, actualizado_el = CURRENT_TIMESTAMP;
      `;
      const stringTasa = tasaCalculada.toFixed(2);
      await pool.query(queryUpsert, [stringTasa, stringTasa]);

      return res.status(200).json({ 
        tasa: tasaCalculada, 
        origen: proveedorOrigen,
        status: 'actualizado_y_guardado'
      });
    } catch (errorSQL) {
      console.error("❌ Error al guardar la tasa fresca en MySQL, pero se mantiene en RAM:", errorSQL.message);
      return res.status(200).json({ 
        tasa: tasaCalculada, 
        origen: proveedorOrigen,
        nota: "Tasa actualizada en vivo pero falló persistencia SQL."
      });
    }
  }

  // ---- 🛡️ PLAN DE CONTINGENCIA SUPREMO (Si internet o ambas APIs fallan) ----
  console.warn("🚨 Fallo total de APIs externas. Activando contingencia de base de datos local.");
  try {
    const [registro] = await pool.query("SELECT valor FROM ajustes_sistema WHERE clave = 'tasa_bcv_actual' LIMIT 1");
    if (registro.length > 0) {
      const tasaHistoricaLocal = parseFloat(registro[0].valor);
      
      // Alimentamos la caché RAM con el último dato viejo para no estresar la DB en las próximas 6 horas
      cacheTasaSistema.valor = tasaHistoricaLocal;
      cacheTasaSistema.ultimaActualizacion = ahora;

      console.log(`💾 Contingencia Exitosa: Usando tasa de tu tabla ajustes_sistema: ${tasaHistoricaLocal} VES`);
      return res.status(200).json({ 
        tasa: tasaHistoricaLocal, 
        origen: 'ajustes_sistema_mysql_local',
        nota: "Modo contingencia activa. Utilizando último resguardo de base de datos."
      });
    }
  } catch (errorSQL) {
    console.error("❌ La tabla de contingencia ajustes_sistema falló:", errorSQL.message);
  }

  // ---- PLAN C (Último recurso extremo de seguridad) ----
  const tasaRespaldoEmergencia = 62.50; 
  return res.status(200).json({ 
    tasa: tasaRespaldoEmergencia, 
    origen: 'emergencia_codigo_duro',
    nota: "Colapso total del ecosistema de datos."
  });
});


router.post('/inscripciones', async (req, res) => {
  const {
    nombre_alumno,
    edad_alumno,
    fecha_nacimiento,
    cedula_alumno,
    direccion,
    patologia,
    es_menor_edad,
    nombre_representante,
    cedula_representante,
    telefono_representante,
    bloque_seleccionado // String compuesto 'nivel|horario_asignado' enviado por React
  } = req.body;

  // 1. Validación estricta en el servidor incorporando campos cronológicos
  if (!nombre_alumno || !edad_alumno || !fecha_nacimiento || !direccion || !cedula_representante || !telefono_representante || !bloque_seleccionado) {
    return res.status(400).json({ 
      error: 'Error: Faltan campos obligatorios para procesar la inscripción en fútbol.' 
    });
  }

  // 2. Desestructuración asíncrona del bloque unificado para extraer las columnas individuales
  const partesBloque = bloque_seleccionado.split('|');
  if (partesBloque.length !== 2) {
    return res.status(400).json({
      error: 'Error: El formato de la categoría y horario seleccionado es inválido.'
    });
  }
  
  const nivel = partesBloque[0];           // Ej: "Sub-6" o "Rango 9 a 14 años (Mañana)"
  const horario_asignado = partesBloque[1]; // Ej: "Lunes, Miércoles y Viernes: 08:00 AM - 09:15 AM"

  try {
    // 3. Sentencia SQL apuntando al nombre oficial de tu tabla: 'alumnos_futbol'
    const queryText = `
      INSERT INTO alumnos_futbol (
        nombre_alumno, 
        edad_alumno, 
        fecha_nacimiento,
        cedula_alumno,
        direccion, 
        patologia,
        es_menor_edad, 
        nombre_representante, 
        cedula_representante, 
        telefono_representante, 
        nivel, 
        horario_asignado,
        registrado_el
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW());
    `;

    const values = [
      nombre_alumno,
      parseInt(edad_alumno, 10),
      fecha_nacimiento,       // Formato string de fecha nativa 'YYYY-MM-DD'
      cedula_alumno || null,  // Guarda un valor nulo limpio si el niño no posee cédula aún
      direccion,
      patologia || null,      // Mapea la alerta médica de salud en la fila
      es_menor_edad ? 1 : 0,  // Mapeo booleano nativo para tinyint de MySQL
      nombre_representante,
      cedula_representante,
      telefono_representante,
      nivel,
      horario_asignado
    ];

    await pool.query(queryText, values);

    return res.status(201).json({
      mensaje: '¡Atleta registrado en la nube de fútbol con éxito (MySQL)!'
    });

  } catch (error) {
    console.error('❌ Error al insertar en MySQL (Fútbol):', error);
    return res.status(500).json({ 
      error: 'Error interno en el servidor al guardar la matrícula de fútbol.' 
    });
  }
});
// GET: Panel de control con mallas horarias oficiales de la Academia de Fútbol
router.get('/dashboard', async (req, res) => {
  try {
    // 1. Obtener datos de la base de datos de fútbol
    const [alumnos] = await pool.query('SELECT * FROM alumnos_futbol ORDER BY registrado_el DESC');
    const [pagos] = await pool.query('SELECT alumno_id, mes_pagado FROM pagos_futbol');

    const hoy = new Date();
    const anoActual = hoy.getFullYear();
    const mesActual = hoy.getMonth(); 

    const listaMorosos = [];
    const listaPendientes = [];
    const listaSolventes = [];
    
    // 📊 Diccionario de contadores mapeado exactamente a tu base de datos
    let turnosCount = {
      'Lunes, Miércoles y Viernes: 08:00 AM - 09:15 AM': 0,
      'Lunes, Miércoles y Viernes: 09:15 AM - 10:30 AM': 0,
      'Lunes 2:00 PM / Miércoles y Viernes 4:00 PM': 0,
      'Lunes, Miércoles y Viernes: 03:00 PM': 0,
      'Lunes, Martes y Jueves: 04:00 PM': 0,
      'Lunes, Miércoles y Viernes: 05:00 PM - 06:00 PM': 0,
      'Lunes, Miércoles y Viernes: 06:00 PM - 07:00 PM': 0
    };

    alumnos.forEach(alumno => {
      // Incrementar contador si el horario asignado coincide de forma exacta
      if (turnosCount[alumno.horario_asignado] !== undefined) {
        turnosCount[alumno.horario_asignado]++;
      }

      // --- LÓGICA DE CONTROL DE MOROSIDAD ---
      const fechaReg = new Date(alumno.registrado_el);
      let anoInicioDeuda = fechaReg.getFullYear();
      let mesInicioDeuda = fechaReg.getMonth();

      const mesesTranscurridos = (anoActual - anoInicioDeuda) * 12 + (mesActual - mesInicioDeuda) + 1;
      const mesesExigiblesVencidos = mesesTranscurridos - 1;

      const pagosAlumno = pagos.filter(p => p.alumno_id === alumno.id);
      const mesActualFormato = `${anoActual}-${String(mesActual + 1).padStart(2, '0')}`;
      const yaPagoMesActual = pagosAlumno.some(p => p.mes_pagado === mesActualFormato);

      if (mesesExigiblesVencidos <= 0) {
        if (yaPagoMesActual) {
          listaSolventes.push(alumno);
        } else {
          listaPendientes.push(alumno);
        }
        return; 
      }

      const mesesPagados = pagosAlumno.length;
      const mesesDeuda = mesesExigiblesVencidos - mesesPagados;

      if (mesesDeuda > 0) {
        listaMorosos.push({
          ...alumno,
          mesesDeuda: mesesDeuda,
          montoDolares: mesesDeuda * 15, 
          alertaCritica: mesesDeuda > 1 
        });
      } else {
        if (yaPagoMesActual) {
          listaSolventes.push(alumno);
        } else {
          listaPendientes.push(alumno);
        }
      }
    });

    // 🌅 FILTRO 1: Construcción de la Malla del Turno de la Mañana
    const turnos_manana = [
      {
        horario: '08:00 AM - 09:15 AM',
        nivel: 'Rango 9 a 14 años (Mañana)',
        alumnos: turnosCount['Lunes, Miércoles y Viernes: 08:00 AM - 09:15 AM']
      },
      {
        horario: '09:15 AM - 10:30 AM',
        nivel: 'Rango 5 a 8 años (Mañana)',
        alumnos: turnosCount['Lunes, Miércoles y Viernes: 09:15 AM - 10:30 AM']
      }
    ];

    // 🌇 FILTRO 2: Construcción de la Malla del Turno de la Tarde
    const turnos_tarde = [
      {
        horario: 'Lun 2:00 PM / Mié y Vie 4:00 PM',
        nivel: 'Sub-6',
        alumnos: turnosCount['Lunes 2:00 PM / Miércoles y Viernes 4:00 PM']
      },
      {
        horario: '03:00 PM',
        nivel: 'Sub-8',
        alumnos: turnosCount['Lunes, Miércoles y Viernes: 03:00 PM']
      },
      {
        horario: '04:00 PM',
        nivel: 'Sub-10',
        alumnos: turnosCount['Lunes, Martes y Jueves: 04:00 PM']
      },
      {
        horario: '05:00 PM - 06:00 PM',
        nivel: 'Sub-12',
        alumnos: turnosCount['Lunes, Miércoles y Viernes: 05:00 PM - 06:00 PM']
      },
      {
        horario: '06:00 PM - 07:00 PM',
        nivel: 'Sub-14',
        alumnos: turnosCount['Lunes, Miércoles y Viernes: 06:00 PM - 07:00 PM']
      }
    ];

    // RETORNO DE DATOS LIMPIOS PARA EL FRONTEND
    return res.status(200).json({
      total_activos: alumnos.length,
      total_morosos: listaMorosos.length,
      total_pendientes: listaPendientes.length,
      total_solventes: listaSolventes.length,
      monto_por_recaudar: listaMorosos.reduce((sum, m) => sum + m.montoDolares, 0),
      morosos: listaMorosos,
      pendientes: listaPendientes,
      solventes: listaSolventes,
      turnos_manana,
      turnos_tarde
    });

  } catch (error) {
    console.error('Error en el reporte de mallas horarias de fútbol:', error);
    return res.status(500).json({ error: 'Error al procesar el panel de control de fútbol.' });
  }
});


// =========================================================================
// PUT: Actualizar la ficha completa de un atleta de fútbol en caliente
// =========================================================================
router.put('/alumnos/:id', async (req, res) => {
  const { id } = req.params;
  const {
    nombre_alumno,
    edad_alumno,
    fecha_nacimiento,
    cedula_alumno,
    direccion,
    patologia,
    es_menor_edad,
    nombre_representante,
    cedula_representante,
    telefono_representante,
    horario_asignado
  } = req.body;

  // 1. Validación de seguridad en el servidor
  if (!id || !nombre_alumno || !edad_alumno || !direccion || !cedula_representante || !telefono_representante || !horario_asignado) {
    return res.status(400).json({ 
      error: 'Error: Faltan campos obligatorios para procesar la actualización del atleta.' 
    });
  }

  try {
    // 📊 Cálculo dinámico del nivel/categoría basado en el horario asignado
    let nivelAutomatico = 'Sub-6';
    if (horario_asignado.includes('03:00 PM')) nivelAutomatico = 'Sub-8';
    if (horario_asignado.includes('04:00 PM')) nivelAutomatico = 'Sub-10';
    if (horario_asignado.includes('05:00 PM')) nivelAutomatico = 'Sub-12';
    if (horario_asignado.includes('06:00 PM')) nivelAutomatico = 'Sub-14';
    if (horario_asignado.includes('08:00 AM')) nivelAutomatico = 'Rango 9 a 14 años (Mañana)';
    if (horario_asignado.includes('09:15 AM')) nivelAutomatico = 'Rango 5 a 8 años (Mañana)';

    // 2. Sentencia SQL corregida incorporando la columna 'nivel'
    const queryText = `
      UPDATE alumnos_futbol 
      SET 
        nombre_alumno = ?, 
        edad_alumno = ?, 
        fecha_nacimiento = ?,
        cedula_alumno = ?,
        direccion = ?, 
        patologia = ?,
        es_menor_edad = ?, 
        nombre_representante = ?, 
        cedula_representante = ?, 
        telefono_representante = ?, 
        nivel = ?,           -- 💥 AGREGA ESTA LÍNEA
        horario_asignado = ?
      WHERE id = ?;
    `;

    // 3. Inyección del valor calculado en la posición exacta del arreglo
    const values = [
      nombre_alumno,
      parseInt(edad_alumno, 10),
      fecha_nacimiento ? fecha_nacimiento.substring(0, 10) : null,
      cedula_alumno || null,
      direccion,
      patologia || null,
      es_menor_edad ? 1 : 0,
      nombre_representante || '',
      cedula_representante,
      telefono_representante,
      nivelAutomatico, // 💥 AGREGA ESTA LÍNEA (Mapea con nivel = ?)
      horario_asignado,
      id
    ];

    const [resultado] = await pool.query(queryText, values);

    // Verificar si el atleta existía en la base de datos
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ 
        error: 'El atleta especificado no se encuentra registrado en el sistema.' 
      });
    }

    return res.status(200).json({
      mensaje: '¡Ficha del atleta y categoría actualizados con éxito en la nube (MySQL)!'
    });

  } catch (error) {
    console.error('Error al actualizar atleta en MySQL (Fútbol):', error);
    return res.status(500).json({ 
      error: 'Error interno en el servidor al intentar modificar el registro.' 
    });
  }
});

router.post('/pagos', async (req, res) => {
  const { 
    alumno_id, 
    monto_dolares, 
    tasa_bcv, 
    monto_bolivares, 
    metodo_pago, 
    referencia, 
    mes_pagado, 
    fecha_registro, // 💡 Clave absoluta para el modo offline
    guardado_offline 
  } = req.body;

  if (!alumno_id || !monto_dolares || !metodo_pago || !mes_pagado || !tasa_bcv) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para procesar el pago de fútbol.' });
  }

  const referenciaFinal = referencia && referencia !== 'N/A' ? referencia : 'N/A';
  const guardadoOfflineFinal = guardado_offline ? 1 : 0;

  const query = `
    INSERT INTO pagos_futbol 
    (alumno_id, monto_dolares, tasa_bcv, monto_bolivares, metodo_pago, referencia, mes_pagado, guardado_offline, fecha_registro) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    // 🧠 ESTRATEGIA OFFLINE: Determinar el tiempo base según el origen del payload
    // Si viene de la cola offline, usamos su marca de tiempo congelada; si es online, el instante actual.
    const tiempoOrigen = fecha_registro ? new Date(fecha_registro) : new Date();
    
    const mesOrigenIndex = tiempoOrigen.getMonth(); 
    const anoOrigen = tiempoOrigen.getFullYear();
    
    // El mes objetivo se calcula relativo al momento en que se hizo el click en el teléfono
    const mesOrigenFormato = `${anoOrigen}-${String(mesOrigenIndex + 1).padStart(2, '0')}`;

    // Saneamiento de marcas de tiempo ISO para MySQL
    const fechaLimpiaMySQL = tiempoOrigen.toISOString().replace('T', ' ').substring(0, 19);

    // =========================================================================
    // CASO 1: Ponerse al Día Total (Deuda Vieja + Mes donde ocurrió el Pago)
    // =========================================================================
    if (mes_pagado === "Ponerse al Día Total" || mes_pagado.includes("Ponerse al Día")) {
      const cantidadTotalFilas = Math.round(parseFloat(monto_dolares) / 15);
      const mesesDeDeudaViejos = cantidadTotalFilas - 1; 

      // Insertamos hacia atrás partiendo del mes de origen congelado
      for (let i = 0; i < mesesDeDeudaViejos; i++) {
        let targetMesIndex = mesOrigenIndex - 1 - i;
        let targetAno = anoOrigen;
        while (targetMesIndex < 0) { targetMesIndex += 12; targetAno--; } // Bucle Seguro
        
        const mesFormateadoCorto = `${targetAno}-${String(targetMesIndex + 1).padStart(2, '0')}`;
        await pool.query(query, [parseInt(alumno_id, 10), 15.00, parseFloat(tasa_bcv), 15.00 * parseFloat(tasa_bcv), metodo_pago, referenciaFinal, mesFormateadoCorto, guardadoOfflineFinal, fechaLimpiaMySQL]);
      }

      // Insertamos el mes de origen (Noviembre si se pagó en Noviembre, así sincronice en Diciembre)
      await pool.query(query, [parseInt(alumno_id, 10), 15.00, parseFloat(tasa_bcv), 15.00 * parseFloat(tasa_bcv), metodo_pago, referenciaFinal, mesOrigenFormato, guardadoOfflineFinal, fechaLimpiaMySQL]);

      return res.status(201).json({ mensaje: '¡Cuenta liquidada por completo de forma retroactiva!' });
    }

    // =========================================================================
    // CASO 2: Abonar meses de deuda (Únicamente ciclos vencidos hacia atrás)
    // =========================================================================
    if (mes_pagado.includes("Abonar 1 Mes") || mes_pagado.includes("Pagar 2 Meses") || mes_pagado.includes("Pagar Toda la Deuda") || mes_pagado.includes("Pendiente")) {
      const mesesViejosAPagar = Math.round(parseFloat(monto_dolares) / 15);

      for (let i = 0; i < mesesViejosAPagar; i++) {
        let targetMesIndex = mesOrigenIndex - 1 - i;
        let targetAno = anoOrigen;
        while (targetMesIndex < 0) { targetMesIndex += 12; targetAno--; }
        
        const mesFormateadoCorto = `${targetAno}-${String(targetMesIndex + 1).padStart(2, '0')}`;
        await pool.query(query, [parseInt(alumno_id, 10), 15.00, parseFloat(tasa_bcv), 15.00 * parseFloat(tasa_bcv), metodo_pago, referenciaFinal, mesFormateadoCorto, guardadoOfflineFinal, fechaLimpiaMySQL]);
      }

      return res.status(201).json({ mensaje: 'Abono a la deuda de fútbol registrado retroactivamente.' });
    }

    // =========================================================================
    // CASO 3: Mensualidad regular estándar o monto manual digitado
    // =========================================================================
    const [result] = await pool.query(query, [
      parseInt(alumno_id, 10), 
      parseFloat(monto_dolares), 
      parseFloat(tasa_bcv), 
      parseFloat(monto_bolivares), 
      metodo_pago, 
      referenciaFinal, 
      mesOrigenFormato, // 💡 Mantiene consistencia temporal
      guardadoOfflineFinal, 
      fechaLimpiaMySQL
    ]);
    
    return res.status(201).json({ mensaje: 'Mensualidad asentada con éxito.', pagoId: result.insertId });

  } catch (error) {
    console.error('❌ Error crítico en pagos offline-ready:', error);
    return res.status(500).json({ error: 'Error interno en el servidor.', detallesSQL: error.message });
  }
});


router.get('/alumnos-lista', async (req, res) => {
  try {
    // Consultamos la tabla oficial de fútbol
    const [rows] = await pool.query('SELECT * FROM alumnos_futbol ORDER BY nombre_alumno ASC');
    
    // Retornamos el arreglo completo al frontend
    return res.status(200).json(rows);
  } catch (error) {
    console.error('❌ Error en el servidor al cargar lista de atletas:', error);
    return res.status(500).json({ 
      error: 'Error interno en el servidor al procesar la nómina de fútbol.' 
    });
  }
});

router.get('/reporte-general', async (req, res) => {
  const PDFDocument = require('pdfkit');
  const { inicio, fin } = req.query;
  
  try {
    // 1. Consulta apuntando estrictamente a alumnos_futbol
    let querySQL = `
      SELECT 
        p.*, 
        a.nombre_alumno, 
        a.cedula_representante 
      FROM pagos_futbol p
      INNER JOIN alumnos_futbol a ON p.alumno_id = a.id
    `;
    
    const queryParams = [];

    if (inicio && fin) {
      querySQL += ` WHERE p.fecha_registro BETWEEN ? AND ? `;
      queryParams.push(`${inicio} 00:00:00`, `${fin} 23:59:59`);
    } else if (inicio) {
      querySQL += ` WHERE p.fecha_registro >= ? `;
      queryParams.push(`${inicio} 00:00:00`);
    } else if (fin) {
      querySQL += ` WHERE p.fecha_registro <= ? `;
      queryParams.push(`${fin} 23:59:59`);
    }

    querySQL += ` ORDER BY p.fecha_registro DESC `;
    const [rows] = await pool.query(querySQL, queryParams);
    
    // 2. Calcular Totales Consolidados
    let totalDolaresEfectivo = 0;
    let totalBolivaresBancos = 0;
    const totalTransacciones = rows.length;

    rows.forEach(pago => {
      const metodo = pago.metodo_pago ? pago.metodo_pago.toLowerCase().trim() : '';
      if (metodo === 'efectivo') {
        totalDolaresEfectivo += parseFloat(pago.monto_dolares || 0);
      } else {
        totalBolivaresBancos += parseFloat(pago.monto_bolivares || 0);
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=Balance_General_Caja_Futbol.pdf');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40 });
    doc.pipe(res);

    // Banner Principal (Verde oscuro corporativo de fútbol)
    let subTextoRango = `Consolidado Completo - Academia de Fútbol`;
    if (inicio && fin) subTextoRango = `Balance Cronológico desde ${inicio} hasta ${fin}`;
    
    doc.rect(40, 40, 712, 50).fill('#064e3b');
    doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold').text('REPORTE GENERAL DE INGRESOS Y AUDITORÍA DE CAJA (FÚTBOL)', 55, 50);
    doc.fontSize(8).font('Helvetica-Oblique').text(`${subTextoRango} | Generado: ${new Date().toLocaleString('es-VE')}`, 55, 68);

    // Tarjetas Informativas Dinámicas
    let boxWidth = 224;
    let boxY = 105;

    doc.rect(40, boxY, boxWidth, 45).fill('#f8fafc').stroke('#e2e8f0');
    doc.fillColor('#475569').fontSize(7).font('Helvetica-Bold').text('TOTAL DIVISAS EN EFECTIVO (USD)', 50, boxY + 10);
    doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text(`$ ${totalDolaresEfectivo.toFixed(2)}`, 50, boxY + 22);

    doc.rect(40 + boxWidth + 20, boxY, boxWidth, 45).fill('#f8fafc').stroke('#e2e8f0');
    doc.fillColor('#059669').fontSize(7).font('Helvetica-Bold').text('TOTAL RECAUDADO EN BOLÍVARES (VES)', 40 + boxWidth + 30, boxY + 10);
    doc.fillColor('#047857').fontSize(14).font('Helvetica-Bold').text(`${totalBolivaresBancos.toFixed(2)} VES`, 40 + boxWidth + 30, boxY + 22);

    doc.rect(40 + (boxWidth * 2) + 40, boxY, boxWidth, 45).fill('#f8fafc').stroke('#e2e8f0');
    doc.fillColor('#475569').fontSize(7).font('Helvetica-Bold').text('COMPROBANTES TOTALES EMITIDOS', 40 + (boxWidth * 2) + 50, boxY + 10);
    doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text(`${totalTransacciones} Transacciones`, 40 + (boxWidth * 2) + 50, boxY + 18);

    // --- Tabla General (Sin columna Origen, con anchos redistribuidos) ---
    let y = 170;
    doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text('DETALLE INDIVIDUAL DE MOVIMIENTOS A CAJA', 40, y);
    y += 15;

    doc.rect(40, y, 712, 20).fill('#e2e8f0');
    doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8);
    doc.text('ID', 45, y + 6, { width: 40 });
    doc.text('Atleta', 90, y + 6, { width: 165 });
    doc.text('Cédula Rep.', 265, y + 6, { width: 75 });
    doc.text('Mes Cobro', 350, y + 6, { width: 85 }); // Más ancho para el mes en letras
    doc.text('Fecha Pago', 445, y + 6, { width: 65 });
    doc.text('Método', 520, y + 6, { width: 70 });
    doc.text('Monto ($)', 600, y + 6, { width: 60, align: 'right' });
    doc.text('Monto (Bs.)', 670, y + 6, { width: 75, align: 'right' });
    
    y += 20;
    doc.font('Helvetica').fontSize(8).fillColor('#0f172a');

    // Diccionario para traducir "2026-11" a letras
    const mesesDiccionario = {
      '01': 'ENERO', '02': 'FEBRERO', '03': 'MARZO', '04': 'ABRIL',
      '05': 'MAYO', '06': 'JUNIO', '07': 'JULIO', '08': 'AGOSTO',
      '09': 'SEPTIEMBRE', '10': 'OCTUBRE', '11': 'NOVIEMBRE', '12': 'DICIEMBRE'
    };
    
    rows.forEach((pago, index) => {
      if (y > 490) { 
        doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 40 }); 
        y = 40; 
      }

      if (index % 2 === 0) {
        doc.rect(40, y, 712, 18).fill('#f8fafc');
        doc.fillColor('#0f172a');
      }

      // Conversión del mes numérico a texto legible
      let mesTexto = (pago.mes_pagado || '').toUpperCase();
      if (pago.mes_pagado && pago.mes_pagado.includes('-')) {
        const [ano, mesNum] = pago.mes_pagado.split('-');
        const nombreMes = mesesDiccionario[mesNum] || mesNum;
        mesTexto = `${nombreMes} ${ano}`;
      }

      const fechaFormateada = new Date(pago.fecha_registro).toLocaleDateString('es-VE');
      const metodoTexto = pago.metodo_pago ? pago.metodo_pago.toUpperCase() : '';
      const montoBsTexto = metodoTexto === 'EFECTIVO' 
        ? 'N/A' 
        : `${parseFloat(pago.monto_bolivares || 0).toFixed(2)}`;

      doc.text(`#${pago.id}`, 45, y + 5, { width: 40 });
      doc.text(pago.nombre_alumno, 90, y + 5, { width: 165, ellipsis: true });
      doc.text(pago.cedula_representante || 'N/P', 265, y + 5, { width: 75 });
      doc.text(mesTexto, 350, y + 5, { width: 85 }); // Imprime ej: "NOVIEMBRE 2026"
      doc.text(fechaFormateada, 445, y + 5, { width: 65 });
      doc.text(metodoTexto, 520, y + 5, { width: 70 });
      doc.text(`$${parseFloat(pago.monto_dolares || 0).toFixed(2)}`, 600, y + 5, { width: 60, align: 'right' });
      doc.text(montoBsTexto, 670, y + 5, { width: 75, align: 'right' });

      doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(40, y + 18).lineTo(752, y + 18).stroke();
      y += 18;
    });

    doc.options.autoPageBreak = false;
    doc.strokeColor('#064e3b').lineWidth(1).moveTo(40, 540).lineTo(752, 540).stroke();
    doc.fillColor('#94a3b8').fontSize(7).text('Reporte de Auditoría Central Interno - Academia de Fútbol Base Los Pinos.', 40, 550);
    doc.options.autoPageBreak = true;

    doc.end();

  } catch (error) {
    console.error('❌ Error crítico en generación del PDF:', error);
    if (!res.headersSent) {
      return res.status(500).send('Error interno del servidor.');
    }
  }
});

// GET: Generar y mostrar vista previa del recibo digital de fútbol en PDF
router.get('/alumnos/:id/recibo-pdf', async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Consultar los datos del atleta de fútbol
    const [atletas] = await pool.query('SELECT * FROM alumnos_futbol WHERE id = ?', [id]);
    if (atletas.length === 0) {
      return res.status(404).send('Atleta no encontrado en el sistema.');
    }
    const atleta = atletas[0];

    // 2. ✅ CORREGIDO: Añadimos MAX(id) AS id para que no llegue undefined
    const [pagos] = await pool.query(`
      SELECT 
        MAX(id) AS id,
        alumno_id,
        GROUP_CONCAT(mes_pagado ORDER BY mes_pagado ASC SEPARATOR ', ') AS meses_agrupados,
        metodo_pago,
        referencia,
        tasa_bcv,
        SUM(monto_dolares) AS total_dolares,
        SUM(monto_bolivares) AS total_bolivares,
        fecha_registro
      FROM pagos_futbol 
      WHERE alumno_id = ? 
        AND fecha_registro = (SELECT MAX(fecha_registro) FROM pagos_futbol WHERE alumno_id = ?)
      GROUP BY fecha_registro, alumno_id, metodo_pago, referencia, tasa_bcv
    `, [id, id]);

    if (pagos.length === 0) {
      return res.status(404).send('Este atleta no registra pagos cargados en el sistema.');
    }
    const pago = pagos[0];

    const mesesDiccionario = {
      '01': 'ENERO', '02': 'FEBRERO', '03': 'MARZO', '04': 'ABRIL',
      '05': 'MAYO', '06': 'JUNIO', '07': 'JULIO', '08': 'AGOSTO',
      '09': 'SEPTIEMBRE', '10': 'OCTUBRE', '11': 'NOVIEMBRE', '12': 'DICIEMBRE'
    };

    const mesesLegiblesArray = pago.meses_agrupados.split(', ').map(mesRaw => {
      if (mesRaw.includes('-')) {
        const [ano, mesNum] = mesRaw.split('-');
        const nombreMes = mesesDiccionario[mesNum] || mesNum;
        return `${nombreMes} ${ano}`;
      }
      return mesRaw.toUpperCase();
    });
    
    const mesesLiquidadosFinal = mesesLegiblesArray.join(' / ');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Recibo_Futbol_LosPinos_ID_${id}.pdf`);

    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    doc.pipe(res);

    // Marco Estético Perimetral
    doc.rect(20, 20, 572, 752).stroke('#cbd5e1');

    // 📸 INTEGRACIÓN DEL CINTILLO
    try {
      const rutaCintillo = path.join(__dirname, 'public', 'cintillo_pago_mensualidad_futbol.png');
      doc.image(rutaCintillo, 40, 35, { width: 532, height: 65 });
    } catch (imgError) {
      console.warn("⚠️ Advertencia: No se encontró cintillo.png, usando texto de respaldo.");
      doc.fillColor('#065f46').font('Helvetica-Bold').fontSize(22).text('COMPLEJO DEPORTIVO LOS PINOS', 40, 50);
    }
    
    doc.moveTo(40, 115).lineTo(550, 115).stroke('#e2e8f0');

    // DATOS DE CONTROL INTERNO (Ya no dará error al tener la propiedad id)
    doc.fillColor('#475569').font('Helvetica').fontSize(10);
    doc.text(`Nro. Recibo: #FUT-${pago.id.toString().padStart(5, '0')}`, 400, 125, { align: 'right' });
    doc.text(`Fecha Emisión: ${new Date(pago.fecha_registro).toLocaleDateString('es-VE')}`, 400, 140, { align: 'right' });
    doc.text('Estatus: ORIGINAL / APROBADO ✅', 400, 155, { align: 'right' });

    // SECCIÓN 1: IDENTIFICACIÓN DEL ATLETA Y REPRESENTANTE
    doc.fillColor('#065f46').font('Helvetica-Bold').fontSize(12).text('1. INFORMACIÓN DEL ATLETA', 40, 185);
    doc.moveTo(40, 200).lineTo(550, 200).stroke('#f1f5f9');

    doc.fillColor('#1e293b').font('Helvetica').fontSize(10);
    doc.text(`Atleta: ${atleta.nombre_alumno}`, 40, 215);
    doc.text(`Cédula Atleta: ${atleta.cedula_alumno || 'N/A'}`, 40, 230);
    doc.text(`Categoría: ${atleta.nivel}`, 40, 245);
    doc.text(`Horario: ${atleta.horario_asignado}`, 40, 260);

    doc.text(`Representante: ${atleta.nombre_representante}`, 300, 215);
    doc.text(`Cédula Rep.: ${atleta.cedula_representante}`, 300, 230);
    doc.text(`Teléfono Contacto: ${atleta.telefono_representante}`, 300, 245);

    // SECCIÓN 2: AUDITORÍA Y DETALLE DE LA TRANSACCIÓN
    doc.fillColor('#065f46').font('Helvetica-Bold').fontSize(12).text('2. DETALLES DE FACTURACIÓN', 40, 295);
    doc.moveTo(40, 310).lineTo(550, 310).stroke('#f1f5f9');

    doc.fillColor('#1e293b').font('Helvetica');
    doc.text(`Meses Liquidados: ${mesesLiquidadosFinal}`, 40, 325); 
    doc.text(`Canal de Pago: ${pago.metodo_pago.toUpperCase()}`, 40, 340);
    doc.text(`Referencia Bancaria: ${pago.referencia}`, 40, 355);
    doc.text(`Tasa de Cambio BCV: __________________ VES/USD`, 40, 370);

    // TABLA O CUADRO RESUMEN DE IMPORTES
    doc.roundedRect(40, 400, 510, 60, 8).fill('#f8fafc');
    
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(11).text('TOTAL PROCESADO (USD $):', 60, 420);
    doc.fillColor('#065f46').font('Helvetica-Bold').fontSize(16).text(`$${parseFloat(pago.total_dolares).toFixed(2)}`, 240, 417); 

    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(11).text('MTO. EQUIVALENTE (VES): _________________', 300, 420);
    // PIE DE PÁGINA INSTITUCIONAL
    doc.moveTo(40, 680).lineTo(550, 680).stroke('#cbd5e1');
    doc.fillColor('#94a3b8').font('Helvetica-Oblique').fontSize(8);
    doc.text('Este documento digital sirve como comprobante legal de pago para la Academia de Fútbol Base Los Pinos.', 40, 695, { align: 'center' });
    doc.text('Generado automáticamente por el Sistema Administrativo de Control y Caja Los Pinos.', 40, 708, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('Error generando PDF de fútbol en Render:', error);
    if (!res.headersSent) {
      res.status(500).send('Error interno del servidor al procesar el archivo PDF.');
    }
  }
});
// =========================================================================
// ⚽ ENDPOINTS DE ASISTENCIA: ACADEMIA DE FÚTBOL LOS PINOS
// =========================================================================

router.post('/asistencias', async (req, res) => {
  const { fecha, horario, bloque, registros } = req.body;

  if (!fecha || !horario || !bloque || !registros || !Array.isArray(registros)) {
    return res.status(400).json({ error: 'Estructura de reporte incompleta.' });
  }

  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    console.log(`⏳ [Fútbol] Actualizando malla horaria ${horario} del día ${fecha}...`);

    // 💡 SOLUCIÓN REAL: ON DUPLICATE KEY UPDATE pisa el valor sin borrar la fila completa
    const querySQL = `
      INSERT INTO asistencias_futbol (alumno_id, fecha, horario, bloque, asistio) 
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        asistio = VALUES(asistio)
    `;

    for (const reg of registros) {
      await conexion.query(querySQL, [
        parseInt(reg.alumno_id, 10),
        fecha,
        horario,
        bloque,
        parseInt(reg.asistio, 10)
      ]);
    }

    await conexion.commit();
    console.log(`✅ [Fútbol] Turno actualizado con éxito en la base de datos.`);
    
    return res.status(200).json({ 
      mensaje: 'Asistencia sincronizada correctamente.',
      registrados: registros.length 
    });

  } catch (error) {
    await conexion.rollback();
    console.error('❌ Error en el motor de asistencia de fútbol:', error);
    return res.status(500).json({ error: 'Error interno en la transacción SQL.', detalle: error.message });
  } finally {
    conexion.release();
  }
});

// 2. GET: Obtener las mallas que ya pasaron lista hoy para pintarlas en verde en la UI
router.get('/asistencias-completadas', async (req, res) => {
  const { fecha } = req.query;
  try {
    const [rows] = await pool.query('SELECT DISTINCT horario FROM asistencias_futbol WHERE fecha = ?', [fecha]);
    const completados = rows.map(r => r.horario);
    return res.status(200).json(completados);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 3. GET: Precargar datos de asistencia previa si el profesor va a editar o re-pasar lista
router.get('/asistencia-previa', async (req, res) => {
  const { fecha, horario } = req.query;
  try {
    const [rows] = await pool.query('SELECT alumno_id, asistio FROM asistencias_futbol WHERE fecha = ? AND horario = ?', [fecha, horario]);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 4. GET: Historial semanal dinámico filtrado por la semana en curso (Libro de Actas)
router.get('/asistencia-resumen-semanal', async (req, res) => {
  try {
    const querySQL = `
      SELECT 
        horario,
        fecha AS fecha_iso, 
        DATE_FORMAT(fecha, '%d/%m/%Y') AS fecha_corta,
        SUM(CASE WHEN asistio = 1 THEN 1 ELSE 0 END) AS presentes,
        SUM(CASE WHEN asistio = 0 THEN 1 ELSE 0 END) AS ausentes
      FROM asistencias_futbol
      WHERE YEARWEEK(fecha, 1) = YEARWEEK(NOW(), 1)
      GROUP BY horario, fecha
      ORDER BY fecha DESC, horario ASC
    `;
    
    const [rows] = await pool.query(querySQL);
    
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json(rows);
  } catch (error) {
    console.error('❌ Error al generar el historial de asistencia de fútbol:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 5. GET: Obtener el listado detallado de atletas para auditorías históricas
router.get('/asistencia-detalle', async (req, res) => {
  const { fecha, horario } = req.query;
  
  if (!fecha || !horario) {
    return res.status(400).json({ error: 'Los parámetros fecha y horario son obligatorios.' });
  }

  try {
    // 💡 MODIFICADO: INNER JOIN apuntando a la tabla específica de tus alumnos de fútbol
    const querySQL = `
      SELECT f.nombre_alumno, ast.asistio 
      FROM asistencias_futbol ast
      INNER JOIN futbol_alumnos f ON ast.alumno_id = f.id
      WHERE ast.fecha = ? AND ast.horario = ?
      ORDER BY f.nombre_alumno ASC
    `;
    const [rows] = await pool.query(querySQL, [fecha, horario]);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Error en asistencia-detalle fútbol:', error);
    return res.status(500).json({ error: error.message });
  }
});


// =========================================================================
// 📊 ENDPOINT: REPORTE PDF DE ESTADÍSTICAS Y PERMANENCIA (FÚTBOL)
// =========================================================================
router.get('/reporte-asistencia', async (req, res) => {
  const { inicio, fin } = req.query;

  try {
    // 1. Construimos el filtro dinámico de fechas si el usuario seleccionó un rango
    let filtroFecha = '';
    const params = [];

    if (inicio && fin) {
      filtroFecha = 'AND ast.fecha BETWEEN ? AND ?';
      params.push(inicio, fin);
    } else if (inicio) {
      filtroFecha = 'AND ast.fecha >= ?';
      params.push(inicio);
    } else if (fin) {
      filtroFecha = 'AND ast.fecha <= ?';
      params.push(fin);
    }

    // 2. Consulta SQL que cruza alumnos de fútbol con sus asistencias y calcula porcentajes
    const querySQL = `
      SELECT 
        f.nombre_alumno,
        f.nivel AS categoria,
        COUNT(ast.id) AS total_clases,
        SUM(CASE WHEN ast.asistio = 1 THEN 1 ELSE 0 END) AS asistencias,
        SUM(CASE WHEN ast.asistio = 0 THEN 1 ELSE 0 END) AS inasistencias,
        ROUND((SUM(CASE WHEN ast.asistio = 1 THEN 1 ELSE 0 END) / COUNT(ast.id)) * 100, 1) AS porcentaje
      FROM alumnos_futbol f
      INNER JOIN asistencias_futbol ast ON f.id = ast.alumno_id
      WHERE 1=1 ${filtroFecha}
      GROUP BY f.id, f.nombre_alumno, f.nivel
      ORDER BY f.nivel ASC, porcentaje DESC, f.nombre_alumno ASC
    `;

    const [rows] = await pool.query(querySQL, params);

    // 3. Configuramos las cabeceras HTTP para descarga/visualización directa de PDF
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Reporte_Asistencia_Futbol.pdf"');
    doc.pipe(res);

    // 4. Encabezado Institucional (Verde Esmeralda)
    doc.rect(0, 0, doc.page.width, 85).fill('#059669');
    doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold')
       .text('ACADEMIA DE FÚTBOL LOS PINOS', 40, 25);
    doc.fontSize(10).font('Helvetica')
       .text('REPORTE OFICIAL DE ASISTENCIA Y PERMANENCIA DE ATLETAS', 40, 50);

    const rangoTexto = (inicio && fin) 
      ? `Período evaluado: ${inicio} al ${fin}` 
      : 'Período evaluado: Histórico General Completo';
    doc.fontSize(9).text(rangoTexto, 40, 65);

    doc.moveDown(3);

    // 5. Cabecera de la Tabla en el PDF
    let yPos = 110;
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold');
    doc.text('ATLETA', 40, yPos);
    doc.text('CATEGORÍA', 220, yPos);
    doc.text('CLASES', 310, yPos, { width: 50, align: 'center' });
    doc.text('ASIST.', 365, yPos, { width: 50, align: 'center' });
    doc.text('FALTAS', 420, yPos, { width: 50, align: 'center' });
    doc.text('EFECTIVIDAD', 480, yPos, { width: 70, align: 'right' });

    doc.moveTo(40, yPos + 14).lineTo(555, yPos + 14).strokeColor('#CBD5E1').stroke();
    yPos += 22;

    // 6. Renderizado de filas de atletas
    if (rows.length === 0) {
      doc.fillColor('#64748B').font('Helvetica-Oblique').fontSize(10)
         .text('No se encontraron registros de asistencia en el rango de fechas seleccionado.', 40, yPos);
    } else {
      rows.forEach((row, index) => {
        // Salto de página automático si se llena la hoja
        if (yPos > 750) {
          doc.addPage();
          yPos = 50;
        }

        // Fondo alternado sutil para legibilidad
        if (index % 2 === 0) {
          doc.rect(40, yPos - 4, 515, 18).fill('#F8FAFC');
        }

        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(8.5)
           .text(row.nombre_alumno.toUpperCase(), 40, yPos, { width: 175, ellipsis: true });
        
        doc.fillColor('#059669').font('Helvetica-Bold')
           .text(row.categoria || 'N/A', 220, yPos);

        doc.fillColor('#334155').font('Helvetica')
           .text(String(row.total_clases), 310, yPos, { width: 50, align: 'center' })
           .text(String(row.asistencias), 365, yPos, { width: 50, align: 'center' })
           .text(String(row.inasistencias), 420, yPos, { width: 50, align: 'center' });

        // Color condicional según el porcentaje de asistencia
        const colorPorcentaje = row.porcentaje >= 75 ? '#059669' : row.porcentaje >= 50 ? '#D97706' : '#E11D48';
        doc.fillColor(colorPorcentaje).font('Helvetica-Bold')
           .text(`${row.porcentaje}%`, 480, yPos, { width: 70, align: 'right' });

        yPos += 20;
      });
    }

    // 7. Pie de página con fecha de emisión
    doc.fontSize(8).fillColor('#94A3B8').font('Helvetica')
       .text(`Documento generado automáticamente el ${new Date().toLocaleDateString('es-VE')} - Sistema de Gestión Deportiva`, 40, 780, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('❌ Error generando reporte PDF de asistencia fútbol:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error interno al generar el PDF de asistencia.', detalle: error.message });
    }
  }
});

module.exports = router;
