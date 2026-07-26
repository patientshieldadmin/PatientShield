export const maxDuration = 60;

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

    // 1. Precise local baseline extraction
    let extractedBillAmount = '$15,450.00';
    if (fileText) {
      const totalMatch = fileText.match(/(?:Total Balance|Total Charges|Total Amount|Total Due|Total)\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})/i) || fileText.match(/\$([\d,]+\.\d{2})/);
      if (totalMatch && totalMatch[1]) {
        extractedBillAmount = `$${totalMatch[1]}`;
      } else {
        const amounts = fileText.match(/\b\d{1,3}(?:,\d{3})+\.\d{2}\b/g);
        if (amounts && amounts.length > 0) {
          extractedBillAmount = `$${amounts[amounts.length - 1]}`;
        }
      }
    }

    let numericTotal = parseFloat(extractedBillAmount.replace(/[^0-9.]/g, '')) || 15450;
    let estimatedSavingsValue = `$${(numericTotal * 0.30).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    let actualPatientName = fullName;
    let actualFacilityName = hospitalName;

    let analysisFindings = [
      { category: 'Chargemaster Markup & Room Rate Inflation', description: `Accommodation and ancillary service charges exceed regional Medicare fair-market reimbursement benchmarks.` },
      { category: 'Unbundled Ancillary CPT Codes', description: 'Diagnostic and therapeutic services billed separately instead of standard bundled package rates.' }
    ];

    let disputeLetterDraft = `[HOSPITAL BILLING DISPUTE & ITEMIZED AUDIT REQUEST]

Dear Billing Compliance Department,

Patient Name: ${actualPatientName}
Facility: ${actualFacilityName}
Reference Document: ${fileName}
Statement Total Referenced: ${extractedBillAmount}

We hereby formally dispute the excessive, inflated, and unbundled charges itemized on the recent billing statement. In accordance with federal transparency mandates, the No Surprises Act, and healthcare itemized audit guidelines, we require immediate itemized source verification, CPT/HCPCS code validation, and a complete chargemaster cost-to-charge crosswalk.

Please provide itemized source verification, cost-to-charge crosswalk documentation, and adjusted billing within 30 days.`;

    // 2. Fast, optimized OpenAI execution with strict token limits to prevent timeouts
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
                content: `You are an elite forensic medical bill auditor. Analyze the provided hospital bill text. 
                Extract:
                1. "extractedTotal": Exact gross total balance as a currency string.
                2. "extractedPatient": Actual patient/guarantor name from the bill text.
                3. "extractedFacility": Actual hospital facility name from the bill text.
                4. "findings": Array of objects with "category" and "description" detailing specific line-item markups or unbundled codes.
                5. "estimatedSavings": Precise dollar amount of potential savings based strictly on the bill text markup corrections.
                6. "disputeLetter": A formal dispute letter using the extracted patient name, facility, and total.

                Return ONLY raw JSON with keys: "extractedTotal", "extractedPatient", "extractedFacility", "findings", "estimatedSavings", "disputeLetter". Do not use markdown wrappers.`
              },
              {
                role: 'user',
                content: `Form Name: ${fullName}\nForm Hospital: ${hospitalName}\n\n--- BILL TEXT ---\n${fileText.substring(0, 8000)}`
              }
            ],
            response_format: { type: 'json_object' },
            max_tokens: 1500,
            temperature: 0.1
          })
        });

        if (openaiResponse.ok) {
          const openaiData = await openaiResponse.json();
          if (openaiData.choices?.[0]?.message?.content) {
            let rawContent = openaiData.choices[0].message.content.trim();
            rawContent = rawContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
            
            const parsed = JSON.parse(rawContent);
            if (parsed.extractedTotal) extractedBillAmount = parsed.extractedTotal;
            if (parsed.extractedPatient && parsed.extractedPatient.trim() !== '') actualPatientName = parsed.extractedPatient;
            if (parsed.extractedFacility && parsed.extractedFacility.trim() !== '') actualFacilityName = parsed.extractedFacility;
            if (parsed.findings && parsed.findings.length > 0) analysisFindings = parsed.findings;
            if (parsed.estimatedSavings) estimatedSavingsValue = parsed.estimatedSavings;
            if (parsed.disputeLetter && parsed.disputeLetter.length > 50) disputeLetterDraft = parsed.disputeLetter;
          }
        }
      } catch (aiErr) {
        console.error('AI Processing Error (using baseline):', aiErr);
      }
    }

    // 3. Save Lead to Upstash Redis Database
    try {
      const leadId = Date.now().toString();
      const leadData = {
        id: leadId,
        fullName: actualPatientName,
        clientEmail,
        phone,
        hospitalName: actualFacilityName,
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
