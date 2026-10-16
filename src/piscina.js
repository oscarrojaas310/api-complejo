// src/piscina.js
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
      horario_assigned = horario_asignado
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
    
    // Inicializamos las mallas reales para el conteo dinámico
    let turnosMañanaCount = { '08:00 AM - 09:00 AM': 0, '09:00 AM - 10:00 AM': 0, '10:00 AM - 11:00 AM': 0 };
    let turnosTardeCount = { '03:00 PM - 04:00 PM': 0, '04:00 PM - 05:00 PM': 0, '05:00 PM - 06:00 PM': 0 };

    alumnos.forEach(alumno => {
      // Contabilizar alumnos en los turnos
      if (turnosMañanaCount[alumno.horario_asignado] !== undefined) turnosMañanaCount[alumno.horario_asignado]++;
      if (turnosTardeCount[alumno.horario_asignado] !== undefined) turnosTardeCount[alumno.horario_asignado]++;

      const fechaReg = new Date(alumno.registrado_el);
      let anoInicioDeuda = fechaReg.getFullYear();
      let mesInicioDeuda = fechaReg.getMonth();
      const diaReg = fechaReg.getDate();

      // REGLA DEL 16: Si se inscribió del 16 en adelante, su obligación financiera empieza el mes siguiente
      if (diaReg >= 16) {
        if (mesInicioDeuda === 11) { 
          mesInicioDeuda = 0;
          anoInicioDeuda++;
        } else {
          mesInicioDeuda++;
        }
      }

      // Calculamos cuántos meses han transcurrido desde su mes de inicio exigible hasta el mes ACTUAL
      const mesesTranscurridos = (anoActual - anoInicioDeuda) * 12 + (mesActual - mesInicioDeuda) + 1;

      // REGLA DE MOROSIDAD AMIGABLE: El mes en curso NO cuenta como deuda pendiente para la lista de morosos.
      const mesesExigiblesVencidos = mesesTranscurridos - 1;

      if (mesesExigiblesVencidos <= 0) {
        return; 
      }

      // Buscar qué meses ha pagado el alumno en la base de datos
      const mesesPagados = pagos.filter(p => p.alumno_id === alumno.id).length;

      // La deuda real son los meses del pasado que ya cerraron y que aún no ha pagado
      const mesesDeuda = mesesExigiblesVencidos - mesesPagados;

      if (mesesDeuda > 0) {
        listaMorosos.push({
          ...alumno,
          mesesDeuda: mesesDeuda,
          montoDolares: mesesDeuda * 20, 
          alertaCritica: mesesDeuda > 1 
        });
      }
    });

    // ORDENAR: Los morosos que deben más meses (críticos) encabezan la lista
    listaMorosos.sort((a, b) => b.mesesDeuda - a.mesesDeuda);

    // Mapear los contadores al formato que espera el componente de React
    const turnos_manana = Object.keys(turnosMañanaCount).map(h => ({ 
      horario: h, 
      nivel: h === '08:00 AM - 09:00 AM' ? 'Infantil / Iniciación' : h === '09:00 AM - 10:00 AM' ? 'Adultos / Master' : 'Libre / Práctica', 
      alumnos: turnosMañanaCount[h] 
    }));

    const turnos_tarde = Object.keys(turnosTardeCount).map(h => ({ 
      horario: h, 
      nivel: h === '03:00 PM - 04:00 PM' ? 'Infantil / Adaptación' : h === '04:00 PM - 05:00 PM' ? 'Juvenil / Estilos' : 'Entrenamiento Avanzado', 
      alumnos: turnosTardeCount[h] 
    }));

    return res.status(200).json({
      total_activos: alumnos.length,
      total_morosos: listaMorosos.length,
      monto_por_recaudar: listaMorosos.reduce((sum, m) => sum + m.montoDolares, 0),
      morosos: listaMorosos,
      turnos_manana,
      turnos_tarde
    });

  } catch (error) {
    console.error('Error en el cálculo de morosidad amigable:', error);
    return res.status(500).json({ error: 'Error al procesar el reporte de caja.' });
  }
});

module.exports = router;
