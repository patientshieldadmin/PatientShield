export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const isPortalUpload = body.isPortalUpload || false;
    const fullName = body.fullName || 'Valued Client';
    const clientEmail = body.email || 'client@thepatientshield.com';
    const hospitalName = body.hospitalName || 'Target Hospital';
    const phone = body.phone || 'Unspecified';
    const fileName = body.fileName || 'Itemized Bill Uploaded';
    const fileData = body.fileData || null;
    const eobName = body.eobName || 'Not Provided';
    const recordsName = body.recordsName || 'Not Provided';

    let extractedBillAmount = isPortalUpload ? 'Existing Case Total' : '$0';
    let analysisFindings = [];
    let estimatedSavingsValue = 'Pending Complete Review';
    let disputeLetterDraft = 'Draft pending complete document verification.';
    let isAValidMedicalBill = true;
    let validationErrorMessage = '';

    if (!isPortalUpload && process.env.OPENAI_API_KEY && fileData) {
      try {
        let userContent = [
          {
            type: 'text',
            text: `Hospital Name: ${hospitalName}\nAnalyze this uploaded document. First, check if this document is a valid hospital itemized bill, UB-04, or medical billing statement. If it is NOT a medical bill or billing document, set "isValidBill": false and provide an explanation. If it IS valid, extract the exact total bill amount, identify line-item markup errors, unbundled charges, or phantom items, and output a JSON object.`
          },
          {
            type: 'image_url',
            image_url: { url: fileData }
          }
        ];

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
                content: 'You are an elite medical bill forensic auditor. Validate whether the uploaded document is a legitimate hospital bill. Return a JSON object strictly with: { "isValidBill": boolean, "invalidReason": string, "extractedTotal": string, "findings": [{ "category": string, "description": string }], "estimatedSavings": string, "disputeLetter": string }'
              },
              {
                role: 'user',
                content: userContent
              }
            ],
            response_format: { type: 'json_object' },
            max_tokens: 1500
          })
        });

        if (openaiResponse.ok) {
          const openaiData = await openaiResponse.json();
          if (openaiData.choices?.[0]?.message?.content) {
            const parsed = JSON.parse(openaiData.choices[0].message.content);
            if (parsed.isValidBill === false) {
              isAValidMedicalBill = false;
              validationErrorMessage = parsed.invalidReason || 'The uploaded document does not appear to be a valid hospital itemized bill.';
            } else {
              if (parsed.extractedTotal) extractedBillAmount = parsed.extractedTotal;
              if (parsed.findings) analysisFindings = parsed.findings;
              if (parsed.estimatedSavings) estimatedSavingsValue = parsed.estimatedSavings;
              if (parsed.disputeLetter) disputeLetterDraft = parsed.disputeLetter;
            }
          }
        }
      } catch (aiErr) {
        console.error('AI Validation Error:', aiErr);
      }
    }

    if (!isPortalUpload && !isAValidMedicalBill) {
      return res.status(400).json({ 
        status: 'error', 
        message: `Document Validation Failed: ${validationErrorMessage} Please upload a valid itemized hospital bill.` 
      });
    }

    // Save Lead to Upstash Redis directly via REST
    try {
      const leadId = Date.now().toString();
      const leadData = {
        id: leadId,
        fullName,
        clientEmail,
        phone,
        hospitalName,
        extractedBillAmount,
        fileName,
        eobName,
        recordsName,
        analysisFindings,
        disputeLetterDraft,
        submittedAt: new Date().toISOString()
      };

      const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
      const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

      if (redisUrl && redisToken) {
        await fetch(redisUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(['SET', `lead:${leadId}`, JSON.stringify(leadData)])
        });
        await fetch(redisUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(['SADD', 'all_leads', leadId])
        });
      }
    } catch (dbErr) {
      console.error('Database Storage Error:', dbErr);
    }

    const missingEobOrRecords = (eobName === 'Not Provided' || recordsName === 'Not Provided');
    const securePortalUrl = `https://www.thepatientshield.com/?case=active&email=${encodeURIComponent(clientEmail)}`;

    if (process.env.RESEND_API_KEY) {
      const subjectPrefix = isPortalUpload ? '[SUPPLEMENTAL DOCUMENTS UPLOADED]' : '[VERIFIED AUDIT LEAD]';
      
      const clientHtml = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #0056b3; border-bottom: 2px solid #0056b3; padding-bottom: 8px;">${isPortalUpload ? 'Secure Portal Upload Confirmation' : 'PatientShield Secure Audit Ingestion'}</h2>
          <p>Hello <strong>${fullName}</strong>,</p>
          <p>${isPortalUpload ? 'We have successfully received your supplemental documents through our secure portal and added them to your active case file.' : `We have securely scanned and analyzed your itemized bill for <strong>${hospitalName}</strong> using our AI forensic audit engine.`}</p>

          <h3 style="color: #333; margin-top: 20px;">Case Summary</h3>
          <ul style="line-height: 1.6; background: #f9f9f9; padding: 15px; border-radius: 5px; list-style-type: none;">
            <li><strong>Hospital:</strong> ${hospitalName}</li>
            <li><strong>EOB / Insurance Statement:</strong> ${eobName !== 'Not Provided' ? '✅ Received (' + eobName + ')' : '⚠️ Missing'}</li>
            <li><strong>Medical Records / MAR:</strong> ${recordsName !== 'Not Provided' ? '✅ Received (' + recordsName + ')' : '⚠️ Missing'}</li>
          </ul>

          ${!isPortalUpload && missingEobOrRecords ? `
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 5px; margin-top: 15px;">
              <h4 style="color: #166534; margin: 0 0 8px 0; font-size: 14px;">🔒 Secure HIPAA Upload Required for Missing Documents</h4>
              <p style="font-size: 13px; color: #15803d; margin: 0 0 12px 0; line-height: 1.5;">
                To ensure absolute HIPAA compliance and protect your privacy, please use our encrypted secure portal link below to upload your missing EOB or Medical Records.
              </p>
              <a href="${securePortalUrl}" style="background: #16a34a; color: white; padding: 10px 16px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 13px; display: inline-block;">Access Secure Upload Portal</a>
            </div>
          ` : ''}

          <p style="margin-top: 20px;"><strong>Next Steps:</strong> Our clinical advocacy team is reviewing your complete case file to finalize your hospital dispute packet.</p>

          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #777; text-align: center;">PatientShield Automated Billing Advocacy Platform</p>
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'PatientShield <audit@thepatientshield.com>',
          to: [clientEmail],
          subject: isPortalUpload ? `Supplemental Documents Received: ${hospitalName}` : `Your PatientShield Secure Audit Estimate: ${hospitalName}`,
          html: clientHtml,
        }),
      });

      const adminHtml = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #b91c1c; border-bottom: 2px solid #b91c1c; padding-bottom: 8px;">${isPortalUpload ? 'Supplemental Documents Added to Case' : 'New Verified Lead & AI Dispute Draft'}</h2>
          
          <h3 style="color: #333;">Client Contact Info</h3>
          <ul style="line-height: 1.6; background: #fef2f2; padding: 15px; border-radius: 5px; list-style-type: none;">
            <li><strong>Client Name:</strong> ${fullName}</li>
            <li><strong>Email:</strong> ${clientEmail}</li>
            <li><strong>Phone:</strong> ${phone}</li>
            <li><strong>Hospital:</strong> ${hospitalName}</li>
            <li><strong>Extracted Bill Total:</strong> <span style="color: #b91c1c; font-weight: bold;">${extractedBillAmount}</span></li>
            <li><strong>EOB Uploaded:</strong> ${eobName}</li>
            <li><strong>Medical Records Uploaded:</strong> ${recordsName}</li>
          </ul>

          ${!isPortalUpload ? `
            <h3 style="color: #333;">AI Document Findings</h3>
            <p><strong>Estimated Savings Range:</strong> ${estimatedSavingsValue}</p>
            <div style="background: #f1f5f9; padding: 15px; border-radius: 5px;">
              ${analysisFindings.length > 0 ? analysisFindings.map(f => `<p><strong>${f.category}:</strong> ${f.description}</p>`).join('') : '<p>Pending further document review.</p>'}
            </div>

            <h3 style="color: #333; margin-top: 20px;">Generated Hospital Dispute Letter Draft</h3>
            <div style="background: #fff; border: 1px solid #cbd5e1; padding: 15px; border-radius: 5px; white-space: pre-wrap; font-size: 13px; color: #334155;">
              ${disputeLetterDraft}
            </div>
          ` : '<p style="color: #166534; font-weight: bold;">Client has uploaded missing documents via the secure portal. Review case file for complete packet assembly.</p>'}
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'PatientShield <audit@thepatientshield.com>',
          to: ['Admin@thepatientshield.com'],
          subject: `${subjectPrefix} ${fullName} - ${hospitalName}`,
          html: adminHtml,
        }),
      });
    }

    return res.status(200).json({ status: 'success', message: 'Documents processed securely.' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during document processing.' });
  }
}
