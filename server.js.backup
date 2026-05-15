const { webcrypto } = require('crypto')
globalThis.crypto = webcrypto

require('dotenv').config()
const cors = require('cors')
const sql = require('mssql')
const express = require('express')
const { BlobServiceClient } = require('@azure/storage-blob')
const { randomUUID } = require('crypto')
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage() })
const app = express()
app.use(express.json())

const { EmailClient } = require('@azure/communication-email')
const { SmsClient } = require('@azure/communication-sms')

const emailClient = new EmailClient(process.env.ACS_CONNECTION_STRING)
const smsClient = new SmsClient(process.env.ACS_CONNECTION_STRING)

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
  options: { encrypt: true, trustServerCertificate: false }
}

setInterval(async () => {
  try {
    const pool = await sql.connect(dbConfig)
    await pool.request().query('SELECT 1')
  } catch (err) {
    console.error('Keep-alive ping failed:', err.message)
  }
}, 4 * 60 * 1000)

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
    const result = await pool.request().query('SELECT * FROM compliance.staff ORDER BY full_name')
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
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Staff member not found' })
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
      .query(`INSERT INTO compliance.staff (full_name, employee_id, office, job_title, email, phone, employment_status)
        OUTPUT INSERTED.* VALUES (@full_name, @employee_id, @office, @job_title, @email, @phone, @employment_status)`)
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
        full_name=@full_name, office=@office, job_title=@job_title, email=@email,
        phone=@phone, employment_status=@employment_status, preferred_contact=@preferred_contact,
        notes=@notes, updated_at=GETDATE() OUTPUT INSERTED.* WHERE id=@id`)
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Staff member not found' })
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
      SELECT ci.id, ci.staff_name_raw, ci.category, ci.issue_description, ci.non_compliant_date,
        ci.supervisor_name_raw, ci.status, ci.first_scraped_at, ci.last_seen_at, ci.staff_id,
        s.office, s.email
      FROM compliance.compliance_issues ci
      LEFT JOIN compliance.staff s ON ci.staff_id = s.id
      ORDER BY ci.first_scraped_at DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET STAFF COMPLIANCE PROFILE ──────────────────────────
app.get('/api/staff/:id/compliance-issues', async (req, res) => {
  const staffId = parseInt(req.params.id)
  if (isNaN(staffId)) return res.status(400).json({ error: 'Invalid staff ID' })
  try {
    const pool = await sql.connect(dbConfig)
    const staffResult = await pool.request()
      .input('id', sql.Int, staffId)
      .query('SELECT id, full_name, office, job_title, email, phone, employment_status FROM compliance.staff WHERE id = @id')
    if (staffResult.recordset.length === 0) return res.status(404).json({ error: 'Staff member not found' })
    const issuesResult = await pool.request()
      .input('staff_id', sql.Int, staffId)
      .query('SELECT id, category, issue_description, non_compliant_date, status FROM compliance.compliance_issues WHERE staff_id = @staff_id ORDER BY non_compliant_date DESC')
    res.json({ staff: staffResult.recordset[0], issues: issuesResult.recordset })
  } catch (err) {
    res.status(500).json({ error: 'Database error' })
  }
})

// ── RESOLVE COMPLIANCE ISSUE ──────────────────────────────
app.patch('/api/compliance-issues/:id/resolve', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('resolved_by', sql.NVarChar, 'Coordinator')
      .query(`UPDATE compliance.compliance_issues
        SET status='resolved', resolved_at=GETDATE(), resolved_by=@resolved_by
        OUTPUT INSERTED.* WHERE id=@id`)
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Issue not found' })
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
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const pool = await sql.connect(dbConfig)
    await pool.request()
      .input('token', sql.NVarChar, token)
      .input('staff_id', sql.Int, staff_id)
      .input('issue_id', sql.Int, issue_id)
      .input('expires_at', sql.DateTime2, expires_at)
      .query('INSERT INTO compliance.submission_tokens (token, staff_id, issue_id, expires_at) VALUES (@token, @staff_id, @issue_id, @expires_at)')
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
      .query(`SELECT st.token, st.expires_at, st.used_at,
        s.id as staff_id, s.full_name, s.email,
        ci.id as issue_id, ci.category, ci.issue_description, ci.non_compliant_date
        FROM compliance.submission_tokens st
        JOIN compliance.staff s ON st.staff_id = s.id
        JOIN compliance.compliance_issues ci ON st.issue_id = ci.id
        WHERE st.token = @token`)
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Invalid or expired link' })
    const record = result.recordset[0]
    if (record.used_at) return res.status(410).json({ error: 'This link has already been used' })
    if (new Date(record.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired' })
    res.json(record)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── SUBMIT DOCUMENT ───────────────────────────────────────
app.post('/api/submit/:token', upload.single('document'), async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const tokenResult = await pool.request()
      .input('token', sql.NVarChar, req.params.token)
      .query('SELECT * FROM compliance.submission_tokens WHERE token = @token')
    if (tokenResult.recordset.length === 0) return res.status(404).json({ error: 'Invalid link' })
    const tokenRecord = tokenResult.recordset[0]
    if (tokenRecord.used_at) return res.status(410).json({ error: 'This link has already been used' })
    if (new Date(tokenRecord.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired' })
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING)
    const containerClient = blobServiceClient.getContainerClient('compliance-documents')
    const blobName = `${tokenRecord.staff_id}/${tokenRecord.issue_id}/${Date.now()}-${req.file.originalname}`
    const blockBlobClient = containerClient.getBlockBlobClient(blobName)
    await blockBlobClient.uploadData(req.file.buffer, { blobHTTPHeaders: { blobContentType: req.file.mimetype } })
    const documentUrl = blockBlobClient.url
    await pool.request()
      .input('token', sql.NVarChar, req.params.token)
      .input('used_at', sql.DateTime2, new Date())
      .query('UPDATE compliance.submission_tokens SET used_at = @used_at WHERE token = @token')
    await pool.request()
      .input('issue_id', sql.Int, tokenRecord.issue_id)
      .input('document_url', sql.NVarChar, documentUrl)
      .query(`UPDATE compliance.compliance_issues SET document_url=@document_url, status='open', updated_at=GETDATE() WHERE id=@issue_id`)
    res.json({ success: true, document_url: documentUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET COMMUNICATION PREFERENCES ────────────────────────
app.get('/api/preferences/:staffId', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('id', sql.Int, req.params.staffId)
      .query('SELECT id, full_name, email, phone, preferred_contact FROM compliance.staff WHERE id = @id')
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Staff member not found' })
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── UPDATE COMMUNICATION PREFERENCES ─────────────────────
app.post('/api/preferences/:staffId', async (req, res) => {
  try {
    const { preferred_contact } = req.body
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('id', sql.Int, req.params.staffId)
      .input('preferred_contact', sql.VarChar, preferred_contact)
      .query(`UPDATE compliance.staff SET preferred_contact=@preferred_contact, updated_at=GETDATE() OUTPUT INSERTED.id, INSERTED.full_name, INSERTED.email, INSERTED.phone, INSERTED.preferred_contact WHERE id=@id`)
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Staff member not found' })
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GENERATE AI DRAFT ─────────────────────────────────────
app.post('/api/communications/draft', async (req, res) => {
  try {
    const { issue_id, channel } = req.body
    const pool = await sql.connect(dbConfig)
    const issueResult = await pool.request()
      .input('issue_id', sql.Int, issue_id)
      .query(`SELECT ci.id as issue_id, ci.category, ci.issue_description, ci.non_compliant_date,
        s.id as staff_id, s.full_name, s.email, s.phone, s.office, s.job_title, s.preferred_contact
        FROM compliance.compliance_issues ci
        JOIN compliance.staff s ON ci.staff_id = s.id
        WHERE ci.id = @issue_id`)
    if (issueResult.recordset.length === 0) return res.status(404).json({ error: 'Issue not found or staff not matched' })
    const issue = issueResult.recordset[0]

    const openaiRes = await fetch(
      `${process.env.AZURE_OPENAI_ENDPOINT}chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.AZURE_OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.AZURE_OPENAI_DEPLOYMENT,
          messages: [
            {
              role: 'system',
              content: `You are a compliance coordinator assistant for Pathways for Life, a DDD provider in Arizona.
Your job is to draft professional, clear, and empathetic compliance alert messages to staff members.
Always respond with valid JSON only — no markdown, no code blocks, no extra text.
The JSON must have exactly these three keys: email_subject, email_body, sms_body.
email_subject must be under 100 characters.
email_body must be professional, warm, and under 400 characters.
sms_body must be under 160 characters and be a shorter version of the email.
Never use placeholders like [name] — use the actual data provided.`
            },
            {
              role: 'user',
              content: `Draft a compliance alert for the following:
Staff Name: ${issue.full_name}
Office: ${issue.office}
Job Title: ${issue.job_title}
Issue Category: ${issue.category}
Required Document: ${issue.issue_description}
Non-Compliant Since: ${issue.non_compliant_date ? new Date(issue.non_compliant_date).toLocaleDateString('en-US') : 'Unknown'}

Generate a professional email and SMS asking them to submit the required document through our compliance portal.`
            }
          ],
          temperature: 0.7,
          max_tokens: 800,
        })
      }
    )

    const openaiData = await openaiRes.json()
    if (!openaiRes.ok) return res.status(500).json({ error: 'Azure OpenAI error', details: openaiData })

    const rawContent = openaiData.choices[0].message.content
    let draft
    try { draft = JSON.parse(rawContent) }
    catch { return res.status(500).json({ error: 'AI response was not valid JSON', raw: rawContent }) }

    const queueResult = await pool.request()
      .input('issue_id', sql.Int, issue.issue_id)
      .input('staff_id', sql.Int, issue.staff_id)
      .input('email_subject', sql.NVarChar, draft.email_subject || null)
      .input('email_body', sql.NVarChar, draft.email_body || null)
      .input('sms_body', sql.NVarChar, draft.sms_body || null)
      .input('channel', sql.VarChar, channel || issue.preferred_contact || 'email')
      .query(`INSERT INTO compliance.communication_queue (issue_id, staff_id, email_subject, email_body, sms_body, channel)
        OUTPUT INSERTED.* VALUES (@issue_id, @staff_id, @email_subject, @email_body, @sms_body, @channel)`)

    res.json(queueResult.recordset[0])
  } catch (err) {
    console.error('Draft generation error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET COMMUNICATION QUEUE ───────────────────────────────
app.get('/api/communications/queue', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query(`
      SELECT cq.id, cq.issue_id, cq.staff_id, cq.email_subject, cq.email_body,
        cq.sms_body, cq.channel, cq.status, cq.generated_at, cq.approved_at, cq.sent_at,
        s.full_name, s.email, s.phone, s.office, ci.category, ci.issue_description
      FROM compliance.communication_queue cq
      JOIN compliance.staff s ON cq.staff_id = s.id
      JOIN compliance.compliance_issues ci ON cq.issue_id = ci.id
      ORDER BY cq.generated_at DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── UPDATE QUEUE ITEM ─────────────────────────────────────
app.put('/api/communications/queue/:id', async (req, res) => {
  try {
    const { email_subject, email_body, sms_body, status, channel } = req.body
    const pool = await sql.connect(dbConfig)
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('email_subject', sql.NVarChar, email_subject)
      .input('email_body', sql.NVarChar, email_body)
      .input('sms_body', sql.NVarChar, sms_body)
      .input('status', sql.VarChar, status)
      .input('channel', sql.VarChar, channel || 'email')
      .query(`UPDATE compliance.communication_queue
        SET email_subject=@email_subject, email_body=@email_body, sms_body=@sms_body,
        status=@status, channel=@channel,
        approved_at=CASE WHEN @status='approved' THEN GETDATE() ELSE approved_at END
        OUTPUT INSERTED.* WHERE id=@id`)
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE QUEUE ITEM ─────────────────────────────────────
app.delete('/api/communications/queue/:id', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('DELETE FROM compliance.communication_queue WHERE id = @id')
    res.json({ message: 'Queue item deleted' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── SEND COMMUNICATION ────────────────────────────────────
app.patch('/api/communications/queue/:id/send', async (req, res) => {
  try {
    const { id } = req.params
    const pool = await sql.connect(dbConfig)

    const fetchResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT cq.id, cq.issue_id, cq.staff_id, cq.email_subject, cq.email_body,
               cq.sms_body, cq.channel, cq.status,
               s.id as staff_id_val, s.email AS staff_email, s.phone AS staff_phone, s.full_name,
               ci.issue_description, ci.category
        FROM compliance.communication_queue cq
        JOIN compliance.staff s ON cq.staff_id = s.id
        JOIN compliance.compliance_issues ci ON cq.issue_id = ci.id
        WHERE cq.id = @id
      `)

    const item = fetchResult.recordset[0]
    if (!item) return res.status(404).json({ error: 'Queue item not found' })
    if (item.status !== 'approved') return res.status(400).json({ error: 'Item must be approved before sending' })

    const token = randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await pool.request()
      .input('token', sql.NVarChar, token)
      .input('staff_id', sql.Int, item.staff_id)
      .input('issue_id', sql.Int, item.issue_id)
      .input('expires_at', sql.DateTime2, expiresAt)
      .query('INSERT INTO compliance.submission_tokens (token, staff_id, issue_id, expires_at) VALUES (@token, @staff_id, @issue_id, @expires_at)')

    const SWA_URL = 'https://orange-desert-0cac6391e.7.azurestaticapps.net'
    const submissionLink = `${SWA_URL}/submit/${token}`
    const preferencesLink = `${SWA_URL}/preferences/${item.staff_id}`

    const emailBodyWithLink = `${item.email_body}\n\nSubmit your compliance document here:\n${submissionLink}\n\nManage your communication preferences:\n${preferencesLink}`
    const smsBodyWithLink = `${item.sms_body}\nSubmit: ${submissionLink}\nPrefs: ${preferencesLink}`

    const normalizePhone = (phone) => {
      const digits = phone.replace(/\D/g, '')
      return digits.length === 10 ? `+1${digits}` : `+${digits}`
    }

    if (item.channel === 'email' || item.channel === 'both') {
      const emailMessage = {
        senderAddress: process.env.ACS_SENDER_ADDRESS,
        recipients: { to: [{ address: item.staff_email }] },
        content: { subject: item.email_subject, plainText: emailBodyWithLink }
      }
      const poller = await emailClient.beginSend(emailMessage)
      await poller.pollUntilDone()
    }

    if (item.channel === 'sms' || item.channel === 'both') {
      await smsClient.send({
        from: process.env.ACS_PHONE_NUMBER,
        to: [normalizePhone(item.staff_phone)],
        message: smsBodyWithLink
      })
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query(`UPDATE compliance.communication_queue SET status='sent', sent_at=GETDATE() WHERE id=@id`)

    const channels = item.channel === 'both' ? ['email', 'sms'] : [item.channel]
    for (const ch of channels) {
      await pool.request()
        .input('staff_id', sql.Int, item.staff_id)
        .input('issue_id', sql.Int, item.issue_id)
        .input('channel', sql.NVarChar, ch)
        .input('recipient', sql.NVarChar, ch === 'email' ? item.staff_email : normalizePhone(item.staff_phone))
        .input('message_body', sql.NVarChar, ch === 'email' ? emailBodyWithLink : smsBodyWithLink)
        .input('sent_at', sql.DateTime2, new Date())
        .query(`INSERT INTO compliance.alert_log (staff_id, compliance_issue_id, alert_type, channel, recipient, message_body, send_status, sent_at)
          VALUES (@staff_id, @issue_id, 'compliance_notice', @channel, @recipient, @message_body, 'sent', @sent_at)`)
    }

    const updated = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT cq.*, s.full_name, s.email AS staff_email, s.phone AS staff_phone,
               ci.issue_description, ci.category
        FROM compliance.communication_queue cq
        JOIN compliance.staff s ON cq.staff_id = s.id
        JOIN compliance.compliance_issues ci ON cq.issue_id = ci.id
        WHERE cq.id = @id
      `)

    res.json(updated.recordset[0])
  } catch (err) {
    console.error('Send error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── DASHBOARD HOME STATS ──────────────────────────────────
app.get('/api/dashboard/home-stats', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM compliance.compliance_issues WHERE status = 'open') as open_issues,
        (SELECT COUNT(*) FROM compliance.alert_log al
          JOIN compliance.compliance_issues ci ON al.compliance_issue_id = ci.id
          WHERE al.send_status = 'sent' AND ci.status = 'open' AND al.alert_type = 'compliance_notice') as pending_communications,
        (SELECT COUNT(*) FROM compliance.compliance_issues ci
          WHERE ci.status = 'open' AND ci.staff_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM compliance.alert_log al WHERE al.compliance_issue_id = ci.id)) as needs_communication,
        (SELECT COUNT(*) FROM compliance.compliance_issues
          WHERE status = 'resolved' AND resolved_at >= DATEADD(hour, -24, GETDATE())) as resolved_today
    `)
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DASHBOARD SUMMARY ─────────────────────────────────────
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM compliance.compliance_issues WHERE status = 'open') as open_issues,
        (SELECT COUNT(*) FROM compliance.staff WHERE employment_status = 'active') as total_staff,
        (SELECT COUNT(*) FROM compliance.compliance_issues WHERE status = 'resolved') as resolved_issues,
        (SELECT COUNT(*) FROM compliance.compliance_issues) as total_issues,
        (SELECT COUNT(*) FROM compliance.alert_log WHERE send_status = 'sent') as total_alerts_sent
    `)
    const row = result.recordset[0]
    const compliance_rate = row.total_issues > 0 ? Math.round((row.resolved_issues / row.total_issues) * 100) : 0
    res.json({ ...row, compliance_rate })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DASHBOARD BY OFFICE ───────────────────────────────────
app.get('/api/dashboard/by-office', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query(`
      SELECT
        s.office,
        COUNT(ci.id) as total_issues,
        SUM(CASE WHEN ci.status = 'open' THEN 1 ELSE 0 END) as open_issues,
        SUM(CASE WHEN ci.status = 'resolved' THEN 1 ELSE 0 END) as resolved_issues,
        CASE WHEN COUNT(ci.id) > 0
          THEN ROUND(CAST(SUM(CASE WHEN ci.status = 'resolved' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(ci.id) * 100, 1)
          ELSE 100
        END as compliance_rate
      FROM compliance.compliance_issues ci
      JOIN compliance.staff s ON ci.staff_id = s.id
      WHERE s.office IS NOT NULL
      GROUP BY s.office
      ORDER BY open_issues DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DASHBOARD BY CATEGORY ─────────────────────────────────
app.get('/api/dashboard/by-category', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query(`
      SELECT
        category,
        COUNT(*) as total_issues,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_issues,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_issues
      FROM compliance.compliance_issues
      GROUP BY category
      ORDER BY open_issues DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DASHBOARD ALERT ACTIVITY ──────────────────────────────
app.get('/api/dashboard/alert-activity', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query(`
      SELECT TOP 100
        al.id, al.alert_type, al.channel, al.recipient,
        al.send_status, al.sent_at, al.created_at,
        s.full_name, s.office,
        ci.issue_description, ci.category
      FROM compliance.alert_log al
      JOIN compliance.staff s ON al.staff_id = s.id
      JOIN compliance.compliance_issues ci ON al.compliance_issue_id = ci.id
      ORDER BY al.created_at DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DOCUMENTS PENDING ─────────────────────────────────────
app.get('/api/documents/pending', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query(`
      SELECT ci.id, ci.staff_id, s.full_name, s.office, ci.issue_description,
        ci.category, ci.document_url, ci.status, ci.updated_at
      FROM compliance.compliance_issues ci
      JOIN compliance.staff s ON ci.staff_id = s.id
      WHERE ci.document_url IS NOT NULL AND ci.status = 'open'
      ORDER BY ci.updated_at DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DOCUMENTS ARCHIVED ────────────────────────────────────
app.get('/api/documents/archived', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig)
    const result = await pool.request().query(`
      SELECT ci.id, ci.staff_id, s.full_name, s.office, ci.issue_description,
        ci.category, ci.document_url, ci.status, ci.updated_at
      FROM compliance.compliance_issues ci
      JOIN compliance.staff s ON ci.staff_id = s.id
      WHERE ci.document_url IS NOT NULL AND ci.status = 'resolved'
      ORDER BY ci.updated_at DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(3000, () => {
  console.log('Server running on port 3000')
})
