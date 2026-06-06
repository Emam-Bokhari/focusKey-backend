// import { Lottery } from "../app/modules/lottery/lottery.model";

// const findLastTicketId = async () => {
//   const lastTicket = await Lottery.findOne({}, { ticketNumber: 1, _id: 0 })
//     .sort({ createdAt: -1 })
//     .lean();

//   return lastTicket?.ticketNumber || null;
// };

// export const generateTicketId = async () => {
//   const currentYear = new Date().getUTCFullYear().toString();

//   let currentId = "0000"; // default

//   const lastTicketId = await findLastTicketId();

//   if (lastTicketId) {
//     // example: TKT-2026-0001
//     const [, lastYear, lastNumber] = lastTicketId.split("-");

//     if (lastYear === currentYear) {
//       currentId = (Number(lastNumber) + 1).toString().padStart(4, "0");
//     }
//   }

//   return `TKT-${currentYear}-${currentId}`;
// };
