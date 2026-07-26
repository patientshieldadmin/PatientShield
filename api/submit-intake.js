import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { clientName, clientEmail, hospitalName, documentText } = req.body;

    if (!clientName || !clientEmail || !documentText) {
      return res.status(400).json({ error: 'Missing required fields or document text.' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured.' });
    }

    // --- STEP 1: AI FORENSIC AUDIT & VALIDATION ---
    const aiPrompt = `
      You are an expert medical billing forensic auditor for PatientShield. 
      Analyze the text extracted from the client's uploaded document below.
      
      Document Text:
      """
      ${documentText}
      """

      Evaluate the document against standard high-acuity medical audit requirements (Itemized Bill, Detailed MAR Records, Nursing Vital Sign Logs).
      
      Return a strict JSON object with these exact keys:
      1. "isLegit": boolean (true if it is a valid medical bill, statement, EOB, or medical record; false if it's an unrelated file like a receipt, resume, or gibberish).
      2. "missingItems": array of strings (list any critical missing documentation needed for a deep audit, e.g., ["Detailed MAR Records", "Nursing Vital Sign Logs"]. If everything required is present, return an empty array []).
      3. "summary": string (a brief professional summary of the document findings).
    `;

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: aiPrompt }],
        response_format: { type: 'json_object' }
      }),
    });

    const aiData = await aiResponse.json();
    const auditResult = JSON.parse(aiData.choices[0].message.content);

    // --- STEP 2: CONDITIONAL EMAIL ROUTING VIA RESEND ---
    let emailSubject = '';
    let emailHtml = '';

    if (!auditResult.isLegit) {
      // Case A: Invalid Document Uploaded
      emailSubject = 'Action Required: Document Verification Failed - PatientShield';
      emailHtml = `
        <p>Dear ${clientName},</p>
        <p>We received your recent document submission for ${hospitalName || 'your medical bill review'}, but our verification system could not validate it as a recognized medical bill or statement.</p>
        <p><strong>Please log back into your secure portal and re-upload a valid itemized medical bill or EOB.</strong></p>
        <p>Thank you,<br>The PatientShield Team</p>
      `;
    } else if (auditResult.missingItems && auditResult.missingItems.length > 0) {
      // Case B: Valid Document, But Missing Critical Items (e.g., MARs, Vitals)
      const missingList = auditResult.missingItems.map(item => `<li>${item}</li>`).join('');
      emailSubject = 'Action Required: Additional Records Needed for Audit - PatientShield';
      emailHtml = `
        <p>Dear ${clientName},</p>
        <p>We have successfully verified your initial document submission for ${hospitalName}. However, to perform a complete high-acuity audit, our AI system requires the following missing items:</p>
        <ul>${missingList}</ul>
        <p><strong>Please use your secure portal link to upload these remaining documents so our forensic team can proceed.</strong></p>
        <p>Thank you,<br>The PatientShield Team</p>
      `;
    } else {
      // Case C: Fully Complete Intake
      emailSubject = 'Intake Received & Verified - PatientShield';
      emailHtml = `
        <p>Dear ${clientName},</p>
        <p>Your documents for ${hospitalName} have been successfully verified and accepted into the audit pipeline.</p>
        <p>Our forensic team is now processing your high-acuity audit.</p>
        <p>Thank you,<br>The PatientShield Team</p>
      `;
    }

    // Send client email via Resend
    await resend.emails.send({
      from: 'PatientShield <audit@thepatientshield.com>',
      to: [clientEmail],
      subject: emailSubject,
      html: emailHtml,
    });

    // Send safe non-PHI notification to admin
    await resend.emails.send({
      from: 'PatientShield System <system@thepatientshield.com>',
      to: ['Admin@thepatientshield.com'],
      subject: `New Intake Processed: ${clientName} (${hospitalName || 'General'})`,
      html: `<p>New intake processed for <strong>${clientName}</strong>. Legit: ${auditResult.isLegit}, Missing items count: ${auditResult.missingItems ? auditResult.missingItems.length : 0}.</p>`,
    });

    return res.status(200).json({
      success: true,
      audit: auditResult,
    });

  } catch (error) {
    console.error('Intake Processing Error:', error);
    return res.status(500).json({ error: 'Internal server error during intake processing.' });
  }
}
