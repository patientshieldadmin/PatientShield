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

    // Default fallbacks before AI analysis
    let extractedBillAmount = '$15,450.00';
    let estimatedSavingsValue = '$4,635.00';
    let actualPatientName = fullName;
    let actualFacilityName = hospitalName;

    if (fileText) {
      const totalMatch = fileText.match(/(?:Total Balance|Total Charges|Total Amount|Total Due|Total)\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})/i) || fileText.match(/\$([\d,]+\.\d{2})/);
      if (totalMatch && totalMatch[1]) {
        extractedBillAmount = `$${totalMatch[1]}`;
      }
    }

    let numericTotal = parseFloat(extractedBillAmount.replace(/[^0-9.]/g, '')) || 15450;
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

    // OpenAI Deep Forensic Engine (Calculates itemized savings & extracts bill-specific names)
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
                content: `You are an elite forensic medical bill auditor. Meticulously analyze the provided hospital bill text. 
                1. Extract the exact total gross bill or balance amount ("extractedTotal").
                2. Extract the actual patient or guarantor name printed directly on the bill text ("extractedPatient").
                3. Extract the actual hospital or facility name printed directly on the bill text ("extractedFacility").
                4. Perform a rigorous line-item audit identifying overcharges, markups (>300%), and unbundled services. Calculate the precise dollar amount of potential savings ("estimatedSavings") based strictly on the specific line-item discrepancies and markup corrections found in this bill.
                5. Provide itemized findings ("findings" array with "category" and "description").
                6. Draft a formal dispute letter ("disputeLetter") that explicitly uses the extracted patient name and extracted facility name.
                
                Output valid JSON only with keys: "extractedTotal", "extractedPatient", "extractedFacility", "findings", "estimatedSavings", "disputeLetter".`
              },
              {
                role: 'user',
                content: `Form Input Name: ${fullName}\nForm Input Hospital: ${hospitalName}\n\n--- BILL TEXT START ---\n${fileText.substring(0, 15000)}\n--- BILL TEXT END ---`
              }
            ],
            response_format: { type: 'json_object' },
            max_tokens: 4000,
            temperature: 0.2
          })
        });

        if (openaiResponse.ok) {
          const openaiData = await openaiResponse.json();
          if (openaiData.choices?.[0]?.message?.content) {
            const parsed = JSON.parse(openaiData.choices[0].message.content);
            if (parsed.extractedTotal) extractedBillAmount = parsed.extractedTotal;
            if (parsed.extractedPatient) actualPatientName = parsed.extractedPatient;
            if (parsed.extractedFacility) actualFacilityName = parsed.extractedFacility;
            if (parsed.findings && parsed.findings.length > 0) analysisFindings = parsed.findings;
            if (parsed.estimatedSavings) estimatedSavingsValue = parsed.estimatedSavings; // AI-computed savings from bill audit
            if (parsed.disputeLetter && parsed.disputeLetter.length > 50) disputeLetterDraft = parsed.disputeLetter;
          }
        }
      } catch (aiErr) {
        console.error('AI Processing Error:', aiErr);
      }
    }

    // Save Lead to Upstash Redis Database
    try {
      const leadId = Date.now().toString();
      const leadData = {
        id: leadId,
        fullName: actualPatientName, // Save bill-verified patient name
        clientEmail,
        phone,
        hospitalName: actualFacilityName, // Save bill-verified facility name
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
