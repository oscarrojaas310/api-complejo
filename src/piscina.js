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
    nivel,
    horario_assigned // Asegúrate de recibirlo tal cual lo manda tu frontend
  } = req.body;

  // Validación en el servidor
  if (!nombre_alumno || !edad_alumno || !direccion || !cedula_representante || !telefono_representante || !nivel || !req.body.horario_asignado) {
    return res.status(400).json({ 
      error: 'Error: Faltan campos obligatorios para procesar la inscripción.' 
    });
  }

  // Capturamos el horario_asignado del body
  const horario_asignado = req.body.horario_asignado;

  try {
    // Consulta SQL estructurada para tu tabla MySQL
    // Nota: id es AUTO_INCREMENT y registrado_el usa el tiempo del servidor mediante NOW()
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
      es_menor_edad ? 1 : 0, // En MySQL los booleanos se guardan como 1 (true) o 0 (false)
      nombre_representante,
      cedula_representante,
      telefono_representante,
      nivel,
      horario_asignado
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
// GET: Obtener estadísticas globales y listado de alumnos (Morosos y Turnos)
router.get('/dashboard', async (req, res) => {
  try {
    // 1. Traer todos los alumnos de la base de datos de Aiven
    const [alumnos] = await pool.query('SELECT * FROM alumnos ORDER BY registrado_el DESC');

    // 2. Lógica del Día 16 para evaluar Morosidad en Caliente
    const hoy = new Date();
    const diaActual = hoy.getDate();
    
    // Obtenemos el mes y año en curso (Ej: "octubre de 2026")
    const opcionesMes = { month: 'long', year: 'numeric' };
    const mesActualTexto = hoy.toLocaleDateString('es-VE', opcionesMes);

    // Procesamos cada alumno para inyectarle su estatus financiero real
    const alumnosProcesados = alumnos.map(alumno => {
      let estatus_pago = 'al_dia';
      
      // Regla de negocio: Si ya pasamos el 16 del mes y no hay registro de pago, pasa a moroso
      if (diaActual >= 16) {
        // NOTA FUTURA: Aquí evaluarás contra tu tabla de "pagos". 
        // Por ahora, simulamos morosidad si el alumno se registró en meses anteriores y no este mes.
        const mesRegistro = new Date(alumno.registrado_el).toLocaleDateString('es-VE', opcionesMes);
        if (mesRegistro !== mesActualTexto) {
          estatus_pago = 'moroso';
        }
      }

      return {
        ...alumno,
        estatus_pago
      };
    });

    // 3. Filtrar alumnos morosos para la tabla del dueño
    const listaMorosos = alumnosProcesados.filter(a => a.estatus_pago === 'moroso');

    // 4. Calcular la distribución de alumnos por turnos reales
    const turnosMañana = [
      { horario: '08:00 AM - 09:00 AM', nivel: 'Infantil / Iniciación', alumnos: 0 },
      { horario: '09:00 AM - 10:00 AM', nivel: 'Adultos / Master', alumnos: 0 },
      { horario: '10:00 AM - 11:00 AM', nivel: 'Libre / Práctica', alumnos: 0 }
    ];

    const turnosTarde = [
      { horario: '03:00 PM - 04:00 PM', nivel: 'Infantil / Adaptación', alumnos: 0 },
      { horario: '04:00 PM - 05:00 PM', nivel: 'Juvenil / Estilos', alumnos: 0 },
      { horario: '05:00 PM - 06:00 PM', nivel: 'Entrenamiento Avanzado', alumnos: 0 }
    ];

    // Contar cuántos alumnos pertenecen a cada turno en tiempo real
    alumnosProcesados.forEach(alumno => {
      const mallaM = turnosMañana.find(t => t.horario === alumno.horario_asignado);
      const mallaT = turnosTarde.find(t => t.horario === alumno.horario_asignado);
      
      if (mallaM) mallaM.alumnos++;
      if (mallaT) mallaT.alumnos++;
    });

    // 5. Enviar el paquete consolidado al frontend
    return res.status(200).json({
      total_activos: alumnosProcesados.length,
      total_morosos: listaMorosos.length,
      monto_por_recaudar: listaMorosos.length * 20, // Asumiendo una mensualidad base de $20
      morosos: listaMorosos,
      turnos_manana: turnosMañana,
      turnos_tarde: turnosTarde
    });

  } catch (error) {
    console.error('Error al calcular métricas en MySQL:', error);
    return res.status(500).json({ error: 'Error al cargar el panel de control.' });
  }
});


module.exports = router;
