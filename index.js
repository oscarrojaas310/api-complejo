// index.js (En la raíz de api-complejo)
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./src/db'); // Levanta la conexión de prueba a la Base de Datos
const rutasPiscina = require('./src/piscina'); // Importa las rutas de inscripción de piscina
const rutasFutbol = require('./src/futbol'); // Importa las rutas de inscripción de fútbol

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares globales
app.use(cors()); // Evita bloqueos de seguridad al conectar con React/Vercel
app.use(express.json()); // Habilita la lectura de formatos JSON (req.body)

// Enlace de Endpoints operativos
app.use('/api/piscina', rutasPiscina);
app.use('/api/futbol', rutasFutbol);

// Ruta de diagnóstico del backend
app.get('/', (req, res) => {
  res.send('Servidor de api-complejo corriendo y listo para los deportes 🏊⚽🚀');
});

// Inicialización del Servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo exitosamente en http://localhost:${PORT}`);
});
