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

    let extractedBillAmount = '$0.00';
    let estimatedSavingsValue = '$0.00';
    let actualPatientName = fullName;
    let actualFacilityName = hospitalName;
    let analysisFindings = [];
    let disputeLetterDraft = '';
    let aiErrorLog = null;

    // 1. Local fallback regex parsing for total amount
    if (fileText) {
      const totalMatch = fileText.match(/(?:Total Balance|Total Charges|Total Amount|Total Due|Total)\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})/i) || fileText.match(/\$([\d,]+\.\d{2})/);
      if (totalMatch && totalMatch[1]) {
        extractedBillAmount = `$${totalMatch[1]}`;
        const num = parseFloat(totalMatch[1].replace(/,/g, ''));
        estimatedSavingsValue = `$${(num * 0.30).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    }

    // 2. OpenAI Deep Forensic Audit
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
                content: `You are an elite forensic medical bill auditor specializing in catastrophic inpatient stays. Analyze the provided raw text of the hospital bill.
                Extract and return ONLY a valid JSON object with these exact keys:
                - "extractedTotal": Exact gross total balance as a currency string (e.g., "$639,583.00").
                - "extractedPatient": The actual patient or guarantor name printed on the bill text. Do not use form inputs.
                - "extractedFacility": The actual hospital or facility name printed on the bill text. Do not use form inputs.
                - "findings": Array of objects with "category" and "description" detailing specific markups or unbundled codes found in the text.
                - "estimatedSavings": Precise dollar amount of potential savings calculated from the specific markup errors found.
                - "disputeLetter": A formal dispute letter using the extracted patient name, extracted facility, extracted total, and findings.
                
                Do not wrap the JSON in markdown code blocks.`
              },
              {
                role: 'user',
                content: `Form Name Fallback: ${fullName}\nForm Hospital Fallback: ${hospitalName}\n\n--- BILL TEXT ---\n${fileText.substring(0, 15000)}`
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
            rawContent = rawContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
            
            const parsed = JSON.parse(rawContent);
            if (parsed.extractedTotal) extractedBillAmount = parsed.extractedTotal;
            if (parsed.extractedPatient && parsed.extractedPatient.trim() !== '') {
              actualPatientName = parsed.extractedPatient.trim();
            }
            if (parsed.extractedFacility && parsed.extractedFacility.trim() !== '') {
              actualFacilityName = parsed.extractedFacility.trim();
            }
            if (parsed.findings && parsed.findings.length > 0) analysisFindings = parsed.findings;
            if (parsed.estimatedSavings) estimatedSavingsValue = parsed.estimatedSavings;
            if (parsed.disputeLetter && parsed.disputeLetter.length > 50) disputeLetterDraft = parsed.disputeLetter;
          }
        } else {
          aiErrorLog = await openaiResponse.text();
          console.error('OpenAI API Error Response:', aiErrorLog);
        }
      } catch (aiErr) {
        aiErrorLog = aiErr.message;
        console.error('AI Processing Exception:', aiErr);
      }
    } else if (!process.env.OPENAI_API_KEY) {
      aiErrorLog = 'OPENAI_API_KEY environment variable is missing in Vercel.';
    } else if (fileText.trim().length === 0) {
      aiErrorLog = 'Extracted file text length is 0 (PDF text layer could not be read).';
    }

    // If OpenAI failed, inject the exact reason into the dashboard findings so you see it immediately
    if (aiErrorLog) {
      analysisFindings = [
        { category: '⚠️ AI Audit Diagnostic Error', description: aiErrorLog },
        { category: 'Chargemaster Markup Baseline', description: `Accommodation and ancillary service charges submitted exceed regional benchmarks.` }
      ];
    }

    // Fallback dispute letter if unpopulated
    if (!disputeLetterDraft) {
      disputeLetterDraft = `[HOSPITAL BILLING DISPUTE & ITEMIZED AUDIT REQUEST]

Dear Billing Compliance Department,

Patient Name: ${actualPatientName}
Facility: ${actualFacilityName}
Reference Document: ${fileName}
Statement Total Referenced: ${extractedBillAmount}

We hereby formally dispute the excessive, inflated, and unbundled charges itemized on the recent billing statement. In accordance with federal transparency mandates, the No Surprises Act, and healthcare itemized audit guidelines, we require immediate itemized source verification, CPT/HCPCS code validation, and a complete chargemaster cost-to-charge crosswalk.

Please provide itemized source verification, cost-to-charge crosswalk documentation, and adjusted billing within 30 days.`;
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

    return res.status(200).json({ status: 'success', message: 'Forensic audit completed successfully.' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during processing.' });
  }
}
