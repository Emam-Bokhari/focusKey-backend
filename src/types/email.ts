export type ISendEmail = {
  to: string;
  subject: string;
  html: string;
  userId?: string;
  event?: any;
};
