const { webcrypto } = require('crypto')
globalThis.crypto = webcrypto

require('dotenv').config()
const sql = require('mssql')
const fs = require('fs')
const path = require('path')

const LOG_PATH = '/home/azureuser/sysadmin/logs/cadence.log'

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
  fs.appendFileSync(LOG_PATH, line)
}

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: true, trustServerCertificate: false }
}

const INTERVALS = [
  { days: 3, alert_type: 'day_3' },
  { days: 7, alert_type: 'day_7' },
  { days: 14, alert_type: 'day_14' },
]

async function generateDraft(pool, issue) {
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
Your job is to draft professional, clear, and empathetic compliance follow-up messages to staff members.
This is a follow-up notice — the staff member was already contacted and has not yet submitted their document.
Always respond with valid JSON only — no markdown, no code blocks, no extra text.
The JSON must have exactly these three keys: email_subject, email_body, sms_body.
email_subject must be under 100 characters.
email_body must be professional, warm, and under 400 characters.
sms_body must be under 160 characters.
Never use placeholders like [name] — use the actual data provided.`
          },
          {
            role: 'user',
            content: `Draft a follow-up compliance alert for the following:
Staff Name: ${issue.full_name}
Office: ${issue.office}
Job Title: ${issue.job_title}
Issue Category: ${issue.category}
Required Document: ${issue.issue_description}
Non-Compliant Since: ${issue.non_compliant_date ? new Date(issue.non_compliant_date).toLocaleDateString('en-US') : 'Unknown'}
Days Since First Alert: ${issue.days_since_initial}

Generate a follow-up email and SMS reminding them to submit the required document.`
          }
        ],
        temperature: 0.7,
        max_tokens: 800,
      })
    }
  )

  const openaiData = await openaiRes.json()
  if (!openaiRes.ok) throw new Error('OpenAI error: ' + JSON.stringify(openaiData))

  const raw = openaiData.choices[0].message.content
  return JSON.parse(raw)
}

async function runCadence() {
  log('Running cadence check...')
  const pool = await sql.connect(dbConfig)

  const result = await pool.request().query(`
    SELECT 
      ci.id as issue_id, ci.staff_id, ci.category, ci.issue_description, 
      ci.non_compliant_date, ci.status,
      s.full_name, s.email, s.phone, s.office, s.job_title, s.preferred_contact,
      al.sent_at as initial_sent_at,
      DATEDIFF(day, al.sent_at, GETDATE()) as days_since_initial
    FROM compliance.compliance_issues ci
    JOIN compliance.staff s ON ci.staff_id = s.id
    JOIN compliance.alert_log al ON al.compliance_issue_id = ci.id AND al.alert_type = 'initial'
    WHERE ci.status = 'open'
    AND ci.staff_id IS NOT NULL
  `)

  const issues = result.recordset
  log(`Found ${issues.length} open issues with initial alerts`)

  let drafted = 0

  for (const issue of issues) {
    for (const interval of INTERVALS) {
      if (issue.days_since_initial < interval.days) continue

      const existing = await pool.request()
        .input('issue_id', sql.Int, issue.issue_id)
        .input('alert_type', sql.NVarChar, interval.alert_type)
        .query(`
          SELECT id FROM compliance.alert_log 
          WHERE compliance_issue_id = @issue_id AND alert_type = @alert_type
        `)

      if (existing.recordset.length > 0) continue

      log(`Generating ${interval.alert_type} draft for issue ${issue.issue_id} (${issue.full_name})`)

      try {
        const draft = await generateDraft(pool, issue)
        const channel = issue.preferred_contact || 'email'

        await pool.request()
          .input('issue_id', sql.Int, issue.issue_id)
          .input('staff_id', sql.Int, issue.staff_id)
          .input('email_subject', sql.NVarChar, draft.email_subject || null)
          .input('email_body', sql.NVarChar, draft.email_body || null)
          .input('sms_body', sql.NVarChar, draft.sms_body || null)
          .input('channel', sql.VarChar, channel)
          .query(`
            INSERT INTO compliance.communication_queue 
              (issue_id, staff_id, email_subject, email_body, sms_body, channel)
            VALUES 
              (@issue_id, @staff_id, @email_subject, @email_body, @sms_body, @channel)
          `)

        await pool.request()
          .input('staff_id', sql.Int, issue.staff_id)
          .input('issue_id', sql.Int, issue.issue_id)
          .input('alert_type', sql.NVarChar, interval.alert_type)
          .input('channel', sql.NVarChar, channel)
          .input('recipient', sql.NVarChar, channel === 'sms' ? issue.phone : issue.email)
          .input('message_body', sql.NVarChar, channel === 'sms' ? draft.sms_body : draft.email_body)
          .query(`
            INSERT INTO compliance.alert_log 
              (staff_id, compliance_issue_id, alert_type, channel, recipient, message_body, send_status)
            VALUES 
              (@staff_id, @issue_id, @alert_type, @channel, @recipient, @message_body, 'pending')
          `)

        drafted++
        log(`Successfully drafted ${interval.alert_type} for ${issue.full_name}`)
      } catch (err) {
        log(`ERROR: Failed to draft for issue ${issue.issue_id}: ${err.message}`)
      }
    }
  }

  log(`Cadence complete. ${drafted} drafts generated.`)
  await sql.close()
}

runCadence().catch(err => {
  log(`FATAL: Cadence run failed: ${err.message}`)
  process.exit(1)
})
