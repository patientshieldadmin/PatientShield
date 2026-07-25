export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const fullName = body.fullName || 'Valued Client';
    const clientEmail = body.email || 'client@thepatientshield.com';
    const hospitalName = body.hospitalName || 'Target Hospital';
    const billText = body.billText || body.extractedText || body.documentText || '';

    // Verify OpenAI API key exists for deep document analysis
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is missing in environment variables.');
      return res.status(500).json({ error: 'Server configuration error: Missing OpenAI key.' });
    }

    // --- STEP 1: AI FORENSIC DOCUMENT ANALYSIS & EXTRACTION ---
    const aiPrompt = `
      You are an expert medical billing forensic auditor for high-acuity claims (such as NICU and catastrophic inpatient stays). 
      Analyze the following document text uploaded by client "${fullName}" for facility "${hospitalName}".
      
      Document Text:
      """
      ${billText || 'No text provided'}
      """

      Perform a rigorous forensic check and return a strict JSON object with these exact keys:
      1. "isLegitMedicalBill": boolean (true if it's a valid hospital itemized bill/statement/EOB, false otherwise).
      2. "isRelevant": boolean (true if related to medical bills, false if random text/resume/unrelated).
      3. "extractedTotalAmount": number or null (the true total billed amount extracted directly from the document text).
      4. "missingItems": array of strings (list missing supporting clinical records required for deep forensic auditing, e.g. "Detailed MAR Records", "Nursing Vital Sign Logs", "Physician Progress Notes").
      5. "auditSummary": string (brief summary of line-item review findings based on the text).
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
    if (!aiResponse.ok) {
      console.error('OpenAI API Error:', aiData);
      throw new Error('AI document analysis failed.');
    }

    const analysis = JSON.parse(aiData.choices[0].message.content);
    const extractedAmount = analysis.extractedTotalAmount || body.billAmount || 0;

    let emailSubject, emailHtml;

    // --- STEP 2: DYNAMIC EMAIL GENERATION BASED ON AI ANALYSIS ---
    if (!analysis.isRelevant || !analysis.isLegitMedicalBill) {
      emailSubject = `Action Required: Invalid Document Uploaded for PatientShield Review`;
      emailHtml = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #d9534f; border-bottom: 2px solid #d9534f; padding-bottom: 8px;">Document Verification Failed</h2>
          <p>Hello <strong>${fullName}</strong>,</p>
          <p>Our AI document inspector reviewed your upload but could not verify it as a legitimate itemized hospital bill or statement.</p>
          <p><strong>For HIPAA compliance and security, please re-upload a valid itemized hospital billing PDF through our secure portal.</strong></p>
          <p><em>Thank you,</em><br/><strong>PatientShield Advocacy Team</strong></p>
        </div>
      `;
    } else if (analysis.missingItems && analysis.missingItems.length > 0) {
      emailSubject = `Action Required: Additional Records Needed for ${fullName}`;
      emailHtml = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #f0ad4e; border-bottom: 2px solid #f0ad4e; padding-bottom: 8px;">Additional Clinical Records Required</h2>
          <p>Hello <strong>${fullName}</strong>,</p>
          <p>We successfully verified your itemized bill totaling <strong>$${Number(extractedAmount).toLocaleString()}</strong>. However, our AI audit engine detected that additional medical records are needed to perform a complete forensic comparison:</p>
          <ul style="background: #fdf8e4; padding: 15px; border-radius: 5px; list-style-type: none;">
            ${analysis.missingItems.map(item => `<li style="padding: 5px 0;">⚠️ <strong>${item}</strong></li>`).join('')}
          </ul>
          <p>Please log back into our secure portal to upload the remaining requested files.</p>
        </div>
      `;
    } else {
      emailSubject = `Verified High-Acuity Bill Review Intake: ${fullName}`;
      emailHtml = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #0056b3; border-bottom: 2px solid #0056b3; padding-bottom: 8px;">Forensic Audit Pipeline Fully Initiated</h2>
          <p>Hello <strong>${fullName}</strong>,</p>
          <p>Your itemized bill for <strong>${hospitalName}</strong> has been successfully read, authenticated, and verified complete by our AI audit engine.</p>
          <ul style="line-height: 1.6; background: #f9f9f9; padding: 15px; border-radius: 5px; list-style-type: none;">
            <li><strong>Verified Total Billed:</strong> $${Number(extractedAmount).toLocaleString()}</li>
            <li><strong>Document Status:</strong> Legitimate & Relevant Itemized Bill Verified</li>
            <li><strong>Preliminary Audit Findings:</strong> ${analysis.auditSummary}</li>
          </ul>
          <p><strong>Next Steps:</strong> Queued for clinical nurse review and dispute letter generation.</p>
        </div>
      `;
    }

    // --- STEP 3: DISPATCH NOTIFICATION VIA RESEND ---
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'PatientShield <audit@thepatientshield.com>',
        to: ['Admin@thepatientshield.com', clientEmail],
        subject: emailSubject,
        html: emailHtml,
      }),
    });

    const resendResult = await resendResponse.json();
    if (!resendResponse.ok) {
      console.error('Resend API Error:', resendResult);
    }

    return res.status(200).json({
      status: 'success',
      analysis: analysis,
    });
  } catch (error) {
    console.error('Pipeline Execution Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error during AI document parsing.',
    });
  }
}
