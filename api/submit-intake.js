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
    const fileText = body.fileText || '';
    const eobName = body.eobName || 'Not Provided';
    const recordsName = body.recordsName || 'Not Provided';

    let extractedBillAmount = '$0.00';
    let estimatedSavingsValue = '$0.00';
    let analysisFindings = [
      { category: 'Document Scan Initialized', description: `Processing text extraction for statement from ${hospitalName}.` }
    ];
    let disputeLetterDraft = `[HOSPITAL BILLING DISPUTE & ITEMIZED AUDIT REQUEST]\n\nDear Billing Compliance Department,\n\nPatient Name: ${fullName}\nFacility: ${hospitalName}\nReference Document: ${fileName}\n\nWe formally request itemized source verification and audit adjustments.`;

    // Attempt OpenAI deep forensic review using extracted PDF text
    if (!isPortalUpload && process.env.OPENAI_API_KEY && fileText.trim().length > 0) {
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
                content: 'You are an elite forensic medical bill auditor. Analyze the exact text extracted from the user-uploaded hospital bill. Perform a meticulous line-item audit. Output valid JSON only with keys: "extractedTotal" (string with exact dollar sum found in the bill text, e.g. "$612,180.10"), "findings" (array of objects with "category" and "description" detailing specific markup errors, unbundled CPT codes, or excessive charges found in the text), "estimatedSavings" (string with the precise dollar amount of savings calculated from the specific errors and markups found), and "disputeLetter" (string containing a thorough, multi-paragraph formal dispute letter referencing the exact patient name, hospital name, specific line-item discrepancies, and compliance guidelines).'
              },
              {
                role: 'user',
                content: `Patient Name: ${fullName}\nHospital Facility: ${hospitalName}\n\n--- UPLOADED BILL TEXT ---\n${fileText.substring(0, 12000)}\n--- END BILL TEXT ---`
              }
            ],
            response_format: { type: 'json_object' },
            max_tokens: 2500
          })
        });

        if (openaiResponse.ok) {
          const openaiData = await openaiResponse.json();
          if (openaiData.choices?.[0]?.message?.content) {
            const parsed = JSON.parse(openaiData.choices[0].message.content);
            if (parsed.extractedTotal) extractedBillAmount = parsed.extractedTotal;
            if (parsed.findings && parsed.findings.length > 0) analysisFindings = parsed.findings;
            if (parsed.estimatedSavings) estimatedSavingsValue = parsed.estimatedSavings;
            if (parsed.disputeLetter && parsed.disputeLetter.length > 50) disputeLetterDraft = parsed.disputeLetter;
          }
        } else {
          console.error('OpenAI API Error:', await openaiResponse.text());
        }
      } catch (aiErr) {
        console.error('AI Processing Exception:', aiErr);
      }
    } else {
      // Dynamic fallback regex parser if OpenAI is unconfigured
      const totalMatch = fileText.match(/(?:Total Balance|Total Amount|Total Due|Total)\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})/i) || fileText.match(/\$([\d,]+\.\d{2})/);
      if (totalMatch && totalMatch[1]) {
        extractedBillAmount = `$${totalMatch[1]}`;
        const num = parseFloat(totalMatch[1].replace(/,/g, ''));
        estimatedSavingsValue = `$${(num * 0.30).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    }

    // Save Lead to Upstash Redis Database
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
        fileData,
        eobName,
        recordsName,
        analysisFindings,
        estimatedSavings: estimatedSavingsValue,
        disputeLetterDraft,
        submittedAt: new Date().toISOString()
      };

      const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
      const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

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

    return res.status(200).json({ status: 'success', message: 'Documents processed successfully.' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during processing.' });
  }
}
