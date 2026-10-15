// index.js (En la raíz de api-complejo)
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./src/db'); // Levanta la conexión de prueba a PostgreSQL
const rutasPiscina = require('./src/piscina'); // Importa las rutas de inscripción

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares globales
app.use(cors()); // Evita bloqueos de seguridad al conectar con React/Vercel
app.use(express.json()); // Habilita la lectura de formatos JSON (req.body)

// Enlace de Endpoints operativos
// Tu ruta final será: http://localhost:5000/api/piscina/inscripciones
app.use('/api/piscina', rutasPiscina);

// Ruta de diagnóstico del backend
app.get('/', (req, res) => {
  res.send('Servidor de api-complejo corriendo en PostgreSQL y listo para la piscina 🏊🚀');
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo exitosamente en http://localhost:${PORT}`);
});
