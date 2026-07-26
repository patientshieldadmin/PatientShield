export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const { password, action } = req.body;
    const adminPass = process.env.ADMIN_PASSWORD || 'ShieldAdmin2026!';

    // Handle Forgot Password Request
    if (action === 'forgot') {
      if (process.env.RESEND_API_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}` 
          },
          body: JSON.stringify({
            from: 'PatientShield <audit@thepatientshield.com>',
            to: ['Admin@thepatientshield.com'],
            subject: 'PatientShield Admin Portal Password Recovery',
            html: `
              <div style="font-family: Arial, sans-serif; color: #333; max-width: 500px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #0056b3;">Admin Password Recovery</h2>
                <p>You requested your PatientShield admin portal password.</p>
                <p style="background: #f1f5f9; padding: 12px; border-radius: 5px; font-size: 16px;">Password: <strong>${adminPass}</strong></p>
                <p style="font-size: 12px; color: #777;">If you did not request this, please secure your Vercel project environment settings immediately.</p>
              </div>
            `,
          }),
        });
      }
      return res.status(200).json({ status: 'success', message: 'Password recovery email sent to Admin@thepatientshield.com' });
    }

    // Handle Standard Login
    if (password === adminPass) {
      return res.status(200).json({ status: 'success' });
    } else {
      return res.status(401).json({ status: 'error', message: 'Incorrect admin password.' });
    }
  } catch (error) {
    console.error('Admin Auth Error:', error);
    return res.status(500).json({ status: 'error', message: 'Authentication error.' });
  }
}
