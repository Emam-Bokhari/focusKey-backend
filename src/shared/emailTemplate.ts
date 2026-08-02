import config from "../config";
import {
  IAdminCredentials,
  ICreateAccount,
  IResetPassword,
} from "../types/emailTemplate";

const PRIMARY_COLOR = "#a90707";
const BG_COLOR = "#ffffff";
const TEXT_COLOR = "#363636";

const baseLayout = (content: string) => `
  <body style="margin:0;padding:0;background-color:${BG_COLOR};font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG_COLOR};padding:40px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" 
            style="max-width:600px;background:#ffffff;border-radius:12px;
            box-shadow:0 8px 24px rgba(0,0,0,0.06);overflow:hidden;">
            
            <!-- Header -->
            <tr>
              <td align="center" style="padding:30px 20px;background:${PRIMARY_COLOR};color:#ffffff;">
                <h1 style="margin:0;font-size:22px;font-weight:600;letter-spacing:1px;">
                  GiftBox
                </h1>
              </td>
            </tr>

            <!-- Dynamic Content -->
            <tr>
              <td style="padding:35px 30px;color:${TEXT_COLOR};font-size:15px;line-height:1.6;">
                ${content}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" 
                style="padding:20px;font-size:12px;color:#888;background:#f7f7f7;">
                © ${new Date().getFullYear()} GiftBox. All rights reserved.
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
`;

const createAccount = (values: ICreateAccount) => {
  const content = `
    <h2 style="margin-top:0;color:${TEXT_COLOR};">
      Welcome, ${values.name}
    </h2>

    <p>
      Thank you for creating an account with GiftBox.
      Please verify your email address using the code below.
    </p>

    <div style="text-align:center;margin:35px 0;">
      <div style="
        display:inline-block;
        padding:18px 30px;
        background:${PRIMARY_COLOR};
        color:#ffffff;
        font-size:26px;
        font-weight:700;
        letter-spacing:4px;
        border-radius:8px;
      ">
        ${values.otp}
      </div>
    </div>

    <p style="margin-bottom:10px;">
      This verification code will expire in <strong>3 minutes</strong>.
    </p>

    <p style="color:#888;font-size:13px;">
      If you did not create this account, please ignore this email.
    </p>
  `;

  return {
    to: values.email,
    subject: "GiftBox – Verify Your Account",
    html: baseLayout(content),
  };
};

const resetPassword = (values: IResetPassword) => {
  const content = `
    <h2 style="margin-top:0;color:${TEXT_COLOR};">
      Password Reset Request
    </h2>

    <p>
      We received a request to reset your password.
      Use the secure code below to continue.
    </p>

    <div style="text-align:center;margin:35px 0;">
      <div style="
        display:inline-block;
        padding:18px 30px;
        background:${PRIMARY_COLOR};
        color:#ffffff;
        font-size:26px;
        font-weight:700;
        letter-spacing:4px;
        border-radius:8px;
      ">
        ${values.otp}
      </div>
    </div>

    <p>
      This code will expire in <strong>3 minutes</strong>.
    </p>

    <p style="color:#888;font-size:13px;">
      If you did not request a password reset, you can safely ignore this email.
    </p>
  `;

  return {
    to: values.email,
    subject: "GiftBox – Password Reset Code",
    html: baseLayout(content),
  };
};

const adminCredentials = (values: IAdminCredentials) => {
  const emailHtml = `
  <body style="margin:0;padding:0;background:#d1d2d2;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
      <tr>
        <td align="center">

          <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,0.08);">

            <!-- Header -->
            <tr>
              <td style="background:#0b3c6d;padding:25px;text-align:center;color:#ffffff;">
                <h2 style="margin:0;">Admin Account Created</h2>
                <p style="margin:5px 0 0 0;font-size:13px;">Welcome to My Home Admin Panel</p>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:30px;color:#333;font-size:15px;line-height:1.6;">

                <p>Hello <b>${values.name || "Admin"}</b>,</p>

                <p>Your admin account has been created successfully.</p>

                <table style="width:100%;margin-top:20px;">
                  <tr>
                    <td style="padding:8px 0;font-weight:bold;width:120px;">Email:</td>
                    <td>${values.email}</td>
                  </tr>

                  <tr>
                    <td style="padding:8px 0;font-weight:bold;">Password:</td>
                    <td style="background:#f0f0f0;padding:8px;border-radius:5px;">
                      ${values.password}
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:8px 0;font-weight:bold;">Role:</td>
                    <td>ADMIN</td>
                  </tr>
                </table>

                <div style="margin-top:25px;text-align:center;">
                  <a href="${config.dashboard_url}/dashboard" 
                    style="background:#0b3c6d;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;">
                    Login to Dashboard
                  </a>
                </div>

                <p style="margin-top:25px;font-size:13px;color:#666;">
                  ⚠️ Please change your password after first login for security.
                </p>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#f2f2f2;text-align:center;padding:15px;font-size:12px;color:#888;">
                © ${new Date().getFullYear()} My Home. All rights reserved.
              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>
  </body>
`;

  return {
    to: values.email,
    subject: "Your Admin Account Credentials - My Home",
    html: emailHtml,
  };
};

export const emailTemplate = {
  createAccount,
  resetPassword,
  adminCredentials,
};
