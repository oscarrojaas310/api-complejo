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
