// src/db.js - Deja este archivo exactamente así
const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false 
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}).promise();

pool.query('SELECT NOW()')
  .then(() => {
    console.log('🌐 ¡Enlace seguro establecido con MySQL en Aiven (Nueva York)!');
  })
  .catch((err) => {
    console.error('❌ Error crítico al conectar con el MySQL de Aiven:', err.message);
  });

module.exports = pool;
/*
// src/db.js - Configuración inteligente para XAMPP (Local) y Aiven (Nube)
const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  
  // 🌟 CAMBIO CLAVE: Si el host es tu máquina local, apaga el SSL para XAMPP.
  // Si es cualquier otro host (como el de la nube), activa el soporte SSL de Aiven.
  ssl: process.env.DB_HOST === '127.0.0.1' || process.env.DB_HOST === 'localhost'
    ? false 
    : { rejectUnauthorized: false },

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}).promise();

// Mensajes de diagnóstico adaptados al entorno actual
pool.query('SELECT NOW()')
  .then(() => {
    if (process.env.DB_HOST === '127.0.0.1' || process.env.DB_HOST === 'localhost') {
      console.log('💻 ¡Enlace local establecido con éxito en tu MySQL de XAMPP!');
    } else {
      console.log('🌐 ¡Enlace seguro establecido con MySQL en Aiven (Nueva York)!');
    }
  })
  .catch((err) => {
    console.error('❌ Error crítico al conectar con la base de datos:', err.message);
  });

module.exports = pool;
*/