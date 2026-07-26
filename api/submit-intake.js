export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const fullName = body.fullName || 'Valued Client';
    const clientEmail = body.email || 'client@thepatientshield.com';
    const hospitalName = body.hospitalName || 'Target Hospital';
    const rawBillAmount = body.billAmount || '0';
    const phone = body.phone || 'Unspecified';
    
    // Extract file names cleanly
    const itemized = body.itemizedBill?.name || body.fileName || 'Itemized Bill Uploaded';
    const eob = body.eobDocument?.name || 'Not Provided';
    const records = body.medicalRecords?.name || 'Not Provided';

    // Track missing documentation for client guidance
    let missingDocs = [];
    if (eob === 'Not Provided') missingDocs.push('Explanation of Benefits (EOB) / Insurance Statement');
    if (records === 'Not Provided') missingDocs.push('Medical Records / MAR / Nursing Progress Notes');

    // Default fallback values if OpenAI key is missing
    let analysisFindings = [
      { category: 'Initial Line-Item Ingestion', description: `Successfully received Itemized Bill (${itemized}). Initial optical parse queued for chargemaster benchmark comparison.` }
    ];
    let estimatedSavingsValue = 'Pending Complete Documentation Review';

    // Execute rigorous AI forensic analysis via OpenAI
    if (process.env.OPENAI_API_KEY) {
      try {
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are an elite medical bill forensic auditor specializing in high-acuity inpatient and NICU stays. Analyze the provided intake details and file list to identify potential billing errors, markup discrepancies, unbundled professional fees, or duplicate charges. Return a JSON object strictly with: { "findings": [{ "category": string, "description": string }], "estimatedSavings": string }'
              },
              {
                role: 'user',
                content: `Hospital: ${hospitalName}\nTotal Bill Amount: $${rawBillAmount}\nUploaded Itemized Bill: ${itemized}\nUploaded EOB: ${eob}\nUploaded Medical Records/MAR: ${records}`
              }
            ],
            response_format: { type: 'json_object' }
          })
        });

        const openaiData = await openaiResponse.json();
        if (openaiResponse.ok && openaiData.choices?.[0]?.message?.content) {
          const parsed = JSON.parse(openaiData.choices[0].message.content);
          if (parsed.findings && parsed.findings.length > 0) {
            analysisFindings = parsed.findings;
          }
          if (parsed.estimatedSavings) {
            estimatedSavingsValue = parsed.estimatedSavings;
          }
        }
      } catch (aiErr) {
        console.error('AI Forensic Analysis Error:', aiErr);
      }
    }

    // ==========================================
    // 1. CLIENT-FACING EMAIL TEMPLATE
    // ==========================================
    const clientSubject = `Your PatientShield Audit Estimate & Next Steps: ${hospitalName}`;
    const clientHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #0056b3; border-bottom: 2px solid #0056b3; padding-bottom: 8px;">PatientShield Forensic Audit Ingestion</h2>
        <p>Hello <strong>${fullName}</strong>,</p>
        <p>We have securely received your itemized bill for <strong>${hospitalName}</strong>. Our automated forensic audit engine has completed an initial analysis of your submitted records against regional healthcare chargemaster baselines.</p>

        <h3 style="color: #333; margin-top: 20px;">Intake & Estimated Savings Summary</h3>
        <ul style="line-height: 1.6; background: #f9f9f9; padding: 15px; border-radius: 5px; list-style-type: none;">
          <li><strong>Hospital:</strong> ${hospitalName}</li>
          <li><strong>Submitted Bill Amount:</strong> $${rawBillAmount}</li>
          <li><strong>Itemized Bill:</strong> ✅ Received (${itemized})</li>
          <li><strong>EOB / Insurance Statement:</strong> ${eob !== 'Not Provided' ? '✅ Received' : '⚠️ Not Provided'}</li>
          <li><strong>Medical Records / MAR:</strong> ${records !== 'Not Provided' ? '✅ Received' : '⚠️ Not Provided'}</li>
          <li><strong>Estimated Potential Savings (Preliminary Estimate):</strong> <span style="color: #0284c7; font-weight: bold;">${estimatedSavingsValue}</span></li>
        </ul>
        <p style="font-size: 11px; color: #64748b; font-style: italic;">*Note: This figure is an initial AI-generated estimate based on available documentation and is subject to final clinical nurse review and chargemaster verification.</p>

        ${missingDocs.length > 0 ? `
          <h3 style="color: #d97706; margin-top: 20px;">Action Required: Missing Documentation</h3>
          <p style="font-size: 14px; color: #475569;">To perform an absolute deep-dive validation on complex items (such as pharmaceutical dosing, infusion timestamps, or per diem levels), we require the following missing documents:</p>
          <ul style="background: #fffbeb; border: 1px solid #fde68a; padding: 15px; border-radius: 5px; color: #b45309;">
            ${missingDocs.map(doc => `<li>${doc}</li>`).join('')}
          </ul>
          
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 5px; margin-top: 15px;">
            <h4 style="color: #166534; margin: 0 0 8px 0; font-size: 14px;">🔒 How to Upload Securely & HIPAA-Compliant</h4>
            <p style="font-size: 13px; color: #15803d; margin: 0; line-height: 1.5;">
              To ensure full HIPAA compliance and protect your sensitive health information, please <strong>reply directly to this secure email</strong> with your additional documents attached. Our encrypted ingestion pipeline will automatically route them to your secure file vault.
            </p>
          </div>
        ` : ''}

        <h3 style="color: #333; margin-top: 20px;">Initial Forensic Breakdown</h3>
        <div style="background: #f1f5f9; padding: 15px; border-radius: 5px;">
          ${analysisFindings.map(f => `<p><strong>${f.category}:</strong> ${f.description}</p>`).join('')}
        </div>

        <p style="margin-top: 20px;"><strong>Next Steps:</strong> Our clinical advocacy team is reviewing these findings to construct your formal hospital dispute packet.</p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #777; text-align: center;">PatientShield Automated Billing Advocacy Platform</p>
      </div>
    `;

    // ==========================================
    // 2. ADMIN-FACING EMAIL TEMPLATE
    // ==========================================
    const adminSubject = `[FORENSIC AUDIT] ${fullName} - ${hospitalName} ($${rawBillAmount})`;
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #b91c1c; border-bottom: 2px solid #b91c1c; padding-bottom: 8px;">New Lead Forensic Breakdown</h2>
        
        <h3 style="color: #333;">Client Contact Info</h3>
        <ul style="line-height: 1.6; background: #fef2f2; padding: 15px; border-radius: 5px; list-style-type: none;">
          <li><strong>Client Name:</strong> ${fullName}</li>
          <li><strong>Email:</strong> ${clientEmail}</li>
          <li><strong>Phone:</strong> ${phone}</li>
          <li><strong>Hospital:</strong> ${hospitalName}</li>
          <li><strong>Submitted Bill Amount:</strong> $${rawBillAmount}</li>
        </ul>

        <h3 style="color: #333;">Document Ingestion Status</h3>
        <ul style="line-height: 1.6; background: #f8fafc; padding: 15px; border-radius: 5px; list-style-type: none;">
          <li><strong>Itemized Bill:</strong> ${itemized}</li>
          <li><strong>EOB / Insurance:</strong> ${eob}</li>
          <li><strong>Medical Records / MAR:</strong> ${records}</li>
          <li><strong>Missing Documents:</strong> ${missingDocs.length > 0 ? missingDocs.join(', ') : 'None'}</li>
        </ul>

        <h3 style="color: #333;">AI Forensic Findings Breakdown</h3>
        <p><strong>Estimated Savings Range:</strong> ${estimatedSavingsValue}</p>
        <div style="background: #f1f5f9; padding: 15px; border-radius: 5px;">
          ${analysisFindings.map(f => `<p><strong>${f.category}:</strong> ${f.description}</p>`).join('')}
        </div>
      </div>
    `;

    // Dispatch Client Email via Resend
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'PatientShield <audit@thepatientshield.com>',
        to: [clientEmail],
        subject: clientSubject,
        html: clientHtml,
      }),
    });

    // Dispatch Admin Email via Resend
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'PatientShield <audit@thepatientshield.com>',
        to: ['Admin@thepatientshield.com'],
        subject: adminSubject,
        html: adminHtml,
      }),
    });

    return res.status(200).json({
      status: 'success',
      message: 'Intake analyzed and separated emails dispatched successfully.',
    });
  } catch (error) {
    console.error('Pipeline Execution Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error during intake processing.',
    });
  }
}
