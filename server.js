require('dotenv').config()
const sql = require('mssql')
const express = require('express')
const app = express()
app.use(express.json())

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
}

app.get('/api/health', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query('SELECT 1 AS connected')
    res.json({ status: 'ok', db: result.recordset[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(3000, () => {
  console.log('Server running on port 3000')
})
