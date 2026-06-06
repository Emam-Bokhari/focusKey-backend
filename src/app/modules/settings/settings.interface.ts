export type TSettings = {
  paymentNumbers: {
    label: string; // e.g. "M-Pesa primary number"
    number: string; // e.g. "+243 810 000 001"
  }[];
  currency: string;
};
