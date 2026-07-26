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

    // 1. Robust local regex baseline extraction as a fail-safe
    let extractedBillAmount = '$15,450.00';     if (fileText) {       const totalMatch = fileText.match(/(?:Total Balance\vert{}Total Charges\vert{}Total Amount\vert{}Total Due\vert{}Total)\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})/i) \vert{}\vert{} fileText.match(/\$([\d,]+\.\d{2})/);       if (totalMatch && totalMatch[1]) {         extractedBillAmount = `$${totalMatch[1]}`;
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
      { category: 'Chargemaster Markup & Room Rate Inflation', description: `Accommodation and ancillary service charges submitted exceed regional Medicare fair-market reimbursement benchmarks.` },
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

    // 2. Elite Forensic AI Audit Execution with strict JSON parsing & markdown sanitization
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
                content: `You are an elite forensic medical bill auditor, technical strategist, and clinical billing compliance expert specializing in high-acuity, catastrophic inpatient hospital stays (NICU, ICU, and complex multi-account bills). 
                
                Meticulously analyze the provided raw text of the hospital bill. You must execute and extract the following:
                1. "extractedTotal": The exact gross total bill or balance amount found on the document (formatted as currency, e.g. "$639,583.00").
                2. "extractedPatient": The actual patient or guarantor name printed directly on the bill text. Do not use placeholder form input names if a real name appears on the document.
                3. "extractedFacility": The actual hospital or facility name printed directly on the bill text. Do not use shorthand form inputs if the official facility name is on the document.
                4. "findings": An array of objects with "category" and "description" detailing specific line-item billing errors, chargemaster markups, unbundled CPT/HCPCS codes, duplicate charges, or room/board transfer discrepancies found in the text.
                5. "estimatedSavings": The precise dollar amount of potential savings derived strictly from the sum of the specific line-item discrepancies and markup corrections identified in this audit. Base this entirely on your audit findings from the bill text.
                6. "disputeLetter": A comprehensive, professional, compliance-ready hospital dispute letter that explicitly incorporates the extracted patient name, extracted facility name, extracted total, and specific line-item findings with regulatory citations.

                Return ONLY valid JSON. Do not wrap the JSON in markdown code blocks like \`\`\`json. Output raw JSON object with keys: "extractedTotal", "extractedPatient", "extractedFacility", "findings", "estimatedSavings", "disputeLetter".`
              },
              {
                role: 'user',
                content: `User Form Submitted Name: ${fullName}\nUser Form Submitted Hospital: ${hospitalName}\n\n--- RAW HOSPITAL BILL TEXT START ---\n${fileText.substring(0, 15000)}\n--- RAW HOSPITAL BILL TEXT END ---`
              }
            ],
            response_format: { type: 'json_object' },
            max_tokens: 4000,
            temperature: 0.1
          })
        });

        if (openaiResponse.ok) {
          const openaiData = await openaiResponse.json();
          if (openaiData.choices?.[0]?.message?.content) {
            let rawContent = openaiData.choices[0].message.content.trim();
            // Sanitize potential markdown wrappers just in case
            rawContent = rawContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
            
            const parsed = JSON.parse(rawContent);
            if (parsed.extractedTotal) extractedBillAmount = parsed.extractedTotal;
            if (parsed.extractedPatient && parsed.extractedPatient.trim() !== '') actualPatientName = parsed.extractedPatient;
            if (parsed.extractedFacility && parsed.extractedFacility.trim() !== '') actualFacilityName = parsed.extractedFacility;
            if (parsed.findings && parsed.findings.length > 0) analysisFindings = parsed.findings;
            if (parsed.estimatedSavings) estimatedSavingsValue = parsed.estimatedSavings;
            if (parsed.disputeLetter && parsed.disputeLetter.length > 50) disputeLetterDraft = parsed.disputeLetter;
          }
        } else {
          console.error('OpenAI Error:', await openaiResponse.text());
        }
      } catch (aiErr) {
        console.error('AI Forensic Execution Exception:', aiErr);
      }
    }

    // Save Lead to Upstash Redis Database
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

    return res.status(200).json({ status: 'success', message: 'Forensic audit completed successfully.' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during forensic processing.' });
  }
}
