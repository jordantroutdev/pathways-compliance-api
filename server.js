const { webcrypto } = require('crypto')
globalThis.crypto = webcrypto

require('dotenv').config()
const cors = require('cors')
const sql = require('mssql')
const express = require('express')
const app = express()
const { BlobServiceClient } = require('@azure/storage-blob')
const { randomUUID } = require('crypto')
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage() })
app.use(express.json())

app.use(cors({
	origin: [
	 'https://orange-desert-0cac6391e.7.azurestaticapps.net',
	 'http://localhost:5173'
	]
}))

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

// Keep Azure SQL connection alive
setInterval(async () => {
  try {
    const pool = await sql.connect(dbConfig)
    await pool.request().query('SELECT 1')
  } catch (err) {
    console.error('Keep-alive ping failed:', err.message)
  }
}, 4 * 60 * 1000) // every 4 minutes

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
    const { full_name, office, job_title, email, phone, employment_status, preferred_contact, notes } = req.body
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('full_name', sql.NVarChar, full_name)
      .input('office', sql.NVarChar, office)
      .input('job_title', sql.NVarChar, job_title)
      .input('email', sql.NVarChar, email)
      .input('phone', sql.NVarChar, phone)
      .input('employment_status', sql.NVarChar, employment_status)
      .input('preferred_contact', sql.VarChar, preferred_contact || null)
      .input('notes', sql.NVarChar, notes || null)
      .query(`UPDATE compliance.staff SET
        full_name = @full_name,
        office = @office,
        job_title = @job_title,
        email = @email,
        phone = @phone,
        employment_status = @employment_status,
        preferred_contact = @preferred_contact,
        notes = @notes,
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

// ── GET ALL COMPLIANCE ISSUES ─────────────────────────────
app.get('/api/compliance-issues', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query(`
      SELECT 
        ci.id,
        ci.staff_name_raw,
        ci.category,
        ci.issue_description,
        ci.non_compliant_date,
        ci.supervisor_name_raw,
        ci.status,
        ci.first_scraped_at,
        ci.last_seen_at,
	ci.staff_id,
        s.office,
        s.email
      FROM compliance.compliance_issues ci
      LEFT JOIN compliance.staff s ON ci.staff_id = s.id
      ORDER BY ci.first_scraped_at DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/staff/:id/compliance-issues', async (req, res) => {
  const staffId = parseInt(req.params.id);

  if (isNaN(staffId)) {
    return res.status(400).json({ error: 'Invalid staff ID' });
  }

  try {
    const pool = await sql.connect(dbConfig);

    // Query 1: fetch the staff record
    const staffResult = await pool.request()
      .input('id', sql.Int, staffId)
      .query('SELECT id, full_name, office, job_title, email, phone, employment_status FROM compliance.staff WHERE id = @id');

    if (staffResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Query 2: fetch all compliance issues for this staff member
    const issuesResult = await pool.request()
      .input('staff_id', sql.Int, staffId)
      .query('SELECT id, category, issue_description, non_compliant_date, status FROM compliance.compliance_issues WHERE staff_id = @staff_id ORDER BY non_compliant_date DESC');

    res.json({
      staff: staffResult.recordset[0],
      issues: issuesResult.recordset
    });

  } catch (err) {
    console.error('Profile endpoint error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.patch('/api/compliance-issues/:id/resolve', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('resolved_by', sql.NVarChar, 'Coordinator')
      .query(`
        UPDATE compliance.compliance_issues
        SET status = 'resolved',
            resolved_at = GETDATE(),
            resolved_by = @resolved_by
        OUTPUT INSERTED.*
        WHERE id = @id
      `)
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Issue not found' })
    }
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GENERATE SUBMISSION TOKEN ─────────────────────────────
app.post('/api/submission-tokens', async (req, res) => {
  try {
    const { staff_id, issue_id } = req.body
    const token = randomUUID()
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const pool = await sql.connect(dbConfig)
    await pool.request()
      .input('token', sql.NVarChar, token)
      .input('staff_id', sql.Int, staff_id)
      .input('issue_id', sql.Int, issue_id)
      .input('expires_at', sql.DateTime2, expires_at)
      .query(`
        INSERT INTO compliance.submission_tokens (token, staff_id, issue_id, expires_at)
        VALUES (@token, @staff_id, @issue_id, @expires_at)
      `)

    res.json({ token, expires_at })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── VALIDATE SUBMISSION TOKEN ─────────────────────────────
app.get('/api/submit/:token', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('token', sql.NVarChar, req.params.token)
      .query(`
        SELECT
          st.token,
          st.expires_at,
          st.used_at,
          s.id as staff_id,
          s.full_name,
          s.email,
          ci.id as issue_id,
          ci.category,
          ci.issue_description,
          ci.non_compliant_date
        FROM compliance.submission_tokens st
        JOIN compliance.staff s ON st.staff_id = s.id
        JOIN compliance.compliance_issues ci ON st.issue_id = ci.id
        WHERE st.token = @token
      `)

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired link' })
    }

    const record = result.recordset[0]

    if (record.used_at) {
      return res.status(410).json({ error: 'This link has already been used' })
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This link has expired' })
    }

    res.json(record)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── SUBMIT DOCUMENT ───────────────────────────────────────
app.post('/api/submit/:token', upload.single('document'), async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)

    // Validate token first
    const tokenResult = await pool.request()
      .input('token', sql.NVarChar, req.params.token)
      .query(`
        SELECT * FROM compliance.submission_tokens
        WHERE token = @token
      `)

    if (tokenResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Invalid link' })
    }

    const tokenRecord = tokenResult.recordset[0]

    if (tokenRecord.used_at) {
      return res.status(410).json({ error: 'This link has already been used' })
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This link has expired' })
    }

    // Upload file to blob storage
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING)
    const containerClient = blobServiceClient.getContainerClient('compliance-documents')

    const blobName = `${tokenRecord.staff_id}/${tokenRecord.issue_id}/${Date.now()}-${req.file.originalname}`
    const blockBlobClient = containerClient.getBlockBlobClient(blobName)

    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype }
    })

    const documentUrl = blockBlobClient.url

    // Mark token as used and update compliance issue
    await pool.request()
      .input('token', sql.NVarChar, req.params.token)
      .input('used_at', sql.DateTime2, new Date())
      .query(`UPDATE compliance.submission_tokens SET used_at = @used_at WHERE token = @token`)

    await pool.request()
      .input('issue_id', sql.Int, tokenRecord.issue_id)
      .input('document_url', sql.NVarChar, documentUrl)
      .query(`
        UPDATE compliance.compliance_issues
        SET document_url = @document_url, status = 'resolved', updated_at = GETDATE()
        WHERE id = @issue_id
      `)

    res.json({ success: true, document_url: documentUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(3000, () => {
  console.log('Server running on port 3000')
})
