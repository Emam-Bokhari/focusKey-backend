import { model, Schema } from "mongoose";
import { TFaq, TFaqModel } from "./faq.interface";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";

const faqSchema = new Schema<TFaq, TFaqModel>(
  {
    question: {
      type: String,
      required: true,
    },
    answer: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

faqSchema.plugin(softDeletePlugin);
export const Faq = model<TFaq, TFaqModel>("Faq", faqSchema);
