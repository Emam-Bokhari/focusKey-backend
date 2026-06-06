import { Types } from "mongoose";
import config from "../../../config";
import ApiError from "../../../errors/ApiErrors";
import { ISendEmail } from "../../../types/email";
import { User } from "../user/user.model";
import { TSupport } from "./support.interface";
import { Support } from "./support.model";
import QueryBuilder from "../../builder/queryBuilder";
import { SUPPORT_STATUS } from "./support.constant";
import { emailQueue } from "../../../queues";

const PRIMARY_COLOR = "#22143b";
const TEXT_COLOR = "#ffffff";

const support = async (id: string, payload: TSupport) => {
  const user = await User.isExistUserById(id);

  if (!user) {
    throw new ApiError(404, "No user is found in the database");
  }

  payload.userId = new Types.ObjectId(id);
  payload.name = user.name || "Unknown";
  payload.email = user.email;

  const supportEntry = await Support.create(payload);

  const emailPayload: ISendEmail = {
    to: config.support_receiver_email || "support@giftbox.com",
    subject: `GiftBox Support Request: ${payload.subject}`,
    html: `
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;background:#ffffff;">
    <tr>
      <td align="center">

        <table width="100%" cellpadding="0" cellspacing="0"
          style="max-width:600px;background:#ffffff;border-radius:12px;
          box-shadow:0 8px 24px rgba(0,0,0,0.06);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding:30px 20px;background:${PRIMARY_COLOR};color:${TEXT_COLOR};">
              <h1 style="margin:0;font-size:22px;font-weight:600;letter-spacing:1px;">
                GiftBox
              </h1>
              <p style="margin:5px 0 0 0;font-size:13px;opacity:0.9;">
                Support Request Notification
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:35px 30px;color:#363636;font-size:15px;line-height:1.6;">

              <p style="margin-bottom:10px;">
                A new support request has been submitted from GiftBox platform.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">

                <tr>
                  <td style="padding:8px 0;font-weight:bold;width:150px;">Name:</td>
                  <td style="padding:8px 0;">${payload.name || "Unknown"}</td>
                </tr>

                <tr>
                  <td style="padding:8px 0;font-weight:bold;">Email:</td>
                  <td style="padding:8px 0;">${payload.email}</td>
                </tr>

                <tr>
                  <td style="padding:8px 0;font-weight:bold;">Subject:</td>
                  <td style="padding:8px 0;">${payload.subject}</td>
                </tr>

                ${
                  payload.attachment
                    ? `
                <tr>
                  <td style="padding:8px 0;font-weight:bold;">Attachment:</td>
                  <td style="padding:8px 0;">
                    <a href="http://10.10.7.93:5000${payload.attachment}" target="_blank" style="color:${PRIMARY_COLOR};text-decoration:underline;">
                      View Attachment
                    </a>
                  </td>
                </tr>
                `
                    : ""
                }

              </table>

              <div style="margin-top:25px;">
                <p style="margin-bottom:6px;font-weight:bold;">Message:</p>

                <div style="
                  background:#f8f8f8;
                  padding:18px;
                  border-left:4px solid ${PRIMARY_COLOR};
                  border-radius:4px;
                  font-size:14px;
                  line-height:1.6;
                ">
                  ${payload.message}
                </div>
              </div>

              <div style="text-align:center;margin-top:35px;">
                <a
                  href="mailto:${payload.email}"
                  style="
                    background:${PRIMARY_COLOR};
                    color:${TEXT_COLOR};
                    padding:14px 24px;
                    border-radius:6px;
                    text-decoration:none;
                    font-size:15px;
                    display:inline-block;
                    font-weight:600;
                  "
                >
                  Reply to ${payload.name || "User"}
                </a>
              </div>

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
`,
  };

  emailQueue.add("support-request", emailPayload);

  return supportEntry;
};

const getAllSupportsFromDB = async (query: any) => {
  const baseQuery = Support.find().populate({
    path: "userId",
    select: "_id name email phone role profileImage",
  });

  const queryBuilder = new QueryBuilder(baseQuery, query)
    .search(["name", "email", "phone", "subject"])
    .sort()
    .fields()
    .filter()
    .paginate();

  const supports = await queryBuilder.modelQuery;

  const meta = await queryBuilder.countTotal();

  if (!supports || supports.length === 0) {
    return {
      data: [],
      meta,
    };
  }

  return {
    data: supports,
    meta,
  };
};

const getSupportByIdFromDB = async (id: string) => {
  const support = await Support.findById(id).populate({
    path: "userId",
    select: "name email phone role profileImage",
  });

  if (!support) {
    return {};
  }

  return support;
};

const reviewSupportByAdminToDB = async (
  supportId: string,
  status: SUPPORT_STATUS,
) => {
  // validation: only allow specific statuses
  if (![SUPPORT_STATUS.RESOLVED].includes(status)) {
    throw new ApiError(400, "Invalid support status update request");
  }

  const support = await Support.findById(supportId);

  if (!support) {
    throw new ApiError(404, "Support not found");
  }

  support.status = status;

  await support.save();

  return support;
};

const deleteSupportByIdFromDB = async (id: string) => {
  const support = await Support.findByIdAndDelete(id);
  if (!support) {
    throw new ApiError(400, "Failed to delete this support by this ID");
  }

  return support;
};

export const SupportServices = {
  support,
  getAllSupportsFromDB,
  getSupportByIdFromDB,
  reviewSupportByAdminToDB,
  deleteSupportByIdFromDB,
};
