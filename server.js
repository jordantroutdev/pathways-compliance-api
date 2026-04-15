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

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query('SELECT 1 AS connected')
    res.json({ status: 'ok', db: result.recordset[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET ALL STAFF ─────────────────────────────────────────
app.get('/api/staff', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .query('SELECT * FROM compliance.staff ORDER BY full_name')
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET ONE STAFF MEMBER ──────────────────────────────────
app.get('/api/staff/:id', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM compliance.staff WHERE id = @id')
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' })
    }
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── CREATE STAFF ──────────────────────────────────────────
app.post('/api/staff', async (req, res) => {
  try {
    const { full_name, employee_id, office, job_title, email, phone, employment_status } = req.body
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('full_name', sql.NVarChar, full_name)
      .input('employee_id', sql.NVarChar, employee_id)
      .input('office', sql.NVarChar, office)
      .input('job_title', sql.NVarChar, job_title)
      .input('email', sql.NVarChar, email)
      .input('phone', sql.NVarChar, phone)
      .input('employment_status', sql.NVarChar, employment_status)
      .query(`INSERT INTO compliance.staff 
        (full_name, employee_id, office, job_title, email, phone, employment_status)
        OUTPUT INSERTED.*
        VALUES (@full_name, @employee_id, @office, @job_title, @email, @phone, @employment_status)`)
    res.status(201).json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── UPDATE STAFF ──────────────────────────────────────────
app.put('/api/staff/:id', async (req, res) => {
  try {
    const { full_name, office, job_title, email, phone, employment_status } = req.body
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('full_name', sql.NVarChar, full_name)
      .input('office', sql.NVarChar, office)
      .input('job_title', sql.NVarChar, job_title)
      .input('email', sql.NVarChar, email)
      .input('phone', sql.NVarChar, phone)
      .input('employment_status', sql.NVarChar, employment_status)
      .query(`UPDATE compliance.staff SET
        full_name = @full_name,
        office = @office,
        job_title = @job_title,
        email = @email,
        phone = @phone,
        employment_status = @employment_status,
        updated_at = GETDATE()
        OUTPUT INSERTED.*
        WHERE id = @id`)
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' })
    }
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE STAFF ──────────────────────────────────────────
app.delete('/api/staff/:id', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('DELETE FROM compliance.staff WHERE id = @id')
    res.json({ message: 'Staff member deleted' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(3000, () => {
  console.log('Server running on port 3000')
})
