import { ISoftDeleteModel } from "../../../types/softDelete";

export type TFaq = {
  question: string;
  answer: string;
};
export type TFaqModel = ISoftDeleteModel<TFaq>;
