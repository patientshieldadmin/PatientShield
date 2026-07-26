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

    // Strict baseline initialization (no hardcoded flat-percentage savings calculations)
    let extractedBillAmount = '$0.00';
    let estimatedSavingsValue = '$0.00';
    let actualPatientName = '';
    let actualFacilityName = '';
    let analysisFindings = [];
    let disputeLetterDraft = '';

    // Fallback regex for total amount only if needed
    if (fileText) {
      const totalMatch = fileText.match(/(?:Total Balance|Total Charges|Total Amount|Total Due|Total)\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})/i) || fileText.match(/\$([\d,]+\.\d{2})/);
      if (totalMatch && totalMatch[1]) {
        extractedBillAmount = `$${totalMatch[1]}`;
      }
    }

    // Elite Forensic AI Audit Execution (Strictly AI-Driven Extraction & Itemized Savings)
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
                content: `You are an elite forensic medical bill auditor and clinical compliance expert specializing in catastrophic inpatient hospital stays (NICU, ICU, complex multi-account bills). 
                
                Meticulously analyze the provided raw text of the hospital bill. You must extract and calculate the following with absolute fidelity to the document text:
                1. "extractedTotal": The exact gross total bill or balance amount found on the document (formatted as currency, e.g. "$639,583.00").
                2. "extractedPatient": The actual patient or guarantor name printed directly on the bill text. Do NOT use form input names. Look at the bill headers or patient info blocks.
                3. "extractedFacility": The actual hospital or facility name printed directly on the bill text. Do NOT use form input names. Look at the provider letterhead or facility headers.
                4. "findings": An array of objects with "category" and "description" detailing specific line-item billing errors, chargemaster markups (>300%), unbundled CPT/HCPCS codes, duplicate charges, or room/board transfer discrepancies found in the text.
                5. "estimatedSavings": The precise itemized dollar amount of potential savings derived strictly from the sum of the specific line-item markup corrections and billing errors identified in this audit. Do NOT use a flat percentage formula. Calculate the actual dollar total of the identified errors.
                6. "disputeLetter": A comprehensive, professional, compliance-ready hospital dispute letter that explicitly incorporates the extracted patient name, extracted facility name, extracted total, and specific line-item findings with regulatory citations (No Surprises Act, NCCI bundling edits, Medicare fair-market cost benchmarks).

                Return ONLY raw JSON with keys: "extractedTotal", "extractedPatient", "extractedFacility", "findings", "estimatedSavings", "disputeLetter". Do not use markdown code blocks.`
              },
              {
                role: 'user',
                content: `Form Input Fallbacks (Ignore names if real document names exist):\nPatient: ${fullName}\nHospital: ${hospitalName}\n\n--- RAW HOSPITAL BILL TEXT START ---\n${fileText.substring(0, 15000)}\n--- RAW HOSPITAL BILL TEXT END ---`
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
              actualPatientName = parsed.extractedPatient;
            }
            if (parsed.extractedFacility && parsed.extractedFacility.trim() !== '') {
              actualFacilityName = parsed.extractedFacility;
            }
            if (parsed.findings && parsed.findings.length > 0) analysisFindings = parsed.findings;
            if (parsed.estimatedSavings && parsed.estimatedSavings.trim() !== '') {
              estimatedSavingsValue = parsed.estimatedSavings; // Strictly AI-audited savings figure
            }
            if (parsed.disputeLetter && parsed.disputeLetter.length > 50) {
              disputeLetterDraft = parsed.disputeLetter;
            }
          }
        } else {
          console.error('OpenAI Error:', await openaiResponse.text());
        }
      } catch (aiErr) {
        console.error('AI Forensic Execution Exception:', aiErr);
      }
    }

    // Fallbacks if AI fields were unpopulated
    if (!actualPatientName) actualPatientName = fullName;
    if (!actualFacilityName) actualFacilityName = hospitalName;
    if (analysisFindings.length === 0) {
      analysisFindings = [{ category: 'Initial Bill Ingestion', description: 'Awaiting complete forensic line-item verification.' }];
    }
    if (!disputeLetterDraft) {
      disputeLetterDraft = `[HOSPITAL BILLING DISPUTE & ITEMIZED AUDIT REQUEST]\n\nDear Billing Compliance Department,\n\nPatient Name: ${actualPatientName}\nFacility: ${actualFacilityName}\nReference Document: ${fileName}\nStatement Total: ${extractedBillAmount}\n\nWe formally dispute the charges itemized on this statement and require immediate itemized source verification and CPT validation within 30 days.`;
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
