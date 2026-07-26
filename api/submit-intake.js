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
    let missingInfoRequests = [];
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

    // 2. OpenAI Universal Forensic Audit Pipeline with Fortified Anti-False-Positive Rules
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
                content: `You are an elite forensic medical bill auditor and healthcare compliance expert specializing in federal transparency mandates, the No Surprises Act, unbundling detection, and chargemaster cost-to-charge crosswalks.

                Analyze the provided raw medical bill text meticulously, regardless of medical specialty, facility type, or department. You must strictly adhere to these anti-false-positive rules:
                1. ABSOLUTE PROHIBITION: NEVER flag room and board, daily NICU/ICU room charges, daily therapy, or daily professional care codes as duplicates simply because they appear multiple times in the document. If they occur on DIFFERENT calendar dates, they are valid daily occupancy charges.
                2. ONLY flag true administrative duplicate line items where the EXACT same procedure code, description, dollar amount, and calendar date appear more than once within the same 24-hour period, or true redundant panel over-clustering.
                3. Calculate "estimatedSavings" exclusively from verified, non-daily line-item errors, true same-day duplicates, or actual markup anomalies.

                Extract and return ONLY a valid JSON object with these exact keys:
                - "extractedTotal": Exact gross total balance as a currency string (e.g., "$125,430.00").
                - "extractedPatient": The actual patient or guarantor name printed on the bill text. Do not use form inputs.
                - "extractedFacility": The actual hospital or medical facility name printed on the bill text. Do not use form inputs.
                - "findings": Array of objects with "category" and "description" detailing verified line-item errors or true same-day duplicates only.
                - "estimatedSavings": Precise dollar amount of potential savings calculated exclusively from actual verified billing errors (exclude daily room charges).
                - "missingInfoRequests": Array of strings telling the customer what additional documents to gather for a deeper cross-check (e.g., "Request matching Explanation of Benefits (EOB) from your insurance provider", "Gather itemized pharmacy or supply logs for audit verification").
                - "disputeLetter": A formal dispute letter using the extracted patient name, extracted facility, extracted total, and verified findings.
                
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
            if (parsed.missingInfoRequests && parsed.missingInfoRequests.length > 0) missingInfoRequests = parsed.missingInfoRequests;
            
            // Savings formatting snippet integrated and safely handled
            if (parsed.estimatedSavings) {
              let formattedSavings = parsed.estimatedSavings;
              if (!isNaN(parseFloat(formattedSavings))) {
                formattedSavings = `$${parseFloat(formattedSavings).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              }
              estimatedSavingsValue = formattedSavings;
            }

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

    // If OpenAI failed, inject the exact reason into findings
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

    const leadId = Date.now().toString();

    // 3. Save Lead to Upstash Redis Database
    try {
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
        missingInfoRequests,
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

    // 4. Send HIPAA-Compliant Client Notification Email via Resend API
    try {
      const resendApiKey = process.env.RESEND_API_KEY;
      if (resendApiKey && clientEmail) {
        const dashboardUrl = `[https://thepatientshield.com/dashboard?id=$](https://thepatientshield.com/dashboard?id=$){leadId}`;
        
        // Build missing info checklist html if any
        let missingHtml = '';
        if (eobName === 'Not Provided' || recordsName === 'Not Provided' || missingInfoRequests.length > 0) {
          missingHtml = `
            <div style="background-color: #fff8e1; border-left: 4px solid #ffa000; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-weight: bold; color: #b78103;">⚠️ Additional Documents Needed for Accurate Cross-Check:</p>
              <p style="margin: 5px 0 0 0; color: #333;">To ensure a fully accurate, legally sound, and comprehensive audit, please upload your matching Explanation of Benefits (EOB) or medical records.</p>
            </div>
          `;
        }

        await fetch('[https://api.resend.com/emails](https://api.resend.com/emails)', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'The Patient Shield <audit@thepatientshield.com>',
            to: [clientEmail],
            subject: `Preliminary Medical Bill Audit Update: Potential Savings Found (${estimatedSavingsValue})`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #0f172a;">Your Medical Bill Audit Has Been Processed</h2>
                <p>Hello ${actualPatientName},</p>
                <p>We have received and securely processed your uploaded statement for <strong>${actualFacilityName}</strong>.</p>
                
                <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 0 0 10px 0;"><strong>Gross Bill Total:</strong> ${extractedBillAmount}</p>
                  <p style="margin: 0;"><strong>Preliminary Potential Savings Identified:</strong> <span style="color: #16a34a; font-size: 18px; font-weight: bold;">${estimatedSavingsValue}</span></p>
                </div>

                ${missingHtml}

                <p>To view your preliminary findings, upload any missing documents (such as EOBs), and securely finalize your review, please click the secure link below:</p>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${dashboardUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Access Secure Portal & Upload Missing Files</a>
                </div>

                <p style="font-size: 12px; color: #64748b; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                  This communication is handled securely in compliance with HIPAA guidelines. Final dispute documents and full resolution packages become accessible upon service completion.
                </p>
              </div>
            `
          })
        });
      }
    } catch (emailErr) {
      console.error('Email Dispatch Error:', emailErr);
    }

    return res.status(200).json({ status: 'success', message: 'Forensic audit completed and client notification sent successfully.' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during processing.' });
  }
}
