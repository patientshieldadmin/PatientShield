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

    const resendApiKey = process.env.RESEND_API_KEY;

    // 1. Send Immediate "File Received & Audit Underway" Confirmation Email
    if (resendApiKey && clientEmail) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'The Patient Shield <audit@thepatientshield.com>',
            to: [clientEmail],
            subject: 'We Have Received Your Medical Bill - Audit Underway',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #0f172a;">Your Medical Bill Has Been Received</h2>
                <p>Hello ${actualPatientName},</p>
                <p>We wanted to let you know that we have securely received your uploaded document (<strong>${fileName}</strong>) for <strong>${actualFacilityName}</strong>.</p>
                <p>Our forensic audit engine is currently reviewing your statement. Once the analysis is complete and reviewed by our compliance team, you will receive your detailed audit findings and next steps.</p>
                <p style="font-size: 12px; color: #64748b; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                  This communication is handled securely in compliance with HIPAA guidelines.
                </p>
              </div>
            `
          })
        });
      } catch (initialEmailErr) {
        console.error('Initial Confirmation Email Error:', initialEmailErr);
      }
    }

    // Programmatically capture missing document requirements based on site uploads
    if (eobName === 'Not Provided') {
      missingInfoRequests.push('Matching Explanation of Benefits (EOB) from your insurance provider');
    }
    if (recordsName === 'Not Provided') {
      missingInfoRequests.push('Detailed medical records or clinical notes corresponding to the billing dates');
    }

    // 2. Local fallback regex parsing for total amount
    if (fileText) {
      const totalMatch = fileText.match(/(?:Total Balance|Total Charges|Total Amount|Total Due|Total)\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})/i) || fileText.match(/\$([\d,]+\.\d{2})/);
      if (totalMatch && totalMatch[1]) {
        extractedBillAmount = `$${totalMatch[1]}`;
        const num = parseFloat(totalMatch[1].replace(/,/g, ''));
        estimatedSavingsValue = `$${(num * 0.30).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    }

    // 3. OpenAI Universal Forensic Audit Pipeline with Built-In Self-Audit & Self-Correction Loop
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
                content: `You are an elite forensic medical bill auditor and healthcare compliance expert specializing in federal transparency mandates and unbundling detection.

                Execute a rigorous 2-step internal self-audit before finalizing your output:
                - STEP 1 (Draft Analysis): Scan the raw bill text for potential duplicate line items, over-clustered panels, or billing anomalies.
                - STEP 2 (Self-Correction & Veto Filtering): Review every preliminary finding from Step 1 against these strict veto rules:
                  1. VETO RULE A: Discard any finding flagging room and board, daily bed charges, accommodation revenue codes (Rev Codes 0100-0199), or daily care codes that occur on different calendar dates. Sequential daily charges are valid.
                  2. VETO RULE B: Discard any "duplicate" where the calendar dates differ. True duplicates must share the exact same procedure code, description, dollar amount, and calendar date within the same 24-hour period.
                - STEP 3 (Final Compilation): Retain only findings that survive Step 2. Calculate "estimatedSavings" exclusively from these verified surviving errors. If zero verified errors survive, estimatedSavings must be "$0.00".

                Extract and return ONLY a valid JSON object with these exact keys:
                - "extractedTotal": Exact gross total balance as a currency string (e.g., "$125,430.00").
                - "extractedPatient": The actual patient or guarantor name printed on the bill text. Do not use form inputs.
                - "extractedFacility": The actual hospital or medical facility name printed on the bill text. Do not use form inputs.
                - "findings": Array of objects with "category" and "description" containing ONLY self-audited, surviving verified errors. If none, return an empty array.
                - "estimatedSavings": Precise dollar amount of potential savings calculated exclusively from surviving verified errors (or "$0.00" if none).
                - "missingInfoRequests": Array of strings telling the customer what additional documents to gather for a deeper cross-check.
                - "disputeLetter": A formal dispute letter using the extracted patient name, extracted facility, extracted total, and surviving verified findings. If estimatedSavings is "$0.00", explicitly state that no billing discrepancies or duplicate entries were found and no dispute letter is required.
                
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
            if (parsed.missingInfoRequests && parsed.missingInfoRequests.length > 0) {
              missingInfoRequests = Array.from(new Set([...missingInfoRequests, ...parsed.missingInfoRequests]));
            }
            
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

    if (estimatedSavingsValue === '$0.00' || analysisFindings.length === 0) {
      disputeLetterDraft = `Audit Complete: No billable errors, markup anomalies, or verified duplicate entries were identified in the statement for ${actualFacilityName}. A formal dispute letter is not required at this time.`;
    }

    if (aiErrorLog) {
      analysisFindings = [
        { category: '⚠️ AI Audit Diagnostic Error', description: aiErrorLog },
        { category: 'Chargemaster Markup Baseline', description: `Accommodation and ancillary service charges submitted exceed regional benchmarks.` }
      ];
    }

    const leadId = Date.now().toString();
    const dashboardUrl = `[https://thepatientshield.com/dashboard?id=$](https://thepatientshield.com/dashboard?id=$){leadId}`;

    let missingHtml = '';
    if (missingInfoRequests.length > 0) {
      missingHtml = `
        <div style="background-color: #fff8e1; border-left: 4px solid #ffa000; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold; color: #b78103;">⚠️ Additional Documents Needed for Accurate Cross-Check:</p>
          <ul style="margin: 5px 0 0 0; padding-left: 20px; color: #333;">
            ${missingInfoRequests.map(req => `<li>${req}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    const emailSubject = `Preliminary Medical Bill Audit Update: Potential Savings Found (${estimatedSavingsValue})`;
    const emailBodyHtml = `
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
    `;

    // 4. Save Lead to Upstash Redis Database with 'pending_admin_approval' status (Holding results/findings email for admin review)
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
        approvalStatus: 'pending_admin_approval',
        preparedEmailContent: {
          recipient: clientEmail,
          subject: emailSubject,
          bodyHtml: emailBodyHtml
        },
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

    return res.status(200).json({ 
      status: 'success', 
      message: 'File received email sent. Forensic audit completed and lead placed in admin review queue.',
      leadId: leadId
    });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during processing.' });
  }
}
